-- ADR-0011 remains Proposed. Only inert evidence/review storage is hardened; no canonical publication path.
-- SQLite REPLACE can delete a row without running DELETE triggers when recursive_triggers is off.
CREATE TRIGGER derived_coordinate_geocodes_no_replace
BEFORE INSERT ON derived_coordinate_geocodes
WHEN EXISTS (SELECT 1 FROM derived_coordinate_geocodes g
  WHERE g.geocode_id = NEW.geocode_id OR g.evidence_sha256 = NEW.evidence_sha256
    OR (g.record_id = NEW.record_id AND g.address_column = NEW.address_column
      AND g.geocoder_input = NEW.geocoder_input AND g.geocoder_id = NEW.geocoder_id
      AND g.geocoder_version = NEW.geocoder_version AND g.dataset_release_id = NEW.dataset_release_id))
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_geocodes are immutable evidence; duplicate geocode refused');
END;

CREATE TRIGGER derived_coordinate_reviews_no_replace
BEFORE INSERT ON derived_coordinate_reviews
WHEN EXISTS (SELECT 1 FROM derived_coordinate_reviews WHERE review_id = NEW.review_id)
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews are append-only; duplicate review refused');
END;

-- Require actual JSON booleans and exactly the named checks, matching the pure decision gate.
CREATE TRIGGER derived_coordinate_reviews_strict_checks
BEFORE INSERT ON derived_coordinate_reviews
WHEN NEW.decision = 'approve' AND NOT (
  (SELECT count(*) FROM json_each(NEW.checks_json)) = 6
  AND json_type(NEW.checks_json, '$.officialAddress') IS 'true'
  AND json_type(NEW.checks_json, '$.normalizedAddress') IS 'true'
  AND json_type(NEW.checks_json, '$.returnedLocation') IS 'true'
  AND json_type(NEW.checks_json, '$.precision') IS 'true'
  AND json_type(NEW.checks_json, '$.regionSanity') IS 'true'
  AND json_type(NEW.checks_json, '$.currentListing') IS 'true')
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews: an approval must confirm exactly the named boolean review checks');
END;

CREATE TRIGGER derived_coordinate_reviews_nonblank_site_evidence
BEFORE INSERT ON derived_coordinate_reviews
WHEN NEW.decision = 'approve'
  AND (SELECT precision FROM derived_coordinate_geocodes WHERE geocode_id = NEW.geocode_id) <> 'residentialDetail'
  AND (NEW.site_evidence IS NULL OR trim(NEW.site_evidence,
    char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
         8232, 8233, 8239, 8287, 12288, 65279)) = '')
BEGIN
  SELECT RAISE(ABORT, 'derived_coordinate_reviews: block/parcel precision needs nonblank site evidence');
END;
