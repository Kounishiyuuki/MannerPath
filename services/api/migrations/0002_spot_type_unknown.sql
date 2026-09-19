-- Adds spot_type 'unknown' (ADR-0006 amendment 2026-09, Issue #12). The first municipal source
-- (Taito) lists smoking places without saying whether each is an outdoor area, a room or an
-- ashtray, and a physical type must not be guessed from a name. SQLite cannot alter a CHECK
-- constraint, so the spots table is rebuilt; its indexes and triggers are recreated unchanged.
-- ALTER TABLE ... RENAME rewrites the foreign keys and trigger bodies that refer to spots_v2. The one
-- trigger on another table that reads spots is dropped first, because RENAME rejects a schema
-- whose triggers name a missing table, and is recreated unchanged at the end.
-- Precondition: spots is empty. Dropping a referenced parent table leaves deferred foreign-key
-- violations that a rename does not clear, and D1 cannot switch foreign keys off, so this rebuild
-- is only valid before the first spot exists (true everywhere when it was written: no importer had
-- run, and only local databases were migrated). The CHECK below aborts the migration otherwise.
CREATE TABLE migration_0002_guard (spots_table_must_be_empty INTEGER NOT NULL CHECK (spots_table_must_be_empty = 0));
INSERT INTO migration_0002_guard SELECT count(*) FROM spots;
DROP TABLE migration_0002_guard;

PRAGMA defer_foreign_keys = on;

CREATE TABLE spots_v2 (
  spot_id                  TEXT PRIMARY KEY CHECK (length(spot_id) BETWEEN 8 AND 64),
  merged_into              TEXT REFERENCES spots_v2 (spot_id),
  name                     TEXT,
  latitude                 REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude                REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- Computed server-side from latitude/longitude with the shared tile contract (ADR-0005).
  tile_z                   INTEGER NOT NULL CHECK (tile_z = 14),
  tile_x                   INTEGER NOT NULL CHECK (tile_x BETWEEN 0 AND 16383),
  tile_y                   INTEGER NOT NULL CHECK (tile_y BETWEEN 0 AND 16383),
  tile_id                  TEXT NOT NULL,
  spot_type                TEXT NOT NULL CHECK (spot_type IN ('designatedOutdoorArea', 'publicSmokingRoom', 'facilitySmokingRoom', 'ashtray', 'smokingPermittedVenue', 'unknown')),
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

DROP TRIGGER tile_snapshot_spots_publication_invariant;

DROP TABLE spots;
ALTER TABLE spots_v2 RENAME TO spots;

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

-- A published spot cannot silently stop satisfying the invariant (see 0001).
CREATE TRIGGER spots_published_stay_publishable
BEFORE UPDATE OF lifecycle, merged_into, tile_id ON spots
WHEN EXISTS (SELECT 1 FROM tile_snapshot_spots WHERE spot_id = NEW.spot_id)
  AND (NEW.lifecycle <> 'active' OR NEW.merged_into IS NOT NULL OR NEW.tile_id <> OLD.tile_id)
BEGIN
  SELECT RAISE(ABORT, 'spots: unpublish this spot from its tile before changing lifecycle, merge or tile');
END;

-- Unchanged from 0001: the ADR-0006 publication invariant.
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
