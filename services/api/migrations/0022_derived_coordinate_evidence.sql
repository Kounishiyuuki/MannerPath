-- Derived-coordinate evidence (ADR-0011, status Proposed). Foundation only: nothing here reaches `spots`,
-- `spot_field_provenance` or tile publication, and no code path reads these tables when resolving or publishing.
-- Publishing a spot whose location comes from a geocoded official address stays forbidden until the
-- publication policy in ADR-0011 is approved by a maintainer; that switch is a separate, reviewed change.
--
-- 1. derived_coordinate_geocodes: one immutable geocoder run over ONE publisher-supplied address cell of ONE raw
--    source record. It keeps the verbatim official address, the exact geocoder input, the geocoder identity,
--    version, options and pinned dataset release, the provider's own match/coordinate levels, MannerPath's
--    precision class, and the licenses of both the source and the geocoder data. A rerun with a different
--    geocoder version or dataset release is a NEW row; an old row is never rewritten.
-- 2. derived_coordinate_reviews: append-only human decisions about one geocode row, bound to that row's evidence
--    digest. A newer decision supersedes an older one by being newer; nothing is updated or deleted.
--
-- Each guard is its own small trigger (0018/0019: one large trigger exceeded D1's expression depth limit).

CREATE TABLE derived_coordinate_geocodes (
  geocode_id            INTEGER PRIMARY KEY,
  record_id             INTEGER NOT NULL REFERENCES source_records (record_id),
  -- The publisher column the address was read from, verbatim (e.g. "所在地"), and its verbatim value.
  address_column        TEXT NOT NULL CHECK (address_column <> ''),
  official_address      TEXT NOT NULL CHECK (official_address <> ''),
  -- The exact string given to the geocoder. Differs from official_address only by a named, reviewed rule.
  geocoder_input        TEXT NOT NULL CHECK (geocoder_input <> ''),
  input_rule            TEXT NOT NULL CHECK (input_rule <> ''),
  geocoder_id           TEXT NOT NULL CHECK (geocoder_id <> ''),
  geocoder_version      TEXT NOT NULL CHECK (geocoder_version <> ''),
  geocoder_options_json TEXT NOT NULL CHECK (json_valid(geocoder_options_json) AND json_type(geocoder_options_json) = 'object'),
  -- Content digest of the geocoder's local dataset (sha256 over its sorted file digests), never a fetch date.
  dataset_release_id    TEXT NOT NULL CHECK (length(dataset_release_id) = 64 AND dataset_release_id NOT GLOB '*[^0-9a-f]*'),
  normalized_address    TEXT,
  unmatched_json        TEXT NOT NULL CHECK (json_valid(unmatched_json) AND json_type(unmatched_json) = 'array'),
  score                 REAL,
  -- abr-geocoder vocabulary, verbatim. coordinate_level can be coarser than match_level: the coordinate is then a
  -- representative point of the coarser unit, which is why precision is derived from coordinate_level.
  match_level           TEXT NOT NULL CHECK (match_level IN ('error', 'unknown', 'prefecture', 'city', 'machiaza',
                          'machiaza_detail', 'residential_block', 'residential_detail', 'parcel')),
  coordinate_level      TEXT NOT NULL CHECK (coordinate_level IN ('error', 'unknown', 'prefecture', 'city', 'machiaza',
                          'machiaza_detail', 'residential_block', 'residential_detail', 'parcel')),
  precision             TEXT NOT NULL CHECK (precision IN ('residentialDetail', 'residentialBlock', 'parcel', 'insufficient')),
  latitude              REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude             REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  -- The dataset's declared CRS for the representative point (ABR mixes EPSG:6668 and EPSG:4612).
  srid                  TEXT,
  lg_code               TEXT,
  -- Licenses of the geocoder data that produced the coordinate (JSON array of names); the source's own license
  -- stays on `sources`. Both must be attributed if this coordinate is ever published.
  data_licenses_json    TEXT NOT NULL CHECK (json_valid(data_licenses_json) AND json_type(data_licenses_json) = 'array'
                          AND json_array_length(data_licenses_json) > 0),
  evidence_sha256       TEXT NOT NULL UNIQUE CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  generated_at          TEXT NOT NULL,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (precision = 'insufficient' OR latitude IS NOT NULL),
  UNIQUE (record_id, address_column, geocoder_input, geocoder_id, geocoder_version, dataset_release_id)
);

CREATE INDEX derived_coordinate_geocodes_record ON derived_coordinate_geocodes (record_id);

CREATE TRIGGER derived_coordinate_geocodes_immutable
BEFORE UPDATE ON derived_coordinate_geocodes
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_geocodes are immutable evidence; record a new geocode run instead');
END;

CREATE TRIGGER derived_coordinate_geocodes_no_delete
BEFORE DELETE ON derived_coordinate_geocodes
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_geocodes are immutable evidence; record a new geocode run instead');
END;

CREATE TABLE derived_coordinate_reviews (
  review_id             INTEGER PRIMARY KEY,
  geocode_id            INTEGER NOT NULL REFERENCES derived_coordinate_geocodes (geocode_id),
  -- The digest the reviewer saw. A review never carries over to a different geocode run.
  evidence_sha256       TEXT NOT NULL CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  decision              TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  reviewer              TEXT NOT NULL CHECK (reviewer <> ''),
  -- The six things the reviewer confirmed (JSON object of booleans); an approval needs all of them true.
  checks_json           TEXT NOT NULL CHECK (json_valid(checks_json) AND json_type(checks_json) = 'object'),
  -- Independent position evidence the reviewer relied on (required below residential-detail precision).
  site_evidence         TEXT,
  note                  TEXT,
  gate_version          TEXT NOT NULL CHECK (gate_version <> ''),
  reviewed_at           TEXT NOT NULL
);

CREATE INDEX derived_coordinate_reviews_geocode ON derived_coordinate_reviews (geocode_id, reviewed_at);

CREATE TRIGGER derived_coordinate_reviews_digest_matches
BEFORE INSERT ON derived_coordinate_reviews
WHEN NEW.evidence_sha256 IS NOT (SELECT evidence_sha256 FROM derived_coordinate_geocodes WHERE geocode_id = NEW.geocode_id)
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews: the review names different evidence than its geocode run');
END;

CREATE TRIGGER derived_coordinate_reviews_approve_needs_precision
BEFORE INSERT ON derived_coordinate_reviews
WHEN NEW.decision = 'approve'
  AND (SELECT precision FROM derived_coordinate_geocodes WHERE geocode_id = NEW.geocode_id) = 'insufficient'
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews: an insufficient-precision geocode cannot be approved');
END;

CREATE TRIGGER derived_coordinate_reviews_approve_needs_checks
BEFORE INSERT ON derived_coordinate_reviews
WHEN NEW.decision = 'approve' AND NOT (
  json_extract(NEW.checks_json, '$.officialAddress') IS 1 AND json_extract(NEW.checks_json, '$.normalizedAddress') IS 1
  AND json_extract(NEW.checks_json, '$.returnedLocation') IS 1 AND json_extract(NEW.checks_json, '$.precision') IS 1
  AND json_extract(NEW.checks_json, '$.regionSanity') IS 1 AND json_extract(NEW.checks_json, '$.currentListing') IS 1)
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews: an approval must confirm every review check');
END;

CREATE TRIGGER derived_coordinate_reviews_coarse_needs_site_evidence
BEFORE INSERT ON derived_coordinate_reviews
WHEN NEW.decision = 'approve' AND (NEW.site_evidence IS NULL OR NEW.site_evidence = '')
  AND (SELECT precision FROM derived_coordinate_geocodes WHERE geocode_id = NEW.geocode_id) <> 'residentialDetail'
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews: block/parcel precision needs independent site evidence');
END;

CREATE TRIGGER derived_coordinate_reviews_immutable
BEFORE UPDATE ON derived_coordinate_reviews
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews are append-only; record a newer decision instead');
END;

CREATE TRIGGER derived_coordinate_reviews_no_delete
BEFORE DELETE ON derived_coordinate_reviews
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews are append-only; record a newer decision instead');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target: both bootstrap guards name every table, now including 0022's (test/promotion-empty-target.test.ts).
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
  OR EXISTS (SELECT 1 FROM cross_source_candidates)
  OR EXISTS (SELECT 1 FROM cross_source_decisions)
  OR EXISTS (SELECT 1 FROM cross_source_merge_applications)
  OR EXISTS (SELECT 1 FROM promotion_cross_source_merge_attestations)
  OR EXISTS (SELECT 1 FROM community_reconciliation_applications)
  OR EXISTS (SELECT 1 FROM community_reconciliation_evidence)
  OR EXISTS (SELECT 1 FROM report_terms_versions)
  OR EXISTS (SELECT 1 FROM community_effect_applications)
  OR EXISTS (SELECT 1 FROM community_effect_evidence)
  OR EXISTS (SELECT 1 FROM community_publication_holds)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases)
  OR EXISTS (SELECT 1 FROM derived_coordinate_geocodes)
  OR EXISTS (SELECT 1 FROM derived_coordinate_reviews)
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

DROP TRIGGER promotion_multi_bootstraps_empty_target;

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
  OR EXISTS (SELECT 1 FROM cross_source_candidates)
  OR EXISTS (SELECT 1 FROM cross_source_decisions)
  OR EXISTS (SELECT 1 FROM cross_source_merge_applications)
  OR EXISTS (SELECT 1 FROM promotion_cross_source_merge_attestations)
  OR EXISTS (SELECT 1 FROM community_reconciliation_applications)
  OR EXISTS (SELECT 1 FROM community_reconciliation_evidence)
  OR EXISTS (SELECT 1 FROM report_terms_versions)
  OR EXISTS (SELECT 1 FROM community_effect_applications)
  OR EXISTS (SELECT 1 FROM community_effect_evidence)
  OR EXISTS (SELECT 1 FROM community_publication_holds)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases)
  OR EXISTS (SELECT 1 FROM derived_coordinate_geocodes)
  OR EXISTS (SELECT 1 FROM derived_coordinate_reviews)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;
