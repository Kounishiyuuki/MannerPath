-- Consuming applied reviewed removals in cross-release release finalization (ADR-0008 decisions 3, 5
-- and 8, Issue #89).
--
-- review_removal_resolutions  one row per previous entity that a release is applied without
--                             continuing, because that entity's spot was already removed through a
--                             reviewed removal (0010): which release, which previous release, the
--                             removalCandidate item, its exact decision, the exact
--                             review_removal_applications row, the entity and spot, when, and by which
--                             version. It is the audit link between an applied removal and the release
--                             that stopped listing the entity. It changes nothing canonical: the removal
--                             itself stays the executor's (0010); the resolver only writes this row, in
--                             the same batch as the release it applies, and only when the whole release
--                             is resolved.
--
-- The insert trigger re-reads, inside the statement, everything the resolver read, so a decision
-- recorded after that read, link drift, or a stale comparison aborts the whole batch, as in 0010/0011.
CREATE TABLE review_removal_resolutions (
  review_removal_resolution_id   INTEGER PRIMARY KEY,
  release_id                     INTEGER NOT NULL REFERENCES source_releases (release_id),
  previous_release_id            INTEGER NOT NULL REFERENCES source_releases (release_id),
  -- An item, a decision and an application are consumed at most once.
  review_item_id                 INTEGER NOT NULL UNIQUE REFERENCES review_items (review_item_id),
  review_decision_id             INTEGER NOT NULL UNIQUE REFERENCES review_decisions (review_decision_id),
  review_removal_application_id  INTEGER NOT NULL UNIQUE
    REFERENCES review_removal_applications (review_removal_application_id),
  source_entity_id               INTEGER NOT NULL REFERENCES source_entities (source_entity_id),
  spot_id                        TEXT NOT NULL REFERENCES spots (spot_id),
  -- Only 'review-removal-resolution.v1' exists (checked by the insert trigger); a v2 replaces that
  -- trigger in its own migration.
  resolver_version               TEXT NOT NULL CHECK (resolver_version <> ''),
  applied_at                     TEXT NOT NULL,
  UNIQUE (release_id, source_entity_id)
);

CREATE TRIGGER review_removal_resolutions_valid
BEFORE INSERT ON review_removal_resolutions
WHEN NOT EXISTS (
  SELECT 1
  FROM review_items i
  JOIN review_decisions d ON d.review_item_id = i.review_item_id
  JOIN review_removal_applications a ON a.review_removal_application_id = NEW.review_removal_application_id
  JOIN spots s ON s.spot_id = i.spot_id
  WHERE i.review_item_id = NEW.review_item_id
    AND d.review_decision_id = NEW.review_decision_id
    -- The item raised this exact comparison for this entity and spot.
    AND i.release_id = NEW.release_id AND i.previous_release_id = NEW.previous_release_id
    AND i.source_entity_id = NEW.source_entity_id AND i.spot_id = NEW.spot_id
    -- Only a complete source's removal candidate: a partial disappearance never resolves.
    AND i.kind = 'removalCandidate' AND i.source_completeness = 'complete'
    AND d.decision = 'removalConfirmed' AND d.decision_version = 'review-decision.v1'
    -- The decision must still be the item's latest.
    AND d.review_decision_id = (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
    -- The exact application of that decision, for that item and spot, exists: a decision alone is not enough.
    AND a.review_item_id = i.review_item_id AND a.review_decision_id = d.review_decision_id AND a.spot_id = i.spot_id
    AND a.executor_version = 'review-removal-executor.v1'
    AND s.lifecycle = 'removed' AND s.merged_into IS NULL
    -- Link drift since the application: the item's entity must still be linked to the spot, and
    -- (0010's temporary single-source gate) no other entity may be.
    AND EXISTS (SELECT 1 FROM spot_source_entities l WHERE l.spot_id = i.spot_id AND l.source_entity_id = i.source_entity_id)
    AND NOT EXISTS (SELECT 1 FROM spot_source_entities l WHERE l.spot_id = i.spot_id AND l.source_entity_id <> i.source_entity_id)
    AND NEW.resolver_version = 'review-removal-resolution.v1'
    -- Stale evidence, as in 0010/0011: the compared release is still the source's current applied
    -- release, the release being applied is still under review, and no other unrejected release of
    -- the source is newer than that current release (an unknown observed_on is not comparable: refused).
    AND EXISTS (SELECT 1 FROM source_releases p WHERE p.release_id = i.previous_release_id
      AND p.source_id = i.source_id AND p.status = 'applied' AND p.is_current = 1)
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = i.release_id AND r.status = 'ingested')
    AND NOT EXISTS (
      SELECT 1 FROM source_releases o, source_releases p
      WHERE p.release_id = i.previous_release_id
        AND o.source_id = i.source_id AND o.release_id NOT IN (i.release_id, i.previous_release_id)
        AND o.status <> 'rejected'
        AND (o.observed_on IS NULL OR p.observed_on IS NULL OR o.observed_on > p.observed_on))
)
BEGIN
  SELECT RAISE(ABORT, 'review_removal_resolutions: not the applied latest removalConfirmed decision of a current, single-source, complete removal candidate');
END;

CREATE TRIGGER review_removal_resolutions_immutable
BEFORE UPDATE ON review_removal_resolutions
BEGIN
  SELECT RAISE(ABORT, 'review_removal_resolutions are immutable');
END;

CREATE TRIGGER review_removal_resolutions_no_delete
BEFORE DELETE ON review_removal_resolutions
BEGIN
  SELECT RAISE(ABORT, 'review_removal_resolutions are immutable');
END;
