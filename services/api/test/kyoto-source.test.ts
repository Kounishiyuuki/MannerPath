// Kyoto facility-list source: only the city's own 喫煙場所 category is published, minus the reviewed
// 西大路 conflict; every other facility row stays raw evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, KOTO_SOURCE_ID } from "../src/pipeline/koto-adapter.ts";
import { KYOTO_ADAPTER, KYOTO_ATTRIBUTION_TEXT, KYOTO_CONFLICT_EXCLUDED_IDS, KYOTO_EXISTENCE_RULE,
  KYOTO_FIXTURE_RELEASE, KYOTO_FIXTURE_SHA256, KYOTO_SOURCE_ID } from "../src/pipeline/kyoto-adapter.ts";
import { observeRelease } from "../src/pipeline/observe.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../src/pipeline/osaka-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { SpotDetailBodyV1 } from "../src/spots/dto.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${path}`, import.meta.url)));
const BYTES = fixture("kyoto-public-smoking-places/20260903_shisetsu.csv");
const GOLDEN = new URL("./golden/kyoto-pipeline.golden.json", import.meta.url);
type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const count = (db: SqliteD1, table: string) => one(db, `SELECT count(*) AS n FROM ${table}`).n;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const REVIEWED_IDS = [
  "1000001772", "1000001773", "1000001774", "1000001775", "1000001776", "1000001777", "1000001778", "1000001779",
  "1000001780", "1000001782", "1000001783", "1000001784", "1000001785", "1000001886", "1000001887", "1000001888",
  "1000001889",
];
async function imported(db: SqliteD1, meta = KYOTO_FIXTURE_RELEASE) {
  await ensureReviewedSource(db, KYOTO_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, KYOTO_ADAPTER, BYTES, meta);
  return { releaseId, result: await resolveFirstRelease(db, KYOTO_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("4") }) };
}

test("Kyoto selects exactly the reviewed category-138 places and fails closed on category drift", () => {
  const { rows } = KYOTO_ADAPTER.parse(BYTES);
  const smoking = rows.filter((r) => r[7] === "138");
  assert.equal(smoking.length, 19);
  const selected = rows.filter((r) => KYOTO_ADAPTER.includesRecord!(r));
  assert.deepEqual(selected.map((r) => KYOTO_ADAPTER.upstreamRowRef(r)), REVIEWED_IDS);
  assert.deepEqual(smoking.filter((r) => !selected.includes(r)).map((r) => r[2]), [...KYOTO_CONFLICT_EXCLUDED_IDS]);
  assert.ok(selected.every((r) => KYOTO_ADAPTER.observe(r).name!.endsWith("喫煙場所")));
  // Other facilities (e.g. public toilets, category 137) are never observations.
  assert.ok(rows.some((r) => r[7] === "137"));
  const original = selected[0];
  for (const [index, value] of [[3, "四条西木屋町公衆トイレ"], [1, "別の課"], [16, "https://example.invalid/"], [18, "9:00～17:00"],
    [20, "無料"], [2, "1000001772 "]] as const) {
    const drifted = [...original]; drifted[index] = value;
    assert.throws(() => KYOTO_ADAPTER.includesRecord!(drifted), /explicit city smoking place|does not review/);
  }
  for (const [index, value] of [[5, "91.0"], [6, "181.0"], [5, "35,0"]] as const) {
    const invalid = [...original]; invalid[index] = value;
    assert.throws(() => KYOTO_ADAPTER.observe(invalid), /invalid|out-of-range/);
  }
  assert.throws(() => KYOTO_ADAPTER.parse(new TextEncoder().encode("name,lat,lng\nx,35,135\n")), /header/);
});

test("Kyoto keeps unknowns unknown and dates evidence by the publisher's as-of date only", async () => {
  const db = new SqliteD1();
  const { releaseId, result } = await imported(db);
  assert.equal(result.status, "resolved");
  assert.equal(count(db, "source_records"), 1777);
  assert.equal(count(db, "source_observations"), 17);
  assert.equal(one(db, "SELECT observed_on FROM source_releases").observed_on, "2026-09-03");
  for (const { observation: o } of await observeRelease(db, KYOTO_ADAPTER, releaseId)) {
    assert.deepEqual(o.openingHours, { status: "none", raw: null, parsed: null });
    assert.equal(o.supportsPaper, "unknown"); assert.equal(o.supportsHeated, "unknown");
    assert.equal(o.provenance.find((p) => p.field === "existence")?.rule, KYOTO_EXISTENCE_RULE);
  }
  for (const s of all(db, "SELECT * FROM spots")) {
    assert.equal(s.last_verified_at, "2026-09-03"); assert.equal(s.host_type, null);
    assert.equal(s.spot_type, "unknown"); assert.equal(s.access_type, "unknown"); assert.equal(s.environment, "unknown");
  }
});

test("Kyoto reviewed fingerprint fails before canonical writes", async () => {
  for (const meta of [{ ...KYOTO_FIXTURE_RELEASE, observedOn: null }, { ...KYOTO_FIXTURE_RELEASE, sourceUrl: "https://example.invalid/x.csv" }]) {
    const db = new SqliteD1();
    await assert.rejects(imported(db, meta), /fingerprint|reviewed/);
    assert.equal(count(db, "spots"), 0); assert.equal(count(db, "source_entities"), 0);
  }
});

test("Kyoto full pipeline has deterministic golden digests, API contracts and attribution", async () => {
  const db = new SqliteD1();
  await imported(db);
  const report = await publishTiles(db, { now: NOW });
  assert.equal(report.published.reduce((n, t) => n + t.spotCount, 0), 17);
  const tiles = [];
  for (const t of report.published) {
    const response = await app.request(`/v1/tiles/${t.tileId}`, {}, { DB: db });
    assert.equal(response.status, 200);
    const body = TileBodyV1.parse(await response.json());
    assert.deepEqual(body.sources.map((s) => [s.id, s.attributionText]), [[KYOTO_SOURCE_ID, KYOTO_ATTRIBUTION_TEXT]]);
    tiles.push({ tile: t.tileId, etag: response.headers.get("etag"), digest: digest(body), spots: body.spots.length });
  }
  const id = one(db, "SELECT spot_id FROM spots ORDER BY spot_id LIMIT 1").spot_id;
  const detail = SpotDetailBodyV1.parse(await (await app.request(`/v1/spots/${id}`, {}, { DB: db })).json());
  assert.equal(detail.sources[0].attributionText, KYOTO_ATTRIBUTION_TEXT);
  assert.ok(detail.provenance.every((p) => p.observedOn === "2026-09-03" && p.sourceId === KYOTO_SOURCE_ID));
  const tables: Record<string, { count: number; digest: string }> = {};
  for (const table of ["source_releases", "source_records", "source_observations", "source_entities", "source_record_entities", "spots", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots"]) {
    const rows = all(db, `SELECT * FROM ${table} ORDER BY 1`);
    tables[table] = { count: rows.length, digest: digest(rows) };
  }
  const actual = JSON.stringify({ sourceId: KYOTO_SOURCE_ID, fixtureSha256: KYOTO_FIXTURE_SHA256, publishedSpots: 17, tables, tiles, detailDigest: digest(detail) }, null, 2) + "\n";
  if (process.env.GOLDEN_UPDATE === "1") writeFileSync(GOLDEN, actual);
  assert.equal(actual, readFileSync(GOLDEN, "utf8"));
});

test("four reviewed municipal sources coexist; Kyoto withdrawal cannot contaminate the others", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  await ensureReviewedSource(db, OSAKA_SOURCE_ID, NOW);
  const osaka = await ingestRelease(db, OSAKA_ADAPTER, fixture("osaka-designated-smoking-areas/opendata_1012.csv"), OSAKA_FIXTURE_RELEASE);
  await resolveFirstRelease(db, OSAKA_ADAPTER, osaka.releaseId, { now: NOW, newSpotId: sequentialSpotIds("2") });
  await ensureReviewedSource(db, KOTO_SOURCE_ID, NOW);
  const koto = await ingestRelease(db, KOTO_ADAPTER, fixture("koto-station-smoking-areas/131083_237_public_smoking_area_station.csv"), KOTO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, KOTO_ADAPTER, koto.releaseId, { now: NOW, newSpotId: sequentialSpotIds("3") });
  const { releaseId } = await imported(db);
  assert.equal(count(db, "spots"), 398);
  await publishTiles(db, { now: NOW });
  assert.equal(count(db, "tile_snapshot_spots"), 396);
  db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(KYOTO_SOURCE_ID);
  await publishTiles(db, { now: NOW });
  assert.equal(count(db, "tile_snapshot_spots"), 379);
  assert.ok(all(db, "SELECT body_json FROM tile_snapshots").every((t) => !JSON.parse(t.body_json).sources.some((s: Row) => s.id === KYOTO_SOURCE_ID)));
  const next = await ingestRelease(db, KYOTO_ADAPTER, BYTES, { ...KYOTO_FIXTURE_RELEASE, observedOn: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z" });
  await assert.rejects(resolveFirstRelease(db, KYOTO_ADAPTER, next.releaseId, { now: NOW }), /cross-release reconciliation is not implemented/);
  assert.deepEqual(await resolveFirstRelease(db, KYOTO_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
  assert.equal(count(db, "spots"), 398);
});
