// Cross-source review and merge (ADR-0008 decision 4, Issue #107; migration 0019). Builds on the planning
// foundation of the unmerged commit bf225b3 (its recall rule, normalization and merge plan), now persisted:
//
//   generateCrossSourceCandidates  recall only: pairs of live spots of two different approved sources, within
//                                  100 m, or within 500 m with an exact normalized name/location. Proximity or a
//                                  shared host/business name is never identity. Each candidate is bound to both
//                                  spots' complete canonical state (cross_source_spot_state).
//   recordCrossSourceDecision      a reviewer's append-only answer. Changes nothing canonical.
//   applyCrossSourceMerge          the explicit application of the latest sameRealWorldSpot decision. One INSERT
//                                  whose triggers re-check the premise and perform the merge (0019).
//
// Nothing here chooses which source's value is right: a merge keeps publishing the survivor's own values only
// while every loser agrees on every semantic field, and holds the survivor otherwise. Run publishTiles after a
// merge; until then the export refuses (membership no longer matches the tile bodies).

import { type Db } from "../db.ts";

export const CROSS_SOURCE_CANDIDATE_VERSION = "cross-source-candidate.v1";
export const CROSS_SOURCE_DECISION_VERSION = "cross-source-decision.v1";
export const CROSS_SOURCE_MERGE_EXECUTOR_VERSION = "cross-source-merge.v1";

/** Recall thresholds of cross-source-candidate.v1 (metres). Not identity thresholds. */
export const PROXIMITY_ONLY_METRES = 100;
export const NAME_OR_LOCATION_METRES = 500;

export type CrossSourceDecision = "sameRealWorldSpot" | "distinctSpots" | "insufficientEvidence";
export type CandidateReason = "proximity100m" | "normalizedName" | "normalizedLocation";

export class CrossSourceError extends Error {}

/** One live, single-source spot as the recall rule sees it. `location` is a normalized-model location text, when
 * the canonical model has one (it has none yet: ADR-0006 keeps 設置位置/方書 in raw evidence only). */
export interface RecallSpot {
  spotId: string;
  sourceId: string;
  latitude: number;
  longitude: number;
  name: string | null;
  location: string | null;
}

export interface RecallPair {
  a: RecallSpot;
  b: RecallSpot;
  distanceMetres: number;
  reasons: CandidateReason[];
}

/** NFKC, lower case, no whitespace or punctuation (bf225b3). An empty result never matches. */
export const normalizeText = (s: string | null) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");

export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin((a.latitude - b.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((a.longitude - b.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * The v1 recall rule, pure and deterministic: pairs of spots of DIFFERENT sources within 100 m, or within 500 m
 * with an exact nonempty normalized name or location. Same-source pairs are never candidates (that is
 * cross-release matching's job), and nothing beyond 500 m is, whatever its name.
 */
export function recallPairs(input: readonly RecallSpot[]): RecallPair[] {
  for (const s of input) {
    if (!s.spotId || !s.sourceId || !Number.isFinite(s.latitude) || Math.abs(s.latitude) > 90
      || !Number.isFinite(s.longitude) || Math.abs(s.longitude) > 180) {
      throw new CrossSourceError(`cross-source: invalid spot ${s.spotId}`);
    }
  }
  if (new Set(input.map((s) => s.spotId)).size !== input.length) throw new CrossSourceError("cross-source: duplicate spot id");
  const spots = [...input].sort((x, y) => (x.spotId < y.spotId ? -1 : 1));
  const pairs: RecallPair[] = [];
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i], b = spots[j];
      if (a.sourceId === b.sourceId) continue;
      const d = distanceMetres(a, b);
      if (d > NAME_OR_LOCATION_METRES) continue;
      const reasons: CandidateReason[] = [];
      if (d <= PROXIMITY_ONLY_METRES) reasons.push("proximity100m");
      const na = normalizeText(a.name), nb = normalizeText(b.name);
      if (na !== "" && na === nb) reasons.push("normalizedName");
      const la = normalizeText(a.location), lb = normalizeText(b.location);
      if (la !== "" && la === lb) reasons.push("normalizedLocation");
      if (reasons.length === 0) continue;
      pairs.push({ a, b, distanceMetres: d, reasons });
    }
  }
  return pairs;
}

/**
 * Persists every current recall pair of the database as a candidate, idempotently: the same pair in the same
 * states is the same candidate (0019 UNIQUE), so a re-run adds nothing, and a pair whose spot changed gets a new
 * candidate while the old one turns stale. Returns the candidate ids for the current pairs, in pair order.
 */
export async function generateCrossSourceCandidates(db: Db, opts: { now: string }): Promise<number[]> {
  const { results } = await db.prepare(
    `SELECT s.spot_id, x.source_id, s.latitude, s.longitude, s.name
     FROM spots s JOIN cross_source_spot_sources x ON x.spot_id = s.spot_id
     WHERE s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL
     ORDER BY s.spot_id`,
  ).all<{ spot_id: string; source_id: string; latitude: number; longitude: number; name: string | null }>();
  const pairs = recallPairs(results.map((r) => ({
    spotId: r.spot_id, sourceId: r.source_id, latitude: r.latitude, longitude: r.longitude, name: r.name, location: null,
  })));
  const ids: number[] = [];
  for (const p of pairs) {
    await db.prepare(
      `INSERT INTO cross_source_candidates (algorithm_version, spot_a_id, spot_b_id, source_a_id, source_b_id, distance_m,
         reasons_json, state_a_json, state_b_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, a.state_json, b.state_json, ?
       FROM cross_source_spot_state a, cross_source_spot_state b WHERE a.spot_id = ? AND b.spot_id = ?
       ON CONFLICT (algorithm_version, spot_a_id, spot_b_id, state_a_json, state_b_json) DO NOTHING`,
    ).bind(CROSS_SOURCE_CANDIDATE_VERSION, p.a.spotId, p.b.spotId, p.a.sourceId, p.b.sourceId, p.distanceMetres,
      JSON.stringify(p.reasons), opts.now, p.a.spotId, p.b.spotId).run();
    const row = await db.prepare(
      `SELECT cross_source_candidate_id FROM cross_source_current_candidates
       WHERE algorithm_version = ? AND spot_a_id = ? AND spot_b_id = ?`,
    ).bind(CROSS_SOURCE_CANDIDATE_VERSION, p.a.spotId, p.b.spotId).first<{ cross_source_candidate_id: number }>();
    if (!row) throw new CrossSourceError(`cross-source: candidate ${p.a.spotId}/${p.b.spotId} was not stored`);
    ids.push(row.cross_source_candidate_id);
  }
  return ids;
}

export interface CrossSourceDecisionInput {
  candidateId: number;
  decision: CrossSourceDecision;
  /** Required for sameRealWorldSpot: one of the candidate's two existing spot ids. */
  survivorSpotId?: string;
  /** Required for sameRealWorldSpot: specific smoking-location identity evidence, not proximity or a host name. */
  identityEvidence?: string;
  decidedBy: string;
  decidedAt: string;
  note?: string;
}

/** Records a decision as evidence (append-only; the latest is the largest id). Refused on a stale candidate. */
export async function recordCrossSourceDecision(db: Db, input: CrossSourceDecisionInput): Promise<number> {
  const row = await db.prepare(
    `INSERT INTO cross_source_decisions (cross_source_candidate_id, decision, decision_version, survivor_spot_id,
       identity_evidence, decided_by, decided_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING cross_source_decision_id`,
  ).bind(input.candidateId, input.decision, CROSS_SOURCE_DECISION_VERSION, input.survivorSpotId ?? null,
    input.identityEvidence ?? null, input.decidedBy, input.decidedAt, input.note ?? null)
    .first<{ cross_source_decision_id: number }>();
  if (!row) throw new CrossSourceError(`cross-source: decision on candidate ${input.candidateId} returned no row`);
  return row.cross_source_decision_id;
}

/** The semantic fields cross_source_spot_values compares, in its order (for the audit list only). */
export const COMPARED_FIELDS = ["latitude", "longitude", "spot_type", "host_type", "access_type", "environment",
  "supports_paper", "supports_heated", "opening_hours_status", "opening_hours_json", "opening_hours_raw", "time_zone",
  "fee_type", "floor", "entrance_note", "lifecycle"] as const;

export type CrossSourceMergeResult =
  | { status: "applied"; candidateId: number; decisionId: number; survivorSpotId: string; loserSpotId: string;
      conflicts: string[]; held: boolean; affectedTileIds: string[] }
  /** This same decision was applied before; nothing was written. */
  | { status: "alreadyApplied"; candidateId: number; decisionId: number; survivorSpotId: string; loserSpotId: string }
  /** The latest decision does not merge, or there is none; nothing was written. */
  | { status: "notApplicable"; candidateId: number; reason: "noDecision" | "distinctSpots" | "insufficientEvidence" };

interface CandidateRow {
  spot_a_id: string; spot_b_id: string; state_a_json: string; state_b_json: string;
  latest_id: number | null; latest: string | null; survivor: string | null;
}

/**
 * Applies the latest decision of one candidate, if it is sameRealWorldSpot. Checks in code first (clear errors),
 * then inserts one cross_source_merge_applications row whose triggers re-check everything inside the statement
 * (latest decision, both states unchanged, live and approved, exact inbound redirects, the hold) and perform the
 * merge. A decision recorded, or a spot changed, in between aborts it with nothing written.
 */
export async function applyCrossSourceMerge(db: Db, candidateId: number, opts: { now: string }): Promise<CrossSourceMergeResult> {
  const fail = (why: string) => new CrossSourceError(`cross-source merge: candidate ${candidateId}: ${why}`);
  const c = await db.prepare(
    `SELECT c.spot_a_id, c.spot_b_id, c.state_a_json, c.state_b_json,
            d.cross_source_decision_id AS latest_id, d.decision AS latest, d.survivor_spot_id AS survivor
     FROM cross_source_candidates c
     LEFT JOIN cross_source_decisions d ON d.cross_source_decision_id =
       (SELECT max(cross_source_decision_id) FROM cross_source_decisions WHERE cross_source_candidate_id = c.cross_source_candidate_id)
     WHERE c.cross_source_candidate_id = ?`,
  ).bind(candidateId).first<CandidateRow>();
  if (!c) throw fail("does not exist");

  const existing = await db.prepare(
    "SELECT cross_source_decision_id, survivor_spot_id, loser_spot_id FROM cross_source_merge_applications WHERE cross_source_candidate_id = ?",
  ).bind(candidateId).first<{ cross_source_decision_id: number; survivor_spot_id: string; loser_spot_id: string }>();
  if (existing) {
    if (existing.cross_source_decision_id === c.latest_id) {
      return { status: "alreadyApplied", candidateId, decisionId: existing.cross_source_decision_id,
        survivorSpotId: existing.survivor_spot_id, loserSpotId: existing.loser_spot_id };
    }
    throw fail(`was applied on decision ${existing.cross_source_decision_id}, but its latest decision is ${c.latest_id}`);
  }
  if (c.latest_id === null) return { status: "notApplicable", candidateId, reason: "noDecision" };
  if (c.latest === "distinctSpots" || c.latest === "insufficientEvidence") return { status: "notApplicable", candidateId, reason: c.latest };
  if (c.latest !== "sameRealWorldSpot" || c.survivor === null) throw fail(`has unexpected latest decision ${c.latest}`);

  const survivor = c.survivor;
  const loser = survivor === c.spot_a_id ? c.spot_b_id : c.spot_a_id;
  const states = await db.prepare(
    "SELECT spot_id, state_json FROM cross_source_spot_state WHERE spot_id IN (?, ?)",
  ).bind(c.spot_a_id, c.spot_b_id).all<{ spot_id: string; state_json: string }>();
  const stateOf = new Map(states.results.map((s) => [s.spot_id, s.state_json]));
  if (stateOf.get(c.spot_a_id) !== c.state_a_json || stateOf.get(c.spot_b_id) !== c.state_b_json) {
    throw fail("is stale: a spot changed since the candidate was generated; generate and review it again");
  }

  const spots = await db.prepare(`SELECT * FROM spots WHERE spot_id IN (?, ?)`).bind(survivor, loser).all<Record<string, unknown>>();
  const row = new Map(spots.results.map((s) => [String(s.spot_id), s]));
  const conflicts = COMPARED_FIELDS.filter((f) => row.get(survivor)?.[f] !== row.get(loser)?.[f]);
  const chainHeld = await db.prepare(
    "SELECT 1 AS held FROM cross_source_merge_applications WHERE survivor_spot_id IN (?, ?) AND conflict_hold = 1 LIMIT 1",
  ).bind(survivor, loser).first<{ held: number }>();
  const held = conflicts.length > 0 || chainHeld !== null;
  const redirected = await db.prepare("SELECT spot_id FROM spots WHERE merged_into = ? ORDER BY spot_id")
    .bind(loser).all<{ spot_id: string }>();
  const affectedTileIds = [...new Set([String(row.get(loser)?.tile_id), ...(held ? [String(row.get(survivor)?.tile_id)] : [])])].sort();

  await db.batch([db.prepare(
    `INSERT INTO cross_source_merge_applications (cross_source_candidate_id, cross_source_decision_id, survivor_spot_id,
       loser_spot_id, redirected_spot_ids_json, conflicts_json, conflict_hold, executor_version, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(candidateId, c.latest_id, survivor, loser, JSON.stringify(redirected.results.map((r) => r.spot_id)),
    JSON.stringify(conflicts), held ? 1 : 0, CROSS_SOURCE_MERGE_EXECUTOR_VERSION, opts.now)]);

  const after = await db.prepare("SELECT merged_into FROM spots WHERE spot_id = ?").bind(loser).first<{ merged_into: string | null }>();
  if (after?.merged_into !== survivor) throw fail(`loser ${loser} does not redirect to ${survivor} after applying`);
  return { status: "applied", candidateId, decisionId: c.latest_id, survivorSpotId: survivor, loserSpotId: loser,
    conflicts: [...conflicts], held, affectedTileIds };
}
