-- Applying reviewed ambiguousMatch decisions in cross-release reconciliation (ADR-0008 decisions 3
-- and 8, Issue #86).
--
-- review_match_applications  one row per ambiguousMatch review decision the resolver used to apply a
--                            release: which item, which exact decision, the record it decided, the
--                            entity it chose (NULL for confirmedNew), when, and by which version. It is
--                            the audit link between review evidence (0009) and the record's
--                            source_record_entities decision. Recording a decision still changes
--                            nothing canonical; only the resolver writes this row, in the same batch
--                            as the release it applies, and only when the whole release is resolved.
--
-- The insert trigger re-reads the item's latest decision inside the statement, so a decision recorded
-- after the resolver read the queue aborts the whole batch, as in 0010.
CREATE TABLE review_match_applications (
  review_match_application_id INTEGER PRIMARY KEY,
  -- One item is applied at most once, and one decision at most once: another decision of the same
  -- item cannot be substituted after application.
  review_item_id       INTEGER NOT NULL UNIQUE REFERENCES review_items (review_item_id),
  review_decision_id   INTEGER NOT NULL UNIQUE REFERENCES review_decisions (review_decision_id),
  decision             TEXT NOT NULL CHECK (decision IN ('matchedToEntity', 'confirmedNew')),
  -- A record is decided once per release; the item's record, checked by the trigger.
  record_id            INTEGER NOT NULL UNIQUE,
  release_id           INTEGER NOT NULL,
  source_entity_id     INTEGER REFERENCES source_entities (source_entity_id),
  -- Only 'review-match-application.v1' exists (checked by the insert trigger); a v2 replaces that
  -- trigger in its own migration.
  executor_version     TEXT NOT NULL CHECK (executor_version <> ''),
  applied_at           TEXT NOT NULL,
  FOREIGN KEY (record_id, release_id) REFERENCES source_records (record_id, release_id),
  CHECK ((decision = 'matchedToEntity') = (source_entity_id IS NOT NULL))
);

CREATE TRIGGER review_match_applications_valid
BEFORE INSERT ON review_match_applications
WHEN NOT EXISTS (
  SELECT 1
  FROM review_items i
  JOIN review_decisions d ON d.review_item_id = i.review_item_id
  WHERE i.review_item_id = NEW.review_item_id
    AND d.review_decision_id = NEW.review_decision_id
    AND i.kind = 'ambiguousMatch'
    AND i.record_id = NEW.record_id AND i.release_id = NEW.release_id
    AND d.decision = NEW.decision AND d.decision_version = 'review-decision.v1'
    AND d.source_entity_id IS NEW.source_entity_id
    -- The decision must still be the item's latest.
    AND d.review_decision_id = (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
    AND NEW.executor_version = 'review-match-application.v1'
    -- A chosen entity is one of the item's candidates (0009 checks the decision; checked again here)
    -- recorded by the previous release, and still linked (spot_source_entities: one link per entity)
    -- to an active, unmerged spot: a removed spot is never revived by a match (restoring one is its
    -- own reviewed step). The link is required, so a missing link is refused too.
    AND (NEW.source_entity_id IS NULL OR (
      NEW.source_entity_id IN (SELECT value FROM json_each(i.details_json, '$.candidateEntityIds'))
      AND EXISTS (SELECT 1 FROM source_record_entities e WHERE e.source_entity_id = NEW.source_entity_id
        AND e.release_id = i.previous_release_id)
      AND EXISTS (SELECT 1 FROM spot_source_entities l JOIN spots s ON s.spot_id = l.spot_id
        WHERE l.source_entity_id = NEW.source_entity_id AND s.lifecycle = 'active' AND s.merged_into IS NULL)))
    -- Stale evidence, as in 0010: the compared release is still the source's current applied release,
    -- the release that raised the item is still under review, and no other unrejected release of the
    -- source is newer than that current release (an unknown observed_on is not comparable: refused).
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
  SELECT RAISE(ABORT, 'review_match_applications: not the latest matchedToEntity/confirmedNew decision of a current ambiguousMatch item');
END;

CREATE TRIGGER review_match_applications_immutable
BEFORE UPDATE ON review_match_applications
BEGIN
  SELECT RAISE(ABORT, 'review_match_applications are immutable');
END;

CREATE TRIGGER review_match_applications_no_delete
BEFORE DELETE ON review_match_applications
BEGIN
  SELECT RAISE(ABORT, 'review_match_applications are immutable');
END;

-- A reviewed ('manual') decision is inserted only with the application of the decision it follows:
-- the same record, and the entity that decision chose.
CREATE TRIGGER source_record_entities_manual_requires_application
BEFORE INSERT ON source_record_entities
WHEN NEW.method = 'manual' AND NOT EXISTS (
  SELECT 1 FROM review_match_applications a
  WHERE a.record_id = NEW.record_id AND a.decision = 'matchedToEntity' AND a.source_entity_id = NEW.source_entity_id)
BEGIN
  SELECT RAISE(ABORT, 'source_record_entities: a manual decision requires a review_match_application');
END;
