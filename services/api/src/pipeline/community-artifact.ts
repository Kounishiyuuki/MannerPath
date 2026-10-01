// Importing a sanitized community evidence artifact into the canonical DATA_DB (ADR-0014 §10–16). The artifact is
// the only input from the durable REPORTS_DB; this module never reads a report store.
//
// Import is NOT application: it verifies the artifact, records it in the append-only ledger, stores its sanitized
// evidence rows and creates the proposed application (same ID as the review), all in one batch. Nothing canonical or
// published changes until the reviewer applies that application with the existing apply/hold/upgrade steps, whose
// triggers (migration 0025) re-check every premise against this evidence and the ledger.
//
// Replay protection, decided before anything is written and enforced again by the ledger's constraints:
//   same bytes already imported                       -> alreadyImported (no write; idempotent)
//   another digest for an already-imported review     -> conflict        (refused)
//   decision version <= one imported for the same key -> stale           (refused)
//   the canonical premise no longer holds             -> refused         (re-review in REPORTS_DB)
// A rejected artifact changes nothing.

import { type Db, isoSeconds } from "../db.ts";
import { type ArtifactContent, openArtifact } from "../reports/evidence-artifact.ts";
import { REPORT_TERMS, type ReviewedTerms, ensureTermsStatement } from "../reports/terms.ts";
import { COMMUNITY_TIER_RULE_VERSION } from "./community-reconciliation.ts";

export type ImportResult =
  | { status: "imported"; reviewId: string; sha256: string; kind: ArtifactContent["review"]["kind"] }
  | { status: "alreadyImported"; reviewId: string; sha256: string }
  | { status: "conflict"; reviewId: string; sha256: string; importedSha256: string }
  | { status: "stale"; reviewId: string; reviewKey: string; decisionVersion: number; importedDecisionVersion: number }
  | { status: "refused"; reason: RefusalReason; detail: string };

export type RefusalReason =
  | "malformed" | "digestMismatch" | "notCanonical" | "spotNotLive" | "spotMerged" | "baseMismatch" | "evidenceAlreadyUsed" | "unknownTerms";

/**
 * Verifies and imports one artifact. Every refusal is a value, not an exception, so a batch import can report each
 * file; an unexpected database error still throws (and, being one batch, writes nothing).
 */
export async function importCommunityArtifact(
  db: Db, bytes: Uint8Array,
  opts: { now: Date; /** Resolves a consented terms version; only tests replace it, to simulate a future approved version. */ reviewedTerms?: (version: string) => ReviewedTerms | undefined },
): Promise<ImportResult> {
  const opened = await openArtifact(bytes);
  if (!opened.ok) return { status: "refused", reason: opened.reason, detail: opened.detail };
  const { content, sha256 } = opened.artifact;
  const review = content.review;

  const same = await db.prepare("SELECT review_id FROM community_artifact_ledger WHERE artifact_sha256 = ?").bind(sha256).first<{ review_id: string }>();
  if (same) return { status: "alreadyImported", reviewId: same.review_id, sha256 };
  const sameReview = await db.prepare("SELECT artifact_sha256 FROM community_artifact_ledger WHERE review_id = ?")
    .bind(review.reviewId).first<{ artifact_sha256: string }>();
  if (sameReview) return { status: "conflict", reviewId: review.reviewId, sha256, importedSha256: sameReview.artifact_sha256 };
  const newer = await db.prepare("SELECT max(decision_version) AS v FROM community_artifact_ledger WHERE review_key = ?")
    .bind(review.reviewKey).first<{ v: number | null }>();
  if (newer?.v != null && newer.v >= review.decisionVersion) {
    return { status: "stale", reviewId: review.reviewId, reviewKey: review.reviewKey, decisionVersion: review.decisionVersion, importedDecisionVersion: newer.v };
  }
  const used = await reportsAlreadyEvidence(db, content.evidence.map((e) => e.reportId));
  if (used !== null) return { status: "refused", reason: "evidenceAlreadyUsed", detail: `report ${used} already backs an imported review` };
  const premise = await canonicalPremise(db, content);
  if (premise !== null) return premise;
  // Consent names a reviewed document; its canonical mirror row (rights included) comes from the reviewed list in code,
  // never from the artifact, so an artifact can neither invent a terms version nor carry rights.
  const versions = [...new Set(content.evidence.map((e) => e.acceptedTermsVersion).filter((v): v is string => v !== null))].sort();
  const resolve = opts.reviewedTerms ?? ((v: string) => REPORT_TERMS.find((t) => t.version === v));
  const terms = versions.map(resolve);
  const unknown = versions.find((_, k) => terms[k] === undefined);
  if (unknown !== undefined) return { status: "refused", reason: "unknownTerms", detail: `terms version ${unknown} is not a reviewed terms version` };

  const now = isoSeconds(opts.now);
  const i = content.independence;
  await db.batch([
    ...terms.map((t) => ensureTermsStatement(db, t!, now)),
    db.prepare(
      `INSERT INTO community_artifact_ledger (artifact_sha256, artifact_schema_version, report_store_schema, review_id, review_kind, review_key,
         decision_version, rule_version, terms_version, independence_version, evidence_count, independent_submitters, base_report_ids,
         base_independent_submitters, confirmations_after, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(sha256, content.artifactSchemaVersion, content.reportStoreSchema, review.reviewId, review.kind, review.reviewKey,
      review.decisionVersion, review.ruleVersion, content.termsVersion, i.version, i.evidenceCount, i.independentSubmitters,
      i.baseReportIds === null ? null : JSON.stringify(i.baseReportIds), i.baseIndependentSubmitters, i.confirmationsAfter, now),
    ...content.evidence.map((e) => db.prepare(
      `INSERT INTO community_evidence_reports (report_id, artifact_sha256, review_id, report_type, finding, subject_spot_id, proposed_latitude,
         proposed_longitude, accepted_terms_version, claim_spot_type, claim_spot_subtype, claim_access_type, claim_access_detail, claim_host_type,
         claim_environment, claim_supports_paper, claim_supports_heated, usable_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(e.reportId, sha256, review.reviewId, e.reportType, e.finding, e.subjectSpotId, e.latitude, e.longitude, e.acceptedTermsVersion,
      e.claims.spotType, e.claims.spotSubtype, e.claims.accessType, e.claims.accessDetail, e.claims.hostType, e.claims.environment,
      e.claims.supportsPaper, e.claims.supportsHeated, e.usableUntil)),
    applicationStatement(db, content),
    ...content.evidence.map((e) => db.prepare(`INSERT INTO ${EVIDENCE_TABLE[review.kind]} (report_id, application_id) VALUES (?, ?)`)
      .bind(e.reportId, review.reviewId)),
  ]);
  return { status: "imported", reviewId: review.reviewId, sha256, kind: review.kind };
}

const EVIDENCE_TABLE = {
  newSpot: "community_reconciliation_evidence",
  effect: "community_effect_evidence",
  absence: "community_absence_evidence",
} as const;

const EFFECTS: Record<string, string> = {
  moved: "relocationReview", prohibited: "publicationHoldReview", hoursChanged: "hoursReview",
  accessChanged: "accessReview", tobaccoTypeChanged: "tobaccoTypeReview", exists: "existenceVerification",
};

function applicationStatement(db: Db, content: ArtifactContent) {
  const r = content.review;
  if (r.kind === "newSpot") {
    return db.prepare(
      `INSERT INTO community_reconciliation_applications
         (application_id, claim_type, location_report_id, reconciliation_version, decided_by, decided_at, state, evidence_tier, tier_rule_version)
       VALUES (?, 'newSpot', ?, ?, ?, ?, 'proposed', ?, ?)`,
    ).bind(r.reviewId, r.locationReportId, r.ruleVersion, r.decidedBy, r.decidedAt, r.evidenceTier, COMMUNITY_TIER_RULE_VERSION);
  }
  if (r.kind === "effect") {
    return db.prepare(
      `INSERT INTO community_effect_applications (application_id, subject_spot_id, report_type, effect, effect_version, decided_by, decided_at, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')`,
    ).bind(r.reviewId, r.subjectSpotId, r.reportType, EFFECTS[r.reportType!], r.ruleVersion, r.decidedBy, r.decidedAt);
  }
  return db.prepare(
    `INSERT INTO community_absence_applications (application_id, subject_spot_id, review_version, decided_by, decided_at, state)
     VALUES (?, ?, ?, ?, ?, 'proposed')`,
  ).bind(r.reviewId, r.subjectSpotId, r.ruleVersion, r.decidedBy, r.decidedAt);
}

async function reportsAlreadyEvidence(db: Db, reportIds: readonly string[]): Promise<string | null> {
  for (const id of reportIds) {
    if (await db.prepare("SELECT 1 AS n FROM community_evidence_reports WHERE report_id = ?").bind(id).first()) return id;
  }
  return null;
}

/**
 * The canonical premises an existing-spot review was decided on. The spot reference is opaque in REPORTS_DB, so here
 * it must still name a live, unmerged canonical spot; a merged spot answers with its successor so the reviewer can
 * re-review against the current identity — the old decision is never silently redirected.
 */
async function canonicalPremise(db: Db, content: ArtifactContent): Promise<ImportResult | null> {
  const r = content.review;
  if (r.subjectSpotId === null) return null;
  const spot = await db.prepare("SELECT merged_into, lifecycle, evidence_quality, community_confirmations FROM spots WHERE spot_id = ?")
    .bind(r.subjectSpotId).first<{ merged_into: string | null; lifecycle: string; evidence_quality: string; community_confirmations: number | null }>();
  if (!spot) return { status: "refused", reason: "spotNotLive", detail: `${r.subjectSpotId} is not a canonical spot here; re-review` };
  if (spot.merged_into !== null) {
    return { status: "refused", reason: "spotMerged", detail: `${r.subjectSpotId} was merged into ${spot.merged_into}; re-review against the current spot` };
  }
  const base = content.independence.baseReportIds;
  if (base !== null) {
    const { results } = await db.prepare("SELECT report_id FROM community_spot_evidence_reports WHERE spot_id = ? ORDER BY report_id")
      .bind(r.subjectSpotId).all<{ report_id: string }>();
    const own = results.map((x) => x.report_id);
    if (spot.lifecycle !== "active" || spot.evidence_quality !== "communityReported" || spot.community_confirmations !== content.independence.baseIndependentSubmitters
      || own.length !== base.length || own.some((id, k) => id !== base[k])) {
      return { status: "refused", reason: "baseMismatch", detail: `${r.subjectSpotId} is no longer the communityReported spot this confirmation was reviewed against; re-review` };
    }
  }
  return null;
}

/** Imported artifacts, newest first. Digests, review identities and counts only. */
export async function listImportedArtifacts(db: Db): Promise<{
  sha256: string; reviewId: string; kind: string; reviewKey: string; decisionVersion: number; evidenceCount: number;
  independentSubmitters: number; termsVersion: string | null; importedAt: string;
}[]> {
  const { results } = await db.prepare(
    `SELECT artifact_sha256, review_id, review_kind, review_key, decision_version, evidence_count, independent_submitters, terms_version, imported_at
     FROM community_artifact_ledger ORDER BY imported_at DESC, review_id`,
  ).all<{ artifact_sha256: string; review_id: string; review_kind: string; review_key: string; decision_version: number; evidence_count: number;
    independent_submitters: number; terms_version: string | null; imported_at: string }>();
  return results.map((r) => ({
    sha256: r.artifact_sha256, reviewId: r.review_id, kind: r.review_kind, reviewKey: r.review_key, decisionVersion: r.decision_version,
    evidenceCount: r.evidence_count, independentSubmitters: r.independent_submitters, termsVersion: r.terms_version, importedAt: r.imported_at,
  }));
}

/**
 * The report IDs behind a community spot (its applied new-spot application's evidence), sorted. The reviewer passes
 * these to REPORTS_DB as the base of an `exists` confirmation (src/reports/review.ts), so independence over the spot's
 * own evidence and the confirmation can be judged where the submitter keys exist. IDs only: no other report data
 * exists here.
 */
export async function spotEvidenceReportIds(db: Db, spotId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT report_id FROM community_spot_evidence_reports WHERE spot_id = ? ORDER BY report_id")
    .bind(spotId).all<{ report_id: string }>();
  return results.map((r) => r.report_id);
}
