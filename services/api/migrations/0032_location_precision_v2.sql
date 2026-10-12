-- ADR-0018 (location precision v2). Additive only: existing anchors keep NULL in every new column and behave exactly as
-- ADR-0017 policy v1. No existing row, trigger or column changes meaning.
--
-- area_scope       what the anchor point represents: a named zone ('namedZone') or the whole host facility ('facility').
-- anchor_basis     where the point in the reviewed publication came from when that publication is a reviewed page-fact
--                  sheet (ADR-0018 §4): a reviewed government/municipal reference dataset point, or a geocode of the
--                  facility's official address. NULL = the publisher's own point (policy v1).
-- anchor_reference the upstream feature/address the point was taken from, with its dataset/version.
--
-- All three are read out of the cited record's own values through fixed header columns of the same names, so a typed
-- value cannot be bound (the same rule 0030 applies to the point itself). The point is always an anchor of an area or
-- facility, never the smoking place's own point: location-state never reads it as exact.

ALTER TABLE area_location_anchors ADD COLUMN area_scope TEXT CHECK (area_scope IS NULL OR area_scope IN ('namedZone', 'facility'));
ALTER TABLE area_location_anchors ADD COLUMN anchor_basis TEXT CHECK (anchor_basis IS NULL OR anchor_basis IN ('referenceDatasetPoint', 'officialAddressGeocode'));
ALTER TABLE area_location_anchors ADD COLUMN anchor_reference TEXT CHECK (anchor_reference IS NULL OR length(anchor_reference) BETWEEN 1 AND 500);

-- A v2 anchor states its scope and its basis together, and a facility point is a facility anchor, a zone point a zone anchor.
CREATE TRIGGER area_location_anchors_v2_shape
BEFORE INSERT ON area_location_anchors
WHEN (NEW.anchor_basis IS NULL) <> (NEW.anchor_reference IS NULL)
  OR (NEW.anchor_basis IS NOT NULL AND NEW.area_scope IS NULL)
  OR (NEW.area_scope = 'facility' AND NEW.origin_kind <> 'publisherFacilityPoint')
  OR (NEW.area_scope = 'namedZone' AND NEW.origin_kind <> 'publisherAreaPoint')
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: scope, basis and reference must be stated together and match the origin kind');
END;

CREATE TRIGGER area_location_anchors_v2_stated
BEFORE INSERT ON area_location_anchors
WHEN (NEW.area_scope IS NOT NULL AND json_extract(NEW.origin_record_values_json,
        '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = 'area_scope') || ']') IS NOT NEW.area_scope)
  OR (NEW.anchor_basis IS NOT NULL AND json_extract(NEW.origin_record_values_json,
        '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = 'anchor_basis') || ']') IS NOT NEW.anchor_basis)
  OR (NEW.anchor_reference IS NOT NULL AND json_extract(NEW.origin_record_values_json,
        '$[' || (SELECT h.key FROM json_each(NEW.origin_header_json) h WHERE h.value = 'anchor_reference') || ']') IS NOT NEW.anchor_reference)
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: scope, basis and reference must be exactly what the cited record states');
END;

CREATE TRIGGER area_location_anchors_v2_forbidden_reference
BEFORE INSERT ON area_location_anchors
WHEN lower(NEW.anchor_reference) GLOB '*google*' OR lower(NEW.anchor_reference) GLOB '*goo.gl*'
  OR lower(NEW.anchor_reference) GLOB '*apple*' OR lower(NEW.anchor_reference) GLOB '*mapkit*'
  OR lower(NEW.anchor_reference) GLOB '*openstreetmap*' OR lower(NEW.anchor_reference) GLOB '*osm*'
  OR lower(NEW.anchor_reference) GLOB '*overpass*' OR lower(NEW.anchor_reference) GLOB '*nominatim*'
  OR lower(NEW.anchor_reference) GLOB '*screenshot*'
BEGIN
  SELECT RAISE(ABORT, 'area_location_anchors: Google/Apple Maps, OSM and screenshot coordinates are never anchor references');
END;
