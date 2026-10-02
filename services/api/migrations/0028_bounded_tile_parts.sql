-- Bounded multipart tile snapshots (Issue #158; ADR-0005 "Amendment — bounded tile parts"; docs/API.md).
--
-- A logical tile keeps ONE tile_snapshots row (its head: revision, ETag hash, total spot_count, and the
-- tile_snapshot_spots membership of every spot in it). The head body is either
--   schema_version 1  the complete v1 tile body: a single-part tile, served unchanged by GET /v1/tiles; or
--   schema_version 2  the multipart manifest (src/tiles/parts.ts), whose parts are rows of tile_snapshot_parts.
-- Every part body is an ordinary schemaVersion-1 tile body carrying a disjoint, id-ordered subset of the tile's
-- spots and exactly the sources they cite.
--
-- Hard row budget: no stored tile body (head or part) exceeds 44,000 UTF-8 bytes, whatever the local density.
-- That bounds every D1 row and every promotion statement that carries one (PR #159: 90,000-byte statements; even
-- a body of nothing but quotes is an 88,002-byte SQL literal). The publisher partitions to meet it and never drops
-- a spot; these checks make an over-budget write impossible, not merely unlikely.
--
-- promotion-bundle v2/v3 bootstraps carry no multipart tile (their completion counts know only tile_snapshots):
-- their exporters refuse a database with one, and these triggers refuse a part or a manifest head inside such a
-- bootstrap. Segmented promotion (PR #159) carries tile_snapshot_parts as an ordinary bounded table.

CREATE TABLE tile_snapshot_parts (
  tile_id        TEXT NOT NULL REFERENCES tile_snapshots (tile_id),
  part_index     INTEGER NOT NULL CHECK (part_index >= 0),
  -- The head's revision when this part was published (a part never outlives its revision).
  revision       INTEGER NOT NULL CHECK (revision >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  spot_count     INTEGER NOT NULL CHECK (spot_count BETWEEN 0 AND 250),
  body_json      TEXT NOT NULL CHECK (json_valid(body_json) AND length(CAST(body_json AS BLOB)) <= 44000),
  PRIMARY KEY (tile_id, part_index)
) WITHOUT ROWID;

-- A part belongs to a multipart head of the same revision (written in the same publish batch, after the head).
CREATE TRIGGER tile_snapshot_parts_head
BEFORE INSERT ON tile_snapshot_parts
WHEN NOT EXISTS (SELECT 1 FROM tile_snapshots t WHERE t.tile_id = NEW.tile_id AND t.schema_version = 2 AND t.revision = NEW.revision)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_parts: a part needs its multipart head (schema_version 2) at the same revision');
END;

CREATE TRIGGER tile_snapshot_parts_no_update
BEFORE UPDATE ON tile_snapshot_parts
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_parts are replaced by republishing their tile, never updated');
END;

-- Every tile head body is bounded too (a manifest, or a single-part v1 body).
CREATE TRIGGER tile_snapshots_body_budget_insert
BEFORE INSERT ON tile_snapshots
WHEN length(CAST(NEW.body_json AS BLOB)) > 44000 OR NEW.schema_version NOT IN (1, 2)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshots: a tile body over 44000 bytes must be published as bounded parts');
END;

CREATE TRIGGER tile_snapshots_body_budget_update
BEFORE UPDATE OF body_json, schema_version ON tile_snapshots
WHEN length(CAST(NEW.body_json AS BLOB)) > 44000 OR NEW.schema_version NOT IN (1, 2)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshots: a tile body over 44000 bytes must be published as bounded parts');
END;

-- v2/v3 bootstraps cannot represent a multipart tile.
CREATE TRIGGER tile_snapshot_parts_not_in_v2_v3_bootstrap
BEFORE INSERT ON tile_snapshot_parts
WHEN EXISTS (SELECT 1 FROM promotion_bootstraps) OR EXISTS (SELECT 1 FROM promotion_multi_bootstraps)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_parts: promotion-bundle v2/v3 carry no multipart tile; use segmented promotion');
END;

CREATE TRIGGER tile_snapshots_manifest_not_in_v2_v3_bootstrap
BEFORE INSERT ON tile_snapshots
WHEN NEW.schema_version <> 1 AND (EXISTS (SELECT 1 FROM promotion_bootstraps) OR EXISTS (SELECT 1 FROM promotion_multi_bootstraps))
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshots: promotion-bundle v2/v3 carry no multipart tile; use segmented promotion');
END;

-- Empty target: both bootstrap guards name every table, now including tile_snapshot_parts.
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
