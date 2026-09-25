import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { applyMigration, migratedSqlite } from "./support/sqlite-d1.ts";

const MIGRATION = readFileSync(new URL("../migrations/0008_source_observations.sql", import.meta.url), "utf8");
const T = "2026-09-25T00:00:00Z";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function parentRows(db: ReturnType<typeof migratedSqlite>, sourceId = "src-a") {
  db.prepare("INSERT INTO sources (source_id, display_name, kind, publication_status, created_at, updated_at) VALUES (?, ?, 'municipal', 'approved', ?, ?)")
    .run(sourceId, sourceId, T, T);
  const releaseId = Number(db.prepare(
    "INSERT INTO source_releases (source_id, observed_on, fetched_at, source_url, content_sha256, byte_length, header_json, record_count, parser_version) " +
    "VALUES (?, '2026-09-01', ?, 'https://example.invalid/x.csv', ?, 1, '[\"id\"]', 1, 'test-parser.v1')",
  ).run(sourceId, T, sha(sourceId)).lastInsertRowid);
  const raw = JSON.stringify(["1"]);
  const recordId = Number(db.prepare(
    "INSERT INTO source_records (release_id, ordinal, upstream_row_ref, raw_values_json, raw_sha256) VALUES (?, 1, '1', ?, ?)",
  ).run(releaseId, raw, sha(raw)).lastInsertRowid);
  return { releaseId, recordId };
}

function insertObservation(db: ReturnType<typeof migratedSqlite>, recordId: number, releaseId: number, sourceId: string, mapping = "map.v1") {
  return db.prepare(
    "INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, name, latitude, longitude, supports_paper, supports_heated, " +
    "opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle, publication_hold, provenance_json, attenuations_json) " +
    "VALUES (?, ?, ?, ?, 'n', 35.0, 139.0, 'unknown', 'unknown', 'unknown', NULL, 'unparsed', 'active', NULL, '[]', '[]')",
  ).run(recordId, releaseId, sourceId, mapping);
}

test("0008 creates the observation table/index/immutability triggers", () => {
  const db = migratedSqlite("0007_app_attest.sql");
  applyMigration(db, MIGRATION);
  const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'source_observations%' ORDER BY type, name")
    .all().map((r) => String(r.type) + ":" + String(r.name));
  for (const expected of [
    "index:source_observations_release",
    "table:source_observations",
    "trigger:source_observations_immutable",
    "trigger:source_observations_no_delete",
    "trigger:source_observations_source_matches_release",
  ]) assert.ok(objects.includes(expected), "missing " + expected);
});

test("0008 observations are versioned, source-consistent and immutable", () => {
  const db = migratedSqlite();
  const a = parentRows(db, "src-a");
  insertObservation(db, a.recordId, a.releaseId, "src-a");
  assert.throws(() => insertObservation(db, a.recordId, a.releaseId, "src-a"), /UNIQUE/);
  insertObservation(db, a.recordId, a.releaseId, "src-a", "map.v2");
  assert.equal(db.prepare("SELECT count(*) AS n FROM source_observations").get()!.n, 2);

  const first = db.prepare("SELECT observation_id FROM source_observations ORDER BY observation_id LIMIT 1").get()!;
  assert.throws(() => db.prepare("UPDATE source_observations SET name = 'x' WHERE observation_id = ?").run(first.observation_id), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM source_observations WHERE observation_id = ?").run(first.observation_id), /immutable/);

  const db2 = migratedSqlite();
  const p = parentRows(db2, "src-a");
  db2.prepare("INSERT INTO sources (source_id, display_name, kind, publication_status, created_at, updated_at) VALUES ('src-b', 'src-b', 'municipal', 'approved', ?, ?)")
    .run(T, T);
  assert.throws(() => insertObservation(db2, p.recordId, p.releaseId, "src-b"), /source does not match release/);
});
