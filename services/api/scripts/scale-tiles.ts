// Tile-delivery scale measurement (Issue #158; corpus from #156 / docs/COMMUNITY_SCALE_RUNBOOK.md).
//
// Loads the same deterministic synthetic community corpus as `scale:community`, simulates the future approval
// ONLY inside this disposable in-memory database, publishes, and then measures:
//   - logical tiles at z14 / z15 / z16 (published spot DTOs regrouped by zoom; the stored zoom is DATA_TILE_ZOOM),
//   - the stored representation at DATA_TILE_ZOOM: logical tiles, physical parts and every bounded row.
// Nothing remote is touched and nothing is written outside the --output prefix.
//
//   npm run scale:tiles -- --profile large --output /tmp/mannerpath-tiles-large
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../src/geo/tile.ts";
import * as tileParts from "../src/tiles/parts.ts";
import { importAllReviewedSources } from "../test/support/reviewed-fixtures.ts";
import { reportsD1 } from "../test/support/sqlite-d1.ts";
import { AuditedDb } from "./scale/audit.ts";
import { scaleOptions } from "./scale/options.ts";
import { PROFILES } from "./scale/corpus.ts";
import { loadCommunityCorpus, BENCHMARK_NOW } from "./scale/load.ts";

const { profile, output } = scaleOptions(process.argv.slice(2));
const db = new AuditedDb();
const reportsDb = new AuditedDb(reportsD1());
const timings: Record<string, number> = {};
async function measure<T>(name: string, op: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try { return await op(); } finally {
    timings[name] = Math.round((performance.now() - start) * 100) / 100;
    process.stderr.write(`${profile}: ${name} ${timings[name]} ms\n`);
  }
}
const rows = <T>(sql: string) => db.base.raw.prepare(sql).all() as T[];

await measure("officialImport", () => importAllReviewedSources(db, BENCHMARK_NOW));
await measure("communityLoad", () => loadCommunityCorpus(db, reportsDb, profile));
// Disposable in-memory approval simulation only (as scale:community). No source or terms change anywhere else.
db.base.raw.prepare("UPDATE sources SET publication_status='approved',attribution_text=?,license_name=?,license_url=? WHERE source_id=?")
  .run("TEST ONLY synthetic community attribution", "TEST ONLY simulated report terms", "https://example.invalid/report-terms", COMMUNITY_SOURCE_ID);
db.base.raw.prepare("UPDATE report_terms_versions SET publication_rights='granted' WHERE terms_version=?").run(CURRENT_REPORT_TERMS.version);
assert.equal(COMMUNITY_REGISTRY.publicationStatus, "blocked", "the committed registry stays blocked");
let publishError: string | null = null;
await measure("publish", async () => {
  try { await publishTiles(db, { now: BENCHMARK_NOW }); } catch (e) { publishError = e instanceof Error ? e.message : String(e); }
});

// Published spot DTOs and their sources, from the stored representation (single bodies or parts).
interface SpotDto { id: string; latitude: number; longitude: number; sourceIds?: string[] }
const spotJson = new Map<string, { dto: SpotDto; json: string }>();
const sourceJson = new Map<string, string>();
const bodies = rows<{ body_json: string }>("SELECT body_json FROM tile_snapshots WHERE schema_version = 1")
  .concat(typeof tileParts.TILE_PART_SCHEMA_VERSION === "number"
    ? rows<{ body_json: string }>("SELECT body_json FROM tile_snapshot_parts") : []);
for (const { body_json } of bodies) {
  const body = JSON.parse(body_json) as { spots: SpotDto[]; sources: { id: string }[] };
  for (const s of body.spots) spotJson.set(s.id, { dto: s, json: JSON.stringify(s) });
  for (const s of body.sources) sourceJson.set(s.id, JSON.stringify(s));
}
const published = spotJson.size;

function zoomStats(z: number) {
  const tiles = new Map<string, string[]>();
  for (const [id, { dto }] of spotJson) {
    const t = formatTileId(tileForCoordinate(dto.latitude, dto.longitude, z));
    (tiles.get(t) ?? tiles.set(t, []).get(t)!).push(id);
  }
  let max = { tileId: "", spots: 0, rawBytes: 0, gzipBytes: 0 };
  const raws: number[] = [], spotsPerTile: number[] = [];
  let over250 = 0, over16k = 0;
  for (const [tileId, ids] of tiles) {
    ids.sort();
    const sources = [...new Set(ids.flatMap((id) => spotJson.get(id)!.dto.sourceIds ?? []))].sort();
    const body = `{"schemaVersion":1,"tile":"${tileId}","revision":1,"generatedAt":"${BENCHMARK_NOW}","spots":[${ids.map((id) => spotJson.get(id)!.json).join(",")}],"sources":[${sources.map((s) => sourceJson.get(s)).join(",")}]}`;
    const raw = Buffer.byteLength(body);
    raws.push(raw); spotsPerTile.push(ids.length);
    if (ids.length > 250) over250++;
    if (ids.length > max.spots) max = { tileId, spots: ids.length, rawBytes: raw, gzipBytes: gzipSync(body).length };
    if (raw > 16_384) over16k++;
  }
  raws.sort((a, b) => a - b); spotsPerTile.sort((a, b) => a - b);
  const p = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];
  return { zoom: z, logicalTiles: tiles.size, maxSpots: spotsPerTile.at(-1), p95Spots: p(spotsPerTile, 0.95),
    maxRawBytes: raws.at(-1), p95RawBytes: p(raws, 0.95), tilesOver250Spots: over250, tilesOverRaw16KiB: over16k, densest: max };
}

const zooms = await measure("zoomStats", () => [14, 15, 16].map(zoomStats));

// The stored representation at DATA_TILE_ZOOM.
const heads = rows<{ tile_id: string; schema_version: number; spot_count: number; body_json: string; part_count?: number }>(
  "SELECT * FROM tile_snapshots ORDER BY tile_id");
const parts = typeof tileParts.TILE_PART_SCHEMA_VERSION === "number"
  ? rows<{ tile_id: string; part_index: number; spot_count: number; body_json: string }>("SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index")
  : [];
const storedRows = [...heads.map((h) => h.body_json), ...parts.map((p) => p.body_json)];
const partBodies = [...heads.filter((h) => h.schema_version === 1).map((h) => ({ tile: h.tile_id, spots: h.spot_count, body: h.body_json })),
  ...parts.map((p) => ({ tile: p.tile_id, spots: p.spot_count, body: p.body_json }))];
const partsPerTile = new Map<string, number>();
for (const pb of partBodies) partsPerTile.set(pb.tile, (partsPerTile.get(pb.tile) ?? 0) + 1);
// Densest logical tile: most spots (ties: most parts, then tile id).
const spotsOf = new Map(heads.map((h) => [h.tile_id, h.spot_count]));
const densest = [...partsPerTile.entries()].sort((a, b) => (spotsOf.get(b[0])! - spotsOf.get(a[0])!) || (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0];
const stored = {
  zoom: DATA_TILE_ZOOM,
  logicalTiles: heads.length,
  multipartTiles: heads.filter((h) => h.schema_version !== 1).length,
  totalParts: partBodies.length,
  maxPartsPerTile: Math.max(0, ...partsPerTile.values()),
  densestLogicalTile: densest ? { tileId: densest[0], parts: densest[1], spots: heads.find((h) => h.tile_id === densest[0])!.spot_count } : null,
  maxSpotsPerPart: Math.max(...partBodies.map((p) => p.spots)),
  maxRawBytesPerPart: Math.max(...partBodies.map((p) => Buffer.byteLength(p.body))),
  maxGzipBytesPerPart: Math.max(...partBodies.map((p) => gzipSync(p.body).length)),
  maxStoredRowBodyBytes: Math.max(...storedRows.map((b) => Buffer.byteLength(b))),
  maxManifestBytes: Math.max(0, ...heads.filter((h) => h.schema_version !== 1).map((h) => Buffer.byteLength(h.body_json))),
  publishedSpots: published,
};
const report = { version: "tile-delivery-scale.v1", profile, spots: PROFILES[profile], official: 513, publishError, timingsMs: timings,
  peakRssBytes: process.resourceUsage().maxRSS * 1024, zooms, stored };
writeFileSync(`${output}.json`, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
