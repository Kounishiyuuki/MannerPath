// Normalized source observation layer (ADR-0008 decision 2, Issue #73): raw records are mapped by
// the adapter into immutable, deterministic observations, and the resolver reads those, not raw
// source columns. Canonical output parity is held by test/golden-parity.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { observeRelease } from "../src/pipeline/observe.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_MAPPING_VERSION, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import {
  NOW, TAITO_BYTES, TEST_BLOCKED_SOURCE, TEST_BLOCKED_TAITO_ADAPTER, addBlockedTestSource, importTaito, sequentialSpotIds,
} from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as Row).n;

async function ingestTaito(db: SqliteD1): Promise<number> {
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  return (await ingestRelease(db, TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE)).releaseId;
}

test("the Taito release maps to 34 observations, one per raw record, bound to its record, release and source", async () => {
  const db = new SqliteD1();
  const releaseId = await ingestTaito(db);
  const observed = await observeRelease(db, TAITO_ADAPTER, releaseId);
  assert.equal(observed.length, 34);
  const rows = all(db,
    `SELECT o.record_id, o.release_id, o.source_id, o.mapping_version, r.release_id AS record_release, rel.source_id AS release_source
     FROM source_observations o JOIN source_records r ON r.record_id = o.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id ORDER BY r.ordinal`);
  assert.equal(rows.length, 34);
  assert.equal(new Set(rows.map((r) => r.record_id)).size, 34);
  for (const r of rows) {
    assert.equal(r.release_id, releaseId);
    assert.equal(r.record_release, releaseId);
    assert.equal(r.source_id, TAITO_SOURCE_ID);
    assert.equal(r.release_source, TAITO_SOURCE_ID);
    assert.equal(r.mapping_version, TAITO_MAPPING_VERSION);
  }
  assert.equal(TAITO_ADAPTER.mappingVersion, "taito-observation.v1");
});

test("observations are the adapter mapping of the raw values; unknown stays unknown, nothing is attenuated", async () => {
  const db = new SqliteD1();
  const releaseId = await ingestTaito(db);
  const observed = await observeRelease(db, TAITO_ADAPTER, releaseId);
  const raw = all(db, "SELECT record_id, raw_values_json FROM source_records ORDER BY ordinal");
  assert.deepEqual(observed.map((o) => o.observation), raw.map((r) => TAITO_ADAPTER.observe(JSON.parse(r.raw_values_json))));

  const first = observed[0].observation;
  assert.equal(first.name, "上野公園前交番裏");
  assert.equal(first.latitude, 35.7112);
  assert.equal(first.longitude, 139.77377);
  assert.deepEqual(first.openingHours, { status: "parsed", raw: "終日利用可能", parsed: { v: 1, kind: "allDay" } });

  const dist = (col: string) => Object.fromEntries(all(db, `SELECT ${col} AS v, count(*) AS n FROM source_observations GROUP BY 1 ORDER BY 1`).map((r) => [r.v, r.n]));
  // Only the one 「※加熱式たばこ専用」 record states tobacco support; the other 33 stay unknown.
  assert.deepEqual(dist("supports_paper"), { no: 1, unknown: 33 });
  assert.deepEqual(dist("supports_heated"), { unknown: 33, yes: 1 });
  // The CSV's own hours (27/7). The Issue #42 attenuations are not observations: they weaken the
  // canonical rows (21/13) and leave these alone.
  assert.deepEqual(dist("opening_hours_status"), { parsed: 27, unparsed: 7 });
  assert.deepEqual(dist("lifecycle_claim"), { active: 34 });
  for (const { observation: o } of observed) {
    const fields = o.provenance.map((p) => p.field);
    assert.equal(fields.includes("supportsPaper"), o.supportsPaper !== "unknown", "an unknown value has no provenance");
  }
});

test("deriving twice writes nothing new, and resolve reuses the stored observations", async () => {
  const db = new SqliteD1();
  const releaseId = await ingestTaito(db);
  const first = await observeRelease(db, TAITO_ADAPTER, releaseId);
  const second = await observeRelease(db, TAITO_ADAPTER, releaseId);
  assert.deepEqual(second, first);
  await resolveFirstRelease(db, TAITO_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds() });
  assert.equal(count(db, "source_observations"), 34);
  assert.deepEqual((await observeRelease(db, TAITO_ADAPTER, releaseId)).map((o) => o.observationId), first.map((o) => o.observationId));
});

test("a changed mapping under the same version is refused; a new version adds a generation beside the old one", async () => {
  const db = new SqliteD1();
  const releaseId = await ingestTaito(db);
  await observeRelease(db, TAITO_ADAPTER, releaseId);
  const before = all(db, "SELECT * FROM source_observations ORDER BY observation_id");

  const changed: SourceAdapter = { ...TAITO_ADAPTER, observe: (v) => ({ ...TAITO_ADAPTER.observe(v), supportsPaper: "yes" }) };
  await assert.rejects(observeRelease(db, changed, releaseId), /re-derives differently under taito-observation\.v1/);
  assert.deepEqual(all(db, "SELECT * FROM source_observations ORDER BY observation_id"), before);

  await observeRelease(db, { ...changed, mappingVersion: "test-observation.v2" }, releaseId);
  assert.equal(count(db, "source_observations"), 68);
  assert.deepEqual(all(db, "SELECT * FROM source_observations WHERE mapping_version = ? ORDER BY observation_id", TAITO_MAPPING_VERSION), before);
});

test("observations are immutable", async () => {
  const db = new SqliteD1();
  await observeRelease(db, TAITO_ADAPTER, await ingestTaito(db));
  assert.throws(() => db.raw.prepare("UPDATE source_observations SET supports_paper = 'yes'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM source_observations").run(), /immutable/);
});

test("source identity fails closed: adapter, release and record must be the same source", async () => {
  const db = new SqliteD1();
  const taitoRelease = await ingestTaito(db);
  addBlockedTestSource(db);
  const { releaseId: testRelease } = await ingestRelease(db, TEST_BLOCKED_TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);

  await assert.rejects(observeRelease(db, TAITO_ADAPTER, testRelease),
    new RegExp(`belongs to ${TEST_BLOCKED_SOURCE}, not to adapter source ${TAITO_SOURCE_ID}`));
  await assert.rejects(observeRelease(db, TEST_BLOCKED_TAITO_ADAPTER, taitoRelease), /not to adapter source/);
  await assert.rejects(observeRelease(db, { ...TAITO_ADAPTER, parserVersion: "other.v1" }, taitoRelease), /was parsed by/);
  await assert.rejects(observeRelease(db, TAITO_ADAPTER, 999), /does not exist/);
  assert.equal(count(db, "source_observations"), 0);

  // A hand-written row cannot file a record under another source either.
  const record = all(db, "SELECT record_id FROM source_records WHERE release_id = ? LIMIT 1", taitoRelease)[0].record_id;
  assert.throws(() => db.raw.prepare(
    `INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, latitude, longitude,
       supports_paper, supports_heated, opening_hours_status, lifecycle_claim, field_provenance_json)
     VALUES (?, ?, ?, 'x', 35, 139, 'unknown', 'unknown', 'none', 'active', '[]')`,
  ).run(record, taitoRelease, TEST_BLOCKED_SOURCE), /does not match the record's release/);
  // And not under another release than its record's.
  assert.throws(() => db.raw.prepare(
    `INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, latitude, longitude,
       supports_paper, supports_heated, opening_hours_status, lifecycle_claim, field_provenance_json)
     VALUES (?, ?, ?, 'x', 35, 139, 'unknown', 'unknown', 'none', 'active', '[]')`,
  ).run(record, testRelease, TEST_BLOCKED_SOURCE), /FOREIGN KEY/);
});

test("the resolver reads observations, never raw source columns", () => {
  const resolver = readFileSync(new URL("../src/pipeline/resolve.ts", import.meta.url), "utf8");
  assert.equal(resolver.includes("raw_values_json"), false);
  assert.equal(resolver.includes("source_records"), false);
});

test("canonical provenance is the observation's field provenance, still citing the raw record", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  const observations = all(db, "SELECT record_id, field_provenance_json FROM source_observations");
  const provenance = all(db, "SELECT field, record_id, source_columns_json, rule FROM spot_field_provenance ORDER BY record_id, rowid");
  const expected = observations.flatMap((o) =>
    JSON.parse(o.field_provenance_json).map((p: Row) => ({ field: p.field, record_id: o.record_id, source_columns_json: JSON.stringify(p.columns), rule: p.rule })));
  assert.deepEqual(provenance.map((r) => ({ ...r })), expected);
  assert.equal(count(db, "spots"), 34);
});

test("a release refused by the adapter's reviewed checks keeps only its observations, nothing canonical", async () => {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  // The fixture bytes under another source: its fingerprint check passes, so refuse by adapter.
  const refusing: SourceAdapter = { ...TEST_BLOCKED_TAITO_ADAPTER, assertResolvable: () => { throw new Error("not reviewed"); } };
  const { releaseId } = await ingestRelease(db, refusing, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await assert.rejects(resolveFirstRelease(db, refusing, releaseId, { now: NOW }), /not reviewed/);
  assert.equal(count(db, "source_observations"), 34);
  for (const table of ["spots", "source_entities", "source_record_entities", "spot_field_provenance", "spot_field_attenuations"]) {
    assert.equal(count(db, table), 0, table);
  }
  assert.equal(all(db, "SELECT status FROM source_releases")[0].status, "ingested");
});
