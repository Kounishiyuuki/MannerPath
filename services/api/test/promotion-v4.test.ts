import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { verifyPromotionV4, sqlStatements, insertTable } from "../scripts/promotion-v4-verify.ts";
import { applyPromotionV4, applyV4Chunk, finalizePromotionV4, nextUnappliedChunk } from "../scripts/promotion-v4-apply.ts";
import { canonicalManifestDigest, D1_CAPACITY_POLICY, type PromotionV4Manifest } from "../scripts/promotion-v4-format.ts";
import { promotionReadiness } from "../src/pipeline/promotion-readiness.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { CURRENT_REPORT_TERMS, reviewedTerms } from "../src/reports/terms.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import type { PromotionRegistry } from "../src/pipeline/promotion.ts";
import { BENCHMARK_NOW, loadCommunityCorpus } from "../scripts/scale/load.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { SqliteD1, migratedSqlite, reportsD1 } from "./support/sqlite-d1.ts";

async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "promotion-v4-test-"));
  const directory = join(root, "bundle");
  const source = new SqliteD1();
  const target = migratedSqlite();
  t.after(async () => { source.raw.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  await importTaito(source, { newSpotId: sequentialSpotIds() });
  await publishTiles(source, { now: NOW });
  const manifest = await exportPromotionV4(source.raw, directory, { chunkBytes: 90_000 });
  return { directory, source, target, manifest, digest: manifest.wholeBundleSha256 };
}
async function sign(directory: string, manifest: PromotionV4Manifest) {
  manifest.wholeBundleSha256 = canonicalManifestDigest(manifest);
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  return manifest.wholeBundleSha256;
}
function completions(db: ReturnType<typeof migratedSqlite>) {
  return (db.prepare("SELECT count(*) AS n FROM promotion_v4_completions").get() as { n: number }).n;
}

test("v4 is deterministic, statement-budgeted and carries only approved public tables", async t => {
  const f = await fixture(t);
  const repeatRoot = await mkdtemp(join(tmpdir(), "promotion-v4-repeat-"));
  const other = join(repeatRoot, "bundle");
  t.after(() => rm(repeatRoot, { recursive: true, force: true }));
  const second = await exportPromotionV4(f.source.raw, other, { chunkBytes: 90_000 });
  assert.deepEqual(second, f.manifest);
  assert.deepEqual(await verifyPromotionV4(f.directory, f.digest), f.manifest);
  assert.ok(f.manifest.chunks.length > 1);
  for (const chunk of [...f.manifest.chunks, f.manifest.finalize]) {
    assert.deepEqual(await readFile(join(f.directory, chunk.file)), await readFile(join(other, chunk.file)));
    for await (const sql of sqlStatements(join(f.directory, chunk.file))) {
      assert.ok(Buffer.byteLength(sql) <= D1_CAPACITY_POLICY.statementBytes);
      assert.doesNotMatch(sql, /INSERT INTO (?:reports|report_rate_counters|report_moderation|app_attest)\b/);
    }
  }
});

test("v4 release selection refuses duplicate and invalid IDs before writing", async t => {
  const f = await fixture(t);
  for (const ids of [[1, 1], [0], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
    await assert.rejects(exportPromotionV4(f.source.raw, join(f.directory, "invalid"), { chunkBytes: 90_000, releaseIds: ids }), /unique positive safe integers/);
  }
});

test("v4 resumes partial GREEN, refuses out-of-order, and safely replays completion", async t => {
  const f = await fixture(t);
  assert.deepEqual(await applyPromotionV4(f.target, f.directory, f.digest, { stopAfter: 1 }), { status: "unfinished", nextChunk: 2 });
  assert.equal(completions(f.target), 0);
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).state, "promotionIncomplete");
  await assert.rejects(finalizePromotionV4(f.target, f.directory, f.digest), /missing chunk/);
  assert.equal(await applyV4Chunk(f.target, f.directory, f.digest, 1), "alreadyApplied");
  if (f.manifest.chunks.length > 2) await assert.rejects(applyV4Chunk(f.target, f.directory, f.digest, 3), /out-of-order/);
  assert.equal(nextUnappliedChunk(f.target, f.digest), 2);
  assert.equal((await applyPromotionV4(f.target, f.directory, f.digest)).status, "completed");
  assert.equal(nextUnappliedChunk(f.target, f.digest), null);
  const snapshot = f.target.prepare("SELECT * FROM promotion_v4_completions").all();
  assert.equal((await applyPromotionV4(f.target, f.directory, f.digest)).status, "alreadyCompleted");
  assert.deepEqual(f.target.prepare("SELECT * FROM promotion_v4_completions").all(), snapshot);
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, true);
});

for (const failure of ["missing", "corrupted", "truncated", "stale"] as const) {
  test(`v4 ${failure} artifact fails before GREEN mutation`, async t => {
    const f = await fixture(t);
    const path = join(f.directory, f.manifest.chunks[0].file);
    if (failure === "missing") await rm(path);
    if (failure === "corrupted") {
      const text = await readFile(path, "utf8");
      await writeFile(path, text.replace("INSERT", "INSERX"));
    }
    if (failure === "truncated") await writeFile(path, (await readFile(path)).subarray(0, 100));
    if (failure === "stale") {
      f.manifest.capacityPolicy = "d1-capacity.obsolete";
      await sign(f.directory, f.manifest);
    }
    await assert.rejects(applyPromotionV4(f.target, f.directory, f.digest));
    assert.equal(completions(f.target), 0);
    assert.equal((f.target.prepare("SELECT count(*) AS n FROM promotion_v4_manifests").get() as { n: number }).n, 0);
  });
}

for (const failure of ["source", "release", "tile", "count", "attribution", "observation", "duplicateSource", "maliciousTileRevision"] as const) {
  test(`v4 re-signed wrong ${failure} declaration cannot finalize`, async t => {
    const f = await fixture(t);
    if (failure === "source") f.manifest.sources[0].sourceId = "unapproved-source";
    if (failure === "release") f.manifest.sources[0].releaseContentSha256 = "0".repeat(64);
    if (failure === "tile") f.manifest.tiles[0].contentSha256 = "0".repeat(64);
    if (failure === "count") f.manifest.rows.spots++;
    if (failure === "attribution") f.manifest.sources[0].attributionText = "wrong attribution";
    if (failure === "observation") f.manifest.sources[0].observedOn = "2000-01-01";
    if (failure === "duplicateSource") f.manifest.sources.push(structuredClone(f.manifest.sources[0]));
    if (failure === "maliciousTileRevision") (f.manifest.tiles[0] as unknown as { revision: string }).revision = "1); DROP TABLE spots; --";
    const digest = await sign(f.directory, f.manifest);
    await assert.rejects(applyPromotionV4(f.target, f.directory, digest));
    assert.equal(completions(f.target), 0);
    assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, false);
  });
}

test("v4 same ordinal with different receipt digest and wrong manifest refuse", async t => {
  const f = await fixture(t);
  await applyPromotionV4(f.target, f.directory, f.digest, { stopAfter: 1 });
  assert.throws(() => f.target.prepare("UPDATE promotion_v4_applied_chunks SET sha256=? WHERE ordinal=1").run("0".repeat(64)), /immutable/);
  f.manifest.chunks[0].sha256 = "0".repeat(64);
  const differentDigest = await sign(f.directory, f.manifest);
  await assert.rejects(applyV4Chunk(f.target, f.directory, differentDigest, 1));
  await assert.rejects(applyV4Chunk(f.target, f.directory, "0".repeat(64), 1), /manifest/);
  assert.throws(() => nextUnappliedChunk(f.target, "0".repeat(64)), /manifest/);
  assert.equal(completions(f.target), 0);
});

test("v4 re-signed private-table SQL is rejected before apply", async t => {
  const f = await fixture(t);
  const chunk = f.manifest.chunks[0];
  const bytes = Buffer.from("INSERT INTO reports (report_id) VALUES ('private');\n");
  await writeFile(join(f.directory, chunk.file), bytes);
  chunk.bytes = bytes.length;
  chunk.sha256 = createHash("sha256").update(bytes).digest("hex");
  chunk.statements = 1;
  const digest = await sign(f.directory, f.manifest);
  await assert.rejects(applyPromotionV4(f.target, f.directory, digest), /SQL shape\/table\/columns/);
  assert.equal(completions(f.target), 0);
});

test("v4 failed chunk transaction leaves no payload or receipt and can resume", async t => {
  const f = await fixture(t);
  await applyPromotionV4(f.target, f.directory, f.digest, { stopAfter: 1 });
  const statements: string[] = [];
  for await (const sql of sqlStatements(join(f.directory, f.manifest.chunks[1].file))) statements.push(sql);
  const failingTable = insertTable(statements.at(-1)!);
  const rowsBefore = f.target.prepare(`SELECT count(*) AS n FROM ${failingTable}`).get();
  const chunksBefore = f.target.prepare("SELECT * FROM promotion_v4_applied_chunks ORDER BY ordinal").all();
  f.target.exec(`CREATE TEMP TRIGGER fail_chunk BEFORE INSERT ON ${failingTable} BEGIN SELECT RAISE(ABORT, 'injected partial import'); END;`);
  await assert.rejects(applyV4Chunk(f.target, f.directory, f.digest, 2), /injected partial import/);
  assert.deepEqual(f.target.prepare(`SELECT count(*) AS n FROM ${failingTable}`).get(), rowsBefore);
  assert.deepEqual(f.target.prepare("SELECT * FROM promotion_v4_applied_chunks ORDER BY ordinal").all(), chunksBefore);
  assert.equal(nextUnappliedChunk(f.target, f.digest), 2);
  assert.equal(completions(f.target), 0);
  f.target.exec("DROP TRIGGER fail_chunk;");
  assert.equal((await applyPromotionV4(f.target, f.directory, f.digest)).status, "completed");
});

test("v4 parser respects escaped quotes, Unicode, semicolons and stream boundaries", async t => {
  const root = await mkdtemp(join(tmpdir(), "promotion-v4-parser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "parser.sql");
  const sql = `INSERT INTO example (value) VALUES ('${"あ".repeat(5500)}'';\nquoted');`;
  await writeFile(path, `${sql}\nINSERT INTO example (value) VALUES ('next');\n`);
  const found: string[] = [];
  for await (const statement of sqlStatements(path)) found.push(statement);
  assert.deepEqual(found, [sql, "INSERT INTO example (value) VALUES ('next');"]);
  await writeFile(path, `INSERT INTO example (value) VALUES ('${"あ".repeat(31000)}');`);
  await assert.rejects(async () => { for await (const _ of sqlStatements(path)) { /* consume stream */ } }, /capacity policy/);
});

test("v4 bootstraps the existing six-source 513-spot corpus and deterministically re-exports", async t => {
  const root = await mkdtemp(join(tmpdir(), "promotion-v4-six-source-"));
  const source = new SqliteD1(), target = migratedSqlite();
  t.after(async () => { source.raw.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  await importAllReviewedSources(source, NOW);
  await publishTiles(source, { now: NOW });
  const directory = join(root, "bundle");
  const manifest = await exportPromotionV4(source.raw, directory, { chunkBytes: 90_000 });
  assert.equal(manifest.sources.length, 6);
  assert.equal(manifest.rows.tile_snapshot_spots, 513);
  assert.equal((await applyPromotionV4(target, directory, manifest.wholeBundleSha256)).status, "completed");
  assert.equal((target.prepare("SELECT count(*) n FROM tile_snapshot_spots").get() as { n: number }).n, 513);
  const reexport = await exportPromotionV4(target, join(root, "reexport"), { chunkBytes: 90_000 });
  assert.deepEqual(reexport, manifest);
});

test("v4 carries reviewed cross-release decisions and re-exports their attestations", async t => {
  const root = await mkdtemp(join(tmpdir(), "promotion-v4-reviewed-"));
  const source = new SqliteD1(), target = migratedSqlite();
  t.after(async () => { source.raw.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  const adapter: SourceAdapter = { ...TAITO_ADAPTER, assertResolvable: () => {}, attenuate: () => [], crossReleaseValidated: true };
  await ensureReviewedSource(source, TAITO_SOURCE_ID, NOW);
  const first = await ingestRelease(source, adapter, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(source, adapter, first.releaseId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  const prior = source.raw.prepare(`SELECT source_entity_id FROM source_record_entities WHERE record_id =
    (SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = 1)`).get(first.releaseId) as { source_entity_id: number };
  const lines = new TextDecoder().decode(TAITO_BYTES).split("\r\n");
  const noRef = lines[1].replace(/^[^,]*/, "");
  const duplicate = new TextEncoder().encode([lines[0], noRef, noRef, ...lines.slice(2)].join("\r\n"));
  const second = await ingestRelease(source, adapter, duplicate, { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" });
  const later = "2026-09-26T03:00:00Z";
  const pending = await resolveFirstRelease(source, adapter, second.releaseId, { now: later, newSpotId: sequentialSpotIds("B") });
  assert.equal(pending.status, "needsReview");
  if (pending.status !== "needsReview") throw new Error("fixture requires review");
  for (const [i, reviewItemId] of pending.reviewItemIds.entries()) {
    await recordReviewDecision(source, { reviewItemId, decision: i === 0 ? "matchedToEntity" : "confirmedNew", decidedBy: "test-reviewer", decidedAt: later,
      sourceEntityId: i === 0 ? prior.source_entity_id : undefined });
  }
  assert.equal((await resolveFirstRelease(source, adapter, second.releaseId, { now: later, newSpotId: sequentialSpotIds("B") })).status, "resolved");
  await publishTiles(source, { now: later });
  const directory = join(root, "bundle");
  const manifest = await exportPromotionV4(source.raw, directory, { chunkBytes: 90_000 });
  assert.equal(manifest.rows.promotion_review_match_attestations, 2);
  assert.equal(manifest.sources[0].reviewDependencies.length, 2);
  await applyPromotionV4(target, directory, manifest.wholeBundleSha256);
  assert.deepEqual(target.prepare("SELECT decision, source_entity_id FROM promotion_review_match_attestations ORDER BY record_id").all(),
    source.raw.prepare("SELECT decision, source_entity_id FROM review_match_applications ORDER BY record_id").all());
  assert.equal((target.prepare("SELECT count(*) n FROM review_items").get() as { n: number }).n, 0);
  assert.deepEqual(await exportPromotionV4(target, join(root, "reexport"), { chunkBytes: 90_000 }), manifest);
});

test("v4 oversized row refuses export and removes unfinished artifact directory", async t => {
  const f = await fixture(t);
  const output = join(f.directory, "oversized");
  f.source.raw.prepare("UPDATE spots SET entrance_note=? WHERE spot_id=(SELECT min(spot_id) FROM spots WHERE publication_hold IS NULL AND lifecycle='active')")
    .run(JSON.stringify({ oversized: "あ".repeat(31_000) }));
  await assert.rejects(exportPromotionV4(f.source.raw, output, { chunkBytes: 90_000 }), /statement exceeds|capacity/);
  await assert.rejects(stat(output), { code: "ENOENT" });
  await assert.rejects(stat(join(output, "manifest.json")), { code: "ENOENT" });
});

test("v4 additive community releases require the exact declared set", async t => {
  const root = await mkdtemp(join(tmpdir(), "promotion-v4-additive-"));
  const source = new SqliteD1(), reports = reportsD1(), goodTarget = migratedSqlite(), badTarget = migratedSqlite();
  t.after(async () => { source.raw.close(); reports.raw.close(); goodTarget.close(); badTarget.close(); await rm(root, { recursive: true, force: true }); });
  // Explicitly isolated test simulation: production community remains blocked and terms pending.
  await loadCommunityCorpus(source, reports, "small");
  const simulated = { ...COMMUNITY_REGISTRY, publicationStatus: "approved" as const, attributionText: "TEST ONLY synthetic community attribution",
    licenseName: "TEST ONLY simulated report terms", licenseUrl: "https://example.invalid/report-terms" };
  const registry: PromotionRegistry = { source: id => id === COMMUNITY_SOURCE_ID ? simulated : reviewedSource(id),
    terms: version => ({ ...reviewedTerms(version), publicationRights: "granted" }) };
  source.raw.prepare("UPDATE sources SET publication_status='approved', attribution_text=?, license_name=?, license_url=? WHERE source_id=?")
    .run(simulated.attributionText, simulated.licenseName, simulated.licenseUrl, COMMUNITY_SOURCE_ID);
  source.raw.prepare("UPDATE report_terms_versions SET publication_rights='granted' WHERE terms_version=?").run(CURRENT_REPORT_TERMS.version);
  await publishTiles(source, { now: BENCHMARK_NOW });
  const directory = join(root, "bundle");
  const manifest = await exportPromotionV4(source.raw, directory, { chunkBytes: 90_000, registry });
  const community = manifest.sources.find(s => s.sourceId === COMMUNITY_SOURCE_ID)!;
  assert.ok(community.additiveReleases!.length > 1);
  assert.equal((await applyPromotionV4(goodTarget, directory, manifest.wholeBundleSha256)).status, "completed");
  community.additiveReleases = community.additiveReleases!.slice(0, -1);
  const digest = await sign(directory, manifest);
  await assert.rejects(applyPromotionV4(badTarget, directory, digest), /additive declaration set mismatch/);
  assert.equal(completions(badTarget), 0);
  assert.equal((await promotionReadiness(new SqliteD1(badTarget))).completed, false);
});
