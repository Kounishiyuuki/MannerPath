-- Relocation hold (ADR-0009 decision 4, Implementation plan step B, Issue #95).
--
-- relocationUnderReview    a new spots.publication_hold value: evidence exists that the published
--                          coordinate may be wrong (an open relocationCandidate, 0013), so the spot is
--                          withheld until the relocation review is resolved. It is not a claim that the
--                          place moved, and it is distinct from locationSuperseded (0004), whose meaning
--                          is unchanged. Nothing else of the spot changes: coordinate, tile, id,
--                          lifecycle, links, provenance and review rows stay as they are.
-- review_relocation_holds  one append-only row per held candidate: the item, its spot, when, and by
--                          which executor version. It is the audit link between review evidence (0013)
--                          and the hold; a relocationUnderReview hold requires its row.
--
-- The hold step (holdRelocationCandidate) writes, in one batch: this row, whose insert trigger re-checks
-- the candidate's premise inside the statement as 0010-0013 do; the spot's unpublication; then the hold
-- (ADR-0006 decision 11: unpublish first, which spots_published_stay_publishable enforces). No review
-- decision is required, consumed or written. Lifting the hold is a later reviewed step (0015); until then
-- no update lifts it, and a relocationRejected or deferred decision never does (ADR-0009 decision 4).
--
-- The CHECK of publication_hold cannot be altered, and spots cannot be rebuilt once it has rows (0002:
-- D1 cannot switch foreign keys off). The column is therefore replaced in place, which keeps the table,
-- its rows, rowids, foreign keys and column order (publication_hold is its last column): rename it, add
-- the new column with the widened CHECK, copy the values, drop the old one. The three triggers that read
-- the column are dropped first (a rename would rewrite them to the old name, and a column a trigger
-- names cannot be dropped) and recreated unchanged afterwards. Nothing updates spots between the drop
-- and the recreation, so the copy is not guarded by them; no other trigger fires on it.

DROP TRIGGER spots_published_stay_publishable;
DROP TRIGGER tile_snapshot_spots_publication_invariant;
DROP TRIGGER review_items_relocation_premise;

ALTER TABLE spots RENAME COLUMN publication_hold TO publication_hold_0004;
ALTER TABLE spots ADD COLUMN publication_hold TEXT
  CHECK (publication_hold IS NULL OR publication_hold IN ('locationSuperseded', 'relocationUnderReview'));
UPDATE spots SET publication_hold = publication_hold_0004 WHERE publication_hold_0004 IS NOT NULL;
ALTER TABLE spots DROP COLUMN publication_hold_0004;

-- Unchanged from 0004.
CREATE TRIGGER spots_published_stay_publishable
BEFORE UPDATE OF lifecycle, merged_into, tile_id, publication_hold ON spots
WHEN EXISTS (SELECT 1 FROM tile_snapshot_spots WHERE spot_id = NEW.spot_id)
  AND (NEW.lifecycle <> 'active' OR NEW.merged_into IS NOT NULL OR NEW.tile_id <> OLD.tile_id
       OR NEW.publication_hold IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'spots: unpublish this spot from its tile before changing lifecycle, merge, tile or publication hold');
END;

-- As in 0001/0002, plus `s.publication_hold IS NULL`: a held spot cannot enter a tile snapshot.
CREATE TRIGGER tile_snapshot_spots_publication_invariant
BEFORE INSERT ON tile_snapshot_spots
WHEN NOT EXISTS (
  SELECT 1
  FROM spots s
  JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
  JOIN source_records r ON r.record_id = p.record_id
  JOIN source_releases rel ON rel.release_id = r.release_id
  JOIN sources src ON src.source_id = rel.source_id
  WHERE s.spot_id = NEW.spot_id
    AND s.lifecycle = 'active'
    AND s.merged_into IS NULL
    AND s.publication_hold IS NULL
    AND s.tile_id = NEW.tile_id
    AND rel.status = 'applied'
    AND src.publication_status = 'approved'
)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: spot is not publishable (ADR-0006: active, unmerged, not held, in this tile, accepted existence evidence from an approved source)');
END;

-- Unchanged from 0013.
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

CREATE TABLE review_relocation_holds (
  review_relocation_hold_id  INTEGER PRIMARY KEY,
  -- One item holds at most once. A spot is not UNIQUE here: the insert trigger requires it unheld, and
  -- a hold is never lifted in this version, so it cannot be held twice.
  review_item_id             INTEGER NOT NULL UNIQUE REFERENCES review_items (review_item_id),
  spot_id                    TEXT NOT NULL REFERENCES spots (spot_id),
  -- Only 'review-relocation-hold.v1' exists (checked by the insert trigger); a v2 replaces that trigger
  -- in its own migration.
  executor_version           TEXT NOT NULL CHECK (executor_version <> ''),
  applied_at                 TEXT NOT NULL
);

-- The premise 0013 checked when the candidate was raised, re-read as it is now: the candidates a hold may
-- be written for and set from. One view read by both the row's insert trigger and the spot's hold
-- transition, so the two checks cannot drift apart and a row whose premise went stale after its insert
-- cannot set a hold. Each item is re-read against its own stored ids and details, so a decision recorded
-- after the executor read the queue, link or spot drift, or a stale comparison aborts the whole batch:
--   item       a relocationCandidate naming this spot, under relocation-policy.v1 with no threshold;
--   identity   its ambiguousMatch item of the same comparison and record, whose LATEST decision is still
--              a review-decision.v1 matchedToEntity choosing the item's entity (the actionability rule of
--              0013; the item's own v2 decisions are irrelevant: a hold needs no relocation decision);
--   records    the previous record is the entity's record in the previous release, and the cited
--              observation rows exist exactly (ids, records, releases, source, one shared mapping version)
--              with the copied, differing coordinates. As in 0013 this is relational integrity only: the
--              schema cannot know the adapter's current mapping version, so the executor binds the
--              candidate to it before writing;
--   spot       the entity is this source's and is linked to the spot, which is active, unmerged, not held
--              (an existing hold, locationSuperseded included, is never overwritten) and still at the
--              previous coordinate;
--   stale      as in 0010-0013: the previous release is the source's current applied release with the
--              cited fingerprint, the release is still under review with the item's fingerprint, and no
--              other unrejected release of the source is newer than the current one (an unknown
--              observed_on is not comparable: refused).
CREATE VIEW review_relocation_hold_premises AS
  SELECT i.review_item_id, i.spot_id FROM review_items i
  WHERE i.kind = 'relocationCandidate'
    AND json_extract(i.details_json, '$.identity.method') = 'reviewedMatch'
    AND json_extract(i.details_json, '$.relocationPolicyVersion') = 'relocation-policy.v1'
    AND json_type(i.details_json, '$.thresholdVersion') = 'null'
    AND json_extract(i.details_json, '$.matcherVersion') IS i.matcher_version
    AND json_type(i.details_json, '$.identity.reviewItemId') = 'integer'
    AND EXISTS (
      SELECT 1 FROM review_items a
      JOIN review_decisions latest ON latest.review_decision_id =
        (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = a.review_item_id)
      WHERE a.review_item_id = json_extract(i.details_json, '$.identity.reviewItemId')
        AND a.kind = 'ambiguousMatch' AND a.source_id = i.source_id AND a.release_id = i.release_id
        AND a.previous_release_id = i.previous_release_id AND a.matcher_version = i.matcher_version
        AND a.record_id = i.record_id
        AND i.source_entity_id IN (SELECT value FROM json_each(a.details_json, '$.candidateEntityIds'))
        AND latest.decision = 'matchedToEntity' AND latest.decision_version = 'review-decision.v1'
        AND latest.source_entity_id = i.source_entity_id)
    AND json_type(i.details_json, '$.previousRecordId') = 'integer'
    AND EXISTS (SELECT 1 FROM source_record_entities e
      WHERE e.record_id = json_extract(i.details_json, '$.previousRecordId')
        AND e.release_id = i.previous_release_id AND e.source_entity_id = i.source_entity_id)
    AND json_type(i.details_json, '$.mappingVersion') = 'text'
    AND json_type(i.details_json, '$.previousObservationId') = 'integer'
    AND json_type(i.details_json, '$.newObservationId') = 'integer'
    AND EXISTS (SELECT 1 FROM source_observations o
      WHERE o.observation_id = json_extract(i.details_json, '$.previousObservationId')
        AND o.record_id = json_extract(i.details_json, '$.previousRecordId') AND o.release_id = i.previous_release_id
        AND o.source_id = i.source_id AND o.mapping_version = json_extract(i.details_json, '$.mappingVersion')
        AND o.latitude = json_extract(i.details_json, '$.previousCoordinate.latitude')
        AND o.longitude = json_extract(i.details_json, '$.previousCoordinate.longitude'))
    AND EXISTS (SELECT 1 FROM source_observations o
      WHERE o.observation_id = json_extract(i.details_json, '$.newObservationId')
        AND o.record_id = i.record_id AND o.release_id = i.release_id
        AND o.source_id = i.source_id AND o.mapping_version = json_extract(i.details_json, '$.mappingVersion')
        AND o.latitude = json_extract(i.details_json, '$.newCoordinate.latitude')
        AND o.longitude = json_extract(i.details_json, '$.newCoordinate.longitude'))
    AND NOT (json_extract(i.details_json, '$.previousCoordinate.latitude') = json_extract(i.details_json, '$.newCoordinate.latitude')
      AND json_extract(i.details_json, '$.previousCoordinate.longitude') = json_extract(i.details_json, '$.newCoordinate.longitude'))
    AND EXISTS (SELECT 1 FROM spot_source_entities l
      JOIN spots s ON s.spot_id = l.spot_id
      JOIN source_entities se ON se.source_entity_id = l.source_entity_id
      WHERE l.source_entity_id = i.source_entity_id AND l.spot_id = i.spot_id AND se.source_id = i.source_id
        AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL
        AND s.latitude = json_extract(i.details_json, '$.previousCoordinate.latitude')
        AND s.longitude = json_extract(i.details_json, '$.previousCoordinate.longitude'))
    AND EXISTS (SELECT 1 FROM source_releases p WHERE p.release_id = i.previous_release_id
      AND p.source_id = i.source_id AND p.status = 'applied' AND p.is_current = 1
      AND p.content_sha256 IS json_extract(i.details_json, '$.previousReleaseContentSha256'))
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = i.release_id
      AND r.source_id = i.source_id AND r.status = 'ingested' AND r.content_sha256 = i.release_content_sha256)
    AND NOT EXISTS (
      SELECT 1 FROM source_releases o, source_releases p
      WHERE p.release_id = i.previous_release_id
        AND o.source_id = i.source_id AND o.release_id NOT IN (i.release_id, i.previous_release_id)
        AND o.status <> 'rejected'
        AND (o.observed_on IS NULL OR p.observed_on IS NULL OR o.observed_on > p.observed_on));

CREATE TRIGGER review_relocation_holds_valid
BEFORE INSERT ON review_relocation_holds
WHEN NEW.executor_version IS NOT 'review-relocation-hold.v1'
  OR NOT EXISTS (SELECT 1 FROM review_relocation_hold_premises v
    WHERE v.review_item_id = NEW.review_item_id AND v.spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_holds: not a current, actionable relocationCandidate for an active, unheld spot at its previous coordinate');
END;

CREATE TRIGGER review_relocation_holds_immutable
BEFORE UPDATE ON review_relocation_holds
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_holds are immutable');
END;

CREATE TRIGGER review_relocation_holds_no_delete
BEFORE DELETE ON review_relocation_holds
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_holds are immutable');
END;

-- relocationUnderReview is reached only through a recorded hold of that spot whose premise still holds.
-- A spot row cannot be created held: its hold row needs the spot first.
CREATE TRIGGER spots_relocation_hold_requires_row_on_insert
BEFORE INSERT ON spots
WHEN NEW.publication_hold = 'relocationUnderReview'
BEGIN
  SELECT RAISE(ABORT, 'spots: publication_hold relocationUnderReview requires a review_relocation_hold');
END;

-- The transition re-checks the premise too, through the same view: a hold row whose premise went stale
-- after its insert (identity re-decided, spot moved, release superseded) no longer qualifies, so it cannot
-- set a hold. The view reads the spot as it is before this update; the update itself may change nothing
-- the premise reads (coordinate, tile, lifecycle, merge).
CREATE TRIGGER spots_relocation_hold_requires_row
BEFORE UPDATE OF publication_hold ON spots
WHEN NEW.publication_hold = 'relocationUnderReview' AND OLD.publication_hold IS NOT 'relocationUnderReview'
  AND NOT (NEW.latitude IS OLD.latitude AND NEW.longitude IS OLD.longitude AND NEW.tile_id IS OLD.tile_id
    AND NEW.lifecycle IS OLD.lifecycle AND NEW.merged_into IS OLD.merged_into
    AND EXISTS (SELECT 1 FROM review_relocation_holds h
      JOIN review_relocation_hold_premises v ON v.review_item_id = h.review_item_id AND v.spot_id = h.spot_id
      WHERE h.spot_id = NEW.spot_id))
BEGIN
  SELECT RAISE(ABORT, 'spots: publication_hold relocationUnderReview requires a review_relocation_hold whose relocationCandidate premise is still current');
END;

-- Only a reviewed relocation application lifts the hold (ADR-0009 decisions 4 and 5; not implemented,
-- 0015 replaces this trigger). No update lifts or replaces it, whatever the item's decisions.
CREATE TRIGGER spots_relocation_hold_is_final
BEFORE UPDATE OF publication_hold ON spots
WHEN OLD.publication_hold = 'relocationUnderReview' AND NEW.publication_hold IS NOT 'relocationUnderReview'
BEGIN
  SELECT RAISE(ABORT, 'spots: a relocationUnderReview hold is lifted only by a reviewed relocation application (not implemented)');
END;
