// Disposable, disk-backed local benchmark. Never connects to D1 or activates community publication.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { SqliteD1 } from "../test/support/sqlite-d1.ts";
import { importAllReviewedSources } from "../test/support/reviewed-fixtures.ts";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { COMMUNITY_PUBLICATION } from "../src/reports/community-publication.ts";
import { CURRENT_REPORT_TERMS, reviewedTerms } from "../src/reports/terms.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import { type PromotionRegistry } from "../src/pipeline/promotion.ts";
import { generateCrossSourceCandidates } from "../src/pipeline/cross-source.ts";
import { promotionReadiness } from "../src/pipeline/promotion-readiness.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { exportPromotionV4 } from "./promotion-v4-export.ts";
import { applyPromotionV4, applyV4Chunk, finalizePromotionV4 } from "./promotion-v4-apply.ts";
import { sqlStatements, verifyPromotionV4 } from "./promotion-v4-verify.ts";
import { canonicalJson } from "./promotion-v4-format.ts";
import { prepareV4ImportPlan, verifyV4ImportPlan } from "./promotion-v4-import-plan.ts";
import { CORPUS_VERSION, CORPUS_SEED, PROFILES, corpusDigest, type Profile } from "./scale/corpus.ts";
import { BENCHMARK_NOW, PRIVATE_SENTINEL, loadCommunityCorpus } from "./scale/load.ts";

export interface PromotionScaleOptions { profile: Profile; output: string; chunkBytes?: number; resumeSource?: boolean }
export function promotionScaleOptions(args: readonly string[]): PromotionScaleOptions {
  const options: PromotionScaleOptions = { profile: "small", output: "/private/tmp/mannerpath-promotion-v4-small" };
  const seen = new Set<string>(); let explicitOutput = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; if (seen.has(flag)) throw Error(`duplicate ${flag}`); seen.add(flag);
    if (flag === "--resume-source") { options.resumeSource = true; continue; }
    const value = args[++i]; if (!value || value.startsWith("--")) throw Error(`missing value for ${flag}`);
    if (flag === "--profile" && Object.hasOwn(PROFILES, value)) options.profile = value as Profile;
    else if (flag === "--output") { options.output = resolve(value); explicitOutput = true; }
    else if (flag === "--chunk-bytes" && Number.isSafeInteger(Number(value)) && Number(value) > 0) options.chunkBytes = Number(value);
    else throw Error("usage: scale:promotion-v4 [--profile small|medium|large|stress] [--output file-prefix] [--chunk-bytes bytes] [--resume-source]");
  }
  if (!explicitOutput) options.output = `/private/tmp/mannerpath-promotion-v4-${options.profile}`;
  return options;
}
function openDisk(path: string, reports = false, resume = false): DatabaseSync {
  if (!resume && existsSync(path)) throw Error(`benchmark database already exists: ${path}; choose a new output or --resume-source`);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=FILE;");
  if (!resume) for (const file of readdirSync(new URL(reports ? "../migrations-reports/" : "../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`${reports ? "../migrations-reports/" : "../migrations/"}${file}`, import.meta.url), "utf8"));
  }
  return db;
}
function scalar(db: DatabaseSync, sql: string): number { return Number((db.prepare(sql).get() as { n: number }).n); }
function digestRows(db: DatabaseSync, sql: string): string {
  const hash = createHash("sha256"); for (const row of db.prepare(sql).iterate()) hash.update(canonicalJson(row) + "\n"); return hash.digest("hex");
}
/** Bounded SQL checks over the published corpus; no flattening all tile bodies. */
function quality(db: DatabaseSync) {
  const missingExistence = scalar(db, "SELECT count(*) AS n FROM tile_snapshot_spots p WHERE NOT EXISTS (SELECT 1 FROM spot_field_provenance e WHERE e.spot_id=p.spot_id AND e.field='existence')");
  const missingAttribution = scalar(db, "SELECT count(*) AS n FROM sources WHERE publication_status='approved' AND (attribution_text IS NULL OR attribution_text='')");
  const unpublishedEvidence = scalar(db, "SELECT count(*) AS n FROM spot_field_provenance p JOIN tile_snapshot_spots t USING(spot_id) JOIN source_records r USING(record_id) JOIN source_releases l USING(release_id) JOIN sources s USING(source_id) WHERE s.publication_status!='approved'");
  assert.equal(missingExistence + missingAttribution + unpublishedEvidence, 0);
  return { published: scalar(db, "SELECT count(*) AS n FROM tile_snapshot_spots"), tiles: scalar(db, "SELECT count(*) AS n FROM tile_snapshots"), totalTileParts: scalar(db, "SELECT count(*) AS n FROM tile_snapshot_parts"), maxPartsPerTile: scalar(db, "SELECT coalesce(max(n),0) n FROM (SELECT count(*) n FROM tile_snapshot_parts GROUP BY tile_id)"), missingExistence, missingAttribution, unpublishedEvidence,
    tiers: db.prepare("SELECT evidence_quality,count(*) AS n FROM spots JOIN tile_snapshot_spots USING(spot_id) GROUP BY evidence_quality ORDER BY evidence_quality").all(),
    partsDigest: digestRows(db, "SELECT * FROM tile_snapshot_parts ORDER BY tile_id,part_index"),
    tileDigest: digestRows(db, "SELECT tile_id,revision,spot_count,content_sha256 FROM tile_snapshots ORDER BY tile_id"),
    publishedRowsDigest: digestRows(db, "SELECT s.* FROM spots s JOIN tile_snapshot_spots USING(spot_id) ORDER BY s.spot_id") };
}
const crossDigest = (db: DatabaseSync) => digestRows(db, "SELECT spot_a_id,spot_b_id,source_a_id,source_b_id,distance_m,reasons_json FROM cross_source_current_candidates ORDER BY spot_a_id,spot_b_id");

export async function runPromotionScale(options: PromotionScaleOptions): Promise<Record<string, unknown>> {
  if (Number(process.versions.node.split(".")[0]) < 24) throw Error("v4 scale benchmark requires Node >=24");
  assert.equal(COMMUNITY_PUBLICATION.state, "pending"); assert.equal(COMMUNITY_REGISTRY.publicationStatus, "blocked");
  mkdirSync(dirname(options.output), { recursive: true });
  const timingsMs: Record<string, number> = {}, memory: Record<string, ReturnType<typeof process.memoryUsage>> = {};
  const report: Record<string, unknown> = { version: "promotion-scale.v4", profile: options.profile,
    corpus: { version: CORPUS_VERSION, seed: CORPUS_SEED, sha256: corpusDigest(options.profile), spots: PROFILES[options.profile], reports: PROFILES[options.profile] * 5, official: 513 },
    environment: { runtime: process.version, database: "disk-backed local SQLite; not remote D1", peakRssUnit: "bytes; process.resourceUsage().maxRSS KiB converted to bytes" },
    publication: { productionDecision: COMMUNITY_PUBLICATION.state, source: COMMUNITY_REGISTRY.publicationStatus, simulationOnly: true }, timingsMs, memory, complete: false, sourceDatabase: options.output + "-source.sqlite" };
  function persist(): void { report.peakRssBytes = process.resourceUsage().maxRSS * 1024; writeFileSync(options.output + ".json", JSON.stringify(report, null, 2) + "\n"); }
  async function measure<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
    const start = performance.now(); try { return await operation(); } finally { timingsMs[name] = Math.round((performance.now() - start) * 100) / 100; memory[name] = process.memoryUsage(); report.lastPhase = name; persist(); process.stderr.write(`${options.profile}: ${name} ${timingsMs[name]} ms\n`); }
  }
  const source = openDisk(options.output + "-source.sqlite", false, options.resumeSource);
  const reports = options.resumeSource ? undefined : openDisk(options.output + "-reports.sqlite", true);
  const db = new SqliteD1(source);
  const simulated = { ...COMMUNITY_REGISTRY, publicationStatus: "approved" as const, attributionText: "TEST ONLY synthetic community attribution", licenseName: "TEST ONLY simulated report terms", licenseUrl: "https://example.invalid/report-terms" };
  const registry: PromotionRegistry = { source: (id) => id === COMMUNITY_SOURCE_ID ? simulated : reviewedSource(id), terms: (v) => ({ ...reviewedTerms(v), publicationRights: "granted" }) };
  try {
    if (!options.resumeSource) {
      await measure("officialImport", () => importAllReviewedSources(db, BENCHMARK_NOW));
      const loaded = await measure("corpusLoad", () => loadCommunityCorpus(db, new SqliteD1(reports!), options.profile, (n) => process.stderr.write(`${options.profile}: loaded ${n} spots\n`)));
      assert.equal(loaded.reports, PROFILES[options.profile] * 5);
      await measure("blockedPublish", () => publishTiles(db, { now: BENCHMARK_NOW })); assert.equal(scalar(source, "SELECT count(*) AS n FROM tile_snapshot_spots"), 513);
      source.prepare("UPDATE sources SET publication_status='approved',attribution_text=?,license_name=?,license_url=? WHERE source_id=?").run(simulated.attributionText, simulated.licenseName, simulated.licenseUrl, COMMUNITY_SOURCE_ID);
      source.prepare("UPDATE report_terms_versions SET publication_rights='granted' WHERE terms_version=?").run(CURRENT_REPORT_TERMS.version);
    } else assert.equal(scalar(source, "SELECT count(*) AS n FROM spots WHERE spot_id LIKE 'sp_Z%'"), PROFILES[options.profile]);
    await measure("publish", () => publishTiles(db, { now: BENCHMARK_NOW }));
    const before = await measure("qualityBefore", () => quality(source)); assert.equal(before.published, PROFILES[options.profile] + 513); report.qualityBefore = before;
    const cross = await measure("crossSourceBefore", () => generateCrossSourceCandidates(db, { now: BENCHMARK_NOW }));
    report.crossSourceBefore = { candidates: cross.length, digest: crossDigest(source), merges: scalar(source, "SELECT count(*) AS n FROM cross_source_merge_applications") };
    report.tileCapacity = source.prepare("SELECT tile_id,spot_count,length(CAST(body_json AS BLOB)) AS body_bytes FROM tile_snapshots ORDER BY body_bytes DESC LIMIT 10").all();
    const budgets = options.chunkBytes ? [options.chunkBytes] : options.profile === "small" ? [1, 4, 16].map((m) => m * 1024 * 1024) : [4 * 1024 * 1024];
    const artifacts: Record<string, unknown>[] = []; report.artifacts = artifacts;
    for (const chunkBytes of budgets) {
      const prefix = `${options.output}-${chunkBytes}`, directory = prefix + "-bundle";
      const entry: Record<string, unknown> = { chunkBytes, directory }; artifacts.push(entry);
      const buildStart = performance.now();
      let manifest;
      try { manifest = await measure(`build:${chunkBytes}`, () => exportPromotionV4(source, directory, { chunkBytes, registry })); }
      catch (error) { entry.refused = error instanceof Error ? error.message : String(error); report.capacityBlocked = true; persist(); break; }
      entry.artifactBytes = manifest.chunks.reduce((n, c) => n + c.bytes, manifest.finalize.bytes) + statSync(join(directory, "manifest.json")).size;
      entry.chunks = manifest.chunks.length; entry.digest = manifest.wholeBundleSha256;
      await measure(`verify:${chunkBytes}`, () => verifyPromotionV4(directory, manifest.wholeBundleSha256));
      const importDirectory = prefix + "-import-plan";
      const plan = await measure(`importPlanBuild:${chunkBytes}`, () => prepareV4ImportPlan(directory, manifest.wholeBundleSha256, importDirectory));
      await measure(`importPlanVerify:${chunkBytes}`, () => verifyV4ImportPlan(importDirectory, plan.wholePlanSha256, manifest.wholeBundleSha256));
      entry.importPlan = { files: plan.files.length, digest: plan.wholePlanSha256,
        artifactBytes: plan.files.reduce((n, f) => n + f.bytes, plan.sourceManifestFile.bytes) + statSync(join(importDirectory, "plan-manifest.json")).size };
      let maxStatementBytes = 0;
      await measure(`statementAndPrivacyAudit:${chunkBytes}`, async () => {
        for (const file of [...manifest.chunks, manifest.finalize]) for await (const sql of sqlStatements(join(directory, file.file))) {
          maxStatementBytes = Math.max(maxStatementBytes, Buffer.byteLength(sql));
          for (const token of [PRIVATE_SENTINEL, "submitter_hash", "claim_host_name", "claim_hours_note", "INSERT INTO reports", "INSERT INTO report_moderation"]) assert.ok(!sql.includes(token), `private data exported: ${token}`);
        }
      }); entry.maxStatementBytes = maxStatementBytes; entry.privateDataAbsent = true;
      const target = openDisk(prefix + "-target.sqlite");
      try {
        const bootstrapStart = performance.now();
        await measure(`initialize:${chunkBytes}`, () => applyPromotionV4(target, directory, manifest.wholeBundleSha256, { stopAfter: 0 }));
        const latencies: number[] = [];
        await measure(`apply:${chunkBytes}`, async () => { for (const chunk of manifest.chunks) { const start = performance.now(); assert.equal(await applyV4Chunk(target, directory, manifest.wholeBundleSha256, chunk.ordinal), "applied"); latencies.push(Math.round((performance.now() - start) * 100) / 100); } });
        await measure(`finalize:${chunkBytes}`, () => finalizePromotionV4(target, directory, manifest.wholeBundleSha256));
        assert.deepEqual(await promotionReadiness(new SqliteD1(target)), { schemaVersion: 1, state: "completed", completed: true });
        entry.readiness = "completed";
        entry.bootstrapMs = Math.round((performance.now() - bootstrapStart) * 100) / 100;
        entry.chunkApplyMs = latencies; entry.maxChunkApplyMs = Math.max(...latencies);
        const after = await measure(`qualityAfter:${chunkBytes}`, () => quality(target)); assert.deepEqual(after, before); entry.qualityAfter = after;
        const targetCross = await measure(`crossSourceAfter:${chunkBytes}`, () => generateCrossSourceCandidates(new SqliteD1(target), { now: BENCHMARK_NOW }));
        assert.equal(targetCross.length, cross.length); assert.equal(crossDigest(target), crossDigest(source)); entry.crossSourceAfter = { candidates: targetCross.length, digest: crossDigest(target) };
        const repeat = await measure(`repeat:${chunkBytes}`, () => exportPromotionV4(source, prefix + "-repeat", { chunkBytes, registry })); assert.equal(repeat.wholeBundleSha256, manifest.wholeBundleSha256); rmSync(prefix + "-repeat", { recursive: true });
        const reexport = await measure(`bootstrapReexport:${chunkBytes}`, () => exportPromotionV4(target, prefix + "-reexport", { chunkBytes, registry })); assert.equal(reexport.wholeBundleSha256, manifest.wholeBundleSha256); rmSync(prefix + "-reexport", { recursive: true }); entry.deterministic = true;
        entry.endToEndMs = Math.round((performance.now() - buildStart) * 100) / 100;
      } finally { target.close(); }
      persist();
    }
    report.complete = !report.capacityBlocked;
    source.exec("PRAGMA wal_checkpoint(TRUNCATE)"); reports?.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    report.sourceDatabaseBytes = statSync(options.output + "-source.sqlite").size;
    if (reports) report.reportsDatabaseBytes = statSync(options.output + "-reports.sqlite").size;
    persist(); return report;
  } catch (error) { report.error = error instanceof Error ? error.message : String(error); persist(); throw error; }
  finally { source.close(); reports?.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = promotionScaleOptions(process.argv.slice(2));
  const report = await runPromotionScale(options);
  process.stdout.write(JSON.stringify({ profile: options.profile, output: options.output + ".json", complete: report.complete, capacityBlocked: report.capacityBlocked, peakRssBytes: report.peakRssBytes }) + "\n");
}
