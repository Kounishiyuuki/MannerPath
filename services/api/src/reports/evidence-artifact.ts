// The sanitized community evidence artifact (ADR-0014 §10–12): the ONLY thing that crosses from the durable
// REPORTS_DB to the replaceable canonical DATA_DB. src/reports/review.ts writes it from an exported review;
// src/pipeline/community-artifact.ts verifies and imports it. This module is pure: no database, no clock.
//
// What it carries is what a reviewer decided and the facts the canonical guards need, and nothing a person wrote or
// is: review identity and decision version, the rule and terms versions, the independence attestation (counts,
// never keys), and per evidence report its ID, type/finding, subject, categorical claims, consent, the last day it
// may be used, and a pin only where the review adopts one. Never: note, submitter hash, observation date, receipt
// time, attestation material, install/device data, free-text claims, moderation reasons.
//
// Bytes are deterministic: keys sorted at every level, no whitespace, one trailing newline, evidence sorted by report
// ID. The same review state gives byte-identical output, and `contentSha256` is SHA-256 over the canonical content.

import { z } from "zod";
import { sha256Hex } from "../db.ts";

export const ARTIFACT_KIND = "mannerpath.community-evidence";
export const ARTIFACT_SCHEMA_VERSION = 1;
/** The REPORTS_DB schema an artifact may come from (migrations-reports/0001, report_store_meta). */
export const REPORT_STORE_SCHEMA = "reports-store.v1";
export const INDEPENDENCE_VERSION = "community-independence.v1";

const ID = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));
const REPORT = ID("rp");
const SPOT = ID("sp");
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "invalid date");
const TERMS = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/);
const nullable = <T extends z.ZodType>(t: T) => t.nullable();

export const ArtifactClaims = z.object({
  spotType: nullable(z.enum(["designatedOutdoorArea", "publicSmokingRoom", "facilitySmokingRoom", "ashtray", "smokingPermittedVenue", "unknown"])),
  spotSubtype: nullable(z.enum(["smokingCorner", "tobaccoShopSmokingSpace"])),
  accessType: nullable(z.enum(["public", "customerOnly", "facilityOnly", "unknown"])),
  accessDetail: nullable(z.enum(["ticketedUsersOnly"])),
  hostType: nullable(z.enum(["municipality", "station", "airport", "commercialBuilding", "convenienceStore", "tobaccoShop", "restaurantOrCafe", "other", "unknown"])),
  environment: nullable(z.enum(["indoor", "outdoor", "covered", "unknown"])),
  supportsPaper: nullable(z.enum(["yes", "no", "unknown"])),
  supportsHeated: nullable(z.enum(["yes", "no", "unknown"])),
}).strict();
export type ArtifactClaims = z.infer<typeof ArtifactClaims>;

export const ArtifactEvidence = z.object({
  reportId: REPORT,
  reportType: z.enum(["exists", "missing", "moved", "hoursChanged", "tobaccoTypeChanged", "accessChanged", "prohibited", "other"]),
  finding: nullable(z.enum(["notFound", "removed", "wrongType"])),
  subjectSpotId: nullable(SPOT),
  latitude: nullable(z.number().min(-90).max(90)),
  longitude: nullable(z.number().min(-180).max(180)),
  acceptedTermsVersion: nullable(TERMS),
  claims: ArtifactClaims,
  usableUntil: DAY,
}).strict();
export type ArtifactEvidence = z.infer<typeof ArtifactEvidence>;

export const ArtifactReview = z.object({
  reviewId: z.string().regex(/^(ca|ce|cn)_[0-9A-HJKMNP-TV-Z]{26}$/),
  kind: z.enum(["newSpot", "effect", "absence"]),
  reviewKey: z.string().min(1).max(128),
  decisionVersion: z.number().int().min(1),
  ruleVersion: z.enum(["community-reconciliation.v1", "community-effects.v1", "community-absence.v1"]),
  decidedBy: z.string().min(1).max(64),
  decidedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  subjectSpotId: nullable(SPOT),
  reportType: nullable(z.enum(["moved", "prohibited", "hoursChanged", "accessChanged", "tobaccoTypeChanged", "exists"])),
  evidenceTier: nullable(z.enum(["communityReported", "communityVerified"])),
  locationReportId: nullable(REPORT),
}).strict();

export const ArtifactIndependence = z.object({
  version: z.literal(INDEPENDENCE_VERSION),
  evidenceCount: z.number().int().min(1),
  independentSubmitters: z.number().int().min(1),
  baseReportIds: nullable(z.array(REPORT).min(1)),
  baseIndependentSubmitters: nullable(z.number().int().min(1)),
  confirmationsAfter: nullable(z.number().int().min(2)),
}).strict();

export const ArtifactContent = z.object({
  artifact: z.literal(ARTIFACT_KIND),
  artifactSchemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  reportStoreSchema: z.literal(REPORT_STORE_SCHEMA),
  review: ArtifactReview,
  termsVersion: nullable(TERMS),
  independence: ArtifactIndependence,
  evidence: z.array(ArtifactEvidence).min(1),
}).strict().superRefine((c, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = c.evidence.map((e) => e.reportId);
  if (ids.some((id, i) => i > 0 && ids[i - 1] >= id)) fail("evidence must be sorted by reportId without repeats");
  const i = c.independence;
  if (i.evidenceCount !== c.evidence.length) fail("independence.evidenceCount must equal the evidence length");
  if (i.independentSubmitters > i.evidenceCount) fail("independence.independentSubmitters exceeds the evidence");
  const based = [i.baseReportIds, i.baseIndependentSubmitters, i.confirmationsAfter].filter((v) => v !== null).length;
  if (based !== 0 && based !== 3) fail("independence base fields come together");
  if (i.confirmationsAfter !== null && i.confirmationsAfter <= i.baseIndependentSubmitters!) fail("a confirmation must add an independent submitter");
  const r = c.review;
  if ((r.kind === "newSpot") !== (r.subjectSpotId === null)) fail("only an existing-spot review names a subject spot");
  if ((r.kind === "newSpot") !== (r.evidenceTier !== null && r.locationReportId !== null)) fail("a new-spot review states its tier and location");
  if ((r.kind === "effect") !== (r.reportType !== null)) fail("only an effect review states a report type");
  if (based !== 0 && r.reportType !== "exists") fail("only an exists confirmation carries a base");
  for (const e of c.evidence) {
    if (r.subjectSpotId !== null && e.subjectSpotId !== r.subjectSpotId) fail(`${e.reportId} names another spot`);
    const pinned = e.latitude !== null || e.longitude !== null;
    if (pinned && (e.latitude === null || e.longitude === null)) fail(`${e.reportId} has half a pin`);
    // A pin crosses only where the review adopts it: the new spot's location, or a reviewed relocation.
    const mayPin = (r.kind === "newSpot" && e.reportId === r.locationReportId) || (r.kind === "effect" && r.reportType === "moved");
    if (pinned && !mayPin) fail(`${e.reportId} carries a pin the review does not adopt`);
    if (!pinned && mayPin) fail(`${e.reportId} lacks the pin the review adopts`);
  }
  if (r.locationReportId !== null && !ids.includes(r.locationReportId)) fail("the adopted location is not one of the evidence reports");
});
export type ArtifactContent = z.infer<typeof ArtifactContent>;

/** JSON with keys sorted at every level and no whitespace. Only plain JSON values are accepted. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`);
}

export interface SealedArtifact {
  bytes: Uint8Array;
  sha256: string;
  content: ArtifactContent;
}

/** Validates the content and returns its deterministic envelope bytes and digest. */
export async function sealArtifact(content: ArtifactContent): Promise<SealedArtifact> {
  const parsed = ArtifactContent.parse(content);
  const sha256 = await sha256Hex(canonicalJson(parsed));
  const bytes = new TextEncoder().encode(`${canonicalJson({ content: parsed, contentSha256: sha256 })}\n`);
  return { bytes, sha256, content: parsed };
}

export type OpenedArtifact = { ok: true; artifact: SealedArtifact } | { ok: false; reason: "malformed" | "digestMismatch" | "notCanonical"; detail: string };

/**
 * Parses artifact bytes and proves them: valid schema, a digest that matches the canonical content, and bytes that
 * are exactly the canonical encoding (so two encodings of one decision cannot both exist). Fails closed.
 */
export async function openArtifact(bytes: Uint8Array): Promise<OpenedArtifact> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return { ok: false, reason: "malformed", detail: "not UTF-8 JSON" };
  }
  const shape = z.object({ content: z.unknown(), contentSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict().safeParse(envelope);
  if (!shape.success) return { ok: false, reason: "malformed", detail: "envelope must be {content, contentSha256}" };
  const content = ArtifactContent.safeParse(shape.data.content);
  if (!content.success) {
    return { ok: false, reason: "malformed", detail: content.error.issues.map((i) => `${i.path.join(".") || "content"}: ${i.message}`).join("; ") };
  }
  const sealed = await sealArtifact(content.data);
  if (sealed.sha256 !== shape.data.contentSha256) return { ok: false, reason: "digestMismatch", detail: "contentSha256 does not match the content" };
  if (sealed.bytes.length !== bytes.length || sealed.bytes.some((b, i) => b !== bytes[i])) {
    return { ok: false, reason: "notCanonical", detail: "bytes are not the canonical encoding of their content" };
  }
  return { ok: true, artifact: sealed };
}
