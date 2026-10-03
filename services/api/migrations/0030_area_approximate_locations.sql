-- Approximate area locations (ADR-0017). Existence evidence and location precision are separate axes: a smoking place
-- whose existence an approved source states, but whose own point is unknown, may be pinned at a reviewed anchor of the
-- area/host it is inside and published as `verification.locationPrecision = "areaApproximate"`.
--
-- Three append-only tables. Every row is insert-only: no UPDATE, no DELETE, and no INSERT OR REPLACE (each table has a
-- BEFORE INSERT trigger that refuses a row whose key or unique digest already exists, because SQLite's REPLACE deletes
-- the conflicting row without firing DELETE triggers while recursive_triggers is off).
--
--   area_location_anchors    one reviewed anchor, bound to ONE publication (anchor policy v1): the source release
--                            (content digest) and the record within it that states the area's point, with that
--                            record's verbatim values. A release is one immutable publisher file, so "same publication"
--                            is "same release", checked against real rows whenever the release is in this database.
--   spot_location_anchors    which anchor a spot is pinned at, bound to the existence record that named the anchor. The
--                            record's release must be the anchor's release (policy v1: the publication that states the
--                            place is the one that supplies the area point). Written by the resolver in the spot's batch.
--   area_precision_upgrades  the ONLY way a spot leaves areaApproximate (ADR-0017 §6): exact-point evidence (the
--                            observation of a reviewed same-entity record that states the place's own point), the
--                            reviewed identity decision for that record, the target precision and, when the point
--                            moved, the ADR-0009 relocation item and decision. It is the final authority for the spot's
--                            precision and location provenance once present; nothing is inferred from a binding alone.
--
-- area_anchor_relocation_deltas (runtime audit) admits the one ADR-0017 delta into ADR-0009's relocation premise; see below.
--
-- Promotion (v2/v3/v4) carries the three tables for published spots. A bundle carries only the current release, so an
-- anchor's or binding's publication may be a historical release that is not in the bundle: those columns are attested
-- values (release digest, record id and verbatim values), checked against real rows whenever the release exists here
-- and accepted as an attestation only while a promotion bootstrap is open (the same model as
-- promotion_review_match_attestations, migration 0016). They are never presented as the current release.
--
-- Each guard is its own small trigger (D1 expression depth, 0018/0019).

-- F4: the reviewed area-point mapping of a source, per adapter mapping version: WHICH header columns of that source's
-- publications are the area name, the latitude and the longitude. Registered once from the reviewed adapter code
-- (src/pipeline/area-point-mapping.ts) and immutable, so an anchor no longer names its own columns: its point is read
-- through this row, and a caller cannot point at any other numeric cells of the same record (e.g. seats/capacity).
CREATE TABLE area_point_mappings (
  source_id                       TEXT NOT NULL REFERENCES sources (source_id),
  mapping_version                 TEXT NOT NULL CHECK (mapping_version <> ''),
  name_column                     TEXT NOT NULL CHECK (name_column <> ''),
  latitude_column                 TEXT NOT NULL CHECK (latitude_column <> ''),
  longitude_column                TEXT NOT NULL CHECK (longitude_column <> ''),
  policy_version                  TEXT NOT NULL CHECK (policy_version IN ('area-anchor-policy.v1')),
  reviewed_by                     TEXT NOT NULL CHECK (reviewed_by <> ''),
  reviewed_on                     TEXT NOT NULL CHECK (reviewed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  recorded_at                     TEXT NOT NULL,
  PRIMARY KEY (source_id, mapping_version),
  CHECK (name_column <> latitude_column AND name_column <> longitude_column AND latitude_column <> longitude_column)
) WITHOUT ROWID;

CREATE TRIGGER area_point_mappings_no_replace
BEFORE INSERT ON area_point_mappings
WHEN EXISTS (SELECT 1 FROM area_point_mappings WHERE source_id = NEW.source_id AND mapping_version = NEW.mapping_version)
BEGIN
  SELECT RAISE(ABORT, 'area_point_mappings are immutable; a changed mapping needs a new mapping version');
END;

CREATE TRIGGER area_point_mappings_source
BEFORE INSERT ON area_point_mappings
WHEN NOT EXISTS (SELECT 1 FROM sources s WHERE s.source_id = NEW.source_id
  AND s.kind IN ('municipal', 'operator') AND s.publication_status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'area_point_mappings: only an approved official or operator source has a reviewed area-point mapping');
END;

CREATE TRIGGER area_point_mappings_immutable BEFORE UPDATE ON area_point_mappings
BEGIN SELECT RAISE(ABORT, 'area_point_mappings are immutable; a changed mapping needs a new mapping version'); END;
CREATE TRIGGER area_point_mappings_no_delete BEFORE DELETE ON area_point_mappings
BEGIN SELECT RAISE(ABORT, 'area_point_mappings are immutable; a changed mapping needs a new mapping version'); END;

-- F1: evidence storage is append-only at runtime (0001/0008 refuse UPDATE and DELETE), but SQLite's REPLACE deletes the
-- conflicting row without DELETE triggers while recursive_triggers is off. These guards close that path for releases,
-- records and observations, so an observation cited as location evidence can never be rewritten in place (in a sealed
-- promoted database the completion seal, 0016/0018, already refuses every write to them). A record's entity link is
-- fixed once a location authority cites the record.
CREATE TRIGGER source_releases_no_replace
BEFORE INSERT ON source_releases
WHEN NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND EXISTS (SELECT 1 FROM source_releases WHERE release_id = NEW.release_id
  OR (source_id = NEW.source_id AND content_sha256 = NEW.content_sha256 AND observed_on IS NEW.observed_on))
BEGIN
  SELECT RAISE(ABORT, 'source_releases are append-only; INSERT OR REPLACE cannot rewrite a release');
END;

CREATE TRIGGER source_records_no_replace
BEFORE INSERT ON source_records
WHEN NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND EXISTS (SELECT 1 FROM source_records WHERE record_id = NEW.record_id
  OR (release_id = NEW.release_id AND (ordinal = NEW.ordinal OR upstream_row_ref = NEW.upstream_row_ref)))
BEGIN
  SELECT RAISE(ABORT, 'source_records are immutable; INSERT OR REPLACE cannot rewrite a record');
END;

CREATE TRIGGER source_observations_no_replace
BEFORE INSERT ON source_observations
WHEN NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND EXISTS (SELECT 1 FROM source_observations WHERE observation_id = NEW.observation_id
  OR (record_id = NEW.record_id AND mapping_version = NEW.mapping_version))
BEGIN
  SELECT RAISE(ABORT, 'source_observations are immutable; INSERT OR REPLACE cannot rewrite an observation');
END;

CREATE TABLE area_location_anchors (
  anchor_id                       TEXT PRIMARY KEY CHECK (anchor_id GLOB 'aa_[a-z0-9]*' AND length(anchor_id) BETWEEN 4 AND 64),
  area_name                       TEXT NOT NULL CHECK (length(area_name) BETWEEN 1 AND 80),
  area_kind                       TEXT NOT NULL CHECK (area_kind IN ('park', 'station', 'facility', 'airport', 'commercialBuilding', 'other')),
  latitude                        REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude                       REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- What the point is: the publisher's own point for the AREA, never a smoking point.
  origin_kind                     TEXT NOT NULL CHECK (origin_kind IN ('publisherAreaPoint', 'publisherFacilityPoint')),
  origin_source_id                TEXT NOT NULL REFERENCES sources (source_id),
  -- The publication: one release (file) of the origin source, and the record in it that states the area's point.
  origin_release_id               INTEGER NOT NULL,
  origin_release_content_sha256   TEXT NOT NULL CHECK (length(origin_release_content_sha256) = 64 AND origin_release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  origin_record_id                INTEGER NOT NULL,
  origin_record_values_json       TEXT NOT NULL CHECK (json_valid(origin_record_values_json) AND json_type(origin_record_values_json) = 'array'),
  -- The publication's header (B4/F4): with the record's values and the source's reviewed area-point mapping of this
  -- version it determines the point. The database reads the point out of the record through the reviewed columns, so
  -- a typed coordinate, another record's point or other cells of the same record cannot be bound, not even by direct
  -- SQL, and a historical anchor carried by promotion is self-checked the same way.
  origin_header_json              TEXT NOT NULL CHECK (json_valid(origin_header_json) AND json_type(origin_header_json) = 'array'),
  origin_mapping_version          TEXT NOT NULL CHECK (origin_mapping_version <> ''),
  -- Human-readable pointer into that publication (file + row). Not the provenance boundary; also screened below.
  origin_reference                TEXT NOT NULL CHECK (length(origin_reference) BETWEEN 1 AND 500),
  reuse_basis                     TEXT NOT NULL CHECK (reuse_basis IN ('sameReviewedPublication')),
  policy_version                  TEXT NOT NULL CHECK (policy_version IN ('area-anchor-policy.v1')),
  reviewed_by                     TEXT NOT NULL CHECK (reviewed_by <> ''),
  reviewed_on                     TEXT NOT NULL CHECK (reviewed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  evidence_sha256                 TEXT NOT NULL UNIQUE CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  recorded_at                     TEXT NOT NULL,
  CHECK (json_array_length(origin_header_json) = json_array_length(origin_record_values_json)),
  FOREIGN KEY (origin_source_id, origin_mapping_version) REFERENCES area_point_mappings (source_id, mapping_version)
) WITHOUT ROWID;

CREATE TRIGGER area_location_anchors_no_replace
BEFORE INSERT ON area_location_anchors
WHEN EXISTS (SELECT 1 FROM area_location_anchors WHERE anchor_id = NEW.anchor_id OR evidence_sha256 = NEW.evidence_sha256)
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors are immutable; record a new anchor instead');
END;

CREATE TRIGGER area_location_anchors_origin_source
BEFORE INSERT ON area_location_anchors
WHEN NOT EXISTS (SELECT 1 FROM sources s WHERE s.source_id = NEW.origin_source_id
  AND s.kind IN ('municipal', 'operator') AND s.publication_status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: an anchor comes from an approved (rights-reviewed) official or operator source');
END;

-- The publication itself: the cited record is in the cited release of the origin source, with exactly these values.
-- Checked whenever that release exists here; only an open promotion bootstrap may carry a historical release's anchor.
CREATE TRIGGER area_location_anchors_origin_publication
BEFORE INSERT ON area_location_anchors
WHEN (NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) OR EXISTS (SELECT 1 FROM source_releases WHERE release_id = NEW.origin_release_id))
  AND NOT EXISTS (SELECT 1 FROM source_records r JOIN source_releases rel ON rel.release_id = r.release_id
    WHERE r.record_id = NEW.origin_record_id AND r.release_id = NEW.origin_release_id AND rel.source_id = NEW.origin_source_id
      AND rel.content_sha256 = NEW.origin_release_content_sha256 AND r.raw_values_json = NEW.origin_record_values_json
      AND rel.header_json = NEW.origin_header_json)
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: the anchor must cite a record of its own reviewed publication (release digest and values)');
END;

-- B4/F4: the point is exactly what the cited record states in the source's REVIEWED area-point columns (one mapping
-- row per mapping version): the area name verbatim, and the latitude/longitude as plain decimal text equal to the
-- stored numbers, each column present exactly once in the header. Always checked, on import too (the carried header
-- and values are the attested publication; when the release is here they must equal it, above).
CREATE TRIGGER area_location_anchors_origin_point
BEFORE INSERT ON area_location_anchors
WHEN NOT EXISTS (SELECT 1 FROM area_point_mappings m
    WHERE m.source_id = NEW.origin_source_id AND m.mapping_version = NEW.origin_mapping_version
      AND (SELECT count(*) FROM json_each(NEW.origin_header_json) h WHERE h.value IN (m.name_column, m.latitude_column, m.longitude_column)) = 3
      AND json_extract(NEW.origin_record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = m.name_column) || ']') = NEW.area_name
      AND json_extract(NEW.origin_record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = m.latitude_column) || ']') NOT GLOB '*[^0-9.]*'
      AND json_extract(NEW.origin_record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = m.longitude_column) || ']') NOT GLOB '*[^0-9.]*'
      AND CAST(json_extract(NEW.origin_record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = m.latitude_column) || ']') AS REAL) = NEW.latitude
      AND CAST(json_extract(NEW.origin_record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = m.longitude_column) || ']') AS REAL) = NEW.longitude)
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: the publication''s record does not state this area point in the source''s reviewed area-point columns');
END;

-- B4: the reviewed mapping version is the one the release was observed under (runtime; an attestation on import).
CREATE TRIGGER area_location_anchors_origin_mapping
BEFORE INSERT ON area_location_anchors
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND EXISTS (SELECT 1 FROM source_observations o WHERE o.release_id = NEW.origin_release_id)
  AND NOT EXISTS (SELECT 1 FROM source_observations o WHERE o.release_id = NEW.origin_release_id AND o.mapping_version = NEW.origin_mapping_version)
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: the mapping version is not the one this publication is observed under');
END;

-- Defence in depth only; the publication linkage above is the boundary.
CREATE TRIGGER area_location_anchors_forbidden_origin
BEFORE INSERT ON area_location_anchors
WHEN lower(NEW.origin_reference) GLOB '*google*' OR lower(NEW.origin_reference) GLOB '*goo.gl*'
  OR lower(NEW.origin_reference) GLOB '*maps.apple*' OR lower(NEW.origin_reference) GLOB '*openstreetmap*'
  OR lower(NEW.origin_reference) GLOB '*overpass*' OR lower(NEW.origin_reference) GLOB '*nominatim*'
  OR lower(NEW.origin_reference) GLOB '*screenshot*'
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: Google/Apple Maps, OSM and screenshot coordinates are never canonical anchors');
END;

CREATE TRIGGER area_location_anchors_immutable BEFORE UPDATE ON area_location_anchors
BEGIN SELECT RAISE(ABORT, 'area_location_anchors are immutable; record a new anchor instead'); END;
CREATE TRIGGER area_location_anchors_no_delete BEFORE DELETE ON area_location_anchors
BEGIN SELECT RAISE(ABORT, 'area_location_anchors are immutable; record a new anchor instead'); END;

-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE area_precision_upgrades (
  spot_id                         TEXT PRIMARY KEY REFERENCES spots (spot_id),
  anchor_id                       TEXT NOT NULL REFERENCES area_location_anchors (anchor_id),
  upgrade_kind                    TEXT NOT NULL CHECK (upgrade_kind IN ('sameCoordinate', 'relocated')),
  -- v1: only the existence source's own exact point (publisherPoint). A community pin is cross-source evidence with
  -- its own rights gate (#124) and reviewedDerived needs ADR-0011 approval: both have no representation here.
  target_precision                TEXT NOT NULL CHECK (target_precision IN ('publisherPoint')),
  -- v1: the reviewer confirmed the exact point is inside the anchored area. An outside-area point has no
  -- representation: it needs an identity/area review that v1 does not implement, so it fails closed.
  area_premise                    TEXT NOT NULL CHECK (area_premise IN ('insideArea')),
  evidence_source_id              TEXT NOT NULL REFERENCES sources (source_id),
  evidence_release_id             INTEGER NOT NULL,
  evidence_release_content_sha256 TEXT NOT NULL CHECK (length(evidence_release_content_sha256) = 64 AND evidence_release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  evidence_record_id              INTEGER NOT NULL,
  evidence_observation_id         INTEGER NOT NULL,
  evidence_mapping_version        TEXT NOT NULL CHECK (evidence_mapping_version <> ''),
  -- The exact point's own location provenance (rule and columns), which becomes the spot's location provenance.
  evidence_location_rule          TEXT NOT NULL CHECK (evidence_location_rule <> '' AND evidence_location_rule NOT GLOB 'area-anchor.*'),
  evidence_location_columns_json  TEXT NOT NULL CHECK (json_valid(evidence_location_columns_json) AND json_type(evidence_location_columns_json) = 'array'),
  old_latitude                    REAL NOT NULL,
  old_longitude                   REAL NOT NULL,
  new_latitude                    REAL NOT NULL CHECK (new_latitude BETWEEN -90 AND 90),
  new_longitude                   REAL NOT NULL CHECK (new_longitude BETWEEN -180 AND 180),
  -- The reviewed identity: the latest matchedToEntity decision of the ambiguousMatch item of the evidence record.
  identity_review_item_id         INTEGER NOT NULL,
  identity_review_decision_id     INTEGER NOT NULL,
  -- ADR-0009, required exactly when the point moved: the relocationCandidate and its latest relocationConfirmed.
  relocation_review_item_id       INTEGER,
  relocation_review_decision_id   INTEGER,
  reviewed_by                     TEXT NOT NULL CHECK (reviewed_by <> ''),
  policy_version                  TEXT NOT NULL CHECK (policy_version IN ('area-precision-upgrade.v1')),
  executor_version                TEXT NOT NULL CHECK (executor_version IN ('area-precision-upgrade-application.v1')),
  applied_at                      TEXT NOT NULL,
  CHECK ((upgrade_kind = 'sameCoordinate') = (relocation_review_item_id IS NULL)),
  CHECK ((relocation_review_item_id IS NULL) = (relocation_review_decision_id IS NULL)),
  CHECK ((upgrade_kind = 'sameCoordinate') = (old_latitude = new_latitude AND old_longitude = new_longitude))
) WITHOUT ROWID;

CREATE TRIGGER area_precision_upgrades_no_replace
BEFORE INSERT ON area_precision_upgrades
WHEN EXISTS (SELECT 1 FROM area_precision_upgrades WHERE spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades are immutable; a spot leaves areaApproximate once');
END;

-- v1: the exact point comes from the anchor's own source, which is approved and rights-reviewed.
CREATE TRIGGER area_precision_upgrades_evidence_source
BEFORE INSERT ON area_precision_upgrades
WHEN NOT EXISTS (SELECT 1 FROM area_location_anchors a JOIN sources s ON s.source_id = a.origin_source_id
  WHERE a.anchor_id = NEW.anchor_id AND a.origin_source_id = NEW.evidence_source_id AND s.publication_status = 'approved'
    AND a.latitude = NEW.old_latitude AND a.longitude = NEW.old_longitude)
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: exact evidence must come from the anchor''s own approved source, starting at the anchor');
END;

-- Runtime premise 1: the spot is pinned at this anchor right now (bound, not upgraded, still at the anchor point).
CREATE TRIGGER area_precision_upgrades_binding
BEFORE INSERT ON area_precision_upgrades
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM spot_location_anchors b JOIN spots s ON s.spot_id = b.spot_id
    WHERE b.spot_id = NEW.spot_id AND b.anchor_id = NEW.anchor_id
      AND s.latitude = NEW.old_latitude AND s.longitude = NEW.old_longitude
      AND s.lifecycle = 'active' AND s.merged_into IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: the spot is not currently pinned at this anchor');
END;

-- Runtime premise 2: the exact-point evidence is a real observation of a record of the evidence release that states a
-- non-anchor point at exactly the new coordinate, with exactly the recorded location provenance.
CREATE TRIGGER area_precision_upgrades_evidence
BEFORE INSERT ON area_precision_upgrades
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM source_observations o JOIN source_releases rel ON rel.release_id = o.release_id
    WHERE o.observation_id = NEW.evidence_observation_id AND o.record_id = NEW.evidence_record_id
      AND o.release_id = NEW.evidence_release_id AND rel.source_id = NEW.evidence_source_id
      AND rel.content_sha256 = NEW.evidence_release_content_sha256 AND o.mapping_version = NEW.evidence_mapping_version
      AND o.latitude = NEW.new_latitude AND o.longitude = NEW.new_longitude
      AND json_extract(o.claims_json, '$.locationAnchorId') IS NULL
      AND EXISTS (SELECT 1 FROM json_each(o.field_provenance_json) p
        WHERE json_extract(p.value, '$.field') = 'location' AND json_extract(p.value, '$.rule') = NEW.evidence_location_rule
          AND json(json_extract(p.value, '$.columns')) = json(NEW.evidence_location_columns_json)))
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: no exact-point observation states this point (record, release, mapping, coordinate, provenance)');
END;

-- Runtime premise 3: the evidence record is reviewed as this spot's entity, by its item's LATEST decision.
CREATE TRIGGER area_precision_upgrades_identity
BEFORE INSERT ON area_precision_upgrades
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM review_items i JOIN review_decisions d ON d.review_decision_id = NEW.identity_review_decision_id
    WHERE i.review_item_id = NEW.identity_review_item_id AND i.kind = 'ambiguousMatch'
      AND i.record_id = NEW.evidence_record_id AND i.release_id = NEW.evidence_release_id
      AND d.review_item_id = i.review_item_id AND d.decision = 'matchedToEntity'
      AND d.review_decision_id = (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
      AND EXISTS (SELECT 1 FROM spot_source_entities l WHERE l.spot_id = NEW.spot_id AND l.source_entity_id = d.source_entity_id))
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: the exact evidence is not this spot''s reviewed entity (latest matchedToEntity decision)');
END;

-- Runtime premise 4: a moved point is exactly the current, actionable ADR-0009 relocation of this spot (latest
-- relocationConfirmed, this item's own unconsumed hold, no competing hold, current comparison). Same coordinate: the
-- evidence release is still pending and nothing moved.
CREATE TRIGGER area_precision_upgrades_relocation
BEFORE INSERT ON area_precision_upgrades
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) AND NEW.upgrade_kind = 'relocated'
  AND NOT EXISTS (SELECT 1 FROM review_relocation_application_premises v
    WHERE v.review_item_id = NEW.relocation_review_item_id AND v.review_decision_id = NEW.relocation_review_decision_id
      AND v.spot_id = NEW.spot_id AND v.new_observation_id = NEW.evidence_observation_id)
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: not the current ADR-0009 relocation of this spot');
END;

-- Coordinates and record of a moved upgrade are exactly its relocation candidate's (checked in its own program).
CREATE TRIGGER area_precision_upgrades_relocation_comparison
BEFORE INSERT ON area_precision_upgrades
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) AND NEW.upgrade_kind = 'relocated'
  AND NOT EXISTS (SELECT 1 FROM review_items i WHERE i.review_item_id = NEW.relocation_review_item_id
    AND i.record_id = NEW.evidence_record_id AND i.release_id = NEW.evidence_release_id
    AND json_extract(i.details_json, '$.previousCoordinate.latitude') = NEW.old_latitude
    AND json_extract(i.details_json, '$.previousCoordinate.longitude') = NEW.old_longitude
    AND json_extract(i.details_json, '$.newCoordinate.latitude') = NEW.new_latitude
    AND json_extract(i.details_json, '$.newCoordinate.longitude') = NEW.new_longitude)
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: the moved point is not its relocation candidate''s comparison');
END;

-- A point that did not move: the evidence release is still pending.
CREATE TRIGGER area_precision_upgrades_same_coordinate
BEFORE INSERT ON area_precision_upgrades
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) AND NEW.upgrade_kind = 'sameCoordinate'
  AND NOT EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = NEW.evidence_release_id AND r.status = 'ingested')
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: the evidence release is not pending');
END;

-- B3: the upgrade's comparison is current: the identity item compared exactly the evidence release (its fingerprint)
-- with the source's CURRENT applied release, the spot's current location authority is on that current release, and
-- no other non-rejected release of the source is newer than the current one (a competing release makes the review
-- stale). Otherwise not one row is written.
CREATE TRIGGER area_precision_upgrades_comparison_current
BEFORE INSERT ON area_precision_upgrades
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM review_items i JOIN source_releases p ON p.release_id = i.previous_release_id
      JOIN source_releases r ON r.release_id = i.release_id
    WHERE i.review_item_id = NEW.identity_review_item_id AND i.release_id = NEW.evidence_release_id
      AND i.release_content_sha256 = NEW.evidence_release_content_sha256 AND r.content_sha256 = NEW.evidence_release_content_sha256
      AND r.status = 'ingested' AND p.status = 'applied' AND p.is_current = 1 AND p.source_id = NEW.evidence_source_id
      AND (SELECT a.evidence_release_id FROM spot_location_authorities a WHERE a.spot_id = NEW.spot_id
           ORDER BY a.seq DESC LIMIT 1) = p.release_id
      AND NOT EXISTS (SELECT 1 FROM source_releases o WHERE o.source_id = p.source_id
        AND o.release_id NOT IN (i.release_id, i.previous_release_id) AND o.status <> 'rejected'
        AND (o.observed_on IS NULL OR p.observed_on IS NULL OR o.observed_on > p.observed_on)))
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: the review compared another or no longer current pair of releases (stale or competing)');
END;

-- Import (open bootstrap): the carried state is the attestation. A carried upgrade is history — the spot may since have
-- moved through later reviewed relocations — so the carried spot's coordinate is checked against its LATEST carried
-- location authority when the bootstrap is sealed (spot_location_authorities_sealed_*), not against the upgrade.

CREATE TRIGGER area_precision_upgrades_immutable BEFORE UPDATE ON area_precision_upgrades
BEGIN SELECT RAISE(ABORT, 'area_precision_upgrades are immutable'); END;
CREATE TRIGGER area_precision_upgrades_no_delete BEFORE DELETE ON area_precision_upgrades
BEGIN SELECT RAISE(ABORT, 'area_precision_upgrades are immutable'); END;

-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE spot_location_anchors (
  spot_id                         TEXT PRIMARY KEY REFERENCES spots (spot_id),
  anchor_id                       TEXT NOT NULL REFERENCES area_location_anchors (anchor_id),
  -- The existence record whose observation named the anchor, and its release digest (an attestation once that release
  -- is historical). Policy v1: the same release as the anchor's.
  record_id                       INTEGER NOT NULL,
  record_release_content_sha256   TEXT NOT NULL CHECK (length(record_release_content_sha256) = 64 AND record_release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  resolver_version                TEXT NOT NULL,
  bound_at                        TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX spot_location_anchors_anchor ON spot_location_anchors (anchor_id);

CREATE TRIGGER spot_location_anchors_no_replace
BEFORE INSERT ON spot_location_anchors
WHEN EXISTS (SELECT 1 FROM spot_location_anchors WHERE spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors are immutable; a spot is bound to an anchor once');
END;

-- Policy v1, always: the binding's publication is the anchor's publication.
CREATE TRIGGER spot_location_anchors_same_publication
BEFORE INSERT ON spot_location_anchors
WHEN NEW.record_release_content_sha256 IS NOT (SELECT origin_release_content_sha256 FROM area_location_anchors WHERE anchor_id = NEW.anchor_id)
  OR ((NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) OR EXISTS (SELECT 1 FROM source_records WHERE record_id = NEW.record_id))
    AND NOT EXISTS (SELECT 1 FROM source_records r JOIN area_location_anchors a ON a.anchor_id = NEW.anchor_id
      WHERE r.record_id = NEW.record_id AND r.release_id = a.origin_release_id))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: anchor policy v1 binds only within the anchor''s own publication (same release)');
END;

-- The pin is exactly the anchor's point. Only a carried, already-upgraded spot (open bootstrap) sits elsewhere: at its
-- latest carried location authority, which the bootstrap seal checks (spot_location_authorities_sealed_*).
CREATE TRIGGER spot_location_anchors_coordinate
BEFORE INSERT ON spot_location_anchors
WHEN NOT EXISTS (SELECT 1 FROM spots s JOIN area_location_anchors a ON a.anchor_id = NEW.anchor_id
    WHERE s.spot_id = NEW.spot_id AND s.latitude = a.latitude AND s.longitude = a.longitude
      AND NOT EXISTS (SELECT 1 FROM area_precision_upgrades u WHERE u.spot_id = NEW.spot_id AND u.upgrade_kind = 'relocated'))
  AND NOT (((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) AND EXISTS (SELECT 1 FROM area_precision_upgrades u
    WHERE u.spot_id = NEW.spot_id AND u.anchor_id = NEW.anchor_id))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: a spot is bound at exactly its anchor coordinate');
END;

CREATE TRIGGER spot_location_anchors_immutable BEFORE UPDATE ON spot_location_anchors
BEGIN SELECT RAISE(ABORT, 'spot_location_anchors are immutable'); END;
CREATE TRIGGER spot_location_anchors_no_delete BEFORE DELETE ON spot_location_anchors
BEGIN SELECT RAISE(ABORT, 'spot_location_anchors are immutable'); END;

-- ---------------------------------------------------------------------------------------------------------
-- F2: the location evidence a promotion bundle carries for the authority chain. A bundle carries no observations
-- (0016/0018), so each authority-cited observation travels as one attestation row, and the trust boundary is explicit:
--   current     the evidence release IS in the bundle: the row must equal that release (source, digest, header) and
--               record (raw values), its mapping must be the source's reviewed mapping, and its coordinate must be what
--               the record states in the cited columns (an exact point) or the cited anchor's point (an anchor rule);
--   historical  the evidence release is NOT in the bundle (an earlier release of the chain): an attestation of the
--               publication (digest, header, raw values, observation and mapping identity), self-checked the same way.
-- Rows exist only while a bootstrap is open; at runtime nothing writes here, and an authority always cites a real
-- observation instead. A historical row can never stand for a release the bundle carries.
CREATE TABLE promotion_location_evidence_attestations (
  observation_id                  INTEGER PRIMARY KEY,
  scope                           TEXT NOT NULL CHECK (scope IN ('current', 'historical')),
  source_id                       TEXT NOT NULL REFERENCES sources (source_id),
  release_id                      INTEGER NOT NULL,
  release_content_sha256          TEXT NOT NULL CHECK (length(release_content_sha256) = 64 AND release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  record_id                       INTEGER NOT NULL,
  header_json                     TEXT NOT NULL CHECK (json_valid(header_json) AND json_type(header_json) = 'array'),
  record_values_json              TEXT NOT NULL CHECK (json_valid(record_values_json) AND json_type(record_values_json) = 'array'),
  mapping_version                 TEXT NOT NULL CHECK (mapping_version <> ''),
  location_rule                   TEXT NOT NULL CHECK (location_rule <> ''),
  location_columns_json           TEXT NOT NULL CHECK (json_valid(location_columns_json) AND json_type(location_columns_json) = 'array'),
  latitude                        REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude                       REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- The observation's anchor claim (claims_json.locationAnchorId), NULL for an exact point.
  anchor_id                       TEXT,
  UNIQUE (record_id, mapping_version),
  CHECK (json_array_length(header_json) = json_array_length(record_values_json)),
  CHECK ((anchor_id IS NOT NULL) = (location_rule GLOB 'area-anchor.*'))
);

CREATE TRIGGER promotion_location_evidence_attestations_no_replace
BEFORE INSERT ON promotion_location_evidence_attestations
WHEN EXISTS (SELECT 1 FROM promotion_location_evidence_attestations WHERE observation_id = NEW.observation_id
  OR (record_id = NEW.record_id AND mapping_version = NEW.mapping_version))
BEGIN
  SELECT RAISE(ABORT, 'promotion_location_evidence_attestations are immutable');
END;

CREATE TRIGGER promotion_location_evidence_attestations_bootstrap_only
BEFORE INSERT ON promotion_location_evidence_attestations
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
BEGIN
  SELECT RAISE(ABORT, 'promotion_location_evidence_attestations: only an open promotion bootstrap carries location evidence attestations');
END;

-- Current iff the release is in this database: a historical attestation never stands for a carried release.
CREATE TRIGGER promotion_location_evidence_attestations_scope
BEFORE INSERT ON promotion_location_evidence_attestations
WHEN (NEW.scope = 'current') <> EXISTS (SELECT 1 FROM source_releases WHERE release_id = NEW.release_id)
BEGIN
  SELECT RAISE(ABORT, 'promotion_location_evidence_attestations: scope is current exactly when the bundle carries the release');
END;

CREATE TRIGGER promotion_location_evidence_attestations_current
BEFORE INSERT ON promotion_location_evidence_attestations
WHEN NEW.scope = 'current' AND NOT EXISTS (SELECT 1 FROM source_records r JOIN source_releases rel ON rel.release_id = r.release_id
  WHERE r.record_id = NEW.record_id AND r.release_id = NEW.release_id AND rel.source_id = NEW.source_id
    AND rel.content_sha256 = NEW.release_content_sha256 AND rel.header_json = NEW.header_json AND r.raw_values_json = NEW.record_values_json)
BEGIN
  SELECT RAISE(ABORT, 'promotion_location_evidence_attestations: current evidence is not exactly the carried release and record');
END;

CREATE TRIGGER promotion_location_evidence_attestations_mapping
BEFORE INSERT ON promotion_location_evidence_attestations
WHEN NOT EXISTS (SELECT 1 FROM area_point_mappings m WHERE m.source_id = NEW.source_id AND m.mapping_version = NEW.mapping_version)
BEGIN
  SELECT RAISE(ABORT, 'promotion_location_evidence_attestations: the mapping is not a reviewed mapping of the source');
END;

-- An anchor rule: exactly the cited anchor's point, an anchor of this source (anchors travel first).
CREATE TRIGGER promotion_location_evidence_attestations_anchor_point
BEFORE INSERT ON promotion_location_evidence_attestations
WHEN NEW.anchor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM area_location_anchors a
  WHERE a.anchor_id = NEW.anchor_id AND NEW.location_rule = 'area-anchor.v1:' || a.anchor_id AND a.origin_source_id = NEW.source_id
    AND a.latitude = NEW.latitude AND a.longitude = NEW.longitude)
BEGIN
  SELECT RAISE(ABORT, 'promotion_location_evidence_attestations: an anchored observation is exactly its anchor''s point');
END;

-- An exact point: the record states exactly this coordinate in the two cited columns (latitude, longitude).
CREATE TRIGGER promotion_location_evidence_attestations_exact_point
BEFORE INSERT ON promotion_location_evidence_attestations
WHEN NEW.anchor_id IS NULL AND NOT (json_array_length(NEW.location_columns_json) = 2
  AND (SELECT count(*) FROM json_each(NEW.header_json) h WHERE h.value IN (json_extract(NEW.location_columns_json, '$[0]'), json_extract(NEW.location_columns_json, '$[1]'))) = 2
  AND json_extract(NEW.record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.header_json) h WHERE h.value = json_extract(NEW.location_columns_json, '$[0]')) || ']') NOT GLOB '*[^0-9.]*'
  AND json_extract(NEW.record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.header_json) h WHERE h.value = json_extract(NEW.location_columns_json, '$[1]')) || ']') NOT GLOB '*[^0-9.]*'
  AND CAST(json_extract(NEW.record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.header_json) h WHERE h.value = json_extract(NEW.location_columns_json, '$[0]')) || ']') AS REAL) = NEW.latitude
  AND CAST(json_extract(NEW.record_values_json, '$[' || (SELECT h.key FROM json_each(NEW.header_json) h WHERE h.value = json_extract(NEW.location_columns_json, '$[1]')) || ']') AS REAL) = NEW.longitude)
BEGIN
  SELECT RAISE(ABORT, 'promotion_location_evidence_attestations: the record does not state this exact point in the cited columns');
END;

CREATE TRIGGER promotion_location_evidence_attestations_immutable BEFORE UPDATE ON promotion_location_evidence_attestations
BEGIN SELECT RAISE(ABORT, 'promotion_location_evidence_attestations are immutable'); END;
CREATE TRIGGER promotion_location_evidence_attestations_no_delete BEFORE DELETE ON promotion_location_evidence_attestations
BEGIN SELECT RAISE(ABORT, 'promotion_location_evidence_attestations are immutable'); END;

-- ---------------------------------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------------------
-- B1/B2: the CURRENT location authority of every spot that was ever area-anchored, as an append-only chain. Seq 1 is
-- the anchor (areaApproximate); an exactUpgrade row is the first exact authority (its area_precision_upgrades row stays
-- as history); a relocation row is a later reviewed ADR-0009 move of the exact point; a continuation row is the same
-- location evidence carried to a newer record of the spot's entity (raw-identical or reviewed match, unchanged rule,
-- columns and coordinate). The spot's coordinate and location provenance always equal the LATEST row exactly
-- (triggers below); the shared public decision (src/tiles/location-state.ts) re-checks the same equality, so a
-- tampered record, observation, release, rule or columns is refused or never published.
CREATE TABLE spot_location_authorities (
  spot_id                         TEXT NOT NULL REFERENCES spots (spot_id),
  seq                             INTEGER NOT NULL CHECK (seq >= 1),
  kind                            TEXT NOT NULL CHECK (kind IN ('areaAnchor', 'exactUpgrade', 'relocation', 'continuation')),
  precision                       TEXT NOT NULL CHECK (precision IN ('areaApproximate', 'publisherPoint')),
  anchor_id                       TEXT NOT NULL REFERENCES area_location_anchors (anchor_id),
  evidence_source_id              TEXT NOT NULL REFERENCES sources (source_id),
  evidence_release_id             INTEGER NOT NULL,
  evidence_release_content_sha256 TEXT NOT NULL CHECK (length(evidence_release_content_sha256) = 64 AND evidence_release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  evidence_record_id              INTEGER NOT NULL,
  evidence_observation_id         INTEGER NOT NULL,
  mapping_version                 TEXT NOT NULL CHECK (mapping_version <> ''),
  location_rule                   TEXT NOT NULL CHECK (location_rule <> ''),
  location_columns_json           TEXT NOT NULL CHECK (json_valid(location_columns_json) AND json_type(location_columns_json) = 'array'),
  latitude                        REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude                       REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- relocation rows: the ADR-0009 relocationCandidate whose application moves the spot.
  relocation_review_item_id       INTEGER,
  recorded_at                     TEXT NOT NULL,
  PRIMARY KEY (spot_id, seq),
  CHECK ((kind = 'areaAnchor') = (seq = 1)),
  CHECK ((kind = 'relocation') = (relocation_review_item_id IS NOT NULL)),
  CHECK (kind NOT IN ('areaAnchor') OR precision = 'areaApproximate'),
  CHECK (kind NOT IN ('exactUpgrade', 'relocation') OR precision = 'publisherPoint'),
  CHECK ((precision = 'areaApproximate') = (location_rule GLOB 'area-anchor.*'))
) WITHOUT ROWID;

CREATE TRIGGER spot_location_authorities_no_replace
BEFORE INSERT ON spot_location_authorities
WHEN EXISTS (SELECT 1 FROM spot_location_authorities WHERE spot_id = NEW.spot_id AND seq = NEW.seq)
  OR NEW.seq <> 1 + coalesce((SELECT max(seq) FROM spot_location_authorities WHERE spot_id = NEW.spot_id), 0)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities are append-only, in sequence');
END;

-- Every row belongs to the spot's binding and its anchor's source (policy v1: one source per chain).
CREATE TRIGGER spot_location_authorities_binding
BEFORE INSERT ON spot_location_authorities
WHEN NOT EXISTS (SELECT 1 FROM spot_location_anchors b JOIN area_location_anchors a ON a.anchor_id = b.anchor_id
  WHERE b.spot_id = NEW.spot_id AND b.anchor_id = NEW.anchor_id AND a.origin_source_id = NEW.evidence_source_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: not the spot''s anchor binding');
END;

-- Seq 1: the anchor itself, from the binding's existence record, at the anchor's point with its anchor rule.
CREATE TRIGGER spot_location_authorities_area_anchor
BEFORE INSERT ON spot_location_authorities
WHEN NEW.kind = 'areaAnchor' AND NOT EXISTS (SELECT 1 FROM spot_location_anchors b JOIN area_location_anchors a ON a.anchor_id = b.anchor_id
  WHERE b.spot_id = NEW.spot_id AND b.record_id = NEW.evidence_record_id
    AND b.record_release_content_sha256 = NEW.evidence_release_content_sha256
    AND a.latitude = NEW.latitude AND a.longitude = NEW.longitude AND NEW.location_rule = 'area-anchor.v1:' || a.anchor_id
    AND a.origin_mapping_version = NEW.mapping_version)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: the anchor authority is not the spot''s binding');
END;

-- exactUpgrade: exactly the reviewed upgrade's evidence (always: upgrades travel before authorities on import).
CREATE TRIGGER spot_location_authorities_exact_upgrade
BEFORE INSERT ON spot_location_authorities
WHEN NEW.kind = 'exactUpgrade' AND NOT EXISTS (SELECT 1 FROM area_precision_upgrades u
  WHERE u.spot_id = NEW.spot_id AND u.anchor_id = NEW.anchor_id AND u.target_precision = NEW.precision
    AND u.evidence_source_id = NEW.evidence_source_id AND u.evidence_release_id = NEW.evidence_release_id
    AND u.evidence_release_content_sha256 = NEW.evidence_release_content_sha256 AND u.evidence_record_id = NEW.evidence_record_id
    AND u.evidence_observation_id = NEW.evidence_observation_id AND u.evidence_mapping_version = NEW.mapping_version
    AND u.evidence_location_rule = NEW.location_rule AND u.evidence_location_columns_json = NEW.location_columns_json
    AND u.new_latitude = NEW.latitude AND u.new_longitude = NEW.longitude)
  OR (NEW.kind = 'exactUpgrade' AND (SELECT precision FROM spot_location_authorities WHERE spot_id = NEW.spot_id
    ORDER BY seq DESC LIMIT 1) IS NOT 'areaApproximate')
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: not exactly the spot''s reviewed area precision upgrade');
END;

-- Runtime: a row other than the anchor cites a real observation of the cited record, release and mapping, stating
-- exactly this rule, columns and coordinate (and the anchor claim exactly when approximate).
CREATE TRIGGER spot_location_authorities_observation
BEFORE INSERT ON spot_location_authorities
WHEN NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM source_observations o JOIN source_releases rel ON rel.release_id = o.release_id
    WHERE o.observation_id = NEW.evidence_observation_id AND o.record_id = NEW.evidence_record_id
      AND o.release_id = NEW.evidence_release_id AND rel.source_id = NEW.evidence_source_id
      AND rel.content_sha256 = NEW.evidence_release_content_sha256 AND o.mapping_version = NEW.mapping_version
      AND o.latitude = NEW.latitude AND o.longitude = NEW.longitude
      AND json_extract(o.claims_json, '$.locationAnchorId') IS (CASE WHEN NEW.precision = 'areaApproximate' THEN NEW.anchor_id END)
      AND EXISTS (SELECT 1 FROM json_each(o.field_provenance_json) p
        WHERE json_extract(p.value, '$.field') = 'location' AND json_extract(p.value, '$.rule') = NEW.location_rule
          AND json(json_extract(p.value, '$.columns')) = json(NEW.location_columns_json)))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: no observation states exactly this location evidence');
END;

-- Every authority's mapping is a reviewed mapping of its source (F2/F4).
CREATE TRIGGER spot_location_authorities_mapping
BEFORE INSERT ON spot_location_authorities
WHEN NOT EXISTS (SELECT 1 FROM area_point_mappings m WHERE m.source_id = NEW.evidence_source_id AND m.mapping_version = NEW.mapping_version)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: the mapping is not a reviewed mapping of the evidence source');
END;

-- Import (F2): no "bootstrap, so skip": a carried authority is exactly its carried evidence attestation (current when
-- the bundle carries the release — then checked against it — historical otherwise).
CREATE TRIGGER spot_location_authorities_import_evidence
BEFORE INSERT ON spot_location_authorities
WHEN ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM promotion_location_evidence_attestations e
    WHERE e.observation_id = NEW.evidence_observation_id AND e.source_id = NEW.evidence_source_id
      AND e.release_id = NEW.evidence_release_id AND e.release_content_sha256 = NEW.evidence_release_content_sha256
      AND e.record_id = NEW.evidence_record_id AND e.mapping_version = NEW.mapping_version
      AND e.location_rule = NEW.location_rule AND e.location_columns_json = NEW.location_columns_json
      AND e.latitude = NEW.latitude AND e.longitude = NEW.longitude
      AND e.anchor_id IS (CASE WHEN NEW.precision = 'areaApproximate' THEN NEW.anchor_id END))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: a carried authority is not exactly its carried evidence attestation');
END;

-- continuation: the same location evidence (precision, rule, columns, coordinate) carried to a record of ANOTHER release
-- of the spot's own entity.
CREATE TRIGGER spot_location_authorities_continuation
BEFORE INSERT ON spot_location_authorities
WHEN NEW.kind = 'continuation' AND NOT EXISTS (SELECT 1 FROM spot_location_authorities a WHERE a.spot_id = NEW.spot_id
    AND a.seq = NEW.seq - 1 AND a.precision = NEW.precision AND a.anchor_id = NEW.anchor_id AND a.location_rule = NEW.location_rule
    AND a.location_columns_json = NEW.location_columns_json AND a.latitude = NEW.latitude AND a.longitude = NEW.longitude
    AND a.evidence_record_id <> NEW.evidence_record_id AND a.evidence_release_id <> NEW.evidence_release_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: a continuation carries unchanged evidence to a record of another release');
END;

-- F3, runtime: a continuation only moves FORWARD, inside the comparison being applied right now. The previous authority's
-- release is the source's applied current release; the continuation's release is the pending (ingested) release being
-- resolved against it, observed strictly later; and no other unrejected release of the source competes (the same
-- comparison semantics as the resolver and review_match_applications). An older, duplicate-current, rejected or
-- competing release can never become the current authority, so the chain cannot roll back.
CREATE TRIGGER spot_location_authorities_continuation_forward
BEFORE INSERT ON spot_location_authorities
WHEN NEW.kind = 'continuation' AND NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM source_releases rn JOIN source_releases rp
      ON rp.release_id = (SELECT evidence_release_id FROM spot_location_authorities WHERE spot_id = NEW.spot_id AND seq = NEW.seq - 1)
    WHERE rn.release_id = NEW.evidence_release_id AND rn.source_id = NEW.evidence_source_id AND rn.status = 'ingested'
      AND rp.source_id = rn.source_id AND rp.status = 'applied' AND rp.is_current = 1
      AND rn.observed_on IS NOT NULL AND rp.observed_on IS NOT NULL AND rn.observed_on > rp.observed_on
      AND NOT EXISTS (SELECT 1 FROM source_releases o WHERE o.source_id = rn.source_id
        AND o.release_id NOT IN (rn.release_id, rp.release_id) AND o.status <> 'rejected'
        AND (o.observed_on IS NULL OR o.observed_on > rp.observed_on)))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: a continuation moves only forward, to the pending release compared against the current one (no older, current-duplicate or competing release)');
END;

-- F3, runtime: identity continuity on the latest premise. The new record is linked (in this batch) to the same entity as
-- the previous authority's record, and that entity is the spot's. Same source alone is not continuity.
CREATE TRIGGER spot_location_authorities_continuation_identity
BEFORE INSERT ON spot_location_authorities
WHEN NEW.kind = 'continuation' AND NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM source_record_entities e
    JOIN source_record_entities ep ON ep.source_entity_id = e.source_entity_id
    JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id
    WHERE e.record_id = NEW.evidence_record_id AND e.release_id = NEW.evidence_release_id AND l.spot_id = NEW.spot_id
      AND ep.record_id = (SELECT evidence_record_id FROM spot_location_authorities WHERE spot_id = NEW.spot_id AND seq = NEW.seq - 1))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: a continuation continues the previous authority''s entity, which is the spot''s');
END;

-- relocation: a later reviewed ADR-0009 move of an EXACT spot, from its current authority's point (runtime: exactly the
-- current, actionable relocation of this spot; import: the carried attestation of one).
CREATE TRIGGER spot_location_authorities_relocation
BEFORE INSERT ON spot_location_authorities
WHEN NEW.kind = 'relocation' AND (
  (SELECT precision FROM spot_location_authorities WHERE spot_id = NEW.spot_id ORDER BY seq DESC LIMIT 1) IS NOT 'publisherPoint'
  OR (NOT ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) AND NOT EXISTS (SELECT 1 FROM review_relocation_application_premises v
    WHERE v.review_item_id = NEW.relocation_review_item_id AND v.spot_id = NEW.spot_id
      AND v.new_observation_id = NEW.evidence_observation_id AND v.record_id = NEW.evidence_record_id
      AND v.new_latitude = NEW.latitude AND v.new_longitude = NEW.longitude
      AND v.old_latitude = (SELECT latitude FROM spot_location_authorities WHERE spot_id = NEW.spot_id ORDER BY seq DESC LIMIT 1)
      AND v.old_longitude = (SELECT longitude FROM spot_location_authorities WHERE spot_id = NEW.spot_id ORDER BY seq DESC LIMIT 1))))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: not the current ADR-0009 relocation of this exact spot');
END;

-- Sealing a bootstrap (v2: promotion_bootstrap_completions; v3/v4: promotion_multi_bootstrap_completions): every carried
-- chain explains its spot. The coordinate and the location provenance are exactly the latest authority; every binding
-- has its anchor authority and every upgrade its exactUpgrade authority; and the latest authority is CURRENT evidence
-- (its release is in the bundle and was checked against it): a historical attestation never ends a chain.
CREATE TRIGGER spot_location_authorities_sealed_v2
BEFORE INSERT ON promotion_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM spot_location_authorities a JOIN spots s ON s.spot_id = a.spot_id
    LEFT JOIN spot_field_provenance p ON p.spot_id = a.spot_id AND p.field = 'location'
    WHERE a.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = a.spot_id)
      AND (s.latitude <> a.latitude OR s.longitude <> a.longitude OR p.record_id IS NOT a.evidence_record_id
        OR p.rule IS NOT a.location_rule OR p.source_columns_json IS NOT a.location_columns_json))
  OR EXISTS (SELECT 1 FROM spot_location_anchors b WHERE NOT EXISTS (SELECT 1 FROM spot_location_authorities a
    WHERE a.spot_id = b.spot_id AND a.seq = 1 AND a.anchor_id = b.anchor_id))
  OR EXISTS (SELECT 1 FROM area_precision_upgrades u WHERE NOT EXISTS (SELECT 1 FROM spot_location_authorities a
    WHERE a.spot_id = u.spot_id AND a.kind = 'exactUpgrade'))
  OR EXISTS (SELECT 1 FROM spot_location_authorities a WHERE a.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = a.spot_id)
    AND NOT EXISTS (SELECT 1 FROM promotion_location_evidence_attestations e WHERE e.observation_id = a.evidence_observation_id AND e.scope = 'current'))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: a carried spot is not exactly its latest location authority');
END;

CREATE TRIGGER spot_location_authorities_sealed_multi
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM spot_location_authorities a JOIN spots s ON s.spot_id = a.spot_id
    LEFT JOIN spot_field_provenance p ON p.spot_id = a.spot_id AND p.field = 'location'
    WHERE a.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = a.spot_id)
      AND (s.latitude <> a.latitude OR s.longitude <> a.longitude OR p.record_id IS NOT a.evidence_record_id
        OR p.rule IS NOT a.location_rule OR p.source_columns_json IS NOT a.location_columns_json))
  OR EXISTS (SELECT 1 FROM spot_location_anchors b WHERE NOT EXISTS (SELECT 1 FROM spot_location_authorities a
    WHERE a.spot_id = b.spot_id AND a.seq = 1 AND a.anchor_id = b.anchor_id))
  OR EXISTS (SELECT 1 FROM area_precision_upgrades u WHERE NOT EXISTS (SELECT 1 FROM spot_location_authorities a
    WHERE a.spot_id = u.spot_id AND a.kind = 'exactUpgrade'))
  OR EXISTS (SELECT 1 FROM spot_location_authorities a WHERE a.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = a.spot_id)
    AND NOT EXISTS (SELECT 1 FROM promotion_location_evidence_attestations e WHERE e.observation_id = a.evidence_observation_id AND e.scope = 'current'))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_authorities: a carried spot is not exactly its latest location authority');
END;

-- F1: the entity link of a record cited as location evidence is fixed (REPLACE and UPDATE alike).
CREATE TRIGGER source_record_entities_location_evidence_replace
BEFORE INSERT ON source_record_entities
WHEN EXISTS (SELECT 1 FROM source_record_entities WHERE record_id = NEW.record_id)
  AND EXISTS (SELECT 1 FROM spot_location_authorities WHERE evidence_record_id = NEW.record_id)
BEGIN
  SELECT RAISE(ABORT, 'source_record_entities: the entity link of a record cited as location evidence is fixed');
END;

CREATE TRIGGER source_record_entities_location_evidence_update
BEFORE UPDATE ON source_record_entities
WHEN EXISTS (SELECT 1 FROM spot_location_authorities WHERE evidence_record_id IN (OLD.record_id, NEW.record_id))
BEGIN
  SELECT RAISE(ABORT, 'source_record_entities: the entity link of a record cited as location evidence is fixed');
END;

CREATE TRIGGER spot_location_authorities_immutable BEFORE UPDATE ON spot_location_authorities
BEGIN SELECT RAISE(ABORT, 'spot_location_authorities are append-only'); END;
CREATE TRIGGER spot_location_authorities_no_delete BEFORE DELETE ON spot_location_authorities
BEGIN SELECT RAISE(ABORT, 'spot_location_authorities are append-only'); END;

-- The coordinate of a spot with an authority chain is always its latest authority's: it moves only after a reviewed
-- exactUpgrade or relocation row naming exactly that move was appended (ADR-0009 still performs the move itself).
CREATE TRIGGER spots_location_authority_coordinate
BEFORE UPDATE OF latitude, longitude ON spots
WHEN NOT (NEW.latitude IS OLD.latitude AND NEW.longitude IS OLD.longitude)
  AND EXISTS (SELECT 1 FROM spot_location_authorities WHERE spot_id = OLD.spot_id)
  AND NOT EXISTS (SELECT 1 FROM spot_location_authorities a WHERE a.spot_id = OLD.spot_id
    AND a.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = OLD.spot_id)
    AND a.kind IN ('exactUpgrade', 'relocation') AND a.latitude = NEW.latitude AND a.longitude = NEW.longitude
    AND EXISTS (SELECT 1 FROM spot_location_authorities b WHERE b.spot_id = a.spot_id AND b.seq = a.seq - 1
      AND b.latitude = OLD.latitude AND b.longitude = OLD.longitude))
BEGIN
  SELECT RAISE(ABORT, 'spots: a spot with a location authority moves only to a newly appended reviewed authority''s point');
END;

-- Location provenance of a spot with an authority chain (and any area-anchor provenance) is exactly its latest
-- authority's record, rule and columns: INSERT, UPDATE and DELETE alike (REPLACE is an INSERT here). Nothing is
-- exempt after an upgrade.
CREATE TRIGGER spot_field_provenance_location_authority_insert
BEFORE INSERT ON spot_field_provenance
WHEN NEW.field = 'location' AND (NEW.rule GLOB 'area-anchor.*' OR EXISTS (SELECT 1 FROM spot_location_authorities WHERE spot_id = NEW.spot_id))
  AND NOT EXISTS (SELECT 1 FROM spot_location_authorities a WHERE a.spot_id = NEW.spot_id
    AND a.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = NEW.spot_id)
    AND a.evidence_record_id = NEW.record_id AND a.location_rule = NEW.rule AND a.location_columns_json = NEW.source_columns_json)
BEGIN
  SELECT RAISE(ABORT, 'spot_field_provenance: an anchored spot''s location is exactly its current location authority');
END;

CREATE TRIGGER spot_field_provenance_location_authority_update
BEFORE UPDATE ON spot_field_provenance
WHEN (OLD.field = 'location' OR NEW.field = 'location')
  AND (EXISTS (SELECT 1 FROM spot_location_authorities WHERE spot_id IN (OLD.spot_id, NEW.spot_id)) OR NEW.rule GLOB 'area-anchor.*' OR OLD.rule GLOB 'area-anchor.*')
  AND NOT (NEW.field = 'location' AND OLD.field = 'location' AND NEW.spot_id = OLD.spot_id
    AND EXISTS (SELECT 1 FROM spot_location_authorities a WHERE a.spot_id = NEW.spot_id
      AND a.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = NEW.spot_id)
      AND a.evidence_record_id = NEW.record_id AND a.location_rule = NEW.rule AND a.location_columns_json = NEW.source_columns_json))
BEGIN
  SELECT RAISE(ABORT, 'spot_field_provenance: an anchored spot''s location changes only to its newly appended location authority');
END;

CREATE TRIGGER spot_field_provenance_location_authority_delete
BEFORE DELETE ON spot_field_provenance
WHEN OLD.field = 'location' AND EXISTS (SELECT 1 FROM spot_location_authorities WHERE spot_id = OLD.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_field_provenance: an anchored spot''s location evidence is never deleted');
END;

-- ---------------------------------------------------------------------------------------------------------
-- ADR-0009 premise, extended by exactly one versioned delta (ADR-0017). An area-anchored, not yet upgraded spot whose
-- next record states its own exact point differs from its previous observation in more than the coordinate: the
-- anchor claim disappears and the location provenance entry changes from this spot's own anchor rule to a non-anchor
-- rule. That delta is admitted for one relocationCandidate only after it is recorded here, in the upgrade's own batch,
-- by a trigger that re-checks it against the cited observations. Keeping the check in its own trigger program keeps
-- the premise view within D1's expression depth limit. Runtime audit only: promotion does not carry it (like every
-- relocation audit, it stays in the origin database).
CREATE TABLE area_anchor_relocation_deltas (
  review_item_id          INTEGER PRIMARY KEY,
  spot_id                 TEXT NOT NULL REFERENCES spots (spot_id),
  anchor_id               TEXT NOT NULL REFERENCES area_location_anchors (anchor_id),
  previous_observation_id INTEGER NOT NULL,
  new_observation_id      INTEGER NOT NULL,
  recorded_at             TEXT NOT NULL
);

CREATE TRIGGER area_anchor_relocation_deltas_no_replace
BEFORE INSERT ON area_anchor_relocation_deltas
WHEN EXISTS (SELECT 1 FROM area_anchor_relocation_deltas WHERE review_item_id = NEW.review_item_id)
BEGIN
  SELECT RAISE(ABORT, 'area_anchor_relocation_deltas are immutable');
END;

-- The item is this spot's relocationCandidate comparing exactly these observations, and the spot is pinned at this
-- anchor and not yet upgraded.
CREATE TRIGGER area_anchor_relocation_deltas_item
BEFORE INSERT ON area_anchor_relocation_deltas
WHEN NOT EXISTS (SELECT 1 FROM review_items i JOIN spot_location_anchors b ON b.spot_id = i.spot_id
    WHERE i.review_item_id = NEW.review_item_id AND i.kind = 'relocationCandidate' AND i.spot_id = NEW.spot_id
      AND b.anchor_id = NEW.anchor_id
      AND json_extract(i.details_json, '$.previousObservationId') = NEW.previous_observation_id
      AND json_extract(i.details_json, '$.newObservationId') = NEW.new_observation_id
      AND json_array_length(i.details_json, '$.otherChangedFields') = 2
      AND EXISTS (SELECT 1 FROM json_each(i.details_json, '$.otherChangedFields') f WHERE f.value = 'provenance')
      AND EXISTS (SELECT 1 FROM json_each(i.details_json, '$.otherChangedFields') f WHERE f.value = 'locationAnchorId'))
  OR EXISTS (SELECT 1 FROM area_precision_upgrades u WHERE u.spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'area_anchor_relocation_deltas: not a relocationCandidate of this anchored, not yet upgraded spot');
END;

-- The observations: previous states this anchor with its anchor rule; next states no anchor and a non-anchor rule.
CREATE TRIGGER area_anchor_relocation_deltas_location
BEFORE INSERT ON area_anchor_relocation_deltas
WHEN NOT EXISTS (SELECT 1 FROM source_observations po, source_observations nw
    WHERE po.observation_id = NEW.previous_observation_id AND nw.observation_id = NEW.new_observation_id
      AND nw.source_id = po.source_id AND nw.mapping_version = po.mapping_version
      AND json_extract(po.claims_json, '$.locationAnchorId') = NEW.anchor_id
      AND json_extract(nw.claims_json, '$.locationAnchorId') IS NULL
      AND EXISTS (SELECT 1 FROM json_each(po.field_provenance_json) p WHERE json_extract(p.value, '$.field') = 'location'
        AND json_extract(p.value, '$.rule') = 'area-anchor.v1:' || NEW.anchor_id)
      AND EXISTS (SELECT 1 FROM json_each(nw.field_provenance_json) p WHERE json_extract(p.value, '$.field') = 'location'
        AND json_extract(p.value, '$.rule') NOT GLOB 'area-anchor.*'))
BEGIN
  SELECT RAISE(ABORT, 'area_anchor_relocation_deltas: the location evidence is not exactly anchor -> exact point');
END;

-- Nothing else changed: every non-location provenance entry, and every claim but the anchor, is identical.
CREATE TRIGGER area_anchor_relocation_deltas_rest
BEFORE INSERT ON area_anchor_relocation_deltas
WHEN NOT EXISTS (SELECT 1 FROM source_observations po, source_observations nw
    WHERE po.observation_id = NEW.previous_observation_id AND nw.observation_id = NEW.new_observation_id
      AND (SELECT json_group_array(json(p.value)) FROM json_each(po.field_provenance_json) p WHERE json_extract(p.value, '$.field') <> 'location')
        = (SELECT json_group_array(json(p.value)) FROM json_each(nw.field_provenance_json) p WHERE json_extract(p.value, '$.field') <> 'location')
      AND json_remove(po.claims_json, '$.locationAnchorId') IS (CASE WHEN nw.claims_json IS NULL
        THEN json_object('classification', NULL, 'existenceEvidence', NULL, 'communityConfirmations', NULL) ELSE nw.claims_json END))
BEGIN
  SELECT RAISE(ABORT, 'area_anchor_relocation_deltas: something other than the location evidence changed');
END;

CREATE TRIGGER area_anchor_relocation_deltas_immutable BEFORE UPDATE ON area_anchor_relocation_deltas
BEGIN SELECT RAISE(ABORT, 'area_anchor_relocation_deltas are immutable'); END;
CREATE TRIGGER area_anchor_relocation_deltas_no_delete BEFORE DELETE ON area_anchor_relocation_deltas
BEGIN SELECT RAISE(ABORT, 'area_anchor_relocation_deltas are immutable'); END;

DROP VIEW review_relocation_application_premises;
CREATE VIEW review_relocation_application_premises AS
  SELECT i.review_item_id, i.spot_id, i.source_entity_id, i.record_id, i.release_id, i.previous_release_id,
    po.record_id AS previous_record_id, po.observation_id AS previous_observation_id,
    nw.observation_id AS new_observation_id, po.mapping_version,
    po.latitude AS old_latitude, po.longitude AS old_longitude, nw.latitude AS new_latitude, nw.longitude AS new_longitude,
    d.review_decision_id, identity_latest.review_decision_id AS identity_review_decision_id, h.review_relocation_hold_id
  FROM review_items i
  JOIN review_decisions d ON d.review_decision_id =
    (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
  JOIN review_items a ON a.review_item_id = json_extract(i.details_json, '$.identity.reviewItemId')
  JOIN review_decisions identity_latest ON identity_latest.review_decision_id =
    (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = a.review_item_id)
  JOIN review_relocation_holds h ON h.review_item_id = i.review_item_id AND h.spot_id = i.spot_id
  JOIN source_observations po ON po.observation_id = json_extract(i.details_json, '$.previousObservationId')
  JOIN source_observations nw ON nw.observation_id = json_extract(i.details_json, '$.newObservationId')
  JOIN spots s ON s.spot_id = i.spot_id
  WHERE i.kind = 'relocationCandidate'
    AND json_extract(i.details_json, '$.identity.method') = 'reviewedMatch'
    AND json_extract(i.details_json, '$.relocationPolicyVersion') = 'relocation-policy.v1'
    AND json_type(i.details_json, '$.thresholdVersion') = 'null'
    AND json_extract(i.details_json, '$.matcherVersion') IS i.matcher_version
    AND json_type(i.details_json, '$.identity.reviewItemId') = 'integer'
    AND d.decision = 'relocationConfirmed' AND d.decision_version = 'review-decision.v2' AND d.source_entity_id IS NULL
    AND a.kind = 'ambiguousMatch' AND a.source_id = i.source_id AND a.release_id = i.release_id
    AND a.previous_release_id = i.previous_release_id AND a.matcher_version = i.matcher_version
    AND a.record_id = i.record_id
    AND i.source_entity_id IN (SELECT value FROM json_each(a.details_json, '$.candidateEntityIds'))
    AND identity_latest.decision = 'matchedToEntity' AND identity_latest.decision_version = 'review-decision.v1'
    AND identity_latest.source_entity_id = i.source_entity_id
    AND d.review_decision_id > identity_latest.review_decision_id
    AND json_type(i.details_json, '$.previousRecordId') = 'integer'
    AND EXISTS (SELECT 1 FROM source_record_entities e
      WHERE e.record_id = json_extract(i.details_json, '$.previousRecordId')
        AND e.release_id = i.previous_release_id AND e.source_entity_id = i.source_entity_id)
    AND json_type(i.details_json, '$.mappingVersion') = 'text'
    AND json_type(i.details_json, '$.previousObservationId') = 'integer'
    AND json_type(i.details_json, '$.newObservationId') = 'integer'
    AND po.record_id = json_extract(i.details_json, '$.previousRecordId') AND po.release_id = i.previous_release_id
    AND po.source_id = i.source_id AND po.mapping_version = json_extract(i.details_json, '$.mappingVersion')
    AND po.latitude = json_extract(i.details_json, '$.previousCoordinate.latitude')
    AND po.longitude = json_extract(i.details_json, '$.previousCoordinate.longitude')
    AND nw.record_id = i.record_id AND nw.release_id = i.release_id
    AND nw.source_id = i.source_id AND nw.mapping_version = po.mapping_version
    AND nw.latitude = json_extract(i.details_json, '$.newCoordinate.latitude')
    AND nw.longitude = json_extract(i.details_json, '$.newCoordinate.longitude')
    AND NOT (po.latitude = nw.latitude AND po.longitude = nw.longitude)
    AND po.name IS nw.name AND po.supports_paper IS nw.supports_paper AND po.supports_heated IS nw.supports_heated
    AND po.opening_hours_raw IS nw.opening_hours_raw AND po.opening_hours_json IS nw.opening_hours_json
    AND po.opening_hours_status IS nw.opening_hours_status AND po.lifecycle_claim IS nw.lifecycle_claim
    AND json_type(i.details_json, '$.otherChangedFields') = 'array'
    AND ((po.field_provenance_json IS nw.field_provenance_json AND json_array_length(i.details_json, '$.otherChangedFields') = 0)
      OR i.review_item_id IN (SELECT d.review_item_id FROM area_anchor_relocation_deltas d
        WHERE d.previous_observation_id = po.observation_id AND d.new_observation_id = nw.observation_id))
    AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold = 'relocationUnderReview'
    AND s.latitude = po.latitude AND s.longitude = po.longitude
    AND EXISTS (SELECT 1 FROM spot_source_entities l JOIN source_entities se ON se.source_entity_id = l.source_entity_id
      WHERE l.source_entity_id = i.source_entity_id AND l.spot_id = i.spot_id AND se.source_id = i.source_id)
    AND NOT EXISTS (SELECT 1 FROM review_relocation_holds other
      WHERE other.spot_id = i.spot_id AND other.review_relocation_hold_id <> h.review_relocation_hold_id
        AND NOT EXISTS (SELECT 1 FROM review_relocation_applications x WHERE x.review_relocation_hold_id = other.review_relocation_hold_id))
    AND EXISTS (SELECT 1 FROM source_releases p WHERE p.release_id = i.previous_release_id
      AND p.source_id = i.source_id AND p.status = 'applied' AND p.is_current = 1
      AND p.content_sha256 IS json_extract(i.details_json, '$.previousReleaseContentSha256'))
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = i.release_id
      AND r.source_id = i.source_id AND r.status = 'ingested' AND r.content_sha256 = i.release_content_sha256)
    AND NOT EXISTS (
      SELECT 1 FROM source_releases o, source_releases p
      WHERE p.release_id = i.previous_release_id
        AND o.source_id = i.source_id AND o.release_id NOT IN (i.release_id, i.previous_release_id)
        AND o.status <> 'rejected'
        AND (o.observed_on IS NULL OR p.observed_on IS NULL OR o.observed_on > p.observed_on));

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
  OR EXISTS (SELECT 1 FROM area_precision_upgrades)
  OR EXISTS (SELECT 1 FROM area_anchor_relocation_deltas)
  OR EXISTS (SELECT 1 FROM spot_location_authorities)
  OR EXISTS (SELECT 1 FROM area_point_mappings)
  OR EXISTS (SELECT 1 FROM promotion_location_evidence_attestations)
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
BEGIN SELECT RAISE(ABORT, 'v4 requires a fresh GREEN database'); END;
