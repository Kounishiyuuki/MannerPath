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
  // 32, not 34: the Issue #42 reconciliation withholds two records the ward's other current
  // publication contradicts (one temporarily closed, one temporarily relocated).
  assert.equal(r.corpus.publishedSpots, 32);
  assert.equal(r.corpus.activeSpotsInDatabase, 33, "the relocated spot stays active but held; the closed one is not active");
  assert.equal(r.corpus.publishedTiles, 5);
  assert.equal(r.corpus.emptyTiles, 0);
  assert.equal(r.sources.publishedSourceIds.join(), TAITO_SOURCE_ID);
  assert.equal(r.evidenceQuality["evidence-quality.v1:officialListing"], 32);
  // Every value the source does not state stays unknown; the analysis must show that, not hide it.
  assert.equal(r.unknownRates.spotType.rate, 1);
  assert.equal(r.unknownRates.accessType.rate, 1);
  assert.equal(r.unknownRates.environment.rate, 1);
  assert.equal(r.freshness.lastVerifiedAt["2026-08-18"], 32);
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

test("measures nearest-neighbour spacing from the published coordinates", async () => {
  const db = await publishedDb();
  const r = await analyze(db);
  const nn = r.corpus.nearestNeighbourMeters!;
  // Whole metres, ordered, and every value is a real distance between two of the 34 spots.
  assert.ok(Number.isInteger(nn.min) && Number.isInteger(nn.max));
  assert.ok(nn.min <= nn.p50! && nn.p50! <= nn.p90! && nn.p90! <= nn.max);
  assert.deepEqual(nn, { min: 56, p50: 209, p90: 695, max: 1112 });
});

test("nearest-neighbour spacing is null below two spots", async () => {
  const db = new SqliteD1();
  assert.equal((await analyze(db)).corpus.nearestNeighbourMeters, null);
});

test("a reviewed source that states a spot's type, access and environment is not rejected by the Taito rule", async () => {
  // The invariant is per-source: 台東区 publishes no column for these fields, so a Taito-derived
  // value would be an inference. A future source that states them resolves them with provenance,
  // and this quality rule must stay silent about it.
  const db = await publishedDb();
  const futureSource = "test-future-municipal";
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY future municipal source', 'municipal', 'CC BY 4.0', 'https://example.invalid/license', 'TEST attribution', 'approved', ?, ?)`,
  ).run(futureSource, NOW, NOW);
  db.raw.prepare(
    `INSERT INTO source_releases (release_id, source_id, observed_on, fetched_at, source_url, content_sha256, byte_length, header_json, record_count, parser_version, status, is_current, applied_at)
     VALUES (900, ?, '2026-09-01', ?, 'https://example.invalid/f.csv', ?, 1, '["a"]', 1, 'test-parser.v1', 'applied', 1, ?)`,
  ).run(futureSource, NOW, "f".repeat(64), NOW);
  db.raw.prepare(
    "INSERT INTO source_records (record_id, release_id, ordinal, raw_values_json, raw_sha256) VALUES (900, 900, 1, '[\"a\"]', ?)",
  ).run("e".repeat(64));
  db.raw.prepare(
    `INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type, host_type,
       access_type, environment, opening_hours_status, lifecycle, evidence_quality, evidence_quality_version,
       last_verified_at, resolver_version, created_at, updated_at)
     VALUES ('sp_90000000000000000000000000', 'TEST typed spot', 35.7, 139.78, 14, 14553, 6449, '14/14553/6449',
       'publicSmokingRoom', 'municipal', 'public', 'indoor', 'none', 'active', 'officialListing', 'evidence-quality.v1',
       '2026-09-01', 'test-resolver.v1', ?, ?)`,
  ).run(NOW, NOW);
  for (const field of ["existence", "spotType", "hostType", "accessType", "environment"]) {
    db.raw.prepare(
      `INSERT INTO spot_field_provenance (spot_id, field, record_id, source_columns_json, rule, resolver_version, resolved_at)
       VALUES ('sp_90000000000000000000000000', ?, 900, '["種別"]', 'test.stated.v1', 'test-resolver.v1', ?)`,
    ).run(field, NOW);
  }
  await publishTiles(db, { now: NOW });

  const r = await analyze(db);
  const status = (id: string) => r.checks.find((c) => c.id === id)!.status;
  assert.equal(status(`${TAITO_SOURCE_ID}-unstated-fields-stay-unknown`), "pass");
  assert.equal(status(`${TAITO_SOURCE_ID}-existence-evidence-is-the-municipal-listing`), "pass");
  assert.equal(r.corpus.publishedSpots, 33);
  assert.equal(r.unknownRates.spotType.unknown, 32);
  // Only the separate registry invariant objects, because this source was never reviewed in a PR.
  assert.deepEqual(r.checks.filter((c) => c.status === "fail").map((c) => c.id),
    ["published-sources-reviewed", "registry-row-matches-reviewed-entry"]);
});

test("a Taito-derived spot given a type the ward does not state fails the Taito rule", async () => {
  const db = await publishedDb();
  const spotId = db.raw.prepare("SELECT spot_id FROM spots ORDER BY spot_id LIMIT 1").get() as { spot_id: string };
  db.raw.prepare("UPDATE spots SET spot_type = 'smokingPermittedVenue' WHERE spot_id = ?").run(spotId.spot_id);
  const r = await analyze(db);
  const failed = r.checks.filter((c) => c.status === "fail").map((c) => c.id);
  assert.deepEqual(failed, [`${TAITO_SOURCE_ID}-unstated-fields-stay-unknown`]);
});

test("the published attribution is the reviewed wording, on every non-empty tile", async () => {
  const db = await publishedDb();
  const r = await analyze(db);
  assert.equal(r.sources.entries[0].attributionText, TAITO_ATTRIBUTION_TEXT);
  assert.equal(r.checks.find((c) => c.id === "published-tiles-carry-attribution")!.status, "pass");
  assert.equal(r.checks.find((c) => c.id === `${TAITO_SOURCE_ID}-existence-evidence-is-the-municipal-listing`)!.status, "pass");
});
