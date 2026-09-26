-- Relocation candidates and their review vocabulary (ADR-0009 decisions 1, 3, 7 and "Review
-- vocabulary", Implementation plan step A, Issue #93).
--
-- relocationCandidate  a review item raised by the resolver when a record's identity was established
--                      without the coordinate (step A: a reviewer's latest matchedToEntity decision on
--                      an ambiguousMatch item) and its normalized, stored observation coordinate is
--                      not numerically equal to the previous record's. Detecting it writes no
--                      canonical row: no coordinate, tile, hold, link, provenance or release state.
-- review-decision.v2   the decision vocabulary of a relocationCandidate: relocationConfirmed,
--                      relocationRejected, deferred. v1 keeps its meaning and stays the only version of
--                      the other kinds. Recording a v2 decision changes nothing canonical; applying one
--                      (applyReviewedRelocation) is a later step with its own application table.
--
-- No new table: both kinds of row live in review_items / review_decisions (0009), whose kind and
-- decision triggers are replaced here as 0009 anticipates.

DROP TRIGGER review_items_kind;

-- A NULL previous_release_id would make the UNIQUE of review_items never match; every kind has one.
CREATE TRIGGER review_items_kind
BEFORE INSERT ON review_items
WHEN NOT (
  (NEW.kind = 'ambiguousMatch' AND NEW.previous_release_id IS NOT NULL AND NEW.record_id IS NOT NULL
    AND NEW.source_entity_id IS NULL AND NEW.spot_id IS NULL
    AND json_type(NEW.details_json, '$.candidateEntityIds') = 'array')
  -- Disappearance from a partial source is never removal evidence; only a complete source's is.
  OR (NEW.kind IN ('disappearance', 'removalCandidate') AND NEW.previous_release_id IS NOT NULL
    AND NEW.record_id IS NULL AND NEW.source_entity_id IS NOT NULL AND NEW.spot_id IS NOT NULL
    AND (NEW.kind = 'removalCandidate') = (NEW.source_completeness = 'complete'))
  -- The new record, the entity it continues and that entity's spot; one item per record and entity.
  OR (NEW.kind = 'relocationCandidate' AND NEW.previous_release_id IS NOT NULL AND NEW.record_id IS NOT NULL
    AND NEW.source_entity_id IS NOT NULL AND NEW.spot_id IS NOT NULL
    AND NEW.candidate_key = 'record:' || NEW.record_id || '|entity:' || NEW.source_entity_id)
)
BEGIN
  SELECT RAISE(ABORT, 'review_items: kind, involved ids or completeness are inconsistent');
END;

-- Re-reads, inside the insert, everything the resolver read to raise the candidate, so a decision
-- recorded after that read, link or spot drift, or a stale comparison aborts the insert:
--   identity   the details name an ambiguousMatch item of this exact comparison (source, release,
--              previous release, matcher version) for this record, and a review-decision.v1
--              matchedToEntity decision of that item choosing this entity among its candidates. That
--              decision id is creation evidence only: what makes the item actionable is that the
--              item's LATEST decision is still a v1 matchedToEntity choosing this same entity. Re-recording
--              the same choice keeps the item; any other latest decision (another entity, confirmedNew,
--              deferred) makes it not actionable, and an insert racing with such a decision aborts;
--   previous   the previous record is the entity's record in the previous release;
--   coordinate the details name the exact observation rows the resolver compared (observation id,
--              record, release, source and the one mapping version both were read under), their stored
--              coordinates are the copied ones and differ by exact numeric equality (no tolerance,
--              ADR-0009 decision 3), and the spot still holds the previous coordinate. An observation of
--              the same record under another mapping version is never used;
--   spot       the entity is linked to this spot, which is active, unmerged and not held (a held spot
--              is not relocated in v1; its hold is never overwritten here);
--   versions   relocation-policy.v1 with no threshold, the item's matcher version, and the previous
--              release's fingerprint;
--   stale      as in 0010-0012: the previous release is the source's current applied release, the
--              release is still under review, and no other unrejected release of the source is newer
--              than the current one (an unknown observed_on is not comparable: refused).
CREATE TRIGGER review_items_relocation_premise
BEFORE INSERT ON review_items
WHEN NEW.kind = 'relocationCandidate' AND NOT (
  json_extract(NEW.details_json, '$.identity.method') = 'reviewedMatch'
  AND json_extract(NEW.details_json, '$.relocationPolicyVersion') = 'relocation-policy.v1'
  AND json_type(NEW.details_json, '$.thresholdVersion') = 'null'
  AND json_extract(NEW.details_json, '$.matcherVersion') IS NEW.matcher_version
  AND EXISTS (
    SELECT 1 FROM review_items i JOIN review_decisions d ON d.review_item_id = i.review_item_id
    WHERE i.review_item_id = json_extract(NEW.details_json, '$.identity.reviewItemId')
      AND d.review_decision_id = json_extract(NEW.details_json, '$.identity.reviewDecisionId')
      AND json_type(NEW.details_json, '$.identity.reviewItemId') = 'integer'
      AND json_type(NEW.details_json, '$.identity.reviewDecisionId') = 'integer'
      AND i.kind = 'ambiguousMatch' AND i.source_id = NEW.source_id AND i.release_id = NEW.release_id
      AND i.previous_release_id = NEW.previous_release_id AND i.matcher_version = NEW.matcher_version
      AND i.record_id = NEW.record_id
      AND NEW.source_entity_id IN (SELECT value FROM json_each(i.details_json, '$.candidateEntityIds'))
      AND d.decision = 'matchedToEntity' AND d.decision_version = 'review-decision.v1'
      AND d.source_entity_id = NEW.source_entity_id
      AND EXISTS (SELECT 1 FROM review_decisions latest
        WHERE latest.review_decision_id = (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
          AND latest.decision = 'matchedToEntity' AND latest.decision_version = 'review-decision.v1'
          AND latest.source_entity_id = NEW.source_entity_id))
  AND json_type(NEW.details_json, '$.previousRecordId') = 'integer'
  AND EXISTS (SELECT 1 FROM source_record_entities e
    WHERE e.record_id = json_extract(NEW.details_json, '$.previousRecordId')
      AND e.release_id = NEW.previous_release_id AND e.source_entity_id = NEW.source_entity_id)
  AND json_type(NEW.details_json, '$.mappingVersion') = 'text'
  AND json_type(NEW.details_json, '$.previousObservationId') = 'integer'
  AND json_type(NEW.details_json, '$.newObservationId') = 'integer'
  AND EXISTS (SELECT 1 FROM source_observations o
    WHERE o.observation_id = json_extract(NEW.details_json, '$.previousObservationId')
      AND o.record_id = json_extract(NEW.details_json, '$.previousRecordId') AND o.release_id = NEW.previous_release_id
      AND o.source_id = NEW.source_id AND o.mapping_version = json_extract(NEW.details_json, '$.mappingVersion')
      AND o.latitude = json_extract(NEW.details_json, '$.previousCoordinate.latitude')
      AND o.longitude = json_extract(NEW.details_json, '$.previousCoordinate.longitude'))
  AND EXISTS (SELECT 1 FROM source_observations o
    WHERE o.observation_id = json_extract(NEW.details_json, '$.newObservationId')
      AND o.record_id = NEW.record_id AND o.release_id = NEW.release_id
      AND o.source_id = NEW.source_id AND o.mapping_version = json_extract(NEW.details_json, '$.mappingVersion')
      AND o.latitude = json_extract(NEW.details_json, '$.newCoordinate.latitude')
      AND o.longitude = json_extract(NEW.details_json, '$.newCoordinate.longitude'))
  AND NOT (json_extract(NEW.details_json, '$.previousCoordinate.latitude') = json_extract(NEW.details_json, '$.newCoordinate.latitude')
    AND json_extract(NEW.details_json, '$.previousCoordinate.longitude') = json_extract(NEW.details_json, '$.newCoordinate.longitude'))
  AND EXISTS (SELECT 1 FROM spot_source_entities l JOIN spots s ON s.spot_id = l.spot_id
    WHERE l.source_entity_id = NEW.source_entity_id AND l.spot_id = NEW.spot_id
      AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL
      AND s.latitude = json_extract(NEW.details_json, '$.previousCoordinate.latitude')
      AND s.longitude = json_extract(NEW.details_json, '$.previousCoordinate.longitude'))
  AND EXISTS (SELECT 1 FROM source_releases p WHERE p.release_id = NEW.previous_release_id
    AND p.source_id = NEW.source_id AND p.status = 'applied' AND p.is_current = 1
    AND p.content_sha256 IS json_extract(NEW.details_json, '$.previousReleaseContentSha256'))
  AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = NEW.release_id AND r.status = 'ingested')
  AND NOT EXISTS (
    SELECT 1 FROM source_releases o, source_releases p
    WHERE p.release_id = NEW.previous_release_id
      AND o.source_id = NEW.source_id AND o.release_id NOT IN (NEW.release_id, NEW.previous_release_id)
      AND o.status <> 'rejected'
      AND (o.observed_on IS NULL OR p.observed_on IS NULL OR o.observed_on > p.observed_on))
)
BEGIN
  SELECT RAISE(ABORT, 'review_items: relocationCandidate premise does not hold (identity decision, records, coordinates, spot or comparison)');
END;

DROP TRIGGER review_decisions_valid;

-- v1: exactly 0009's semantics, on the kinds 0009 knew. v2: only a relocationCandidate, only while its
-- identity ambiguousMatch item's latest decision is still a v1 matchedToEntity choosing the item's entity
-- (the same meaning as when it was raised; the decision id may be a later re-recording of it).
CREATE TRIGGER review_decisions_valid
BEFORE INSERT ON review_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM review_items i WHERE i.review_item_id = NEW.review_item_id
  AND ((NEW.decision_version = 'review-decision.v1' AND i.kind IN ('ambiguousMatch', 'disappearance', 'removalCandidate') AND (
    NEW.decision = 'deferred' AND NEW.source_entity_id IS NULL
    -- An ambiguous record continues one of its candidate entities, or is confirmed new.
    OR (i.kind = 'ambiguousMatch' AND NEW.decision = 'confirmedNew' AND NEW.source_entity_id IS NULL)
    OR (i.kind = 'ambiguousMatch' AND NEW.decision = 'matchedToEntity' AND NEW.source_entity_id IN
      (SELECT value FROM json_each(i.details_json, '$.candidateEntityIds')))
    -- A partial source's disappearance cannot be confirmed as a removal: it is not removal evidence.
    OR (i.kind IN ('disappearance', 'removalCandidate') AND NEW.decision = 'removalRejected' AND NEW.source_entity_id IS NULL)
    OR (i.kind = 'removalCandidate' AND NEW.decision = 'removalConfirmed' AND NEW.source_entity_id IS NULL)
  ))
  OR (NEW.decision_version = 'review-decision.v2' AND i.kind = 'relocationCandidate'
    AND NEW.decision IN ('relocationConfirmed', 'relocationRejected', 'deferred') AND NEW.source_entity_id IS NULL
    AND EXISTS (SELECT 1 FROM review_decisions latest
      WHERE latest.review_decision_id = (SELECT max(review_decision_id) FROM review_decisions
          WHERE review_item_id = json_extract(i.details_json, '$.identity.reviewItemId'))
        AND latest.decision = 'matchedToEntity' AND latest.decision_version = 'review-decision.v1'
        AND latest.source_entity_id = i.source_entity_id)))
)
BEGIN
  SELECT RAISE(ABORT, 'review_decisions: decision is not valid for this review item');
END;
