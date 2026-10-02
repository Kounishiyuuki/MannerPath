import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepareV4ImportPlan, verifyV4ImportPlan, importPlanDigest } from "../scripts/promotion-v4-import-plan.ts";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { nextUnappliedChunk } from "../scripts/promotion-v4-apply.ts";
import { promotionReadiness } from "../src/pipeline/promotion-readiness.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { SqliteD1, migratedSqlite, applyPromotionBundle } from "./support/sqlite-d1.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { canonicalManifestDigest } from "../scripts/promotion-v4-format.ts";

async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "promotion-import-plan-"));
  const source = new SqliteD1(), target = migratedSqlite();
  t.after(async () => { source.raw.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  await importTaito(source, { newSpotId: sequentialSpotIds() }); await publishTiles(source, { now: NOW });
  const bundle = join(root, "bundle"), planDir = join(root, "plan");
  const manifest = await exportPromotionV4(source.raw, bundle, { chunkBytes: 90_000 });
  const plan = await prepareV4ImportPlan(bundle, manifest.wholeBundleSha256, planDir);
  return { root, source, target, bundle, manifest, planDir, plan };
}

test("D1 import plan is deterministic and atomically stages, resumes and seals GREEN", async t => {
  const f = await fixture(t), digest = f.manifest.wholeBundleSha256;
  const repeatDir = join(f.root, "repeat");
  const repeated = await prepareV4ImportPlan(f.bundle, digest, repeatDir); assert.deepEqual(repeated, f.plan);
  assert.deepEqual(await verifyV4ImportPlan(f.planDir, f.plan.wholePlanSha256, digest), f.plan);
  for (const file of f.plan.files) {
    assert.deepEqual(await readFile(join(f.planDir, file.file)), await readFile(join(repeatDir, file.file)));
    assert.doesNotMatch(await readFile(join(f.planDir, file.file), "utf8"), /\b(?:BEGIN|COMMIT)\b/);
  }
  const apply = async (file: string) => applyPromotionBundle(f.target, await readFile(join(f.planDir, file), "utf8"));
  await apply("initialize.sql"); await apply(f.manifest.chunks[0].file);
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, false);
  assert.equal(nextUnappliedChunk(f.target, digest), 2);
  const countsBefore = f.target.prepare("SELECT count(*) AS n FROM promotion_v4_applied_chunks").get();
  await assert.rejects(() => apply(f.manifest.chunks[0].file));
  assert.deepEqual(f.target.prepare("SELECT count(*) AS n FROM promotion_v4_applied_chunks").get(), countsBefore);
  await assert.rejects(() => apply("finalize.sql"));
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, false);
  for (const c of f.manifest.chunks.slice(1)) await apply(c.file);
  await apply("finalize.sql");
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, true);
  assert.equal(nextUnappliedChunk(f.target, digest), null);
  assert.deepEqual(f.target.prepare("SELECT tile_id,content_sha256 FROM tile_snapshots ORDER BY tile_id").all(), f.source.raw.prepare("SELECT tile_id,content_sha256 FROM tile_snapshots ORDER BY tile_id").all());
  await assert.rejects(() => apply("finalize.sql")); await assert.rejects(() => apply(f.manifest.chunks.at(-1)!.file));
  assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, true);
});

for (const wrong of ["source", "release", "observation", "count", "attribution", "tile"] as const) {
  test(`D1 import plan DB finalization refuses a re-signed wrong ${wrong}`, async t => {
    const f = await fixture(t);
    if (wrong === "source") f.manifest.sources[0].sourceId = "wrong-source";
    if (wrong === "release") f.manifest.sources[0].releaseContentSha256 = "0".repeat(64);
    if (wrong === "observation") f.manifest.sources[0].observedOn = "2020-01-01";
    if (wrong === "count") f.manifest.sources[0].rows.source_records++;
    if (wrong === "attribution") f.manifest.sources[0].attributionText = "wrong attribution";
    if (wrong === "tile") f.manifest.tiles[0].contentSha256 = "0".repeat(64);
    f.manifest.wholeBundleSha256 = canonicalManifestDigest(f.manifest);
    await writeFile(join(f.bundle, "manifest.json"), JSON.stringify(f.manifest));
    const directory = join(f.root, "wrong-plan");
    const plan = await prepareV4ImportPlan(f.bundle, f.manifest.wholeBundleSha256, directory);
    await verifyV4ImportPlan(directory, plan.wholePlanSha256, f.manifest.wholeBundleSha256);
    for (const file of plan.files.slice(0, -1)) applyPromotionBundle(f.target, await readFile(join(directory, file.file), "utf8"));
    const finalSql = await readFile(join(directory, "finalize.sql"), "utf8");
    assert.throws(() => applyPromotionBundle(f.target, finalSql), /v4 final state is incomplete/);
    assert.equal((await promotionReadiness(new SqliteD1(f.target))).completed, false);
  });
}

test("import plan verifier pins both digests, copied source bytes and exact wrappers", async t => {
  const f = await fixture(t), digest = f.manifest.wholeBundleSha256;
  await assert.rejects(() => verifyV4ImportPlan(f.planDir, "0".repeat(64), digest));
  await assert.rejects(() => verifyV4ImportPlan(f.planDir, f.plan.wholePlanSha256, "0".repeat(64)));
  const first = f.plan.files[1], path = join(f.planDir, first.file);
  const original = await readFile(path, "utf8");
  const edited = original.replace("promotion_v4_applied_chunks", "promotion_v4_expected_chunks");
  await writeFile(path, edited);
  await assert.rejects(() => verifyV4ImportPlan(f.planDir, f.plan.wholePlanSha256, digest));
  // Even a newly signed file/plan cannot alter the reviewed source payload or wrappers.
  first.bytes = Buffer.byteLength(edited); first.sha256 = createHash("sha256").update(edited).digest("hex");
  f.plan.wholePlanSha256 = importPlanDigest(f.plan);
  await writeFile(join(f.planDir, "plan-manifest.json"), JSON.stringify(f.plan));
  await assert.rejects(() => verifyV4ImportPlan(f.planDir, f.plan.wholePlanSha256, digest));
  const alteredPayload = original.replace("promotion-bundle.v3", "promotion-bundle.v2");
  assert.notEqual(alteredPayload, original);
  await writeFile(path, alteredPayload);
  first.bytes = Buffer.byteLength(alteredPayload); first.sha256 = createHash("sha256").update(alteredPayload).digest("hex");
  f.plan.wholePlanSha256 = importPlanDigest(f.plan);
  await writeFile(join(f.planDir, "plan-manifest.json"), JSON.stringify(f.plan));
  await assert.rejects(() => verifyV4ImportPlan(f.planDir, f.plan.wholePlanSha256, digest), /copied payload hash differs/);
  await assert.rejects(() => prepareV4ImportPlan(f.bundle, digest, f.planDir));
  assert.ok(await readFile(join(f.planDir, "plan-manifest.json")));
});
