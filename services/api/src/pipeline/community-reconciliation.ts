// Community report reconciliation (ADR-0007 §2, NATIONWIDE_DATA_STRATEGY §8, Issue #123; migrations 0020, 0025): the
// step that turns a reviewed new-spot decision into evidence through the ordinary pipeline, never by writing
// canonical rows from a report.
//
// The decision itself is made in the durable REPORTS_DB (src/reports/review.ts, ADR-0014): that is where the reports
// and their submitter keys live, so that is where independence is judged. It reaches this canonical database only as
// a sanitized artifact, imported by src/pipeline/community-artifact.ts as a proposed application. Here:
//
//   applyCommunityApplication      writes the sanitized single-record release of the userReport source and
//                                  resolves it; the application moves to `applied` in the same batch, whose
//                                  triggers re-check every premise against the imported evidence (0025).
//   withdrawCommunityApplication   terminal; its evidence can never back another application.
//
// No threshold here decides publication. The source is blocked (Issue #124); publication and the cross-source
// workflow stay exactly the ordinary ones.

import { type Db, isoSeconds } from "../db.ts";
import { withinJapan } from "../geo/japan.ts";
import { commonTermsVersion } from "../reports/review.ts";
import { type AgreedClaims, COMMUNITY_ADAPTER, COMMUNITY_SOURCE_ID, communityArtifact } from "./community-adapter.ts";
import { ingestRelease } from "./ingest.ts";
import { ensureReviewedSource } from "./registry.ts";
import { resolveFirstRelease } from "./resolve.ts";

export { commonTermsVersion };
export const COMMUNITY_RECONCILIATION_VERSION = "community-reconciliation.v1";
/** "Corroboration across independent evidence" (strategy §8): more than one submitter. Not a publication threshold. */
export const MIN_INDEPENDENT_REPORTS = 2;
/** The tier rule a new application declares (migration 0023, ADR-0012). */
export const COMMUNITY_TIER_RULE_VERSION = "community-tiers.v1";
export type CommunityTier = "communityReported" | "communityVerified";

export class CommunityReconciliationError extends Error {}

/** A sanitized evidence row (migration 0025): no note, submitter key, observation date or receipt time exists. */
export interface EvidenceRow {
  report_id: string;
  report_type: string;
  proposed_latitude: number | null;
  proposed_longitude: number | null;
  usable_until: string;
  accepted_terms_version: string | null;
  claim_spot_type: AgreedClaims["spotType"] | null;
  claim_spot_subtype: AgreedClaims["spotSubtype"];
  claim_access_type: AgreedClaims["accessType"] | null;
  claim_access_detail: AgreedClaims["accessDetail"];
  claim_host_type: AgreedClaims["hostType"];
  claim_environment: AgreedClaims["environment"] | null;
  claim_supports_paper: AgreedClaims["supportsPaper"] | null;
  claim_supports_heated: AgreedClaims["supportsHeated"] | null;
}

/** The imported evidence of an application, in report-ID order. */
export async function applicationEvidence(db: Db, evidenceTable: string, applicationId: string): Promise<EvidenceRow[]> {
  const { results } = await db.prepare(
    `SELECT r.report_id, r.report_type, r.proposed_latitude, r.proposed_longitude, r.usable_until, r.accepted_terms_version,
            r.claim_spot_type, r.claim_spot_subtype, r.claim_access_type, r.claim_access_detail, r.claim_host_type,
            r.claim_environment, r.claim_supports_paper, r.claim_supports_heated
     FROM ${evidenceTable} e JOIN community_evidence_reports r ON r.report_id = e.report_id
     WHERE e.application_id = ? ORDER BY r.report_id`,
  ).bind(applicationId).all<EvidenceRow>();
  return results;
}

/** The attested independence of an imported review (community_artifact_ledger). */
export async function attestedIndependence(db: Db, applicationId: string): Promise<{ evidence: number; submitters: number }> {
  const row = await db.prepare("SELECT evidence_count, independent_submitters FROM community_artifact_ledger WHERE review_id = ?")
    .bind(applicationId).first<{ evidence_count: number; independent_submitters: number }>();
  if (!row) throw new CommunityReconciliationError(`community: ${applicationId} was not imported from a reviewed artifact`);
  return { evidence: row.evidence_count, submitters: row.independent_submitters };
}

/** Evidence may back a canonical change only on days before its usable_until day. */
export const usable = (row: { usable_until: string }, now: string) => now.slice(0, 10) < row.usable_until;

function assertPremises(rows: readonly EvidenceRow[], attested: { evidence: number; submitters: number }, now: string, tier: CommunityTier): void {
  if (rows.length === 0 || rows.length !== attested.evidence) throw new CommunityReconciliationError("community: the imported evidence is incomplete");
  if (tier === "communityVerified" && (rows.length < MIN_INDEPENDENT_REPORTS || attested.submitters !== rows.length)) {
    throw new CommunityReconciliationError(`community: ${attested.submitters} independent submitter(s) behind ${rows.length} report(s); a communityVerified spot needs at least ${MIN_INDEPENDENT_REPORTS}, one each`);
  }
  if (tier === "communityReported") {
    if (rows.length !== 1) throw new CommunityReconciliationError(`community: a communityReported spot rests on exactly one report, got ${rows.length}`);
    if (rows[0].accepted_terms_version === null) throw new CommunityReconciliationError(`community: report ${rows[0].report_id} has no terms consent`);
    if (rows[0].claim_spot_type === null || rows[0].claim_spot_type === "unknown") {
      throw new CommunityReconciliationError(`community: report ${rows[0].report_id} states no known spot type`);
    }
  }
  for (const r of rows) {
    if (r.report_type !== "missing") throw new CommunityReconciliationError(`community: report ${r.report_id} is ${r.report_type}, not a new-spot proposal`);
    if (!usable(r, now)) throw new CommunityReconciliationError(`community: report ${r.report_id} is past its minimization deadline`);
  }
}

/**
 * community-reconciliation.agreedClaims: a field takes a value only when every report that states it states the same
 * value; no statement, or any disagreement, leaves it unknown. Nothing is ever inferred from a host business: a
 * convenience store or a café is only a host, never evidence of a spot type or of smoking being permitted.
 */
export function agreedClaims(rows: readonly Omit<EvidenceRow, "report_id" | "report_type" | "proposed_latitude" | "proposed_longitude" | "usable_until" | "accepted_terms_version">[]): AgreedClaims {
  const agreed = <T>(values: readonly (T | null)[]): T | null => {
    const stated = new Set(values.filter((v) => v !== null && v !== "unknown"));
    return stated.size === 1 ? [...stated][0] as T : null;
  };
  const spotType = agreed(rows.map((r) => r.claim_spot_type)) ?? "unknown";
  const accessType = agreed(rows.map((r) => r.claim_access_type)) ?? "unknown";
  // A refinement survives only with the value it refines.
  const spotSubtype = spotType === "unknown" ? null : agreed(rows.map((r) => r.claim_spot_subtype));
  const accessDetail = accessType === "facilityOnly" ? agreed(rows.map((r) => r.claim_access_detail)) : null;
  return {
    spotType,
    spotSubtype: spotSubtype !== null && compatibleSubtype(spotType, spotSubtype) ? spotSubtype : null,
    accessType,
    accessDetail,
    hostType: agreed(rows.map((r) => r.claim_host_type)),
    environment: agreed(rows.map((r) => r.claim_environment)) ?? "unknown",
    supportsPaper: agreed(rows.map((r) => r.claim_supports_paper)) ?? "unknown",
    supportsHeated: agreed(rows.map((r) => r.claim_supports_heated)) ?? "unknown",
  };
}

/** The 0023 spots_refinements_consistent rule, so an incompatible pair is dropped rather than refused at resolve. */
function compatibleSubtype(spotType: AgreedClaims["spotType"], subtype: NonNullable<AgreedClaims["spotSubtype"]>): boolean {
  return subtype === "tobaccoShopSmokingSpace"
    ? ["smokingPermittedVenue", "facilitySmokingRoom", "ashtray"].includes(spotType)
    : ["designatedOutdoorArea", "facilitySmokingRoom", "ashtray"].includes(spotType);
}

interface ApplicationRow {
  application_id: string;
  location_report_id: string;
  reconciliation_version: string;
  state: "proposed" | "applied" | "withdrawn";
  release_id: number | null;
  evidence_tier: CommunityTier | null;
}

async function readApplication(db: Db, applicationId: string): Promise<ApplicationRow> {
  const row = await db.prepare(
    `SELECT application_id, location_report_id, reconciliation_version, state, release_id, evidence_tier
     FROM community_reconciliation_applications WHERE application_id = ?`,
  ).bind(applicationId).first<ApplicationRow>();
  if (!row) throw new CommunityReconciliationError(`community: application ${applicationId} does not exist`);
  return row;
}

export type ApplyResult =
  | { status: "applied"; releaseId: number; spotId: string }
  | { status: "alreadyApplied"; releaseId: number };

/**
 * Applies a proposed (imported) application. Every premise is checked before anything is written (a stale application
 * writes nothing), then again by the 0020/0025 triggers inside the one batch that writes the canonical spot, the
 * applied release and the applied application — all of it or none of it. The reports themselves were marked
 * applied in REPORTS_DB when their review was exported; nothing here touches a report store. The only write
 * outside that batch is the ingest of the sanitized release: raw evidence that is not canonical, is never
 * applied without its application, and is re-used unchanged by a retry.
 */
export async function applyCommunityApplication(
  db: Db, applicationId: string, opts: { now: Date; newSpotId?: () => string },
): Promise<ApplyResult> {
  const application = await readApplication(db, applicationId);
  if (application.state === "applied") return { status: "alreadyApplied", releaseId: application.release_id! };
  if (application.state === "withdrawn") throw new CommunityReconciliationError(`community: application ${applicationId} was withdrawn`);

  const now = isoSeconds(opts.now);
  const premises = await applicationEvidence(db, "community_reconciliation_evidence", applicationId);
  const reportIds = premises.map((p) => p.report_id);
  // A legacy (pre-0023) application is a two-submitter decision, so it resolves as communityVerified.
  const tier = application.evidence_tier ?? "communityVerified";
  const attested = await attestedIndependence(db, applicationId);
  assertPremises(premises, attested, now, tier);
  const independentSubmitters = attested.submitters;
  const pin = premises.find((p) => p.report_id === application.location_report_id);
  if (!pin || pin.proposed_latitude === null) throw new CommunityReconciliationError(`community: application ${applicationId}'s location report is not its evidence`);
  // Coordinate sanity (ADR-0012): the API checks only the global range; a pin outside Japan is not a place here.
  if (!withinJapan(pin.proposed_latitude, pin.proposed_longitude!)) throw new CommunityReconciliationError(`community: report ${pin.report_id}'s pin is outside Japan`);

  await ensureReviewedSource(db, COMMUNITY_SOURCE_ID, now);
  const bytes = communityArtifact({
    applicationId, latitude: pin.proposed_latitude!, longitude: pin.proposed_longitude!, reportIds,
    version: application.reconciliation_version, termsVersion: commonTermsVersion(premises),
    tier, independentSubmitters, claims: agreedClaims(premises),
  });
  // No observation date: the reports' own dates are personal and minimized after 90 days (ADR-0007 §4), and
  // the review date is not an observation, so lastVerifiedAt stays unknown (ADR-0006).
  const { releaseId } = await ingestRelease(db, COMMUNITY_ADAPTER, bytes, {
    sourceUrl: `urn:mannerpath:community-reconciliation:${applicationId}`, observedOn: null, fetchedAt: now, httpLastModified: null,
  });

  const guards = [
    db.prepare(
      `UPDATE community_reconciliation_applications SET state = 'applied', release_id = ?, applied_at = ?,
         independent_submitters = CASE WHEN evidence_tier IS NULL THEN NULL ELSE ? END
       WHERE application_id = ? AND state = 'proposed'`,
    ).bind(releaseId, now, independentSubmitters, applicationId),
  ];
  const result = await resolveFirstRelease(db, COMMUNITY_ADAPTER, releaseId, { now, newSpotId: opts.newSpotId, guards });
  if (result.status !== "resolved" || result.spotIds.length !== 1) {
    throw new CommunityReconciliationError(`community: release ${releaseId} did not resolve to one spot (${result.status})`);
  }
  return { status: "applied", releaseId, spotId: result.spotIds[0] };
}

export async function withdrawCommunityApplication(db: Db, applicationId: string, opts: { now: Date }): Promise<void> {
  const application = await readApplication(db, applicationId);
  if (application.state !== "proposed") {
    throw new CommunityReconciliationError(`community: application ${applicationId} is ${application.state}; only a proposed one can be withdrawn`);
  }
  await db.prepare(
    "UPDATE community_reconciliation_applications SET state = 'withdrawn', withdrawn_at = ? WHERE application_id = ?",
  ).bind(isoSeconds(opts.now), applicationId).run();
}
