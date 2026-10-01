// Community review in the durable REPORTS_DB (ADR-0014). Everything here runs against REPORTS_DB only and never
// against the canonical DATA_DB: the reports, their submitter keys and their moderation live here, so this is where
// a reviewer decides and where independence of submitters is judged. The output of a decision is a sanitized,
// deterministic evidence artifact (./evidence-artifact.ts) — the only thing the canonical pipeline ever sees.
//
//   listNewSpotCandidates  read-only grouping of queued `missing` reports (explicit radius, no default)
//   proposeNewSpotReview   these reports, at this report's pin, as this evidence tier (ADR-0012)
//   proposeEffectReview    these reports, all of one type about one spot, back the one effect that type allows; an
//                          `exists` confirmation of a communityReported spot names the spot's own evidence reports
//                          (baseReportIds) so independence over both can be attested
//   proposeAbsenceReview   these notFound/removed reports about one spot (ADR-0013)
//   withdrawReview         terminal; its reports never back another review
//   exportReview           seals the artifact and, in one batch, marks the review exported and its reports applied.
//                          Re-exporting an exported review regenerates byte-identical bytes or fails closed.
//
// A review names a spot only as an opaque reference; whether it still names a live canonical spot is checked by the
// canonical import (src/pipeline/community-artifact.ts), which fails closed and asks for a re-review if not.

import { type Db, isoSeconds } from "../db.ts";
import { withinJapan } from "../geo/japan.ts";
import { haversineMeters } from "../geo/distance.ts";
import {
  ARTIFACT_KIND, ARTIFACT_SCHEMA_VERSION, type ArtifactContent, type ArtifactEvidence, INDEPENDENCE_VERSION, REPORT_STORE_SCHEMA,
  type SealedArtifact, sealArtifact,
} from "./evidence-artifact.ts";

export const NEW_SPOT_RULE_VERSION = "community-reconciliation.v1";
export const EFFECT_RULE_VERSION = "community-effects.v1";
export const ABSENCE_RULE_VERSION = "community-absence.v1";
/** "Corroboration across independent evidence" (strategy §8): more than one submitter. */
export const MIN_INDEPENDENT_REPORTS = 2;

export type CommunityTier = "communityReported" | "communityVerified";
export type ReviewKind = "newSpot" | "effect" | "absence";

/** The only effect each existing-spot report type can lead to (Issue #127). `other` has none. */
export const COMMUNITY_EFFECTS = {
  moved: "relocationReview",
  prohibited: "publicationHoldReview",
  hoursChanged: "hoursReview",
  accessChanged: "accessReview",
  tobaccoTypeChanged: "tobaccoTypeReview",
  exists: "existenceVerification",
} as const;
export type EffectReportType = keyof typeof COMMUNITY_EFFECTS;
export const NEGATIVE_FINDINGS = ["notFound", "removed"] as const;

export class ReviewError extends Error {}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** prefix + "_" + 26 Crockford base32 characters from a CSPRNG, the report-ID shape in its own namespace. */
export function newReviewId(prefix: "ca" | "ce" | "cn"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `${prefix}_${out}`;
}

interface PremiseRow {
  report_id: string;
  report_type: string;
  finding: string | null;
  subject_spot_id: string | null;
  proposed_latitude: number | null;
  proposed_longitude: number | null;
  submitter_hash: string | null;
  minimize_after: string;
  redacted_at: string | null;
  accepted_terms_version: string | null;
  state: string | null;
  reconciliation_state: string | null;
  linked_review_id: string | null;
  claim_spot_type: string | null;
  claim_spot_subtype: string | null;
  claim_access_type: string | null;
  claim_access_detail: string | null;
  claim_host_type: string | null;
  claim_environment: string | null;
  claim_supports_paper: string | null;
  claim_supports_heated: string | null;
}

async function readPremises(db: Db, reportIds: readonly string[]): Promise<PremiseRow[]> {
  const rows: PremiseRow[] = [];
  for (const id of reportIds) {
    const row = await db.prepare(
      `SELECT r.report_id, r.report_type, r.finding, r.subject_spot_id, r.proposed_latitude, r.proposed_longitude, r.submitter_hash,
              r.minimize_after, r.redacted_at, r.accepted_terms_version, m.state, m.reconciliation_state, e.review_id AS linked_review_id,
              r.claim_spot_type, r.claim_spot_subtype, r.claim_access_type, r.claim_access_detail, r.claim_host_type,
              r.claim_environment, r.claim_supports_paper, r.claim_supports_heated
       FROM reports r LEFT JOIN report_moderation m ON m.report_id = r.report_id
       LEFT JOIN report_review_evidence e ON e.report_id = r.report_id
       WHERE r.report_id = ?`,
    ).bind(id).first<PremiseRow>();
    if (!row) throw new ReviewError(`review: report ${id} does not exist`);
    rows.push(row);
  }
  return rows;
}

/** Premises every review shares. Messages name report IDs, types and states only, never content or submitter. */
function assertCommon(rows: readonly PremiseRow[], now: string, reviewId: string | null): void {
  if (rows.length === 0) throw new ReviewError("review: at least one report is required");
  for (const r of rows) {
    if (r.redacted_at !== null || r.submitter_hash === null) throw new ReviewError(`review: report ${r.report_id} is redacted; its proposal no longer exists`);
    if (r.minimize_after <= now) throw new ReviewError(`review: report ${r.report_id} is past its minimization deadline`);
    if (r.state !== "accepted") throw new ReviewError(`review: report ${r.report_id} is ${r.state}, not accepted`);
    if (r.reconciliation_state !== "queued") throw new ReviewError(`review: report ${r.report_id} is ${r.reconciliation_state}, not queued`);
    if (r.linked_review_id !== reviewId) throw new ReviewError(`review: report ${r.report_id} already backs review ${r.linked_review_id}`);
  }
}

const distinctSubmitters = (rows: readonly { submitter_hash: string | null }[]) => new Set(rows.map((r) => r.submitter_hash)).size;

function assertNewSpot(rows: readonly PremiseRow[], tier: CommunityTier): void {
  if (tier === "communityVerified" && rows.length < MIN_INDEPENDENT_REPORTS) {
    throw new ReviewError(`review: ${rows.length} report(s); a communityVerified spot needs at least ${MIN_INDEPENDENT_REPORTS}`);
  }
  if (tier === "communityReported") {
    if (rows.length !== 1) throw new ReviewError(`review: a communityReported spot rests on exactly one report, got ${rows.length}`);
    if (rows[0].accepted_terms_version === null) throw new ReviewError(`review: report ${rows[0].report_id} has no terms consent`);
    // A host business alone is not a smoking place: the reporter must say what the smoking place is.
    if (rows[0].claim_spot_type === null || rows[0].claim_spot_type === "unknown") throw new ReviewError(`review: report ${rows[0].report_id} states no known spot type`);
  }
  for (const r of rows) {
    if (r.report_type !== "missing") throw new ReviewError(`review: report ${r.report_id} is ${r.report_type}, not a new-spot proposal`);
    if (r.proposed_latitude === null || !withinJapan(r.proposed_latitude, r.proposed_longitude!)) {
      throw new ReviewError(`review: report ${r.report_id}'s pin is outside Japan`);
    }
  }
  if (distinctSubmitters(rows) !== rows.length) throw new ReviewError("review: two reports come from the same submitter; they are not independent evidence");
}

function assertEffect(rows: readonly PremiseRow[]): { spotId: string; reportType: EffectReportType } {
  const types = new Set(rows.map((r) => r.report_type));
  const spots = new Set(rows.map((r) => r.subject_spot_id));
  if (types.size !== 1) throw new ReviewError("review: every report must be of the same type");
  if (spots.size !== 1) throw new ReviewError("review: every report must name the same spot");
  const [reportType] = types;
  if (!Object.hasOwn(COMMUNITY_EFFECTS, reportType)) {
    throw new ReviewError(`review: ${reportType} reports have no automatic effect; they are reviewed in the moderation queue only`);
  }
  return { spotId: [...spots][0]!, reportType: reportType as EffectReportType };
}

function assertAbsence(rows: readonly PremiseRow[]): string {
  const spots = new Set(rows.map((r) => r.subject_spot_id));
  if (spots.size !== 1) throw new ReviewError("review: every report must name the same spot");
  for (const r of rows) {
    if (r.report_type !== "other" || !NEGATIVE_FINDINGS.includes(r.finding as (typeof NEGATIVE_FINDINGS)[number])) {
      throw new ReviewError(`review: report ${r.report_id} is not a notFound/removed finding`);
    }
  }
  return [...spots][0]!;
}

function sortedUnique(reportIds: readonly string[]): string[] {
  const sorted = [...reportIds].sort();
  if (new Set(sorted).size !== sorted.length) throw new ReviewError("review: a report is named twice");
  return sorted;
}

async function insertReview(db: Db, row: {
  reviewId: string; kind: ReviewKind; key: string; ruleVersion: string; subjectSpotId: string | null; reportType: string | null;
  tier: CommunityTier | null; locationReportId: string | null; baseReportIds: string | null; decidedBy: string; now: string;
}, reportIds: readonly string[]): Promise<void> {
  const version = await db.prepare("SELECT coalesce(max(decision_version), 0) + 1 AS v FROM report_reviews WHERE review_key = ?")
    .bind(row.key).first<{ v: number }>();
  await db.batch([
    db.prepare(
      `INSERT INTO report_reviews (review_id, review_kind, review_key, decision_version, rule_version, subject_spot_id, report_type,
         evidence_tier, location_report_id, base_report_ids, decided_by, decided_at, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed')`,
    ).bind(row.reviewId, row.kind, row.key, version!.v, row.ruleVersion, row.subjectSpotId, row.reportType, row.tier,
      row.locationReportId, row.baseReportIds, row.decidedBy, row.now),
    ...reportIds.map((id) => db.prepare("INSERT INTO report_review_evidence (report_id, review_id) VALUES (?, ?)").bind(id, row.reviewId)),
  ]);
}

export interface NewSpotReviewInput {
  reportIds: readonly string[];
  /** Defaults to communityVerified, the only tier before ADR-0012. */
  tier?: CommunityTier;
  /** One of reportIds: its pin becomes the spot's location, exactly as submitted. Averaging is not a decision. */
  locationReportId: string;
  decidedBy: string;
  now: Date;
  newReviewId?: () => string;
}

export async function proposeNewSpotReview(db: Db, input: NewSpotReviewInput): Promise<string> {
  const reportIds = sortedUnique(input.reportIds);
  if (!reportIds.includes(input.locationReportId)) throw new ReviewError("review: the adopted location must be one of the review's reports");
  const now = isoSeconds(input.now);
  const tier = input.tier ?? "communityVerified";
  const rows = await readPremises(db, reportIds);
  assertCommon(rows, now, null);
  assertNewSpot(rows, tier);
  const reviewId = (input.newReviewId ?? (() => newReviewId("ca")))();
  await insertReview(db, {
    reviewId, kind: "newSpot", key: `newSpot:${input.locationReportId}`, ruleVersion: NEW_SPOT_RULE_VERSION, subjectSpotId: null,
    reportType: null, tier, locationReportId: input.locationReportId, baseReportIds: null, decidedBy: input.decidedBy, now,
  }, reportIds);
  return reviewId;
}

export interface EffectReviewInput {
  reportIds: readonly string[];
  decidedBy: string;
  now: Date;
  /**
   * `exists` only, to confirm a communityReported spot (ADR-0012): the report IDs behind that spot exactly as the
   * canonical database lists them (community_spot_evidence_reports). Independence over them and the confirmations is
   * judged here and attested in the artifact; the canonical import re-checks that the list is the spot's own.
   */
  baseReportIds?: readonly string[];
  newReviewId?: () => string;
}

export async function proposeEffectReview(db: Db, input: EffectReviewInput): Promise<{ reviewId: string; effect: (typeof COMMUNITY_EFFECTS)[EffectReportType] }> {
  const reportIds = sortedUnique(input.reportIds);
  const now = isoSeconds(input.now);
  const rows = await readPremises(db, reportIds);
  assertCommon(rows, now, null);
  const { spotId, reportType } = assertEffect(rows);
  let base: string | null = null;
  if (input.baseReportIds !== undefined) {
    if (reportType !== "exists") throw new ReviewError("review: only an exists confirmation names the spot's base evidence");
    const baseIds = sortedUnique(input.baseReportIds);
    if (baseIds.length === 0 || baseIds.some((id) => reportIds.includes(id))) throw new ReviewError("review: the base evidence is the spot's own, separate reports");
    await independenceOverBase(db, baseIds, rows);
    base = baseIds.join(" ");
  }
  const reviewId = (input.newReviewId ?? (() => newReviewId("ce")))();
  await insertReview(db, {
    reviewId, kind: "effect", key: `effect:${spotId}:${reportType}`, ruleVersion: EFFECT_RULE_VERSION, subjectSpotId: spotId,
    reportType, tier: null, locationReportId: null, baseReportIds: base, decidedBy: input.decidedBy, now,
  }, reportIds);
  return { reviewId, effect: COMMUNITY_EFFECTS[reportType] };
}

export async function proposeAbsenceReview(
  db: Db, input: { reportIds: readonly string[]; decidedBy: string; now: Date; newReviewId?: () => string },
): Promise<string> {
  const reportIds = sortedUnique(input.reportIds);
  const now = isoSeconds(input.now);
  const rows = await readPremises(db, reportIds);
  assertCommon(rows, now, null);
  const spotId = assertAbsence(rows);
  const reviewId = (input.newReviewId ?? (() => newReviewId("cn")))();
  await insertReview(db, {
    reviewId, kind: "absence", key: `absence:${spotId}`, ruleVersion: ABSENCE_RULE_VERSION, subjectSpotId: spotId,
    reportType: null, tier: null, locationReportId: null, baseReportIds: null, decidedBy: input.decidedBy, now,
  }, reportIds);
  return reviewId;
}

/**
 * Distinct submitters over (base ∪ confirmations), compared while every key still exists. A redacted base report can
 * no longer prove independence, and a confirmation by the spot's own reporter adds nobody.
 */
async function independenceOverBase(db: Db, baseIds: readonly string[], confirmations: readonly PremiseRow[]): Promise<{ base: number; after: number }> {
  const keys: (string | null)[] = [];
  for (const id of baseIds) {
    const row = await db.prepare("SELECT submitter_hash, redacted_at FROM reports WHERE report_id = ?").bind(id)
      .first<{ submitter_hash: string | null; redacted_at: string | null }>();
    if (!row) throw new ReviewError(`review: base report ${id} does not exist in this report store`);
    if (row.redacted_at !== null || row.submitter_hash === null) throw new ReviewError(`review: base report ${id} is redacted; independence can no longer be shown`);
    keys.push(row.submitter_hash);
  }
  const base = new Set(keys).size;
  const after = new Set([...keys, ...confirmations.map((c) => c.submitter_hash)]).size;
  if (after <= base) throw new ReviewError("review: the confirmation comes from the original submitter; it is not independent evidence");
  return { base, after };
}

interface ReviewRow {
  review_id: string;
  review_kind: ReviewKind;
  review_key: string;
  decision_version: number;
  rule_version: string;
  subject_spot_id: string | null;
  report_type: EffectReportType | null;
  evidence_tier: CommunityTier | null;
  location_report_id: string | null;
  base_report_ids: string | null;
  decided_by: string;
  decided_at: string;
  state: "proposed" | "exported" | "withdrawn";
  artifact_sha256: string | null;
}

async function readReview(db: Db, reviewId: string): Promise<ReviewRow> {
  const row = await db.prepare(
    `SELECT review_id, review_kind, review_key, decision_version, rule_version, subject_spot_id, report_type, evidence_tier,
            location_report_id, base_report_ids, decided_by, decided_at, state, artifact_sha256
     FROM report_reviews WHERE review_id = ?`,
  ).bind(reviewId).first<ReviewRow>();
  if (!row) throw new ReviewError(`review: ${reviewId} does not exist`);
  return row;
}

async function linkedReportIds(db: Db, reviewId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT report_id FROM report_review_evidence WHERE review_id = ? ORDER BY report_id")
    .bind(reviewId).all<{ report_id: string }>();
  return results.map((r) => r.report_id);
}

export async function withdrawReview(db: Db, reviewId: string, opts: { now: Date }): Promise<void> {
  const review = await readReview(db, reviewId);
  if (review.state !== "proposed") throw new ReviewError(`review: ${reviewId} is ${review.state}; only a proposed one can be withdrawn`);
  await db.prepare("UPDATE report_reviews SET state = 'withdrawn', withdrawn_at = ? WHERE review_id = ? AND state = 'proposed'")
    .bind(isoSeconds(opts.now), reviewId).run();
}

/** The one terms version every report consented to, or null: a report without consent, or mixed versions, is no basis. */
export function commonTermsVersion(rows: readonly { accepted_terms_version: string | null }[]): string | null {
  const versions = new Set(rows.map((r) => r.accepted_terms_version));
  const [only] = versions;
  return versions.size === 1 && only !== null && only !== undefined ? only : null;
}

async function storeSchema(db: Db): Promise<string> {
  const row = await db.prepare("SELECT value FROM report_store_meta WHERE key = 'schema'").first<{ value: string }>();
  if (row?.value !== REPORT_STORE_SCHEMA) throw new ReviewError(`review: this database is not a ${REPORT_STORE_SCHEMA} report store`);
  return row.value;
}

/** The artifact content of a review over its (unredacted) reports. Depends on the review state only, never on the clock. */
async function artifactContent(db: Db, review: ReviewRow, rows: readonly PremiseRow[]): Promise<ArtifactContent> {
  const baseIds = review.base_report_ids === null ? null : review.base_report_ids.split(" ");
  const independence = baseIds === null
    ? { base: null, after: null }
    : await independenceOverBase(db, baseIds, rows);
  const evidence: ArtifactEvidence[] = rows.map((r) => {
    const pinned = (review.review_kind === "newSpot" && r.report_id === review.location_report_id)
      || (review.review_kind === "effect" && review.report_type === "moved");
    return {
      reportId: r.report_id,
      reportType: r.report_type as ArtifactEvidence["reportType"],
      finding: r.finding as ArtifactEvidence["finding"],
      subjectSpotId: r.subject_spot_id,
      latitude: pinned ? r.proposed_latitude : null,
      longitude: pinned ? r.proposed_longitude : null,
      acceptedTermsVersion: r.accepted_terms_version,
      claims: {
        spotType: r.claim_spot_type, spotSubtype: r.claim_spot_subtype, accessType: r.claim_access_type, accessDetail: r.claim_access_detail,
        hostType: r.claim_host_type, environment: r.claim_environment, supportsPaper: r.claim_supports_paper, supportsHeated: r.claim_supports_heated,
      } as ArtifactEvidence["claims"],
      // Day precision: the minimization deadline's day, never the receipt time.
      usableUntil: r.minimize_after.slice(0, 10),
    };
  });
  return {
    artifact: ARTIFACT_KIND,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    reportStoreSchema: (await storeSchema(db)) as typeof REPORT_STORE_SCHEMA,
    review: {
      reviewId: review.review_id, kind: review.review_kind, reviewKey: review.review_key, decisionVersion: review.decision_version,
      ruleVersion: review.rule_version as ArtifactContent["review"]["ruleVersion"], decidedBy: review.decided_by, decidedAt: review.decided_at,
      subjectSpotId: review.subject_spot_id, reportType: review.report_type, evidenceTier: review.evidence_tier, locationReportId: review.location_report_id,
    },
    termsVersion: commonTermsVersion(rows),
    independence: {
      version: INDEPENDENCE_VERSION, evidenceCount: rows.length, independentSubmitters: distinctSubmitters(rows),
      baseReportIds: baseIds, baseIndependentSubmitters: independence.base, confirmationsAfter: independence.after,
    },
    evidence,
  };
}

export type ExportResult = { status: "exported" | "reExported"; artifact: SealedArtifact };

/**
 * Seals a proposed review's artifact and, in one batch whose triggers re-check every premise, marks the review
 * exported (with the digest) and its reports applied. An exported review is re-sealed from the same state and must
 * reproduce the recorded digest byte for byte; once its evidence is minimized it cannot be regenerated at all.
 */
export async function exportReview(db: Db, reviewId: string, opts: { now: Date }): Promise<ExportResult> {
  const review = await readReview(db, reviewId);
  if (review.state === "withdrawn") throw new ReviewError(`review: ${reviewId} was withdrawn`);
  const now = isoSeconds(opts.now);
  const reportIds = await linkedReportIds(db, reviewId);
  const rows = await readPremises(db, reportIds);
  if (review.state === "exported") {
    if (rows.some((r) => r.redacted_at !== null)) throw new ReviewError(`review: ${reviewId}'s evidence is minimized; its artifact can no longer be regenerated`);
    const artifact = await sealArtifact(await artifactContent(db, review, rows));
    if (artifact.sha256 !== review.artifact_sha256) throw new ReviewError(`review: ${reviewId} no longer reproduces its exported artifact ${review.artifact_sha256}`);
    return { status: "reExported", artifact };
  }
  assertCommon(rows, now, reviewId);
  if (review.review_kind === "newSpot") assertNewSpot(rows, review.evidence_tier!);
  else if (review.review_kind === "effect") assertEffect(rows);
  else assertAbsence(rows);
  const artifact = await sealArtifact(await artifactContent(db, review, rows));
  await db.batch([
    db.prepare("UPDATE report_reviews SET state = 'exported', artifact_sha256 = ?, exported_at = ? WHERE review_id = ? AND state = 'proposed'")
      .bind(artifact.sha256, now, reviewId),
    ...reportIds.map((id) => db.prepare("UPDATE report_moderation SET reconciliation_state = 'applied', updated_at = ? WHERE report_id = ?").bind(now, id)),
  ]);
  return { status: "exported", artifact };
}

export interface NewSpotCandidateGroup {
  reportIds: string[];
  pins: { reportId: string; latitude: number; longitude: number }[];
  /** How many distinct submitters stand behind the group. The keys themselves are never returned. */
  distinctSubmitters: number;
  maxPairDistanceMetres: number;
  commonTermsVersion: string | null;
}

/**
 * Queued, accepted, unredacted, unreviewed `missing` reports, grouped by single linkage within `withinMetres`. A
 * reading aid for the reviewer, not a decision.
 */
export async function listNewSpotCandidates(db: Db, opts: { withinMetres: number; now: Date }): Promise<NewSpotCandidateGroup[]> {
  if (!Number.isFinite(opts.withinMetres) || opts.withinMetres <= 0) throw new ReviewError("review: an explicit positive grouping radius in metres is required");
  const { results } = await db.prepare(
    `SELECT r.report_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude, r.submitter_hash, r.accepted_terms_version
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'missing' AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?
       AND m.state = 'accepted' AND m.reconciliation_state = 'queued'
       AND NOT EXISTS (SELECT 1 FROM report_review_evidence e WHERE e.report_id = r.report_id)
     ORDER BY r.report_id`,
  ).bind(isoSeconds(opts.now)).all<{ report_id: string; latitude: number; longitude: number; submitter_hash: string; accepted_terms_version: string | null }>();
  const parent = results.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) if (haversineMeters(results[i], results[j]) <= opts.withinMetres) parent[root(j)] = root(i);
  }
  const groups = new Map<number, typeof results>();
  results.forEach((r, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), r]));
  return [...groups.values()].map((members) => {
    let max = 0;
    for (const a of members) for (const b of members) max = Math.max(max, haversineMeters(a, b));
    return {
      reportIds: members.map((m) => m.report_id),
      pins: members.map((m) => ({ reportId: m.report_id, latitude: m.latitude, longitude: m.longitude })),
      distinctSubmitters: distinctSubmitters(members),
      maxPairDistanceMetres: Math.round(max * 10) / 10,
      commonTermsVersion: commonTermsVersion(members),
    };
  });
}

export interface ReviewQueueRow {
  reviewId: string;
  kind: ReviewKind;
  reviewKey: string;
  decisionVersion: number;
  state: ReviewRow["state"];
  subjectSpotId: string | null;
  reportType: string | null;
  reportCount: number;
  /** Distinct submitters behind the still-unredacted reports. A count only. */
  independentSubmitters: number;
  artifactSha256: string | null;
}

/** Every review with counts and states only: safe to paste into a ticket (no note, pin, date or submitter key). */
export async function listReviews(db: Db): Promise<ReviewQueueRow[]> {
  const { results } = await db.prepare(
    `SELECT v.review_id, v.review_kind, v.review_key, v.decision_version, v.state, v.subject_spot_id, v.report_type, v.artifact_sha256,
            count(e.report_id) AS n, count(DISTINCT r.submitter_hash) AS submitters
     FROM report_reviews v LEFT JOIN report_review_evidence e ON e.review_id = v.review_id LEFT JOIN reports r ON r.report_id = e.report_id
     GROUP BY v.review_id ORDER BY v.decided_at, v.review_id`,
  ).all<{ review_id: string; review_kind: ReviewKind; review_key: string; decision_version: number; state: ReviewRow["state"];
    subject_spot_id: string | null; report_type: string | null; artifact_sha256: string | null; n: number; submitters: number }>();
  return results.map((r) => ({
    reviewId: r.review_id, kind: r.review_kind, reviewKey: r.review_key, decisionVersion: r.decision_version, state: r.state,
    subjectSpotId: r.subject_spot_id, reportType: r.report_type, reportCount: r.n, independentSubmitters: r.submitters, artifactSha256: r.artifact_sha256,
  }));
}

export interface ExistingSpotQueueRow {
  spotId: string;
  reportType: string;
  /** The finding of an `other` report (notFound, removed, wrongType), or null. */
  finding: string | null;
  /** The effect this group could become, or null (`other` without a negative finding: moderation only). */
  effect: string | null;
  reportCount: number;
  /** Distinct submitters behind the still-unredacted reports. A count only, never a key. */
  independentSubmitters: number;
  redactedOrStale: number;
  /** The terms version every report consented to, or null: without one nothing here can ever publish. */
  commonTermsVersion: string | null;
}

/**
 * Accepted, queued existing-spot reports that no review backs yet, grouped by (spot, type, finding): what a reviewer
 * could propose next. Counts and states only. Whether the spot is still live, and whether the rights hold, is a
 * canonical question answered at import and hold time.
 */
export async function listExistingSpotQueue(db: Db, opts: { now: Date }): Promise<ExistingSpotQueueRow[]> {
  const now = isoSeconds(opts.now);
  const { results } = await db.prepare(
    `SELECT r.subject_spot_id, r.report_type, r.finding, r.submitter_hash, r.redacted_at, r.minimize_after, r.accepted_terms_version
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type <> 'missing' AND m.state = 'accepted' AND m.reconciliation_state = 'queued'
       AND NOT EXISTS (SELECT 1 FROM report_review_evidence e WHERE e.report_id = r.report_id)
     ORDER BY r.subject_spot_id, r.report_type, r.finding, r.report_id`,
  ).all<{ subject_spot_id: string; report_type: string; finding: string | null; submitter_hash: string | null; redacted_at: string | null;
    minimize_after: string; accepted_terms_version: string | null }>();
  const groups = new Map<string, typeof results>();
  for (const r of results) {
    const key = `${r.subject_spot_id}\n${r.report_type}\n${r.finding ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((members) => {
    const first = members[0];
    const negative = first.report_type === "other" && NEGATIVE_FINDINGS.includes(first.finding as (typeof NEGATIVE_FINDINGS)[number]);
    return {
      spotId: first.subject_spot_id,
      reportType: first.report_type,
      finding: first.finding,
      effect: Object.hasOwn(COMMUNITY_EFFECTS, first.report_type) ? COMMUNITY_EFFECTS[first.report_type as EffectReportType] : negative ? "absenceReview" : null,
      reportCount: members.length,
      independentSubmitters: new Set(members.map((m) => m.submitter_hash).filter((h) => h !== null)).size,
      redactedOrStale: members.filter((m) => m.redacted_at !== null || m.minimize_after <= now).length,
      commonTermsVersion: commonTermsVersion(members),
    };
  });
}
