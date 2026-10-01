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
    `SELECT r.subject_spot_id AS spot_id,
            CASE WHEN r.report_type = 'exists' THEN 'positive' ELSE 'negative' END AS polarity,
            r.received_at, r.submitter_hash,
            CASE WHEN r.redacted_at IS NULL AND r.minimize_after > ? THEN 1 ELSE 0 END AS fresh
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE m.state = 'accepted' AND m.reconciliation_state <> 'discarded'
       AND (r.report_type = 'exists' OR (r.report_type = 'other' AND r.finding IN ('notFound', 'removed')))
     ORDER BY r.subject_spot_id, r.received_at, r.report_id`,
  ).bind(now).all<EvidenceRow>();
  const held = new Set((await dataDb.prepare("SELECT spot_id FROM community_absence_holds WHERE lifted_at IS NULL")
    .all<{ spot_id: string }>()).results.map((r) => r.spot_id));
  const bySpot = new Map<string, EvidenceRow[]>();
  for (const r of results) {
    if (opts.spotIds && !opts.spotIds.includes(r.spot_id)) continue;
    bySpot.set(r.spot_id, [...(bySpot.get(r.spot_id) ?? []), r]);
  }
  for (const id of held) if (!bySpot.has(id) && (!opts.spotIds || opts.spotIds.includes(id))) bySpot.set(id, []);
  return [...bySpot.entries()].map(([spotId, rows]) => evidenceState(spotId, rows, held.has(spotId)));
}

export function evidenceState(spotId: string, rows: readonly EvidenceRow[], isHeld: boolean): SpotEvidenceState {
  const positives = rows.filter((r) => r.polarity === "positive");
  const negatives = rows.filter((r) => r.polarity === "negative");
  const lastPositive = positives.reduce<string | null>((m, r) => (m === null || r.received_at > m ? r.received_at : m), null);
  const since = negatives.filter((r) => lastPositive === null || r.received_at > lastPositive);
  const independentSince = new Set(since.map((r) => r.submitter_hash).filter((h) => h !== null)).size;
  const freshPositive = positives.filter((r) => r.fresh === 1 && r.submitter_hash !== null);
  const freshNegative = negatives.filter((r) => r.fresh === 1 && r.submitter_hash !== null);
  const conflicting = freshPositive.some((p) => freshNegative.some((n) => n.submitter_hash !== p.submitter_hash));
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
export async function correctionCandidates(reportsDb: Db, dataDb: Db, opts: { now: Date }): Promise<CorrectionCandidate[]> {
  const { results: reports } = await reportsDb.prepare(
    `SELECT r.report_id, r.subject_spot_id AS spot_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude, r.submitter_hash
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'moved' AND m.state = 'accepted' AND m.reconciliation_state <> 'discarded'
       AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?
     ORDER BY r.subject_spot_id, r.report_id`,
  ).bind(isoSeconds(opts.now)).all<{ report_id: string; spot_id: string; latitude: number; longitude: number; submitter_hash: string }>();
  const results = [];
  for (const r of reports) {
    // The opaque spot reference resolves against the current canonical database; an unknown one has no location.
    const s = await dataDb.prepare("SELECT latitude, longitude FROM spots WHERE spot_id = ?").bind(r.spot_id).first<{ latitude: number; longitude: number }>();
    results.push({ ...r, spot_latitude: s?.latitude ?? null, spot_longitude: s?.longitude ?? null });
  }
  const bySpot = new Map<string, typeof results>();
  for (const r of results) bySpot.set(r.spot_id, [...(bySpot.get(r.spot_id) ?? []), r]);
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
}

/**
 * New-spot proposals (pending or accepted, not yet applied) with a live canonical spot or another proposal within
 * DUPLICATE_RADIUS_METRES. The reviewer decides; nothing is merged, and an existing spot nearby may well be a
 * different place (two ashtrays at one station).
 */
export async function duplicateCandidates(reportsDb: Db, dataDb: Db, opts: { now: Date; radiusMetres?: number }): Promise<DuplicateCandidate[]> {
  const radius = opts.radiusMetres ?? DUPLICATE_RADIUS_METRES;
  const { results: proposals } = await reportsDb.prepare(
    `SELECT r.report_id, r.proposed_latitude AS latitude, r.proposed_longitude AS longitude
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'missing' AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?
       AND m.state IN ('pending', 'accepted', 'needsInfo') AND m.reconciliation_state IN ('notQueued', 'queued')
     ORDER BY r.report_id`,
  ).bind(isoSeconds(opts.now)).all<{ report_id: string; latitude: number; longitude: number }>();
  if (proposals.length === 0) return [];
  // A degree of latitude is ~111 km; a generous box pre-filter keeps the haversine to nearby rows.
  const pad = (radius / 111_000) * 2;
  const out: DuplicateCandidate[] = [];
  for (const p of proposals) {
    const { results: spots } = await dataDb.prepare(
      `SELECT spot_id, latitude, longitude FROM spots
       WHERE merged_into IS NULL AND lifecycle = 'active' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`,
    ).bind(p.latitude - pad, p.latitude + pad, p.longitude - pad * 1.5, p.longitude + pad * 1.5)
      .all<{ spot_id: string; latitude: number; longitude: number }>();
    const nearbySpots = spots.map((s) => ({ spotId: s.spot_id, distanceMetres: Math.round(haversineMeters(p, s)) }))
      .filter((s) => s.distanceMetres <= radius).sort((a, b) => a.distanceMetres - b.distanceMetres);
    const nearbyReports = proposals.filter((q) => q.report_id !== p.report_id)
      .map((q) => ({ reportId: q.report_id, distanceMetres: Math.round(haversineMeters(p, q)) }))
      .filter((q) => q.distanceMetres <= radius).sort((a, b) => a.distanceMetres - b.distanceMetres);
    if (nearbySpots.length > 0 || nearbyReports.length > 0) out.push({ reportId: p.report_id, nearbySpots, nearbyReports });
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
