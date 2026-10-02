-- 0028: bounded tile parts (ADR-0015, Issue #158).
--
-- A tile snapshot is now a manifest (tile_snapshots.body_json, schemaVersion 2) plus content-addressed part rows
-- here. The publish step replaces a tile's parts in the same batch as its manifest, so a reader never sees a
-- manifest without its parts. Each part is bounded by the versioned part policy (src/tiles/parts.ts,
-- "tile-parts.v1"); the CHECKs below restate its spot and byte bounds so that no code path can store an
-- oversized row, whatever the density of the tile. Existing schemaVersion 1 rows stay readable at the v1 path
-- and convert on the next publish.

CREATE TABLE tile_snapshot_parts (
  tile_id              TEXT NOT NULL REFERENCES tile_snapshots (tile_id),
  part_index           INTEGER NOT NULL CHECK (part_index BETWEEN 0 AND 127),
  content_sha256       TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  spot_count           INTEGER NOT NULL CHECK (spot_count BETWEEN 1 AND 250),
  -- Bytes as a SQL literal (each quote twice), so one row always fits one D1 statement (100,000 bytes).
  body_json            TEXT NOT NULL CHECK (json_valid(body_json)
                         AND length(CAST(body_json AS BLOB)) + length(body_json) - length(replace(body_json, '''', '')) <= 65536),
  PRIMARY KEY (tile_id, part_index)
);

-- Empty target: both bootstrap guards name every table, now including 0028's (test/promotion-empty-target.test.ts).
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
  OR EXISTS (SELECT 1 FROM community_evidence_upgrades)
  OR EXISTS (SELECT 1 FROM community_absence_applications)
  OR EXISTS (SELECT 1 FROM community_absence_evidence)
  OR EXISTS (SELECT 1 FROM community_absence_holds)
  OR EXISTS (SELECT 1 FROM community_artifact_ledger)
  OR EXISTS (SELECT 1 FROM community_evidence_reports)
  OR EXISTS (SELECT 1 FROM tile_snapshot_parts)
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
  OR EXISTS (SELECT 1 FROM community_evidence_upgrades)
  OR EXISTS (SELECT 1 FROM community_absence_applications)
  OR EXISTS (SELECT 1 FROM community_absence_evidence)
  OR EXISTS (SELECT 1 FROM community_absence_holds)
  OR EXISTS (SELECT 1 FROM community_artifact_ledger)
  OR EXISTS (SELECT 1 FROM community_evidence_reports)
  OR EXISTS (SELECT 1 FROM tile_snapshot_parts)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;
