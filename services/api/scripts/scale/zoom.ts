// Zoom / part comparison over a published corpus (ADR-0015). Pure: takes spot DTOs, regroups them at each zoom
// exactly as publishTiles would, splits each tile with the real part policy, and measures what a client and D1
// would see. Wall clock is never measured here.
import { gzipSync } from "node:zlib";
import { formatTileId, tileForCoordinate } from "../../src/geo/tile.ts";
import type { TileSourceV1, TileSpotV1 } from "../../src/tiles/dto.ts";
import { manifestBody, splitTileParts, TILE_PART_POLICY } from "../../src/tiles/parts.ts";

const bytes = (s: string) => Buffer.byteLength(s);
const gzip = (s: string) => gzipSync(s).length;
export const maximumBytes = (values: readonly number[]) => values.reduce((max, n) => Math.max(max, n), 0);
function dist(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => (v.length === 0 ? 0 : v[Math.min(v.length - 1, Math.ceil(v.length * q) - 1)]);
  return { max: v.at(-1) ?? 0, p95: at(0.95), p50: at(0.5), mean: v.length === 0 ? 0 : Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 };
}

interface TileCost { requests: number; gzipBytes: number; rawBytes: number }

export async function zoomComparison(spots: readonly TileSpotV1[], sourcesById: ReadonlyMap<string, TileSourceV1>, zoom: number,
  probes: readonly { id: string; latitude: number; longitude: number }[], generatedAt: string) {
  const tiles = new Map<string, { x: number; y: number; spots: TileSpotV1[] }>();
  for (const s of spots) {
    const t = tileForCoordinate(s.latitude, s.longitude, zoom), id = formatTileId(t);
    const entry = tiles.get(id) ?? { x: t.x, y: t.y, spots: [] };
    entry.spots.push(s); tiles.set(id, entry);
  }
  const stats = [];
  const before = new Map<string, TileCost>(), after = new Map<string, TileCost>();
  for (const [tileId, t] of [...tiles].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sorted = [...t.spots].sort((a, b) => (a.id < b.id ? -1 : 1));
    const sources = [...new Set(sorted.flatMap((s) => s.sourceIds))].sort().map((id) => sourcesById.get(id)!);
    // "Before" is the single v1 body ADR-0005 stored and served; "after" is the manifest plus its parts.
    const whole = JSON.stringify({ schemaVersion: 1, tile: tileId, revision: 1, generatedAt, spots: sorted, sources });
    const parts = await splitTileParts(tileId, sorted, sourcesById);
    const manifest = JSON.stringify(manifestBody(tileId, 1, generatedAt, parts));
    const partGzip = parts.map((p) => gzip(p.bodyJson));
    const s = { tileId, spots: sorted.length, rawBytes: bytes(whole), gzipBytes: gzip(whole), parts: parts.length,
      partSpots: parts.map((p) => p.spotCount), partRawBytes: parts.map((p) => p.rawBytes), partGzipBytes: partGzip, manifestBytes: bytes(manifest) };
    stats.push(s);
    before.set(tileId, { requests: 1, gzipBytes: s.gzipBytes, rawBytes: s.rawBytes });
    // A client reads a tile of at most one part at the v1 path (one request, as before) and a multi-part tile as its
    // initial v1 409, then manifest plus parts (the current client cold path).
    after.set(tileId, parts.length <= 1 ? { requests: 1, gzipBytes: s.gzipBytes, rawBytes: s.rawBytes }
      : { requests: 2 + parts.length, gzipBytes: gzip(manifest) + partGzip.reduce((a, b) => a + b, 0), rawBytes: bytes(manifest) + parts.reduce((n, p) => n + bytes(p.bodyJson), 0) });
  }
  // The client syncs the (2*ring+1)^2 neighbourhood of the tile it stands in (NearbyModel: ring 1 = 3x3). An
  // unpublished neighbour still costs one request (its 404). Bytes are data payload only, excluding HTTP headers
  // and 404/409 problem bodies. Cache assumption: a cold viewport
  // (empty client cache), so every tile/manifest/part in the window is a request; a warm client re-pays only the
  // tiles whose revision changed. These counts describe an uncached viewport fill, excluding /v1/config.
  const neighbourhood = (lat: number, lon: number, costs: Map<string, TileCost>, ring: number) => {
    const c = tileForCoordinate(lat, lon, zoom);
    let requests = 0, gzipBytes = 0, rawBytes = 0;
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      const cost = costs.get(`${zoom}/${c.x + dx}/${c.y + dy}`);
      requests += cost?.requests ?? 1; gzipBytes += cost?.gzipBytes ?? 0; rawBytes += cost?.rawBytes ?? 0;
    }
    return { requests, gzipBytes, rawBytes };
  };
  const viewport = (costs: Map<string, TileCost>, ring: number) => {
    // Every published spot as an origin: where people stand is where spots are dense.
    const perSpot = spots.map((s) => neighbourhood(s.latitude, s.longitude, costs, ring));
    return {
      requests: dist(perSpot.map((v) => v.requests)), gzipBytes: dist(perSpot.map((v) => v.gzipBytes)), rawBytes: dist(perSpot.map((v) => v.rawBytes)),
      probes: probes.map((p) => ({ id: p.id, ...neighbourhood(p.latitude, p.longitude, costs, ring) })),
    };
  };
  const partSpots = stats.flatMap((s) => s.partSpots), partRaw = stats.flatMap((s) => s.partRawBytes), partGzip = stats.flatMap((s) => s.partGzipBytes);
  return {
    zoom,
    tiles: stats.length,
    spotsPerTile: dist(stats.map((s) => s.spots)),
    tilesOver250Spots: stats.filter((s) => s.spots > TILE_PART_POLICY.maxSpots).length,
    before: {
      rawBytes: dist(stats.map((s) => s.rawBytes)), gzipBytes: dist(stats.map((s) => s.gzipBytes)),
      d1RowMaxBytes: maximumBytes(stats.map((s) => s.rawBytes)),
      tilesOverGzipBudget: stats.filter((s) => s.gzipBytes > TILE_PART_POLICY.maxGzipBytes).length,
      viewport: viewport(before, 1),
      viewport5x5: viewport(before, 2),
    },
    after: {
      policy: TILE_PART_POLICY,
      parts: partSpots.length,
      partsPerTile: dist(stats.map((s) => s.parts)),
      partSpots: dist(partSpots), partRawBytes: dist(partRaw), partGzipBytes: dist(partGzip),
      manifestBytes: dist(stats.map((s) => s.manifestBytes)),
      d1RowMaxBytes: Math.max(maximumBytes(partRaw), maximumBytes(stats.map((s) => s.manifestBytes))),
      partsOverBudget: partSpots.filter((n, i) => n > TILE_PART_POLICY.maxSpots || partRaw[i] > TILE_PART_POLICY.maxRawBytes
        || partGzip[i] > TILE_PART_POLICY.maxGzipBytes).length,
      viewport: viewport(after, 1),
      viewport5x5: viewport(after, 2),
    },
    densest: [...stats].sort((a, b) => b.spots - a.spots || (a.tileId < b.tileId ? -1 : 1)).slice(0, 8)
      .map(({ tileId, spots, rawBytes, gzipBytes, parts }) => ({ tileId, spots, rawBytes, gzipBytes, parts })),
  };
}
