-- Normalized source observations (ADR-0008 decision 2, Issue #73).
--
-- Layers, from raw to published, with this table inserted:
--   source_records        immutable raw evidence, in the publisher's own schema
--   source_observations   what one raw record states, normalized by the source's adapter mapping
--   spots + provenance    resolved canonical data (the resolver reads observations, never raw rows)
--
-- An observation is derived data, not evidence: it is a pure function of (raw record, adapter
-- mapping version) and can be re-derived from source_records at any time. It is therefore
-- immutable, one row per (record_id, mapping_version), and carries no timestamp — a derivation time
-- would make two derivations of the same record differ, and nothing reads it.
--
-- What it deliberately does NOT hold:
--   - publication holds and attenuations: those come from reviewed evidence *outside* the source
--     record (Issue #42) and stay in spots.publication_hold / spot_field_attenuations;
--   - canonical identity, tiles, evidence quality, verification dates: the resolver's job;
--   - a copy of the raw values: source_records is the only copy.
-- Its lifecycle column is the source's own claim (a listing in the release says "active"); the
-- canonical lifecycle may be weaker after attenuation.

CREATE TABLE source_observations (
  observation_id       INTEGER PRIMARY KEY,
  record_id            INTEGER NOT NULL,
  release_id           INTEGER NOT NULL,
  source_id            TEXT NOT NULL REFERENCES sources (source_id),
  -- The adapter mapping that produced this row, e.g. 'taito-observation.v1'. A changed mapping adds
  -- rows under a new version; existing rows are never rewritten.
  mapping_version      TEXT NOT NULL,
  name                 TEXT,
  latitude             REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude            REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  supports_paper       TEXT NOT NULL CHECK (supports_paper IN ('yes', 'no', 'unknown')),
  supports_heated      TEXT NOT NULL CHECK (supports_heated IN ('yes', 'no', 'unknown')),
  opening_hours_raw    TEXT,
  opening_hours_json   TEXT CHECK (opening_hours_json IS NULL OR json_valid(opening_hours_json)),
  opening_hours_status TEXT NOT NULL CHECK (opening_hours_status IN ('none', 'parsed', 'unparsed')),
  lifecycle_claim      TEXT NOT NULL CHECK (lifecycle_claim IN ('active', 'temporarilyClosed', 'removed')),
  -- Which raw columns and which named mapping rule each normalized field came from, as
  -- [{"field","columns","rule"}]. Canonical spot_field_provenance rows are copied from this verbatim,
  -- still citing record_id, so provenance keeps pointing at the raw record, not at this row.
  field_provenance_json TEXT NOT NULL CHECK (json_valid(field_provenance_json) AND json_type(field_provenance_json) = 'array'),
  CHECK ((opening_hours_status = 'parsed') = (opening_hours_json IS NOT NULL)),
  CHECK (opening_hours_status = 'none' OR opening_hours_raw IS NOT NULL),
  FOREIGN KEY (record_id, release_id) REFERENCES source_records (record_id, release_id),
  UNIQUE (record_id, mapping_version)
);

CREATE INDEX source_observations_release ON source_observations (release_id, mapping_version);

-- The observation's source is its record's release's source. Code checks the adapter identity too
-- (src/pipeline/observe.ts); this keeps a hand-written row from filing one source's record under another.
CREATE TRIGGER source_observations_same_source
BEFORE INSERT ON source_observations
WHEN NEW.source_id IS NOT (SELECT source_id FROM source_releases WHERE release_id = NEW.release_id)
BEGIN
  SELECT RAISE(ABORT, 'source_observations: source_id does not match the record''s release');
END;

CREATE TRIGGER source_observations_immutable
BEFORE UPDATE ON source_observations
BEGIN
  SELECT RAISE(ABORT, 'source_observations are immutable; add a new mapping_version instead');
END;

CREATE TRIGGER source_observations_no_delete
BEFORE DELETE ON source_observations
BEGIN
  SELECT RAISE(ABORT, 'source_observations are immutable; add a new mapping_version instead');
END;
