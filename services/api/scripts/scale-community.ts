// Explicit local SQLite benchmark; wall clock measurements are never correctness/CI gates.
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { COMMUNITY_PUBLICATION } from "../src/reports/community-publication.ts";
import { CURRENT_REPORT_TERMS, reviewedTerms } from "../src/reports/terms.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import { buildMultiSourcePromotionBundle, verifyPromotionBundle, type PromotionRegistry } from "../src/pipeline/promotion.ts";
import { generateCrossSourceCandidates } from "../src/pipeline/cross-source.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { readLogicalTiles } from "../src/tiles/logical.ts";
import { analyzeCorpus, TILE_REEVALUATION_GZIP_BYTES, TILE_REEVALUATION_SPOTS } from "../src/quality/analyze.ts";
import { communityAcquisitionMetrics } from "../src/coverage/metrics.ts";
import { campaignProgress, campaignProgressMarkdown } from "../src/coverage/progress.ts";
import { publishedGapTasks } from "../src/coverage/published-gaps.ts";
import { readPublishedSpot } from "../src/spots/detail.ts";
import { triageQueue } from "../src/reports/triage.ts";
import { spotEvidenceStates, correctionCandidates, duplicateCandidates } from "../src/pipeline/community-evidence.ts";
import { gapTasks } from "../src/coverage/tasks.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";
import { listModerationQueue } from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { importAllReviewedSources } from "../test/support/reviewed-fixtures.ts";
import { applyPromotionBundle, migratedSqlite, reportsD1, SqliteD1 } from "../test/support/sqlite-d1.ts";
import { AuditedDb } from "./scale/audit.ts";
import { DATA_TILE_ZOOM, tileForCoordinate, formatTileId } from "../src/geo/tile.ts";
import { scaleOptions } from "./scale/options.ts";
import { CORPUS_VERSION, CORPUS_SEED, DENSE_AREAS, PROFILES, corpusDigest, type Profile } from "./scale/corpus.ts";
import { loadCommunityCorpus, BENCHMARK_NOW, PRIVATE_SENTINEL } from "./scale/load.ts";

const { profile, output } = scaleOptions(process.argv.slice(2));
const db = new AuditedDb();
const reportsDb = new AuditedDb(reportsD1());
const timings: Record<string, number> = {}, memory: Record<string, ReturnType<typeof process.memoryUsage>> = {};
async function measure<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
  db.phase = name; reportsDb.phase = name; const start = performance.now();
  try { return await operation(); }
  finally { timings[name] = Math.round((performance.now() - start) * 100) / 100; memory[name] = process.memoryUsage(); writeFileSync(output+".partial.json",JSON.stringify({profile,completedPhase:name,timingsMs:timings,memory,peakRssBytes:process.resourceUsage().maxRSS*1024,complete:false},null,2)+"\n"); process.stderr.write(`${profile}: ${name} ${timings[name]} ms\n`); }
}
const rows = <T>(sql:string) => db.base.raw.prepare(sql).all() as T[];
const n = (sql:string) => (db.base.raw.prepare(sql).get() as {n:number}).n;
await measure("officialImport", () => importAllReviewedSources(db, BENCHMARK_NOW));
await measure("officialPublish", () => publishTiles(db, { now: BENCHMARK_NOW }));
const officialBefore = rows<{spot_id:string;body_json:string}>("SELECT spot_id, body_json FROM tile_snapshot_spots JOIN tile_snapshots USING(tile_id) ORDER BY spot_id")
  .map((r) => TileBodyV1.parse(JSON.parse(r.body_json)).spots.find((s) => s.id === r.spot_id));
assert.equal(officialBefore.length, 513);
const zeroBefore = gapTasks(officialBefore as never).length;
assert.equal(COMMUNITY_PUBLICATION.state, "pending");
assert.equal(COMMUNITY_REGISTRY.publicationStatus, "blocked");
const loaded = await measure("communityLoad", () => loadCommunityCorpus(db, reportsDb, profile, (count) => process.stderr.write(`${profile}: loaded ${count} spots\n`)));
assert.equal(loaded.reports, PROFILES[profile] * 5);
await measure("blockedPublish", () => publishTiles(db, { now: BENCHMARK_NOW }));
assert.equal(n("SELECT count(*) AS n FROM tile_snapshot_spots"), 513, "#124 remains blocked before isolated approval simulation");
// Only this process's disposable, in-memory database simulates future approval. No remote operation or source change.
const simulated = { ...COMMUNITY_REGISTRY, publicationStatus: "approved" as const, attributionText: "TEST ONLY synthetic community attribution",
  licenseName: "TEST ONLY simulated report terms", licenseUrl: "https://example.invalid/report-terms" };
db.base.raw.prepare("UPDATE sources SET publication_status='approved',attribution_text=?,license_name=?,license_url=? WHERE source_id=?")
  .run(simulated.attributionText, simulated.licenseName, simulated.licenseUrl, COMMUNITY_SOURCE_ID);
db.base.raw.prepare("UPDATE report_terms_versions SET publication_rights='granted' WHERE terms_version=?").run(CURRENT_REPORT_TERMS.version);
const registry: PromotionRegistry = { source: (id) => id === COMMUNITY_SOURCE_ID ? simulated : reviewedSource(id),
  terms: (v) => ({ ...reviewedTerms(v), publicationRights: "granted" }) };
await measure("communityPublish", () => publishTiles(db, { now: BENCHMARK_NOW }));
assert.equal(n("SELECT count(*) AS n FROM tile_snapshot_spots"), PROFILES[profile] + 513);
// Logical tiles (Issue #158): a multipart tile is verified and assembled; its stored parts are measured separately.
const logicalTiles = await readLogicalTiles(db);
const tiles = logicalTiles.map((t) => ({ tile_id: t.tileId, body_json: t.physical.length === 1 ? t.physical[0] : JSON.stringify(t.body), spot_count: t.spotCount }));
const parts = logicalTiles.flatMap((t) => t.physical.map((body) => ({ tileId: t.tileId, rawBytes: Buffer.byteLength(body), gzipBytes: gzipSync(body).length,
  spots: (JSON.parse(body) as { spots: unknown[] }).spots.length })));
const multipartTiles = n("SELECT count(*) AS n FROM tile_snapshots WHERE schema_version <> 1");
const tileStats = await measure("tileSerializeDecode", () => tiles.map((t) => {
  const start=performance.now(); const decoded=TileBodyV1.parse(JSON.parse(t.body_json)); const decodeMs=performance.now()-start;
  return { tileId:t.tile_id, spots:t.spot_count, rawBytes:Buffer.byteLength(t.body_json), gzipBytes:gzipSync(t.body_json).length, decodeMs };
}));
const visible = tiles.flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
const officialAfter = visible.filter((s) => s.verification.existence === "official").sort((a,b)=>a.id.localeCompare(b.id));
assert.deepEqual(officialAfter, officialBefore);
const gaps = await measure("coverageTasks", () => gapTasks(visible));
const indexedGaps = await measure("coverageTasksSql", () => publishedGapTasks(db));
assert.equal(indexedGaps.length,gaps.length);
const visited = new Set(rows<{spot_id:string}>("SELECT spot_id FROM community_evidence_upgrades").map((r)=>r.spot_id));
const progress = await measure("campaignProgress", () => campaignProgress(visible,visited));
const acquisition = await measure("acquisitionMetrics", () => communityAcquisitionMetrics(db,visible,{now:BENCHMARK_NOW,reportsDb}));
await measure("spotDetail", () => readPublishedSpot(db,visible[0].id));
await measure("tileRead", () => db.prepare("SELECT body_json,content_sha256 FROM tile_snapshots WHERE tile_id=?").bind(tiles[0].tile_id).first());
const quality = await measure("quality", () => analyzeCorpus(db, { now:BENCHMARK_NOW, gzip:(s)=>gzipSync(s).length }));
const crossSource = await measure("crossSource", () => generateCrossSourceCandidates(db, { now:BENCHMARK_NOW }));
// promotion-bundle v3 cannot carry bounded tile parts (Issue #158); with multipart tiles it refuses, and segmented
// promotion (PR #159) is the path. Measure v3 only when every tile is single-part.
let bundle: Awaited<ReturnType<typeof buildMultiSourcePromotionBundle>> | null = null;
let tiers: unknown[] = [];
let bootstrapQuality: Awaited<ReturnType<typeof analyzeCorpus>> | null = null;
let target: ReturnType<typeof migratedSqlite> | null = null;
if (multipartTiles === 0) {
  bundle = await measure("promotion", () => buildMultiSourcePromotionBundle(db, { registry }));
  await measure("promotionVerification", () => verifyPromotionBundle(bundle.sql, bundle.manifest.contentSha256));
  for (const token of [PRIVATE_SENTINEL,"INSERT INTO reports", "INSERT INTO report_moderation", "submitter_hash", "claim_host_name", "claim_hours_note"]) assert.ok(!bundle.sql.includes(token), `private data exported: ${token}`);
  await measure("promotionRepeat", async () => { const repeated = await buildMultiSourcePromotionBundle(db, { registry }); assert.equal(repeated.sql,bundle.sql,"same input must export byte-identical SQL"); });
  target = migratedSqlite();
  await measure("bootstrap", () => applyPromotionBundle(target,bundle.sql));
  assert.equal((target.prepare("SELECT count(*) AS n FROM tile_snapshot_spots").get() as {n:number}).n, PROFILES[profile]+513);
  assert.deepEqual(target.prepare("SELECT tile_id,content_sha256 FROM tile_snapshots ORDER BY tile_id").all(), db.base.raw.prepare("SELECT tile_id,content_sha256 FROM tile_snapshots ORDER BY tile_id").all());
  tiers = db.base.raw.prepare("SELECT evidence_quality,count(*) AS n FROM spots JOIN tile_snapshot_spots USING(spot_id) GROUP BY evidence_quality ORDER BY evidence_quality").all();
  assert.deepEqual(target.prepare("SELECT evidence_quality,count(*) AS n FROM spots JOIN tile_snapshot_spots USING(spot_id) GROUP BY evidence_quality ORDER BY evidence_quality").all(),tiers);
  assert.deepEqual(target.prepare("SELECT source_id,attribution_text FROM sources WHERE publication_status='approved' ORDER BY source_id").all(),db.base.raw.prepare("SELECT source_id,attribution_text FROM sources WHERE publication_status='approved' ORDER BY source_id").all());
  await measure("bootstrapReexport", async () => { const reexport = await buildMultiSourcePromotionBundle(new SqliteD1(target), { registry }); assert.equal(reexport.sql,bundle.sql,"bootstrap must re-export identically"); });
  bootstrapQuality = await measure("bootstrapQuality", () => analyzeCorpus(new SqliteD1(target), { now:BENCHMARK_NOW, gzip:(s)=>gzipSync(s).length }));
} else {
  await measure("promotion", () => assert.rejects(buildMultiSourcePromotionBundle(db, { registry }), /bounded parts/));
}
const evidence = await measure("evidenceAggregation", () => spotEvidenceStates(reportsDb,db,{now:new Date(BENCHMARK_NOW)}));
assert.ok(evidence.some((s)=>s.state === "needsRecheck"));
assert.ok(evidence.some((s)=>s.state === "reviewCandidate"));
assert.ok(evidence.some((s)=>s.conflicting));
const corrections = await measure("correctionCandidates", () => correctionCandidates(reportsDb,db,{now:new Date(BENCHMARK_NOW)}));
const duplicates = await measure("duplicateCandidatesPage", () => duplicateCandidates(reportsDb,db,{now:new Date(BENCHMARK_NOW),limit:100}));
const triage = await measure("triagePage", () => triageQueue(reportsDb,db,{now:new Date(Date.parse(BENCHMARK_NOW)+60000),limit:100}));
const moderation = await measure("moderationPage", () => listModerationQueue(reportsDb,{ limit:100 }));
const retention = await measure("redactionBatch", () => applyReportRetention(reportsDb,{ now:new Date("2027-01-05T00:00:00Z"), limit:200 }));
assert.ok(retention.redactedReports<=200);
const redactionResumed = await measure("redactionResume", () => applyReportRetention(reportsDb,{now:new Date("2027-01-05T00:00:00Z"),limit:200,cursor:retention.nextCursor ?? undefined}));
assert.ok(redactionResumed.redactedReports<=200);
const sortedGzip = tileStats.map((t)=>t.gzipBytes).sort((a,b)=>a-b);
const dbBytes = (db.base.raw.prepare("PRAGMA page_count").get() as {page_count:number}).page_count * (db.base.raw.prepare("PRAGMA page_size").get() as {page_size:number}).page_size;
const reportsDbBytes = (reportsDb.base.raw.prepare("PRAGMA page_count").get() as {page_count:number}).page_count * (reportsDb.base.raw.prepare("PRAGMA page_size").get() as {page_size:number}).page_size;
let maxPromotionStatementBytes = 0;
for (let start = 0; bundle && start < bundle.sql.length;) {
  const delimiter = bundle.sql.indexOf(";\n",start);
  const end = delimiter < 0 ? bundle.sql.length : delimiter + 2;
  maxPromotionStatementBytes = Math.max(maxPromotionStatementBytes,Buffer.byteLength(bundle.sql.slice(start,end))); start = end;
}
const report = { version:"community-scale-benchmark.v1", profile, corpus:{version:CORPUS_VERSION,seed:CORPUS_SEED,sha256:corpusDigest(profile),spots:PROFILES[profile],reports:loaded.reports,official:513},
  environment:{ runtime:process.version, database:"local node:sqlite; not remote D1", memory:"per-phase RSS plus process.resourceUsage OS high-water RSS", platform:process.platform },
  timingsMs:timings,memory,peakRssBytes:process.resourceUsage().maxRSS*1024,dbBytes,reportsDbBytes,
  statementLimits:{data:db.limits,reports:reportsDb.limits},
  indexes:{data:rows("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"),reports:reportsDb.base.raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all()},
  queries:[...[...db.reads.values()].map((r)=>({...r,database:"DATA_DB"})), ...[...reportsDb.reads.values()].map((r)=>({...r,database:"REPORTS_DB"}))].sort((a,b)=>b.elapsedMs-a.elapsedMs),
  tiles:{denseAreas:DENSE_AREAS.map((id)=>{const area=SEED_AREAS.find((s)=>s.id===id)!;const t=tileForCoordinate(area.latitude,area.longitude,DATA_TILE_ZOOM);return{areaId:id,name:area.name,tile:tileStats.find((s)=>s.tileId===formatTileId(t))??null};}),count:tileStats.length,maxSpots:Math.max(...tileStats.map((t)=>t.spots)),maxGzip:sortedGzip.at(-1),p95Gzip:sortedGzip[Math.ceil(sortedGzip.length*.95)-1],budgets:{spots:TILE_REEVALUATION_SPOTS,gzipBytes:TILE_REEVALUATION_GZIP_BYTES}, exceeding:tileStats.filter((t)=>t.spots>TILE_REEVALUATION_SPOTS||t.gzipBytes>TILE_REEVALUATION_GZIP_BYTES),stats:tileStats},
  tileParts:{multipartTiles,count:parts.length,maxSpotsPerPart:Math.max(...parts.map((p)=>p.spots)),maxRawBytesPerPart:Math.max(...parts.map((p)=>p.rawBytes)),maxGzipBytesPerPart:Math.max(...parts.map((p)=>p.gzipBytes))},
  promotion: bundle ? {rawBytes:Buffer.byteLength(bundle.sql),gzipBytes:gzipSync(bundle.sql).length,sha256:bundle.manifest.contentSha256,maxStatementBytes:maxPromotionStatementBytes,bootstrapSpotCount:PROFILES[profile]+513,tiers,deterministic:true,privateDataAbsent:true}
    : { refused: "promotion-bundle.v3 cannot carry bounded tile parts; use segmented promotion (PR #159)", multipartTiles },
  coverage:{seeds:SEED_AREAS.length,zeroBefore,zeroAfter:gaps.length,progress,acquisition},quality:quality.nationwide,bootstrapQuality:bootstrapQuality?.nationwide ?? null,
  crossSource:{candidates:crossSource.length,automaticMerges:n("SELECT count(*) AS n FROM cross_source_merge_applications")},moderation:{pageSize:moderation.length,triagePageSize:triage.length,duplicatePageSize:duplicates.length,corrections:corrections.length,evidenceSpots:evidence.length,evidenceStates:{needsRecheck:evidence.filter((s)=>s.state==="needsRecheck").length,absenceCandidates:evidence.filter((s)=>s.state==="reviewCandidate").length,conflicting:evidence.filter((s)=>s.conflicting).length}},retention:{first:retention,resumed:redactionResumed},
  publication:{productionDecision:COMMUNITY_PUBLICATION.state,source:COMMUNITY_REGISTRY.publicationStatus,simulationOnly:true} };
writeFileSync(output+".json",JSON.stringify(report,null,2)+"\n");
writeFileSync(output+"-campaign.json",JSON.stringify(progress,null,2)+"\n");
writeFileSync(output+"-campaign.md",campaignProgressMarkdown(progress));
writeFileSync(output+".md",`# Community scale: ${profile}\n\nLocal SQLite only; production publication remains pending and blocked.\n\n${PROFILES[profile]} synthetic spots / ${loaded.reports} reports; ${dbBytes} DB bytes.\n\n| Operation | ms |\n| --- | ---: |\n${Object.entries(timings).map(([k,v])=>`| ${k} | ${v} |`).join("\n")}\n\nTile max / p95 gzip: ${sortedGzip.at(-1)} / ${report.tiles.p95Gzip} bytes. Maximum spots/tile: ${report.tiles.maxSpots}. Budget violations: ${report.tiles.exceeding.length}.\n\nPromotion: ${"refused" in report.promotion ? report.promotion.refused : `${report.promotion.rawBytes} bytes (${report.promotion.gzipBytes} gzip); SHA ${report.promotion.sha256}`}. Stored tile parts: ${report.tileParts.count} (${report.tileParts.multipartTiles} multipart tiles), max ${report.tileParts.maxRawBytesPerPart} raw / ${report.tileParts.maxGzipBytesPerPart} gzip bytes per part.\n\nSeeds: ${SEED_AREAS.length}; zero coverage before / after: ${zeroBefore} / ${gaps.length}.\n\nSee JSON for exact production SQL plans, memory snapshots, quality and bootstrap counts.\n`);
process.stdout.write(JSON.stringify({profile,output:output+".json",spots:PROFILES[profile],timingsMs:timings,dbBytes,maxTileGzip:report.tiles.maxGzip,promotionBytes:bundle ? Buffer.byteLength(bundle.sql) : null})+"\n");
unlinkSync(output+".partial.json");
target?.close(); db.base.raw.close(); reportsDb.base.raw.close();
