// Second reviewed source: preserve raw municipal evidence while publishing only explicit smoking listings.
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
import { OSAKA_ADAPTER, OSAKA_SOURCE_ID, OSAKA_FIXTURE_RELEASE, OSAKA_FIXTURE_SHA256,
  OSAKA_HEADER, OSAKA_ATTRIBUTION_TEXT, OSAKA_EXISTENCE_RULE } from "../src/pipeline/osaka-adapter.ts";
import { SpotDetailBodyV1 } from "../src/spots/dto.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/osaka-designated-smoking-areas/opendata_1012.csv", import.meta.url)));
const GOLDEN = new URL("./golden/osaka-pipeline.golden.json", import.meta.url);
type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const count = (db: SqliteD1, table: string) => one(db, `SELECT count(*) AS n FROM ${table}`).n;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function ingest(db: SqliteD1, meta = OSAKA_FIXTURE_RELEASE) {
  await ensureReviewedSource(db, OSAKA_SOURCE_ID, NOW);
  return ingestRelease(db, OSAKA_ADAPTER, BYTES, meta);
}
async function imported(db: SqliteD1) {
  const { releaseId } = await ingest(db);
  const result = await resolveFirstRelease(db, OSAKA_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("2") });
  return { releaseId, result };
}

test("Osaka parser pins bytes and retains all 524 raw rows; scope includes only 344 explicit designated smoking places", () => {
  assert.equal(BYTES.length, 242493);
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), OSAKA_FIXTURE_SHA256);
  const parsed = OSAKA_ADAPTER.parse(BYTES);
  assert.deepEqual(parsed.header, [...OSAKA_HEADER]);
  assert.equal(parsed.rows.length, 524);
  assert.deepEqual(Object.values(Object.groupBy(parsed.rows, (r) => r[4])).map((rows) => rows!.length).sort((a, b) => a - b), [54, 126, 344]);
  assert.ok(parsed.rows.every((r) => OSAKA_ADAPTER.upstreamRowRef(r) === null));
  const selected = parsed.rows.filter((r) => OSAKA_ADAPTER.includesRecord!(r));
  assert.equal(selected.length, 344);
  assert.ok(selected.every((r) => r[4] === "大阪市指定喫煙所" && r[14] === "大阪市指定喫煙所"));
  const r = [...selected[0]];
  for (const classification of ["コンビニエンスストア", "資源回収拠点", "喫煙所"] ) {
    r[4] = r[14] = classification;
    assert.equal(OSAKA_ADAPTER.includesRecord!(r), false);
  }
  r[4] = selected[0][4]; r[14] = "コンビニエンスストア";
  assert.throws(() => OSAKA_ADAPTER.includesRecord!(r), /conflicting classification/);
  const invalid = [...selected[0]];
  for (const [index, value] of [[13, "34,5"], [13, "91.0"], [12, "181.0"], [12, "NaN"]] as const) {
    invalid[index] = value;
    assert.throws(() => OSAKA_ADAPTER.observe(invalid), /invalid|out-of-range/);
    invalid[index] = selected[0][index];
  }
  const absentHours = [...selected[0]]; absentHours[10] = "喫煙所形態：屋外";
  assert.deepEqual(OSAKA_ADAPTER.observe(absentHours).openingHours, { status: "none", raw: null, parsed: null });
  assert.equal(OSAKA_ADAPTER.observe(selected[0]).openingHours.raw, "月曜日から日曜日（祝日含む）の7時から20時まで");
  assert.throws(() => OSAKA_ADAPTER.parse(new TextEncoder().encode("name,latitude,longitude\nx,34,135\n")), /header/);
});

test("Osaka mapping keeps hours unparsed or absent, tobacco/date unknown, and explicit existence provenance", async () => {
  const db = new SqliteD1();
  const { releaseId } = await ingest(db);
  const observations = await observeRelease(db, OSAKA_ADAPTER, releaseId);
  assert.equal(count(db, "source_records"), 524);
  assert.equal(observations.length, 344);
  assert.equal(count(db, "source_observations"), 344);
  assert.ok(observations.every((o) => o.observation.openingHours.status === "unparsed"));
  const kitano = observations.find((o) => o.observation.name === "北野たばこ店喫煙所")!;
  assert.equal(kitano.observation.openingHours.raw, "月曜日から金曜日（祝日除く）の8時から19時まで");
  assert.equal(one(db, "SELECT observed_on FROM source_releases").observed_on, null);
  for (const { observation: o } of observations) {
    assert.equal(o.supportsPaper, "unknown"); assert.equal(o.supportsHeated, "unknown");
    assert.ok(["unparsed", "none"].includes(o.openingHours.status));
    assert.equal(o.openingHours.parsed, null);
    assert.equal(o.provenance.find((p) => p.field === "existence")?.rule, OSAKA_EXISTENCE_RULE);
    assert.deepEqual(OSAKA_ADAPTER.attenuate(o), []);
  }
  assert.deepEqual(await observeRelease(db, OSAKA_ADAPTER, releaseId), observations);
  const changed = { ...OSAKA_ADAPTER, includesRecord: () => false };
  await assert.rejects(observeRelease(db, changed, releaseId), /mappingVersion/);
  await assert.rejects(rederiveObservation(db, changed, observations[0].recordId), /mappingVersion/);
  assert.equal(count(db, "source_observations"), 344);
});

test("Osaka reviewed fingerprint and adapter identity fail before canonical writes", async () => {
  for (const meta of [
    { ...OSAKA_FIXTURE_RELEASE, observedOn: "2026-09-28" },
    { ...OSAKA_FIXTURE_RELEASE, sourceUrl: "https://example.invalid/other.csv" },
  ]) {
    const db = new SqliteD1();
    const { releaseId } = await ingest(db, meta);
    await assert.rejects(resolveFirstRelease(db, OSAKA_ADAPTER, releaseId, { now: NOW }));
    assert.equal(count(db, "spots"), 0); assert.equal(count(db, "source_record_entities"), 0);
  }
  const db = new SqliteD1();
  const { releaseId } = await ingest(db);
  await assert.rejects(resolveFirstRelease(db, TAITO_ADAPTER, releaseId, { now: NOW }), /not to adapter source/);
  const os = (await observeRelease(db, OSAKA_ADAPTER, releaseId)).map((o) => o.observation);
  assert.throws(() => OSAKA_ADAPTER.assertResolvable({ ...OSAKA_FIXTURE_RELEASE, contentSha256: "0".repeat(64) }, os));
  assert.throws(() => OSAKA_ADAPTER.assertResolvable({ ...OSAKA_FIXTURE_RELEASE, contentSha256: OSAKA_FIXTURE_SHA256 }, os.slice(1)));
  assert.equal(count(db, "spots"), 0);
});

test("Osaka full pipeline has deterministic golden digests, API contracts and complete attribution", async () => {
  const db = new SqliteD1();
  const { releaseId, result } = await imported(db);
  assert.equal(result.status, "resolved");
  assert.equal(count(db, "spots"), 344);
  assert.equal(count(db, "source_record_entities"), 344);
  assert.equal(count(db, "spot_field_attenuations"), 0);
  for (const s of all(db, "SELECT * FROM spots")) {
    assert.equal(s.last_verified_at, null); assert.equal(s.host_type, null);
    assert.equal(s.spot_type, "unknown"); assert.equal(s.access_type, "unknown");
    assert.equal(s.environment, "unknown"); assert.equal(s.supports_paper, "unknown");
    assert.equal(s.supports_heated, "unknown"); assert.equal(s.evidence_quality, "officialListing");
  }
  assert.deepEqual(await resolveFirstRelease(db, OSAKA_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
  assert.equal((await ingest(db)).created, false);
  const report = await publishTiles(db, { now: NOW });
  assert.equal(report.published.reduce((n, t) => n + t.spotCount, 0), 344);
  const tiles = [];
  for (const t of report.published) {
    const response = await app.request(`/v1/tiles/${t.tileId}`, {}, { DB: db });
    assert.equal(response.status, 200);
    const cached = await app.request(`/v1/tiles/${t.tileId}`, { headers: { "If-None-Match": response.headers.get("etag")! } }, { DB: db });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("etag"), response.headers.get("etag"));
    assert.equal(await cached.text(), "");
    const body = TileBodyV1.parse(await response.json());
    assert.equal(body.sources[0].attributionText, OSAKA_ATTRIBUTION_TEXT);
    assert.deepEqual(body.sources.map((s) => s.id), [OSAKA_SOURCE_ID]);
    assert.ok(body.spots.every((s) => s.lastVerifiedAt === null && s.supportsPaper === "unknown" && s.supportsHeated === "unknown"));
    tiles.push({ tile: t.tileId, etag: response.headers.get("etag"), digest: digest(body), spots: body.spots.length });
  }
  const id = one(db, "SELECT spot_id FROM spots ORDER BY spot_id LIMIT 1").spot_id;
  const detailResponse = await app.request(`/v1/spots/${id}`, {}, { DB: db });
  assert.equal(detailResponse.status, 200);
  const detail = SpotDetailBodyV1.parse(await detailResponse.json());
  assert.equal(detail.spot.lastVerifiedAt, null);
  assert.equal(detail.sources[0].attributionText, OSAKA_ATTRIBUTION_TEXT);
  assert.ok(detail.provenance.every((p) => p.observedOn === null && p.sourceId === OSAKA_SOURCE_ID));
  assert.equal(detail.provenance.find((p) => p.field === "existence")?.rule, OSAKA_EXISTENCE_RULE);
  const tables: Record<string, { count: number; digest: string }> = {};
  for (const table of ["source_releases", "source_records", "source_observations", "source_entities", "source_record_entities", "spots", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots"]) {
    const rows = all(db, `SELECT * FROM ${table} ORDER BY 1`);
    tables[table] = { count: rows.length, digest: digest(rows) };
  }
  const actual = JSON.stringify({ sourceId: OSAKA_SOURCE_ID, fixtureSha256: OSAKA_FIXTURE_SHA256, publishedSpots: 344, tables, tiles, detailDigest: digest(detail) }, null, 2) + "\n";
  if (process.env.GOLDEN_UPDATE === "1") writeFileSync(GOLDEN, actual);
  assert.equal(actual, readFileSync(GOLDEN, "utf8"));
});

test("two real reviewed sources import independently; blocking Osaka withdraws only its spots and detail", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  const { releaseId } = await imported(db);
  assert.equal(count(db, "spots"), 378);
  await publishTiles(db, { now: NOW });
  assert.equal(count(db, "tile_snapshot_spots"), 376);
  const id = one(db, "SELECT spot_id FROM spots WHERE spot_id LIKE 'sp_2%' LIMIT 1").spot_id;
  db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(OSAKA_SOURCE_ID);
  assert.equal((await app.request(`/v1/spots/${id}`, {}, { DB: db })).status, 404);
  await publishTiles(db, { now: NOW });
  assert.equal(count(db, "tile_snapshot_spots"), 32);
  assert.ok(all(db, "SELECT body_json FROM tile_snapshots").every((t) => !JSON.parse(t.body_json).sources.some((s: Row) => s.id === OSAKA_SOURCE_ID)));
  assert.deepEqual(await resolveFirstRelease(db, OSAKA_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
  const next = await ingest(db, { ...OSAKA_FIXTURE_RELEASE, fetchedAt: "2026-10-01T00:00:00Z", observedOn: "2026-10-01" });
  await assert.rejects(resolveFirstRelease(db, OSAKA_ADAPTER, next.releaseId, { now: NOW }), /cross-release reconciliation is not implemented/);
  assert.equal(count(db, "spots"), 378);
});

test("Osaka scope expansion requires a new mappingVersion for an existing observation generation", async () => {
  const db = new SqliteD1();
  const { releaseId } = await ingest(db);
  const excludedName = OSAKA_ADAPTER.parse(BYTES).rows.find((r) => OSAKA_ADAPTER.includesRecord!(r))![0];
  const narrower = { ...OSAKA_ADAPTER, includesRecord: (values: readonly string[]) =>
    OSAKA_ADAPTER.includesRecord!(values) && values[0] !== excludedName };
  const first = await observeRelease(db, narrower, releaseId);
  assert.equal(first.length, 343);
  await assert.rejects(observeRelease(db, OSAKA_ADAPTER, releaseId), /scope changed.*new mappingVersion/);
  assert.equal(count(db, "source_observations"), 343, "refused expansion writes nothing");
  const next = await observeRelease(db, { ...OSAKA_ADAPTER, mappingVersion: "test-osaka-expanded.v2" }, releaseId);
  assert.equal(next.length, 344);
  assert.equal(count(db, "source_observations"), 687, "a new generation preserves the old one");
});
