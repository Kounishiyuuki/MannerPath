// Removal executor (ADR-0008 decisions 5 and 8, Issue #84): the explicit application step that turns
// a reviewed removal into the canonical change spots.lifecycle = 'removed'. Recording a decision
// (review-queue.ts) changes nothing canonical, and the resolver only consumes an application this step
// already wrote (./reviewed-match.ts, Issue #89); only this step removes, and only for a complete source's removalCandidate
// whose latest decision is removalConfirmed. The spot keeps its id, links, raw evidence and provenance; every published tile
// is rebuilt by the ordinary publish step afterwards.

import { type Db } from "../db.ts";

export const REMOVAL_EXECUTOR_VERSION = "review-removal-executor.v1";

export type RemovalApplicationResult =
  | { status: "applied"; spotId: string; reviewItemId: number; reviewDecisionId: number; tileId: string }
  /** This same decision was applied before; nothing was written. */
  | { status: "alreadyApplied"; spotId: string; reviewItemId: number; reviewDecisionId: number }
  /** The latest decision does not remove the spot (removalRejected, deferred) or there is none. */
  | { status: "notApplicable"; reviewItemId: number; reason: "noDecision" | "removalRejected" | "deferred" };

export class RemovalApplicationError extends Error {}

interface ItemRow {
  review_item_id: number; kind: string; source_completeness: string; spot_id: string | null;
  latest_decision_id: number | null; latest_decision: string | null;
}

/**
 * Applies the latest decision of one review item, if it is removalConfirmed. It reads the item and
 * its latest decision (largest review_decision_id), then writes in one batch: the application row
 * (whose trigger re-checks, inside that statement, that the decision it names is still the latest),
 * the spot's unpublication and its lifecycle change. A decision recorded in between aborts the batch.
 *
 * Idempotent for the same decision; fails closed when the spot was removed on another decision, or
 * when the item is not a complete source's removal candidate. Run publishTiles afterwards: until then
 * the spot is already absent from GET /spots/{id} (which reads snapshot membership) but its tile body
 * still lists it.
 */
export async function applyReviewedRemoval(
  db: Db, reviewItemId: number, opts: { now: string },
): Promise<RemovalApplicationResult> {
  const item = await db.prepare(
    `SELECT i.review_item_id, i.kind, i.source_completeness, i.spot_id, d.review_decision_id AS latest_decision_id,
            d.decision AS latest_decision
     FROM review_items i
     LEFT JOIN review_decisions d ON d.review_decision_id =
       (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
     WHERE i.review_item_id = ?`,
  ).bind(reviewItemId).first<ItemRow>();
  if (!item) throw new RemovalApplicationError(`removal: review item ${reviewItemId} does not exist`);
  // Partial disappearance is never removal evidence (0009 refuses such an item's removalConfirmed too).
  if (item.kind !== "removalCandidate" || item.source_completeness !== "complete" || item.spot_id === null) {
    throw new RemovalApplicationError(
      `removal: review item ${reviewItemId} is a ${item.source_completeness} ${item.kind}, not a complete source's removal candidate`);
  }
  const spotId = item.spot_id;

  const existing = await db.prepare(
    "SELECT review_item_id, review_decision_id FROM review_removal_applications WHERE spot_id = ?",
  ).bind(spotId).first<{ review_item_id: number; review_decision_id: number }>();
  if (existing) {
    if (existing.review_item_id === reviewItemId && existing.review_decision_id === item.latest_decision_id) {
      return { status: "alreadyApplied", spotId, reviewItemId, reviewDecisionId: existing.review_decision_id };
    }
    throw new RemovalApplicationError(
      `removal: spot ${spotId} was removed on review decision ${existing.review_decision_id} (item ${existing.review_item_id}); ` +
      `item ${reviewItemId}'s latest decision is ${item.latest_decision_id ?? "none"}`);
  }

  if (item.latest_decision_id === null) return { status: "notApplicable", reviewItemId, reason: "noDecision" };
  if (item.latest_decision === "removalRejected" || item.latest_decision === "deferred") {
    return { status: "notApplicable", reviewItemId, reason: item.latest_decision };
  }
  if (item.latest_decision !== "removalConfirmed") {
    throw new RemovalApplicationError(`removal: item ${reviewItemId} has unexpected latest decision ${item.latest_decision}`);
  }
  const decisionId = item.latest_decision_id;

  const spot = await db.prepare("SELECT tile_id, lifecycle FROM spots WHERE spot_id = ?")
    .bind(spotId).first<{ tile_id: string; lifecycle: string }>();
  if (!spot) throw new RemovalApplicationError(`removal: spot ${spotId} does not exist`);

  // Every write is conditioned on the application row this batch inserts for exactly this decision,
  // and the insert's trigger aborts the batch unless that decision is still the item's latest.
  const applied = "EXISTS (SELECT 1 FROM review_removal_applications WHERE spot_id = ? AND review_decision_id = ?)";
  await db.batch([
    db.prepare(
      `INSERT INTO review_removal_applications (spot_id, review_item_id, review_decision_id, executor_version, applied_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(spotId, reviewItemId, decisionId, REMOVAL_EXECUTOR_VERSION, opts.now),
    // Unpublish first: 0001/0004 refuse a lifecycle change of a spot still in a snapshot.
    db.prepare(`DELETE FROM tile_snapshot_spots WHERE spot_id = ? AND ${applied}`).bind(spotId, spotId, decisionId),
    db.prepare(`UPDATE spots SET lifecycle = 'removed', updated_at = ? WHERE spot_id = ? AND lifecycle = 'active' AND ${applied}`)
      .bind(opts.now, spotId, spotId, decisionId),
  ]);

  const after = await db.prepare("SELECT lifecycle FROM spots WHERE spot_id = ?").bind(spotId).first<{ lifecycle: string }>();
  if (after?.lifecycle !== "removed") throw new RemovalApplicationError(`removal: spot ${spotId} is ${after?.lifecycle} after applying`);
  return { status: "applied", spotId, reviewItemId, reviewDecisionId: decisionId, tileId: spot.tile_id };
}
