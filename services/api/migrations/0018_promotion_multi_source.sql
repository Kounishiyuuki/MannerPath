-- Multi-source promotion bootstrap (ADR-0008 decision 7, "Amendment 2026-09 — multi-source promotion";
-- docs/OPERATIONS.md step 4). Adds `promotion-bundle.v3` BESIDE `promotion-bundle.v2`: nothing of 0016/0017
-- changes meaning. A v2 bundle still writes promotion_bootstraps and is checked by 0016's triggers exactly
-- as before; a v3 bundle writes only the tables below and is checked by this migration's triggers.
--
-- A v3 bundle bootstraps an empty database with the current applied release of SEVERAL reviewed sources,
-- all or nothing: D1 applies the file as one transaction, and the completion below re-checks every declared
-- source, so one source's fingerprint, row, attestation or publication mismatch aborts the whole bundle.
--
-- promotion_multi_bootstraps              the bootstrap itself: one row, first statement of a v3 bundle,
--                                         accepted only by an empty database. Declares the source count and
--                                         the bundle-wide row counts.
-- promotion_multi_bootstrap_sources       one declaration per source, written before any data row: the release
--                                         and its fingerprint, the license/attribution identity, the per-source
--                                         row counts and the previous-release dependencies of its attestations.
-- promotion_multi_bootstrap_completions   last statement: re-checks the declarations on the receiving side.
--
-- Reviewed identity decisions travel as promotion_review_match_attestations (0016) for both versions; the
-- runtime review chain still never travels. Its insert guard is replaced below by "the v2 condition, verbatim,
-- OR the v3 condition". Every table here is append-only.
CREATE TABLE promotion_multi_bootstraps (
  promotion_bootstrap_id INTEGER PRIMARY KEY CHECK (promotion_bootstrap_id = 1),
  bundle_version         TEXT NOT NULL CHECK (bundle_version = 'promotion-bundle.v3'),
  source_count           INTEGER NOT NULL CHECK (source_count >= 1),
  -- The bundle manifest's row count per carried table, as {"table": n}.
  expected_rows_json     TEXT NOT NULL CHECK (json_valid(expected_rows_json) AND json_type(expected_rows_json) = 'object')
);

CREATE TABLE promotion_multi_bootstrap_sources (
  -- Not foreign keys to sources/source_releases: a declaration precedes every data row. The completion re-checks.
  source_id              TEXT PRIMARY KEY CHECK (source_id <> ''),
  promotion_bootstrap_id INTEGER NOT NULL REFERENCES promotion_multi_bootstraps (promotion_bootstrap_id),
  release_id             INTEGER NOT NULL UNIQUE CHECK (release_id > 0),
  release_content_sha256 TEXT NOT NULL CHECK (length(release_content_sha256) = 64 AND release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- The reviewed display, license and attribution identity the source row must carry (docs/SOURCES.md, ADR-0006).
  display_name           TEXT NOT NULL CHECK (trim(display_name) <> ''),
  license_name           TEXT,
  license_url            TEXT,
  attribution_text       TEXT NOT NULL CHECK (trim(attribution_text) <> ''),
  -- [{recordId, previousReleaseId, previousReleaseContentSha256}] of this source's attested records.
  review_dependencies_json TEXT NOT NULL CHECK (json_valid(review_dependencies_json) AND json_type(review_dependencies_json) = 'array'),
  -- This source's share of the source-scoped tables, as {"table": n}.
  expected_rows_json     TEXT NOT NULL CHECK (json_valid(expected_rows_json) AND json_type(expected_rows_json) = 'object')
);

CREATE TABLE promotion_multi_bootstrap_completions (
  promotion_bootstrap_id INTEGER PRIMARY KEY REFERENCES promotion_multi_bootstraps (promotion_bootstrap_id)
);

CREATE TRIGGER promotion_multi_bootstraps_immutable
BEFORE UPDATE ON promotion_multi_bootstraps
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps are immutable');
END;

CREATE TRIGGER promotion_multi_bootstraps_no_delete
BEFORE DELETE ON promotion_multi_bootstraps
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps are immutable');
END;

CREATE TRIGGER promotion_multi_bootstrap_sources_immutable
BEFORE UPDATE ON promotion_multi_bootstrap_sources
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_sources are immutable');
END;

CREATE TRIGGER promotion_multi_bootstrap_sources_no_delete
BEFORE DELETE ON promotion_multi_bootstrap_sources
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_sources are immutable');
END;

CREATE TRIGGER promotion_multi_bootstrap_completions_immutable
BEFORE UPDATE ON promotion_multi_bootstrap_completions
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions are immutable');
END;

CREATE TRIGGER promotion_multi_bootstrap_completions_no_delete
BEFORE DELETE ON promotion_multi_bootstrap_completions
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions are immutable');
END;

-- Declarations come right after the bootstrap row and before any data: all of them, and no more than declared.
CREATE TRIGGER promotion_multi_bootstrap_sources_valid
BEFORE INSERT ON promotion_multi_bootstrap_sources
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
    AND (SELECT count(*) FROM promotion_multi_bootstrap_sources) < b.source_count
    AND NOT EXISTS (SELECT 1 FROM sources)
    AND NOT EXISTS (SELECT 1 FROM source_releases))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_sources: declarations precede the data of an open v3 bootstrap');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target. Both bootstrap guards name every table of 0001-0018 (test/promotion-empty-target.test.ts),
-- so neither version can be applied over the other, over a pipeline database, or over runtime data.
DROP TRIGGER promotion_bootstraps_empty_target;

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
  OR EXISTS (SELECT 1 FROM raw_artifacts)
  OR EXISTS (SELECT 1 FROM source_checks)
  OR EXISTS (SELECT 1 FROM source_refresh_candidates)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstraps)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

CREATE TRIGGER promotion_multi_bootstraps_empty_target
BEFORE INSERT ON promotion_multi_bootstraps
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
  OR EXISTS (SELECT 1 FROM raw_artifacts)
  OR EXISTS (SELECT 1 FROM source_checks)
  OR EXISTS (SELECT 1 FROM source_refresh_candidates)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstraps)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

-- ---------------------------------------------------------------------------------------------------------
-- While a v3 bootstrap is open the database is a bundle being applied: only declared sources (with their
-- declared license/attribution identity, approved) and declared releases (final applied/current state, declared
-- fingerprint) may be written, neither is ever updated, and nothing only a pipeline, a reviewer or a source check
-- writes may appear.
CREATE TRIGGER promotion_multi_open_sources_insert
BEFORE INSERT ON sources
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstraps b JOIN promotion_multi_bootstrap_sources d ON d.promotion_bootstrap_id = b.promotion_bootstrap_id
    WHERE d.source_id = NEW.source_id AND NEW.publication_status = 'approved' AND NEW.display_name IS d.display_name
      AND NEW.license_name IS d.license_name AND NEW.license_url IS d.license_url AND NEW.attribution_text IS d.attribution_text
      AND (SELECT count(*) FROM promotion_multi_bootstrap_sources) = b.source_count)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: only a declared, approved source with its declared identity may be written');
END;

CREATE TRIGGER promotion_multi_open_source_releases_insert
BEFORE INSERT ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d
    WHERE d.release_id = NEW.release_id AND d.source_id IS NEW.source_id AND d.release_content_sha256 IS NEW.content_sha256
      AND NEW.status = 'applied' AND NEW.is_current = 1)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: only a declared release with its declared fingerprint may be written');
END;

CREATE TRIGGER promotion_multi_open_sources_update
BEFORE UPDATE ON sources
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a declared source or release is never updated');
END;

CREATE TRIGGER promotion_multi_open_source_releases_update
BEFORE UPDATE ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a declared source or release is never updated');
END;

CREATE TRIGGER promotion_multi_open_source_observations
BEFORE INSERT ON source_observations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a bundle carries no pipeline, review or source-check state');
END;

CREATE TRIGGER promotion_multi_open_review_items
BEFORE INSERT ON review_items
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a bundle carries no pipeline, review or source-check state');
END;

CREATE TRIGGER promotion_multi_open_review_decisions
BEFORE INSERT ON review_decisions
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a bundle carries no pipeline, review or source-check state');
END;

CREATE TRIGGER promotion_multi_open_review_match_applications
BEFORE INSERT ON review_match_applications
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a bundle carries no pipeline, review or source-check state');
END;

CREATE TRIGGER promotion_multi_open_raw_artifacts
BEFORE INSERT ON raw_artifacts
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a bundle carries no pipeline, review or source-check state');
END;

CREATE TRIGGER promotion_multi_open_source_checks
BEFORE INSERT ON source_checks
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a bundle carries no pipeline, review or source-check state');
END;

CREATE TRIGGER promotion_multi_open_source_refresh_candidates
BEFORE INSERT ON source_refresh_candidates
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: a bundle carries no pipeline, review or source-check state');
END;

-- Identity separation across sources. A record decision already cannot cross sources (0001
-- source_record_entities_same_source); here field provenance and attenuations cannot either: the evidence behind
-- a spot must come from a release of a source the spot is linked to through one of that source's entities.
CREATE TRIGGER promotion_multi_open_spot_field_provenance
BEFORE INSERT ON spot_field_provenance
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND NOT EXISTS (SELECT 1 FROM spot_source_entities l
    JOIN source_entities e ON e.source_entity_id = l.source_entity_id
    JOIN source_releases r ON r.source_id = e.source_id
    JOIN source_records x ON x.release_id = r.release_id
    WHERE l.spot_id = NEW.spot_id AND x.record_id = NEW.record_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_field_provenance: evidence crosses a source boundary (record not of a source linked to the spot)');
END;

CREATE TRIGGER promotion_multi_open_spot_field_attenuations
BEFORE INSERT ON spot_field_attenuations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND NOT EXISTS (SELECT 1 FROM spot_source_entities l
    JOIN source_entities e ON e.source_entity_id = l.source_entity_id
    JOIN promotion_multi_bootstrap_sources d ON d.source_id = e.source_id
    WHERE l.spot_id = NEW.spot_id AND d.release_id = NEW.release_id AND d.release_content_sha256 = NEW.release_content_sha256)
BEGIN
  SELECT RAISE(ABORT, 'spot_field_attenuations: attenuation crosses a source boundary or cites an undeclared release');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Attestations: 0016's condition for a v2 bootstrap, verbatim, or the v3 one: an open v3 bootstrap, every declared
-- source and release written (and nothing else), no pipeline/review/decision/spot/tile row yet, the record's release
-- declared, and the chosen entity AND every candidate an entity of that release's own source.
DROP TRIGGER promotion_review_match_attestations_valid;

CREATE TRIGGER promotion_review_match_attestations_valid
BEFORE INSERT ON promotion_review_match_attestations
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_bootstraps b
  WHERE b.release_id = NEW.release_id
    AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
    AND (SELECT count(*) FROM sources) = 1
    AND EXISTS (SELECT 1 FROM sources s WHERE s.source_id = b.source_id)
    AND (SELECT count(*) FROM source_releases) = 1
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = b.release_id AND r.source_id = b.source_id
      AND r.content_sha256 = b.release_content_sha256 AND r.status = 'applied' AND r.is_current = 1)
    AND NOT EXISTS (SELECT 1 FROM review_items)
    AND NOT EXISTS (SELECT 1 FROM review_decisions)
    AND NOT EXISTS (SELECT 1 FROM review_match_applications)
    AND NOT EXISTS (SELECT 1 FROM source_observations)
    AND NOT EXISTS (SELECT 1 FROM source_record_entities)
    AND NOT EXISTS (SELECT 1 FROM spots)
    AND NOT EXISTS (SELECT 1 FROM tile_snapshots)
    AND json_array_length(NEW.candidate_entity_ids_json) > 0
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.candidate_entity_ids_json) j WHERE j.type <> 'integer')
    AND (SELECT count(DISTINCT value) FROM json_each(NEW.candidate_entity_ids_json)) = json_array_length(NEW.candidate_entity_ids_json)
    AND (NEW.source_entity_id IS NULL OR (
      NEW.source_entity_id IN (SELECT value FROM json_each(NEW.candidate_entity_ids_json))
      AND EXISTS (SELECT 1 FROM source_entities se WHERE se.source_entity_id = NEW.source_entity_id AND se.source_id = b.source_id))))
AND NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  JOIN promotion_multi_bootstrap_sources d ON d.promotion_bootstrap_id = b.promotion_bootstrap_id AND d.release_id = NEW.release_id
  WHERE NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
    AND (SELECT count(*) FROM promotion_multi_bootstrap_sources) = b.source_count
    AND (SELECT count(*) FROM sources) = b.source_count
    AND (SELECT count(*) FROM source_releases) = b.source_count
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = d.release_id AND r.source_id = d.source_id
      AND r.content_sha256 = d.release_content_sha256 AND r.status = 'applied' AND r.is_current = 1)
    AND NOT EXISTS (SELECT 1 FROM review_items)
    AND NOT EXISTS (SELECT 1 FROM review_decisions)
    AND NOT EXISTS (SELECT 1 FROM review_match_applications)
    AND NOT EXISTS (SELECT 1 FROM source_observations)
    AND NOT EXISTS (SELECT 1 FROM source_record_entities)
    AND NOT EXISTS (SELECT 1 FROM spots)
    AND NOT EXISTS (SELECT 1 FROM tile_snapshots)
    AND NEW.previous_release_id NOT IN (SELECT release_id FROM promotion_multi_bootstrap_sources)
    AND json_array_length(NEW.candidate_entity_ids_json) > 0
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.candidate_entity_ids_json) j WHERE j.type <> 'integer')
    AND (SELECT count(DISTINCT value) FROM json_each(NEW.candidate_entity_ids_json)) = json_array_length(NEW.candidate_entity_ids_json)
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.candidate_entity_ids_json) j
      WHERE NOT EXISTS (SELECT 1 FROM source_entities se WHERE se.source_entity_id = j.value AND se.source_id = d.source_id))
    AND (NEW.source_entity_id IS NULL OR (
      NEW.source_entity_id IN (SELECT value FROM json_each(NEW.candidate_entity_ids_json))
      AND EXISTS (SELECT 1 FROM source_entities se WHERE se.source_entity_id = NEW.source_entity_id AND se.source_id = d.source_id))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_review_match_attestations: not a reviewed decision of an open bootstrap''s release (record, entity, candidates or order)');
END;

-- ---------------------------------------------------------------------------------------------------------
-- The receiving side's re-check, per declared source and for the whole bundle. Any single source failing any
-- condition aborts the completion, and with it the whole file (D1 applies it as one transaction).
-- It is split into several BEFORE INSERT triggers on the same table, each over the one bootstrap row (its primary
-- key is fixed to 1) and each aborting on its own: the completion inserts only when every one holds, which is the
-- conjunction of the same conditions. One trigger holding them all exceeds D1's expression tree depth limit (100)
-- and makes every valid v3 bundle fail to apply; test/promotion-expr-depth.test.ts runs the migrations and bundles
-- under that limit.

-- Declaration and bootstrap cardinality.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_cardinality
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND (SELECT count(*) FROM promotion_multi_bootstrap_sources) = b.source_count
    AND (SELECT count(*) FROM sources) = b.source_count
    AND (SELECT count(*) FROM source_releases) = b.source_count)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (declaration and bootstrap cardinality)');
END;

-- Per-source registry identity and release fingerprint.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_source_identity
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE NOT (
      EXISTS (SELECT 1 FROM sources s WHERE s.source_id = d.source_id AND s.publication_status = 'approved'
        AND s.display_name IS d.display_name AND s.license_name IS d.license_name AND s.license_url IS d.license_url AND s.attribution_text IS d.attribution_text)
      AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = d.release_id AND r.source_id = d.source_id
        AND r.content_sha256 = d.release_content_sha256 AND r.status = 'applied' AND r.is_current = 1))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (per-source registry identity and release fingerprint)');
END;

-- Per-source row counts: releases, records, match keys, entities.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_source_rows_a
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE NOT (
      (SELECT count(*) FROM source_releases r WHERE r.source_id = d.source_id) IS json_extract(d.expected_rows_json, '$.source_releases')
      AND (SELECT count(*) FROM source_records x WHERE x.release_id = d.release_id) IS json_extract(d.expected_rows_json, '$.source_records')
      AND (SELECT count(*) FROM source_record_match_keys k JOIN source_records x ON x.record_id = k.record_id WHERE x.release_id = d.release_id) IS json_extract(d.expected_rows_json, '$.source_record_match_keys')
      AND (SELECT count(*) FROM source_entities e WHERE e.source_id = d.source_id) IS json_extract(d.expected_rows_json, '$.source_entities'))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (per-source row counts: releases, records, match keys, entities)');
END;

-- Per-source row counts: attestations, record entities, spot links, provenance.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_source_rows_b
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE NOT (
      (SELECT count(*) FROM promotion_review_match_attestations a WHERE a.release_id = d.release_id) IS json_extract(d.expected_rows_json, '$.promotion_review_match_attestations')
      AND (SELECT count(*) FROM source_record_entities e WHERE e.release_id = d.release_id) IS json_extract(d.expected_rows_json, '$.source_record_entities')
      AND (SELECT count(*) FROM spot_source_entities l JOIN source_entities e ON e.source_entity_id = l.source_entity_id WHERE e.source_id = d.source_id) IS json_extract(d.expected_rows_json, '$.spot_source_entities')
      AND (SELECT count(*) FROM spot_field_provenance p JOIN source_records x ON x.record_id = p.record_id WHERE x.release_id = d.release_id) IS json_extract(d.expected_rows_json, '$.spot_field_provenance'))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (per-source row counts: attestations, record entities, spot links, provenance)');
END;

-- Review dependencies and attestations.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_review_dependencies
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE NOT (
      json_array_length(d.review_dependencies_json) = (SELECT count(*) FROM promotion_review_match_attestations a WHERE a.release_id = d.release_id)
      AND NOT EXISTS (SELECT 1 FROM promotion_review_match_attestations a WHERE a.release_id = d.release_id AND NOT EXISTS (
        SELECT 1 FROM json_each(d.review_dependencies_json) dep
        WHERE json_extract(dep.value, '$.recordId') = a.record_id
          AND json_extract(dep.value, '$.previousReleaseId') = a.previous_release_id
          AND json_extract(dep.value, '$.previousReleaseContentSha256') = a.previous_release_content_sha256))))
    AND NOT EXISTS (SELECT 1 FROM promotion_review_match_attestations a
      WHERE NOT EXISTS (SELECT 1 FROM source_record_entities e WHERE e.record_id = a.record_id AND e.release_id = a.release_id)))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (review dependencies and attestations)');
END;

-- Bundle row counts: source side.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_bundle_rows_a
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND (SELECT count(*) FROM sources) IS json_extract(b.expected_rows_json, '$.sources')
    AND (SELECT count(*) FROM source_releases) IS json_extract(b.expected_rows_json, '$.source_releases')
    AND (SELECT count(*) FROM source_records) IS json_extract(b.expected_rows_json, '$.source_records')
    AND (SELECT count(*) FROM source_record_match_keys) IS json_extract(b.expected_rows_json, '$.source_record_match_keys')
    AND (SELECT count(*) FROM source_entities) IS json_extract(b.expected_rows_json, '$.source_entities')
    AND (SELECT count(*) FROM promotion_review_match_attestations) IS json_extract(b.expected_rows_json, '$.promotion_review_match_attestations')
    AND (SELECT count(*) FROM source_record_entities) IS json_extract(b.expected_rows_json, '$.source_record_entities'))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (bundle row counts: source side)');
END;

-- Bundle row counts: published spots and tiles.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_bundle_rows_b
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND (SELECT count(*) FROM spots) IS json_extract(b.expected_rows_json, '$.spots')
    AND (SELECT count(*) FROM spot_source_entities) IS json_extract(b.expected_rows_json, '$.spot_source_entities')
    AND (SELECT count(*) FROM spot_field_provenance) IS json_extract(b.expected_rows_json, '$.spot_field_provenance')
    AND (SELECT count(*) FROM spot_field_attenuations) IS json_extract(b.expected_rows_json, '$.spot_field_attenuations')
    AND (SELECT count(*) FROM tile_snapshots) IS json_extract(b.expected_rows_json, '$.tile_snapshots')
    AND (SELECT count(*) FROM tile_snapshot_spots) IS json_extract(b.expected_rows_json, '$.tile_snapshot_spots')
    AND (SELECT count(*) FROM tile_snapshot_spots) > 0)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (bundle row counts: published spots and tiles)');
END;

-- Runtime and pipeline state the bundle does not carry.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_nothing_else
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM review_items) AND NOT EXISTS (SELECT 1 FROM review_match_applications)
    AND NOT EXISTS (SELECT 1 FROM source_observations)
    AND NOT EXISTS (SELECT 1 FROM raw_artifacts) AND NOT EXISTS (SELECT 1 FROM source_checks)
    AND NOT EXISTS (SELECT 1 FROM source_refresh_candidates)
    AND NOT EXISTS (SELECT 1 FROM promotion_bootstraps))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (runtime and pipeline state the bundle does not carry)');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Completion seals the same promoted and derived tables as 0016's v2 seal. Runtime report, App Attest and source
-- refresh tables (0017) stay writable: promote first, then enable checks.

CREATE TRIGGER promotion_multi_complete_seals_sources_insert
BEFORE INSERT ON sources
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_sources_update
BEFORE UPDATE ON sources
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_sources_delete
BEFORE DELETE ON sources
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_releases_insert
BEFORE INSERT ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_releases_update
BEFORE UPDATE ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_releases_delete
BEFORE DELETE ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_records_insert
BEFORE INSERT ON source_records
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_records_update
BEFORE UPDATE ON source_records
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_records_delete
BEFORE DELETE ON source_records
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_record_match_keys_insert
BEFORE INSERT ON source_record_match_keys
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_record_match_keys_update
BEFORE UPDATE ON source_record_match_keys
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_record_match_keys_delete
BEFORE DELETE ON source_record_match_keys
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_entities_insert
BEFORE INSERT ON source_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_entities_update
BEFORE UPDATE ON source_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_entities_delete
BEFORE DELETE ON source_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_record_entities_insert
BEFORE INSERT ON source_record_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_record_entities_update
BEFORE UPDATE ON source_record_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_record_entities_delete
BEFORE DELETE ON source_record_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spots_insert
BEFORE INSERT ON spots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spots_update
BEFORE UPDATE ON spots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spots_delete
BEFORE DELETE ON spots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_source_entities_insert
BEFORE INSERT ON spot_source_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_source_entities_update
BEFORE UPDATE ON spot_source_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_source_entities_delete
BEFORE DELETE ON spot_source_entities
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_field_provenance_insert
BEFORE INSERT ON spot_field_provenance
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_field_provenance_update
BEFORE UPDATE ON spot_field_provenance
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_field_provenance_delete
BEFORE DELETE ON spot_field_provenance
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_field_attenuations_insert
BEFORE INSERT ON spot_field_attenuations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_field_attenuations_update
BEFORE UPDATE ON spot_field_attenuations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_spot_field_attenuations_delete
BEFORE DELETE ON spot_field_attenuations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_tile_snapshots_insert
BEFORE INSERT ON tile_snapshots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_tile_snapshots_update
BEFORE UPDATE ON tile_snapshots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_tile_snapshots_delete
BEFORE DELETE ON tile_snapshots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_tile_snapshot_spots_insert
BEFORE INSERT ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_tile_snapshot_spots_update
BEFORE UPDATE ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_tile_snapshot_spots_delete
BEFORE DELETE ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_observations_insert
BEFORE INSERT ON source_observations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_observations_update
BEFORE UPDATE ON source_observations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

CREATE TRIGGER promotion_multi_complete_seals_source_observations_delete
BEFORE DELETE ON source_observations
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;
