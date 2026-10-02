// Reviewed relocation application (ADR-0009 decision 5, Implementation plan step C, Issue #97): the explicit
// step that turns a relocationConfirmed decision on a held relocationCandidate into the canonical move. Recording
// the decision (./review-queue.ts) moves nothing, and holding (./relocation-hold.ts) only withholds; only this
// step moves, and only this item's hold is lifted. The resolver later consumes the application when it applies
// the release (./resolve.ts); until then provenance, last_verified_at and updated_at stay as they are. Run
// publishTiles after the release is applied: the spot is unpublished while held and enters its new tile then.

import { type Db, type DbStatement } from "../db.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../geo/tile.ts";
import { rederiveObservation } from "./observe.ts";
import { RELOCATION_POLICY_VERSION, sameCoordinate } from "./relocation.ts";
import { HOLD_RELOCATION_UNDER_REVIEW } from "./relocation-hold.ts";
import { RELOCATION_REVIEW_DECISION_VERSION, REVIEW_DECISION_VERSION } from "./review-queue.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const RELOCATION_APPLICATION_EXECUTOR_VERSION = "review-relocation-application.v1";

export type RelocationApplicationResult =
  | { status: "applied"; spotId: string; reviewItemId: number; reviewDecisionId: number; oldTileId: string; newTileId: string }
  /** This same decision was applied before; nothing was written. */
  | { status: "alreadyApplied"; spotId: string; reviewItemId: number; reviewDecisionId: number }
  /** The latest decision does not confirm the move, or there is none; nothing was written and the hold stays. */
  | { status: "notApplicable"; reviewItemId: number; reason: "noDecision" | "relocationRejected" | "deferred" };

export class RelocationApplicationError extends Error {}

interface ItemRow {
  kind: string; source_id: string; record_id: number | null; source_entity_id: number | null; spot_id: string | null;
  details_json: string; latest_decision_id: number | null; latest_decision: string | null; latest_version: string | null;
}

interface CandidateDetails {
  previousRecordId?: unknown; mappingVersion?: unknown; previousObservationId?: unknown; newObservationId?: unknown;
  previousCoordinate?: { latitude?: unknown; longitude?: unknown }; newCoordinate?: { latitude?: unknown; longitude?: unknown };
  otherChangedFields?: unknown; identity?: { reviewItemId?: unknown };
}

/**
 * Applies the latest decision of one relocationCandidate, if it is a fresh relocationConfirmed. It checks the
 * item, decision order and hold in code, re-derives both cited observations from raw under the adapter's current
 * mapping, then inserts one review_relocation_applications row. That insert is the move (migration 0015): its
 * trigger re-checks the premise inside the statement and then sets the new coordinate and tile and lifts this
 * item's hold in the same statement, so a decision or release recorded in between aborts it and nothing is left
 * half-applied.
 *
 * Idempotent for the same decision; fails closed on everything else: a stale decision (older than the identity
 * item's latest decision), a hold that is not this item's, a changed spot or comparison, a candidate that the
 * current mapping does not re-derive, or any observed field other than the coordinate that changed.
 */
export async function applyReviewedRelocation(
  db: Db, adapter: SourceAdapter, reviewItemId: number,
  /**
   * `areaAnchorDelta` and `prepend` exist only for ADR-0017's area→exact upgrade (./area-anchor.ts): the one other
   * observed delta it accepts is the location evidence itself (anchor claim gone, location provenance replaced), and the
   * upgrade row is written first in the same batch. The schema (0030) re-checks both.
   */
  opts: { now: string; prepend?: DbStatement[]; areaAnchorDelta?: boolean },
): Promise<RelocationApplicationResult> {
  const fail = (why: string) => new RelocationApplicationError(`relocation application: item ${reviewItemId}: ${why}`);
  const item = await db.prepare(
    `SELECT i.kind, i.source_id, i.record_id, i.source_entity_id, i.spot_id, i.details_json,
            d.review_decision_id AS latest_decision_id, d.decision AS latest_decision, d.decision_version AS latest_version
     FROM review_items i
     LEFT JOIN review_decisions d ON d.review_decision_id =
       (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
     WHERE i.review_item_id = ?`,
  ).bind(reviewItemId).first<ItemRow>();
  if (!item) throw fail("does not exist");
  if (item.kind !== "relocationCandidate" || item.record_id === null || item.source_entity_id === null || item.spot_id === null) {
    throw fail(`is a ${item.kind}, not a relocationCandidate`);
  }
  if (item.source_id !== adapter.registry.sourceId) throw fail(`belongs to ${item.source_id}, not to adapter source ${adapter.registry.sourceId}`);
  const spotId = item.spot_id;

  const existing = await db.prepare("SELECT review_decision_id FROM review_relocation_applications WHERE review_item_id = ?")
    .bind(reviewItemId).first<{ review_decision_id: number }>();
  if (existing) {
    if (existing.review_decision_id === item.latest_decision_id) {
      return { status: "alreadyApplied", spotId, reviewItemId, reviewDecisionId: existing.review_decision_id };
    }
    throw fail(`was applied on decision ${existing.review_decision_id}, but its latest decision is ${item.latest_decision_id}`);
  }

  if (item.latest_decision_id === null) return { status: "notApplicable", reviewItemId, reason: "noDecision" };
  if (item.latest_version !== RELOCATION_REVIEW_DECISION_VERSION) throw fail(`latest decision is ${item.latest_version}, not ${RELOCATION_REVIEW_DECISION_VERSION}`);
  if (item.latest_decision === "relocationRejected" || item.latest_decision === "deferred") {
    return { status: "notApplicable", reviewItemId, reason: item.latest_decision };
  }
  if (item.latest_decision !== "relocationConfirmed") throw fail(`has unexpected latest decision ${item.latest_decision}`);
  const decisionId = item.latest_decision_id;

  // Decision freshness: review_decision_id is the append-only precedence key (decided_at is never used). A
  // relocation decision answers the identity as it stood when it was recorded; any later identity decision,
  // even the same entity again, makes it stale and a newer relocation decision is needed.
  const details = JSON.parse(item.details_json) as CandidateDetails;
  const identity = await db.prepare(
    `SELECT review_decision_id, decision, decision_version, source_entity_id FROM review_decisions
     WHERE review_decision_id = (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = ?)`,
  ).bind(details.identity?.reviewItemId ?? null).first<{ review_decision_id: number; decision: string; decision_version: string; source_entity_id: number | null }>();
  if (!identity || identity.decision !== "matchedToEntity" || identity.decision_version !== REVIEW_DECISION_VERSION
    || identity.source_entity_id !== item.source_entity_id) {
    throw fail(`its identity item's latest decision is ${identity ? `${identity.decision_version} ${identity.decision}` : "missing"}, not matchedToEntity of entity ${item.source_entity_id}`);
  }
  if (decisionId <= identity.review_decision_id) {
    throw fail(`relocation decision ${decisionId} is older than identity decision ${identity.review_decision_id}; a new relocation decision is needed`);
  }

  // Hold ownership: this item's own hold row, not merely a relocationUnderReview spot.
  const hold = await db.prepare("SELECT review_relocation_hold_id, spot_id FROM review_relocation_holds WHERE review_item_id = ?")
    .bind(reviewItemId).first<{ review_relocation_hold_id: number; spot_id: string }>();
  if (!hold || hold.spot_id !== spotId) throw fail(`has no hold row of its own for spot ${spotId}`);
  const spot = await db.prepare("SELECT latitude, longitude, tile_id, lifecycle, merged_into, publication_hold FROM spots WHERE spot_id = ?")
    .bind(spotId).first<{ latitude: number; longitude: number; tile_id: string; lifecycle: string; merged_into: string | null; publication_hold: string | null }>();
  if (!spot) throw fail(`spot ${spotId} does not exist`);
  if (spot.publication_hold !== HOLD_RELOCATION_UNDER_REVIEW) throw fail(`spot ${spotId} is held as ${spot.publication_hold ?? "nothing"}, not ${HOLD_RELOCATION_UNDER_REVIEW}`);
  if (spot.lifecycle !== "active" || spot.merged_into !== null) throw fail(`spot ${spotId} is ${spot.lifecycle}${spot.merged_into ? ", merged" : ""}`);

  // Trust boundary (ADR-0009 step C): the schema checks the cited rows only. Before mutating, both observations
  // are re-derived from raw under the adapter's current mapping; the move uses the re-derived values, never the
  // copies in details_json.
  if (details.mappingVersion !== adapter.mappingVersion) throw fail(`cites mapping ${String(details.mappingVersion)}, not the adapter's ${adapter.mappingVersion}`);
  const rederive = async (recordId: unknown, observationId: unknown) => {
    if (typeof recordId !== "number") throw fail(`cites record ${String(recordId)}`);
    const o = await rederiveObservation(db, adapter, recordId).catch((e: Error) => { throw fail(e.message); });
    if (o.observationId !== observationId) throw fail(`cites observation ${String(observationId)} of record ${recordId}, not its ${adapter.mappingVersion} row ${o.observationId}`);
    return o;
  };
  const previous = await rederive(details.previousRecordId, details.previousObservationId);
  const next = await rederive(item.record_id, details.newObservationId);
  const coordinate = (o: SourceObservation) => ({ latitude: o.latitude, longitude: o.longitude });
  if (JSON.stringify(coordinate(previous.observation)) !== JSON.stringify(details.previousCoordinate)
    || JSON.stringify(coordinate(next.observation)) !== JSON.stringify(details.newCoordinate)) {
    throw fail("its cited coordinates are not the re-derived ones");
  }
  if (sameCoordinate(previous.observation, next.observation)) throw fail("the re-derived coordinates are equal");
  const others = (Object.keys(previous.observation) as (keyof SourceObservation)[])
    .filter((k) => k !== "latitude" && k !== "longitude" && JSON.stringify(previous.observation[k]) !== JSON.stringify(next.observation[k]));
  if (!(opts.areaAnchorDelta && isAreaAnchorDelta(previous.observation, next.observation, others, details.otherChangedFields))
    && (others.length > 0 || JSON.stringify(details.otherChangedFields) !== "[]")) {
    throw fail(`other observed fields changed (${others.join(", ") || String(details.otherChangedFields)}); a value update policy is not implemented`);
  }
  // The spot is still exactly where the previous observation put it: no canonical drift is carried along.
  const oldTile = formatTileId(tileForCoordinate(previous.observation.latitude, previous.observation.longitude, DATA_TILE_ZOOM));
  if (spot.latitude !== previous.observation.latitude || spot.longitude !== previous.observation.longitude || spot.tile_id !== oldTile) {
    throw fail(`spot ${spotId} is at ${spot.latitude},${spot.longitude} (${spot.tile_id}), not at the previous observation's coordinate`);
  }
  const newTile = tileForCoordinate(next.observation.latitude, next.observation.longitude, DATA_TILE_ZOOM);

  await db.batch([...(opts.prepend ?? []), db.prepare(
    `INSERT INTO review_relocation_applications (review_item_id, review_decision_id, identity_review_decision_id,
       review_relocation_hold_id, spot_id, source_entity_id, record_id, release_id, previous_record_id, previous_release_id,
       previous_observation_id, new_observation_id, mapping_version, old_latitude, old_longitude, old_tile_id,
       new_latitude, new_longitude, new_tile_x, new_tile_y, new_tile_id, relocation_policy_version, executor_version, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(reviewItemId, decisionId, identity.review_decision_id, hold.review_relocation_hold_id, spotId, item.source_entity_id,
    item.record_id, next.releaseId, previous.recordId, previous.releaseId, previous.observationId, next.observationId,
    adapter.mappingVersion, previous.observation.latitude, previous.observation.longitude, oldTile,
    next.observation.latitude, next.observation.longitude, newTile.x, newTile.y, formatTileId(newTile),
    RELOCATION_POLICY_VERSION, RELOCATION_APPLICATION_EXECUTOR_VERSION, opts.now)]);

  const after = await db.prepare("SELECT latitude, longitude, tile_id, publication_hold FROM spots WHERE spot_id = ?")
    .bind(spotId).first<{ latitude: number; longitude: number; tile_id: string; publication_hold: string | null }>();
  if (after?.latitude !== next.observation.latitude || after.longitude !== next.observation.longitude
    || after.tile_id !== formatTileId(newTile) || after.publication_hold !== null) {
    throw fail(`spot ${spotId} is not at the applied coordinate after applying`);
  }
  return { status: "applied", spotId, reviewItemId, reviewDecisionId: decisionId, oldTileId: oldTile, newTileId: formatTileId(newTile) };
}

/**
 * ADR-0017: the only non-coordinate delta an area→exact relocation may carry. The previous observation is anchored, the
 * next is not, and their provenance differs only in the `location` entry, which moves from that anchor's rule to a
 * non-anchor rule. Nothing else may differ.
 */
function isAreaAnchorDelta(previous: SourceObservation, next: SourceObservation, others: readonly string[], recorded: unknown): boolean {
  const set = (v: readonly unknown[]) => JSON.stringify([...v].map(String).sort());
  if (!Array.isArray(recorded) || set(recorded) !== set(["provenance", "locationAnchorId"]) || set(others) !== set(["provenance", "locationAnchorId"])) return false;
  if (previous.locationAnchorId === undefined || next.locationAnchorId !== undefined) return false;
  const loc = (o: SourceObservation) => o.provenance.find((p) => p.field === "location");
  const rest = (o: SourceObservation) => JSON.stringify(o.provenance.filter((p) => p.field !== "location"));
  return loc(previous)?.rule === `area-anchor.v1:${previous.locationAnchorId}` && loc(next) !== undefined
    && !loc(next)!.rule.startsWith("area-anchor.") && rest(previous) === rest(next);
}
