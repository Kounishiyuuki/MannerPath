// Tile zoom / part benchmark (ADR-0015, Issue #158) on the #156 synthetic community corpus. Local SQLite only:
// the same official fixtures, community load and in-memory simulated approval as scale:community, then one real
// publish at DATA_TILE_ZOOM and a regrouping of the published spots at z14/z15/z16. Byte and count measurements
// only; no wall clock, no remote operation, and the production publication decision is untouched.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { COMMUNITY_PUBLICATION } from "../src/reports/community-publication.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";
import { DATA_TILE_ZOOM } from "../src/geo/tile.ts";
import { importAllReviewedSources } from "../test/support/reviewed-fixtures.ts";
import { reportsD1, SqliteD1 } from "../test/support/sqlite-d1.ts";
import { scaleOptions } from "./scale/options.ts";
import { CORPUS_VERSION, CORPUS_SEED, DENSE_AREAS, PROFILES, corpusDigest } from "./scale/corpus.ts";
import { loadCommunityCorpus, BENCHMARK_NOW } from "./scale/load.ts";
import { zoomComparison } from "./scale/zoom.ts";

const { profile, output } = scaleOptions(process.argv.slice(2));
const db = new SqliteD1();
const reportsDb = reportsD1();
await importAllReviewedSources(db, BENCHMARK_NOW);
assert.equal(COMMUNITY_PUBLICATION.state, "pending");
await loadCommunityCorpus(db, reportsDb, profile, (count) => process.stderr.write(`${profile}: loaded ${count} spots\n`));
// Only this process's disposable, in-memory database simulates approval, exactly as scale:community does.
db.raw.prepare("UPDATE sources SET publication_status='approved',attribution_text=?,license_name=?,license_url=? WHERE source_id=?")
  .run("TEST ONLY synthetic community attribution", "TEST ONLY simulated report terms", "https://example.invalid/report-terms", COMMUNITY_SOURCE_ID);
db.raw.prepare("UPDATE report_terms_versions SET publication_rights='granted' WHERE terms_version=?").run(CURRENT_REPORT_TERMS.version);
await publishTiles(db, { now: BENCHMARK_NOW });

const tiles = await readPublishedTiles(db);
const spots = tiles.flatMap((t) => t.spots);
assert.equal(spots.length, PROFILES[profile] + 513);
const sourcesById = new Map(tiles.flatMap((t) => t.sources).map((s) => [s.id, s]));
const probes = DENSE_AREAS.map((id) => SEED_AREAS.find((s) => s.id === id)!);
const zooms = [];
for (const zoom of [14, 15, 16]) {
  process.stderr.write(`${profile}: z${zoom}\n`);
  zooms.push(await zoomComparison(spots, sourcesById, zoom, probes, BENCHMARK_NOW));
}
// The hard gate on what was actually published (DATA_TILE_ZOOM), with real gzip.
const quality = await analyzeCorpus(db, { now: BENCHMARK_NOW, gzip: (s) => gzipSync(s).length });
const gate = quality.checks.find((c) => c.id === "tile-part-budget")!;
const report = { version: "tile-delivery-benchmark.v1", profile, dataTileZoom: DATA_TILE_ZOOM,
  corpus: { version: CORPUS_VERSION, seed: CORPUS_SEED, sha256: corpusDigest(profile), communitySpots: PROFILES[profile], official: 513 },
  environment: { runtime: process.version, database: "local node:sqlite; not remote D1", gzip: "node:zlib default level" },
  publication: { productionDecision: COMMUNITY_PUBLICATION.state, source: COMMUNITY_REGISTRY.publicationStatus, simulationOnly: true },
  gate: { id: gate.id, status: gate.status, detail: gate.detail }, zooms };
writeFileSync(`${output}.json`, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ profile, output: `${output}.json`, gate: gate.status,
  zooms: zooms.map((z) => ({ zoom: z.zoom, tiles: z.tiles, maxSpots: z.spotsPerTile.max, beforeMaxGzip: z.before.gzipBytes.max,
    afterMaxPartGzip: z.after.partGzipBytes.max, afterD1Row: z.after.d1RowMaxBytes, meanRequests: z.after.viewport.requests.mean })) }) + "\n");
db.raw.close();
