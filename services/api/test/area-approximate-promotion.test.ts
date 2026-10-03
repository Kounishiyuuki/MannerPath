// ADR-0017 promotion matrix: every legitimate location state of an area-anchored spot round-trips through promotion
// v2, v3 and v4 (build -> verify -> import plan -> fresh GREEN -> readiness -> quality -> republish -> deterministic
// re-export), including an anchor whose publication is an earlier release than the one being promoted. Tampered state
// is refused at export or at import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { verifyPromotionV4 } from "../scripts/promotion-v4-verify.ts";
import { prepareV4ImportPlan, verifyV4ImportPlan } from "../scripts/promotion-v4-import-plan.ts";
import { applyAreaPrecisionUpgrade } from "../src/pipeline/area-anchor.ts";
import { type PromotionRegistry, buildMultiSourcePromotionBundle, buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { promotionReadiness } from "../src/pipeline/promotion-readiness.ts";
import { holdRelocationCandidate } from "../src/pipeline/relocation-hold.ts";
import { recordReviewDecision } from "../src/pipeline/review-queue.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW } from "./support/fixture.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite, withoutTrigger } from "./support/sqlite-d1.ts";
import { MOVED, MOVED_D, PARK, areaPipeline, decideIdentity, exactChain, nextRelease, spotByName } from "./support/area.ts";

const PUBLISH_AT = "2026-10-20T00:00:00Z";
const registryOf = (adapter: SourceAdapter): PromotionRegistry => ({ source: () => adapter.registry, terms: () => { throw new Error("no terms"); } });
const tiles = (db: SqliteD1) => db.raw.prepare("SELECT tile_id, revision, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id").all();
const approx = async (db: SqliteD1) => (await readPublishedTiles(db)).flatMap((t) => t.spots).find((s) => s.name === "公園内喫煙所");

type State = "A-active" | "B-sameCoordinateUpgrade" | "C-movedUpgrade" | "D-exactAfterUpgradeRelocations" | "F-nextReleaseKeepsOldAnchor"
  | "G-staleReviewRejected" | "H-directSqlTamperRejected";
const STATES: readonly State[] = ["A-active", "B-sameCoordinateUpgrade", "C-movedUpgrade", "D-exactAfterUpgradeRelocations",
  "F-nextReleaseKeepsOldAnchor", "G-staleReviewRejected", "H-directSqlTamperRejected"];

/** The published origin database of one state, with what its anchored spot must look like. */
async function stateDb(state: State) {
  const { db, adapter } = await areaPipeline();
  const spotId = spotByName(db, "公園内喫煙所").spot_id as string;
  if (state === "B-sameCoordinateUpgrade" || state === "C-movedUpgrade") {
    const moved = state === "C-movedUpgrade";
    const b = await nextRelease(db, adapter, [moved ? "exactMoved" : "exactAtAnchor", "exact"], "2026-10-10");
    const identity = (b.first as { reviewItemIds: number[] }).reviewItemIds[0];
    await decideIdentity(db, identity, spotId);
    let relocationReviewItemId: number | undefined;
    if (moved) {
      await b.resolve();
      relocationReviewItemId = (db.raw.prepare("SELECT review_item_id FROM review_items WHERE kind = 'relocationCandidate'").get() as { review_item_id: number }).review_item_id;
      await holdRelocationCandidate(db, adapter, relocationReviewItemId, { now: "2026-10-11T02:00:00Z" });
      await recordReviewDecision(db, { reviewItemId: relocationReviewItemId, decision: "relocationConfirmed", decidedBy: "reviewer", decidedAt: "2026-10-11T03:00:00Z" });
    }
    const evidence = (db.raw.prepare("SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '1'").get(b.releaseId) as { record_id: number }).record_id;
    await applyAreaPrecisionUpgrade(db, adapter, { spotId, evidenceRecordId: evidence, identityReviewItemId: identity, relocationReviewItemId,
      targetPrecision: "publisherPoint", areaPremise: "insideArea", reviewedBy: "reviewer", now: "2026-10-12T00:00:00Z" });
    assert.equal((await b.resolve("2026-10-13T00:00:00Z")).status, "resolved");
  }
  if (state === "F-nextReleaseKeepsOldAnchor") {
    const b = await nextRelease(db, adapter, ["anchored", "exact"], "2026-10-10");
    assert.equal(b.first.status, "resolved", "raw-identical records continue their spots");
  }
  // A -> B same-coordinate exact -> C relocation -> D relocation -> unchanged continuation.
  if (state === "D-exactAfterUpgradeRelocations") await exactChain(db, adapter);
  // The D chain, after direct-SQL attempts that the schema refused: nothing was written.
  if (state === "H-directSqlTamperRejected") {
    await exactChain(db, adapter, "D");
    const before = db.raw.prepare("SELECT count(*) n FROM spot_location_authorities").get();
    assert.throws(() => db.raw.prepare("UPDATE spot_field_provenance SET source_columns_json = '[\"lon\",\"lat\"]' WHERE spot_id = ? AND field = 'location'").run(spotId));
    assert.throws(() => db.raw.prepare("UPDATE spots SET latitude = 36, longitude = 140 WHERE spot_id = ?").run(spotId));
    assert.throws(() => db.raw.prepare(`INSERT INTO spot_location_authorities SELECT spot_id, seq + 1, 'continuation', precision, anchor_id, evidence_source_id,
      evidence_release_id, evidence_release_content_sha256, evidence_record_id, evidence_observation_id, mapping_version, location_rule,
      location_columns_json, 36, 140, NULL, recorded_at FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq DESC LIMIT 1`).run(spotId));
    assert.deepEqual(db.raw.prepare("SELECT count(*) n FROM spot_location_authorities").get(), before);
  }
  // B reviewed, then a newer release C: the stale B upgrade is refused and writes nothing; the spot stays approximate.
  if (state === "G-staleReviewRejected") {
    const b = await nextRelease(db, adapter, ["exactAtAnchor", "exact"], "2026-10-10");
    const identity = (b.first as { reviewItemIds: number[] }).reviewItemIds[0];
    await decideIdentity(db, identity, spotId);
    await nextRelease(db, adapter, ["exactAtAnchor", "exact"], "2026-10-14", "2026-10-15T00:00:00Z");
    const evidence = (db.raw.prepare("SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '1'").get(b.releaseId) as { record_id: number }).record_id;
    await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, { spotId, evidenceRecordId: evidence, identityReviewItemId: identity,
      targetPrecision: "publisherPoint", areaPremise: "insideArea", reviewedBy: "reviewer", now: "2026-10-16T00:00:00Z" }), /stale or competing|competes/);
  }
  await publishTiles(db, { now: PUBLISH_AT });
  const spot = await approx(db);
  assert.ok(spot, `${state}: the spot publishes`);
  const point = state === "C-movedUpgrade" ? MOVED : state === "D-exactAfterUpgradeRelocations" || state === "H-directSqlTamperRejected" ? MOVED_D : PARK;
  const expected = state === "A-active" || state === "F-nextReleaseKeepsOldAnchor" || state === "G-staleReviewRejected"
    ? { precision: "areaApproximate", latitude: PARK.latitude, longitude: PARK.longitude }
    : { precision: "publisherPoint", latitude: point.latitude, longitude: point.longitude };
  assert.deepEqual({ precision: spot!.verification.locationPrecision, latitude: spot!.latitude, longitude: spot!.longitude }, expected, state);
  if (state === "F-nextReleaseKeepsOldAnchor") {
    // The binding still cites release A's record while the location provenance moved to release B's.
    const b = db.raw.prepare("SELECT b.record_id, p.record_id AS provenance_record FROM spot_location_anchors b JOIN spot_field_provenance p ON p.spot_id = b.spot_id AND p.field = 'location'").get() as Record<string, number>;
    assert.notEqual(b.record_id, b.provenance_record);
  }
  return { db, adapter, spotId };
}

async function assertGreenMatches(origin: SqliteD1, green: SqliteD1, state: string) {
  assert.deepEqual(tiles(green), tiles(origin), `${state}: GREEN serves the origin's exact tiles`);
  for (const t of ["area_location_anchors", "area_precision_upgrades", "spot_location_anchors", "spot_location_authorities"]) {
    assert.deepEqual(green.raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(), origin.raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(), `${state}: ${t} carried`);
  }
  const quality = await analyzeCorpus(green, { now: NOW, gzip: (b) => gzipSync(b).length, adapters: [] });
  assert.equal(quality.checks.find((c) => c.id === "area-anchor-never-exact")?.status, "pass", `${state}: quality in GREEN`);
  // A republish in GREEN reads the carried state: nothing silently becomes exact or approximate.
  await publishTiles(green, { now: "2026-11-01T00:00:00Z" });
  assert.deepEqual((await readPublishedTiles(green)).flatMap((t) => t.spots), (await readPublishedTiles(origin)).flatMap((t) => t.spots), `${state}: republished identically`);
}

for (const state of STATES) {
  test(`v2 and v3 round-trip ${state}: fresh GREEN, republish, deterministic re-export`, async () => {
    const { db, adapter } = await stateDb(state);
    const registry = registryOf(adapter);
    for (const [name, build] of [
      ["v2", async (d: SqliteD1) => (await buildPromotionBundle(d, { registry })).sql],
      ["v3", async (d: SqliteD1) => (await buildMultiSourcePromotionBundle(d, { registry })).sql],
    ] as const) {
      const sql = await build(db);
      assert.equal(await build(db), sql, `${name}: deterministic`);
      const target = migratedSqlite();
      applyPromotionBundle(target, sql);
      const green = new SqliteD1(target);
      assert.equal((await promotionReadiness(green)).completed, true, `${name} ${state}: sealed`);
      // Re-export before GREEN republishes (republish bumps revisions): byte-identical.
      assert.equal(await build(green), sql, `${name} ${state}: GREEN re-exports the same bytes`);
      await assertGreenMatches(db, green, `${name} ${state}`);
    }
  });

  test(`v4 round-trip ${state}: build, verify, import plan, fresh GREEN, readiness, re-export`, async (t) => {
    const { db, adapter } = await stateDb(state);
    const registry = registryOf(adapter);
    const root = await mkdtemp(join(tmpdir(), "area-v4-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const manifest = await exportPromotionV4(db.raw, join(root, "bundle"), { chunkBytes: 90_000, registry });
    assert.deepEqual(await exportPromotionV4(db.raw, join(root, "again"), { chunkBytes: 90_000, registry }), manifest, "deterministic");
    assert.deepEqual(await verifyPromotionV4(join(root, "bundle"), manifest.wholeBundleSha256), manifest);
    const plan = await prepareV4ImportPlan(join(root, "bundle"), manifest.wholeBundleSha256, join(root, "plan"));
    await verifyV4ImportPlan(join(root, "plan"), plan.wholePlanSha256, manifest.wholeBundleSha256);
    const target = migratedSqlite();
    for (const file of ["initialize.sql", ...manifest.chunks.map((c) => c.file), "finalize.sql"]) {
      applyPromotionBundle(target, await readFile(join(root, "plan", file), "utf8"));
    }
    const green = new SqliteD1(target);
    assert.equal((await promotionReadiness(green)).completed, true, `v4 ${state}: GREEN sealed`);
    const again = await exportPromotionV4(target, join(root, "reexport"), { chunkBytes: 90_000, registry });
    assert.deepEqual(again, manifest, `v4 ${state}: GREEN re-exports the same manifest`);
    for (const c of manifest.chunks) assert.deepEqual(await readFile(join(root, "reexport", c.file)), await readFile(join(root, "bundle", c.file)));
    await assertGreenMatches(db, green, `v4 ${state}`);
  });
}

test("tampered or incomplete anchor provenance is refused by every promotion version", async (t) => {
  // Export side: the origin's canonical state no longer explains its published tile.
  const { db, adapter, spotId } = await stateDb("A-active");
  const registry = registryOf(adapter);
  const good = (await buildPromotionBundle(db, { registry })).sql;
  // Import side: a bundle missing the bindings cannot even insert the anchor's location provenance.
  const stripped = good.split("\n").filter((l) => !l.startsWith("INSERT INTO spot_location_anchors")).join("\n");
  assert.notEqual(stripped, good);
  assert.throws(() => applyPromotionBundle(migratedSqlite(), stripped), /area-anchor location names the spot.s own anchor binding|the anchor authority is not the spot.s binding/);
  // A bundle whose binding claims another publication is refused on import.
  const foreign = good.replace(/(INSERT INTO spot_location_anchors .*?VALUES \('[^']+', 'aa_ueno', \d+, ')[0-9a-f]{64}/, `$1${"9".repeat(64)}`);
  assert.notEqual(foreign, good);
  assert.throws(() => applyPromotionBundle(migratedSqlite(), foreign), /same release/);
  withoutTrigger(db.raw, "spot_field_provenance_location_authority_update",
    () => db.raw.prepare("UPDATE spot_field_provenance SET rule = 'test.point.v1' WHERE spot_id = ? AND field = 'location'").run(spotId));
  await assert.rejects(() => buildPromotionBundle(db, { registry }), /does not match its canonical row/);
  await assert.rejects(() => buildMultiSourcePromotionBundle(db, { registry }), /does not match its canonical row/);
  const root = await mkdtemp(join(tmpdir(), "area-v4-tamper-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => exportPromotionV4(db.raw, join(root, "bundle"), { chunkBytes: 90_000, registry }));
});

test("a carried chain must explain its spot when the bootstrap is sealed (v2 and v3)", async () => {
  const { db, adapter } = await stateDb("D-exactAfterUpgradeRelocations");
  const registry = registryOf(adapter);
  for (const build of [async () => (await buildPromotionBundle(db, { registry })).sql, async () => (await buildMultiSourcePromotionBundle(db, { registry })).sql]) {
    const good = await build();
    // The carried pin is not the latest authority's point.
    const moved = good.replace(new RegExp(`(INSERT INTO spots .*?)${MOVED_D.latitude}, ${MOVED_D.longitude}`), "$136, 140");
    assert.notEqual(moved, good);
    assert.throws(() => applyPromotionBundle(migratedSqlite(), moved), /latest location authority|location authority/);
    // The chain's later rows are dropped: the carried spot is no longer explained.
    const truncated = good.split("\n").filter((l) => !(l.startsWith("INSERT INTO spot_location_authorities") && /'(relocation|continuation)'/.test(l))).join("\n");
    assert.notEqual(truncated, good);
    assert.throws(() => applyPromotionBundle(migratedSqlite(), truncated), /location authority/);
  }
});
