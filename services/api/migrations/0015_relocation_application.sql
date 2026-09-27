-- Reviewed relocation application (ADR-0009 decisions 4-7, Implementation plan step C, Issue #97).
--
-- review_relocation_applications  one append-only row per applied relocationConfirmed decision: the
--                                 relocationCandidate item, its exact v2 decision, the identity decision it
--                                 rests on, the item's own hold row (the hold it consumes), the spot, entity,
--                                 both records, the cited observations and their mapping version, the old and
--                                 new coordinate and tile, the relocation policy version, the executor version
--                                 and applied_at. It is the canonical before/after record of the move.
-- review_relocation_resolutions   one row per applied relocation the resolver consumed when it applied the
--                                 release the item was raised for (as review_removal_resolutions, 0012). It is
--                                 the audit of a completed consumption: its insert trigger requires the release
--                                 applied and current and the provenance already on the new record, so it is
--                                 the last statement of the resolver's batch, at most once per application.
--                                 The resolver never reads a relocation decision directly.
--
-- The move is not a separate statement. Inserting the application row IS the move: its insert trigger
-- re-checks the whole premise inside the statement, and its AFTER INSERT trigger then sets, in one UPDATE,
-- the new coordinate and tile and lifts this item's relocationUnderReview hold. So an application row never
-- exists without its move, and no row can authorize a later update (the #96 stale-row pattern).
--
-- spots_coordinate_requires_relocation_application makes that the only way an existing spot's coordinate or
-- tile changes (a spot INSERT still sets its initial coordinate). It re-evaluates the premise at the moment of
-- the change, through the same view as the insert trigger, and requires the change to be exactly the move an
-- application row names from exactly the coordinate it names. Once moved, the spot is no longer at the old
-- coordinate nor held, so the row authorizes nothing again. spots_relocation_hold_is_final (0014) is replaced
-- by the same rule: the hold is lifted only together with that move, never by a decision alone
-- (relocationRejected and deferred never lift it, ADR-0009 decision 4).
--
-- Trust boundary. The schema checks relational integrity of the cited rows (ids, records, releases, source,
-- one mapping version, coordinates, the other observed fields). It cannot know which mapping version is the
-- adapter's current one, cannot run the adapter's mapping on raw records, and does not compute Web Mercator
-- tiles. The executor (applyReviewedRelocation) therefore re-derives both observations from raw under the
-- current adapter.mappingVersion, requires them to equal the stored rows and the candidate, takes the new
-- coordinate from them, and derives new_tile_* with the shared tile function; the schema then pins the move
-- to the row's values and the spots CHECK pins tile_id to tile_z/x/y.

CREATE TABLE review_relocation_applications (
  review_relocation_application_id INTEGER PRIMARY KEY,
  -- One item is applied at most once, one decision at most once, and one hold row is consumed at most once.
  review_item_id               INTEGER NOT NULL UNIQUE REFERENCES review_items (review_item_id),
  review_decision_id           INTEGER NOT NULL UNIQUE REFERENCES review_decisions (review_decision_id),
  -- The identity item's latest decision when applied; the relocation decision is newer than it.
  identity_review_decision_id  INTEGER NOT NULL REFERENCES review_decisions (review_decision_id),
  review_relocation_hold_id    INTEGER NOT NULL UNIQUE REFERENCES review_relocation_holds (review_relocation_hold_id),
  spot_id                      TEXT NOT NULL REFERENCES spots (spot_id),
  source_entity_id             INTEGER NOT NULL REFERENCES source_entities (source_entity_id),
  record_id                    INTEGER NOT NULL,
  release_id                   INTEGER NOT NULL,
  previous_record_id           INTEGER NOT NULL,
  previous_release_id          INTEGER NOT NULL,
  previous_observation_id      INTEGER NOT NULL REFERENCES source_observations (observation_id),
  new_observation_id           INTEGER NOT NULL REFERENCES source_observations (observation_id),
  mapping_version              TEXT NOT NULL,
  old_latitude                 REAL NOT NULL,
  old_longitude                REAL NOT NULL,
  old_tile_id                  TEXT NOT NULL,
  new_latitude                 REAL NOT NULL CHECK (new_latitude BETWEEN -90 AND 90),
  new_longitude                REAL NOT NULL CHECK (new_longitude BETWEEN -180 AND 180),
  new_tile_x                   INTEGER NOT NULL CHECK (new_tile_x BETWEEN 0 AND 16383),
  new_tile_y                   INTEGER NOT NULL CHECK (new_tile_y BETWEEN 0 AND 16383),
  new_tile_id                  TEXT NOT NULL,
  relocation_policy_version    TEXT NOT NULL,
  -- Only 'review-relocation-application.v1' exists (checked by the insert trigger); a v2 replaces that
  -- trigger in its own migration.
  executor_version             TEXT NOT NULL CHECK (executor_version <> ''),
  applied_at                   TEXT NOT NULL,
  FOREIGN KEY (record_id, release_id) REFERENCES source_records (record_id, release_id),
  FOREIGN KEY (previous_record_id, previous_release_id) REFERENCES source_records (record_id, release_id),
  -- spots.tile_z is 14 (0001).
  CHECK (new_tile_id = '14/' || new_tile_x || '/' || new_tile_y)
);

-- The candidates whose relocationConfirmed decision may be applied now, with every value the application
-- must name. Each item is re-read against its own stored ids and details (the premise of 0013/0014), plus:
--   decision   the item's LATEST decision is review-decision.v2 relocationConfirmed, and its
--              review_decision_id is greater than the identity item's latest decision's, which is still a
--              v1 matchedToEntity of the item's entity. review_decision_id is the append-only precedence
--              key; decided_at is never used. Re-recording the identity (even the same entity) makes every
--              earlier relocation decision stale: a newer one is needed;
--   values     the two cited observations differ in the coordinate only (no value-update policy), and the
--              item recorded no other changed field;
--   hold       the item's own review_relocation_holds row exists for this spot, the spot is held
--              relocationUnderReview, and no other item's hold row on the spot is unconsumed (a hold whose
--              owner is ambiguous is not lifted by anyone);
--   spot       linked to the item's entity of this source, active, unmerged and still at the old coordinate;
--   stale      as in 0010-0014: the previous release is current and applied with the cited fingerprint, the
--              release is still ingested with the item's fingerprint, and no other unrejected release of the
--              source is newer than the current one (an unknown observed_on is not comparable: refused).
-- The view reads spots as they are; inside a BEFORE UPDATE trigger on spots that is the row before the update.
CREATE VIEW review_relocation_application_premises AS
  SELECT i.review_item_id, i.spot_id, i.source_entity_id, i.record_id, i.release_id, i.previous_release_id,
    po.record_id AS previous_record_id, po.observation_id AS previous_observation_id,
    nw.observation_id AS new_observation_id, po.mapping_version,
    po.latitude AS old_latitude, po.longitude AS old_longitude, nw.latitude AS new_latitude, nw.longitude AS new_longitude,
    d.review_decision_id, identity_latest.review_decision_id AS identity_review_decision_id, h.review_relocation_hold_id
  FROM review_items i
  JOIN review_decisions d ON d.review_decision_id =
    (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
  JOIN review_items a ON a.review_item_id = json_extract(i.details_json, '$.identity.reviewItemId')
  JOIN review_decisions identity_latest ON identity_latest.review_decision_id =
    (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = a.review_item_id)
  JOIN review_relocation_holds h ON h.review_item_id = i.review_item_id AND h.spot_id = i.spot_id
  JOIN source_observations po ON po.observation_id = json_extract(i.details_json, '$.previousObservationId')
  JOIN source_observations nw ON nw.observation_id = json_extract(i.details_json, '$.newObservationId')
  JOIN spots s ON s.spot_id = i.spot_id
  WHERE i.kind = 'relocationCandidate'
    AND json_extract(i.details_json, '$.identity.method') = 'reviewedMatch'
    AND json_extract(i.details_json, '$.relocationPolicyVersion') = 'relocation-policy.v1'
    AND json_type(i.details_json, '$.thresholdVersion') = 'null'
    AND json_extract(i.details_json, '$.matcherVersion') IS i.matcher_version
    AND json_type(i.details_json, '$.identity.reviewItemId') = 'integer'
    AND d.decision = 'relocationConfirmed' AND d.decision_version = 'review-decision.v2' AND d.source_entity_id IS NULL
    AND a.kind = 'ambiguousMatch' AND a.source_id = i.source_id AND a.release_id = i.release_id
    AND a.previous_release_id = i.previous_release_id AND a.matcher_version = i.matcher_version
    AND a.record_id = i.record_id
    AND i.source_entity_id IN (SELECT value FROM json_each(a.details_json, '$.candidateEntityIds'))
    AND identity_latest.decision = 'matchedToEntity' AND identity_latest.decision_version = 'review-decision.v1'
    AND identity_latest.source_entity_id = i.source_entity_id
    AND d.review_decision_id > identity_latest.review_decision_id
    AND json_type(i.details_json, '$.previousRecordId') = 'integer'
    AND EXISTS (SELECT 1 FROM source_record_entities e
      WHERE e.record_id = json_extract(i.details_json, '$.previousRecordId')
        AND e.release_id = i.previous_release_id AND e.source_entity_id = i.source_entity_id)
    AND json_type(i.details_json, '$.mappingVersion') = 'text'
    AND json_type(i.details_json, '$.previousObservationId') = 'integer'
    AND json_type(i.details_json, '$.newObservationId') = 'integer'
    AND po.record_id = json_extract(i.details_json, '$.previousRecordId') AND po.release_id = i.previous_release_id
    AND po.source_id = i.source_id AND po.mapping_version = json_extract(i.details_json, '$.mappingVersion')
    AND po.latitude = json_extract(i.details_json, '$.previousCoordinate.latitude')
    AND po.longitude = json_extract(i.details_json, '$.previousCoordinate.longitude')
    AND nw.record_id = i.record_id AND nw.release_id = i.release_id
    AND nw.source_id = i.source_id AND nw.mapping_version = po.mapping_version
    AND nw.latitude = json_extract(i.details_json, '$.newCoordinate.latitude')
    AND nw.longitude = json_extract(i.details_json, '$.newCoordinate.longitude')
    AND NOT (po.latitude = nw.latitude AND po.longitude = nw.longitude)
    AND po.name IS nw.name AND po.supports_paper IS nw.supports_paper AND po.supports_heated IS nw.supports_heated
    AND po.opening_hours_raw IS nw.opening_hours_raw AND po.opening_hours_json IS nw.opening_hours_json
    AND po.opening_hours_status IS nw.opening_hours_status AND po.lifecycle_claim IS nw.lifecycle_claim
    AND po.field_provenance_json IS nw.field_provenance_json
    AND json_type(i.details_json, '$.otherChangedFields') = 'array'
    AND json_array_length(i.details_json, '$.otherChangedFields') = 0
    AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold = 'relocationUnderReview'
    AND s.latitude = po.latitude AND s.longitude = po.longitude
    AND EXISTS (SELECT 1 FROM spot_source_entities l JOIN source_entities se ON se.source_entity_id = l.source_entity_id
      WHERE l.source_entity_id = i.source_entity_id AND l.spot_id = i.spot_id AND se.source_id = i.source_id)
    AND NOT EXISTS (SELECT 1 FROM review_relocation_holds other
      WHERE other.spot_id = i.spot_id AND other.review_relocation_hold_id <> h.review_relocation_hold_id
        AND NOT EXISTS (SELECT 1 FROM review_relocation_applications x WHERE x.review_relocation_hold_id = other.review_relocation_hold_id))
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

CREATE TRIGGER review_relocation_applications_valid
BEFORE INSERT ON review_relocation_applications
WHEN NEW.executor_version IS NOT 'review-relocation-application.v1'
  OR NEW.relocation_policy_version IS NOT 'relocation-policy.v1'
  OR NOT EXISTS (SELECT 1 FROM review_relocation_application_premises v JOIN spots s ON s.spot_id = v.spot_id
    WHERE v.review_item_id = NEW.review_item_id AND v.review_decision_id = NEW.review_decision_id
      AND v.identity_review_decision_id = NEW.identity_review_decision_id
      AND v.review_relocation_hold_id = NEW.review_relocation_hold_id
      AND v.spot_id = NEW.spot_id AND v.source_entity_id = NEW.source_entity_id
      AND v.record_id = NEW.record_id AND v.release_id = NEW.release_id
      AND v.previous_record_id = NEW.previous_record_id AND v.previous_release_id = NEW.previous_release_id
      AND v.previous_observation_id = NEW.previous_observation_id AND v.new_observation_id = NEW.new_observation_id
      AND v.mapping_version = NEW.mapping_version
      AND v.old_latitude = NEW.old_latitude AND v.old_longitude = NEW.old_longitude
      AND v.new_latitude = NEW.new_latitude AND v.new_longitude = NEW.new_longitude
      AND s.tile_id = NEW.old_tile_id)
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_applications: not the current, latest relocationConfirmed decision of a held relocationCandidate (identity, decision order, hold, observations, spot or comparison)');
END;

-- The move itself, in the statement that records it. updated_at, provenance and last_verified_at stay: they
-- move when the resolver applies the release (ADR-0009 decision 5). The spot is unpublished (held), so no
-- snapshot row blocks the tile change; publishTiles adds it to its new tile once the release is applied.
CREATE TRIGGER review_relocation_applications_move
AFTER INSERT ON review_relocation_applications
BEGIN
  UPDATE spots SET latitude = NEW.new_latitude, longitude = NEW.new_longitude,
    tile_x = NEW.new_tile_x, tile_y = NEW.new_tile_y, tile_id = NEW.new_tile_id, publication_hold = NULL
  WHERE spot_id = NEW.spot_id;
END;

CREATE TRIGGER review_relocation_applications_immutable
BEFORE UPDATE ON review_relocation_applications
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_applications are immutable');
END;

CREATE TRIGGER review_relocation_applications_no_delete
BEFORE DELETE ON review_relocation_applications
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_applications are immutable');
END;

-- An existing spot's coordinate or tile changes only as exactly the move an application row names, from
-- exactly its old coordinate and tile, while that row's premise still holds, and together with lifting that
-- item's hold (lifecycle and merge unchanged). Spot INSERT is not affected.
CREATE TRIGGER spots_coordinate_requires_relocation_application
BEFORE UPDATE OF latitude, longitude, tile_z, tile_x, tile_y, tile_id ON spots
WHEN NOT (NEW.latitude IS OLD.latitude AND NEW.longitude IS OLD.longitude AND NEW.tile_z IS OLD.tile_z
    AND NEW.tile_x IS OLD.tile_x AND NEW.tile_y IS OLD.tile_y AND NEW.tile_id IS OLD.tile_id)
  AND NOT (NEW.publication_hold IS NULL AND NEW.lifecycle IS OLD.lifecycle AND NEW.merged_into IS OLD.merged_into
    AND EXISTS (SELECT 1 FROM review_relocation_applications a
      JOIN review_relocation_application_premises v ON v.review_item_id = a.review_item_id
        AND v.review_decision_id = a.review_decision_id AND v.identity_review_decision_id = a.identity_review_decision_id
        AND v.review_relocation_hold_id = a.review_relocation_hold_id AND v.spot_id = a.spot_id
        AND v.previous_observation_id = a.previous_observation_id AND v.new_observation_id = a.new_observation_id
      WHERE a.spot_id = OLD.spot_id
        AND OLD.latitude = a.old_latitude AND OLD.longitude = a.old_longitude AND OLD.tile_id = a.old_tile_id
        AND NEW.latitude = a.new_latitude AND NEW.longitude = a.new_longitude
        AND NEW.tile_x = a.new_tile_x AND NEW.tile_y = a.new_tile_y AND NEW.tile_id = a.new_tile_id))
BEGIN
  SELECT RAISE(ABORT, 'spots: a coordinate or tile changes only through a reviewed relocation application whose premise is still current');
END;

DROP TRIGGER spots_relocation_hold_is_final;

-- Replaces 0014's: the hold is lifted only by its item's reviewed relocationConfirmed application, as part of
-- exactly that application's move (checked as above). No decision and no other update lifts or replaces it.
CREATE TRIGGER spots_relocation_hold_is_final
BEFORE UPDATE OF publication_hold ON spots
WHEN OLD.publication_hold = 'relocationUnderReview' AND NEW.publication_hold IS NOT 'relocationUnderReview'
  AND NOT (NEW.publication_hold IS NULL AND NEW.lifecycle IS OLD.lifecycle AND NEW.merged_into IS OLD.merged_into
    AND EXISTS (SELECT 1 FROM review_relocation_applications a
      JOIN review_relocation_application_premises v ON v.review_item_id = a.review_item_id
        AND v.review_decision_id = a.review_decision_id AND v.identity_review_decision_id = a.identity_review_decision_id
        AND v.review_relocation_hold_id = a.review_relocation_hold_id AND v.spot_id = a.spot_id
        AND v.previous_observation_id = a.previous_observation_id AND v.new_observation_id = a.new_observation_id
      WHERE a.spot_id = OLD.spot_id
        AND OLD.latitude = a.old_latitude AND OLD.longitude = a.old_longitude AND OLD.tile_id = a.old_tile_id
        AND NEW.latitude = a.new_latitude AND NEW.longitude = a.new_longitude
        AND NEW.tile_x = a.new_tile_x AND NEW.tile_y = a.new_tile_y AND NEW.tile_id = a.new_tile_id))
BEGIN
  SELECT RAISE(ABORT, 'spots: a relocationUnderReview hold is lifted only by its reviewed relocation application');
END;

CREATE TABLE review_relocation_resolutions (
  review_relocation_resolution_id   INTEGER PRIMARY KEY,
  release_id                        INTEGER NOT NULL REFERENCES source_releases (release_id),
  previous_release_id               INTEGER NOT NULL REFERENCES source_releases (release_id),
  -- An application, and so its item, is consumed at most once.
  review_relocation_application_id  INTEGER NOT NULL UNIQUE
    REFERENCES review_relocation_applications (review_relocation_application_id),
  review_item_id                    INTEGER NOT NULL UNIQUE REFERENCES review_items (review_item_id),
  spot_id                           TEXT NOT NULL REFERENCES spots (spot_id),
  -- Only 'review-relocation-resolution.v1' exists (checked by the insert trigger).
  resolver_version                  TEXT NOT NULL CHECK (resolver_version <> ''),
  applied_at                        TEXT NOT NULL
);

-- The evidence that the resolver consumed an application: the release the item was raised for is applied,
-- the new record continues the application's entity in it, and the spot's existence evidence no longer cites
-- the previous record but a record of an applied release. Only the resolver's batch writes all of these
-- (applyReviewedRelocation writes none), and none of them is undone by a later release: a later release moves
-- the provenance on to its own record and the current flag on to itself, but the release stays applied, the
-- link stays and the provenance never returns to the previous record. So this is both the durable half of the
-- insert premise below and what pending_relocation_applications requires besides the resolution row.
CREATE VIEW review_relocation_consumption_evidence AS
  SELECT a.review_relocation_application_id, a.review_item_id, a.spot_id, a.release_id, a.previous_release_id
  FROM review_relocation_applications a
  JOIN source_releases r ON r.release_id = a.release_id
  JOIN spot_field_provenance p ON p.spot_id = a.spot_id AND p.field = 'existence'
  JOIN source_records pr ON pr.record_id = p.record_id
  JOIN source_releases prel ON prel.release_id = pr.release_id
  WHERE r.status = 'applied'
    AND EXISTS (SELECT 1 FROM source_record_entities e WHERE e.record_id = a.record_id AND e.release_id = a.release_id
      AND e.source_entity_id = a.source_entity_id)
    AND p.record_id <> a.previous_record_id AND prel.status = 'applied'
    AND NOT EXISTS (SELECT 1 FROM spot_field_provenance old WHERE old.spot_id = a.spot_id AND old.record_id = a.previous_record_id);

-- The completed consumption as it is at the end of the resolver's batch: the durable evidence above, plus what
-- holds only at that moment. The application is this comparison's item's, its relocationConfirmed decision is
-- still the item's latest, the identity decision it rests on is still the identity item's latest (so still
-- older than the relocation decision), the spot is where the application moved it, unheld, active and
-- unmerged, the release is now the source's current one with the item's fingerprint, the previous release is
-- applied with the cited fingerprint and no longer current, and the existence evidence cites exactly the new
-- record, and no other unrejected release of the source is newer. A decision recorded after the application (relocationRejected, a re-recorded identity) aborts the
-- release; so does a resolution written before the batch moved the evidence and the current release.
CREATE VIEW review_relocation_resolution_premises AS
  SELECT a.review_relocation_application_id, a.review_item_id, a.spot_id, a.release_id, a.previous_release_id
  FROM review_relocation_applications a
  JOIN review_relocation_consumption_evidence c ON c.review_relocation_application_id = a.review_relocation_application_id
  JOIN review_items i ON i.review_item_id = a.review_item_id
  JOIN spots s ON s.spot_id = a.spot_id
  WHERE i.kind = 'relocationCandidate' AND i.spot_id = a.spot_id
    AND i.release_id = a.release_id AND i.previous_release_id = a.previous_release_id
    AND a.review_decision_id = (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
    AND a.identity_review_decision_id = (SELECT max(review_decision_id) FROM review_decisions
      WHERE review_item_id = json_extract(i.details_json, '$.identity.reviewItemId'))
    AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL
    AND s.latitude = a.new_latitude AND s.longitude = a.new_longitude AND s.tile_id = a.new_tile_id
    AND EXISTS (SELECT 1 FROM spot_source_entities l WHERE l.source_entity_id = a.source_entity_id AND l.spot_id = a.spot_id)
    AND EXISTS (SELECT 1 FROM spot_field_provenance p WHERE p.spot_id = a.spot_id AND p.field = 'existence'
      AND p.record_id = a.record_id)
    AND EXISTS (SELECT 1 FROM source_releases p WHERE p.release_id = i.previous_release_id
      AND p.source_id = i.source_id AND p.status = 'applied' AND p.is_current = 0
      AND p.content_sha256 IS json_extract(i.details_json, '$.previousReleaseContentSha256'))
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = i.release_id
      AND r.source_id = i.source_id AND r.status = 'applied' AND r.is_current = 1 AND r.content_sha256 = i.release_content_sha256)
    AND NOT EXISTS (
      SELECT 1 FROM source_releases o, source_releases p
      WHERE p.release_id = i.previous_release_id
        AND o.source_id = i.source_id AND o.release_id NOT IN (i.release_id, i.previous_release_id)
        AND o.status <> 'rejected'
        AND (o.observed_on IS NULL OR p.observed_on IS NULL OR o.observed_on > p.observed_on));

-- A resolution row is the audit of a completed consumption, so the resolver writes it last in its batch,
-- after the evidence and the current release moved; it cannot be written before (nor by anyone else before).
CREATE TRIGGER review_relocation_resolutions_valid
BEFORE INSERT ON review_relocation_resolutions
WHEN NEW.resolver_version IS NOT 'review-relocation-resolution.v1'
  OR NOT EXISTS (SELECT 1 FROM review_relocation_resolution_premises v
    WHERE v.review_relocation_application_id = NEW.review_relocation_application_id
      AND v.review_item_id = NEW.review_item_id AND v.spot_id = NEW.spot_id
      AND v.release_id = NEW.release_id AND v.previous_release_id = NEW.previous_release_id)
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_resolutions: not a completed consumption of a current relocation application (decision, identity, spot, release or evidence not applied)');
END;

CREATE TRIGGER review_relocation_resolutions_immutable
BEFORE UPDATE ON review_relocation_resolutions
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_resolutions are immutable');
END;

CREATE TRIGGER review_relocation_resolutions_no_delete
BEFORE DELETE ON review_relocation_resolutions
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_resolutions are immutable');
END;

-- An application is pending from its insert (the move, which lifts the hold) until the resolver consumed it:
-- the batch that applies the release, moves the provenance to the new record and, last, writes the resolution
-- row. In between, the spot is at its new coordinate, unheld, and its existence evidence is still the previous
-- release: publishing it would show the new coordinate on the old evidence. The resolution row alone does not
-- end it: the consumption evidence must hold too, so a resolution row that got in without its trigger still
-- fences. Both are durable, so a consumed application never fences again and a later relocation of the same
-- spot is fenced only while it is pending. publishTiles reads this view too, so the query and the trigger
-- share one definition.
CREATE VIEW pending_relocation_applications AS
  SELECT a.review_relocation_application_id, a.spot_id
  FROM review_relocation_applications a
  WHERE NOT EXISTS (SELECT 1 FROM review_relocation_resolutions r
    JOIN review_relocation_consumption_evidence c ON c.review_relocation_application_id = r.review_relocation_application_id
      AND c.review_item_id = r.review_item_id AND c.spot_id = r.spot_id
      AND c.release_id = r.release_id AND c.previous_release_id = r.previous_release_id
    WHERE r.review_relocation_application_id = a.review_relocation_application_id);

DROP TRIGGER tile_snapshot_spots_publication_invariant;

-- As in 0014, plus: no pending relocation application on the spot.
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
    AND NOT EXISTS (SELECT 1 FROM pending_relocation_applications x WHERE x.spot_id = s.spot_id)
)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: spot is not publishable (ADR-0006: active, unmerged, not held, no pending relocation application, in this tile, accepted existence evidence from an approved source)');
END;
