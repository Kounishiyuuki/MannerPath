// Read-only community evidence views (ADR-0013). Nothing here writes; every output is a review aid made of counts,
// IDs, states and days, never a note, a submitter key or a reporter's own date. Four named rules, no score:
//
//   communityStage        reported -> visitedConfirmed -> communityVerified (the acquisition lifecycle)
//   spotEvidenceStates    normal / needsRecheck / reviewCandidate / held, plus a `conflicting` flag, from the order
//                         and independence of accepted positive and negative reports
//   correctionCandidates  "the place is elsewhere": pins from distinct submitters that agree -> relocation candidate
//   duplicateCandidates   "is this the place you mean?": a new-spot proposal near a live spot or another proposal
//
// Majority is never a rule: three "still there" reports do not outvote a newer "removed", and the reverse holds too.
// What decides is recency, independence, moderation and — outside this module — official evidence.
//
// Reports live in the durable REPORTS_DB and canonical spots in DATA_DB (ADR-0014), so the three report views take
// both databases and never join across them in SQL: they read reports from one and look canonical facts up in the
// other. They are moderation tools, not request paths. communityRelocationCandidates reads DATA_DB only.

import { type Db, isoSeconds } from "../db.ts";
import { haversineMeters } from "../geo/distance.ts";

export const COMMUNITY_EVIDENCE_RULES_VERSION = "community-evidence.v1";
/** Distinct submitters whose newer negative reports make a spot a reviewed-hold candidate. Same as a hold needs. */
export const NEGATIVE_REVIEW_SUBMITTERS = 2;
/** Pins from distinct submitters within this distance agree on a corrected location. */
export const CORRECTION_AGREEMENT_METRES = 30;
/** A new-spot proposal this close to a live spot or another proposal is shown to the reviewer as a duplicate candidate. */
export const DUPLICATE_RADIUS_METRES = 50;

// ---- lifecycle ---------------------------------------------------------------------------------------------------

export type CommunityStage = "reported" | "visitedConfirmed" | "communityVerified";

/**
 * The acquisition lifecycle of a community spot. The published tier (ADR-0012) stays two-valued; the stage only names
 * how a communityVerified spot got there:
 *   reported           one moderated report (tier communityReported);
 *   visitedConfirmed   a reported spot that one other, independent person confirmed on site (an applied `exists`
 *                      upgrade, two submitters in all);
 *   communityVerified  independent agreement beyond that: two submitters at creation, or three or more in all.
 * Repeated confirmations from one submitter never move a spot: the count is of distinct submitters (migration 0023).
 */
export function communityStage(spot: { existence: string; confirmations: number | null; upgradedByVisit: boolean }): CommunityStage | null {
  if (spot.existence === "communityReported") return "reported";
  if (spot.existence !== "communityVerified") return null;
  return spot.upgradedByVisit && (spot.confirmations ?? 0) <= 2 ? "visitedConfirmed" : "communityVerified";
}

// ---- positive / negative evidence --------------------------------------------------------------------------------

export type EvidenceState = "normal" | "needsRecheck" | "reviewCandidate" | "held";

export interface SpotEvidenceState {
  spotId: string;
  positiveReports: number;
  negativeReports: number;
  /** Negative reports newer than every positive report, and how many distinct submitters stand behind them. */
  negativesSinceLastPositive: number;
  independentNegativesSinceLastPositive: number;
  /** Fresh positive AND fresh negative reports from different submitters: a reviewer reads this spot first. */
  conflicting: boolean;
  state: EvidenceState;
}

interface EvidenceRow {
  spot_id: string;
  polarity: "positive" | "negative";
  received_at: string;
  submitter_hash: string | null;
  fresh: number;
}

/**
 * Per-spot state over accepted, not discarded `exists` (positive) and `notFound`/`removed` (negative) reports. The
 * day a report arrived orders them; that day is used here and never returned. Redacted reports still count as
 * reports but no longer as independent submitters (their key is gone).
 */
export async function spotEvidenceStates(reportsDb: Db, dataDb: Db, opts: { now: Date; spotIds?: readonly string[] }): Promise<SpotEvidenceState[]> {
  const now = isoSeconds(opts.now);
  const { results } = await reportsDb.prepare(
    `WITH evidence AS (
       SELECT r.subject_spot_id AS spot_id, r.report_type = 'exists' AS positive, r.received_at, r.submitter_hash,
              r.redacted_at IS NULL AND r.minimize_after > ? AS fresh
       FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
       WHERE m.state = 'accepted' AND m.reconciliation_state <> 'discarded' AND r.subject_spot_id IS NOT NULL
         AND (r.report_type = 'exists' OR (r.report_type = 'other' AND r.finding IN ('notFound', 'removed')))
         AND (? IS NULL OR r.subject_spot_id IN (SELECT value FROM json_each(?)))
     ), latest AS (SELECT spot_id, max(CASE WHEN positive THEN received_at END) AS last_positive FROM evidence GROUP BY spot_id)
     SELECT e.spot_id, sum(e.positive) AS positives, sum(NOT e.positive) AS negatives,
            sum(NOT e.positive AND (l.last_positive IS NULL OR e.received_at > l.last_positive)) AS since,
            count(DISTINCT CASE WHEN NOT e.positive AND (l.last_positive IS NULL OR e.received_at > l.last_positive) THEN e.submitter_hash END) AS independent_since,
            CASE WHEN count(CASE WHEN e.positive AND e.fresh THEN e.submitter_hash END) > 0
                      AND count(CASE WHEN NOT e.positive AND e.fresh THEN e.submitter_hash END) > 0
                      AND (min(CASE WHEN e.positive AND e.fresh THEN e.submitter_hash END) <> max(CASE WHEN NOT e.positive AND e.fresh THEN e.submitter_hash END)
                        OR max(CASE WHEN e.positive AND e.fresh THEN e.submitter_hash END) <> min(CASE WHEN NOT e.positive AND e.fresh THEN e.submitter_hash END))
                 THEN 1 ELSE 0 END AS conflicting
     FROM evidence e JOIN latest l ON l.spot_id = e.spot_id GROUP BY e.spot_id ORDER BY e.spot_id`,
  ).bind(now, opts.spotIds ? JSON.stringify(opts.spotIds) : null, opts.spotIds ? JSON.stringify(opts.spotIds) : null)
    .all<{ spot_id: string; positives: number; negatives: number; since: number; independent_since: number; conflicting: number }>();
  const held = new Set((await dataDb.prepare("SELECT spot_id FROM community_absence_holds WHERE lifted_at IS NULL AND (? IS NULL OR spot_id IN (SELECT value FROM json_each(?)))")
    .bind(opts.spotIds ? JSON.stringify(opts.spotIds) : null, opts.spotIds ? JSON.stringify(opts.spotIds) : null)
    .all<{ spot_id: string }>()).results.map((r) => r.spot_id));
  const out = results.map((r): SpotEvidenceState => ({
    spotId: r.spot_id, positiveReports: r.positives, negativeReports: r.negatives,
    negativesSinceLastPositive: r.since, independentNegativesSinceLastPositive: r.independent_since, conflicting: r.conflicting === 1,
    state: held.has(r.spot_id) ? "held" : r.independent_since >= NEGATIVE_REVIEW_SUBMITTERS ? "reviewCandidate" : r.since > 0 ? "needsRecheck" : "normal",
  }));
  const seen = new Set(out.map((r) => r.spotId));
  for (const id of held) if (!seen.has(id)) out.push(evidenceState(id, [], true));
  return out;

}

export function evidenceState(spotId: string, rows: readonly EvidenceRow[], isHeld: boolean): SpotEvidenceState {
  const positives = rows.filter((r) => r.polarity === "positive");
  const negatives = rows.filter((r) => r.polarity === "negative");
  const lastPositive = positives.reduce<string | null>((m, r) => (m === null || r.received_at > m ? r.received_at : m), null);
  const since = negatives.filter((r) => lastPositive === null || r.received_at > lastPositive);
  const independentSince = new Set(since.map((r) => r.submitter_hash).filter((h) => h !== null)).size;
  const freshPositive = positives.filter((r) => r.fresh === 1 && r.submitter_hash !== null);
  const freshNegative = negatives.filter((r) => r.fresh === 1 && r.submitter_hash !== null);
  const negativeHashes = new Set(freshNegative.map((n) => n.submitter_hash));
  const conflicting = freshPositive.some((p) => negativeHashes.size > 1 || (negativeHashes.size === 1 && !negativeHashes.has(p.submitter_hash)));
  const state: EvidenceState = isHeld ? "held"
    : independentSince >= NEGATIVE_REVIEW_SUBMITTERS ? "reviewCandidate"
    : since.length > 0 ? "needsRecheck"
    : "normal";
  return {
    spotId, positiveReports: positives.length, negativeReports: negatives.length,
    negativesSinceLastPositive: since.length, independentNegativesSinceLastPositive: independentSince, conflicting, state,
  };
}

// ---- location corrections ----------------------------------------------------------------------------------------

export interface CorrectionCandidate {
  spotId: string;
  reports: number;
  distinctSubmitters: number;
  /** The largest agreeing group of pins: its reports, how many distinct submitters, and how far apart they are. */
  agreeingReportIds: string[];
  agreeingSubmitters: number;
  maxPairDistanceMetres: number;
  /** How far the agreeing pins are from the canonical location (the first pin of the group; never an average). */
  distanceFromCurrentMetres: number | null;
  /**
   * awaitingIndependentConfirmation: one person says it is elsewhere — a recheck task, never a move;
   * relocationCandidate: independent pins agree — the reviewer takes it to relocation review (ADR-0009).
   */
  status: "awaitingIndependentConfirmation" | "relocationCandidate";
}

/** Accepted, fresh, unredacted `moved` reports per spot. A single correction never changes a canonical coordinate. */
export async function correctionCandidates(reportsDb: Db, dataDb: Db, opts: { now: Date; limit?: number; afterSpotId?: string }): Promise<CorrectionCandidate[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid correction limit");
  const { results: reports } = await reportsDb.prepare(
    `SELECT r.report_id, r.subject_spot_id AS spot_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude, r.submitter_hash
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'moved' AND m.state = 'accepted' AND m.reconciliation_state <> 'discarded'
       AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?
       AND r.subject_spot_id IN (
         SELECT DISTINCT q.subject_spot_id FROM reports q JOIN report_moderation qm ON qm.report_id = q.report_id
         WHERE q.report_type = 'moved' AND qm.state = 'accepted' AND qm.reconciliation_state <> 'discarded'
           AND q.redacted_at IS NULL AND q.proposed_latitude IS NOT NULL AND q.minimize_after > ? AND q.subject_spot_id > ?
         ORDER BY q.subject_spot_id LIMIT ?)
     ORDER BY r.subject_spot_id, r.report_id LIMIT 1001`,
  ).bind(isoSeconds(opts.now), isoSeconds(opts.now), opts.afterSpotId ?? "", limit).all<{ report_id: string; spot_id: string; latitude: number; longitude: number; submitter_hash: string }>();
  if (reports.length > 1000) throw new Error("correction page exceeds 1000 reports; reduce --limit or review this dense spot separately");
  const results = [];
  const canonical = new Map<string, { latitude: number; longitude: number } | null>();
  for (const r of reports) {
    // The opaque spot reference resolves against the current canonical database; an unknown one has no location.
    if (!canonical.has(r.spot_id)) canonical.set(r.spot_id, await dataDb.prepare("SELECT latitude, longitude FROM spots WHERE spot_id = ?").bind(r.spot_id).first<{ latitude: number; longitude: number }>());
    const s = canonical.get(r.spot_id);
    results.push({ ...r, spot_latitude: s?.latitude ?? null, spot_longitude: s?.longitude ?? null });
  }
  const bySpot = new Map<string, typeof results>();
  for (const r of results) {
    if (!bySpot.has(r.spot_id)) bySpot.set(r.spot_id, []);
    bySpot.get(r.spot_id)!.push(r);
  }
  const out: CorrectionCandidate[] = [];
  for (const [spotId, rows] of bySpot) {
    // For each pin, the pins that agree with it; the group with the most distinct submitters wins (ties: first).
    let best = [rows[0]];
    for (const a of rows) {
      const group = rows.filter((b) => haversineMeters(a, b) <= CORRECTION_AGREEMENT_METRES);
      if (new Set(group.map((g) => g.submitter_hash)).size > new Set(best.map((g) => g.submitter_hash)).size) best = group;
    }
    let max = 0;
    for (const a of best) for (const b of best) max = Math.max(max, haversineMeters(a, b));
    const agreeingSubmitters = new Set(best.map((g) => g.submitter_hash)).size;
    const current = rows[0].spot_latitude === null ? null : { latitude: rows[0].spot_latitude, longitude: rows[0].spot_longitude! };
    out.push({
      spotId, reports: rows.length, distinctSubmitters: new Set(rows.map((r) => r.submitter_hash)).size,
      agreeingReportIds: best.map((g) => g.report_id), agreeingSubmitters,
      maxPairDistanceMetres: Math.round(max * 10) / 10,
      distanceFromCurrentMetres: current === null ? null : Math.round(haversineMeters(current, best[0])),
      status: agreeingSubmitters >= 2 ? "relocationCandidate" : "awaitingIndependentConfirmation",
    });
  }
  return out;
}

// ---- duplicates --------------------------------------------------------------------------------------------------

export interface DuplicateCandidate {
  reportId: string;
  nearbySpots: { spotId: string; distanceMetres: number }[];
  nearbyReports: { reportId: string; distanceMetres: number }[];
  nearbySpotsTruncated: boolean;
  nearbyReportsTruncated: boolean;
}

/**
 * New-spot proposals (pending or accepted, not yet applied) with a live canonical spot or another proposal within
 * DUPLICATE_RADIUS_METRES. The reviewer decides; nothing is merged, and an existing spot nearby may well be a
 * different place (two ashtrays at one station).
 */
export async function duplicateCandidates(reportsDb: Db, dataDb: Db, opts: { now: Date; radiusMetres?: number; reportIds?: readonly string[]; limit?: number; afterReportId?: string }): Promise<DuplicateCandidate[]> {
  const radius = opts.radiusMetres ?? DUPLICATE_RADIUS_METRES;
  if (!Number.isFinite(radius) || radius <= 0 || radius > 1000) throw new Error("duplicate radius must be between 0 and 1000 metres");
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid duplicate limit");
  const { results: proposals } = await reportsDb.prepare(
    `SELECT r.report_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'missing' AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?
       AND m.state IN ('pending', 'accepted', 'needsInfo') AND m.reconciliation_state IN ('notQueued', 'queued')
       AND (? IS NULL OR r.report_id IN (SELECT value FROM json_each(?))) AND r.report_id > ?
     ORDER BY r.report_id LIMIT ?`,
  ).bind(isoSeconds(opts.now), opts.reportIds ? JSON.stringify(opts.reportIds) : null, opts.reportIds ? JSON.stringify(opts.reportIds) : null, opts.afterReportId ?? "", limit).all<{ report_id: string; latitude: number; longitude: number }>();
  if (proposals.length === 0) return [];
  // A degree of latitude is ~111 km; a generous box pre-filter keeps the haversine to nearby rows.
  const pad = (radius / 111_000) * 2;
  const out: DuplicateCandidate[] = [];
  for (const p of proposals) {
    const { results: spots } = await dataDb.prepare(
      `SELECT spot_id, latitude, longitude FROM spots
       WHERE merged_into IS NULL AND lifecycle = 'active' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY spot_id LIMIT 201`,
    ).bind(p.latitude - pad, p.latitude + pad, p.longitude - pad * 1.5, p.longitude + pad * 1.5)
      .all<{ spot_id: string; latitude: number; longitude: number }>();
    const nearbySpots = spots.slice(0, 200).map((s) => ({ spotId: s.spot_id, distanceMetres: Math.round(haversineMeters(p, s)) }))
      .filter((s) => s.distanceMetres <= radius).sort((a, b) => a.distanceMetres - b.distanceMetres);
    const { results: nearbyProposals } = await reportsDb.prepare(
      `SELECT r.report_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude
       FROM reports r INDEXED BY reports_proposal_spatial CROSS JOIN report_moderation m ON m.report_id = r.report_id
       WHERE r.report_type = 'missing' AND r.redacted_at IS NULL AND r.minimize_after > ? AND r.report_id <> ?
         AND r.proposed_latitude BETWEEN ? AND ? AND r.proposed_longitude BETWEEN ? AND ?
         AND m.state IN ('pending', 'accepted', 'needsInfo') AND m.reconciliation_state IN ('notQueued', 'queued')
       ORDER BY r.report_id LIMIT 201`,
    ).bind(isoSeconds(opts.now), p.report_id, p.latitude - pad, p.latitude + pad, p.longitude - pad * 1.5, p.longitude + pad * 1.5)
      .all<{ report_id: string; latitude: number; longitude: number }>();
    const nearbyReports = nearbyProposals.slice(0, 200).map((q) => ({ reportId: q.report_id, distanceMetres: Math.round(haversineMeters(p, q)) }))
      .filter((q) => q.distanceMetres <= radius).sort((a, b) => a.distanceMetres - b.distanceMetres || a.reportId.localeCompare(b.reportId));
    if (nearbySpots.length > 0 || nearbyReports.length > 0 || spots.length > 200 || nearbyProposals.length > 200) out.push({ reportId: p.report_id, nearbySpots, nearbyReports, nearbySpotsTruncated: spots.length > 200, nearbyReportsTruncated: nearbyProposals.length > 200 });
  }
  return out;
}

// ---- reviewed relocations (canonical side) ------------------------------------------------------------------------

export interface CommunityRelocationCandidate {
  applicationId: string;
  spotId: string;
  /** The reviewed pins (sanitized evidence of an applied relocationReview) and the attested distinct submitters. */
  pins: { reportId: string; latitude: number; longitude: number }[];
  independentSubmitters: number;
  distanceFromCurrentMetres: number | null;
  status: "awaitingIndependentConfirmation" | "relocationCandidate";
}

/**
 * Applied relocationReview effects, as the input to ADR-0009 relocation review. Nothing here moves a spot: a canonical
 * coordinate changes only through the reviewed relocation machinery, never from a report or an artifact.
 */
export async function communityRelocationCandidates(dataDb: Db): Promise<CommunityRelocationCandidate[]> {
  const { results: applications } = await dataDb.prepare(
    `SELECT a.application_id, a.subject_spot_id, l.independent_submitters, s.latitude, s.longitude
     FROM community_effect_applications a JOIN community_artifact_ledger l ON l.review_id = a.application_id
     LEFT JOIN spots s ON s.spot_id = a.subject_spot_id
     WHERE a.effect = 'relocationReview' AND a.state = 'applied' ORDER BY a.subject_spot_id, a.application_id`,
  ).all<{ application_id: string; subject_spot_id: string; independent_submitters: number; latitude: number | null; longitude: number | null }>();
  const out: CommunityRelocationCandidate[] = [];
  for (const a of applications) {
    const { results: pins } = await dataDb.prepare(
      `SELECT r.report_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude
       FROM community_effect_evidence e JOIN community_evidence_reports r ON r.report_id = e.report_id
       WHERE e.application_id = ? AND r.proposed_latitude IS NOT NULL ORDER BY r.report_id`,
    ).bind(a.application_id).all<{ report_id: string; latitude: number; longitude: number }>();
    const current = a.latitude === null ? null : { latitude: a.latitude, longitude: a.longitude! };
    out.push({
      applicationId: a.application_id, spotId: a.subject_spot_id,
      pins: pins.map((p) => ({ reportId: p.report_id, latitude: p.latitude, longitude: p.longitude })),
      independentSubmitters: a.independent_submitters,
      distanceFromCurrentMetres: current === null || pins.length === 0 ? null : Math.round(haversineMeters(current, pins[0])),
      status: a.independent_submitters >= 2 ? "relocationCandidate" : "awaitingIndependentConfirmation",
    });
  }
  return out;
}

/** Scanned rows, rather than candidate matches, advance the cursor even across empty candidate pages. */
export async function duplicateCandidatePage(reportsDb: Db, dataDb: Db, opts: { now: Date; limit?: number; cursor?: string }) {
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid duplicate limit");
  const rows = (await reportsDb.prepare(
    `SELECT r.report_id FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'missing' AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?
       AND m.state IN ('pending', 'accepted', 'needsInfo') AND m.reconciliation_state IN ('notQueued', 'queued')
       AND r.report_id > ? ORDER BY r.report_id LIMIT ?`,
  ).bind(isoSeconds(opts.now), opts.cursor ?? "", limit + 1).all<{ report_id: string }>()).results;
  const page = rows.slice(0, limit);
  return {
    items: await duplicateCandidates(reportsDb, dataDb, { now: opts.now, limit, reportIds: page.map((r) => r.report_id) }),
    scanned: page.length,
    nextCursor: rows.length > limit ? page.at(-1)!.report_id : null,
  };
}

export async function correctionCandidatePage(reportsDb: Db, dataDb: Db, opts: { now: Date; limit?: number; cursor?: string }) {
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid correction limit");
  const rows = (await reportsDb.prepare(
    `SELECT DISTINCT r.subject_spot_id AS spot_id FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'moved' AND m.state = 'accepted' AND m.reconciliation_state <> 'discarded'
       AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ? AND r.subject_spot_id > ?
     ORDER BY r.subject_spot_id LIMIT ?`,
  ).bind(isoSeconds(opts.now), opts.cursor ?? "", limit + 1).all<{ spot_id: string }>()).results;
  return { items: await correctionCandidates(reportsDb, dataDb, { now: opts.now, limit, afterSpotId: opts.cursor }),
    nextCursor: rows.length > limit ? rows[limit - 1].spot_id : null };
}

export async function evidenceStatePage(reportsDb: Db, dataDb: Db, opts: { now: Date; limit?: number; cursor?: string }) {
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid evidence limit");
  const reports = (await reportsDb.prepare(
    `SELECT DISTINCT r.subject_spot_id AS spot_id FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE m.state = 'accepted' AND m.reconciliation_state <> 'discarded' AND r.subject_spot_id > ?
       AND (r.report_type = 'exists' OR (r.report_type = 'other' AND r.finding IN ('notFound', 'removed')))
     ORDER BY r.subject_spot_id LIMIT ?`,
  ).bind(opts.cursor ?? "", limit + 1).all<{ spot_id: string }>()).results;
  const holds = (await dataDb.prepare("SELECT DISTINCT spot_id FROM community_absence_holds WHERE lifted_at IS NULL AND spot_id > ? ORDER BY spot_id LIMIT ?")
    .bind(opts.cursor ?? "", limit + 1).all<{ spot_id: string }>()).results;
  const ids = [...new Set([...reports, ...holds].map((r) => r.spot_id))].sort();
  return { items: await spotEvidenceStates(reportsDb, dataDb, { now: opts.now, spotIds: ids.slice(0, limit) }),
    nextCursor: ids.length > limit ? ids[limit - 1] : null };
}
