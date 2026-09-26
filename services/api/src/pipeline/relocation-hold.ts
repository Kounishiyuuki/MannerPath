// Relocation hold (ADR-0009 decision 4, Implementation plan step B, Issue #95): the explicit step that
// withholds a spot while its relocationCandidate is open. The resolver only raises the candidate
// (./relocation.ts); only this step holds, and only while the candidate's premise is still current. The
// hold means "evidence exists that the published coordinate may be wrong", not "the place moved": it
// changes no coordinate, tile, id, lifecycle, link, provenance or review row, and it neither needs nor
// consumes a relocation decision. Lifting it is a later reviewed step (applyReviewedRelocation, step C);
// a relocationRejected or deferred decision never lifts it. Run publishTiles afterwards, as after a removal.

import { type Db } from "../db.ts";
import type { SourceAdapter } from "./source-adapter.ts";

export const RELOCATION_HOLD_EXECUTOR_VERSION = "review-relocation-hold.v1";
/** The spots.publication_hold value of a relocation hold (migration 0014); distinct from locationSuperseded. */
export const HOLD_RELOCATION_UNDER_REVIEW = "relocationUnderReview";

export type RelocationHoldResult =
  | { status: "held"; spotId: string; reviewItemId: number; tileId: string }
  /** This item already holds the spot; nothing was written. */
  | { status: "alreadyHeld"; spotId: string; reviewItemId: number };

export class RelocationHoldError extends Error {}

interface ItemRow {
  review_item_id: number; kind: string; source_id: string; record_id: number | null; spot_id: string | null; details_json: string;
}

interface CandidateDetails {
  previousRecordId?: unknown; mappingVersion?: unknown; previousObservationId?: unknown; newObservationId?: unknown;
}

/**
 * Holds the spot of one open relocationCandidate. It checks the item in code, binds it to the adapter's
 * current mapping version, then writes in one batch: the hold row (whose trigger re-checks the whole
 * premise inside that statement), the spot's unpublication, and only then its hold (ADR-0006 decision 11).
 * A decision or release recorded in between aborts the batch.
 *
 * Idempotent for the same item; fails closed on anything else, including a spot already held for another
 * reason (never overwritten) or a candidate that does not cite the adapter's current observation rows.
 */
export async function holdRelocationCandidate(
  db: Db, adapter: SourceAdapter, reviewItemId: number, opts: { now: string },
): Promise<RelocationHoldResult> {
  const item = await db.prepare(
    "SELECT review_item_id, kind, source_id, record_id, spot_id, details_json FROM review_items WHERE review_item_id = ?",
  ).bind(reviewItemId).first<ItemRow>();
  if (!item) throw new RelocationHoldError(`relocation hold: review item ${reviewItemId} does not exist`);
  if (item.kind !== "relocationCandidate" || item.spot_id === null || item.record_id === null) {
    throw new RelocationHoldError(`relocation hold: review item ${reviewItemId} is a ${item.kind}, not a relocationCandidate`);
  }
  if (item.source_id !== adapter.registry.sourceId) {
    throw new RelocationHoldError(`relocation hold: review item ${reviewItemId} belongs to ${item.source_id}, not to adapter source ${adapter.registry.sourceId}`);
  }
  const spotId = item.spot_id;

  const existing = await db.prepare("SELECT spot_id FROM review_relocation_holds WHERE review_item_id = ?")
    .bind(reviewItemId).first<{ spot_id: string }>();
  const spot = await db.prepare("SELECT tile_id, publication_hold FROM spots WHERE spot_id = ?")
    .bind(spotId).first<{ tile_id: string; publication_hold: string | null }>();
  if (!spot) throw new RelocationHoldError(`relocation hold: spot ${spotId} does not exist`);
  if (existing) {
    if (existing.spot_id === spotId && spot.publication_hold === HOLD_RELOCATION_UNDER_REVIEW) {
      return { status: "alreadyHeld", spotId, reviewItemId };
    }
    throw new RelocationHoldError(`relocation hold: item ${reviewItemId} has a hold row, but spot ${spotId} is held as ${spot.publication_hold ?? "nothing"}`);
  }
  if (spot.publication_hold !== null) {
    throw new RelocationHoldError(`relocation hold: spot ${spotId} is already held (${spot.publication_hold}); an existing hold is never overwritten`);
  }

  // Trust boundary (ADR-0009 step A): the schema checks the cited rows only. Holding on a candidate cut
  // from another mapping version would act on evidence the adapter does not currently derive.
  const details = JSON.parse(item.details_json) as CandidateDetails;
  if (details.mappingVersion !== adapter.mappingVersion) {
    throw new RelocationHoldError(`relocation hold: item ${reviewItemId} cites mapping ${String(details.mappingVersion)}, not the adapter's ${adapter.mappingVersion}`);
  }
  for (const [recordId, observationId] of [[details.previousRecordId, details.previousObservationId], [item.record_id, details.newObservationId]]) {
    const row = await db.prepare("SELECT observation_id FROM source_observations WHERE record_id = ? AND mapping_version = ?")
      .bind(recordId, adapter.mappingVersion).first<{ observation_id: number }>();
    if (!row || row.observation_id !== observationId) {
      throw new RelocationHoldError(`relocation hold: item ${reviewItemId} cites observation ${String(observationId)} of record ${String(recordId)}, not its ${adapter.mappingVersion} row`);
    }
  }

  // Every write is conditioned on the hold row this batch inserts, and that insert's trigger aborts the
  // batch unless the premise still holds.
  const held = "EXISTS (SELECT 1 FROM review_relocation_holds WHERE review_item_id = ? AND spot_id = ?)";
  await db.batch([
    db.prepare(
      "INSERT INTO review_relocation_holds (review_item_id, spot_id, executor_version, applied_at) VALUES (?, ?, ?, ?)",
    ).bind(reviewItemId, spotId, RELOCATION_HOLD_EXECUTOR_VERSION, opts.now),
    db.prepare(`DELETE FROM tile_snapshot_spots WHERE spot_id = ? AND ${held}`).bind(spotId, reviewItemId, spotId),
    // updated_at is left as it is: a hold is a publication decision, not a change to the place's data.
    db.prepare(`UPDATE spots SET publication_hold = ? WHERE spot_id = ? AND publication_hold IS NULL AND ${held}`)
      .bind(HOLD_RELOCATION_UNDER_REVIEW, spotId, reviewItemId, spotId),
  ]);

  const after = await db.prepare("SELECT publication_hold FROM spots WHERE spot_id = ?").bind(spotId).first<{ publication_hold: string | null }>();
  if (after?.publication_hold !== HOLD_RELOCATION_UNDER_REVIEW) {
    throw new RelocationHoldError(`relocation hold: spot ${spotId} is held as ${after?.publication_hold ?? "nothing"} after holding`);
  }
  return { status: "held", spotId, reviewItemId, tileId: spot.tile_id };
}
