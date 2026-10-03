// Migration 0030 on a populated pre-0030 database: existing spots have no anchor, binding, upgrade or authority chain,
// stay `unanchored`, publish byte-identically to a database migrated fresh, and keep their ADR-0009 relocation path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { gzipSync } from "node:zlib";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyMigration, migratedSqlite } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

test("0030 applies to a populated pre-0030 database; existing spots stay unanchored and publish identically", async () => {
  const before = migratedSqlite("0029_segmented_promotion.sql");
  assert.equal((before.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'spot_location_authorities'").get() as { n: number }).n, 0);
  const old = new SqliteD1(before);
  await importTaito(old, { newSpotId: sequentialSpotIds("M") });
  const spots = (before.prepare("SELECT count(*) n FROM spots").get() as { n: number }).n;
  assert.ok(spots > 0);
  applyMigration(before, readFileSync(new URL("../migrations/0030_area_approximate_locations.sql", import.meta.url), "utf8"));
  for (const t of ["area_location_anchors", "spot_location_anchors", "area_precision_upgrades", "spot_location_authorities", "area_anchor_relocation_deltas"]) {
    assert.equal((before.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n, 0, `${t} starts empty`);
  }
  await publishTiles(old, { now: "2026-10-20T00:00:00Z" });
  const fresh = new SqliteD1();
  await importTaito(fresh, { newSpotId: sequentialSpotIds("M") });
  await publishTiles(fresh, { now: "2026-10-20T00:00:00Z" });
  assert.deepEqual(v1TileRows(old), v1TileRows(fresh), "same tiles as a fresh migration");
  const published = (d: SqliteD1) => d.raw.prepare("SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id").all();
  assert.deepEqual(published(old), published(fresh), "the same spots publish");
  const quality = await analyzeCorpus(old, { now: NOW, gzip: (b) => gzipSync(b).length, adapters: [] });
  assert.equal(quality.checks.find((c) => c.id === "area-anchor-never-exact")?.status, "pass");
  // Unchained spots keep their existing rules: a raw pin change is still refused by ADR-0009's guard, not by 0030's.
  const id = (before.prepare("SELECT spot_id FROM spots LIMIT 1").get() as { spot_id: string }).spot_id;
  assert.throws(() => before.prepare("UPDATE spots SET latitude = latitude + 0.001 WHERE spot_id = ?").run(id), /relocation application/);
});
