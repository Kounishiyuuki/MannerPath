-- promotion-bundle.v4: GREEN-only resumable staging. Existing v2/v3 completion seals remain authoritative.
-- File digests are checked by the streaming executor against an independently reviewed manifest digest;
-- SQLite/D1 has no SHA-256 function. The DB binds receipts to those declarations and gates completion.
CREATE TABLE promotion_v4_manifests (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  capacity_policy TEXT NOT NULL CHECK (capacity_policy = 'd1-capacity.v1'),
  expected_chunks INTEGER NOT NULL CHECK (expected_chunks > 0)
);
CREATE TABLE promotion_v4_expected_chunks (
  ordinal INTEGER PRIMARY KEY CHECK (ordinal > 0),
  manifest_id INTEGER NOT NULL REFERENCES promotion_v4_manifests(id) CHECK (manifest_id = 1),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  statements INTEGER NOT NULL CHECK (statements > 0),
  rows_json TEXT NOT NULL CHECK (json_valid(rows_json))
);
CREATE TABLE promotion_v4_expected_sources (
  source_id TEXT PRIMARY KEY CHECK (source_id <> ''),
  manifest_id INTEGER NOT NULL REFERENCES promotion_v4_manifests(id) CHECK (manifest_id = 1),
  release_id INTEGER NOT NULL UNIQUE CHECK (release_id > 0),
  release_content_sha256 TEXT NOT NULL CHECK (length(release_content_sha256) = 64 AND release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  display_name TEXT NOT NULL CHECK (trim(display_name) <> ''),
  license_name TEXT,
  license_url TEXT,
  attribution_text TEXT NOT NULL CHECK (trim(attribution_text) <> ''),
  review_dependencies_json TEXT NOT NULL CHECK (json_valid(review_dependencies_json) AND json_type(review_dependencies_json) = 'array'),
  expected_rows_json TEXT NOT NULL CHECK (json_valid(expected_rows_json) AND json_type(expected_rows_json) = 'object'),
  observed_on TEXT
);
CREATE TABLE promotion_v4_expected_releases (
  release_id INTEGER PRIMARY KEY CHECK (release_id > 0),
  source_id TEXT NOT NULL REFERENCES promotion_v4_expected_sources(source_id),
  release_content_sha256 TEXT NOT NULL CHECK (length(release_content_sha256) = 64 AND release_content_sha256 NOT GLOB '*[^0-9a-f]*')
);
CREATE TABLE promotion_v4_expected_tiles (
  tile_id TEXT PRIMARY KEY,
  manifest_id INTEGER NOT NULL REFERENCES promotion_v4_manifests(id) CHECK (manifest_id = 1),
  revision INTEGER NOT NULL,
  spot_count INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version IN (1,2)),
  part_count INTEGER NOT NULL CHECK (part_count BETWEEN 0 AND 128 AND (schema_version=2 OR part_count=0))
);
CREATE TABLE promotion_v4_expected_tile_parts (
  tile_id TEXT NOT NULL REFERENCES promotion_v4_expected_tiles(tile_id),
  part_index INTEGER NOT NULL CHECK (part_index BETWEEN 0 AND 127),
  spot_count INTEGER NOT NULL CHECK (spot_count BETWEEN 1 AND 250),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (tile_id,part_index)
);
CREATE TABLE promotion_v4_applied_chunks (
  ordinal INTEGER PRIMARY KEY REFERENCES promotion_v4_expected_chunks(ordinal),
  manifest_sha256 TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  statements INTEGER NOT NULL,
  rows_json TEXT NOT NULL
);
CREATE TABLE promotion_v4_completions (
  id INTEGER PRIMARY KEY REFERENCES promotion_v4_manifests(id) CHECK (id = 1),
  manifest_sha256 TEXT NOT NULL
);
CREATE TABLE promotion_v4_chunk_sessions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ordinal INTEGER NOT NULL REFERENCES promotion_v4_expected_chunks(ordinal) CHECK (ordinal = 1),
  manifest_sha256 TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TRIGGER promotion_v4_chunk_session_valid BEFORE INSERT ON promotion_v4_chunk_sessions
WHEN EXISTS (SELECT 1 FROM promotion_v4_applied_chunks)
 OR EXISTS (SELECT 1 FROM promotion_v4_completions)
 OR EXISTS (SELECT 1 FROM promotion_multi_bootstraps)
 OR NOT EXISTS (SELECT 1 FROM promotion_v4_expected_chunks e JOIN promotion_v4_manifests m ON m.id=e.manifest_id
   WHERE e.ordinal=NEW.ordinal AND e.sha256=NEW.sha256 AND m.manifest_sha256=NEW.manifest_sha256)
BEGIN SELECT RAISE(ABORT, 'v4 first chunk authorization mismatch'); END;
CREATE TRIGGER promotion_v4_chunk_sessions_no_update BEFORE UPDATE ON promotion_v4_chunk_sessions
BEGIN SELECT RAISE(ABORT, 'v4 chunk authorization is immutable'); END;
CREATE TRIGGER promotion_v4_empty_target BEFORE INSERT ON promotion_v4_manifests
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
 OR EXISTS (SELECT 1 FROM tile_snapshot_parts)
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
 OR EXISTS (SELECT 1 FROM promotion_v4_manifests)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_chunks)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_tile_parts)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_tiles)
 OR EXISTS (SELECT 1 FROM promotion_v4_applied_chunks)
 OR EXISTS (SELECT 1 FROM promotion_v4_completions)
 OR EXISTS (SELECT 1 FROM promotion_v4_chunk_sessions)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_sources)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_releases)
BEGIN SELECT RAISE(ABORT, 'v4 requires a fresh GREEN database'); END;
CREATE TRIGGER promotion_v4_no_v2_bootstrap BEFORE INSERT ON promotion_bootstraps
WHEN EXISTS (SELECT 1 FROM promotion_v4_manifests)
BEGIN SELECT RAISE(ABORT, 'promotion_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database'); END;
CREATE TRIGGER promotion_v4_chunk_receipt BEFORE INSERT ON promotion_v4_applied_chunks
WHEN EXISTS (SELECT 1 FROM promotion_v4_completions)
 OR NEW.ordinal <> (SELECT count(*) + 1 FROM promotion_v4_applied_chunks)
 OR NOT EXISTS (SELECT 1 FROM promotion_v4_expected_chunks e JOIN promotion_v4_manifests m ON m.id=e.manifest_id
   WHERE e.ordinal=NEW.ordinal AND e.sha256=NEW.sha256 AND m.manifest_sha256=NEW.manifest_sha256
   AND e.bytes=NEW.bytes AND e.statements=NEW.statements AND e.rows_json=NEW.rows_json)
BEGIN SELECT RAISE(ABORT, 'v4 chunk digest, manifest or order mismatch'); END;
CREATE TRIGGER promotion_v4_before_v3_completion BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM promotion_v4_manifests) AND (
 (SELECT count(*) FROM promotion_v4_applied_chunks) <> (SELECT expected_chunks FROM promotion_v4_manifests WHERE id=1)
 OR (SELECT count(*) FROM promotion_v4_expected_chunks) <> (SELECT expected_chunks FROM promotion_v4_manifests WHERE id=1)

 OR (SELECT count(*) FROM promotion_v4_expected_sources) <> (SELECT count(*) FROM promotion_multi_bootstrap_sources)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_sources e LEFT JOIN promotion_multi_bootstrap_sources a ON a.source_id=e.source_id
   LEFT JOIN source_releases r ON r.release_id=e.release_id
   WHERE a.source_id IS NULL OR a.release_id IS NOT e.release_id OR a.release_content_sha256 IS NOT e.release_content_sha256
     OR a.display_name IS NOT e.display_name OR a.license_name IS NOT e.license_name OR a.license_url IS NOT e.license_url
     OR a.attribution_text IS NOT e.attribution_text OR r.release_id IS NULL OR r.observed_on IS NOT e.observed_on
     OR EXISTS (SELECT 1 FROM json_tree(e.expected_rows_json) x WHERE NOT EXISTS (
       SELECT 1 FROM json_tree(a.expected_rows_json) y WHERE y.fullkey=x.fullkey AND y.type=x.type AND y.atom IS x.atom))
     OR EXISTS (SELECT 1 FROM json_tree(a.expected_rows_json) x WHERE NOT EXISTS (
       SELECT 1 FROM json_tree(e.expected_rows_json) y WHERE y.fullkey=x.fullkey AND y.type=x.type AND y.atom IS x.atom))
     OR EXISTS (SELECT 1 FROM json_tree(e.review_dependencies_json) x WHERE NOT EXISTS (
       SELECT 1 FROM json_tree(a.review_dependencies_json) y WHERE y.fullkey=x.fullkey AND y.type=x.type AND y.atom IS x.atom))
     OR EXISTS (SELECT 1 FROM json_tree(a.review_dependencies_json) x WHERE NOT EXISTS (
       SELECT 1 FROM json_tree(e.review_dependencies_json) y WHERE y.fullkey=x.fullkey AND y.type=x.type AND y.atom IS x.atom))
 )
 OR (SELECT count(*) FROM promotion_v4_expected_releases) <> (SELECT count(*) FROM promotion_multi_bootstrap_additive_releases)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_releases e LEFT JOIN promotion_multi_bootstrap_additive_releases a ON a.release_id=e.release_id
   WHERE a.release_id IS NULL OR a.source_id IS NOT e.source_id OR a.release_content_sha256 IS NOT e.release_content_sha256)
 OR (SELECT count(*) FROM tile_snapshots) <> (SELECT count(*) FROM promotion_v4_expected_tiles)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_tiles e LEFT JOIN tile_snapshots t ON t.tile_id=e.tile_id
   WHERE t.tile_id IS NULL OR t.revision<>e.revision OR t.spot_count<>e.spot_count OR t.content_sha256<>e.content_sha256
     OR t.schema_version<>e.schema_version
     OR json_extract(t.body_json,'$.schemaVersion') IS NOT e.schema_version
     OR json_extract(t.body_json,'$.tile') IS NOT e.tile_id
     OR json_extract(t.body_json,'$.revision') IS NOT e.revision
     OR json_extract(t.body_json,'$.generatedAt') IS NOT t.published_at
     OR (e.schema_version=2 AND json_extract(t.body_json,'$.partPolicy') IS NOT 'tile-parts.v1')
     OR e.spot_count<>(SELECT count(*) FROM tile_snapshot_spots m WHERE m.tile_id=e.tile_id)
     OR e.part_count<>(SELECT count(*) FROM promotion_v4_expected_tile_parts p WHERE p.tile_id=e.tile_id)
     OR e.part_count<>(SELECT count(*) FROM tile_snapshot_parts p WHERE p.tile_id=e.tile_id)
     OR (e.schema_version=2 AND (json_extract(t.body_json,'$.spotCount') IS NOT e.spot_count
       OR json_array_length(t.body_json,'$.parts') IS NOT e.part_count
       OR e.spot_count<>(SELECT coalesce(sum(p.spot_count),0) FROM tile_snapshot_parts p WHERE p.tile_id=e.tile_id)))
     OR EXISTS (SELECT 1 FROM promotion_v4_expected_tile_parts p LEFT JOIN tile_snapshot_parts a
       ON a.tile_id=p.tile_id AND a.part_index=p.part_index WHERE p.tile_id=e.tile_id AND (
         a.tile_id IS NULL OR a.spot_count IS NOT p.spot_count OR a.content_sha256 IS NOT p.content_sha256
         OR json_extract(t.body_json,'$.parts['||p.part_index||'].index') IS NOT p.part_index
         OR json_extract(t.body_json,'$.parts['||p.part_index||'].spotCount') IS NOT p.spot_count
         OR json_extract(t.body_json,'$.parts['||p.part_index||'].sha256') IS NOT p.content_sha256
         OR json_extract(a.body_json,'$.schemaVersion') IS NOT 2
         OR json_extract(a.body_json,'$.tile') IS NOT e.tile_id
         OR json_extract(a.body_json,'$.part') IS NOT p.part_index
         OR json_extract(a.body_json,'$.partCount') IS NOT e.part_count
         OR json_array_length(a.body_json,'$.spots') IS NOT p.spot_count
         OR EXISTS (SELECT 1 FROM json_each(a.body_json,'$.spots') j WHERE NOT EXISTS (
           SELECT 1 FROM tile_snapshot_spots m WHERE m.tile_id=e.tile_id AND m.spot_id=json_extract(j.value,'$.id')))
         OR EXISTS (SELECT 1 FROM json_each(a.body_json,'$.sources') j WHERE NOT EXISTS (
           SELECT 1 FROM sources q WHERE q.source_id=json_extract(j.value,'$.id')))))
     OR (e.schema_version=2 AND e.spot_count<>(SELECT count(DISTINCT json_extract(j.value,'$.id'))
       FROM tile_snapshot_parts p, json_each(p.body_json,'$.spots') j WHERE p.tile_id=e.tile_id))))
BEGIN SELECT RAISE(ABORT, 'v4 final state is incomplete'); END;
CREATE TRIGGER promotion_v4_completion_valid BEFORE INSERT ON promotion_v4_completions
WHEN EXISTS (SELECT 1 FROM promotion_v4_chunk_sessions)
 OR NOT EXISTS (SELECT 1 FROM promotion_v4_manifests m WHERE m.id=NEW.id AND m.manifest_sha256=NEW.manifest_sha256
  AND m.expected_chunks=(SELECT count(*) FROM promotion_v4_applied_chunks))
 OR NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN SELECT RAISE(ABORT, 'v4 completion requires verified chunks and sealed final state'); END;
CREATE TRIGGER promotion_v4_manifests_no_update BEFORE UPDATE ON promotion_v4_manifests
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_manifests_no_delete BEFORE DELETE ON promotion_v4_manifests
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_chunks_no_update BEFORE UPDATE ON promotion_v4_expected_chunks
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_chunks_no_delete BEFORE DELETE ON promotion_v4_expected_chunks
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_tiles_no_update BEFORE UPDATE ON promotion_v4_expected_tiles
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_tiles_no_delete BEFORE DELETE ON promotion_v4_expected_tiles
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_applied_chunks_no_update BEFORE UPDATE ON promotion_v4_applied_chunks
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_applied_chunks_no_delete BEFORE DELETE ON promotion_v4_applied_chunks
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_completions_no_update BEFORE UPDATE ON promotion_v4_completions
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_completions_no_delete BEFORE DELETE ON promotion_v4_completions
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_chunks_closed BEFORE INSERT ON promotion_v4_expected_chunks
WHEN EXISTS (SELECT 1 FROM promotion_v4_applied_chunks) OR EXISTS (SELECT 1 FROM promotion_v4_completions)
BEGIN SELECT RAISE(ABORT, 'v4 declarations are closed'); END;
CREATE TRIGGER promotion_v4_expected_tiles_closed BEFORE INSERT ON promotion_v4_expected_tiles
WHEN EXISTS (SELECT 1 FROM promotion_v4_applied_chunks) OR EXISTS (SELECT 1 FROM promotion_v4_completions)
BEGIN SELECT RAISE(ABORT, 'v4 declarations are closed'); END;

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
  OR EXISTS (SELECT 1 FROM tile_snapshot_parts)
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
  OR EXISTS (SELECT 1 FROM promotion_v4_manifests)
  OR EXISTS (SELECT 1 FROM promotion_v4_expected_chunks)
  OR EXISTS (SELECT 1 FROM promotion_v4_expected_tile_parts)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_tiles)
  OR EXISTS (SELECT 1 FROM promotion_v4_applied_chunks)
  OR EXISTS (SELECT 1 FROM promotion_v4_completions)
  OR EXISTS (SELECT 1 FROM promotion_v4_chunk_sessions)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_sources)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_releases)
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
  OR EXISTS (SELECT 1 FROM tile_snapshot_parts)
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
  OR (EXISTS (SELECT 1 FROM promotion_v4_manifests)
  OR EXISTS (SELECT 1 FROM promotion_v4_expected_chunks)
  OR EXISTS (SELECT 1 FROM promotion_v4_expected_tile_parts)
 OR EXISTS (SELECT 1 FROM promotion_v4_expected_tiles)
  OR EXISTS (SELECT 1 FROM promotion_v4_applied_chunks)
  OR EXISTS (SELECT 1 FROM promotion_v4_completions)
  OR EXISTS (SELECT 1 FROM promotion_v4_chunk_sessions)
  OR EXISTS (SELECT 1 FROM promotion_v4_expected_sources)
  OR EXISTS (SELECT 1 FROM promotion_v4_expected_releases)) AND NOT EXISTS (
    SELECT 1 FROM promotion_v4_chunk_sessions a
    JOIN promotion_v4_manifests m ON m.id=a.id
    JOIN promotion_v4_expected_chunks e ON e.ordinal=a.ordinal
    WHERE a.id=1 AND a.ordinal=1 AND a.manifest_sha256=m.manifest_sha256 AND a.sha256=e.sha256
      AND NOT EXISTS (SELECT 1 FROM promotion_v4_applied_chunks)
      AND NOT EXISTS (SELECT 1 FROM promotion_v4_completions))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

CREATE TRIGGER promotion_v4_expected_sources_no_update BEFORE UPDATE ON promotion_v4_expected_sources
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_sources_no_delete BEFORE DELETE ON promotion_v4_expected_sources
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_sources_closed BEFORE INSERT ON promotion_v4_expected_sources
WHEN EXISTS (SELECT 1 FROM promotion_v4_applied_chunks) OR EXISTS (SELECT 1 FROM promotion_v4_completions)
BEGIN SELECT RAISE(ABORT, 'v4 declarations are closed'); END;

CREATE TRIGGER promotion_v4_expected_releases_no_update BEFORE UPDATE ON promotion_v4_expected_releases
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_releases_no_delete BEFORE DELETE ON promotion_v4_expected_releases
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_releases_closed BEFORE INSERT ON promotion_v4_expected_releases
WHEN EXISTS (SELECT 1 FROM promotion_v4_applied_chunks) OR EXISTS (SELECT 1 FROM promotion_v4_completions)
BEGIN SELECT RAISE(ABORT, 'v4 declarations are closed'); END;

CREATE TRIGGER promotion_v4_expected_tile_parts_no_update BEFORE UPDATE ON promotion_v4_expected_tile_parts
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_tile_parts_no_delete BEFORE DELETE ON promotion_v4_expected_tile_parts
BEGIN SELECT RAISE(ABORT, 'v4 ledger is immutable'); END;
CREATE TRIGGER promotion_v4_expected_tile_parts_closed BEFORE INSERT ON promotion_v4_expected_tile_parts
WHEN EXISTS (SELECT 1 FROM promotion_v4_applied_chunks) OR EXISTS (SELECT 1 FROM promotion_v4_completions)
BEGIN SELECT RAISE(ABORT, 'v4 declarations are closed'); END;
