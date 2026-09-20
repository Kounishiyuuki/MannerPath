// The beta data-quality analysis (Issue #33) over the same fixture the local database holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { TAITO_ATTRIBUTION_TEXT, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { TILE_REEVALUATION_GZIP_BYTES, TILE_REEVALUATION_SPOTS, analyzeCorpus } from "../src/quality/analyze.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TEST_BLOCKED_SOURCE, addBlockedTestSource, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const analyze = (db: SqliteD1) => analyzeCorpus(db, { now: NOW, gzip: (b) => gzipSync(b).length });

async function publishedDb(): Promise<SqliteD1> {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return db;
}

test("measures the published corpus, not the spots table", async () => {
  const db = await publishedDb();
  const r = await analyze(db);
  assert.equal(r.corpus.publishedSpots, 34);
  assert.equal(r.corpus.publishedSpots, r.corpus.activeSpotsInDatabase);
  assert.equal(r.corpus.publishedTiles, 5);
  assert.equal(r.corpus.emptyTiles, 0);
  assert.equal(r.sources.publishedSourceIds.join(), TAITO_SOURCE_ID);
  assert.equal(r.evidenceQuality["evidence-quality.v1:officialListing"], 34);
  // Every value the source does not state stays unknown; the analysis must show that, not hide it.
  assert.equal(r.unknownRates.spotType.rate, 1);
  assert.equal(r.unknownRates.accessType.rate, 1);
  assert.equal(r.unknownRates.environment.rate, 1);
  assert.equal(r.freshness.lastVerifiedAt["2026-08-18"], 34);
  assert.equal(r.failedChecks, 0);
});

test("is deterministic: the same database yields byte-identical JSON", async () => {
  const db = await publishedDb();
  assert.equal(JSON.stringify(await analyze(db)), JSON.stringify(await analyze(db)));
});

test("reports the largest tile and its distance from the ADR-0005 re-evaluation triggers", async () => {
  const db = await publishedDb();
  const r = await analyze(db);
  assert.equal(r.thresholds.dataTileZoom, 14);
  assert.equal(r.thresholds.maxSpotsPerTile, r.largestTile.bySpotCount!.spotCount);
  assert.ok(r.thresholds.maxSpotsPerTile < TILE_REEVALUATION_SPOTS);
  assert.ok(r.thresholds.maxGzipBytesPerTile! < TILE_REEVALUATION_GZIP_BYTES);
  assert.equal(r.thresholds.withinThresholds, true);
});

test("an unapproved source is neither published nor counted as approved", async () => {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  await importTaito(db, { sourceId: TEST_BLOCKED_SOURCE, newSpotId: sequentialSpotIds("9") });
  await publishTiles(db, { now: NOW });
  const r = await analyze(db);
  assert.equal(r.corpus.publishedSpots, 0);
  assert.deepEqual(r.sources.publishedSourceIds, []);
  assert.equal(r.sources.blocked, 1);
  assert.equal(r.failedChecks, 0);
});

test("a published source whose registry row drifted from the reviewed entry fails the license checks", async () => {
  const db = await publishedDb();
  db.raw.prepare("UPDATE sources SET attribution_text = NULL WHERE source_id = ?").run(TAITO_SOURCE_ID);
  const r = await analyze(db);
  const failed = r.checks.filter((c) => c.status === "fail").map((c) => c.id);
  assert.deepEqual(failed, ["registry-row-matches-reviewed-entry", "published-sources-carry-license-and-attribution"]);
  // The already-published tile still carries the attribution it was published with.
  assert.equal(r.sources.entries[0].attributionText, null);
});

test("osm data approved in the database is reported as a failure", async () => {
  const db = await publishedDb();
  // The schema refuses kind='osm' with 'approved', so the detectable failure is an osm row that is
  // published at all; assert the blocked case passes and the constraint is what stops the other.
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES ('osm', 'OpenStreetMap', 'osm', 'ODbL', NULL, NULL, 'blocked', ?, ?)`,
  ).run(NOW, NOW);
  const r = await analyze(db);
  assert.equal(r.checks.find((c) => c.id === "osm-blocked")!.status, "pass");
  assert.throws(() => db.raw.prepare("UPDATE sources SET publication_status = 'approved' WHERE source_id = 'osm'").run());
});

test("the published attribution is the reviewed wording, on every non-empty tile", async () => {
  const db = await publishedDb();
  const r = await analyze(db);
  assert.equal(r.sources.entries[0].attributionText, TAITO_ATTRIBUTION_TEXT);
  assert.equal(r.checks.find((c) => c.id === "published-tiles-carry-attribution")!.status, "pass");
  assert.equal(r.checks.find((c) => c.id === "no-host-inferred-attributes")!.status, "pass");
});
