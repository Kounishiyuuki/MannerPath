// Issue #42 regression cover: every contradiction between 台東区's two current publications of the
// same list must end up conservative, and must stay that way. One test per guarantee the issue
// names, plus the guarantees that must NOT change (raw evidence, safe records, host-is-not-evidence).
//
// The contradictions themselves are attested in src/pipeline/taito-list-page.ts and reproducible
// with services/data-pipeline/research/beta-data-quality/spot-check.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import {
  HOLD_LOCATION_SUPERSEDED,
  TAITO_HOURS_CONFLICT_RULE,
  TAITO_LIST_PAGE_CONFLICTS,
  TAITO_RELOCATION_RULE,
  TAITO_TEMPORARY_CLOSURE_RULE,
  assertListPageConflictsMatch,
} from "../src/pipeline/taito-list-page.ts";
import {
  TAITO_EXISTENCE_RULE, TAITO_FIXTURE_SHA256, TAITO_HEADER, TAITO_SOURCE_ID, resolveTaitoRecord,
} from "../src/pipeline/taito.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;

const CLOSED = "ファミリーマート　台東一丁目店";
const RELOCATED = "中小企業振興センター駐車場内";

async function publishedDb(): Promise<SqliteD1> {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return db;
}

const spotByName = (db: SqliteD1, name: string) => one(db, "SELECT * FROM spots WHERE name = ?", name);
const isPublished = (db: SqliteD1, spotId: string) =>
  one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n === 1;
const ruleFor = (db: SqliteD1, spotId: string, field: string) =>
  one(db, "SELECT rule FROM spot_field_provenance WHERE spot_id = ? AND field = ?", spotId, field)?.rule ?? null;

test("no record the ward's other publication contradicts can produce a confirmed openNow", async () => {
  const db = await publishedDb();
  for (const c of TAITO_LIST_PAGE_CONFLICTS.filter((x) => x.effects.includes("hoursUnknown"))) {
    const s = spotByName(db, c.csvName);
    assert.equal(s.opening_hours_status, "unparsed", `${c.csvName}: hours must not stay parsed`);
    assert.equal(s.opening_hours_json, null, `${c.csvName}: no machine-readable hours may survive`);
  }
  // And nothing published anywhere carries parsed hours for one of those names.
  const parsedNames = all(db,
    `SELECT s.name FROM tile_snapshot_spots t JOIN spots s ON s.spot_id = t.spot_id
     WHERE s.opening_hours_status = 'parsed'`).map((r) => r.name);
  for (const c of TAITO_LIST_PAGE_CONFLICTS) assert.equal(parsedNames.includes(c.csvName), false, c.csvName);
});

test("conditional and temporary closure qualifiers are not silently lost", async () => {
  const db = await publishedDb();
  // Weekday-only, holiday-exclusion and temporary-closure qualifiers all reach the same outcome:
  // the hours are unparsed, so no client can compute an openNow the ward would contradict, and the
  // CSV's own raw text is still there for a human to read.
  for (const name of ["本庁舎駐車場出口横", "佐竹公衆喫煙所", "金竜公園内", CLOSED]) {
    const s = spotByName(db, name);
    assert.equal(s.opening_hours_status, "unparsed", name);
    assert.ok(s.opening_hours_raw !== null && s.opening_hours_raw.length > 0, `${name} keeps its raw hours text`);
    assert.equal(ruleFor(db, s.spot_id, "openingHours"), TAITO_HOURS_CONFLICT_RULE, name);
  }
  // A place the ward currently states is closed is not published as a smoking location at all.
  const closed = spotByName(db, CLOSED);
  assert.equal(closed.lifecycle, "temporarilyClosed");
  assert.equal(isPublished(db, closed.spot_id), false);
  assert.equal(ruleFor(db, closed.spot_id, "lifecycle"), TAITO_TEMPORARY_CLOSURE_RULE);
});

test("a stale relocated coordinate is not an actionable navigation destination", async () => {
  const db = await publishedDb();
  const s = spotByName(db, RELOCATED);
  // The place exists — the ward says so — so it is not called closed or removed, and no coordinate
  // is invented for it. It is withheld from publication instead.
  assert.equal(s.lifecycle, "active");
  assert.equal(s.publication_hold, HOLD_LOCATION_SUPERSEDED);
  assert.equal(ruleFor(db, s.spot_id, "location"), TAITO_RELOCATION_RULE);
  assert.equal(isPublished(db, s.spot_id), false, "not in any tile, so not a Nearby result");
  // Nor reachable through the detail endpoint, which reads through the same publication gate.
  const res = await app.request(`/v1/spots/${s.spot_id}`, {}, { DB: db });
  assert.equal(res.status, 404);
  // Its coordinate is untouched: the hold is a publication decision, never a rewritten value.
  const raw = JSON.parse(one(db,
    `SELECT r.raw_values_json FROM spot_field_provenance p JOIN source_records r ON r.record_id = p.record_id
     WHERE p.spot_id = ? AND p.field = 'location'`, s.spot_id).raw_values_json);
  assert.equal(s.latitude, Number(raw[TAITO_HEADER.indexOf("緯度")]));
  assert.equal(s.longitude, Number(raw[TAITO_HEADER.indexOf("経度")]));
});

test("the database refuses to publish a held or temporarily closed spot, whatever the publisher does", async () => {
  const db = await publishedDb();
  for (const name of [RELOCATED, CLOSED]) {
    const s = spotByName(db, name);
    assert.throws(
      () => db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(s.spot_id, s.tile_id),
      /not publishable/,
      name,
    );
  }
  // And a hold cannot be placed on a spot that is still in a snapshot: unpublish first (ADR-0006 §11).
  const published = one(db, "SELECT spot_id FROM tile_snapshot_spots LIMIT 1");
  assert.throws(
    () => db.raw.prepare("UPDATE spots SET publication_hold = ? WHERE spot_id = ?").run(HOLD_LOCATION_SUPERSEDED, published.spot_id),
    /unpublish this spot/,
  );
});

test("records the second publication does not contradict are unchanged", async () => {
  const db = await publishedDb();
  const contradicted = new Set(TAITO_LIST_PAGE_CONFLICTS.map((c) => c.csvName));
  const safe = all(db, "SELECT * FROM spots").filter((s) => !contradicted.has(s.name));
  assert.equal(safe.length, 26);
  for (const s of safe) {
    assert.equal(s.lifecycle, "active", s.name);
    assert.equal(s.publication_hold, null, s.name);
    assert.equal(isPublished(db, s.spot_id), true, s.name);
    assert.equal(ruleFor(db, s.spot_id, "openingHours"), "taito.hours.v1", s.name);
  }
  // Two untouched examples, byte-for-byte what the CSV alone resolves to.
  assert.equal(spotByName(db, "上野公園前交番裏").opening_hours_json, JSON.stringify({ v: 1, kind: "allDay" }));
  assert.equal(spotByName(db, "上野公園正岡子規記念球場横").opening_hours_json,
    JSON.stringify({ v: 1, kind: "daily", opens: "07:00", closes: "18:00" }));
});

test("the raw CSV evidence is untouched by reconciliation", async () => {
  const fixture = readFileSync(
    new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url),
  );
  assert.equal(createHash("sha256").update(fixture).digest("hex"), TAITO_FIXTURE_SHA256);

  const db = await publishedDb();
  const stored = all(db, "SELECT r.raw_values_json FROM source_records r ORDER BY r.ordinal").map((r) => r.raw_values_json);
  assert.equal(stored.length, 34, "every record is still ingested, including the withheld ones");
  const closed = JSON.parse(stored[17]);
  assert.equal(closed[TAITO_HEADER.indexOf("名称")], CLOSED);
  assert.equal(closed[TAITO_HEADER.indexOf("利用開始時間")], "終日利用可能", "the raw row still says what the CSV says");
  assert.equal(closed[TAITO_HEADER.indexOf("特記事項")], "");
});

test("every reconciliation is explicit in provenance and in the quality analysis", async () => {
  const db = await publishedDb();
  for (const c of TAITO_LIST_PAGE_CONFLICTS) {
    const s = spotByName(db, c.csvName);
    const rules = [ruleFor(db, s.spot_id, "openingHours"), ruleFor(db, s.spot_id, "lifecycle"), ruleFor(db, s.spot_id, "location")];
    assert.ok(
      rules.some((r) => r !== null && r.includes("listPage")),
      `${c.csvName}: at least one field must name the reconciliation rule, got ${JSON.stringify(rules)}`,
    );
    assert.ok(c.observation.length > 0, `${c.csvName} has a written observation`);
  }

  const r = await analyzeCorpus(db, { now: "2026-09-21T00:00:00Z" });
  assert.equal(r.failedChecks, 0);
  assert.equal(r.reconciliation.conflicts, TAITO_LIST_PAGE_CONFLICTS.length);
  assert.deepEqual(r.reconciliation.canonicalButWithheld.map((w) => w.name).sort(), [CLOSED, RELOCATED].sort());
  assert.deepEqual(r.reconciliation.unresolved, []);
  assert.equal(r.checks.find((c) => c.id === `${TAITO_SOURCE_ID}-list-page-conflicts-resolved-conservatively`)?.status, "pass");
  assert.equal(r.checks.find((c) => c.id === "published-spots-are-active-and-unheld")?.status, "pass");
});

test("the quality analysis fails loudly if a reconciled record is published with parsed hours again", async () => {
  const db = await publishedDb();
  const s = spotByName(db, "清川清掃車庫内");
  db.raw.prepare(
    "UPDATE spots SET opening_hours_status = 'parsed', opening_hours_json = ? WHERE spot_id = ?",
  ).run(JSON.stringify({ v: 1, kind: "daily", opens: "07:00", closes: "19:00" }), s.spot_id);
  const r = await analyzeCorpus(db, { now: "2026-09-21T00:00:00Z" });
  const check = r.checks.find((c) => c.id === `${TAITO_SOURCE_ID}-list-page-conflicts-resolved-conservatively`)!;
  assert.equal(check.status, "fail");
  assert.match(check.detail, /清川清掃車庫内: hours still parsed/);
});

test("a convenience store's name and host are still not smoking evidence", async () => {
  const db = await publishedDb();
  const stores = all(db, "SELECT * FROM spots WHERE name LIKE '%ファミリーマート%' OR name LIKE '%セブン%'");
  assert.ok(stores.length >= 4);
  for (const s of stores) {
    assert.equal(ruleFor(db, s.spot_id, "existence"), TAITO_EXISTENCE_RULE, `${s.name}: the ward listing, not the store`);
    assert.equal(s.host_type, null);
    assert.equal(s.spot_type, "unknown");
  }
  // The withheld store is withheld for the ward's stated closure, not for being a store: the other
  // convenience stores in the same list are published exactly as before.
  assert.equal(stores.filter((s) => isPublished(db, s.spot_id)).length, stores.length - 1);
});

test("the attestations must still match the records being imported, or the import fails", () => {
  const names = ["something else", ...TAITO_LIST_PAGE_CONFLICTS.slice(1).map((c) => c.csvName)];
  assert.throws(() => assertListPageConflictsMatch(names), /matched 0/);
  assert.throws(
    () => assertListPageConflictsMatch([...TAITO_LIST_PAGE_CONFLICTS.map((c) => c.csvName), TAITO_LIST_PAGE_CONFLICTS[0].csvName]),
    /matched 2/,
  );
});

test("the reconciliation only ever removes a claim; it never writes a value from the unlicensed page", () => {
  // A record with no attestation resolves identically with and without the reconciliation step,
  // and an attested record's resolved values are a strict weakening of the CSV's own.
  const row = (name: string, start: string, end: string, note = "") =>
    TAITO_HEADER.map((h) => ({ "#": "1", 名称: name, 利用開始時間: start, 利用終了時間: end, 特記事項: note, 緯度: "35.7", 経度: "139.78" } as Record<string, string>)[h] ?? "");
  const untouched = resolveTaitoRecord(row("何も矛盾しない喫煙所", "7:00", "19:00"));
  assert.equal(untouched.openingHours.status, "parsed");
  assert.equal(untouched.lifecycle, "active");
  assert.equal(untouched.publicationHold, null);

  const conflicted = resolveTaitoRecord(row("清川清掃車庫内", "7:00", "19:00"));
  assert.equal(conflicted.openingHours.status, "unparsed");
  assert.equal(conflicted.openingHours.parsed, null);
  // The ward's other page says 8:00-20:00. Those times appear nowhere in what we resolved.
  assert.equal(conflicted.openingHours.raw, "7:00-19:00", "the CSV's own text, not the page's");
  assert.equal(TAITO_LIST_PAGE_CONFLICTS.every((c) => !/\d{1,2}:\d{2}/.test(c.observation)), true,
    "an attestation records that a conflict exists, never a replacement time to publish");
});
