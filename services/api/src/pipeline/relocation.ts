// Relocation candidate detection (ADR-0009 decisions 1, 3 and 7, Implementation plan step A, Issue #93).
// Pure: the resolver (./resolve.ts) decides when a reviewed match's coordinate changed and persists the
// item; migration 0013 re-checks its premise on insert. Detecting a candidate moves nothing: holding
// and applying a relocation are later, separate steps.

import { haversineMeters } from "../geo/distance.ts";
import type { StoredObservation } from "./observe.ts";
import type { ReviewItemRow } from "./review-queue.ts";
import type { SourceObservation } from "./source-adapter.ts";

/** Stored in every relocationCandidate's details_json; policy v1 has no threshold (decision 3). */
export const RELOCATION_POLICY_VERSION = "relocation-policy.v1";

/** Exact numeric equality of the normalized, stored coordinates: no tolerance or epsilon. */
export const sameCoordinate = (a: SourceObservation, b: SourceObservation) =>
  a.latitude === b.latitude && a.longitude === b.longitude;

export interface ReviewedRelocation {
  recordId: number;
  sourceEntityId: number;
  spotId: string;
  previousRecordId: number;
  /** The ambiguousMatch item and its latest matchedToEntity decision that established identity. */
  reviewItemId: number;
  reviewDecisionId: number;
  /** The exact stored observations the resolver compared, both under `mappingVersion`. */
  previous: StoredObservation;
  next: StoredObservation;
  mappingVersion: string;
}

/**
 * The relocationCandidate item of one reviewed match whose coordinate changed. Its details depend only
 * on stored ids and observations, so re-running the same release yields the same item. The distance is
 * informational: nothing accepts, rejects or suppresses a candidate by it. Other changed fields are
 * recorded for audit only; a relocation never updates them. identity.reviewDecisionId is the decision
 * the candidate was first raised from (audit evidence); whether it is still actionable is decided by
 * the identity item's latest decision choosing the same entity, not by that id.
 */
export function relocationCandidate(r: ReviewedRelocation, matcherVersion: string, previousReleaseContentSha256: string): ReviewItemRow {
  const coordinate = (o: SourceObservation) => ({ latitude: o.latitude, longitude: o.longitude });
  const previous = r.previous.observation;
  const next = r.next.observation;
  const otherChangedFields = (Object.keys(previous) as (keyof SourceObservation)[])
    .filter((k) => k !== "latitude" && k !== "longitude" && JSON.stringify(previous[k]) !== JSON.stringify(next[k]));
  return {
    kind: "relocationCandidate",
    candidateKey: `record:${r.recordId}|entity:${r.sourceEntityId}`,
    recordId: r.recordId, sourceEntityId: r.sourceEntityId, spotId: r.spotId,
    details: {
      reason: "a reviewer matched this record to the entity, and its observed coordinate differs from the previous record's; the move is pending relocation review and nothing canonical changed",
      previousRecordId: r.previousRecordId,
      mappingVersion: r.mappingVersion,
      previousObservationId: r.previous.observationId,
      newObservationId: r.next.observationId,
      previousCoordinate: coordinate(previous),
      newCoordinate: coordinate(next),
      distanceMetres: haversineMeters(previous, next),
      otherChangedFields,
      identity: { method: "reviewedMatch", reviewItemId: r.reviewItemId, reviewDecisionId: r.reviewDecisionId },
      matcherVersion,
      relocationPolicyVersion: RELOCATION_POLICY_VERSION,
      thresholdVersion: null,
      previousReleaseContentSha256,
    },
  };
}
