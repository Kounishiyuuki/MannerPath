import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE } from "../src/pipeline/koto-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE } from "../src/pipeline/osaka-adapter.ts";
import { MUSASHINO_ADAPTER, MUSASHINO_FIXTURE_RELEASE } from "../src/pipeline/musashino-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { buildMultiSourcePromotionBundle, verifyPromotionBundle } from "../src/pipeline/promotion.ts";
import { observeRelease } from "../src/pipeline/observe.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { MINATO_ADAPTER, MINATO_SOURCE_ID, MINATO_FIXTURE_RELEASE, MINATO_FIXTURE_SHA256,
  MINATO_ATTRIBUTION_TEXT } from "../src/pipeline/minato-adapter.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { gzipSync } from "node:zlib";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyPromotionBundle } from "./support/sqlite-d1.ts";
const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv", import.meta.url)));
const QUALITY_NOW = "2026-09-30T00:00:00Z"; // After every reviewed release's fetch timestamp.
const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
async function ingest(db: SqliteD1, bytes = BYTES, meta = MINATO_FIXTURE_RELEASE) {
  await ensureReviewedSource(db, MINATO_SOURCE_ID, NOW);
  return ingestRelease(db, MINATO_ADAPTER, bytes, meta);
}
test("Minato retains exact mixed raw fixture and extracts only reviewed smoking points", () => {
  assert.equal(BYTES.length, 96869);
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), MINATO_FIXTURE_SHA256);
  const parsed = MINATO_ADAPTER.parse(BYTES);
  assert.equal(parsed.rows.length, 169);
  const included = parsed.rows.filter(MINATO_ADAPTER.includesRecord!);
  assert.equal(included.length, 114);
  assert.ok(parsed.rows.some((r) => r[5].endsWith("/kitsuen/109.html")));
  assert.ok(!included.some((r) => r[5].endsWith("/kitsuen/109.html")));
  assert.throws(() => MINATO_ADAPTER.observe(parsed.rows[0]), /explicit designated/);
  const original = included[0];
  for (const [index, value] of [[28, ""], [28, "NaN"], [28, "91.0"], [29, "181.0"], [2, "009013003000"], [4, "複合施設"], [5, "https://example.invalid/1.html"], [1, ""]] as const) {
    const changed = [...original]; changed[index] = value;
    assert.throws(() => MINATO_ADAPTER.observe(changed), /coordinate|designated/);
  }
  assert.throws(() => MINATO_ADAPTER.observe(original.slice(1)), /width/);
  assert.throws(() => MINATO_ADAPTER.parse(new Uint8Array([0xff])), /encoded data|encoding/);
  assert.throws(() => MINATO_ADAPTER.parse(BYTES.slice(0, -2)), /trailer/);
  const wrongHeader = new TextEncoder().encode(new TextDecoder().decode(BYTES).replace("最終更新日", "最終更新時"));
  assert.throws(() => MINATO_ADAPTER.parse(wrongHeader), /header/);
  const observations = included.map((r) => MINATO_ADAPTER.observe(r));
  assert.throws(() => MINATO_ADAPTER.assertResolvable({ ...MINATO_FIXTURE_RELEASE, contentSha256: MINATO_FIXTURE_SHA256 }, observations.slice(1)), /scope/);
  assert.equal(MINATO_ADAPTER.upstreamRowRef(original), original[5]);
  assert.equal(MINATO_ADAPTER.crossReleaseValidated, false);
  assert.equal(MINATO_ADAPTER.completeness, "partial");
  assert.equal(MINATO_ADAPTER.refreshTarget, undefined);
});
test("Minato full pipeline keeps unknowns and attribution, with 55 excluded raw records", async () => {
  const db = new SqliteD1();
  const { releaseId } = await ingest(db);
  const observations = await observeRelease(db, MINATO_ADAPTER, releaseId);
  assert.equal(count(db, "source_records"), 169);
  assert.equal(observations.length, 114);
  assert.equal(observations.filter(({ observation: o }) => o.openingHours.status === "unparsed").length, 26);
  assert.equal(observations[0].observation.openingHours.raw, "開設時間5時から25時まで");
  for (const { observation: o } of observations) {
    assert.equal(o.supportsPaper, "unknown"); assert.equal(o.supportsHeated, "unknown");
    assert.equal(o.openingHours.parsed, null);
    assert.ok(["none", "unparsed"].includes(o.openingHours.status));
    assert.deepEqual(o.provenance.find((p) => p.field === "location")?.columns, ["緯度", "経度"]);
  }
  const result = await resolveFirstRelease(db, MINATO_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("4") });
  assert.equal(result.status, "resolved");
  assert.equal(count(db, "spots"), 114); assert.equal(count(db, "source_record_entities"), 114);
  assert.equal(count(db, "spot_field_attenuations"), 0);
  const floors = db.raw.prepare("SELECT spot_id FROM spots WHERE name LIKE 'THE LINKPILLAR 2 %'").all();
  assert.equal(floors.length, 3);
  assert.equal(new Set(floors.map((r) => r.spot_id)).size, 3);
  const spots = db.raw.prepare("SELECT * FROM spots").all() as Record<string, unknown>[];
  for (const s of spots) {
    assert.equal(s.last_verified_at, null); assert.equal(s.host_type, null);
    for (const field of ["spot_type", "access_type", "environment", "supports_paper", "supports_heated"]) assert.equal(s[field], "unknown");
  }
  assert.deepEqual(await resolveFirstRelease(db, MINATO_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
  const report = await publishTiles(db, { now: NOW });
  assert.equal(report.published.reduce((n, t) => n + t.spotCount, 0), 114);
  for (const t of report.published) {
    const response = await app.request(`/v1/tiles/${t.tileId}`, {}, { DB: db });
    assert.equal(response.status, 200);
    const body = TileBodyV1.parse(await response.json());
    assert.deepEqual(body.sources.map((s) => s.id), [MINATO_SOURCE_ID]);
    assert.equal(body.sources[0].attributionText, MINATO_ATTRIBUTION_TEXT);
    assert.ok(body.spots.every((s) => s.lastVerifiedAt === null && s.supportsPaper === "unknown"));
  }
});
test("Minato refuses unreviewed releases before canonical writes", async () => {
  for (const meta of [{ ...MINATO_FIXTURE_RELEASE, observedOn: "2026-09-30" }, { ...MINATO_FIXTURE_RELEASE, sourceUrl: "https://example.invalid/other.csv" }]) {
    const db = new SqliteD1(); const { releaseId } = await ingest(db, BYTES, meta);
    await assert.rejects(resolveFirstRelease(db, MINATO_ADAPTER, releaseId, { now: NOW }), /fingerprint/);
    assert.equal(count(db, "spots"), 0);
  }
  const db = new SqliteD1();
  const changed = BYTES.slice(); const needle = new TextEncoder().encode("35.667170");
  const index = Buffer.from(changed).indexOf(needle); assert.ok(index > 0); changed[index + 5] = 56;
  const { releaseId } = await ingest(db, changed);
  await assert.rejects(resolveFirstRelease(db, MINATO_ADAPTER, releaseId, { now: NOW }), /fingerprint/);
  assert.equal(count(db, "spots"), 0); assert.equal(count(db, "spot_field_provenance"), 0);
});

test("all five reviewed sources survive promotion v3 into a fresh database with exact attribution and quality", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  for (const [adapter, metadata, fixture, prefix] of [
    [OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, "osaka-designated-smoking-areas/opendata_1012.csv", "2"],
    [KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, "koto-station-smoking-areas/131083_237_public_smoking_area_station.csv", "3"],
    [MUSASHINO_ADAPTER, MUSASHINO_FIXTURE_RELEASE, "musashino-public-smoking-areas/doc.kml", "4"],
    [MINATO_ADAPTER, MINATO_FIXTURE_RELEASE, "minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv", "5"],
  ] as const) {
    await ensureReviewedSource(db, adapter.registry.sourceId, NOW);
    const bytes = new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${fixture}`, import.meta.url)));
    const { releaseId } = await ingestRelease(db, adapter, bytes, metadata);
    await resolveFirstRelease(db, adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds(prefix) });
  }
  await publishTiles(db, { now: NOW });
  assert.equal(count(db, "spots"), 498);
  assert.equal(count(db, "tile_snapshot_spots"), 496);
  assert.equal(count(db, "tile_snapshots"), 75);
  const originQuality = await analyzeCorpus(db, { now: QUALITY_NOW, gzip: (s) => gzipSync(s).length });
  assert.equal(originQuality.failedChecks, 0, JSON.stringify(originQuality.checks.filter((c) => c.status === "fail")));
  const bundle = await buildMultiSourcePromotionBundle(db);
  assert.equal(bundle.manifest.generator, "promotion-bundle.v3");
  assert.equal(await verifyPromotionBundle(bundle.sql, bundle.manifest.contentSha256), bundle.manifest.contentSha256);
  const expected = [TAITO_ADAPTER, OSAKA_ADAPTER, KOTO_ADAPTER, MUSASHINO_ADAPTER, MINATO_ADAPTER];
  const sourceCounts = [32, 344, 3, 3, 114];
  const target = new SqliteD1();
  applyPromotionBundle(target.raw, bundle.sql);
  assert.equal(count(target, "spots"), 496);
  assert.equal(count(target, "tile_snapshot_spots"), 496);
  assert.equal(count(target, "tile_snapshots"), 75);
  const targetQuality = await analyzeCorpus(target, { now: QUALITY_NOW, gzip: (s) => gzipSync(s).length });
  assert.equal(targetQuality.failedChecks, 0, JSON.stringify(targetQuality.checks.filter((c) => c.status === "fail")));
  assert.equal(count(target, "promotion_multi_bootstrap_completions"), 1);
  for (const [i, adapter] of expected.entries()) {
    const source = bundle.manifest.sources.find((s) => s.sourceId === adapter.registry.sourceId)!;
    assert.equal(source.rows.spot_source_entities, sourceCounts[i]);
    assert.equal(source.attributionText, adapter.registry.attributionText);
    const restored = target.raw.prepare("SELECT attribution_text, license_name, license_url FROM sources WHERE source_id = ?").get(source.sourceId)!;
    assert.equal(restored.attribution_text, adapter.registry.attributionText);
    assert.equal(restored.license_name, adapter.registry.licenseName);
    assert.equal(restored.license_url, adapter.registry.licenseUrl);
  }
  const tiles = (d: SqliteD1) => d.raw.prepare("SELECT tile_id, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id").all();
  assert.deepEqual(tiles(target), tiles(db));
  assert.equal((await buildMultiSourcePromotionBundle(target)).sql, bundle.sql);
});
