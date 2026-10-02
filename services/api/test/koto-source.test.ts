// Koto station source: preserve explicit municipal smoking-location evidence and unknown fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { observeRelease, rederiveObservation } from "../src/pipeline/observe.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_SOURCE_ID, OSAKA_FIXTURE_RELEASE } from "../src/pipeline/osaka-adapter.ts";
import { KOTO_ADAPTER, KOTO_SOURCE_ID, KOTO_FIXTURE_RELEASE, KOTO_FIXTURE_SHA256,
  KOTO_HEADER, KOTO_ATTRIBUTION_TEXT, KOTO_EXISTENCE_RULE } from "../src/pipeline/koto-adapter.ts";
import { SpotDetailBodyV1 } from "../src/spots/dto.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/koto-station-smoking-areas/131083_237_public_smoking_area_station.csv", import.meta.url)));
const GOLDEN = new URL("./golden/koto-pipeline.golden.json", import.meta.url);
type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const count = (db: SqliteD1, table: string) => one(db, `SELECT count(*) AS n FROM ${table}`).n;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function ingest(db: SqliteD1, meta = KOTO_FIXTURE_RELEASE) {
  await ensureReviewedSource(db, KOTO_SOURCE_ID, NOW);
  return ingestRelease(db, KOTO_ADAPTER, BYTES, meta);
}
async function imported(db: SqliteD1) {
  const { releaseId } = await ingest(db);
  const result = await resolveFirstRelease(db, KOTO_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("3") });
  return { releaseId, result };
}

test("Koto CP932 fixture retains three explicit public smoking locations and rejects schema/coordinate drift", () => {
  assert.equal(BYTES.length, 314);
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), KOTO_FIXTURE_SHA256);
  const parsed = KOTO_ADAPTER.parse(BYTES);
  assert.deepEqual(parsed.header, [...KOTO_HEADER]);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows.map((r) => KOTO_ADAPTER.observe(r).name), ["辰巳駅前公衆喫煙所", "新木場駅前公衆喫煙所", "潮見駅前公衆喫煙所"]);
  assert.ok(parsed.rows.every((r) => KOTO_ADAPTER.upstreamRowRef(r) === null));
  const original = parsed.rows[0];
  for (const [index, value] of [[0, "35,6"], [0, "91.0"], [1, "181.0"], [1, "NaN"], [0, ""], [2, ""], [2, "コンビニエンスストア"], [2, "辰巳駅"]] as const) {
    const invalid = [...original]; invalid[index] = value;
    assert.throws(() => KOTO_ADAPTER.observe(invalid), /invalid|out-of-range|name|名称|喫煙所名/);
  }
  assert.throws(() => KOTO_ADAPTER.observe(original.slice(1)), /width/);
  assert.throws(() => KOTO_ADAPTER.parse(new Uint8Array([0x81])), /encoded data|encoding/);
  assert.deepEqual(KOTO_ADAPTER.observe(original).provenance.find((p) => p.field === "location")?.columns, ["緯度", "経度"]);
  assert.equal(KOTO_ADAPTER.observe(original).latitude, 35.64690292565758);
  assert.equal(KOTO_ADAPTER.observe(original).longitude, 139.80896821475952);
  assert.throws(() => KOTO_ADAPTER.parse(new TextEncoder().encode("name,latitude,longitude\nx,35,139\n")), /header/);
  // ASCII shares CP932's encoding: a valid reviewed header followed by a short row must fail.
  const header = new TextDecoder("shift_jis").decode(BYTES).split(/\r?\n/)[0];
  const headerBytes = BYTES.slice(0, BYTES.indexOf(10) + 1);
  const short = new Uint8Array([...headerBytes, ...new TextEncoder().encode("35.6,139.8\n")]);
  assert.ok(header.includes("喫煙所名"));
  assert.throws(() => KOTO_ADAPTER.parse(short), /fields/);
});

test("Koto mapping keeps hours absent, tobacco/date unknown, and explicit existence provenance", async () => {
  const db = new SqliteD1();
  const { releaseId } = await ingest(db);
  const observations = await observeRelease(db, KOTO_ADAPTER, releaseId);
  assert.equal(count(db, "source_records"), 3);
  assert.equal(observations.length, 3);
  assert.equal(count(db, "source_observations"), 3);
  assert.ok(observations.every((o) => o.observation.openingHours.status === "none"));
  assert.equal(one(db, "SELECT observed_on FROM source_releases").observed_on, null);
  for (const { observation: o } of observations) {
    assert.equal(o.supportsPaper, "unknown"); assert.equal(o.supportsHeated, "unknown");
    assert.deepEqual(o.openingHours, { status: "none", raw: null, parsed: null });
    assert.ok(o.provenance.every((p) => !["openingHours", "supportsPaper", "supportsHeated"].includes(p.field)));
    assert.equal(o.openingHours.parsed, null);
    assert.equal(o.provenance.find((p) => p.field === "existence")?.rule, KOTO_EXISTENCE_RULE);
    assert.deepEqual(KOTO_ADAPTER.attenuate(o), []);
  }
  assert.deepEqual(await observeRelease(db, KOTO_ADAPTER, releaseId), observations);
  const changed = { ...KOTO_ADAPTER, observe: (r: readonly string[]) => ({ ...KOTO_ADAPTER.observe(r), name: "changed" }) };
  await assert.rejects(observeRelease(db, changed, releaseId), /mappingVersion/);
  await assert.rejects(rederiveObservation(db, changed, observations[0].recordId), /re-derives differently/);
  assert.equal(count(db, "source_observations"), 3);
});

test("Koto reviewed fingerprint and adapter identity fail before canonical writes", async () => {
  for (const meta of [
    { ...KOTO_FIXTURE_RELEASE, observedOn: "2026-09-28" },
    { ...KOTO_FIXTURE_RELEASE, sourceUrl: "https://example.invalid/other.csv" },
  ]) {
    const db = new SqliteD1();
    const { releaseId } = await ingest(db, meta);
    await assert.rejects(resolveFirstRelease(db, KOTO_ADAPTER, releaseId, { now: NOW }));
    assert.equal(count(db, "spots"), 0); assert.equal(count(db, "source_record_entities"), 0);
  }
  const changedDb = new SqliteD1();
  await ensureReviewedSource(changedDb, KOTO_SOURCE_ID, NOW);
  const changedBytes = BYTES.slice();
  const firstRow = changedBytes.indexOf(10) + 1;
  changedBytes[firstRow + 4] = 55; // 35.646... -> 35.676..., still valid syntax.
  const changedRelease = await ingestRelease(changedDb, KOTO_ADAPTER, changedBytes, KOTO_FIXTURE_RELEASE);
  await assert.rejects(resolveFirstRelease(changedDb, KOTO_ADAPTER, changedRelease.releaseId, { now: NOW }), /fingerprint|reviewed/);
  assert.equal(count(changedDb, "spots"), 0);
  assert.equal(count(changedDb, "source_entities"), 0);
  assert.equal(count(changedDb, "spot_field_provenance"), 0);
  const db = new SqliteD1();
  const { releaseId } = await ingest(db);
  await assert.rejects(resolveFirstRelease(db, TAITO_ADAPTER, releaseId, { now: NOW }), /not to adapter source/);
  const os = (await observeRelease(db, KOTO_ADAPTER, releaseId)).map((o) => o.observation);
  assert.throws(() => KOTO_ADAPTER.assertResolvable({ ...KOTO_FIXTURE_RELEASE, contentSha256: "0".repeat(64) }, os));
  assert.throws(() => KOTO_ADAPTER.assertResolvable({ ...KOTO_FIXTURE_RELEASE, contentSha256: KOTO_FIXTURE_SHA256 }, os.slice(1)));
  assert.equal(count(db, "spots"), 0);
});

test("Koto full pipeline has deterministic golden digests, API contracts and complete attribution", async () => {
  const db = new SqliteD1();
  const { releaseId, result } = await imported(db);
  assert.equal(result.status, "resolved");
  assert.equal(count(db, "spots"), 3);
  assert.equal(count(db, "source_record_entities"), 3);
  assert.equal(count(db, "spot_field_attenuations"), 0);
  for (const s of all(db, "SELECT * FROM spots")) {
    assert.equal(s.last_verified_at, null); assert.equal(s.host_type, null);
    assert.equal(s.spot_type, "unknown"); assert.equal(s.access_type, "unknown");
    assert.equal(s.environment, "unknown"); assert.equal(s.supports_paper, "unknown");
    assert.equal(s.supports_heated, "unknown"); assert.equal(s.evidence_quality, "officialListing");
  }
  assert.deepEqual(await resolveFirstRelease(db, KOTO_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
  assert.equal((await ingest(db)).created, false);
  const report = await publishTiles(db, { now: NOW });
  assert.equal(report.published.reduce((n, t) => n + t.spotCount, 0), 3);
  const tiles = [];
  for (const t of report.published) {
    const response = await app.request(`/v1/tiles/${t.tileId}`, {}, { DB: db });
    assert.equal(response.status, 200);
    const cached = await app.request(`/v1/tiles/${t.tileId}`, { headers: { "If-None-Match": response.headers.get("etag")! } }, { DB: db });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("etag"), response.headers.get("etag"));
    assert.equal(await cached.text(), "");
    const body = TileBodyV1.parse(await response.json());
    assert.equal(body.sources[0].attributionText, KOTO_ATTRIBUTION_TEXT);
    assert.deepEqual(body.sources.map((s) => s.id), [KOTO_SOURCE_ID]);
    assert.ok(body.spots.every((s) => s.lastVerifiedAt === null && s.supportsPaper === "unknown" && s.supportsHeated === "unknown"));
    tiles.push({ tile: t.tileId, etag: response.headers.get("etag"), digest: digest(body), spots: body.spots.length });
  }
  const id = one(db, "SELECT spot_id FROM spots ORDER BY spot_id LIMIT 1").spot_id;
  const detailResponse = await app.request(`/v1/spots/${id}`, {}, { DB: db });
  assert.equal(detailResponse.status, 200);
  const detail = SpotDetailBodyV1.parse(await detailResponse.json());
  assert.equal(detail.spot.lastVerifiedAt, null);
  assert.equal(detail.sources[0].attributionText, KOTO_ATTRIBUTION_TEXT);
  assert.ok(detail.provenance.every((p) => p.observedOn === null && p.sourceId === KOTO_SOURCE_ID));
  assert.equal(detail.provenance.find((p) => p.field === "existence")?.rule, KOTO_EXISTENCE_RULE);
  const tables: Record<string, { count: number; digest: string }> = {};
  for (const table of ["source_releases", "source_records", "source_observations", "source_entities", "source_record_entities", "spots", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_parts", "tile_snapshot_spots"]) {
    const rows = all(db, `SELECT * FROM ${table} ORDER BY 1`);
    tables[table] = { count: rows.length, digest: digest(rows) };
  }
  const actual = JSON.stringify({ sourceId: KOTO_SOURCE_ID, fixtureSha256: KOTO_FIXTURE_SHA256, publishedSpots: 3, tables, tiles, detailDigest: digest(detail) }, null, 2) + "\n";
  if (process.env.GOLDEN_UPDATE === "1") writeFileSync(GOLDEN, actual);
  assert.equal(actual, readFileSync(GOLDEN, "utf8"));
});

test("three reviewed municipal sources coexist; Koto withdrawal cannot contaminate Taito or Osaka", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  await ensureReviewedSource(db, OSAKA_SOURCE_ID, NOW);
  const osakaBytes = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/osaka-designated-smoking-areas/opendata_1012.csv", import.meta.url)));
  const osaka = await ingestRelease(db, OSAKA_ADAPTER, osakaBytes, OSAKA_FIXTURE_RELEASE);
  await resolveFirstRelease(db, OSAKA_ADAPTER, osaka.releaseId, { now: NOW, newSpotId: sequentialSpotIds("2") });
  const { releaseId } = await imported(db);
  assert.equal(count(db, "spots"), 381);
  await publishTiles(db, { now: NOW });
  assert.equal(count(db, "tile_snapshot_spots"), 379);
  const kotoId = one(db, "SELECT spot_id FROM spots WHERE spot_id LIKE 'sp_3%' LIMIT 1").spot_id;
  const osakaId = one(db, "SELECT spot_id FROM spots WHERE spot_id LIKE 'sp_2%' LIMIT 1").spot_id;
  db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(KOTO_SOURCE_ID);
  assert.equal((await app.request(`/v1/spots/${kotoId}`, {}, { DB: db })).status, 404);
  assert.equal((await app.request(`/v1/spots/${osakaId}`, {}, { DB: db })).status, 200);
  await publishTiles(db, { now: NOW });
  assert.equal(count(db, "tile_snapshot_spots"), 376);
  assert.ok(v1TileRows(db).every((t) => !JSON.parse(t.body_json).sources.some((s: Row) => s.id === KOTO_SOURCE_ID)));
  assert.deepEqual(await resolveFirstRelease(db, KOTO_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
  assert.equal(KOTO_ADAPTER.crossReleaseValidated, false);
  assert.equal(KOTO_ADAPTER.completeness, "partial");
  assert.equal(KOTO_ADAPTER.refreshTarget, undefined);
  const next = await ingest(db, { ...KOTO_FIXTURE_RELEASE, fetchedAt: "2026-10-01T00:00:00Z", observedOn: "2026-10-01" });
  await assert.rejects(resolveFirstRelease(db, KOTO_ADAPTER, next.releaseId, { now: NOW }), /cross-release reconciliation is not implemented/);
  assert.equal(count(db, "spots"), 381);
});
