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
  -- Human-readable pointer into that publication (file + row). Not the provenance boundary; also screened below.
  origin_reference                TEXT NOT NULL CHECK (length(origin_reference) BETWEEN 1 AND 500),
  reuse_basis                     TEXT NOT NULL CHECK (reuse_basis IN ('sameReviewedPublication')),
  policy_version                  TEXT NOT NULL CHECK (policy_version IN ('area-anchor-policy.v1')),
  reviewed_by                     TEXT NOT NULL CHECK (reviewed_by <> ''),
  reviewed_on                     TEXT NOT NULL CHECK (reviewed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  evidence_sha256                 TEXT NOT NULL UNIQUE CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  recorded_at                     TEXT NOT NULL
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
      AND rel.content_sha256 = NEW.origin_release_content_sha256 AND r.raw_values_json = NEW.origin_record_values_json)
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: the anchor must cite a record of its own reviewed publication (release digest and values)');
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

-- Import (open bootstrap): the carried state is the attestation; the spot must already be at the exact point.
CREATE TRIGGER area_precision_upgrades_import
BEFORE INSERT ON area_precision_upgrades
WHEN ((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)))
  AND NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = NEW.spot_id AND s.latitude = NEW.new_latitude AND s.longitude = NEW.new_longitude)
BEGIN
  SELECT RAISE(ABORT, 'area_precision_upgrades: a carried upgrade must describe the carried spot''s coordinate');
END;

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

-- The pin is exactly the anchor's point. Only a carried, already-upgraded spot (open bootstrap) sits elsewhere, and
-- then exactly at its upgrade's exact point.
CREATE TRIGGER spot_location_anchors_coordinate
BEFORE INSERT ON spot_location_anchors
WHEN NOT EXISTS (SELECT 1 FROM spots s JOIN area_location_anchors a ON a.anchor_id = NEW.anchor_id
    WHERE s.spot_id = NEW.spot_id AND s.latitude = a.latitude AND s.longitude = a.longitude
      AND NOT EXISTS (SELECT 1 FROM area_precision_upgrades u WHERE u.spot_id = NEW.spot_id AND u.upgrade_kind = 'relocated'))
  AND NOT (((EXISTS (SELECT 1 FROM promotion_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions))
    OR (EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions))) AND EXISTS (SELECT 1 FROM spots s JOIN area_precision_upgrades u ON u.spot_id = s.spot_id
    WHERE s.spot_id = NEW.spot_id AND u.anchor_id = NEW.anchor_id AND s.latitude = u.new_latitude AND s.longitude = u.new_longitude))
BEGIN
  SELECT RAISE(ABORT, 'spot_location_anchors: a spot is bound at exactly its anchor coordinate');
END;

CREATE TRIGGER spot_location_anchors_immutable BEFORE UPDATE ON spot_location_anchors
BEGIN SELECT RAISE(ABORT, 'spot_location_anchors are immutable'); END;
CREATE TRIGGER spot_location_anchors_no_delete BEFORE DELETE ON spot_location_anchors
BEGIN SELECT RAISE(ABORT, 'spot_location_anchors are immutable'); END;

-- ---------------------------------------------------------------------------------------------------------
-- An anchored spot's pin moves only as the reviewed relocation its upgrade names (ADR-0009 + ADR-0017 §6).
CREATE TRIGGER spots_anchored_coordinate_fixed
BEFORE UPDATE OF latitude, longitude ON spots
WHEN NOT (NEW.latitude IS OLD.latitude AND NEW.longitude IS OLD.longitude)
  AND EXISTS (SELECT 1 FROM spot_location_anchors WHERE spot_id = OLD.spot_id)
  AND NOT EXISTS (SELECT 1 FROM area_precision_upgrades u WHERE u.spot_id = OLD.spot_id AND u.upgrade_kind = 'relocated'
    AND u.old_latitude = OLD.latitude AND u.old_longitude = OLD.longitude
    AND u.new_latitude = NEW.latitude AND u.new_longitude = NEW.longitude)
BEGIN
  SELECT RAISE(ABORT, 'spots: an area-anchored spot moves only through its reviewed area precision upgrade and ADR-0009 relocation');
END;

-- Location provenance of an anchored spot: an area-anchor rule is written only for the spot's own binding; it may be
-- moved to a newer record of the same publication series unchanged (raw-identical evidence), or replaced exactly by
-- the exact-point evidence its upgrade recorded. Nothing else rewrites it.
CREATE TRIGGER spot_field_provenance_area_anchor_insert
BEFORE INSERT ON spot_field_provenance
WHEN NEW.field = 'location' AND NEW.rule GLOB 'area-anchor.*'
  AND NOT EXISTS (SELECT 1 FROM spot_location_anchors b WHERE b.spot_id = NEW.spot_id AND NEW.rule = 'area-anchor.v1:' || b.anchor_id)
BEGIN
  SELECT RAISE(ABORT, 'spot_field_provenance: an area-anchor location names the spot''s own anchor binding');
END;

CREATE TRIGGER spot_field_provenance_area_anchor_update
BEFORE UPDATE ON spot_field_provenance
WHEN OLD.field = 'location' AND (OLD.rule GLOB 'area-anchor.*' OR NEW.rule GLOB 'area-anchor.*')
  AND NOT (NEW.field = OLD.field AND NEW.spot_id = OLD.spot_id AND NEW.rule = OLD.rule AND NEW.source_columns_json = OLD.source_columns_json
    AND NOT EXISTS (SELECT 1 FROM area_precision_upgrades u WHERE u.spot_id = OLD.spot_id))
  AND NOT (NEW.field = OLD.field AND NEW.spot_id = OLD.spot_id AND EXISTS (SELECT 1 FROM area_precision_upgrades u
    WHERE u.spot_id = OLD.spot_id AND OLD.rule = 'area-anchor.v1:' || u.anchor_id AND NEW.rule = u.evidence_location_rule
      AND NEW.record_id = u.evidence_record_id AND json(NEW.source_columns_json) = json(u.evidence_location_columns_json)))
BEGIN
  SELECT RAISE(ABORT, 'spot_field_provenance: an area-anchor location changes only to the exact evidence its upgrade recorded');
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
BEGIN SELECT RAISE(ABORT, 'v4 requires a fresh GREEN database'); END;
