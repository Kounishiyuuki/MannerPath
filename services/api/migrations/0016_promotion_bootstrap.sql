-- Promotion bootstrap of a reviewed release (Issue #100; ADR-0008 decision 7, docs/OPERATIONS.md step 4).
--
-- A promotion bundle bootstraps an empty database with one already-reviewed, applied release. It does not
-- re-run the pipeline, so it cannot carry the runtime review chain (review_items, review_decisions,
-- review_match_applications): their triggers check a pipeline moment (the previous release current, the
-- reviewed release still `ingested`) that the finished state it bootstraps has long left, and the previous
-- release they reference is not promoted. Instead the bundle carries, for every record of the release whose
-- identity a reviewer decided, one attestation of that applied decision (who decided what, when, against
-- which release fingerprint, applied by which executor), and the target accepts a reviewed ('manual') link
-- only on that attestation — never without one.
--
-- promotion_bootstraps                 the bootstrap itself: one row, first statement of a bundle, accepted
--                                      only by an empty database. It names the bundle version, the release
--                                      (with fingerprint) and the row counts the bundle declares.
-- promotion_review_match_attestations  one row per reviewed ambiguousMatch decision applied to a record of the
--                                      bootstrapped release (matchedToEntity and confirmedNew alike). The
--                                      origin_* ids name the rows in the database that reviewed and applied it;
--                                      they are provenance, not foreign keys: those rows stay there.
-- promotion_bootstrap_completions      last statement of a bundle: re-checks on the receiving side that what
--                                      arrived is the declared, complete, consistent release.
--
-- The runtime rule of 0011 is unchanged: in a database that runs the pipeline no bootstrap row can exist (it
-- needs an empty database), so no attestation can exist, and a manual link still needs its
-- review_match_application. All three tables are append-only.
CREATE TABLE promotion_bootstraps (
  promotion_bootstrap_id INTEGER PRIMARY KEY CHECK (promotion_bootstrap_id = 1),
  -- Only 'promotion-bundle.v2' exists; a later bundle version replaces this table's triggers in its migration.
  bundle_version         TEXT NOT NULL CHECK (bundle_version = 'promotion-bundle.v2'),
  -- Not foreign keys: this row precedes every other row of the bundle. The completion re-checks them.
  source_id              TEXT NOT NULL CHECK (source_id <> ''),
  release_id             INTEGER NOT NULL CHECK (release_id > 0),
  release_content_sha256 TEXT NOT NULL CHECK (length(release_content_sha256) = 64),
  -- The exact previous-release dependencies of attested records, derived by the exporter from
  -- origin review items. Kept separately so changing one attestation cannot silently change a
  -- dependency while preserving the row count.
  review_dependencies_json TEXT NOT NULL CHECK (json_valid(review_dependencies_json) AND json_type(review_dependencies_json) = 'array'),
  -- The bundle manifest's row count per carried table, as {"table": n}.
  expected_rows_json     TEXT NOT NULL CHECK (json_valid(expected_rows_json) AND json_type(expected_rows_json) = 'object')
);

CREATE TRIGGER promotion_bootstraps_immutable
BEFORE UPDATE ON promotion_bootstraps
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstraps are immutable');
END;

CREATE TRIGGER promotion_bootstraps_no_delete
BEFORE DELETE ON promotion_bootstraps
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstraps are immutable');
END;

CREATE TABLE promotion_bootstrap_completions (
  promotion_bootstrap_id INTEGER PRIMARY KEY REFERENCES promotion_bootstraps (promotion_bootstrap_id)
);

CREATE TABLE promotion_review_match_attestations (
  -- A record is decided once; one attestation per record.
  record_id                          INTEGER PRIMARY KEY,
  release_id                         INTEGER NOT NULL,
  decision                           TEXT NOT NULL CHECK (decision IN ('matchedToEntity', 'confirmedNew')),
  source_entity_id                   INTEGER REFERENCES source_entities (source_entity_id),
  -- The applied chain in the origin database: review_items -> review_decisions -> review_match_applications.
  origin_review_item_id              INTEGER NOT NULL,
  origin_review_decision_id          INTEGER NOT NULL,
  origin_review_match_application_id INTEGER NOT NULL,
  -- The comparison the item was raised for: the previous release by id and fingerprint, and the matcher.
  previous_release_id                INTEGER NOT NULL,
  previous_release_content_sha256    TEXT NOT NULL CHECK (length(previous_release_content_sha256) = 64),
  matcher_version                    TEXT NOT NULL CHECK (matcher_version <> ''),
  candidate_entity_ids_json          TEXT NOT NULL CHECK (json_valid(candidate_entity_ids_json) AND json_type(candidate_entity_ids_json) = 'array'),
  -- The decision as the reviewer recorded it, and its application.
  decision_version                   TEXT NOT NULL CHECK (decision_version = 'review-decision.v1'),
  decided_by                         TEXT NOT NULL CHECK (trim(decided_by) <> ''),
  decided_at                         TEXT NOT NULL,
  decision_note                      TEXT,
  executor_version                   TEXT NOT NULL CHECK (executor_version = 'review-match-application.v1'),
  applied_at                         TEXT NOT NULL,
  FOREIGN KEY (record_id, release_id) REFERENCES source_records (record_id, release_id),
  CHECK ((decision = 'matchedToEntity') = (source_entity_id IS NOT NULL)),
  CHECK (previous_release_id <> release_id)
);

-- Bootstrap means an empty database: nothing a pipeline, a previous bundle, a reviewer, a reporter or App Attest
-- could have written. Every table of migrations 0001-0016 is named here, not reached through a parent's
-- foreign key: reports, rate windows and App Attest rows reference no canonical row at all. Views are
-- derived and excluded. test/promotion-empty-target.test.ts fails when a table is added and not listed.
CREATE TRIGGER promotion_bootstraps_empty_target
BEFORE INSERT ON promotion_bootstraps
WHEN EXISTS (SELECT 1 FROM sources)
  OR EXISTS (SELECT 1 FROM source_releases)
  OR EXISTS (SELECT 1 FROM source_records)
  OR EXISTS (SELECT 1 FROM source_record_match_keys)
  OR EXISTS (SELECT 1 FROM source_observations)
  OR EXISTS (SELECT 1 FROM source_entities)
  OR EXISTS (SELECT 1 FROM source_record_entities)
  OR EXISTS (SELECT 1 FROM spots)
  OR EXISTS (SELECT 1 FROM spot_source_entities)
  OR EXISTS (SELECT 1 FROM spot_field_provenance)
  OR EXISTS (SELECT 1 FROM spot_field_attenuations)
  OR EXISTS (SELECT 1 FROM tile_snapshots)
  OR EXISTS (SELECT 1 FROM tile_snapshot_spots)
  OR EXISTS (SELECT 1 FROM review_items)
  OR EXISTS (SELECT 1 FROM review_decisions)
  OR EXISTS (SELECT 1 FROM review_removal_applications)
  OR EXISTS (SELECT 1 FROM review_removal_resolutions)
  OR EXISTS (SELECT 1 FROM review_match_applications)
  OR EXISTS (SELECT 1 FROM review_relocation_holds)
  OR EXISTS (SELECT 1 FROM review_relocation_applications)
  OR EXISTS (SELECT 1 FROM review_relocation_resolutions)
  OR EXISTS (SELECT 1 FROM reports)
  OR EXISTS (SELECT 1 FROM report_moderation)
  OR EXISTS (SELECT 1 FROM report_rate_windows)
  OR EXISTS (SELECT 1 FROM app_attest_keys)
  OR EXISTS (SELECT 1 FROM app_attest_challenges)
  OR EXISTS (SELECT 1 FROM promotion_bootstraps)
  OR EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
  OR EXISTS (SELECT 1 FROM promotion_review_match_attestations)
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

-- Only while a bootstrap is open, only for its release, only before the record's decision, and only for a
-- chosen entity of the bootstrapped source that is one of the item's distinct integer candidates.
CREATE TRIGGER promotion_review_match_attestations_valid
BEFORE INSERT ON promotion_review_match_attestations
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_bootstraps b
  WHERE b.release_id = NEW.release_id
    AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
    AND NOT EXISTS (SELECT 1 FROM source_record_entities e WHERE e.record_id = NEW.record_id)
    AND json_array_length(NEW.candidate_entity_ids_json) > 0
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.candidate_entity_ids_json) j WHERE j.type <> 'integer')
    AND (SELECT count(DISTINCT value) FROM json_each(NEW.candidate_entity_ids_json)) = json_array_length(NEW.candidate_entity_ids_json)
    AND (NEW.source_entity_id IS NULL OR (
      NEW.source_entity_id IN (SELECT value FROM json_each(NEW.candidate_entity_ids_json))
      AND EXISTS (SELECT 1 FROM source_entities se WHERE se.source_entity_id = NEW.source_entity_id AND se.source_id = b.source_id))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_review_match_attestations: not a reviewed decision of an open bootstrap''s release (record, entity, candidates or order)');
END;

CREATE TRIGGER promotion_review_match_attestations_immutable
BEFORE UPDATE ON promotion_review_match_attestations
BEGIN
  SELECT RAISE(ABORT, 'promotion_review_match_attestations are immutable');
END;

CREATE TRIGGER promotion_review_match_attestations_no_delete
BEFORE DELETE ON promotion_review_match_attestations
BEGIN
  SELECT RAISE(ABORT, 'promotion_review_match_attestations are immutable');
END;

DROP TRIGGER source_record_entities_manual_requires_application;

-- Replaces 0011's: a reviewed ('manual') decision is inserted only with the application of the decision it
-- follows (runtime), or with the attestation of that applied decision (bootstrap, above) — the same record,
-- and the entity that decision chose.
CREATE TRIGGER source_record_entities_manual_requires_application
BEFORE INSERT ON source_record_entities
WHEN NEW.method = 'manual'
  AND NOT EXISTS (SELECT 1 FROM review_match_applications a
    WHERE a.record_id = NEW.record_id AND a.decision = 'matchedToEntity' AND a.source_entity_id = NEW.source_entity_id)
  AND NOT EXISTS (SELECT 1 FROM promotion_review_match_attestations a
    WHERE a.record_id = NEW.record_id AND a.release_id = NEW.release_id
      AND a.decision = 'matchedToEntity' AND a.source_entity_id = NEW.source_entity_id)
BEGIN
  SELECT RAISE(ABORT, 'source_record_entities: a manual decision requires a review_match_application');
END;

-- An attested record's decision is the attested one: manual to the chosen entity, or new for confirmedNew.
CREATE TRIGGER source_record_entities_follow_attestation
BEFORE INSERT ON source_record_entities
WHEN EXISTS (SELECT 1 FROM promotion_review_match_attestations a WHERE a.record_id = NEW.record_id AND NOT (
  a.release_id = NEW.release_id AND (
    (a.decision = 'matchedToEntity' AND NEW.method = 'manual' AND NEW.source_entity_id = a.source_entity_id)
    OR (a.decision = 'confirmedNew' AND NEW.method = 'new'))))
BEGIN
  SELECT RAISE(ABORT, 'source_record_entities: decision does not follow its promoted review attestation');
END;

-- The receiving side's re-check: exactly the declared source and applied current release, exactly the declared
-- row counts, every attestation followed by its record's decision, and something published.
CREATE TRIGGER promotion_bootstrap_completions_valid
BEFORE INSERT ON promotion_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND (SELECT count(*) FROM sources) = 1
    AND EXISTS (SELECT 1 FROM sources s WHERE s.source_id = b.source_id AND s.publication_status = 'approved')
    AND (SELECT count(*) FROM source_releases) = 1
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = b.release_id AND r.source_id = b.source_id
      AND r.content_sha256 = b.release_content_sha256 AND r.status = 'applied' AND r.is_current = 1)
    AND (SELECT count(*) FROM sources) IS json_extract(b.expected_rows_json, '$.sources')
    AND (SELECT count(*) FROM source_releases) IS json_extract(b.expected_rows_json, '$.source_releases')
    AND (SELECT count(*) FROM source_records) IS json_extract(b.expected_rows_json, '$.source_records')
    AND (SELECT count(*) FROM source_record_match_keys) IS json_extract(b.expected_rows_json, '$.source_record_match_keys')
    AND (SELECT count(*) FROM source_entities) IS json_extract(b.expected_rows_json, '$.source_entities')
    AND (SELECT count(*) FROM promotion_review_match_attestations) IS json_extract(b.expected_rows_json, '$.promotion_review_match_attestations')
    AND json_array_length(b.review_dependencies_json) = (SELECT count(*) FROM promotion_review_match_attestations)
    AND NOT EXISTS (SELECT 1 FROM promotion_review_match_attestations a WHERE NOT EXISTS (
      SELECT 1 FROM json_each(b.review_dependencies_json) dep
      WHERE json_extract(dep.value, '$.recordId') = a.record_id
        AND json_extract(dep.value, '$.previousReleaseId') = a.previous_release_id
        AND json_extract(dep.value, '$.previousReleaseContentSha256') = a.previous_release_content_sha256))
    AND (SELECT count(*) FROM source_record_entities) IS json_extract(b.expected_rows_json, '$.source_record_entities')
    AND (SELECT count(*) FROM spots) IS json_extract(b.expected_rows_json, '$.spots')
    AND (SELECT count(*) FROM spot_source_entities) IS json_extract(b.expected_rows_json, '$.spot_source_entities')
    AND (SELECT count(*) FROM spot_field_provenance) IS json_extract(b.expected_rows_json, '$.spot_field_provenance')
    AND (SELECT count(*) FROM spot_field_attenuations) IS json_extract(b.expected_rows_json, '$.spot_field_attenuations')
    AND (SELECT count(*) FROM tile_snapshots) IS json_extract(b.expected_rows_json, '$.tile_snapshots')
    AND (SELECT count(*) FROM tile_snapshot_spots) IS json_extract(b.expected_rows_json, '$.tile_snapshot_spots')
    AND (SELECT count(*) FROM tile_snapshot_spots) > 0
    AND NOT EXISTS (SELECT 1 FROM promotion_review_match_attestations a
      WHERE NOT EXISTS (SELECT 1 FROM source_record_entities e WHERE e.record_id = a.record_id AND e.release_id = a.release_id))
    -- Nothing the bundle does not carry: the review queue and its runtime applications stay in the origin database.
    AND NOT EXISTS (SELECT 1 FROM review_items) AND NOT EXISTS (SELECT 1 FROM review_match_applications))
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstrap_completions: the database does not hold exactly the declared, complete release');
END;

CREATE TRIGGER promotion_bootstrap_completions_immutable
BEFORE UPDATE ON promotion_bootstrap_completions
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstrap_completions are immutable');
END;

CREATE TRIGGER promotion_bootstrap_completions_no_delete
BEFORE DELETE ON promotion_bootstrap_completions
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstrap_completions are immutable');
END;

-- Completion seals publication, evidence and canonical state. Runtime report and App Attest data stay writable.

CREATE TRIGGER promotion_complete_seals_sources_insert
BEFORE INSERT ON sources
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_sources_update
BEFORE UPDATE ON sources
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_sources_delete
BEFORE DELETE ON sources
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_releases_insert
BEFORE INSERT ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_releases_update
BEFORE UPDATE ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_releases_delete
BEFORE DELETE ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_records_insert
BEFORE INSERT ON source_records
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_records_update
BEFORE UPDATE ON source_records
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_records_delete
BEFORE DELETE ON source_records
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_record_match_keys_insert
BEFORE INSERT ON source_record_match_keys
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_record_match_keys_update
BEFORE UPDATE ON source_record_match_keys
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_record_match_keys_delete
BEFORE DELETE ON source_record_match_keys
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_entities_insert
BEFORE INSERT ON source_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_entities_update
BEFORE UPDATE ON source_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_entities_delete
BEFORE DELETE ON source_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_record_entities_insert
BEFORE INSERT ON source_record_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_record_entities_update
BEFORE UPDATE ON source_record_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_record_entities_delete
BEFORE DELETE ON source_record_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spots_insert
BEFORE INSERT ON spots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spots_update
BEFORE UPDATE ON spots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spots_delete
BEFORE DELETE ON spots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_source_entities_insert
BEFORE INSERT ON spot_source_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_source_entities_update
BEFORE UPDATE ON spot_source_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_source_entities_delete
BEFORE DELETE ON spot_source_entities
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_field_provenance_insert
BEFORE INSERT ON spot_field_provenance
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_field_provenance_update
BEFORE UPDATE ON spot_field_provenance
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_field_provenance_delete
BEFORE DELETE ON spot_field_provenance
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_field_attenuations_insert
BEFORE INSERT ON spot_field_attenuations
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_field_attenuations_update
BEFORE UPDATE ON spot_field_attenuations
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_spot_field_attenuations_delete
BEFORE DELETE ON spot_field_attenuations
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_tile_snapshots_insert
BEFORE INSERT ON tile_snapshots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_tile_snapshots_update
BEFORE UPDATE ON tile_snapshots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_tile_snapshots_delete
BEFORE DELETE ON tile_snapshots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_tile_snapshot_spots_insert
BEFORE INSERT ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_tile_snapshot_spots_update
BEFORE UPDATE ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_tile_snapshot_spots_delete
BEFORE DELETE ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_observations_insert
BEFORE INSERT ON source_observations
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_observations_update
BEFORE UPDATE ON source_observations
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_complete_seals_source_observations_delete
BEFORE DELETE ON source_observations
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;
