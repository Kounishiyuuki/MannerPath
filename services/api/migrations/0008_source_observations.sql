-- ADR-0008 decision 2: immutable normalized adapter output between raw source_records and the
-- generic resolver. Raw records remain the evidence/source of truth. No derived timestamp is stored:
-- the same immutable record + mapping_version must produce the same row, or generation fails closed.

CREATE TABLE source_observations (
  observation_id       INTEGER PRIMARY KEY,
  record_id            INTEGER NOT NULL,
  release_id           INTEGER NOT NULL REFERENCES source_releases (release_id),
  source_id            TEXT NOT NULL REFERENCES sources (source_id),
  mapping_version      TEXT NOT NULL CHECK (length(mapping_version) > 0),
  name                 TEXT,
  latitude             REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude            REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  supports_paper       TEXT NOT NULL CHECK (supports_paper IN ('yes', 'no', 'unknown')),
  supports_heated      TEXT NOT NULL CHECK (supports_heated IN ('yes', 'no', 'unknown')),
  opening_hours_raw    TEXT NOT NULL,
  opening_hours_json   TEXT CHECK (opening_hours_json IS NULL OR json_valid(opening_hours_json)),
  opening_hours_status TEXT NOT NULL CHECK (opening_hours_status IN ('parsed', 'unparsed')),
  lifecycle            TEXT NOT NULL CHECK (lifecycle IN ('active', 'temporarilyClosed', 'removed')),
  publication_hold     TEXT CHECK (publication_hold IS NULL OR publication_hold IN ('locationSuperseded')),
  provenance_json      TEXT NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'array'),
  attenuations_json    TEXT NOT NULL CHECK (json_valid(attenuations_json) AND json_type(attenuations_json) = 'array'),
  UNIQUE (record_id, mapping_version),
  FOREIGN KEY (record_id, release_id) REFERENCES source_records (record_id, release_id),
  CHECK ((opening_hours_status = 'parsed') = (opening_hours_json IS NOT NULL))
);

CREATE INDEX source_observations_release
ON source_observations (release_id, mapping_version, record_id);

CREATE TRIGGER source_observations_source_matches_release
BEFORE INSERT ON source_observations
WHEN NEW.source_id <> (SELECT source_id FROM source_releases WHERE release_id = NEW.release_id)
BEGIN
  SELECT RAISE(ABORT, 'source_observations: source does not match release');
END;

CREATE TRIGGER source_observations_immutable
BEFORE UPDATE ON source_observations
BEGIN
  SELECT RAISE(ABORT, 'source_observations are immutable; bump mapping_version instead');
END;

CREATE TRIGGER source_observations_no_delete
BEFORE DELETE ON source_observations
BEGIN
  SELECT RAISE(ABORT, 'source_observations are immutable derived evidence; do not delete');
END;
