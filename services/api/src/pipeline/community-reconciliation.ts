// Community report reconciliation (ADR-0007 §2, NATIONWIDE_DATA_STRATEGY §8, Issue #123; migration 0020): the
// step that turns reviewed, queued new-spot reports into evidence through the ordinary pipeline, never by
// writing canonical rows from a report.
//
//   listCommunityCandidates        read-only grouping of queued `missing` reports for a reviewer. Needs an
//                                  explicit radius: no grouping distance is reviewed, so none is a default.
//   proposeCommunityApplication    a reviewer's immutable decision: these reports, at this report's pin, as this
//                                  evidence tier (ADR-0012): `communityVerified` needs >= 2 distinct submitters;
//                                  `communityReported` is ONE consented report with an explicit, known spot-type claim.
//                                  Changes nothing canonical.
//   applyCommunityApplication      writes the sanitized single-record release of the userReport source and
//                                  resolves it; the application and every report move to `applied` in the
//                                  same batch, whose triggers re-check every premise (0020).
//   withdrawCommunityApplication   terminal; its reports can never back another application.
//
// No threshold here decides publication. The source is blocked (Issue #124); publication and the cross-source
// workflow stay exactly the ordinary ones.

import { type Db, isoSeconds } from "../db.ts";
import { withinJapan } from "../geo/japan.ts";
import { distanceMetres } from "./cross-source.ts";
import { type AgreedClaims, COMMUNITY_ADAPTER, COMMUNITY_SOURCE_ID, communityArtifact } from "./community-adapter.ts";
import { ingestRelease } from "./ingest.ts";
import { ensureReviewedSource } from "./registry.ts";
import { resolveFirstRelease } from "./resolve.ts";

export const COMMUNITY_RECONCILIATION_VERSION = "community-reconciliation.v1";
/** "Corroboration across independent evidence" (strategy §8): more than one submitter. Not a publication threshold. */
export const MIN_INDEPENDENT_REPORTS = 2;
/** The tier rule a new application declares (migration 0023, ADR-0012). */
export const COMMUNITY_TIER_RULE_VERSION = "community-tiers.v1";
export type CommunityTier = "communityReported" | "communityVerified";

export class CommunityReconciliationError extends Error {}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** "ca_" + 26 Crockford base32 characters from a CSPRNG, the report-ID shape in its own namespace. */
export function newApplicationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `ca_${out}`;
}

interface PremiseRow {
  report_id: string;
  report_type: string;
  proposed_latitude: number | null;
  proposed_longitude: number | null;
  submitter_hash: string | null;
  minimize_after: string;
  redacted_at: string | null;
  state: string | null;
  reconciliation_state: string | null;
  linked_application_id: string | null;
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

async function readPremises(db: Db, reportIds: readonly string[]): Promise<PremiseRow[]> {
  const rows: PremiseRow[] = [];
  for (const id of reportIds) {
    const row = await db.prepare(
      `SELECT r.report_id, r.report_type, r.proposed_latitude, r.proposed_longitude, r.submitter_hash, r.minimize_after,
              r.redacted_at, m.state, m.reconciliation_state, e.application_id AS linked_application_id, r.accepted_terms_version,
              r.claim_spot_type, r.claim_spot_subtype, r.claim_access_type, r.claim_access_detail, r.claim_host_type,
              r.claim_environment, r.claim_supports_paper, r.claim_supports_heated
       FROM reports r LEFT JOIN report_moderation m ON m.report_id = r.report_id
       LEFT JOIN community_reconciliation_evidence e ON e.report_id = r.report_id
       WHERE r.report_id = ?`,
    ).bind(id).first<PremiseRow>();
    if (!row) throw new CommunityReconciliationError(`community: report ${id} does not exist`);
    rows.push(row);
  }
  return rows;
}

/** The premises both propose and apply need. Messages name report IDs only, never content or submitter. */
function assertPremises(rows: readonly PremiseRow[], now: string, applicationId: string | null, tier: CommunityTier): void {
  if (tier === "communityVerified" && rows.length < MIN_INDEPENDENT_REPORTS) {
    throw new CommunityReconciliationError(`community: ${rows.length} report(s); a communityVerified spot needs at least ${MIN_INDEPENDENT_REPORTS}`);
  }
  if (tier === "communityReported") {
    if (rows.length !== 1) throw new CommunityReconciliationError(`community: a communityReported spot rests on exactly one report, got ${rows.length}`);
    // A single report carries no corroboration, so it must carry the rest explicitly (0023).
    if (rows[0].accepted_terms_version === null) throw new CommunityReconciliationError(`community: report ${rows[0].report_id} has no terms consent`);
    // A host business alone is not a smoking place: the reporter must say what the smoking place is.
    if (rows[0].claim_spot_type === null || rows[0].claim_spot_type === "unknown") {
      throw new CommunityReconciliationError(`community: report ${rows[0].report_id} states no known spot type`);
    }
  }
  for (const r of rows) {
    if (r.report_type !== "missing") throw new CommunityReconciliationError(`community: report ${r.report_id} is ${r.report_type}, not a new-spot proposal`);
    if (r.redacted_at !== null || r.submitter_hash === null || r.proposed_latitude === null) {
      throw new CommunityReconciliationError(`community: report ${r.report_id} is redacted; its proposal no longer exists`);
    }
    if (r.minimize_after <= now) throw new CommunityReconciliationError(`community: report ${r.report_id} is past its minimization deadline`);
    // Coordinate sanity (ADR-0012): the API checks only the global range; a pin outside Japan is not a place here.
    if (!withinJapan(r.proposed_latitude, r.proposed_longitude!)) {
      throw new CommunityReconciliationError(`community: report ${r.report_id}'s pin is outside Japan`);
    }
    if (r.state !== "accepted") throw new CommunityReconciliationError(`community: report ${r.report_id} is ${r.state}, not accepted`);
    if (r.reconciliation_state !== "queued") {
      throw new CommunityReconciliationError(`community: report ${r.report_id} is ${r.reconciliation_state}, not queued`);
    }
    if (r.linked_application_id !== applicationId) {
      throw new CommunityReconciliationError(`community: report ${r.report_id} already backs application ${r.linked_application_id}`);
    }
  }
  if (new Set(rows.map((r) => r.submitter_hash)).size !== rows.length) {
    throw new CommunityReconciliationError("community: two reports come from the same submitter; they are not independent evidence");
  }
}

/**
 * community-reconciliation.agreedClaims: a field takes a value only when every report that states it states the same
 * value; no statement, or any disagreement, leaves it unknown. Nothing is ever inferred from a host business: a
 * convenience store or a café is only a host, never evidence of a spot type or of smoking being permitted.
 */
export function agreedClaims(rows: readonly PremiseRow[]): AgreedClaims {
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

/**
 * The rights basis of a set of reports: the one terms version all of them accepted, or null. A report without
 * consent (every report stored before migration 0021) makes the whole set basis-less; nothing is inferred for it,
 * and mixing versions is not a basis either, because no single document covers every report.
 */
export function commonTermsVersion(rows: readonly { accepted_terms_version: string | null }[]): string | null {
  const versions = new Set(rows.map((r) => r.accepted_terms_version));
  const [only] = versions;
  return versions.size === 1 && only !== null && only !== undefined ? only : null;
}

export interface CommunityCandidateGroup {
  reportIds: string[];
  pins: { reportId: string; latitude: number; longitude: number }[];
  /** How many distinct submitters stand behind the group. The submitter keys themselves are never returned. */
  distinctSubmitters: number;
  maxPairDistanceMetres: number;
  /** The terms version every report in the group consented to, or null: a group without it can never publish (Issue #124). */
  commonTermsVersion: string | null;
}

/**
 * Queued, accepted, unredacted, unlinked `missing` reports, grouped by single linkage within `withinMetres`. A
 * reading aid for the reviewer, not a decision: nothing here is written, and a group is never applied as is.
 */
export async function listCommunityCandidates(db: Db, opts: { withinMetres: number; now: Date }): Promise<CommunityCandidateGroup[]> {
  if (!Number.isFinite(opts.withinMetres) || opts.withinMetres <= 0) {
    throw new CommunityReconciliationError("community: an explicit positive grouping radius in metres is required");
  }
  const { results } = await db.prepare(
    `SELECT r.report_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude, r.submitter_hash, r.accepted_terms_version
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'missing' AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?
       AND m.state = 'accepted' AND m.reconciliation_state = 'queued'
       AND NOT EXISTS (SELECT 1 FROM community_reconciliation_evidence e WHERE e.report_id = r.report_id)
     ORDER BY r.report_id`,
  ).bind(isoSeconds(opts.now)).all<{ report_id: string; latitude: number; longitude: number; submitter_hash: string; accepted_terms_version: string | null }>();

  const parent = results.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      if (distanceMetres(results[i], results[j]) <= opts.withinMetres) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, typeof results>();
  results.forEach((r, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), r]));
  return [...groups.values()].map((members) => {
    let max = 0;
    for (const a of members) for (const b of members) max = Math.max(max, distanceMetres(a, b));
    return {
      reportIds: members.map((m) => m.report_id),
      pins: members.map((m) => ({ reportId: m.report_id, latitude: m.latitude, longitude: m.longitude })),
      distinctSubmitters: new Set(members.map((m) => m.submitter_hash)).size,
      maxPairDistanceMetres: Math.round(max * 10) / 10,
      commonTermsVersion: commonTermsVersion(members),
    };
  });
}

export interface ProposeInput {
  reportIds: readonly string[];
  /** The evidence tier the reviewer decides. Defaults to communityVerified, the only tier before ADR-0012. */
  tier?: CommunityTier;
  /** One of reportIds: its pin becomes the spot's location, exactly as submitted (rounded to ~1 m by the API). */
  locationReportId: string;
  decidedBy: string;
  now: Date;
  newApplicationId?: () => string;
}

export async function proposeCommunityApplication(db: Db, input: ProposeInput): Promise<string> {
  const reportIds = [...input.reportIds].sort();
  if (new Set(reportIds).size !== reportIds.length) throw new CommunityReconciliationError("community: a report is named twice");
  if (!reportIds.includes(input.locationReportId)) {
    throw new CommunityReconciliationError("community: the adopted location must be one of the application's reports");
  }
  const now = isoSeconds(input.now);
  const tier = input.tier ?? "communityVerified";
  assertPremises(await readPremises(db, reportIds), now, null, tier);
  const applicationId = (input.newApplicationId ?? newApplicationId)();
  await db.batch([
    db.prepare(
      `INSERT INTO community_reconciliation_applications
         (application_id, claim_type, location_report_id, reconciliation_version, decided_by, decided_at, state,
          evidence_tier, tier_rule_version)
       VALUES (?, 'newSpot', ?, ?, ?, ?, 'proposed', ?, ?)`,
    ).bind(applicationId, input.locationReportId, COMMUNITY_RECONCILIATION_VERSION, input.decidedBy, now, tier, COMMUNITY_TIER_RULE_VERSION),
    ...reportIds.map((id) => db.prepare(
      "INSERT INTO community_reconciliation_evidence (report_id, application_id) VALUES (?, ?)",
    ).bind(id, applicationId)),
  ]);
  return applicationId;
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
 * Applies a proposed application. Every premise is checked before anything is written (a stale application
 * writes nothing), then again by the 0020 triggers inside the one batch that writes the canonical spot, the
 * applied release, the applied application and the applied reports — all of it or none of it. The only write
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
  const { results: links } = await db.prepare(
    "SELECT report_id FROM community_reconciliation_evidence WHERE application_id = ? ORDER BY report_id",
  ).bind(applicationId).all<{ report_id: string }>();
  const reportIds = links.map((l) => l.report_id);
  const premises = await readPremises(db, reportIds);
  // A legacy (pre-0023) application is a two-submitter decision, so it resolves as communityVerified. Its row keeps
  // no count (it declared no tier); the artifact records the count the premises prove.
  const tier = application.evidence_tier ?? "communityVerified";
  assertPremises(premises, now, applicationId, tier);
  const independentSubmitters = new Set(premises.map((p) => p.submitter_hash)).size;
  const pin = premises.find((p) => p.report_id === application.location_report_id);
  if (!pin) throw new CommunityReconciliationError(`community: application ${applicationId}'s location report is not its evidence`);

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
    ...reportIds.map((id) => db.prepare(
      "UPDATE report_moderation SET reconciliation_state = 'applied', updated_at = ? WHERE report_id = ?",
    ).bind(now, id)),
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
