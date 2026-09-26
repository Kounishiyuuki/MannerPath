// Review queue (ADR-0008 decisions 5 and 8, Issue #80): what the cross-release matcher cannot decide
// is persisted as review items, and a reviewer's answer as a review decision. Neither writes a
// canonical row; applying a decision is a separate step (./removal.ts, and ./reviewed-match.ts via the resolver).

import { type Db } from "../db.ts";
import type { AmbiguousRecord, PreviousRecord } from "./match.ts";
import type { SourceCompleteness } from "./source-adapter.ts";

/** The vocabulary of ambiguousMatch, disappearance and removalCandidate decisions. */
export const REVIEW_DECISION_VERSION = "review-decision.v1";
/** The vocabulary of relocationCandidate decisions (ADR-0009); v1 is never valid on that kind. */
export const RELOCATION_REVIEW_DECISION_VERSION = "review-decision.v2";

export type ReviewItemKind = "ambiguousMatch" | "disappearance" | "removalCandidate" | "relocationCandidate";
export type ReviewDecision =
  | "matchedToEntity" | "confirmedNew" | "removalConfirmed" | "removalRejected" | "deferred"
  | "relocationConfirmed" | "relocationRejected";

export interface CandidateContext {
  sourceId: string;
  releaseId: number;
  releaseContentSha256: string;
  previousReleaseId: number;
  matcherVersion: string;
  completeness: SourceCompleteness;
}

export interface ReviewItemRow {
  kind: ReviewItemKind;
  candidateKey: string;
  recordId: number | null;
  sourceEntityId: number | null;
  spotId: string | null;
  details: Record<string, unknown>;
}

const sortedIds = (ids: readonly number[]) => [...new Set(ids)].sort((a, b) => a - b);

/**
 * The items a match plan raises, in a deterministic order. Their identity (kind + candidate_key
 * within one release, previous release and matcher version) depends only on the plan's ids, so
 * re-running the same release yields the same items.
 */
export function crossReleaseCandidates(
  ambiguous: readonly AmbiguousRecord[], unmatchedPreviousEntityIds: readonly number[],
  previous: readonly PreviousRecord[], completeness: SourceCompleteness,
): ReviewItemRow[] {
  const byEntity = new Map(previous.map((p) => [p.sourceEntityId, p]));
  const items: ReviewItemRow[] = [];
  for (const a of [...ambiguous].sort((x, y) => x.recordId - y.recordId)) {
    const candidateEntityIds = sortedIds(a.candidateEntityIds);
    items.push({
      kind: "ambiguousMatch",
      candidateKey: `record:${a.recordId}|entities:${candidateEntityIds.join(",")}`,
      recordId: a.recordId, sourceEntityId: null, spotId: null,
      // Candidate spots are read from spot_source_entities, not copied here (migration 0009).
      details: { reason: a.reason, candidateEntityIds },
    });
  }
  for (const id of sortedIds(unmatchedPreviousEntityIds)) {
    const p = byEntity.get(id);
    if (!p) throw new Error(`review queue: unmatched entity ${id} is not an entity of the previous release`);
    items.push({
      kind: completeness === "complete" ? "removalCandidate" : "disappearance",
      candidateKey: `entity:${id}`,
      recordId: null, sourceEntityId: id, spotId: p.spotId,
      details: {
        reason: completeness === "complete"
          ? "no record of the new release matched this entity, and the adapter declares the source complete; removal evidence pending review"
          : "no record of the new release matched this entity; the source is partial, so this is not removal evidence",
        previousRecordId: p.recordId,
      },
    });
  }
  return items;
}

/**
 * Persists `items` idempotently and returns their ids in the same order. An existing item with the
 * same identity is kept as it is (created_at included); if its details differ from what this run
 * computed, the same input no longer yields the same item, and that is refused loudly.
 */
export async function persistReviewItems(db: Db, ctx: CandidateContext, items: readonly ReviewItemRow[], now: string): Promise<number[]> {
  await db.batch(items.map((item) => db.prepare(
    `INSERT INTO review_items (source_id, release_id, release_content_sha256, previous_release_id, kind, matcher_version,
       source_completeness, candidate_key, record_id, source_entity_id, spot_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_id, release_id, previous_release_id, matcher_version, kind, candidate_key) DO NOTHING`,
  ).bind(ctx.sourceId, ctx.releaseId, ctx.releaseContentSha256, ctx.previousReleaseId, item.kind, ctx.matcherVersion,
    ctx.completeness, item.candidateKey, item.recordId, item.sourceEntityId, item.spotId, JSON.stringify(item.details), now)));

  const ids: number[] = [];
  for (const item of items) {
    const row = await db.prepare(
      `SELECT review_item_id, source_completeness, record_id, source_entity_id, spot_id, details_json FROM review_items
       WHERE source_id = ? AND release_id = ? AND previous_release_id = ? AND matcher_version = ? AND kind = ? AND candidate_key = ?`,
    ).bind(ctx.sourceId, ctx.releaseId, ctx.previousReleaseId, ctx.matcherVersion, item.kind, item.candidateKey)
      .first<{ review_item_id: number; source_completeness: string; record_id: number | null; source_entity_id: number | null; spot_id: string | null; details_json: string }>();
    if (!row) throw new Error(`review queue: item ${item.kind} ${item.candidateKey} of release ${ctx.releaseId} was not stored`);
    if (row.details_json !== JSON.stringify(item.details) || row.source_completeness !== ctx.completeness
      || row.record_id !== item.recordId || row.source_entity_id !== item.sourceEntityId || row.spot_id !== item.spotId) {
      throw new Error(`review queue: stored item ${row.review_item_id} (${item.kind} ${item.candidateKey}) differs from this run's candidate`);
    }
    ids.push(row.review_item_id);
  }
  return ids;
}

export interface ReviewDecisionInput {
  reviewItemId: number;
  decision: ReviewDecision;
  /** The chosen candidate entity of a matchedToEntity decision; omitted otherwise. */
  sourceEntityId?: number;
  decidedBy: string;
  decidedAt: string;
  note?: string;
}

/**
 * Records a reviewer's decision as evidence. The item's latest decision is its largest
 * review_decision_id; decided_at never decides precedence. It is stored under the vocabulary version of
 * the item's kind (v2 for a relocationCandidate, v1 otherwise), validated against the item by the schema,
 * and changes nothing else: no spot, link, provenance, hold or release state. A relocationConfirmed
 * decision in particular moves no coordinate; only a later reviewed application may.
 */
export async function recordReviewDecision(db: Db, input: ReviewDecisionInput): Promise<number> {
  // RETURNING yields the id of this statement's own row, even with concurrent decisions on the item.
  const row = await db.prepare(
    `INSERT INTO review_decisions (review_item_id, decision, decision_version, source_entity_id, decided_by, decided_at, note)
     VALUES (?, ?, CASE (SELECT kind FROM review_items WHERE review_item_id = ?) WHEN 'relocationCandidate' THEN ? ELSE ? END, ?, ?, ?, ?)
     RETURNING review_decision_id`,
  ).bind(input.reviewItemId, input.decision, input.reviewItemId, RELOCATION_REVIEW_DECISION_VERSION, REVIEW_DECISION_VERSION,
    input.sourceEntityId ?? null, input.decidedBy, input.decidedAt, input.note ?? null).first<{ review_decision_id: number }>();
  if (!row) throw new Error(`review queue: decision ${input.decision} on item ${input.reviewItemId} returned no row`);
  return row.review_decision_id;
}
