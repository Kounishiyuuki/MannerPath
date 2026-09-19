-- MannerPath D1 schema v1. Design and rationale: docs/adr/0006-evidence-and-publication.md
-- ("Amendment 2026-09: physical schema"). Plain SQLite: no extensions, no PostGIS types.
--
-- Layers, from raw to published:
--   sources -> source_releases -> source_records             (immutable raw evidence)
--   source_entities + source_record_entities                  (our cross-release identity)
--   spots + spot_source_entities + spot_field_provenance      (resolved canonical data)
--   tile_snapshots + tile_snapshot_spots                      (published per-tile state)
--
-- Timestamps are ISO-8601 UTC text ("YYYY-MM-DDTHH:MM:SSZ"); dates are "YYYY-MM-DD".

-- Mirror of docs/SOURCES.md. publication_status is the gate the publish step checks.
CREATE TABLE sources (
  source_id            TEXT PRIMARY KEY CHECK (source_id GLOB '[a-z0-9]*' AND source_id NOT GLOB '*[^a-z0-9-]*'),
  display_name         TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('municipal', 'operator', 'osm', 'userReport')),
  license_name         TEXT,
  license_url          TEXT,
  attribution_text     TEXT,
  publication_status   TEXT NOT NULL DEFAULT 'blocked' CHECK (publication_status IN ('blocked', 'approved')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  -- OSM stays unpublished until ODbL obligations are reviewed (DATA_POLICY.md).
  CHECK (NOT (kind = 'osm' AND publication_status = 'approved'))
);

-- One fetched dataset snapshot. Observation time belongs here, not to records (research §3).
CREATE TABLE source_releases (
  release_id           INTEGER PRIMARY KEY,
  source_id            TEXT NOT NULL REFERENCES sources (source_id),
  -- Date the release says it reflects (Taito: 時点). NULL = unknown; never the fetch date.
  observed_on          TEXT CHECK (observed_on IS NULL OR observed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  fetched_at           TEXT NOT NULL,
  source_url           TEXT NOT NULL,
  http_last_modified   TEXT,
  content_sha256       TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  byte_length          INTEGER NOT NULL CHECK (byte_length >= 0),
  -- Source column names in file order, verbatim (JSON array of strings).
  header_json          TEXT NOT NULL CHECK (json_valid(header_json) AND json_type(header_json) = 'array' AND json_array_length(header_json) > 0),
  record_count         INTEGER NOT NULL CHECK (record_count >= 0),
  parser_version       TEXT NOT NULL,
  -- ingested: raw rows stored; applied: reconciled + resolved into spots; rejected: not used.
  status               TEXT NOT NULL DEFAULT 'ingested' CHECK (status IN ('ingested', 'applied', 'rejected')),
  is_current           INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  applied_at           TEXT,
  CHECK (is_current = 0 OR status = 'applied'),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL)),
  -- Re-importing identical bytes is a no-op, not a new release.
  UNIQUE (source_id, content_sha256)
);

-- At most one current (latest applied) release per source; absence from it drives removal.
CREATE UNIQUE INDEX source_releases_one_current ON source_releases (source_id) WHERE is_current = 1;

-- One raw row, exactly as parsed from the release. Immutable.
CREATE TABLE source_records (
  record_id            INTEGER PRIMARY KEY,
  release_id           INTEGER NOT NULL REFERENCES source_releases (release_id),
  -- 1-based position of the record in the file.
  ordinal              INTEGER NOT NULL CHECK (ordinal >= 1),
  -- Upstream row identifier as printed (Taito "#"). Release-scoped only: it is never used to
  -- match records across releases, because nothing shows the publisher keeps it stable.
  upstream_row_ref     TEXT,
  -- Values in header_json order, verbatim strings (no trimming, width folding or date parsing).
  raw_values_json      TEXT NOT NULL CHECK (json_valid(raw_values_json) AND json_type(raw_values_json) = 'array'),
  -- sha256 of raw_values_json; lets the matcher detect unchanged rows cheaply.
  raw_sha256           TEXT NOT NULL CHECK (length(raw_sha256) = 64 AND raw_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- Matcher input derived from raw values (e.g. normalised 名称 + 設置位置), with its algorithm version.
  natural_key          TEXT,
  natural_key_version  TEXT,
  CHECK ((natural_key IS NULL) = (natural_key_version IS NULL)),
  UNIQUE (release_id, ordinal),
  UNIQUE (record_id, release_id)
);

CREATE UNIQUE INDEX source_records_row_ref ON source_records (release_id, upstream_row_ref) WHERE upstream_row_ref IS NOT NULL;
CREATE INDEX source_records_natural_key ON source_records (natural_key) WHERE natural_key IS NOT NULL;

CREATE TRIGGER source_records_width_matches_header
BEFORE INSERT ON source_records
WHEN json_array_length(NEW.raw_values_json) <> (SELECT json_array_length(header_json) FROM source_releases WHERE release_id = NEW.release_id)
BEGIN
  SELECT RAISE(ABORT, 'source_records: raw value count does not match release header');
END;

CREATE TRIGGER source_records_immutable
BEFORE UPDATE ON source_records
BEGIN
  SELECT RAISE(ABORT, 'source_records are immutable raw evidence');
END;

CREATE TRIGGER source_records_no_delete
BEFORE DELETE ON source_records
BEGIN
  SELECT RAISE(ABORT, 'source_records are immutable raw evidence');
END;

-- MannerPath's own identity for "the same upstream thing across releases". Server-assigned,
-- because the upstream source has no stable ID.
CREATE TABLE source_entities (
  source_entity_id     INTEGER PRIMARY KEY,
  source_id            TEXT NOT NULL REFERENCES sources (source_id),
  created_at           TEXT NOT NULL,
  UNIQUE (source_entity_id, source_id)
);

-- Reconciliation decision: which entity a release's record belongs to, and why.
CREATE TABLE source_record_entities (
  record_id            INTEGER PRIMARY KEY,
  release_id           INTEGER NOT NULL,
  source_entity_id     INTEGER NOT NULL REFERENCES source_entities (source_entity_id),
  -- new: first seen; natural_key / raw_identical: automatic match to the previous release; manual: reviewed.
  method               TEXT NOT NULL CHECK (method IN ('new', 'natural_key', 'raw_identical', 'manual')),
  matcher_version      TEXT NOT NULL,
  decided_at           TEXT NOT NULL,
  note                 TEXT,
  FOREIGN KEY (record_id, release_id) REFERENCES source_records (record_id, release_id),
  -- An entity appears at most once per release; a duplicate is an ambiguous match, not a link.
  UNIQUE (source_entity_id, release_id)
);

CREATE TRIGGER source_record_entities_same_source
BEFORE INSERT ON source_record_entities
WHEN (SELECT source_id FROM source_releases WHERE release_id = NEW.release_id)
  <> (SELECT source_id FROM source_entities WHERE source_entity_id = NEW.source_entity_id)
BEGIN
  SELECT RAISE(ABORT, 'source_record_entities: record and entity belong to different sources');
END;

-- Canonical resolved spot. Typed columns: this is the only table API hot paths need.
CREATE TABLE spots (
  spot_id                  TEXT PRIMARY KEY CHECK (length(spot_id) BETWEEN 8 AND 64),
  merged_into              TEXT REFERENCES spots (spot_id),
  name                     TEXT,
  latitude                 REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude                REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- Computed server-side from latitude/longitude with the shared tile contract (ADR-0005).
  tile_z                   INTEGER NOT NULL CHECK (tile_z = 14),
  tile_x                   INTEGER NOT NULL CHECK (tile_x BETWEEN 0 AND 16383),
  tile_y                   INTEGER NOT NULL CHECK (tile_y BETWEEN 0 AND 16383),
  tile_id                  TEXT NOT NULL,
  spot_type                TEXT NOT NULL CHECK (spot_type IN ('designatedOutdoorArea', 'publicSmokingRoom', 'facilitySmokingRoom', 'ashtray', 'smokingPermittedVenue')),
  host_type                TEXT,
  access_type              TEXT NOT NULL DEFAULT 'unknown' CHECK (access_type IN ('public', 'customerOnly', 'facilityOnly', 'unknown')),
  environment              TEXT NOT NULL DEFAULT 'unknown' CHECK (environment IN ('indoor', 'outdoor', 'covered', 'unknown')),
  supports_paper           TEXT NOT NULL DEFAULT 'unknown' CHECK (supports_paper IN ('yes', 'no', 'unknown')),
  supports_heated          TEXT NOT NULL DEFAULT 'unknown' CHECK (supports_heated IN ('yes', 'no', 'unknown')),
  opening_hours_raw        TEXT,
  opening_hours_json       TEXT CHECK (opening_hours_json IS NULL OR json_valid(opening_hours_json)),
  -- unparsed: raw text exists but openNow must stay unknown (e.g. a free-text closure note).
  opening_hours_status     TEXT NOT NULL DEFAULT 'none' CHECK (opening_hours_status IN ('none', 'parsed', 'unparsed')),
  time_zone                TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  fee_type                 TEXT,
  floor                    TEXT,
  entrance_note            TEXT,
  lifecycle                TEXT NOT NULL CHECK (lifecycle IN ('active', 'temporarilyClosed', 'removed')),
  evidence_quality         TEXT NOT NULL,
  evidence_quality_version TEXT NOT NULL,
  -- Observation time of the newest accepted existence evidence; never import/fetch time.
  last_verified_at         TEXT,
  resolver_version         TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  CHECK (tile_id = tile_z || '/' || tile_x || '/' || tile_y),
  CHECK (merged_into IS NULL OR merged_into <> spot_id),
  CHECK ((opening_hours_status = 'parsed') = (opening_hours_json IS NOT NULL)),
  CHECK (opening_hours_status = 'none' OR opening_hours_raw IS NOT NULL)
);

CREATE INDEX spots_tile ON spots (tile_id) WHERE merged_into IS NULL;
CREATE INDEX spots_merged_into ON spots (merged_into) WHERE merged_into IS NOT NULL;

-- Redirects are exactly one hop: the target is live, and nothing points at a merged spot.
CREATE TRIGGER spots_merge_target_is_live_on_insert
BEFORE INSERT ON spots
WHEN NEW.merged_into IS NOT NULL
  AND (SELECT merged_into FROM spots WHERE spot_id = NEW.merged_into) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'spots: merge target is itself merged');
END;

CREATE TRIGGER spots_merge_target_is_live
BEFORE UPDATE OF merged_into ON spots
WHEN NEW.merged_into IS NOT NULL
  AND (SELECT merged_into FROM spots WHERE spot_id = NEW.merged_into) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'spots: merge target is itself merged');
END;

CREATE TRIGGER spots_merge_source_has_no_inbound
BEFORE UPDATE OF merged_into ON spots
WHEN NEW.merged_into IS NOT NULL
  AND EXISTS (SELECT 1 FROM spots WHERE merged_into = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'spots: repoint redirects to this spot before merging it');
END;

CREATE TRIGGER spots_merge_is_permanent
BEFORE UPDATE OF merged_into ON spots
WHEN OLD.merged_into IS NOT NULL AND NEW.merged_into IS NULL
BEGIN
  SELECT RAISE(ABORT, 'spots: a merge redirect cannot be removed');
END;

CREATE TRIGGER spots_no_delete
BEFORE DELETE ON spots
BEGIN
  SELECT RAISE(ABORT, 'spots are never deleted; use lifecycle or merged_into');
END;

-- Which source entities a spot is resolved from. An entity feeds at most one live spot.
CREATE TABLE spot_source_entities (
  source_entity_id     INTEGER PRIMARY KEY REFERENCES source_entities (source_entity_id),
  spot_id              TEXT NOT NULL REFERENCES spots (spot_id),
  method               TEXT NOT NULL CHECK (method IN ('created', 'matched', 'manual', 'merge')),
  linked_at            TEXT NOT NULL,
  resolver_version     TEXT NOT NULL
);

CREATE INDEX spot_source_entities_spot ON spot_source_entities (spot_id);

-- Field-level provenance: which evidence each resolved column came from. It records
-- provenance only; values live in typed spots columns, so no hot path reads this table.
-- A field with no row is unknown/default and has no evidence.
CREATE TABLE spot_field_provenance (
  spot_id              TEXT NOT NULL REFERENCES spots (spot_id),
  field                TEXT NOT NULL CHECK (field IN (
                         'existence', 'location', 'name', 'spotType', 'hostType', 'accessType',
                         'environment', 'supportsPaper', 'supportsHeated', 'openingHours',
                         'feeType', 'floor', 'entranceNote', 'lifecycle')),
  record_id            INTEGER NOT NULL REFERENCES source_records (record_id),
  -- Raw columns the value was derived from (JSON array of header names), e.g. ["名称","特記事項"].
  source_columns_json  TEXT NOT NULL CHECK (json_valid(source_columns_json) AND json_type(source_columns_json) = 'array'),
  -- Named derivation rule, e.g. 'taito.heatedOnly.v1'.
  rule                 TEXT NOT NULL,
  resolver_version     TEXT NOT NULL,
  resolved_at          TEXT NOT NULL,
  PRIMARY KEY (spot_id, field)
);

CREATE INDEX spot_field_provenance_record ON spot_field_provenance (record_id);

-- Published state of one data tile. body_json is the exact response body that content_sha256
-- and the ETag describe, so an API read is one row and cannot drift from its ETag.
-- Rows are never deleted: an emptied tile is republished with spot_count 0 and a higher revision.
CREATE TABLE tile_snapshots (
  tile_id              TEXT PRIMARY KEY,
  z                    INTEGER NOT NULL CHECK (z = 14),
  x                    INTEGER NOT NULL CHECK (x BETWEEN 0 AND 16383),
  y                    INTEGER NOT NULL CHECK (y BETWEEN 0 AND 16383),
  revision             INTEGER NOT NULL CHECK (revision >= 1),
  schema_version       INTEGER NOT NULL CHECK (schema_version >= 1),
  content_sha256       TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  spot_count           INTEGER NOT NULL CHECK (spot_count >= 0),
  body_json            TEXT NOT NULL CHECK (json_valid(body_json)),
  published_at         TEXT NOT NULL,
  CHECK (tile_id = z || '/' || x || '/' || y)
);

CREATE TRIGGER tile_snapshots_revision_monotonic
BEFORE UPDATE ON tile_snapshots
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshots: revision must increase on every republish');
END;

CREATE TRIGGER tile_snapshots_no_delete
BEFORE DELETE ON tile_snapshots
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshots are never deleted; republish an empty snapshot');
END;

-- Spots contained in each tile's current snapshot. The publish step replaces a tile's rows in
-- the same batch as its tile_snapshots update. The ADR-0006 publication invariant is enforced here.
CREATE TABLE tile_snapshot_spots (
  spot_id              TEXT PRIMARY KEY REFERENCES spots (spot_id),
  tile_id              TEXT NOT NULL REFERENCES tile_snapshots (tile_id)
);

CREATE INDEX tile_snapshot_spots_tile ON tile_snapshot_spots (tile_id);

CREATE TRIGGER tile_snapshot_spots_publication_invariant
BEFORE INSERT ON tile_snapshot_spots
WHEN NOT EXISTS (
  SELECT 1
  FROM spots s
  JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
  JOIN source_records r ON r.record_id = p.record_id
  JOIN source_releases rel ON rel.release_id = r.release_id
  JOIN sources src ON src.source_id = rel.source_id
  WHERE s.spot_id = NEW.spot_id
    AND s.lifecycle = 'active'
    AND s.merged_into IS NULL
    AND s.tile_id = NEW.tile_id
    AND rel.status = 'applied'
    AND src.publication_status = 'approved'
)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: spot is not publishable (ADR-0006: active, unmerged, in this tile, accepted existence evidence from an approved source)');
END;

-- A published spot cannot silently stop satisfying the invariant: the publish step must take it
-- out of its tile snapshot (and republish that tile) in the same batch before changing these.
CREATE TRIGGER spots_published_stay_publishable
BEFORE UPDATE OF lifecycle, merged_into, tile_id ON spots
WHEN EXISTS (SELECT 1 FROM tile_snapshot_spots WHERE spot_id = NEW.spot_id)
  AND (NEW.lifecycle <> 'active' OR NEW.merged_into IS NOT NULL OR NEW.tile_id <> OLD.tile_id)
BEGIN
  SELECT RAISE(ABORT, 'spots: unpublish this spot from its tile before changing lifecycle, merge or tile');
END;

CREATE TRIGGER tile_snapshot_spots_no_update
BEFORE UPDATE ON tile_snapshot_spots
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: delete and re-insert so the publication invariant is re-checked');
END;
