// Taito fixture -> raw evidence -> first-release reconciliation -> canonical spots with provenance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseCsv } from "../src/pipeline/csv.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { applyReviewedSourceRegistry, ensureReviewedSource, reviewedSource } from "../src/pipeline/registry.ts";
import { EVIDENCE_QUALITY_VERSION, FIRST_RELEASE_MATCHER_VERSION, OFFICIAL_LISTING, resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_ATTRIBUTION_TEXT, TAITO_DATASET_URL, TAITO_FIXTURE_RELEASE, TAITO_HEADER, TAITO_ORIGINAL_DATA_URL, TAITO_SOURCE_ID, resolveTaitoRecord } from "../src/pipeline/taito.ts";
import { SPOT_ID } from "../src/spot-id.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../src/geo/tile.ts";
import { NOW, TAITO_BYTES, importTaito } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;

/** Spot + raw row for the Taito record whose "#" is `ref`. */
function spotByRef(db: SqliteD1, ref: string): Row {
  return one(db,
    `SELECT s.*, r.record_id, r.raw_values_json FROM spots s
     JOIN spot_source_entities se ON se.spot_id = s.spot_id
     JOIN source_record_entities re ON re.source_entity_id = se.source_entity_id
     JOIN source_records r ON r.record_id = re.record_id
     WHERE r.upstream_row_ref = ?`, ref);
}

function provenance(db: SqliteD1, spotId: string): Map<string, Row> {
  return new Map(all(db, "SELECT * FROM spot_field_provenance WHERE spot_id = ?", spotId).map((r) => [r.field, r]));
}

// CSV records whose hours the ward's other current publication contradicts or qualifies
// (services/api/src/pipeline/taito-list-page.ts). #22 was already unparsed from its own CSV note.
// The attenuation itself is covered by test/taito-reconciliation.test.ts.
const HOURS_CONFLICT_REFS = ["10", "12", "15", "16", "18", "22", "30"];

test("CSV reader rejects malformed input instead of guessing", () => {
  assert.throws(() => parseCsv('a,b\n1,"x'), /unterminated/);
  assert.throws(() => parseCsv('a,b\n1,"x"y\n'), /after closing quote/);
  assert.throws(() => parseCsv("a,b\n1,2,3\n"), /3 fields/);
  assert.deepEqual(parseCsv('﻿a,b\r\n"x\ny",  z \r\n'), { header: ["a", "b"], rows: [["x\ny", "  z "]] });
});

test("ingest: all 34 Taito records stored with all 12 raw columns verbatim, including the multi-line field", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId, created } = await ingestRelease(db, TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.equal(created, true);

  const rel = one(db, "SELECT * FROM source_releases WHERE release_id = ?", releaseId);
  assert.equal(rel.content_sha256, "5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74");
  assert.equal(rel.byte_length, 7266);
  assert.equal(rel.record_count, 34);
  assert.equal(rel.observed_on, "2026-08-18");
  assert.equal(rel.status, "ingested");
  assert.deepEqual(JSON.parse(rel.header_json), [...TAITO_HEADER]);

  const records = all(db, "SELECT * FROM source_records WHERE release_id = ? ORDER BY ordinal", releaseId);
  assert.equal(records.length, 34);
  // Independent check against the file text split by line (every record except #32 is one line).
  const lines = new TextDecoder().decode(TAITO_BYTES).replace(/^﻿/, "").split("\r\n");
  for (const [i, r] of records.entries()) {
    const values = JSON.parse(r.raw_values_json);
    assert.equal(values.length, 12);
    assert.equal(r.ordinal, i + 1);
    assert.equal(r.upstream_row_ref, String(i + 1));
    assert.equal(r.raw_sha256, createHash("sha256").update(r.raw_values_json).digest("hex"));
    if (r.upstream_row_ref !== "32") assert.equal(values.join(","), lines[i + 1]);
  }
  const r32 = JSON.parse(records[31].raw_values_json);
  assert.equal(r32[3], "e-booth御徒町　※加熱式たばこ専用");
  assert.equal(r32[11], "土日祝日、年末年始は休業\n※加熱式たばこ専用");
  assert.equal(JSON.parse(records[22].raw_values_json)[5], "台東区上野７丁目４番３号  ", "trailing spaces are kept");

  const again = await ingestRelease(db, TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.deepEqual(again, { releaseId, created: false });
  assert.equal(one(db, "SELECT count(*) AS n FROM source_records").n, 34);
});

test("ingest rejects a file whose header is not the Taito format", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const bytes = new TextEncoder().encode("#,名称\n1,x\n");
  await assert.rejects(ingestRelease(db, TAITO_ADAPTER, bytes, TAITO_FIXTURE_RELEASE), /unexpected header/);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_releases").n, 0);
});

test("registry: a fresh database gets the reviewed Taito row as approved, and ensure never rewrites an existing row", async () => {
  const db = new SqliteD1();
  assert.deepEqual(await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW), { created: true });
  const fresh = one(db, "SELECT * FROM sources WHERE source_id = ?", TAITO_SOURCE_ID);
  assert.equal(fresh.publication_status, "approved", "the known reviewed source is not created as a generic blocked row");
  assert.equal(fresh.display_name, "台東区 公衆喫煙所");
  assert.equal(fresh.license_name, "CC BY 4.0");
  assert.equal(fresh.attribution_text, TAITO_ATTRIBUTION_TEXT);

  // Ensure is insert-only: an operator edit survives an import, which is why the upgrade path below
  // is a separate, named operation rather than a side effect of ingest.
  db.raw.prepare("UPDATE sources SET display_name = 'edited', publication_status = 'blocked' WHERE source_id = ?").run(TAITO_SOURCE_ID);
  assert.deepEqual(await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW), { created: false });
  const s = one(db, "SELECT * FROM sources WHERE source_id = ?", TAITO_SOURCE_ID);
  assert.equal(s.display_name, "edited");
  assert.equal(s.publication_status, "blocked");
});

test("registry: the reviewed Taito attribution is exactly the four official display elements", () => {
  const text = reviewedSource(TAITO_SOURCE_ID).attributionText!;
  assert.equal(text, TAITO_ATTRIBUTION_TEXT);
  // 台東区's display example: the four elements in this order, joined by spaces, nothing else.
  assert.equal(text, `台東区 CC-BY表示4.0国際 本作品の内容について、台東区は一切保証しないものとする。 元データ ${TAITO_ORIGINAL_DATA_URL}`);

  // 元データ is the release file the data actually came from, not the catalog landing page.
  assert.equal(TAITO_ORIGINAL_DATA_URL, TAITO_FIXTURE_RELEASE.sourceUrl);
  assert.ok(!text.includes(TAITO_DATASET_URL), "the dataset landing page is catalog metadata, not the cited 元データ");
  // The terms prescribe no dataset title, so none is inserted between the author and the license.
  assert.ok(text.startsWith("台東区 CC-BY表示4.0国際 "));
  assert.ok(!text.includes("公衆喫煙所"));
});

test("registry: the upgrade path re-applies the reviewed entry to an existing blocked row, and only to reviewed sources", async () => {
  const db = new SqliteD1();
  // A database created before the review: the older code inserted Taito blocked with no attribution.
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, '台東区 公衆喫煙所', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'blocked', ?, ?)`,
  ).run(TAITO_SOURCE_ID, NOW, NOW);

  assert.deepEqual(await applyReviewedSourceRegistry(db, TAITO_SOURCE_ID, "2026-09-22T00:00:00Z"),
    { status: "updated", publicationStatus: "approved" });
  const s = one(db, "SELECT * FROM sources WHERE source_id = ?", TAITO_SOURCE_ID);
  assert.equal(s.publication_status, "approved");
  assert.equal(s.attribution_text, TAITO_ATTRIBUTION_TEXT);
  assert.equal(s.updated_at, "2026-09-22T00:00:00Z");
  assert.deepEqual(await applyReviewedSourceRegistry(db, TAITO_SOURCE_ID, NOW), { status: "unchanged", publicationStatus: "approved" });

  // Nothing can approve a source this repository has not reviewed — including OSM.
  for (const id of ["osm", "some-new-municipality"]) {
    await assert.rejects(() => ensureReviewedSource(db, id, NOW), /not a reviewed source/);
    await assert.rejects(() => applyReviewedSourceRegistry(db, id, NOW), /not a reviewed source/);
    assert.equal(one(db, "SELECT count(*) AS n FROM sources WHERE source_id = ?", id).n, 0);
  }
});

test("first release: one new source entity, one 'new' decision and one opaque spot per record", async () => {
  const db = new SqliteD1();
  const { releaseId, resolved } = await importTaito(db);
  assert.equal(resolved.status, "resolved");

  const decisions = all(db, "SELECT * FROM source_record_entities");
  assert.equal(decisions.length, 34);
  assert.ok(decisions.every((d) => d.method === "new" && d.matcher_version === FIRST_RELEASE_MATCHER_VERSION && d.release_id === releaseId));
  assert.equal(new Set(decisions.map((d) => d.source_entity_id)).size, 34);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_record_match_keys").n, 0, "no unvalidated match keys are derived");

  const spots = all(db, "SELECT s.spot_id, s.latitude, s.longitude, s.tile_id FROM spots s");
  assert.equal(spots.length, 34);
  assert.equal(one(db, "SELECT count(*) AS n FROM spot_source_entities WHERE method = 'created'").n, 34);
  for (const s of spots) {
    assert.match(s.spot_id, SPOT_ID);
    for (const derived of [String(s.latitude), String(s.longitude), s.tile_id, TAITO_SOURCE_ID]) {
      assert.ok(!s.spot_id.includes(derived), `${s.spot_id} must not embed ${derived}`);
    }
  }
  const rel = one(db, "SELECT * FROM source_releases WHERE release_id = ?", releaseId);
  assert.deepEqual([rel.status, rel.is_current, rel.applied_at], ["applied", 1, NOW]);
});

test("identity: spot IDs are random, not derived from the row, and resolution is not repeated", async () => {
  const a = new SqliteD1();
  const b = new SqliteD1();
  await importTaito(a);
  await importTaito(b);
  const idsA = all(a, "SELECT spot_id FROM spots").map((r) => r.spot_id);
  const idsB = new Set(all(b, "SELECT spot_id FROM spots").map((r) => r.spot_id));
  assert.ok(idsA.every((id) => !idsB.has(id)), "same input rows must not reproduce the same IDs");

  const releaseId = one(a, "SELECT release_id FROM source_releases").release_id;
  assert.deepEqual(await resolveFirstRelease(a, TAITO_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
  assert.deepEqual(all(a, "SELECT spot_id FROM spots").map((r) => r.spot_id), idsA);
});

test("identity: a second Taito release is refused, because '#' and natural keys are not a validated cross-release identity", async () => {
  const db = new SqliteD1();
  await importTaito(db);
  const { releaseId } = await ingestRelease(db, TAITO_ADAPTER, TAITO_BYTES, { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-10-01" });
  await assert.rejects(resolveFirstRelease(db, TAITO_ADAPTER, releaseId, { now: NOW }), /cross-release reconciliation is not implemented/);
  assert.equal(one(db, "SELECT count(*) AS n FROM spots").n, 34);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_record_entities").n, 34);
  assert.equal(one(db, "SELECT status FROM source_releases WHERE release_id = ?", releaseId).status, "ingested");
});

test("provenance: every resolved field points at its own raw record, columns and named rule", async () => {
  const db = new SqliteD1();
  await importTaito(db);
  for (let ref = 1; ref <= 34; ref++) {
    const s = spotByRef(db, String(ref));
    const p = provenance(db, s.spot_id);
    // Field provenance describes the CSV only, for every record. The Issue #42 reconciliation never
    // edits these rows: a weakened field records its weakening in spot_field_attenuations instead,
    // so this row keeps saying what the source stated and by which rule (test/taito-reconciliation).
    for (const [field, rule, columns] of [
      ["existence", "taito.listed.v1", []],
      ["lifecycle", "taito.listed.v1", []],
      ["location", "taito.coordinates.v1", ["緯度", "経度"]],
      ["name", "taito.name.v1", ["名称"]],
      ["openingHours", "taito.hours.v1", ["利用開始時間", "利用終了時間", "特記事項"]],
    ] as const) {
      assert.equal(p.get(field)?.rule, rule, `#${ref} ${field}`);
      assert.deepEqual(JSON.parse(p.get(field)!.source_columns_json), columns);
      assert.equal(p.get(field)!.record_id, s.record_id);
      assert.equal(p.get(field)!.resolver_version, "taito-resolver.v2");
    }
    for (const unresolved of ["spotType", "hostType", "accessType", "environment", "feeType", "floor", "entranceNote"]) {
      assert.equal(p.has(unresolved), false, `#${ref} ${unresolved} has no evidence`);
    }
    assert.equal(p.has("supportsPaper"), ref === 32);
    assert.equal(p.has("supportsHeated"), ref === 32);

    const raw = JSON.parse(s.raw_values_json);
    assert.equal(s.name, raw[3]);
    assert.equal(s.latitude, Number(raw[9]));
    assert.equal(s.longitude, Number(raw[10]));
    assert.equal(s.tile_id, formatTileId(tileForCoordinate(s.latitude, s.longitude, DATA_TILE_ZOOM)));
  }
});

test("unknown stays unknown: no type, host, access, environment or tobacco value is inferred", async () => {
  const db = new SqliteD1();
  await importTaito(db);
  const spots = all(db, "SELECT * FROM spots");
  for (const s of spots) {
    assert.equal(s.spot_type, "unknown");
    assert.equal(s.host_type, null);
    assert.equal(s.access_type, "unknown");
    assert.equal(s.environment, "unknown");
    assert.equal(s.fee_type, null);
    assert.equal(s.floor, null);
    assert.equal(s.entrance_note, null);
    assert.equal(s.lifecycle, s.name === "ファミリーマート　台東一丁目店" ? "temporarilyClosed" : "active");
    assert.equal(s.publication_hold, s.name === "中小企業振興センター駐車場内" ? "locationSuperseded" : null);
    assert.equal(s.evidence_quality, OFFICIAL_LISTING);
    assert.equal(s.evidence_quality_version, EVIDENCE_QUALITY_VERSION);
    assert.equal(s.last_verified_at, "2026-08-18", "observation date of the release, not fetch/import time");
  }
  const unknownTobacco = spots.filter((s) => s.supports_paper === "unknown" && s.supports_heated === "unknown");
  assert.equal(unknownTobacco.length, 33);

  // Convenience stores are listed like every other record: the ward listing is the evidence,
  // the host is not recorded and gives them nothing extra.
  for (const ref of ["18", "19", "20", "21", "28"]) {
    const s = spotByRef(db, ref);
    assert.match(s.name, /ファミリーマート|セブン-イレブン/);
    assert.equal(s.host_type, null);
    assert.equal(provenance(db, s.spot_id).get("existence")!.rule, "taito.listed.v1");
  }
});

test("heated-only record #32 is explicit and distinguishable from unknown tobacco support", async () => {
  const db = new SqliteD1();
  await importTaito(db);
  const s = spotByRef(db, "32");
  assert.deepEqual([s.supports_paper, s.supports_heated], ["no", "yes"]);
  const p = provenance(db, s.spot_id);
  assert.equal(p.get("supportsHeated")!.rule, "taito.heatedOnly.v1");
  assert.deepEqual(JSON.parse(p.get("supportsHeated")!.source_columns_json), ["名称", "特記事項"]);
  const other = spotByRef(db, "31");
  assert.deepEqual([other.supports_paper, other.supports_heated], ["unknown", "unknown"]);
});

test("hours: free-text notes keep openNow unknown; only plain all-day or H:MM ranges are parsed", async () => {
  const db = new SqliteD1();
  await importTaito(db);
  const hours = (ref: string) => {
    const s = spotByRef(db, ref);
    return { status: s.opening_hours_status, raw: s.opening_hours_raw, parsed: s.opening_hours_json && JSON.parse(s.opening_hours_json) };
  };
  for (const ref of ["17", "22", "23", "24", "26", "32", "34", ...HOURS_CONFLICT_REFS]) {
    const h = hours(ref);
    assert.equal(h.status, "unparsed", `#${ref} has a closure note or a list-page conflict`);
    assert.equal(h.parsed, null);
  }
  assert.deepEqual(hours("32"), { status: "unparsed", raw: "7:00-20:00\n土日祝日、年末年始は休業\n※加熱式たばこ専用", parsed: null });
  assert.deepEqual(hours("26"), { status: "unparsed", raw: "10:30-19:30\n12月を除く毎月第3水曜日は休業", parsed: null });
  assert.deepEqual(hours("1"), { status: "parsed", raw: "終日利用可能", parsed: { v: 1, kind: "allDay" } });
  assert.deepEqual(hours("14"), { status: "parsed", raw: "7:00-18:00", parsed: { v: 1, kind: "daily", opens: "07:00", closes: "18:00" } });
  // #10 and #30 parse cleanly from the CSV alone; the reconciliation is what keeps them unparsed,
  // and the CSV's own raw text is left exactly as the source wrote it.
  assert.deepEqual(hours("10"), { status: "unparsed", raw: "8:00-19:00", parsed: null });
  assert.deepEqual(hours("30"), { status: "unparsed", raw: "7:00-0:00", parsed: null });
  const statuses = all(db, "SELECT opening_hours_status AS s, count(*) AS n FROM spots GROUP BY 1 ORDER BY 1");
  // 27/7 from the CSV alone; six records lose their parsed hours to the Issue #42 reconciliation.
  assert.deepEqual(statuses.map((r) => [r.s, r.n]), [["parsed", 21], ["unparsed", 13]]);
});

test("hour rules: anything unrecognised is unparsed rather than guessed", () => {
  const row = (start: string, end: string, note = "") =>
    ["1", "131067", "台東区", "x", "x", "x", "", start, end, "35.7", "139.7", note];
  assert.equal(resolveTaitoRecord(row("終日利用可能", "19:00")).openingHours.status, "unparsed");
  assert.equal(resolveTaitoRecord(row("7時", "19:00")).openingHours.status, "unparsed");
  assert.equal(resolveTaitoRecord(row("20:00", "7:00")).openingHours.status, "unparsed");
  assert.equal(resolveTaitoRecord(row("7:00", "19:00", "臨時休業あり")).openingHours.status, "unparsed");
  assert.equal(resolveTaitoRecord(row("7:00", "19:00", "※加熱式たばこ専用")).openingHours.status, "unparsed");
  assert.throws(() => resolveTaitoRecord(["1", "", "", "x", "", "", "", "", "", "35,7", "139.7", ""]), /non-decimal 緯度/);
});
