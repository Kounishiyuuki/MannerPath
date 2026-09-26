// The beta data-quality analysis (Issue #33) over the same fixture the local database holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
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

// The gate's logic, independent of the zlib build (Issue #76): a stand-in sizer reports every tile
// at a chosen size. The gate trips only strictly above TILE_REEVALUATION_GZIP_BYTES.
for (const [size, within] of [[1, true], [TILE_REEVALUATION_GZIP_BYTES, true], [TILE_REEVALUATION_GZIP_BYTES + 1, false]] as const) {
  test(`a ${size}-byte gzipped tile is ${within ? "within" : "over"} the re-evaluation gzip threshold`, async () => {
    const db = await publishedDb();
    const r = await analyzeCorpus(db, { now: NOW, gzip: () => size });
    assert.equal(r.thresholds.maxGzipBytesPerTile, size);
    assert.equal(r.thresholds.withinThresholds, within);
    const gate = r.checks.find((c) => c.id === "tile-zoom-thresholds")!;
    assert.equal(gate.status, within ? "pass" : "fail");
    assert.match(gate.detail, new RegExp(`max ${size} gzip bytes/tile \\(trigger ${TILE_REEVALUATION_GZIP_BYTES}\\)`));
    assert.equal(r.failedChecks, within ? 0 : 1);
  });
}

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

  const second: SourceAdapter = {
    ...TAITO_ADAPTER,
    registry: { ...TAITO_ADAPTER.registry, sourceId: futureSource },
    qualityPolicy: { async analyze(_db, sourceId) {
      return { checks: [{ id: `${sourceId}-test-only`, status: "pass", detail: "isolated" }], reconciliation: null };
    } },
  };
  const r = await analyzeCorpus(db, { now: NOW, gzip: (b) => gzipSync(b).length, adapters: [TAITO_ADAPTER, second] });
  assert.equal(r.sourceMetrics.find((s) => s.sourceId === futureSource)?.publishedSpots, 1);
  assert.equal(r.sourceMetrics.find((s) => s.sourceId === futureSource)?.canonicalSpots, 1);
  assert.deepEqual(r.sourceMetrics.find((s) => s.sourceId === futureSource)?.checks.map((c) => c.id), [`${futureSource}-test-only`]);
  assert.equal(r.sourceMetrics.find((s) => s.sourceId === TAITO_SOURCE_ID)?.publishedSpots, 32);
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

test("two source policies remain isolated without registering the test source", async () => {
  const db = await publishedDb();
  const testId = "test-future-municipal";
  db.raw.prepare(`INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
    VALUES (?, 'TEST source', 'municipal', 'TEST license', 'https://example.invalid/license', 'TEST attribution', 'blocked', ?, ?)`).run(testId, NOW, NOW);
  const second: SourceAdapter = {
    ...TAITO_ADAPTER,
    registry: { ...TAITO_ADAPTER.registry, sourceId: testId, publicationStatus: "blocked" },
    qualityPolicy: { async analyze(_db, sourceId) {
      return { checks: [{ id: `${sourceId}-test-only`, status: "pass", detail: "isolated" }], reconciliation: null };
    } },
  };
  const r = await analyzeCorpus(db, { now: NOW, adapters: [TAITO_ADAPTER, second] });
  assert.equal(r.sourceMetrics.length, 2);
  assert.equal(r.sourceMetrics.find((s) => s.sourceId === testId)?.publishedSpots, 0);
  assert.deepEqual(r.sourceMetrics.find((s) => s.sourceId === testId)?.checks.map((c) => c.id), [`${testId}-test-only`]);
  assert.equal(r.sourceMetrics.find((s) => s.sourceId === TAITO_SOURCE_ID)?.checks.length, 4);
  assert.equal(r.checks.some((c) => c.id === `${testId}-unstated-fields-stay-unknown`), false);
  assert.equal(r.sources.blocked, 1);
});

test("published verification dates must be valid and no later than the analysis instant", async () => {
  const db = await publishedDb();
  const baseline = await analyze(db);
  assert.equal(baseline.nationwide.freshness.publishedWithin365Days, 32);
  assert.equal(baseline.checks.find((check) => check.id === "freshness-timestamps-valid-and-not-future")?.status, "pass");

  const tile = db.raw.prepare("SELECT tile_id, body_json FROM tile_snapshots ORDER BY tile_id LIMIT 1")
    .get() as { tile_id: string; body_json: string };
  // Inject malformed published evidence without running the publisher's republish path.
  db.raw.prepare("DROP TRIGGER tile_snapshots_revision_monotonic").run();
  for (const date of ["2027-01-01", "2026-02-30"]) {
    const body = JSON.parse(tile.body_json);
    body.spots[0].lastVerifiedAt = date;
    db.raw.prepare("UPDATE tile_snapshots SET body_json = ? WHERE tile_id = ?")
      .run(JSON.stringify(body), tile.tile_id);
    const r = await analyze(db);
    assert.equal(r.nationwide.freshness.publishedWithin365Days, 31, date);
    assert.equal(r.sourceMetrics[0].publishedWithin365Days.count, 31, date);
    assert.equal(r.checks.find((check) => check.id === "freshness-timestamps-valid-and-not-future")?.status, "fail", date);
  }
});

test("current-release fetch dates reject future and invalid timestamps", async () => {
  const db = await publishedDb();
  const baseline = await analyze(db);
  assert.equal(baseline.sourceMetrics[0].currentReleaseFetch?.within30Days, true);
  assert.equal(baseline.nationwide.freshness.reviewedCurrentReleaseFetchedWithin30Days, 1);
  db.raw.prepare("DROP TRIGGER source_releases_evidence_immutable").run();
  db.raw.prepare("UPDATE source_releases SET fetched_at = ? WHERE source_id = ?")
    .run("2026-09-20T00:00:00.123Z", TAITO_SOURCE_ID);
  const fractional = await analyze(db);
  assert.equal(fractional.sourceMetrics[0].currentReleaseFetch?.within30Days, true);
  assert.equal(fractional.checks.find((check) => check.id === "freshness-timestamps-valid-and-not-future")?.status, "pass");
  for (const fetchedAt of ["2027-01-01T00:00:00Z", "2026-02-30T00:00:00Z"]) {
    db.raw.prepare("UPDATE source_releases SET fetched_at = ? WHERE source_id = ?")
      .run(fetchedAt, TAITO_SOURCE_ID);
    const r = await analyze(db);
    assert.equal(r.sourceMetrics[0].currentReleaseFetch?.within30Days, false, fetchedAt);
    assert.equal(r.nationwide.freshness.reviewedCurrentReleaseFetchedWithin30Days, 0, fetchedAt);
    assert.equal(r.nationwide.freshness.reviewedCurrentReleaseCount, 1, fetchedAt);
    assert.equal(r.checks.find((check) => check.id === "freshness-timestamps-valid-and-not-future")?.status, "fail", fetchedAt);
  }
});

test("nationwide fetch denominator excludes an unreviewed blocked current release", async () => {
  const db = await publishedDb();
  addBlockedTestSource(db);
  db.raw.prepare(`INSERT INTO source_releases (source_id, observed_on, fetched_at, source_url,
    content_sha256, byte_length, header_json, record_count, parser_version, status, is_current, applied_at)
    VALUES (?, '2026-09-01', '2027-01-01T00:00:00Z', 'https://example.invalid/blocked.csv',
      ?, 1, '["a"]', 0, 'test-parser.v1', 'applied', 1, ?)`)
    .run(TEST_BLOCKED_SOURCE, "f".repeat(64), NOW);
  for (const fetchedAt of ["2027-01-01T00:00:00Z", "2025-01-01T00:00:00Z"]) {
    db.raw.prepare("UPDATE source_releases SET fetched_at = ? WHERE source_id = ?")
      .run(fetchedAt, TEST_BLOCKED_SOURCE);
    const r = await analyze(db);
    assert.equal(r.sourceMetrics.length, 2);
    assert.equal(r.sourceMetrics.find((source) => source.sourceId === TEST_BLOCKED_SOURCE)?.currentReleaseFetch?.within30Days, false);
    assert.equal(r.nationwide.freshness.reviewedCurrentReleaseCount, 1);
    assert.equal(r.nationwide.freshness.reviewedCurrentReleaseFetchedWithin30Days, 1);
    assert.equal(r.checks.find((check) => check.id === "freshness-timestamps-valid-and-not-future")?.status,
      fetchedAt.startsWith("2027") ? "fail" : "pass");
  }
});
