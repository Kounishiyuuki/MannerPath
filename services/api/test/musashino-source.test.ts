import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { MUSASHINO_ADAPTER as A, MUSASHINO_FIXTURE_RELEASE as META, MUSASHINO_FIXTURE_SHA256 as SHA } from "../src/pipeline/musashino-adapter.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE } from "../src/pipeline/koto-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE } from "../src/pipeline/osaka-adapter.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { observeRelease } from "../src/pipeline/observe.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { buildMultiSourcePromotionBundle, verifyPromotionBundle } from "../src/pipeline/promotion.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { app } from "../src/app.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { SqliteD1, applyPromotionBundle } from "./support/sqlite-d1.ts";
import { importTaito, sequentialSpotIds } from "./support/fixture.ts";

const NOW = "2026-09-30T00:00:00Z";
const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/musashino-public-smoking-areas/doc.kml", import.meta.url)));
const bytes = (s: string) => new TextEncoder().encode(s);
const xml = new TextDecoder().decode(BYTES);
const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
async function imported(db: SqliteD1) {
  await ensureReviewedSource(db, A.registry.sourceId, NOW);
  const r = await ingestRelease(db, A, BYTES, META);
  const result = await resolveFirstRelease(db, A, r.releaseId, { now: NOW, newSpotId: sequentialSpotIds("4") });
  return { ...r, result };
}

test("Musashino immutable member and archive SHA, exact smoking scope and duplicate refusal", () => {
  const archive = readFileSync(new URL("../../data-pipeline/fixtures/musashino-public-smoking-areas/toilet.zip", import.meta.url));
  assert.equal(createHash("sha256").update(archive).digest("hex"), "3cc620efb082a2b6ee1f30b757dd35d26691924d427dc0c4812d654e009b3f5c");
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), SHA);
  assert.equal(BYTES.length, 28067);
  const { rows } = A.parse(BYTES);
  assert.equal(rows.length, 25);
  const selected = rows.filter(A.includesRecord!);
  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map((r) => A.observe(r).name), ["吉祥寺駅喫煙所", "武蔵境駅喫煙所", "三鷹駅北口喫煙所"]);
  assert.deepEqual(selected.map(A.upstreamRowRef), ["1", "3", "2"]);
  assert.ok(rows.filter((r) => !A.includesRecord!(r)).every((r) => A.upstreamRowRef(r) === null));
  const first = selected[0][0];
  const second = selected[1][0];
  assert.throws(() => A.parse(bytes(xml.replace(second, first))), /duplicate/);
  const firstPoint = first.match(/<coordinates>[^<]*<\/coordinates>/)![0];
  assert.throws(() => A.parse(bytes(xml.replace(second, second.replace(/<coordinates>[^<]*<\/coordinates>/, firstPoint)))), /duplicate/);
  assert.throws(() => A.parse(bytes(xml.replace(first, ""))), /row count/);
  assert.throws(() => A.parse(bytes(xml.replaceAll("#inline3", "#inline4"))), /category/);
  assert.throws(() => A.parse(new Uint8Array([0xff])), /encoding|encoded/);
});

test("Musashino supplied WGS84 smoking Point rejects invalid coordinates and unsupported fields", () => {
  const selected = A.parse(BYTES).rows.filter(A.includesRecord!);
  const row = selected[0][0];
  assert.equal(A.observe([row]).longitude, 139.58007563093057);
  assert.equal(A.observe([row]).latitude, 35.7021543595292);
  for (const point of ["NaN,35.7,0.0", "139.5,91.0,0.0", "35.7,139.5,0.0", "139.5,,0.0", "139.5,35.7", "139.5,35.7,1.0", "139.5,35.7,0.0 139.6,35.7,0.0"]) {
    assert.throws(() => A.observe([row.replace(/<coordinates>[^<]*<\/coordinates>/, `<coordinates>${point}</coordinates>`)]), /coordinates/);
  }
  assert.throws(() => A.observe([row.replace("吉祥寺駅喫煙所", "コンビニ")]), /name/);
  assert.throws(() => A.observe([row.replace("<Point>", "<Polygon>").replace("</Point>", "</Polygon>")]), /Point/);
  assert.throws(() => A.observe([row.replace('</ExtendedData>', '<SimpleData name="名称">duplicate</SimpleData></ExtendedData>')]), /XML field/);
  assert.throws(() => A.observe([]), /shape/);
  assert.throws(() => A.parse(bytes(xml.replace("<Document>", '<!DOCTYPE kml><Document>'))), /schema/);
});

test("Musashino first release is idempotent; dates and unsupported attributes remain unknown", async () => {
  const db = new SqliteD1();
  const r = await imported(db);
  assert.equal(r.result.status, "resolved");
  assert.equal(count(db, "source_records"), 25);
  assert.equal(count(db, "source_observations"), 3);
  assert.equal(count(db, "spots"), 3);
  for (const o of await observeRelease(db, A, r.releaseId)) {
    assert.deepEqual(o.observation.openingHours, { status: "none", raw: null, parsed: null });
    assert.equal(o.observation.supportsPaper, "unknown"); assert.equal(o.observation.supportsHeated, "unknown");
    assert.ok(o.observation.provenance.some((p) => p.field === "existence"));
  }
  const states = db.raw.prepare("SELECT last_verified_at, spot_type, access_type, environment, host_type FROM spots").all();
  assert.ok(states.every((s) => s.last_verified_at === null && s.spot_type === "unknown" && s.access_type === "unknown" && s.environment === "unknown" && s.host_type === null));
  assert.equal((await imported(db)).created, false);
  assert.deepEqual(await resolveFirstRelease(db, A, r.releaseId, { now: NOW }), { status: "alreadyApplied" });
  assert.equal(A.crossReleaseValidated, false); assert.equal(A.completeness, "partial"); assert.equal(A.refreshTarget, undefined);
  const next = await ingestRelease(db, A, BYTES, { ...META, observedOn: "2026-09-30" });
  await assert.rejects(resolveFirstRelease(db, A, next.releaseId, { now: NOW }), /cross-release/);
});

test("Musashino fingerprint gate fails closed and registry blocking removes published tiles", async () => {
  for (const meta of [{ ...META, sourceUrl: "https://example.invalid/other.kml" }, { ...META, observedOn: "2022-01-01" }]) {
    const db = new SqliteD1(); await ensureReviewedSource(db, A.registry.sourceId, NOW);
    const r = await ingestRelease(db, A, BYTES, meta);
    await assert.rejects(resolveFirstRelease(db, A, r.releaseId, { now: NOW }), /fingerprint/);
    assert.equal(count(db, "spots"), 0);
  }
  const db = new SqliteD1(); await ensureReviewedSource(db, A.registry.sourceId, NOW);
  const changed = await ingestRelease(db, A, bytes(xml.replace("139.58007563093057", "139.58007563093058")), META);
  await assert.rejects(resolveFirstRelease(db, A, changed.releaseId, { now: NOW }), /fingerprint/);
  assert.equal(count(db, "spots"), 0);
  const valid = new SqliteD1(); await imported(valid); await publishTiles(valid, { now: NOW });
  assert.equal(count(valid, "tile_snapshot_spots"), 3);
  valid.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(A.registry.sourceId);
  await publishTiles(valid, { now: NOW });
  assert.equal(count(valid, "tile_snapshot_spots"), 0);
});

test("combined baseline plus Musashino preserves attribution, quality and v3 fresh bootstrap", async () => {
  const db = new SqliteD1(); await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  for (const [a, meta, path, prefix] of [
    [OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, "osaka-designated-smoking-areas/opendata_1012.csv", "2"],
    [KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, "koto-station-smoking-areas/131083_237_public_smoking_area_station.csv", "3"],
  ] as const) {
    await ensureReviewedSource(db, a.registry.sourceId, NOW);
    const r = await ingestRelease(db, a, new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${path}`, import.meta.url))), meta);
    await resolveFirstRelease(db, a, r.releaseId, { now: NOW, newSpotId: sequentialSpotIds(prefix) });
  }
  await imported(db); await publishTiles(db, { now: NOW });
  assert.equal(count(db, "spots"), 384);
  assert.equal(count(db, "tile_snapshot_spots"), 382);
  const quality = await analyzeCorpus(db, { now: NOW, gzip: (s) => gzipSync(s).length });
  assert.equal(quality.failedChecks, 0, JSON.stringify(quality.checks.filter((c) => c.status === "fail")));
  for (const tile of db.raw.prepare("SELECT tile_id FROM tile_snapshots WHERE tile_id IN (SELECT tile_id FROM spots WHERE resolver_version = ?)").all(A.resolverVersion)) {
    const response = await app.request(`/v1/tiles/${tile.tile_id}`, {}, { DB: db });
    const body = TileBodyV1.parse(await response.json());
    assert.equal(body.sources.find((s) => s.id === A.registry.sourceId)?.attributionText, A.registry.attributionText);
  }
  const bundle = await buildMultiSourcePromotionBundle(db);
  assert.equal(bundle.manifest.sources.length, 4);
  assert.equal(await verifyPromotionBundle(bundle.sql, bundle.manifest.contentSha256), bundle.manifest.contentSha256);
  const target = new SqliteD1(); applyPromotionBundle(target.raw, bundle.sql);
  assert.equal(count(target, "sources"), 4);
  assert.equal(count(target, "spots"), 382); // v3 carries published canonical rows, not held baseline rows.
  assert.equal(count(target, "tile_snapshot_spots"), 382);
  assert.equal(count(target, "source_observations"), 0); // Explicit current ADR-0008/0018 contract.
  assert.equal((await analyzeCorpus(target, { now: NOW, gzip: (s) => gzipSync(s).length })).failedChecks, 0);
  assert.equal((await buildMultiSourcePromotionBundle(target)).sql, bundle.sql);
});
