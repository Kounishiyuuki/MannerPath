// Issue #42 regression cover: every contradiction between 台東区's two current publications of the
// same list must end up conservative, must stay that way, and must carry explicit attestation
// evidence. One test per guarantee the issue names, plus the guarantees that must NOT change (raw
// evidence, safe records, host-is-not-evidence, honest CSV provenance).
//
// The contradictions themselves are attested in src/pipeline/taito-list-page.ts and reproducible
// with services/data-pipeline/research/beta-data-quality/spot-check.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { ingestTaitoCsv } from "../src/pipeline/ingest.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import {
  ATTENUATED_FIELD,
  HOLD_LOCATION_SUPERSEDED,
  TAITO_LIST_PAGE_ATTESTATION_VERSION,
  TAITO_LIST_PAGE_CHECKED_AT,
  TAITO_LIST_PAGE_CONFLICTS,
  TAITO_LIST_PAGE_REFERENCE_KIND,
  TAITO_LIST_PAGE_URL,
  TAITO_REVIEWED_RELEASE,
  assertListPageConflictsMatch,
} from "../src/pipeline/taito-list-page.ts";
import {
  TAITO_EXISTENCE_RULE, TAITO_FIXTURE_RELEASE, TAITO_FIXTURE_SHA256, TAITO_HEADER, TAITO_RESOLVER_VERSION,
  TAITO_SOURCE_ID, resolveTaitoRecord,
} from "../src/pipeline/taito.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { SpotDetailBodyV1 } from "../src/spots/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;

const CLOSED = "ファミリーマート　台東一丁目店";
const RELOCATED = "中小企業振興センター駐車場内";
/** A published spot whose hours the list page contradicts — the interesting case for the public API. */
const HOURS_CONFLICTED = "清川清掃車庫内";

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
const attenuations = (db: SqliteD1, spotId: string) =>
  all(db, "SELECT * FROM spot_field_attenuations WHERE spot_id = ? ORDER BY field, effect", spotId);

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

test("a reviewed conditional or temporary qualifier is retained as attestation evidence, and the canonical claim is weakened", async () => {
  const db = await publishedDb();
  // The qualifier itself lives on the ward's page, not in the CSV: `opening_hours_raw` is the CSV's
  // own text and does not contain it. What this repository retains is the reviewed *attestation*
  // that a qualifier exists — spot_field_attenuations — while the page's replacement value and
  // wording are not stored and not published. The canonical claim is weakened instead, so openNow
  // cannot confidently contradict the ward's other publication.
  for (const name of ["本庁舎駐車場出口横", "佐竹公衆喫煙所", "金竜公園内", CLOSED]) {
    const s = spotByName(db, name);
    assert.equal(s.opening_hours_status, "unparsed", name);
    const [a] = attenuations(db, s.spot_id).filter((x) => x.effect === "hoursUnknown");
    assert.ok(a, `${name}: the reviewed qualifier is retained as an attenuation row`);
    assert.equal(a.field, "openingHours");
    assert.equal(a.attestation_version, TAITO_LIST_PAGE_ATTESTATION_VERSION);
    assert.equal(a.reference_kind, TAITO_LIST_PAGE_REFERENCE_KIND);
    assert.equal(a.reference_url, TAITO_LIST_PAGE_URL);
    assert.equal(a.checked_at, TAITO_LIST_PAGE_CHECKED_AT);
    // No page prose, opening time or coordinate is stored on the row. Three of its strings are
    // timestamps or URLs by design (`checked_at`, `applied_at`, `reference_url`); nothing else may
    // carry a clock time, which is the shape a replacement value from the page would have.
    const structural = new Set(["checked_at", "applied_at", "reference_url"]);
    for (const [column, value] of Object.entries(a)) {
      if (typeof value !== "string" || structural.has(column)) continue;
      assert.equal(/\d{1,2}[:：]\d{2}/.test(value), false, `${name}: no time may be stored in ${column} (${value})`);
    }
  }
  // A place the ward currently states is closed is not published as a smoking location at all.
  const closed = spotByName(db, CLOSED);
  assert.equal(closed.lifecycle, "temporarilyClosed");
  assert.equal(isPublished(db, closed.spot_id), false);
  assert.deepEqual(attenuations(db, closed.spot_id).map((a) => a.effect).sort(), ["hoursUnknown", "temporarilyClosed"]);
});

test("a stale relocated coordinate is not an actionable navigation destination", async () => {
  const db = await publishedDb();
  const s = spotByName(db, RELOCATED);
  // The place exists — the ward says so — so it is not called closed or removed, and no coordinate
  // is invented for it. It is withheld from publication instead.
  assert.equal(s.lifecycle, "active");
  assert.equal(s.publication_hold, HOLD_LOCATION_SUPERSEDED);
  assert.deepEqual(attenuations(db, s.spot_id).map((a) => [a.field, a.effect]), [["location", "withholdFromPublication"]]);
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

test("GET /v1/spots/{id} never presents the CSV as the evidence for a later list-page conflict", async () => {
  const db = await publishedDb();
  const s = spotByName(db, HOURS_CONFLICTED);
  assert.equal(isPublished(db, s.spot_id), true, "this one is published; only its hours are withdrawn");

  const res = await app.request(`/v1/spots/${s.spot_id}`, {}, { DB: db });
  assert.equal(res.status, 200);
  const body = SpotDetailBodyV1.parse(await res.json());
  assert.equal(body.spot.openingHours.status, "unparsed");
  assert.equal(body.spot.openingHours.parsed, null);

  const fields = body.provenance.map((p) => p.field);
  // The attenuated field is omitted outright. Publishing it would say "台東区, observed 2026-08-18"
  // is the evidence for a value that was in fact withdrawn later on other evidence.
  assert.equal(fields.includes("openingHours"), false, "attenuated field must not be published as CSV-observed");
  assert.deepEqual(body.provenance.filter((p) => p.observedOn === TAITO_FIXTURE_RELEASE.observedOn
    && p.field === "openingHours"), []);
  // Unattenuated fields keep their honest CSV provenance.
  assert.deepEqual(fields.sort(), ["existence", "lifecycle", "location", "name"]);
  for (const p of body.provenance) {
    assert.equal(p.sourceId, TAITO_SOURCE_ID);
    assert.equal(p.observedOn, TAITO_FIXTURE_RELEASE.observedOn);
    assert.equal(p.rule.includes("listPage"), false, "no rule may name the conflict reference");
  }
  // Internally the CSV provenance row is still there and still true about the CSV.
  assert.equal(ruleFor(db, s.spot_id, "openingHours"), "taito.hours.v1");

  // A spot with no attenuation publishes all five fields, including openingHours.
  const safe = spotByName(db, "上野公園正岡子規記念球場横");
  const safeBody = SpotDetailBodyV1.parse(await (await app.request(`/v1/spots/${safe.spot_id}`, {}, { DB: db })).json());
  assert.deepEqual(safeBody.provenance.map((p) => p.field).sort(),
    ["existence", "lifecycle", "location", "name", "openingHours"]);
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
  // Attenuation rows are evidence about a published decision, so they are never deleted.
  assert.throws(() => db.raw.prepare("DELETE FROM spot_field_attenuations").run(), /never deleted/);
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
    assert.deepEqual(attenuations(db, s.spot_id), [], `${s.name}: nothing weakened`);
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
  assert.equal(TAITO_FIXTURE_SHA256, TAITO_REVIEWED_RELEASE.contentSha256, "the reviewed release is the committed fixture");

  const db = await publishedDb();
  const stored = all(db, "SELECT r.raw_values_json FROM source_records r ORDER BY r.ordinal").map((r) => r.raw_values_json);
  assert.equal(stored.length, 34, "every record is still ingested, including the withheld ones");
  const closed = JSON.parse(stored[17]);
  assert.equal(closed[TAITO_HEADER.indexOf("名称")], CLOSED);
  assert.equal(closed[TAITO_HEADER.indexOf("利用開始時間")], "終日利用可能", "the raw row still says what the CSV says");
  assert.equal(closed[TAITO_HEADER.indexOf("特記事項")], "");
});

test("every attenuation carries its attestation and the exact reviewed release fingerprint", async () => {
  const db = await publishedDb();
  const expected = TAITO_LIST_PAGE_CONFLICTS.flatMap((c) => c.effects.map((e) => [c.csvName, e] as const));
  const rows = all(db,
    `SELECT a.*, s.name FROM spot_field_attenuations a JOIN spots s ON s.spot_id = a.spot_id`);
  assert.equal(rows.length, expected.length, "one row per reviewed effect, no more and no fewer");
  for (const [name, effect] of expected) {
    const a = rows.find((r) => r.name === name && r.effect === effect);
    assert.ok(a, `${name} / ${effect}`);
    assert.equal(a.field, ATTENUATED_FIELD[effect]);
    assert.equal(a.release_content_sha256, TAITO_REVIEWED_RELEASE.contentSha256);
    assert.equal(a.release_observed_on, TAITO_REVIEWED_RELEASE.observedOn);
    assert.equal(a.release_source_url, TAITO_REVIEWED_RELEASE.sourceUrl);
    assert.equal(a.resolver_version, TAITO_RESOLVER_VERSION);
    assert.equal(a.release_id, 1);
  }

  const r = await analyzeCorpus(db, { now: "2026-09-21T00:00:00Z" });
  assert.equal(r.failedChecks, 0);
  assert.equal(r.reconciliation.conflicts, TAITO_LIST_PAGE_CONFLICTS.length);
  assert.equal(r.reconciliation.attestedFieldAttenuations, expected.length);
  assert.deepEqual(r.reconciliation.reviewedRelease, TAITO_REVIEWED_RELEASE);
  assert.deepEqual(r.reconciliation.canonicalButWithheld.map((w) => w.name).sort(), [CLOSED, RELOCATED].sort());
  assert.deepEqual(r.reconciliation.unresolved, []);
  assert.equal(r.checks.find((c) => c.id === `${TAITO_SOURCE_ID}-list-page-conflicts-resolved-conservatively`)?.status, "pass");
  assert.equal(r.checks.find((c) => c.id === `${TAITO_SOURCE_ID}-attenuations-are-attested`)?.status, "pass");
  assert.equal(r.checks.find((c) => c.id === "published-spots-are-active-and-unheld")?.status, "pass");
});

test("the quality gate fails when an attenuated value has no attestation behind it", async () => {
  const db = await publishedDb();
  const s = spotByName(db, HOURS_CONFLICTED);
  // Simulate the pre-review failure mode: the value is weakened, but nothing records why.
  db.raw.prepare("DROP TRIGGER spot_field_attenuations_no_delete").run();
  db.raw.prepare("DELETE FROM spot_field_attenuations WHERE spot_id = ?").run(s.spot_id);
  const r = await analyzeCorpus(db, { now: "2026-09-21T00:00:00Z" });
  const check = r.checks.find((c) => c.id === `${TAITO_SOURCE_ID}-list-page-conflicts-resolved-conservatively`)!;
  assert.equal(check.status, "fail");
  assert.match(check.detail, /清川清掃車庫内: hoursUnknown: no attestation row/);
});

test("the quality gate fails loudly if a reconciled record is published with parsed hours again", async () => {
  const db = await publishedDb();
  const s = spotByName(db, HOURS_CONFLICTED);
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

// --- the attestations are bound to one exact release ------------------------------------------

/** Ingests `bytes` as a release of the Taito source with `meta`, then resolves it. */
async function importRelease(bytes: Uint8Array, meta: typeof TAITO_FIXTURE_RELEASE) {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId } = await ingestTaitoCsv(db, TAITO_SOURCE_ID, bytes, meta);
  return resolveFirstRelease(db, releaseId, { now: NOW, newSpotId: sequentialSpotIds() });
}

test("the exact reviewed release resolves", async () => {
  const resolved = await importRelease(TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.equal(resolved.status, "resolved");
});

test("a release with the same record names but different bytes fails closed", async () => {
  // Every attested name is still present and still says the same thing — only an *unattested*
  // record differs — but it is a different file, so the 2026-09-21 page review does not cover it:
  // that review compared the page against these exact bytes.
  const text = new TextDecoder().decode(TAITO_BYTES);
  assert.ok(text.includes("上野公園前交番裏"), "fixture shape assumption");
  const modified = new TextEncoder().encode(text.replace("上野公園前交番裏", "上野公園前交番裏(改)"));
  for (const c of TAITO_LIST_PAGE_CONFLICTS) {
    assert.ok(new TextDecoder().decode(modified).includes(c.csvName), `${c.csvName} still present`);
  }
  assert.notEqual(createHash("sha256").update(modified).digest("hex"), TAITO_REVIEWED_RELEASE.contentSha256);
  await assert.rejects(importRelease(modified, TAITO_FIXTURE_RELEASE),
    /was reviewed against a different release \(content_sha256 /);
});

test("a release with a different observed_on fails closed", async () => {
  await assert.rejects(importRelease(TAITO_BYTES, { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18" }),
    /observed_on 2026-09-18 != 2026-08-18/);
});

test("a release with a different source_url fails closed", async () => {
  await assert.rejects(
    importRelease(TAITO_BYTES, { ...TAITO_FIXTURE_RELEASE, sourceUrl: "https://www.city.taito.lg.jp/other.csv" }),
    /source_url https:\/\/www\.city\.taito\.lg\.jp\/other\.csv != /);
});

test("the attestations must still match the records being imported, or the import fails", () => {
  const names = ["something else", ...TAITO_LIST_PAGE_CONFLICTS.slice(1).map((c) => c.csvName)];
  assert.throws(() => assertListPageConflictsMatch(names), /matched 0/);
  assert.throws(
    () => assertListPageConflictsMatch([...TAITO_LIST_PAGE_CONFLICTS.map((c) => c.csvName), TAITO_LIST_PAGE_CONFLICTS[0].csvName]),
    /matched 2/,
  );
});

test("the reconciliation only ever removes a claim; it never writes a value from the conflict reference", () => {
  // A record with no attestation resolves identically with and without the reconciliation step,
  // and an attested record's resolved values are a strict weakening of the CSV's own.
  const row = (name: string, start: string, end: string, note = "") =>
    TAITO_HEADER.map((h) => ({ "#": "1", 名称: name, 利用開始時間: start, 利用終了時間: end, 特記事項: note, 緯度: "35.7", 経度: "139.78" } as Record<string, string>)[h] ?? "");
  const untouched = resolveTaitoRecord(row("何も矛盾しない喫煙所", "7:00", "19:00"));
  assert.equal(untouched.openingHours.status, "parsed");
  assert.equal(untouched.lifecycle, "active");
  assert.equal(untouched.publicationHold, null);
  assert.deepEqual(untouched.attenuations, []);

  const conflicted = resolveTaitoRecord(row(HOURS_CONFLICTED, "7:00", "19:00"));
  assert.equal(conflicted.openingHours.status, "unparsed");
  assert.equal(conflicted.openingHours.parsed, null);
  assert.deepEqual(conflicted.attenuations, [{ field: "openingHours", effect: "hoursUnknown" }]);
  // The ward's other page says 8:00-20:00. Those times appear nowhere in what we resolved, and the
  // CSV's own text is what stays in `raw`.
  assert.equal(conflicted.openingHours.raw, "7:00-19:00", "the CSV's own text, not the page's");
  // The CSV provenance rule is untouched: it still describes the CSV, which is what it is for.
  assert.equal(conflicted.provenance.find((p) => p.field === "openingHours")?.rule, "taito.hours.v1");
  assert.equal(TAITO_LIST_PAGE_CONFLICTS.every((c) => !/\d{1,2}:\d{2}/.test(c.observation)), true,
    "an attestation records that a conflict exists, never a replacement time to publish");
});
