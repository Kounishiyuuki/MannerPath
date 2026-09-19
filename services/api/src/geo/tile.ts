// Web Mercator Slippy XYZ tile math. The contract (edge ownership, clamping, antimeridian,
// ID format) is pinned by contracts/tiles/slippy-xyz-vectors.v1.json; the Swift client must
// pass the same vectors (ADR-0005).

export const DATA_TILE_ZOOM = 14;
export const MAX_ZOOM = 30;
export const MAX_MERCATOR_LATITUDE = 85.05112877980659;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

export function tileForCoordinate(lat: number, lon: number, z: number): Tile {
  if (!Number.isInteger(z) || z < 0 || z > MAX_ZOOM) {
    throw new RangeError(`tileForCoordinate: zoom must be an integer in [0, ${MAX_ZOOM}], got ${z}`);
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError(`tileForCoordinate: invalid coordinate lat=${lat} lon=${lon}`);
  }
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n) % n;
  const phi = (Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat)) * Math.PI) / 180;
  const rawY = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
  const y = Math.max(0, Math.min(n - 1, rawY));
  return { z, x, y };
}

export function formatTileId(tile: Tile): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

const TILE_ID = /^(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/;

/** Returns null for anything that is not a canonical tile ID (padding, sign, out of range). */
export function parseTileId(id: string): Tile | null {
  const m = TILE_ID.exec(id);
  if (!m) return null;
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (z > MAX_ZOOM) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  return { z, x, y };
}
