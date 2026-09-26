-- Applying a reviewed removal (ADR-0008 decisions 5 and 8, Issue #84).
--
-- review_removal_applications  one row per canonical removal, naming the review item and the exact
--                              review decision it applied, when, and by which executor version. It is
--                              the audit link between review evidence (0009) and the canonical
--                              mutation spots.lifecycle = 'removed'. Nothing else of the spot changes:
--                              its id, links, raw evidence and provenance stay.
--
-- The row is written by the removal executor in the same batch as the lifecycle change, and it is the
-- only way a spot becomes 'removed': spots_removed_requires_application refuses the lifecycle change
-- unless the application row already exists. The insert trigger re-reads the item's latest decision
-- (largest review_decision_id, as in 0009) inside the statement, so a decision recorded after the
-- executor read the queue makes the whole batch abort rather than apply a superseded decision.
CREATE TABLE review_removal_applications (
  review_removal_application_id INTEGER PRIMARY KEY,
  -- A spot is removed at most once; a second application for it (another decision) is refused.
  spot_id              TEXT NOT NULL UNIQUE REFERENCES spots (spot_id),
  review_item_id       INTEGER NOT NULL REFERENCES review_items (review_item_id),
  -- One decision is applied at most once.
  review_decision_id   INTEGER NOT NULL UNIQUE REFERENCES review_decisions (review_decision_id),
  -- Only 'review-removal-executor.v1' exists (checked by the insert trigger); a v2 replaces that
  -- trigger in its own migration, as 0009 does for review-decision.v1.
  executor_version     TEXT NOT NULL CHECK (executor_version <> ''),
  applied_at           TEXT NOT NULL
);

CREATE TRIGGER review_removal_applications_valid
BEFORE INSERT ON review_removal_applications
WHEN NOT EXISTS (
  SELECT 1
  FROM review_items i
  JOIN review_decisions d ON d.review_item_id = i.review_item_id
  JOIN spots s ON s.spot_id = i.spot_id
  WHERE i.review_item_id = NEW.review_item_id
    AND d.review_decision_id = NEW.review_decision_id
    AND i.spot_id = NEW.spot_id
    -- Only a complete source's removal candidate; 0009 already refuses a partial one.
    AND i.kind = 'removalCandidate' AND i.source_completeness = 'complete'
    AND d.decision = 'removalConfirmed' AND d.decision_version = 'review-decision.v1'
    -- The decision must still be the item's latest.
    AND d.review_decision_id = (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
    -- The item's entity must still be linked to the spot it names.
    AND EXISTS (SELECT 1 FROM spot_source_entities l WHERE l.spot_id = i.spot_id AND l.source_entity_id = i.source_entity_id)
    -- TEMPORARY SAFETY GATE (ADR-0008 decision 5): one source's disappearance never removes a spot
    -- that another source entity also supports. Lifted only by the PR that implements cross-source
    -- removal semantics.
    AND NOT EXISTS (SELECT 1 FROM spot_source_entities l WHERE l.spot_id = i.spot_id AND l.source_entity_id <> i.source_entity_id)
    AND s.lifecycle = 'active' AND s.merged_into IS NULL
    AND NEW.executor_version = 'review-removal-executor.v1'
    -- Stale evidence: the comparison the candidate came from must still be the source's latest.
    -- The release it compared against is still the source's current applied release ...
    AND EXISTS (SELECT 1 FROM source_releases p WHERE p.release_id = i.previous_release_id
      AND p.source_id = i.source_id AND p.status = 'applied' AND p.is_current = 1)
    -- ... the release that raised it is still under review ...
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = i.release_id AND r.status = 'ingested')
    -- ... and no other unrejected release of the source may be newer than that current release.
    -- "Newer" follows resolveNextRelease: a strictly later observed_on; an unknown observed_on on
    -- either side is not comparable, so it refuses (fail closed).
    AND NOT EXISTS (
      SELECT 1 FROM source_releases o, source_releases p
      WHERE p.release_id = i.previous_release_id
        AND o.source_id = i.source_id AND o.release_id NOT IN (i.release_id, i.previous_release_id)
        AND o.status <> 'rejected'
        AND (o.observed_on IS NULL OR p.observed_on IS NULL OR o.observed_on > p.observed_on))
)
BEGIN
  SELECT RAISE(ABORT, 'review_removal_applications: not the latest removalConfirmed decision of a current, single-source, complete removal candidate for an active spot');
END;

CREATE TRIGGER review_removal_applications_immutable
BEFORE UPDATE ON review_removal_applications
BEGIN
  SELECT RAISE(ABORT, 'review_removal_applications are immutable');
END;

CREATE TRIGGER review_removal_applications_no_delete
BEFORE DELETE ON review_removal_applications
BEGIN
  SELECT RAISE(ABORT, 'review_removal_applications are immutable');
END;

-- 'removed' is reached only through a recorded application for that spot.
CREATE TRIGGER spots_removed_requires_application
BEFORE UPDATE OF lifecycle ON spots
WHEN NEW.lifecycle = 'removed' AND OLD.lifecycle IS NOT 'removed'
  AND NOT EXISTS (SELECT 1 FROM review_removal_applications a WHERE a.spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'spots: lifecycle removed requires a review_removal_application');
END;

-- An applied removal is not undone by editing the row; restoring a spot needs its own reviewed step.
CREATE TRIGGER spots_removed_is_final_while_applied
BEFORE UPDATE OF lifecycle ON spots
WHEN OLD.lifecycle = 'removed' AND NEW.lifecycle IS NOT 'removed'
  AND EXISTS (SELECT 1 FROM review_removal_applications a WHERE a.spot_id = OLD.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'spots: a reviewed removal cannot be reverted by an update');
END;
