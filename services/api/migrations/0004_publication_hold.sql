-- Publication hold (ADR-0006 amendment 2026-09, Issue #42).
--
-- 台東区's second current publication of the same list states that one listed location is
-- temporarily relocated, while the open-data CSV still carries the permanent coordinate and no
-- authoritative coordinate for the current location is published anywhere. The place has not
-- closed and has not been removed, so `lifecycle` would be the wrong word for it; inventing a
-- coordinate is forbidden; and publishing the old point would route a user to a place the ward
-- itself says is no longer the active one.
--
-- `publication_hold` is the narrow, explicit third option: the canonical row stays exactly as the
-- source states it, and the spot is withheld from every published surface (tiles, and therefore
-- `GET /spots/{id}`, which reads through the same gate). It is a publication decision, on its own
-- axis, never a claim about the place.
--
-- ALTER TABLE ADD COLUMN only: `spots` is not rebuilt, so unlike 0002 this migration is valid with
-- data present. The two triggers that enforce the publication invariant are dropped and recreated
-- to read the new column.

ALTER TABLE spots ADD COLUMN publication_hold TEXT
  CHECK (publication_hold IS NULL OR publication_hold IN ('locationSuperseded'));

-- As in 0002, plus publication_hold: a published spot cannot silently stop satisfying the invariant.
DROP TRIGGER spots_published_stay_publishable;
CREATE TRIGGER spots_published_stay_publishable
BEFORE UPDATE OF lifecycle, merged_into, tile_id, publication_hold ON spots
WHEN EXISTS (SELECT 1 FROM tile_snapshot_spots WHERE spot_id = NEW.spot_id)
  AND (NEW.lifecycle <> 'active' OR NEW.merged_into IS NOT NULL OR NEW.tile_id <> OLD.tile_id
       OR NEW.publication_hold IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'spots: unpublish this spot from its tile before changing lifecycle, merge, tile or publication hold');
END;

-- As in 0001/0002, plus `s.publication_hold IS NULL`: a held spot cannot enter a tile snapshot.
DROP TRIGGER tile_snapshot_spots_publication_invariant;
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
    AND s.publication_hold IS NULL
    AND s.tile_id = NEW.tile_id
    AND rel.status = 'applied'
    AND src.publication_status = 'approved'
)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: spot is not publishable (ADR-0006: active, unmerged, not held, in this tile, accepted existence evidence from an approved source)');
END;
