// ID-preserving promotion input (scripts/promotion-id-preserving.ts). The synthetic "production" is what the live
// DATA database is: a sealed v4 GREEN promoted from the six production sources, whose 513 spot IDs are random
// and unknown to the fixtures. The five Tokyo sources are added; the 513 IDs, spot rows, source links and
// public tile entries must survive, a second v4 promotion must carry them, and every refusal leaves no output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { applyPromotionV4 } from "../scripts/promotion-v4-apply.ts";
import { ADDITIVE_SOURCES, LIVE_SOURCES, buildIdPreservingInput } from "../scripts/promotion-id-preserving.ts";
import { sha256Hex } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW } from "./support/fixture.ts";
import { SqliteD1, applyMigration, migratedSqlite, migrationFiles } from "./support/sqlite-d1.ts";

const TOKYO = Object.keys(ADDITIVE_SOURCES);
const LATER = "2026-10-20T00:00:00Z";
const dir = mkdtempSync(join(tmpdir(), "mp-id-preserving-"));
const LIVE = join(dir, "live-green.sqlite");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function migratedFile(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON;");
  for (const file of migrationFiles()) applyMigration(db, readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  return db;
}

/** Runs a pipeline DB through v4 build + apply-local into a fresh GREEN file, as the live promotion did. */
async function promote(pipeline: DatabaseSync, green: string): Promise<void> {
  const bundle = join(dir, `bundle-${Math.random().toString(36).slice(2)}`);
  const manifest = await exportPromotionV4(pipeline, bundle, { chunkBytes: 4_000_000 });
  const target = migratedFile(green);
  try { assert.equal((await applyPromotionV4(target, bundle, manifest.wholeBundleSha256)).status, "completed"); }
  finally { target.close(); }
}

async function syntheticLive(): Promise<void> {
  const raw = migratedSqlite();
  try {
    const db = new SqliteD1(raw);
    for (const { adapter, release, fixture } of Object.values(LIVE_SOURCES)) {
      await ensureReviewedSource(db, adapter.registry.sourceId, NOW);
      const bytes = new Uint8Array(readFileSync(new URL(fixture, new URL("../scripts/", import.meta.url))));
      const ingest = await ingestRelease(db, adapter, bytes, release);
      await recordReviewedAnchors(db, adapter, await sha256Hex(bytes), NOW);
      assert.equal((await resolveFirstRelease(db, adapter, ingest.releaseId, { now: NOW })).status, "resolved");
    }
    await publishTiles(db, { now: NOW });
    await promote(raw, LIVE);
  } finally { raw.close(); }
}

function all(path: string, sql: string): Record<string, unknown>[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(sql).all() as Record<string, unknown>[]; } finally { db.close(); }
}
async function tiles(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try { return await readPublishedTiles(new SqliteD1(raw)); } finally { raw.close(); }
}
const entries = async (path: string) => new Map((await tiles(path)).flatMap(t => t.spots.map(s => [s.id, { tile: t.tile, spot: s }] as const)));
// Timestamps and the resolver stamp are of the rebuild; everything a spot says is compared.
const SPOT_COLUMNS = "spot_id, merged_into, name, latitude, longitude, tile_id, spot_type, host_type, access_type, environment, supports_paper, supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status, time_zone, fee_type, floor, entrance_note, lifecycle, evidence_quality, evidence_quality_version, last_verified_at, publication_hold, spot_subtype, access_detail";
const SPOT_SOURCES = `SELECT sse.spot_id, se.source_id, sr.ordinal, sr.raw_sha256 FROM spot_source_entities sse JOIN source_entities se USING (source_entity_id)
  JOIN source_record_entities sre USING (source_entity_id) JOIN source_records sr ON sr.record_id = sre.record_id`;

test.before(syntheticLive);
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("rebuilds with the 513 live IDs, adds the 125 Tokyo spots, and a second v4 promotion carries both", async () => {
  const out = join(dir, "input.sqlite");
  const liveSha = sha(LIVE);
  const live = await entries(LIVE);
  assert.equal(live.size, 513);
  const liveIds = JSON.stringify([...live.keys()]);
  const inLive = `spot_id IN (SELECT value FROM json_each('${liveIds}'))`;

  const report = await buildIdPreservingInput(LIVE, out, TOKYO, { now: LATER, expectedAdded: 125 });
  assert.equal(sha(LIVE), liveSha, "the snapshot is never written");
  assert.equal(report.preservedPublishedSpots, 513);
  assert.equal(report.publishedSpots, 638);
  assert.deepEqual(report.addedSpots, {
    "chiyoda-smoking-places": 30, "chuo-park-smoking-places": 14, "chuo-private-smoking-places": 47,
    "shibuya-smoking-places": 30, "toshima-smoking-places": 4,
  });

  const green = join(dir, "green-v2.sqlite");
  const pipeline = new DatabaseSync(out, { readOnly: true });
  try { await promote(pipeline, green); } finally { pipeline.close(); }

  for (const path of [out, green]) {
    assert.deepEqual(all(path, `SELECT ${SPOT_COLUMNS} FROM spots WHERE ${inLive} ORDER BY spot_id`),
      all(LIVE, `SELECT ${SPOT_COLUMNS} FROM spots ORDER BY spot_id`), `spot rows in ${path}`);
    assert.deepEqual(all(path, `${SPOT_SOURCES} WHERE sse.${inLive} ORDER BY sse.spot_id`), all(LIVE, `${SPOT_SOURCES} ORDER BY sse.spot_id`), `source links in ${path}`);
    const now = await entries(path);
    assert.equal(now.size, 638);
    for (const [id, entry] of live) assert.deepEqual(now.get(id), entry, `public tile entry of ${id} in ${path}`);
  }

  const greenTiles = await tiles(green);
  const added = greenTiles.flatMap(t => t.spots.map(spot => ({ t, spot }))).filter(({ spot }) => !live.has(spot.id));
  assert.equal(added.length, 125);
  for (const { t, spot } of added) {
    assert.equal(spot.verification.locationPrecision, "areaApproximate");
    assert.ok(spot.verification.locationArea);
    assert.deepEqual(spot.sourceIds.length, 1);
    assert.ok(TOKYO.includes(spot.sourceIds[0]));
    // Only an explicit 24-hour statement parses (Chuo); everything else stays unparsed, so openNow is never guessed.
    if (spot.openingHours.status === "parsed") assert.deepEqual(spot.openingHours.parsed, { v: 1, kind: "allDay" });
    else assert.equal(spot.openingHours.status, "unparsed");
    assert.equal(spot.supportsPaper, "unknown");
    assert.equal(spot.supportsHeated, "unknown");
    assert.ok(t.sources.find(s => s.id === spot.sourceIds[0])?.attributionText, `attribution of ${spot.id}`);
  }
  assert.equal(Number(all(green, "SELECT count(*) n FROM sources")[0].n), 11);
});

test("refuses unknown, duplicated or already-live sources and an existing output, leaving nothing behind", async () => {
  const out = join(dir, "refused.sqlite");
  await assert.rejects(buildIdPreservingInput(LIVE, out, ["sendai-kaigan-park-smoking-areas"], { now: LATER }), /not a reviewed additive source/);
  await assert.rejects(buildIdPreservingInput(LIVE, out, ["toshima-smoking-places", "toshima-smoking-places"], { now: LATER }), /duplicate source/);
  await assert.rejects(buildIdPreservingInput(LIVE, LIVE, TOKYO, { now: LATER }), /must differ/);
  await assert.rejects(buildIdPreservingInput(LIVE, out, ["taito-public-smoking-areas"], { now: LATER, additiveSources: LIVE_SOURCES }), /already exists in the snapshot/);
  writeFileSync(out, "");
  await assert.rejects(buildIdPreservingInput(LIVE, out, TOKYO, { now: LATER }), /already exists/);
  rmSync(out);
  assert.equal(existsSync(`${out}.partial`), false);
});

test("refuses a snapshot that is not a completed v4 GREEN or whose schema drifted", async () => {
  const pipeline = join(dir, "pipeline-only.sqlite");
  migratedFile(pipeline).close();
  await assert.rejects(buildIdPreservingInput(pipeline, join(dir, "p-out.sqlite"), TOKYO, { now: LATER }), /not a completed v4 promotion/);
  const drifted = join(dir, "drifted.sqlite");
  copyFileSync(LIVE, drifted);
  const db = new DatabaseSync(drifted);
  db.exec("DROP INDEX spots_tile");
  db.close();
  await assert.rejects(buildIdPreservingInput(drifted, join(dir, "d-out.sqlite"), TOKYO, { now: LATER }), /schema does not match/);
});

test("refuses a live source without a reviewed fixture, or whose fixture is not the live release", async () => {
  const { [Object.keys(LIVE_SOURCES)[5]]: _kyoto, ...withoutKyoto } = LIVE_SOURCES;
  await assert.rejects(buildIdPreservingInput(LIVE, join(dir, "k-out.sqlite"), TOKYO, { now: LATER, liveSources: withoutKyoto }), /no reviewed fixture to rebuild from/);
  // A live Kyoto release that is not the reviewed fixture's bytes (e.g. a refresh applied only in production).
  const other = join(dir, "live-other-release.sqlite");
  copyFileSync(LIVE, other);
  const db = new DatabaseSync(other);
  const triggers = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger'").all() as { sql: string }[];
  db.exec((db.prepare("SELECT group_concat('DROP TRIGGER \"' || name || '\"', ';') s FROM sqlite_master WHERE type='trigger'").get() as { s: string }).s);
  db.prepare("UPDATE source_releases SET content_sha256 = ? WHERE source_id = 'kyoto-public-smoking-places'").run("f".repeat(64));
  for (const t of triggers) db.exec(t.sql);
  db.close();
  const out = join(dir, "e-out.sqlite");
  await assert.rejects(buildIdPreservingInput(other, out, TOKYO, { now: LATER }), /is not the live release/);
  assert.equal(existsSync(out) || existsSync(`${out}.partial`), false);
});

test("a failure after sources were written, a count mismatch or a near-duplicate leaves no output", async () => {
  const out = join(dir, "partial.sqlite");
  const broken = { ...ADDITIVE_SOURCES, "toshima-smoking-places": { ...ADDITIVE_SOURCES["toshima-smoking-places"], fixture: ADDITIVE_SOURCES["shibuya-smoking-places"].fixture } };
  await assert.rejects(buildIdPreservingInput(LIVE, out, ["chiyoda-smoking-places", "toshima-smoking-places"], { now: LATER, additiveSources: broken }));
  assert.equal(existsSync(out) || existsSync(`${out}.partial`), false);
  await assert.rejects(buildIdPreservingInput(LIVE, out, ["toshima-smoking-places"], { now: LATER, expectedAdded: 5 }), /expected 5 new spots, got 4/);
  assert.equal(existsSync(out) || existsSync(`${out}.partial`), false);
  // Toshima is ~5 km from the nearest Taito/Minato pin; a radius that wide must refuse.
  await assert.rejects(buildIdPreservingInput(LIVE, out, ["toshima-smoking-places"], { now: LATER, duplicateRadiusM: 20_000 }), /within 20000 m of a live published spot/);
  assert.equal(existsSync(out) || existsSync(`${out}.partial`), false);
});

test("refuses when a live spot no longer matches what its reviewed fixture rebuilds", async () => {
  // E.g. a reviewed hold or relocation applied only in production: the rebuild would silently undo it.
  const drifted = join(dir, "live-drifted.sqlite");
  copyFileSync(LIVE, drifted);
  const db = new DatabaseSync(drifted);
  const triggers = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger'").all() as { sql: string }[];
  db.exec((db.prepare("SELECT group_concat('DROP TRIGGER \"' || name || '\"', ';') s FROM sqlite_master WHERE type='trigger'").get() as { s: string }).s);
  // A live spot whose public name differs from what its fixture says.
  const { name } = db.prepare("SELECT name FROM spots WHERE name IS NOT NULL AND spot_id IN (SELECT spot_id FROM tile_snapshot_spots) ORDER BY spot_id LIMIT 1").get() as { name: string };
  const from = JSON.stringify({ name }).slice(1, -1), to = JSON.stringify({ name: `${name}（移設）` }).slice(1, -1);
  for (const table of ["tile_snapshots", "tile_snapshot_parts"]) db.prepare(`UPDATE ${table} SET body_json = replace(body_json, ?, ?)`).run(from, to);
  for (const t of triggers) db.exec(t.sql);
  db.close();
  const out = join(dir, "drift-out.sqlite");
  await assert.rejects(buildIdPreservingInput(drifted, out, TOKYO, { now: LATER }), /changed its tile or public tile entry/);
  assert.equal(existsSync(out) || existsSync(`${out}.partial`), false);
});
