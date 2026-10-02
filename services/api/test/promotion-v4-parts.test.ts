// ADR-0015 canonical tile heads and bounded parts must survive GREEN promotion atomically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { verifyPromotionV4, sqlStatements } from "../scripts/promotion-v4-verify.ts";
import { applyPromotionV4, applyV4Chunk, finalizePromotionV4 } from "../scripts/promotion-v4-apply.ts";
import { D1_CAPACITY_POLICY } from "../scripts/promotion-v4-format.ts";
import { app } from "../src/app.ts";
import { promotionReadiness } from "../src/pipeline/promotion-readiness.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, migratedSqlite } from "./support/sqlite-d1.ts";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Row = Record<string, any>;
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "promotion-v4-parts-"));
  const source = new SqliteD1(), target = migratedSqlite();
  t.after(async () => { source.raw.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  await importTaito(source, { newSpotId: sequentialSpotIds() });
  // Larger reviewed display names exercise the real SQL-literal splitter without altering its policy.
  source.raw.prepare("UPDATE spots SET name=?").run("施設'".repeat(900));
  await publishTiles(source, { now: NOW });
  const directory = join(root, "bundle");
  const manifest = await exportPromotionV4(source.raw, directory, { chunkBytes: 90_000 });
  const tile = manifest.tiles.find(tile => tile.parts.length > 1);
  assert.ok(tile, "fixture must contain a real multipart tile");
  return { root, source, target, directory, manifest, tile, digest: manifest.wholeBundleSha256 };
}
async function unfinished(f: Awaited<ReturnType<typeof fixture>>) {
  await applyPromotionV4(f.target, f.directory, f.digest, { stopAfter: 0 });
  for (const chunk of f.manifest.chunks) await applyV4Chunk(f.target, f.directory, f.digest, chunk.ordinal);
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).state, "promotionIncomplete");
}

test("multipart v4 preserves canonical heads/parts, bounded INSERTs, deterministic roundtrip and readiness", async t => {
  const f = await fixture(t);
  assert.deepEqual(await verifyPromotionV4(f.directory, f.digest), f.manifest);
  for (const chunk of f.manifest.chunks) for await (const sql of sqlStatements(join(f.directory, chunk.file))) {
    assert.ok(Buffer.byteLength(sql) < D1_CAPACITY_POLICY.statementBytes);
  }
  await unfinished(f);
  const env = { DB: new SqliteD1(f.target) };
  assert.equal((await app.request("/v1/readiness", {}, env)).status, 503);
  assert.equal(await finalizePromotionV4(f.target, f.directory, f.digest), "completed");
  assert.equal((await app.request("/v1/readiness", {}, env)).status, 200);
  const path = `/v1/tiles/${f.tile.tileId}`;
  assert.equal((await app.request(path, {}, env)).status, 409);
  assert.equal((await app.request(`${path}/manifest`, {}, env)).status, 200);
  for (const part of f.tile.parts) assert.equal((await app.request(`${path}/parts/${part.partIndex}`, {}, env)).status, 200);
  const config = await (await app.request("/v1/config", {}, env)).json() as Record<string, any>;
  assert.equal(config.dataTileZoom, 14);
  assert.equal(config.schemaVersions.tile, 2);
  assert.equal(config.minimumSupportedSchemaVersions.tile, 1);
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).state, "completed");
  for (const table of ["tile_snapshots", "tile_snapshot_parts", "tile_snapshot_spots"]) {
    assert.deepEqual(f.target.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all(), f.source.raw.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all());
  }
  const repeat = join(f.root, "repeat");
  assert.deepEqual(await exportPromotionV4(f.target, repeat, { chunkBytes: 90_000 }), f.manifest);
  for (const entry of [...f.manifest.chunks, f.manifest.finalize]) assert.deepEqual(await readFile(join(repeat, entry.file)), await readFile(join(f.directory, entry.file)));
});

for (const failure of ["missing part", "extra part", "duplicate index", "part hash", "manifest only", "part only", "wrong tile id", "wrong revision", "wrong count", "incomplete membership"] as const) {
  test(`multipart v4 ${failure} cannot reach GREEN completion/readiness`, async t => {
    const f = await fixture(t);
    await unfinished(f);
    const tileId = f.tile.tileId;
    const part = f.target.prepare("SELECT * FROM tile_snapshot_parts WHERE tile_id=? ORDER BY part_index LIMIT 1").get(tileId) as Row;
    const head = f.target.prepare("SELECT * FROM tile_snapshots WHERE tile_id=?").get(tileId) as Row;
    if (failure === "missing part") f.target.prepare("DELETE FROM tile_snapshot_parts WHERE tile_id=? AND part_index=0").run(tileId);
    if (failure === "extra part") f.target.prepare("INSERT INTO tile_snapshot_parts VALUES (?,?,?,?,?)").run(tileId, f.tile.parts.length, part.content_sha256, part.spot_count, part.body_json);
    if (failure === "duplicate index") {
      assert.throws(() => f.target.prepare("INSERT INTO tile_snapshot_parts VALUES (?,?,?,?,?)").run(tileId, 0, part.content_sha256, part.spot_count, part.body_json), /UNIQUE/);
      assert.equal(f.target.prepare("SELECT 1 FROM promotion_v4_completions").get(), undefined);
      assert.equal((await promotionReadiness(new SqliteD1(f.target))).state, "promotionIncomplete");
      return;
    }
    if (failure === "part hash") f.target.prepare("UPDATE tile_snapshot_parts SET content_sha256=? WHERE tile_id=? AND part_index=0").run("0".repeat(64), tileId);
    if (failure === "manifest only" || failure === "wrong revision") {
      const body = JSON.parse(head.body_json); body.revision++;
      if (failure === "manifest only") body.parts[0].sha256 = "0".repeat(64);
      const json = JSON.stringify(body);
      f.target.prepare("UPDATE tile_snapshots SET body_json=?,content_sha256=?,revision=revision+1 WHERE tile_id=?").run(json, hash(json), tileId);
    }
    if (failure === "part only" || failure === "wrong tile id") {
      const body = JSON.parse(part.body_json);
      if (failure === "part only") body.spots[0].name = "tampered";
      else body.tile = "14/0/0";
      const json = JSON.stringify(body);
      f.target.prepare("UPDATE tile_snapshot_parts SET body_json=?,content_sha256=? WHERE tile_id=? AND part_index=0").run(json, hash(json), tileId);
    }
    if (failure === "wrong count") f.target.prepare("UPDATE tile_snapshot_parts SET spot_count=spot_count-1 WHERE tile_id=? AND part_index=0").run(tileId);
    if (failure === "incomplete membership") f.target.prepare("DELETE FROM tile_snapshot_spots WHERE tile_id=? AND spot_id=(SELECT spot_id FROM tile_snapshot_spots WHERE tile_id=? LIMIT 1)").run(tileId, tileId);
    await assert.rejects(finalizePromotionV4(f.target, f.directory, f.digest));
    assert.equal(f.target.prepare("SELECT 1 FROM promotion_v4_completions").get(), undefined);
    assert.equal(f.target.prepare("SELECT 1 FROM promotion_multi_bootstrap_completions").get(), undefined);
    assert.equal((await promotionReadiness(new SqliteD1(f.target))).state, "promotionIncomplete");
  });
}

test("v4 preserves republished empty schema-2 logical tiles without inventing parts", async t => {
  const f = await fixture(t);
  const closedIds = f.source.raw.prepare("SELECT spot_id FROM tile_snapshot_spots WHERE tile_id=?").all(f.tile.tileId) as { spot_id: string }[];
  f.source.raw.prepare("DELETE FROM tile_snapshot_spots WHERE tile_id=?").run(f.tile.tileId);
  for (const row of closedIds) f.source.raw.prepare("UPDATE spots SET lifecycle='temporarilyClosed' WHERE spot_id=?").run(row.spot_id);
  await publishTiles(f.source, { now: "2026-10-03T00:00:00Z" });
  const directory = join(f.root, "empty-tiles");
  const manifest = await exportPromotionV4(f.source.raw, directory, { chunkBytes: 90_000 });
  assert.ok(manifest.tiles.length > 0);
  const empty = manifest.tiles.find(tile => tile.tileId === f.tile.tileId);
  assert.ok(empty && empty.schemaVersion === 2 && empty.spotCount === 0 && empty.parts.length === 0);
  assert.ok(manifest.tiles.some(tile => tile.spotCount > 0));
  assert.deepEqual(await verifyPromotionV4(directory, manifest.wholeBundleSha256), manifest);
  assert.equal((await applyPromotionV4(f.target, directory, manifest.wholeBundleSha256)).status, "completed");
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).state, "completed");
  assert.equal((f.target.prepare("SELECT count(*) n FROM tile_snapshot_parts WHERE tile_id=?").get(f.tile.tileId) as { n: number }).n, 0);
  assert.deepEqual(f.target.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all(), f.source.raw.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all());
});

test("v4 refuses a consistently rehashed multipart body that disagrees with canonical spots", async t => {
  const f = await fixture(t);
  const tileId = f.tile.tileId;
  const part = f.source.raw.prepare("SELECT * FROM tile_snapshot_parts WHERE tile_id=? AND part_index=0").get(tileId) as Row;
  const head = f.source.raw.prepare("SELECT * FROM tile_snapshots WHERE tile_id=?").get(tileId) as Row;
  const body = JSON.parse(part.body_json); body.spots[0].latitude += 0.00001;
  const partJson = JSON.stringify(body), partHash = hash(partJson);
  f.source.raw.prepare("UPDATE tile_snapshot_parts SET body_json=?,content_sha256=? WHERE tile_id=? AND part_index=0").run(partJson, partHash, tileId);
  const manifestBody = JSON.parse(head.body_json); manifestBody.parts[0].sha256 = partHash; manifestBody.revision++;
  const headJson = JSON.stringify(manifestBody);
  f.source.raw.prepare("UPDATE tile_snapshots SET body_json=?,content_sha256=?,revision=revision+1 WHERE tile_id=?").run(headJson, hash(headJson), tileId);
  await assert.rejects(exportPromotionV4(f.source.raw, join(f.root, "invalid-canonical"), { chunkBytes: 90_000 }));
  assert.equal(f.target.prepare("SELECT 1 FROM promotion_v4_completions").get(), undefined);
});
