-- Review queue (ADR-0008 decisions 5 and 8, Issue #80).
--
-- review_items       what a pipeline step could not decide on its own: one row per candidate, written
--                    by the step that found it, never by a reviewer.
-- review_decisions   what a reviewer decided about one item: who, when, which decision under which
--                    vocabulary version, and why. Evidence, not an edit: recording a decision changes
--                    no canonical row. Applying a decision (removal, a manual match) is a separate
--                    reviewed step that does not exist yet.
--
-- Both tables are append-only. An item has no status column: it is open while it has no decision,
-- and a later decision on the same item supersedes an earlier one without rewriting it.
--
-- Neither table travels in the promotion bundle: they are review state of the database that ran
-- the pipeline, and nothing published reads them.
CREATE TABLE review_items (
  review_item_id         INTEGER PRIMARY KEY,
  source_id              TEXT NOT NULL REFERENCES sources (source_id),
  -- The release whose processing raised the candidate, with its fingerprint (decision 9) so a later
  -- reader can tell which exact file the candidate was computed from.
  release_id             INTEGER NOT NULL REFERENCES source_releases (release_id),
  release_content_sha256 TEXT NOT NULL,
  -- The applied release it was compared with; NULL for a kind that compares with nothing.
  previous_release_id    INTEGER REFERENCES source_releases (release_id),
  -- Validated by review_items_kind below, not by CHECK, so a later kind (relocation, cross-source
  -- duplicate, schema change) is a trigger replacement in its migration rather than a table rebuild.
  kind                   TEXT NOT NULL,
  matcher_version        TEXT NOT NULL,
  -- The adapter's declared completeness when the candidate was raised (absent in code = partial).
  source_completeness    TEXT NOT NULL CHECK (source_completeness IN ('partial', 'complete')),
  -- Deterministic identity of the involved records/entities within (release, previous release,
  -- matcher, kind), e.g. 'record:12|entities:3,5'. Same input -> same key -> same item.
  candidate_key          TEXT NOT NULL CHECK (candidate_key <> ''),
  -- The new record under review (ambiguousMatch), or the previous entity and its spot (disappearance,
  -- removalCandidate). Everything else the step knew is in details_json.
  record_id              INTEGER,
  source_entity_id       INTEGER REFERENCES source_entities (source_entity_id),
  spot_id                TEXT REFERENCES spots (spot_id),
  details_json           TEXT NOT NULL CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
  created_at             TEXT NOT NULL,
  FOREIGN KEY (record_id, release_id) REFERENCES source_records (record_id, release_id),
  UNIQUE (source_id, release_id, previous_release_id, matcher_version, kind, candidate_key)
);

-- A NULL previous_release_id would make the UNIQUE above never match; every current kind has one.
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
)
BEGIN
  SELECT RAISE(ABORT, 'review_items: kind, involved ids or completeness are inconsistent');
END;

CREATE TRIGGER review_items_same_source
BEFORE INSERT ON review_items
WHEN NEW.source_id IS NOT (SELECT source_id FROM source_releases WHERE release_id = NEW.release_id)
  OR NEW.release_content_sha256 IS NOT (SELECT content_sha256 FROM source_releases WHERE release_id = NEW.release_id)
  OR (NEW.previous_release_id IS NOT NULL
    AND NEW.source_id IS NOT (SELECT source_id FROM source_releases WHERE release_id = NEW.previous_release_id))
  OR (NEW.source_entity_id IS NOT NULL
    AND NEW.source_id IS NOT (SELECT source_id FROM source_entities WHERE source_entity_id = NEW.source_entity_id))
BEGIN
  SELECT RAISE(ABORT, 'review_items: release, fingerprint or entity does not belong to the item''s source');
END;

CREATE TRIGGER review_items_immutable
BEFORE UPDATE ON review_items
BEGIN
  SELECT RAISE(ABORT, 'review_items are immutable; record a review_decision instead');
END;

CREATE TRIGGER review_items_no_delete
BEFORE DELETE ON review_items
BEGIN
  SELECT RAISE(ABORT, 'review_items are immutable; record a review_decision instead');
END;

CREATE TABLE review_decisions (
  review_decision_id INTEGER PRIMARY KEY,
  review_item_id     INTEGER NOT NULL REFERENCES review_items (review_item_id),
  -- Validated per item kind by review_decisions_valid below (same reason as review_items.kind).
  decision           TEXT NOT NULL,
  -- The decision vocabulary and its meaning, e.g. 'review-decision.v1'.
  decision_version   TEXT NOT NULL CHECK (decision_version <> ''),
  -- The previous entity a matchedToEntity decision chose; NULL for every other decision.
  source_entity_id   INTEGER REFERENCES source_entities (source_entity_id),
  decided_by         TEXT NOT NULL CHECK (trim(decided_by) <> ''),
  decided_at         TEXT NOT NULL,
  note               TEXT
);

CREATE INDEX review_decisions_item ON review_decisions (review_item_id, review_decision_id);

CREATE TRIGGER review_decisions_valid
BEFORE INSERT ON review_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM review_items i WHERE i.review_item_id = NEW.review_item_id AND (
    NEW.decision = 'deferred' AND NEW.source_entity_id IS NULL
    -- An ambiguous record continues one of its candidate entities, or is confirmed new.
    OR (i.kind = 'ambiguousMatch' AND NEW.decision = 'confirmedNew' AND NEW.source_entity_id IS NULL)
    OR (i.kind = 'ambiguousMatch' AND NEW.decision = 'matchedToEntity' AND NEW.source_entity_id IN
      (SELECT value FROM json_each(i.details_json, '$.candidateEntityIds')))
    -- A partial source's disappearance cannot be confirmed as a removal: it is not removal evidence.
    OR (i.kind IN ('disappearance', 'removalCandidate') AND NEW.decision = 'removalRejected' AND NEW.source_entity_id IS NULL)
    OR (i.kind = 'removalCandidate' AND NEW.decision = 'removalConfirmed' AND NEW.source_entity_id IS NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'review_decisions: decision is not valid for this review item');
END;

CREATE TRIGGER review_decisions_immutable
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review_decisions are immutable; record a new decision instead');
END;

CREATE TRIGGER review_decisions_no_delete
BEFORE DELETE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review_decisions are immutable; record a new decision instead');
END;
