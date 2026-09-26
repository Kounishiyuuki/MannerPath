// Cross-release matcher (ADR-0008 decision 3, Issue #78): the previous applied release of one source
// + a new release of the same source -> one decision per new record. Pure and deterministic; the
// resolver records the decisions and applies them only when nothing is ambiguous or unmatched.
//
// v1 matches on raw identity only. `natural_key` (name + coordinate proximity for Taito, whose `#`
// is not reviewed as stable) needs a reviewed distance threshold, which does not exist yet, so a
// record whose raw values changed is never matched by guesswork: while any previous entity is still
// unmatched it is ambiguous (an edit and an add + remove cannot be told apart), otherwise new.
//
// The matcher reads a record's raw_sha256 and its recorded entity, never raw values: interpreting a
// record stays the adapter's mapping (./observe.ts).

import { type Db } from "../db.ts";

/** Names the match key this matcher reads: the record's `raw_sha256` (sha256 of raw_values_json). */
export const RAW_SHA256_KEY_VERSION = "raw-sha256.v1";
/** Stored in `source_record_entities.matcher_version`: the matcher and the key version it read. */
export const CROSS_RELEASE_MATCHER_VERSION = `cross-release.v1+${RAW_SHA256_KEY_VERSION}`;

export interface PreviousRecord {
  recordId: number;
  sourceEntityId: number;
  rawSha256: string;
  /** The canonical spot the entity is linked to (spot_source_entities). */
  spotId: string;
}

export interface NewRecord {
  recordId: number;
  rawSha256: string;
}

export type MatchDecision =
  | { recordId: number; method: "raw_identical"; sourceEntityId: number; previousRecordId: number }
  | { recordId: number; method: "new" };

export interface AmbiguousRecord {
  recordId: number;
  reason: string;
  candidateEntityIds: number[];
}

export interface MatchPlan {
  decisions: MatchDecision[];
  ambiguous: AmbiguousRecord[];
  /** Previous entities no new record matched: disappearance candidates, never removals here. */
  unmatchedPreviousEntityIds: number[];
}

function groupBySha<T extends { rawSha256: string }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.rawSha256, [...(groups.get(row.rawSha256) ?? []), row]);
  return groups;
}

/**
 * Both inputs must belong to one source; the caller reads them by release, and the schema refuses
 * a decision that links a record to another source's entity. Output order follows `next`.
 */
export function planCrossReleaseMatch(previous: readonly PreviousRecord[], next: readonly NewRecord[]): MatchPlan {
  const previousBySha = groupBySha(previous);
  const nextBySha = groupBySha(next);
  const matched = new Set<number>();
  const decided = new Map<number, MatchDecision | AmbiguousRecord>();

  for (const record of next) {
    const candidates = previousBySha.get(record.rawSha256) ?? [];
    if (candidates.length === 0) continue;
    if (candidates.length === 1 && nextBySha.get(record.rawSha256)!.length === 1) {
      const [c] = candidates;
      matched.add(c.sourceEntityId);
      decided.set(record.recordId, { recordId: record.recordId, method: "raw_identical", sourceEntityId: c.sourceEntityId, previousRecordId: c.recordId });
    } else {
      // Identical raw rows on either side: which one continues which entity is not determined.
      decided.set(record.recordId, {
        recordId: record.recordId,
        reason: "identical raw values are not unique across the two releases",
        candidateEntityIds: candidates.map((c) => c.sourceEntityId),
      });
    }
  }

  // Entities that are candidates of an ambiguous record are not free either: they are not matched,
  // but they are not disappearance candidates as long as an ambiguous record may continue them.
  const ambiguousCandidates = new Set([...decided.values()].flatMap((d) => "reason" in d ? d.candidateEntityIds : []));
  const unmatchedPrevious = [...new Set(previous.map((p) => p.sourceEntityId))]
    .filter((id) => !matched.has(id) && !ambiguousCandidates.has(id));

  const remaining = next.filter((r) => !decided.has(r.recordId));
  for (const record of remaining) {
    decided.set(record.recordId, unmatchedPrevious.length === 0
      ? { recordId: record.recordId, method: "new" }
      : {
        recordId: record.recordId,
        reason: "raw values changed or the record is new, and unmatched previous entities remain; no reviewed natural-key policy can tell an edit from an add + remove",
        candidateEntityIds: unmatchedPrevious,
      });
  }

  const results = next.map((r) => decided.get(r.recordId)!);
  return {
    decisions: results.filter((d): d is MatchDecision => !("reason" in d)),
    ambiguous: results.filter((d): d is AmbiguousRecord => "reason" in d),
    // While an unmatched new record remains, the unmatched entities are its candidates, not disappearances.
    unmatchedPreviousEntityIds: remaining.length === 0 ? unmatchedPrevious : [],
  };
}

/**
 * The matcher inputs of two releases of one source: the previous release's records with their
 * entity and spot (records lacking either are left out, for the caller to refuse), and the new
 * release's records. Both in record order.
 */
export async function readMatchInputs(db: Db, previousReleaseId: number, releaseId: number) {
  const { results: previous } = await db.prepare(
    `SELECT r.record_id AS recordId, r.raw_sha256 AS rawSha256, e.source_entity_id AS sourceEntityId, l.spot_id AS spotId
     FROM source_records r
     JOIN source_record_entities e ON e.record_id = r.record_id
     JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id
     WHERE r.release_id = ? ORDER BY r.ordinal`,
  ).bind(previousReleaseId).all<PreviousRecord>();
  const { results: next } = await db.prepare(
    "SELECT record_id AS recordId, raw_sha256 AS rawSha256 FROM source_records WHERE release_id = ? ORDER BY ordinal",
  ).bind(releaseId).all<NewRecord>();
  return { previous, next };
}

/**
 * The key rows the matcher read, one per record under RAW_SHA256_KEY_VERSION. A key is derived from
 * the immutable raw_sha256, so an existing row can only hold the same value and is left as it is.
 */
export function matchKeyStatements(db: Db, recordIds: readonly number[], now: string) {
  return recordIds.map((recordId) => db.prepare(
    `INSERT INTO source_record_match_keys (record_id, key_version, match_key, derived_at)
     SELECT record_id, ?, raw_sha256, ? FROM source_records WHERE record_id = ?
     ON CONFLICT (record_id, key_version) DO NOTHING`,
  ).bind(RAW_SHA256_KEY_VERSION, now, recordId));
}
