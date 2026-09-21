// POST /v1/reports request and response (docs/API.md, ADR-0007).
// The request schema is the payload-minimization boundary: it is strict, so a field nobody
// reviewed is rejected rather than silently ignored, and every optional field is allowed only for
// the report types that need it.
//
// Two request versions exist, and a deployment accepts exactly one of them (ADR-0007 §6):
//   - schemaVersion 1: the unattested report, accepted only where attestation is disabled;
//   - schemaVersion 2: the attested submission, accepted only where App Attest is required. Its
//     envelope carries the report payload as exact bytes (base64) plus the App Attest assertion
//     over those bytes; the payload decodes to the same fields as v1 with schemaVersion 2.

import { z } from "zod";
import { SPOT_ID } from "../spot-id.ts";
import type { AttestationConfig } from "./attestation.ts";

/** The unattested report request (and response) version. */
export const REPORT_SCHEMA_VERSION = 1;
/** The attested report submission (and response) version. */
export const ATTESTED_REPORT_SCHEMA_VERSION = 2;

/**
 * The closed range of report request versions a deployment accepts, which /v1/config publishes.
 * It is one version wide on purpose: a required deployment cannot accept an unattested v1 report,
 * and a disabled one has nothing to verify a v2 assertion against in a way that means anything.
 */
export function reportSchemaRange(config: AttestationConfig): { minimum: number; current: number } {
  const version = config.kind === "disabled" ? REPORT_SCHEMA_VERSION : ATTESTED_REPORT_SCHEMA_VERSION;
  return { minimum: version, current: version };
}

export const REPORT_TYPES = [
  "exists", "missing", "moved", "hoursChanged",
  "tobaccoTypeChanged", "accessChanged", "prohibited", "other",
] as const;

/** Report types that carry a proposed location; every other type must not send one. */
export const LOCATION_REPORT_TYPES: readonly string[] = ["missing", "moved"];

export const REPORT_NOTE_MAX = 280;
/** Report payloads larger than this are rejected before parsing (ADR-0007 §5): the v1 body, or the decoded v2 payload. */
export const REPORT_BODY_MAX_BYTES = 4096;
/**
 * A v2 envelope: the base64 payload (≤ 5464 characters for 4096 bytes) plus an assertion (a few
 * hundred bytes) and fixed fields. Larger envelopes are rejected before parsing.
 */
export const REPORT_SUBMISSION_MAX_BYTES = 8192;

export const REPORT_ID = /^rp_[0-9A-HJKMNP-TV-Z]{26}$/;

const proposedLocation = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

const reportFields = <V extends number>(version: V) => z.object({
  schemaVersion: z.literal(version),
  type: z.enum(REPORT_TYPES),
  spotId: z.string().regex(SPOT_ID).optional(),
  // The map pin being proposed, not the device's position (docs/API.md, ADR-0007 §3).
  proposedLocation: proposedLocation.optional(),
  // Day precision by contract, and a real calendar date: z.iso.date() rejects both a finer
  // timestamp and an impossible day such as 2026-02-31 or 2026-19-39 (leap years included).
  observedOn: z.iso.date().optional(),
  note: z.string().min(1).max(REPORT_NOTE_MAX).optional(),
  // Client-generated per install, used only to derive the hashed abuse key. Never stored as sent.
  installId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  // No `attestation` field: v1 is the unattested version, and in v2 attestation material travels
  // in the envelope, outside the signed payload (ADR-0007 §6).
}).strict().superRefine((r, ctx) => {
  const needsLocation = LOCATION_REPORT_TYPES.includes(r.type);
  if (r.type === "missing" && r.spotId !== undefined) {
    ctx.addIssue({ code: "custom", path: ["spotId"], message: "a missing report proposes a spot that has no id yet" });
  }
  if (r.type !== "missing" && r.spotId === undefined) {
    ctx.addIssue({ code: "custom", path: ["spotId"], message: "required for this report type" });
  }
  if (needsLocation && r.proposedLocation === undefined) {
    ctx.addIssue({ code: "custom", path: ["proposedLocation"], message: "required for this report type" });
  }
  if (!needsLocation && r.proposedLocation !== undefined) {
    ctx.addIssue({ code: "custom", path: ["proposedLocation"], message: "not accepted for this report type" });
  }
});

export const ReportRequestV1 = reportFields(REPORT_SCHEMA_VERSION);
/** The decoded payload of a v2 submission: the v1 fields, versioned 2 so the signed bytes say which protocol they belong to. */
export const ReportPayloadV2 = reportFields(ATTESTED_REPORT_SCHEMA_VERSION);

/** Canonical standard base64 is re-checked byte-exactly when decoded (src/attest/bytes.ts). */
const base64 = (maxLength: number) => z.string().min(4).max(maxLength).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const ReportSubmissionV2 = z.object({
  schemaVersion: z.literal(ATTESTED_REPORT_SCHEMA_VERSION),
  // The exact UTF-8 JSON bytes of a ReportPayloadV2, base64. These bytes — not a re-serialization
  // of them — are what the assertion binds (src/attest/binding.ts).
  payload: base64(Math.ceil(REPORT_BODY_MAX_BYTES / 3) * 4),
  attestation: z.object({
    keyId: base64(44),
    challenge: base64(44),
    assertion: base64(2048),
  }).strict(),
}).strict();

const accepted = <V extends number>(version: V) => z.object({
  schemaVersion: z.literal(version),
  reportId: z.string().regex(REPORT_ID),
  // Always pending: acceptance is a later human decision, never a response to a submission.
  state: z.literal("pending"),
  receivedAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/),
}).strict();

export const ReportAcceptedV1 = accepted(REPORT_SCHEMA_VERSION);
export const ReportAcceptedV2 = accepted(ATTESTED_REPORT_SCHEMA_VERSION);

export type ReportRequestV1 = z.infer<typeof ReportRequestV1>;
export type ReportPayloadV2 = z.infer<typeof ReportPayloadV2>;
export type ReportSubmissionV2 = z.infer<typeof ReportSubmissionV2>;
export type ReportAcceptedV1 = z.infer<typeof ReportAcceptedV1>;
export type ReportAcceptedV2 = z.infer<typeof ReportAcceptedV2>;

/**
 * Issue paths and codes only. A validation message must never echo a submitted value, because an
 * error string is a log line waiting to happen (ADR-0007 §7).
 */
export function validationDetail(error: z.ZodError): string {
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "(body)" : issue.path.join(".");
    seen.add(`${path}: ${issue.code}`);
  }
  return [...seen].sort().join("; ");
}

/** ~1 m, the precision canonical spot data already carries (ADR-0007 §3). */
export function quantizeCoordinate(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
