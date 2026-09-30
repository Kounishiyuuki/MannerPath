// A promotion bundle bootstraps only an EMPTY, freshly migrated database (migration 0016, Issue #100; v3: 0018).
// Every table must be named by promotion_bootstraps_empty_target itself — reports, rate windows and
// App Attest rows reference no canonical row, so no parent check could stand in for them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type DatabaseSync } from "node:sqlite";
import { buildMultiSourcePromotionBundle, buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite } from "./support/sqlite-d1.ts";

const REFUSED = /promotion_(multi_)?bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database/;
const GUARDS = ["promotion_bootstraps_empty_target", "promotion_multi_bootstraps_empty_target"];
const TABLES = (db: DatabaseSync) => (db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
).all() as { name: string }[]).map((r) => r.name);

const origin = (async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return db;
})();
const bundles = (async () => [(await buildPromotionBundle(await origin)).sql, (await buildMultiSourcePromotionBundle(await origin)).sql])();

function refusedWithNothingWritten(target: DatabaseSync, sql: string, seeded: string): void {
  const before = Object.fromEntries(TABLES(target).map((t) => [t, (target.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n]));
  assert.throws(() => applyPromotionBundle(target, sql), REFUSED, `a row in ${seeded} must refuse the bootstrap`);
  for (const t of TABLES(target)) {
    assert.equal((target.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n, before[t], `${t}: no bundle row may remain`);
  }
}

test("both bootstrap guards (v2 and v3) name every table of a freshly migrated schema", () => {
  const db = migratedSqlite();
  const tables = TABLES(db);
  assert.equal(tables.length, 46);
  for (const guard of GUARDS) {
    const trigger = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(guard) as { sql: string }).sql;
    for (const t of tables) assert.match(trigger, new RegExp(`EXISTS \\(SELECT 1 FROM ${t}\\)`), `${guard}: ${t} is not checked`);
  }
  for (const t of tables) assert.equal((db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n, 0, `${t} is not empty after migrating`);
});

test("a freshly migrated database accepts either bundle version, and neither over the other", async () => {
  const [v2, v3] = await bundles;
  const target = migratedSqlite();
  applyPromotionBundle(target, v2);
  assert.equal((target.prepare("SELECT count(*) n FROM promotion_bootstrap_completions").get() as { n: number }).n, 1);
  assert.throws(() => applyPromotionBundle(target, v3), REFUSED);
  const other = migratedSqlite();
  applyPromotionBundle(other, v3);
  assert.equal((other.prepare("SELECT count(*) n FROM promotion_multi_bootstrap_completions").get() as { n: number }).n, 1);
  assert.throws(() => applyPromotionBundle(other, v2), REFUSED);
});

// Rows the application itself writes into tables that hang off no canonical row, through their real constraints.
const APPLICATION_ROWS: [string, string[]][] = [
  ["report_rate_windows", [`INSERT INTO report_rate_windows VALUES ('${"a".repeat(64)}', 'hour', '2026-09-01T00:00:00Z', 3, '2026-09-01T01:00:00Z')`]],
  ["reports", [`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status, received_at, minimize_after)
    VALUES ('rp_${"0".repeat(26)}', 1, 'exists', 'sp_${"0".repeat(26)}', 'notProvided', '2026-09-01T00:00:00Z', '2026-11-30T00:00:00Z')`]],
  ["report_moderation", [`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status, received_at, minimize_after)
    VALUES ('rp_${"0".repeat(26)}', 1, 'exists', 'sp_${"0".repeat(26)}', 'notProvided', '2026-09-01T00:00:00Z', '2026-11-30T00:00:00Z')`,
  `INSERT INTO report_moderation (report_id, state, updated_at) VALUES ('rp_${"0".repeat(26)}', 'pending', '2026-09-01T00:00:00Z')`]],
  ["app_attest_keys", [`INSERT INTO app_attest_keys VALUES ('${"A".repeat(43)}=', '04${"a".repeat(128)}', 'production', 0, '2026-09-01T00:00:00Z')`]],
  ["app_attest_challenges", [`INSERT INTO app_attest_challenges (challenge, purpose, issued_at, expires_at)
    VALUES ('${"B".repeat(43)}=', 'registration', '2026-09-01T00:00:00Z', '2026-09-01T00:05:00Z')`]],
];

for (const [table, statements] of APPLICATION_ROWS) {
  test(`application data in ${table} refuses the bootstrap`, async () => {
    const target = migratedSqlite();
    for (const s of statements) target.exec(s);
    for (const sql of await bundles) refusedWithNothingWritten(target, sql, table);
  });
}

// Every table, alone: one synthetic row with foreign keys, CHECKs and that table's own insert triggers
// out of the way, so the refusal can only come from the guard naming that very table.
for (const table of TABLES(migratedSqlite())) {
  test(`a row in ${table} alone refuses the bootstrap`, async () => {
    const target = migratedSqlite();
    for (const { name } of target.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name NOT IN ('${GUARDS.join("', '")}')`).all(table) as { name: string }[]) {
      target.exec(`DROP TRIGGER ${name}`);
    }
    const columns = (target.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    target.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;");
    target.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "1").join(", ")})`).run();
    target.exec("PRAGMA foreign_keys = ON; PRAGMA ignore_check_constraints = OFF;");
    assert.deepEqual(TABLES(target).filter((t) => (target.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n > 0), [table]);
    for (const sql of await bundles) refusedWithNothingWritten(target, sql, table);
  });
}
