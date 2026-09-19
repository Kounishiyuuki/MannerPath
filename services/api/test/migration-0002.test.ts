// Migration 0002 rebuilds `spots` to allow spot_type 'unknown'. It must keep foreign keys, indexes
// and triggers exactly as in 0001, and must refuse to run once spots exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMigration, migratedSqlite } from "./support/sqlite-d1.ts";

const T = "2026-09-20T00:00:00Z";
const MIGRATION_0002 = readFileSync(new URL("../migrations/0002_spot_type_unknown.sql", import.meta.url), "utf8");

function insertSpot(db: ReturnType<typeof migratedSqlite>, spotType: string) {
  db.prepare(
    `INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type, lifecycle,
       evidence_quality, evidence_quality_version, resolver_version, created_at, updated_at)
     VALUES ('spot-0001', 'n', 35.7, 139.7, 14, 1, 1, '14/1/1', ?, 'active', 'q', 'q.v1', 'r.v1', ?, ?)`,
  ).run(spotType, T, T);
}
const schemaObjects = (db: ReturnType<typeof migratedSqlite>) =>
  db.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();

test("0002 rebuilds an empty spots table with the same references, indexes and triggers, and accepts 'unknown'", () => {
  const db = migratedSqlite("0001_initial_schema.sql");
  const objectsBefore = schemaObjects(db);
  applyMigration(db, MIGRATION_0002);

  assert.deepEqual(schemaObjects(db), objectsBefore);
  assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE sql LIKE '%spots_v2%' OR name LIKE 'migration_%'").get()!.n, 0);

  db.exec(`
    INSERT INTO sources (source_id, display_name, kind, created_at, updated_at) VALUES ('s', 's', 'municipal', '${T}', '${T}');
    INSERT INTO source_entities (source_entity_id, source_id, created_at) VALUES (1, 's', '${T}');
  `);
  insertSpot(db, "unknown");
  assert.throws(() => db.prepare("UPDATE spots SET spot_type = 'konbini'").run(), /CHECK/);
  assert.throws(() => db.prepare("DELETE FROM spots").run(), /never deleted/);
  assert.throws(
    () => db.prepare("INSERT INTO spot_source_entities (source_entity_id, spot_id, method, linked_at, resolver_version) VALUES (1, 'missing-spot', 'created', ?, 'r')").run(T),
    /FOREIGN KEY/,
  );
  db.prepare("INSERT INTO tile_snapshots (tile_id, z, x, y, revision, schema_version, content_sha256, spot_count, body_json, published_at) VALUES ('14/1/1', 14, 1, 1, 1, 1, ?, 0, '{}', ?)").run("0".repeat(64), T);
  assert.throws(
    () => db.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES ('spot-0001', '14/1/1')").run(),
    /not publishable/,
    "the recreated publication-invariant trigger reads the rebuilt table",
  );
});

test("0002 refuses to run once spots exist, and rolls back completely", () => {
  const db = migratedSqlite("0001_initial_schema.sql");
  insertSpot(db, "ashtray");
  const objectsBefore = schemaObjects(db);
  assert.throws(() => applyMigration(db, MIGRATION_0002), /spots_table_must_be_empty/);
  assert.deepEqual(schemaObjects(db), objectsBefore);
  assert.equal(db.prepare("SELECT spot_type FROM spots").get()!.spot_type, "ashtray");
});
