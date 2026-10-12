-- ADR-0018 §5 / DATA_POLICY §Contradicting official publications: a reviewed source-evidence hold. When a first-party
-- factReference page no longer shows the fact range a spot was published from (or the page is gone), a maintainer —
-- never source health itself, never a pipeline — records a hold here and the spot leaves publication fail closed.
--
-- Source health stays advisory: it only produces the report the hold cites (its SHA-256 and evaluated date). A
-- contentChanged result is never a hold reason; only a missing fact range or a missing resource is.
--
-- Append-only like the community holds (0021, 0024): one active hold per spot, the only update is one reviewed clear,
-- rows are never deleted, so every hold and clear stays auditable. Holds stay in the origin database and never travel
-- in a promotion bundle (Issue #100): a held spot is simply not published, so no bundle carries it.

CREATE TABLE spot_evidence_holds (
  hold_id              INTEGER PRIMARY KEY,
  source_id            TEXT NOT NULL REFERENCES sources (source_id),
  spot_id              TEXT NOT NULL REFERENCES spots (spot_id),
  reason               TEXT NOT NULL CHECK (reason IN ('sourceEvidenceMissing')),
  -- The health signal the report showed for this source: the reviewed fact range was not found on the page, or the
  -- page answered 404/410.
  health_signal        TEXT NOT NULL CHECK (health_signal IN ('pageFactScopeMissing', 'resourceMissing')),
  health_report_sha256 TEXT NOT NULL CHECK (length(health_report_sha256) = 64 AND health_report_sha256 NOT GLOB '*[^0-9a-f]*'),
  health_evaluated_on  TEXT NOT NULL CHECK (health_evaluated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  executor_version     TEXT NOT NULL CHECK (executor_version = 'source-evidence-hold.v1'),
  held_by              TEXT NOT NULL CHECK (length(held_by) BETWEEN 1 AND 64),
  held_at              TEXT NOT NULL,
  cleared_at           TEXT,
  cleared_by           TEXT CHECK (cleared_by IS NULL OR length(cleared_by) BETWEEN 1 AND 64),
  -- factsReReviewed: the page was re-reviewed and lists the place (a new reviewed fact sheet, or the same facts).
  -- healthFalsePositive: the report was wrong (e.g. the page moved its markup), recorded as such.
  clear_basis          TEXT CHECK (clear_basis IS NULL OR clear_basis IN ('factsReReviewed', 'healthFalsePositive')),
  CHECK ((cleared_at IS NULL) = (cleared_by IS NULL) AND (cleared_at IS NULL) = (clear_basis IS NULL))
);

CREATE UNIQUE INDEX spot_evidence_holds_one_active ON spot_evidence_holds (spot_id) WHERE cleared_at IS NULL;

-- REPLACE conflict resolution (INSERT OR REPLACE, REPLACE) deletes the conflicting row without firing a DELETE trigger,
-- so the no-delete trigger below cannot see it. A BEFORE INSERT trigger runs before conflict resolution: refusing any
-- insert whose hold_id already exists, or whose spot already has an active hold, leaves REPLACE nothing to delete.
CREATE TRIGGER spot_evidence_holds_append_only
BEFORE INSERT ON spot_evidence_holds
WHEN EXISTS (SELECT 1 FROM spot_evidence_holds h WHERE h.hold_id = NEW.hold_id)
  OR EXISTS (SELECT 1 FROM spot_evidence_holds h WHERE h.spot_id = NEW.spot_id AND h.cleared_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'spot_evidence_holds: append-only; a hold id is never reused and an active hold is never replaced');
END;

-- A hold cites the source the spot's existence evidence actually comes from, and the spot is unpublished already
-- (ADR-0006 decision 11: unpublish first; the hold step deletes the tile membership earlier in its batch).
CREATE TRIGGER spot_evidence_holds_premise
BEFORE INSERT ON spot_evidence_holds
WHEN NOT EXISTS (SELECT 1 FROM spot_field_provenance p
                 JOIN source_records r ON r.record_id = p.record_id
                 JOIN source_releases rel ON rel.release_id = r.release_id
                 WHERE p.spot_id = NEW.spot_id AND p.field = 'existence' AND rel.source_id = NEW.source_id)
  OR EXISTS (SELECT 1 FROM tile_snapshot_spots t WHERE t.spot_id = NEW.spot_id)
  OR NEW.cleared_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'spot evidence hold: not an unpublished spot whose existence evidence comes from this source');
END;

CREATE TRIGGER spot_evidence_holds_clear_only
BEFORE UPDATE ON spot_evidence_holds
WHEN NEW.hold_id IS NOT OLD.hold_id OR NEW.source_id IS NOT OLD.source_id OR NEW.spot_id IS NOT OLD.spot_id
  OR NEW.reason IS NOT OLD.reason OR NEW.health_signal IS NOT OLD.health_signal
  OR NEW.health_report_sha256 IS NOT OLD.health_report_sha256 OR NEW.health_evaluated_on IS NOT OLD.health_evaluated_on
  OR NEW.executor_version IS NOT OLD.executor_version OR NEW.held_by IS NOT OLD.held_by OR NEW.held_at IS NOT OLD.held_at
  OR OLD.cleared_at IS NOT NULL OR NEW.cleared_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'spot_evidence_holds: the only update is one reviewed clear');
END;

CREATE TRIGGER spot_evidence_holds_no_delete
BEFORE DELETE ON spot_evidence_holds
BEGIN
  SELECT RAISE(ABORT, 'spot_evidence_holds: holds are never deleted; clear them');
END;

CREATE TRIGGER tile_snapshot_spots_source_evidence_hold
BEFORE INSERT ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM spot_evidence_holds h WHERE h.spot_id = NEW.spot_id AND h.cleared_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: the spot is held because its source evidence is missing');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target: every bootstrap guard names every table, now including 0033's (test/promotion-empty-target.test.ts).
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
  OR EXISTS (SELECT 1 FROM area_location_anchors)
  OR EXISTS (SELECT 1 FROM spot_location_anchors)
  OR EXISTS (SELECT 1 FROM area_precision_upgrades)
  OR EXISTS (SELECT 1 FROM area_anchor_relocation_deltas)
  OR EXISTS (SELECT 1 FROM spot_location_authorities)
  OR EXISTS (SELECT 1 FROM area_point_mappings)
  OR EXISTS (SELECT 1 FROM promotion_location_evidence_attestations)
  OR EXISTS (SELECT 1 FROM spot_evidence_holds)
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
  OR EXISTS (SELECT 1 FROM area_location_anchors)
  OR EXISTS (SELECT 1 FROM spot_location_anchors)
  OR EXISTS (SELECT 1 FROM area_precision_upgrades)
  OR EXISTS (SELECT 1 FROM area_anchor_relocation_deltas)
  OR EXISTS (SELECT 1 FROM spot_location_authorities)
  OR EXISTS (SELECT 1 FROM area_point_mappings)
  OR EXISTS (SELECT 1 FROM promotion_location_evidence_attestations)
  OR EXISTS (SELECT 1 FROM spot_evidence_holds)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

DROP TRIGGER promotion_v4_empty_target;
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
  OR EXISTS (SELECT 1 FROM area_location_anchors)
  OR EXISTS (SELECT 1 FROM spot_location_anchors)
  OR EXISTS (SELECT 1 FROM area_precision_upgrades)
  OR EXISTS (SELECT 1 FROM area_anchor_relocation_deltas)
  OR EXISTS (SELECT 1 FROM spot_location_authorities)
  OR EXISTS (SELECT 1 FROM area_point_mappings)
  OR EXISTS (SELECT 1 FROM promotion_location_evidence_attestations)
  OR EXISTS (SELECT 1 FROM spot_evidence_holds)
BEGIN SELECT RAISE(ABORT, 'v4 requires a fresh GREEN database'); END;
