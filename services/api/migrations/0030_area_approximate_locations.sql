-- Approximate area locations (ADR-0017). Existence evidence and location precision are separate axes: a smoking
-- place whose existence an approved source states, but whose own point is unknown, may be pinned at a reviewed,
-- reusable representative anchor of the area/host it is inside (a park, station, facility, airport or commercial
-- building) and published as `verification.locationPrecision = "areaApproximate"`.
--
-- 1. area_location_anchors: one immutable, reviewed anchor. It records the area/host it represents, the coordinate,
--    where the coordinate comes from (origin kind, publisher, reference) and the reuse basis, the review and the
--    anchor policy version, bound together by an evidence digest. Policy v1 accepts only an anchor taken from the
--    existence source's own reviewed publication (origin_source_id), so its license and attribution are the ones the
--    tile already carries. Google/Apple POI coordinates, OSM values, map-screenshot readings and manual guesses have
--    no origin kind here and are refused by reference as defence in depth.
-- 2. spot_location_anchors: which anchor a canonical spot is pinned at, written by the resolver in the same batch as
--    the spot. At most one per spot (the spot ID is stable). While it is active the spot's coordinate is exactly the
--    anchor's. It ends only by a recorded reason, never by deletion:
--      precisionUpgrade      an exact point arrived at the SAME coordinate; only the precision changes (ADR-0017 §6).
--      relocationReview      the spot is under ADR-0009 relocation review (a relocation hold exists); the coordinate
--                            itself still changes only through review_relocation_applications (0015 trigger).
--
-- Each guard is its own small trigger (D1 expression depth, 0018/0019).

CREATE TABLE area_location_anchors (
  anchor_id          TEXT PRIMARY KEY CHECK (anchor_id GLOB 'aa_[a-z0-9]*' AND length(anchor_id) BETWEEN 4 AND 64),
  -- The area/host the smoking place is stated to be inside, as publicly named by the origin publisher.
  area_name          TEXT NOT NULL CHECK (length(area_name) BETWEEN 1 AND 80),
  area_kind          TEXT NOT NULL CHECK (area_kind IN ('park', 'station', 'facility', 'airport', 'commercialBuilding', 'other')),
  latitude           REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude          REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- What the point is: the publisher's own point for the area/host (never a smoking point).
  origin_kind        TEXT NOT NULL CHECK (origin_kind IN ('publisherAreaPoint', 'publisherFacilityPoint')),
  origin_source_id   TEXT NOT NULL REFERENCES sources (source_id),
  origin_reference   TEXT NOT NULL CHECK (length(origin_reference) BETWEEN 1 AND 500),
  reuse_basis        TEXT NOT NULL CHECK (reuse_basis IN ('existenceSourceLicense')),
  policy_version     TEXT NOT NULL CHECK (policy_version IN ('area-anchor-policy.v1')),
  reviewed_by        TEXT NOT NULL CHECK (reviewed_by <> ''),
  reviewed_on        TEXT NOT NULL CHECK (reviewed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  evidence_sha256    TEXT NOT NULL UNIQUE CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  recorded_at        TEXT NOT NULL
) WITHOUT ROWID;

CREATE TRIGGER area_location_anchors_forbidden_origin
BEFORE INSERT ON area_location_anchors
WHEN lower(NEW.origin_reference) GLOB '*google*' OR lower(NEW.origin_reference) GLOB '*goo.gl*'
  OR lower(NEW.origin_reference) GLOB '*maps.apple*' OR lower(NEW.origin_reference) GLOB '*openstreetmap*'
  OR lower(NEW.origin_reference) GLOB '*overpass*' OR lower(NEW.origin_reference) GLOB '*nominatim*'
  OR lower(NEW.origin_reference) GLOB '*screenshot*'
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: Google/Apple Maps, OSM and screenshot coordinates are never canonical anchors');
END;

CREATE TRIGGER area_location_anchors_origin_reviewed_source
BEFORE INSERT ON area_location_anchors
WHEN (SELECT kind FROM sources WHERE source_id = NEW.origin_source_id) IS NOT 'municipal'
  AND (SELECT kind FROM sources WHERE source_id = NEW.origin_source_id) IS NOT 'operator'
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: an anchor comes from a reviewed official or operator source');
END;

CREATE TRIGGER area_location_anchors_immutable BEFORE UPDATE ON area_location_anchors
BEGIN SELECT RAISE(ABORT, 'area_location_anchors are immutable; record a new anchor instead'); END;
CREATE TRIGGER area_location_anchors_no_delete BEFORE DELETE ON area_location_anchors
BEGIN SELECT RAISE(ABORT, 'area_location_anchors are immutable; record a new anchor instead'); END;

CREATE TABLE spot_location_anchors (
  spot_id            TEXT PRIMARY KEY REFERENCES spots (spot_id),
  anchor_id          TEXT NOT NULL REFERENCES area_location_anchors (anchor_id),
  -- The record whose observation named the anchor; its release's source must be the anchor's origin source.
  record_id          INTEGER NOT NULL REFERENCES source_records (record_id),
  resolver_version   TEXT NOT NULL,
  bound_at           TEXT NOT NULL,
  ended_at           TEXT,
  end_reason         TEXT CHECK (end_reason IN ('precisionUpgrade', 'relocationReview')),
  -- The precision the spot carries after a precisionUpgrade. reviewedDerived stays impossible while ADR-0011 is Proposed.
  upgraded_precision TEXT CHECK (upgraded_precision IN ('publisherPoint', 'communityPinned')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK ((end_reason = 'precisionUpgrade') = (upgraded_precision IS NOT NULL))
) WITHOUT ROWID;

CREATE INDEX spot_location_anchors_anchor ON spot_location_anchors (anchor_id);

CREATE TRIGGER spot_location_anchors_insert_valid
BEFORE INSERT ON spot_location_anchors
WHEN NEW.ended_at IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM spots s JOIN area_location_anchors a ON a.anchor_id = NEW.anchor_id
                 WHERE s.spot_id = NEW.spot_id AND s.latitude = a.latitude AND s.longitude = a.longitude)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: a spot is bound at exactly its anchor coordinate, and a binding starts active');
END;

CREATE TRIGGER spot_location_anchors_same_source
BEFORE INSERT ON spot_location_anchors
WHEN (SELECT rel.source_id FROM source_records r JOIN source_releases rel ON rel.release_id = r.release_id WHERE r.record_id = NEW.record_id)
  IS NOT (SELECT origin_source_id FROM area_location_anchors WHERE anchor_id = NEW.anchor_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: anchor policy v1 accepts only an anchor from the existence source itself');
END;

CREATE TRIGGER spot_location_anchors_end_once
BEFORE UPDATE ON spot_location_anchors
WHEN OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
  OR NEW.spot_id IS NOT OLD.spot_id OR NEW.anchor_id IS NOT OLD.anchor_id OR NEW.record_id IS NOT OLD.record_id
  OR NEW.resolver_version IS NOT OLD.resolver_version OR NEW.bound_at IS NOT OLD.bound_at
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: a binding only ends, once, with a reason');
END;

-- A precision upgrade never moves the pin: it is allowed only while the spot is still exactly at the anchor.
CREATE TRIGGER spot_location_anchors_upgrade_same_coordinate
BEFORE UPDATE ON spot_location_anchors
WHEN NEW.end_reason = 'precisionUpgrade'
  AND NOT EXISTS (SELECT 1 FROM spots s JOIN area_location_anchors a ON a.anchor_id = OLD.anchor_id
                  WHERE s.spot_id = OLD.spot_id AND s.latitude = a.latitude AND s.longitude = a.longitude)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: a precision-only upgrade keeps the coordinate; a moved point needs ADR-0009 review');
END;

CREATE TRIGGER spot_location_anchors_relocation_needs_hold
BEFORE UPDATE ON spot_location_anchors
WHEN NEW.end_reason = 'relocationReview'
  AND NOT EXISTS (SELECT 1 FROM review_relocation_holds h WHERE h.spot_id = OLD.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: leaving an anchor for a new point goes through ADR-0009 relocation review');
END;

CREATE TRIGGER spot_location_anchors_no_delete BEFORE DELETE ON spot_location_anchors
BEGIN SELECT RAISE(ABORT, 'spot_location_anchors are never deleted; end the binding with a reason'); END;

-- An anchored spot's pin never moves while the binding is active, not even through a reviewed relocation
-- application: the binding must first end as relocationReview, so an anchor coordinate can never be relabelled.
CREATE TRIGGER spots_anchored_coordinate_fixed
BEFORE UPDATE OF latitude, longitude ON spots
WHEN NOT (NEW.latitude IS OLD.latitude AND NEW.longitude IS OLD.longitude)
  AND EXISTS (SELECT 1 FROM spot_location_anchors WHERE spot_id = OLD.spot_id AND ended_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'spots: an area-anchored spot keeps its anchor coordinate until its binding ends under ADR-0009 review');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target: every bootstrap guard names every table, now including 0030's (test/promotion-empty-target.test.ts).

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
BEGIN SELECT RAISE(ABORT, 'v4 requires a fresh GREEN database'); END;
