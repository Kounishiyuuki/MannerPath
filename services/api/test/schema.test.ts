// Schema contract tests for migrations/0001_initial_schema.sql, run on a fresh in-memory SQLite
// database (D1 is SQLite; D1 always enforces foreign keys, so they are switched on here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { formatTileId, tileForCoordinate } from "../src/geo/tile.ts";

const MIGRATION = readFileSync(new URL("../migrations/0001_initial_schema.sql", import.meta.url), "utf8");
const FIXTURE = readFileSync(
  new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url),
);
const T = "2026-09-20T00:00:00Z";
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

// Minimal RFC 4180 reader for this test only (the production importer is a later task).
function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { /* CRLF record end; \n handles it */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(MIGRATION);
  return db;
}

function insertSource(db: DatabaseSync, id: string, status = "approved", kind = "municipal") {
  db.prepare(
    "INSERT INTO sources (source_id, display_name, kind, publication_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, id, kind, status, T, T);
}

function insertRelease(db: DatabaseSync, sourceId: string, header: string[], opts: { sha?: string; status?: string; current?: number; observedOn?: string | null } = {}): number {
  const status = opts.status ?? "applied";
  const r = db.prepare(
    `INSERT INTO source_releases (source_id, observed_on, fetched_at, source_url, content_sha256, byte_length,
       header_json, record_count, parser_version, status, is_current, applied_at)
     VALUES (?, ?, ?, 'https://example.invalid/x.csv', ?, 1, ?, 0, 'test.v1', ?, ?, ?)`,
  ).run(sourceId, opts.observedOn === undefined ? "2026-08-18" : opts.observedOn, T, opts.sha ?? sha256(String(Math.random())), JSON.stringify(header), status, opts.current ?? 0, status === "applied" ? T : null);
  return Number(r.lastInsertRowid);
}

function insertRecord(db: DatabaseSync, releaseId: number, ordinal: number, values: string[]): number {
  const json = JSON.stringify(values);
  const r = db.prepare(
    "INSERT INTO source_records (release_id, ordinal, upstream_row_ref, raw_values_json, raw_sha256) VALUES (?, ?, ?, ?, ?)",
  ).run(releaseId, ordinal, values[0] ?? null, json, sha256(json));
  return Number(r.lastInsertRowid);
}

function insertSpot(db: DatabaseSync, spotId: string, lat: number, lon: number, extra: { lifecycle?: string; mergedInto?: string } = {}) {
  const t = tileForCoordinate(lat, lon, 14);
  db.prepare(
    `INSERT INTO spots (spot_id, merged_into, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type,
       lifecycle, evidence_quality, evidence_quality_version, last_verified_at, resolver_version, created_at, updated_at)
     VALUES (?, ?, 'n', ?, ?, ?, ?, ?, ?, 'designatedOutdoorArea', ?, 'official', 'q.v1', '2026-08-18', 'r.v1', ?, ?)`,
  ).run(spotId, extra.mergedInto ?? null, lat, lon, t.z, t.x, t.y, formatTileId(t), extra.lifecycle ?? "active", T, T);
  return formatTileId(t);
}

function addExistence(db: DatabaseSync, spotId: string, recordId: number) {
  db.prepare(
    `INSERT INTO spot_field_provenance (spot_id, field, record_id, source_columns_json, rule, resolver_version, resolved_at)
     VALUES (?, 'existence', ?, '[]', 'listed.v1', 'r.v1', ?)`,
  ).run(spotId, recordId, T);
}

function upsertTile(db: DatabaseSync, tileId: string, revision: number, spotCount = 0) {
  const [z, x, y] = tileId.split("/").map(Number);
  const body = JSON.stringify({ schemaVersion: 1, tile: tileId, revision, spots: [], sources: [] });
  db.prepare(
    `INSERT INTO tile_snapshots (tile_id, z, x, y, revision, schema_version, content_sha256, spot_count, body_json, published_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (tile_id) DO UPDATE SET revision = excluded.revision, content_sha256 = excluded.content_sha256,
       spot_count = excluded.spot_count, body_json = excluded.body_json, published_at = excluded.published_at`,
  ).run(tileId, z, x, y, revision, sha256(body), spotCount, body, T);
}

// A publishable spot: approved source, applied release, existence evidence, active.
function publishableSpot(db: DatabaseSync, spotId = "sp_00000001", sourceStatus = "approved") {
  insertSource(db, "src-a", sourceStatus);
  const rel = insertRelease(db, "src-a", ["#", "name"]);
  const rec = insertRecord(db, rel, 1, ["1", "x"]);
  const tileId = insertSpot(db, spotId, 35.7112, 139.77377);
  addExistence(db, spotId, rec);
  upsertTile(db, tileId, 1);
  return { rel, rec, tileId };
}

const publish = (db: DatabaseSync, spotId: string, tileId: string) =>
  db.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(spotId, tileId);

test("migration applies to an empty database and passes integrity/foreign-key checks", () => {
  const db = freshDb();
  const names = db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
    .map((r) => `${r.type}:${r.name}`);
  for (const expected of [
    "table:sources", "table:source_releases", "table:source_records", "table:source_record_match_keys", "table:source_entities",
    "table:source_record_entities", "table:spots", "table:spot_source_entities", "table:spot_field_provenance",
    "table:tile_snapshots", "table:tile_snapshot_spots",
    "index:spots_tile", "index:tile_snapshot_spots_tile", "index:source_releases_one_current",
    "trigger:tile_snapshot_spots_publication_invariant",
  ]) assert.ok(names.includes(expected), `missing ${expected}`);
  assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("Taito fixture: all 34 records keep all 12 columns verbatim, including the multi-line field", () => {
  const db = freshDb();
  const [header, ...records] = parseCsv(FIXTURE.toString("utf8"));
  assert.equal(header.length, 12);
  assert.equal(records.length, 34);
  insertSource(db, "taito-public-smoking-areas", "blocked");
  const sha = sha256(FIXTURE);
  assert.equal(sha, "5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74"); // PROVENANCE.md
  const rel = insertRelease(db, "taito-public-smoking-areas", header, { sha, status: "ingested" });
  records.forEach((values, i) => insertRecord(db, rel, i + 1, values));

  const stored = db.prepare("SELECT ordinal, upstream_row_ref, raw_values_json FROM source_records WHERE release_id = ? ORDER BY ordinal").all(rel);
  assert.equal(stored.length, 34);
  stored.forEach((row, i) => assert.deepEqual(JSON.parse(row.raw_values_json as string), records[i]));
  const r32 = JSON.parse(stored[31].raw_values_json as string);
  // The embedded line break inside the quoted field is a bare LF in the source bytes; it is kept as-is.
  assert.equal(r32[11], "土日祝日、年末年始は休業\n※加熱式たばこ専用");
  const storedHeader = db.prepare("SELECT header_json FROM source_releases WHERE release_id = ?").get(rel);
  assert.deepEqual(JSON.parse(storedHeader!.header_json as string), header);
});

test("raw records: width must match header, and records are immutable", () => {
  const db = freshDb();
  insertSource(db, "src-a");
  const rel = insertRelease(db, "src-a", ["#", "name"]);
  assert.throws(() => insertRecord(db, rel, 1, ["1"]), /does not match release header/);
  const rec = insertRecord(db, rel, 1, ["1", "x"]);
  assert.throws(() => db.prepare("UPDATE source_records SET raw_values_json = '[\"1\",\"y\"]' WHERE record_id = ?").run(rec), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM source_records WHERE record_id = ?").run(rec), /immutable/);
  assert.throws(() => insertRecord(db, rel, 1, ["2", "y"]), /UNIQUE/);
});

test("releases: same bytes + same observation is one release; a source has at most one current release", () => {
  const db = freshDb();
  insertSource(db, "src-a");
  insertRelease(db, "src-a", ["a"], { sha: "a".repeat(64) });
  assert.throws(() => insertRelease(db, "src-a", ["a"], { sha: "a".repeat(64) }), /UNIQUE/);
  insertRelease(db, "src-a", ["a"], { current: 1 });
  assert.throws(() => insertRelease(db, "src-a", ["a"], { current: 1 }), /UNIQUE/);
  assert.throws(() => insertRelease(db, "src-a", ["a"], { status: "ingested", current: 1 }), /CHECK/);
});

test("releases: identical bytes re-published with a newer observed_on are a new release with their own evidence", () => {
  const db = freshDb();
  insertSource(db, "src-a", "approved");
  const sha = "b".repeat(64);
  const older = insertRelease(db, "src-a", ["#", "name"], { sha, observedOn: "2026-08-18" });
  const newer = insertRelease(db, "src-a", ["#", "name"], { sha, observedOn: "2026-11-18" });
  assert.notEqual(older, newer);
  const recOld = insertRecord(db, older, 1, ["1", "x"]);
  const recNew = insertRecord(db, newer, 1, ["1", "x"]);
  const rows = db.prepare(
    `SELECT rel.observed_on FROM source_records r JOIN source_releases rel USING (release_id)
     WHERE r.record_id IN (?, ?) ORDER BY rel.observed_on`,
  ).all(recOld, recNew).map((r) => r.observed_on);
  assert.deepEqual(rows, ["2026-08-18", "2026-11-18"]);
  assert.equal(db.prepare("SELECT count(*) n FROM source_releases WHERE content_sha256 = ?").get(sha)!.n, 2);
});

test("releases: evidence metadata is frozen once records exist; workflow fields stay updatable", () => {
  const db = freshDb();
  insertSource(db, "src-a");
  insertSource(db, "src-b");
  const rel = insertRelease(db, "src-a", ["#"], { status: "ingested" });
  db.prepare("UPDATE source_releases SET observed_on = '2026-08-19' WHERE release_id = ?").run(rel); // no records yet
  insertRecord(db, rel, 1, ["1"]);
  for (const set of [
    "source_id = 'src-b'", "observed_on = '2026-09-01'", "observed_on = NULL", "fetched_at = 'x'",
    "content_sha256 = '" + "c".repeat(64) + "'", "header_json = '[\"id\"]'", "parser_version = 'p.v2'",
    "source_url = 'https://example.invalid/y.csv'", "byte_length = 2", "record_count = 5", "release_id = 999",
  ]) {
    assert.throws(() => db.prepare(`UPDATE source_releases SET ${set} WHERE release_id = ?`).run(rel), /immutable once records exist/, set);
  }
  db.prepare("UPDATE source_releases SET status = 'applied', applied_at = ?, is_current = 1 WHERE release_id = ?").run(T, rel);
});

test("match keys: versioned separately from immutable raw records, and never rewritten", () => {
  const db = freshDb();
  insertSource(db, "src-a");
  const rel = insertRelease(db, "src-a", ["#", "name"]);
  const rec = insertRecord(db, rel, 1, ["1", "Ｘ"]);
  const add = db.prepare("INSERT INTO source_record_match_keys (record_id, key_version, match_key, derived_at) VALUES (?, ?, ?, ?)");
  add.run(rec, "key.v1", "Ｘ", T);
  add.run(rec, "key.v2", "x", T); // a new algorithm adds a row; raw record untouched
  assert.throws(() => add.run(rec, "key.v1", "other", T), /UNIQUE|PRIMARY/);
  assert.throws(() => db.prepare("UPDATE source_record_match_keys SET match_key = 'y' WHERE record_id = ?").run(rec), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM source_record_match_keys WHERE record_id = ?").run(rec), /immutable/);
  assert.throws(() => add.run(rec + 1, "key.v1", "z", T), /FOREIGN KEY/);
  const cols = db.prepare("PRAGMA table_info(source_records)").all().map((c) => c.name);
  assert.ok(!cols.some((c) => String(c).includes("key")), `raw table has derived key column: ${cols}`);
});

test("reconciliation: source identity cannot be mutated into a cross-source link after insert", () => {
  const db = freshDb();
  insertSource(db, "src-a");
  insertSource(db, "src-b");
  const relA = insertRelease(db, "src-a", ["#"]);
  const relB = insertRelease(db, "src-b", ["#"]);
  const recA = insertRecord(db, relA, 1, ["1"]);
  const recA2 = insertRecord(db, relA, 2, ["2"]);
  const recB = insertRecord(db, relB, 1, ["1"]);
  db.prepare("INSERT INTO source_entities (source_entity_id, source_id, created_at) VALUES (1, 'src-a', ?), (2, 'src-b', ?), (3, 'src-a', ?)").run(T, T, T);
  db.prepare(
    "INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at) VALUES (?, ?, 1, 'new', 'm.v1', ?)",
  ).run(recA, relA, T);

  assert.throws(() => db.prepare("UPDATE source_entities SET source_id = 'src-b' WHERE source_entity_id = 1").run(), /immutable/);
  assert.throws(() => db.prepare("UPDATE source_entities SET source_entity_id = 9 WHERE source_entity_id = 1").run(), /immutable/);
  assert.throws(() => db.prepare("UPDATE source_releases SET source_id = 'src-b' WHERE release_id = ?").run(relA), /immutable once records exist/);
  assert.throws(() => db.prepare("UPDATE source_record_entities SET source_entity_id = 2, method = 'manual' WHERE record_id = ?").run(recA), /different sources/);
  assert.throws(() => db.prepare("UPDATE source_record_entities SET method = 'manual', record_id = ?, release_id = ? WHERE record_id = ?").run(recB, relB, recA), /cannot change|different sources/);
  assert.throws(() => db.prepare("UPDATE source_record_entities SET method = 'manual', record_id = ? WHERE record_id = ?").run(recA2, recA), /cannot change/);
  assert.throws(() => db.prepare("UPDATE source_record_entities SET source_entity_id = 3 WHERE record_id = ?").run(recA), /manual/);
  assert.throws(() => db.prepare("DELETE FROM source_record_entities WHERE record_id = ?").run(recA), /do not delete/);
  // Automatic decision audit metadata cannot be silently rewritten.
  for (const set of ["matcher_version = 'm.v2'", "decided_at = '2027-01-01T00:00:00Z'", "note = 'x'", "method = 'natural_key'"]) {
    assert.throws(() => db.prepare(`UPDATE source_record_entities SET ${set} WHERE record_id = ?`).run(recA), /manual/, set);
  }
  assert.deepEqual(
    { ...db.prepare("SELECT method, matcher_version, decided_at FROM source_record_entities WHERE record_id = ?").get(recA) },
    { method: "new", matcher_version: "m.v1", decided_at: T },
  );

  // The allowed correction: a same-source manual reassignment.
  db.prepare("UPDATE source_record_entities SET source_entity_id = 3, method = 'manual', decided_at = ?, note = 'reviewed' WHERE record_id = ?").run(T, recA);
  assert.equal(db.prepare("SELECT source_entity_id FROM source_record_entities WHERE record_id = ?").get(recA)!.source_entity_id, 3);
});

test("reconciliation: an entity has at most one record per release and never crosses sources", () => {
  const db = freshDb();
  insertSource(db, "src-a");
  insertSource(db, "src-b");
  const rel = insertRelease(db, "src-a", ["#"]);
  const r1 = insertRecord(db, rel, 1, ["1"]);
  const r2 = insertRecord(db, rel, 2, ["2"]);
  db.prepare("INSERT INTO source_entities (source_entity_id, source_id, created_at) VALUES (1, 'src-a', ?), (2, 'src-b', ?)").run(T, T);
  const link = db.prepare(
    "INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at) VALUES (?, ?, ?, 'new', 'm.v1', ?)",
  );
  link.run(r1, rel, 1, T);
  assert.throws(() => link.run(r2, rel, 1, T), /UNIQUE/);
  assert.throws(() => link.run(r2, rel, 2, T), /different sources/);
  assert.throws(() => link.run(r2, rel + 1, 1, T), /FOREIGN KEY/);
});

test("publication invariant: accepted existence evidence from an approved source is required", () => {
  const db = freshDb();
  const { tileId } = publishableSpot(db);
  publish(db, "sp_00000001", tileId);

  insertSpot(db, "sp_noevidence", 35.7112, 139.77377);
  assert.throws(() => publish(db, "sp_noevidence", tileId), /not publishable/);
});

test("publication invariant: a blocked source's evidence does not publish", () => {
  const db = freshDb();
  const { tileId } = publishableSpot(db, "sp_00000001", "blocked");
  assert.throws(() => publish(db, "sp_00000001", tileId), /not publishable/);
});

test("publication invariant: evidence from a release that was not applied does not publish", () => {
  const db = freshDb();
  const { tileId } = publishableSpot(db);
  const rel = insertRelease(db, "src-a", ["#", "name"], { status: "ingested" });
  const rec = insertRecord(db, rel, 1, ["1", "x"]);
  insertSpot(db, "sp_00000002", 35.7112, 139.77377);
  addExistence(db, "sp_00000002", rec);
  assert.throws(() => publish(db, "sp_00000002", tileId), /not publishable/);
});

test("publication invariant: inactive, merged or wrong-tile spots do not publish", () => {
  const db = freshDb();
  const { rec, tileId } = publishableSpot(db);
  insertSpot(db, "sp_closed01", 35.7112, 139.77377, { lifecycle: "temporarilyClosed" });
  addExistence(db, "sp_closed01", rec);
  assert.throws(() => publish(db, "sp_closed01", tileId), /not publishable/);

  insertSpot(db, "sp_merged01", 35.7112, 139.77377, { mergedInto: "sp_00000001" });
  addExistence(db, "sp_merged01", rec);
  assert.throws(() => publish(db, "sp_merged01", tileId), /not publishable/);

  const other = insertSpot(db, "sp_other001", 35.719649, 139.79532);
  addExistence(db, "sp_other001", rec);
  upsertTile(db, other, 1);
  assert.throws(() => publish(db, "sp_other001", tileId), /not publishable/);
  publish(db, "sp_other001", other);
});

test("a published spot must be unpublished before it stops being publishable", () => {
  const db = freshDb();
  const { tileId } = publishableSpot(db);
  publish(db, "sp_00000001", tileId);
  assert.throws(() => db.prepare("UPDATE spots SET lifecycle = 'removed' WHERE spot_id = 'sp_00000001'").run(), /unpublish/);
  db.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = 'sp_00000001'").run();
  db.prepare("UPDATE spots SET lifecycle = 'removed' WHERE spot_id = 'sp_00000001'").run();
  upsertTile(db, tileId, 2);
});

test("tile snapshots: z is fixed at 14, IDs are consistent, revisions only increase, rows are never deleted", () => {
  const db = freshDb();
  upsertTile(db, "14/14553/6449", 1);
  upsertTile(db, "14/14553/6449", 2);
  assert.throws(() => upsertTile(db, "14/14553/6449", 2), /revision must increase/);
  assert.throws(() => db.prepare("DELETE FROM tile_snapshots").run(), /never deleted/);
  assert.throws(() => upsertTile(db, "15/1/1", 1), /CHECK/);
  assert.throws(() => upsertTile(db, "14/16384/0", 1), /CHECK/);
  assert.throws(() => db.prepare(
    "INSERT INTO tile_snapshots VALUES ('14/1/2', 14, 1, 3, 1, 1, ?, 0, '{}', ?)",
  ).run("0".repeat(64), T), /CHECK/);
});

test("merges are one-hop, permanent redirects and spots are never deleted", () => {
  const db = freshDb();
  insertSpot(db, "sp_target01", 35.7112, 139.77377);
  insertSpot(db, "sp_source01", 35.7112, 139.77377);
  insertSpot(db, "sp_source02", 35.7112, 139.77377);
  db.prepare("UPDATE spots SET merged_into = 'sp_target01' WHERE spot_id = 'sp_source01'").run();
  assert.throws(() => db.prepare("UPDATE spots SET merged_into = 'sp_source01' WHERE spot_id = 'sp_source02'").run(), /itself merged/);
  assert.throws(() => insertSpot(db, "sp_source03", 35.7112, 139.77377, { mergedInto: "sp_source01" }), /itself merged/);
  assert.throws(() => db.prepare("UPDATE spots SET merged_into = 'sp_source02' WHERE spot_id = 'sp_target01'").run(), /repoint/);
  assert.throws(() => db.prepare("UPDATE spots SET merged_into = NULL WHERE spot_id = 'sp_source01'").run(), /cannot be removed/);
  assert.throws(() => db.prepare("UPDATE spots SET merged_into = spot_id WHERE spot_id = 'sp_source02'").run(), /CHECK/);
  assert.throws(() => db.prepare("DELETE FROM spots WHERE spot_id = 'sp_source02'").run(), /never deleted/);
});

test("enumerations and tri-states reject values outside the contract", () => {
  const db = freshDb();
  insertSpot(db, "sp_00000001", 35.7112, 139.77377);
  assert.throws(() => db.prepare("UPDATE spots SET supports_heated = 'true' WHERE spot_id = 'sp_00000001'").run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE spots SET tile_id = '14/0/0' WHERE spot_id = 'sp_00000001'").run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE spots SET opening_hours_status = 'parsed' WHERE spot_id = 'sp_00000001'").run(), /CHECK/);
  assert.throws(() => insertSource(db, "osm", "approved", "osm"), /CHECK/);
  assert.throws(() => insertSource(db, "Bad_ID", "blocked"), /CHECK/);
});

test("hot paths use indexes, not scans", () => {
  const db = freshDb();
  const plan = (sql: string) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail as string).join(" | ");
  assert.match(plan("SELECT body_json, content_sha256, revision FROM tile_snapshots WHERE tile_id = '14/1/2'"), /USING INDEX sqlite_autoindex_tile_snapshots_1/);
  assert.match(plan("SELECT * FROM spots WHERE spot_id = 'sp_00000001'"), /USING INDEX sqlite_autoindex_spots_1/);
  assert.match(plan("SELECT spot_id FROM spots WHERE tile_id = '14/1/2' AND merged_into IS NULL"), /USING INDEX spots_tile/);
  assert.match(plan("SELECT spot_id FROM tile_snapshot_spots WHERE tile_id = '14/1/2'"), /USING INDEX tile_snapshot_spots_tile/);
});
