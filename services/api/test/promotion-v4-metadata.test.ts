import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalManifestDigest, TILE_METADATA_MAX_BYTES, type PromotionV4Manifest, type V4Tile } from "../scripts/promotion-v4-format.ts";
import { TileMetadataWriter, iterateV4Tiles } from "../scripts/promotion-v4-metadata.ts";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { verifyPromotionV4 } from "../scripts/promotion-v4-verify.ts";
import { applyPromotionV4, finalizePromotionV4 } from "../scripts/promotion-v4-apply.ts";
import { prepareV4ImportPlan, verifyV4ImportPlan } from "../scripts/promotion-v4-import-plan.ts";
import { SqliteD1, migratedSqlite, applyPromotionBundle } from "./support/sqlite-d1.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { promotionReadiness } from "../src/pipeline/promotion-readiness.ts";

async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "promotion-metadata-test-"));
  const source = new SqliteD1(), target = migratedSqlite();
  t.after(async () => { source.raw.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  await importTaito(source, { newSpotId: sequentialSpotIds() }); await publishTiles(source, { now: NOW });
  const directory = join(root, "bundle");
  const manifest = await exportPromotionV4(source.raw, directory, { chunkBytes: 90_000, tileMetadata: "segmented" });
  return { root, source, target, directory, manifest };
}
async function sign(directory: string, manifest: PromotionV4Manifest) {
  manifest.wholeBundleSha256 = canonicalManifestDigest(manifest);
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
}
async function split(f: Awaited<ReturnType<typeof fixture>>) {
  const tiles: V4Tile[] = [];
  for await (const tile of iterateV4Tiles(f.directory, f.manifest)) tiles.push(tile);
  assert.ok(tiles.length > 1);
  for (const shard of f.manifest.tileDeclarations!.shards) await rm(join(f.directory, shard.file));
  const metadata = f.manifest.tileDeclarations!;
  metadata.shards = [];
  for (const group of [tiles.slice(0, 1), tiles.slice(1)]) {
    const bytes = Buffer.from(canonicalJson(group) + "\n"), sha256 = createHash("sha256").update(bytes).digest("hex"), file = `tile-metadata-${sha256}.json`;
    await writeFile(join(f.directory, file), bytes);
    metadata.shards.push({ ordinal: metadata.shards.length + 1, file, sha256, bytes: bytes.length, tileCount: group.length,
      partCount: group.reduce((n,t) => n+t.parts.length, 0), firstTileId: group[0].tileId, lastTileId: group.at(-1)!.tileId });
  }
  await sign(f.directory, f.manifest);
}

test("metadata writer crosses fixed budget deterministically without enlarging inline manifests", async t => {
  const directory = await mkdtemp(join(tmpdir(), "metadata-writer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writer = new TileMetadataWriter(directory);
  const tiles: V4Tile[] = Array.from({ length: 12_000 }, (_, i) => ({ tileId: `14/${String(i).padStart(5, "0")}/0`, revision: 1, spotCount: 1,
    contentSha256: "a".repeat(64), schemaVersion: 1, parts: [] }));
  for (const tile of tiles) writer.add(tile);
  const result = writer.finish();
  assert.equal(result.tiles.length, 0); assert.ok(result.tileDeclarations!.shards.length >= 2);
  assert.equal(result.tileDeclarations!.tileCount, tiles.length);
  for (const shard of result.tileDeclarations!.shards) assert.ok(shard.bytes <= TILE_METADATA_MAX_BYTES);
  const manifest = { ...result, rows: { tile_snapshots: tiles.length, tile_snapshot_parts: 0 } } as PromotionV4Manifest;
  const actual: V4Tile[] = [];
  for await (const tile of iterateV4Tiles(directory, manifest)) actual.push(tile);
  assert.deepEqual(actual, tiles);
});

test("segmented metadata deterministic verify/apply/finalize and bounded import-plan roundtrip", async t => {
  const f = await fixture(t), digest = f.manifest.wholeBundleSha256;
  assert.deepEqual(f.manifest.tiles, []); assert.ok(f.manifest.tileDeclarations);
  const repeated = await exportPromotionV4(f.source.raw, join(f.root, "repeat"), { chunkBytes: 90_000, tileMetadata: "segmented" });
  assert.deepEqual(repeated, f.manifest);
  assert.deepEqual(await verifyPromotionV4(f.directory, digest), f.manifest);
  await applyPromotionV4(f.target, f.directory, digest, { stopAfter: 1 });
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, false);
  await assert.rejects(finalizePromotionV4(f.target, f.directory, digest), /missing chunk/);
  await applyPromotionV4(f.target, f.directory, digest);
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, true);
  const planDir = join(f.root, "plan"), plan = await prepareV4ImportPlan(f.directory, digest, planDir);
  await verifyV4ImportPlan(planDir, plan.wholePlanSha256, digest);
  assert.match(plan.files[0].file, /^initialize-0001.sql$/);
  for (const file of plan.files.filter(f => f.file.startsWith("initialize-"))) assert.ok(file.bytes <= f.manifest.chunkTargetBytes);
  const green = migratedSqlite(); t.after(() => green.close());
  for (const file of plan.files.slice(0, -1)) applyPromotionBundle(green, await readFile(join(planDir, file.file), "utf8"));
  assert.equal((await promotionReadiness(new SqliteD1(green))).completed, false);
  applyPromotionBundle(green, await readFile(join(planDir, "finalize.sql"), "utf8"));
  assert.equal((await promotionReadiness(new SqliteD1(green))).completed, true);
  await rm(join(planDir, f.manifest.tileDeclarations!.shards[0].file));
  await assert.rejects(verifyV4ImportPlan(planDir, plan.wholePlanSha256, digest));
});

for (const failure of ["missing", "duplicate", "reordered", "modified", "wrongDigest", "extra", "tileCount", "partCount"] as const) {
  test(`metadata ${failure} fails preflight and cannot seal partially imported GREEN`, async t => {
    const f = await fixture(t); await split(f);
    const originalDigest = f.manifest.wholeBundleSha256;
    await applyPromotionV4(f.target, f.directory, originalDigest, { stopAfter: 1 });
    const metadata = f.manifest.tileDeclarations!, shard = metadata.shards[0];
    if (failure === "missing") await rm(join(f.directory, shard.file));
    if (failure === "duplicate") metadata.shards.push({ ...shard, ordinal: 3 });
    if (failure === "reordered") metadata.shards.reverse();
    if (failure === "modified") await writeFile(join(f.directory, shard.file), "[]\n");
    if (failure === "wrongDigest") shard.sha256 = "0".repeat(64);
    if (failure === "extra") await writeFile(join(f.directory, "tile-metadata-extra.json"), "[]\n");
    if (failure === "tileCount") shard.tileCount++;
    if (failure === "partCount") shard.partCount++;
    await sign(f.directory, f.manifest);
    await assert.rejects(verifyPromotionV4(f.directory, f.manifest.wholeBundleSha256));
    await assert.rejects(finalizePromotionV4(f.target, f.directory, f.manifest.wholeBundleSha256));
    assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, false);
    const fresh = migratedSqlite(); t.after(() => fresh.close());
    await assert.rejects(applyPromotionV4(fresh, f.directory, f.manifest.wholeBundleSha256));
    assert.equal((fresh.prepare("SELECT count(*) AS n FROM promotion_v4_manifests").get() as { n: number }).n, 0);
  });
}

test("missing initialization segment cannot complete even after every payload chunk is imported", async t => {
  const f = await fixture(t), digest = f.manifest.wholeBundleSha256;
  const planDir = join(f.root, "plan"), plan = await prepareV4ImportPlan(f.directory, digest, planDir);
  const init = await readFile(join(planDir, plan.files[0].file), "utf8");
  const splitAt = init.indexOf("INSERT INTO promotion_v4_expected_tiles");
  assert.ok(splitAt > 0);
  // Transport boundaries may move without altering the ordered initialization statements.
  const pieces = [init.slice(0, splitAt), init.slice(splitAt)];
  const declarations = [];
  for (const [i, body] of pieces.entries()) {
    const file = `initialize-${String(i + 1).padStart(4, "0")}.sql`;
    await writeFile(join(planDir, file), body);
    declarations.push({ file, sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body), statements: body.trim().split("\n").length });
  }
  plan.files.splice(0, 1, ...declarations);
  const { importPlanDigest } = await import("../scripts/promotion-v4-import-plan.ts");
  plan.wholePlanSha256 = importPlanDigest(plan);
  await writeFile(join(planDir, "plan-manifest.json"), JSON.stringify(plan));
  await verifyV4ImportPlan(planDir, plan.wholePlanSha256, digest);
  applyPromotionBundle(f.target, pieces[0]);
  for (const chunk of f.manifest.chunks) applyPromotionBundle(f.target, await readFile(join(planDir, chunk.file), "utf8"));
  const finalize = await readFile(join(planDir, "finalize.sql"), "utf8");
  assert.throws(() => applyPromotionBundle(f.target, finalize), /v4 final state is incomplete/);
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, false);
});
