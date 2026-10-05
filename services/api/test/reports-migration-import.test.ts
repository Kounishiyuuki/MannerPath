import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { unstable_splitSqlQuery } from "wrangler";
import { applyLocal, BOOKKEEPING_SCHEMA, DATABASE_ID, DATABASE_NAME, importArtifact, MIGRATION, migrationBytes, remoteTarget, sha256, sqliteSnapshot, verifyArtifact, verifySnapshot } from "../scripts/reports-migration-import.ts";
import { applyMigration } from "./support/sqlite-d1.ts";
import { readJsonc } from "../scripts/release-preflight.ts";

function fresh(databasePath = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(BOOKKEEPING_SCHEMA);
  for (const name of ["0001_report_store.sql", "0002_scale_indexes.sql"]) {
    applyMigration(database, readFileSync(new URL(`../migrations-reports/${name}`, import.meta.url), "utf8"));
    database.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
  }
  return database;
}

test("0003 exact import: full schema, bookkeeping and integrity; rerun refuses without mutation", () => {
  const database = fresh();
  try {
    const bytes = importArtifact();
    assert.ok(bytes.subarray(0, migrationBytes().length).equals(migrationBytes()));
    verifySnapshot(sqliteSnapshot(database));
    applyLocal(database, bytes, sha256(bytes));
    verifySnapshot(sqliteSnapshot(database), true);
    assert.equal(database.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='trigger' AND name LIKE 'community_photo%'").get()?.count, 10);
    const before = sqliteSnapshot(database);
    assert.throws(() => applyLocal(database, bytes, sha256(bytes)), /ledger mismatch/);
    assert.deepEqual(sqliteSnapshot(database), before);
    assert.deepEqual(database.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map(row => row.name), ["0001_report_store.sql", "0002_scale_indexes.sql", MIGRATION]);
  } finally { database.close(); }
});

test("bookkeeping failure rolls back the exact migration schema in the same atomic import", () => {
  const database = fresh();
  try {
    database.prepare("INSERT INTO d1_migrations(name) VALUES ('unexpected.sql')").run();
    const before = sqliteSnapshot(database);
    assert.throws(() => applyMigration(database, importArtifact().toString("utf8")), /NOT NULL constraint failed/);
    assert.deepEqual(sqliteSnapshot(database), before);
  } finally { database.close(); }
});

test("partial schema, canonical mixup, ledger/schema drift and artifact tampering fail closed", () => {
  for (const mutation of [
    "CREATE TABLE community_photo_deletions(storage_key TEXT PRIMARY KEY, queued_at TEXT NOT NULL)",
    "CREATE TABLE spots(id TEXT)",
    "INSERT INTO d1_migrations(name) VALUES ('0003_evidence_photos.sql')",
    "ALTER TABLE d1_migrations ADD COLUMN extra TEXT",
  ]) {
    const database = fresh();
    try {
      database.exec(mutation);
      const before = sqliteSnapshot(database);
      assert.throws(() => applyLocal(database, importArtifact(), sha256(importArtifact())));
      assert.deepEqual(sqliteSnapshot(database), before);
    } finally { database.close(); }
  }
  assert.throws(() => verifyArtifact(importArtifact(), "0".repeat(64)), /digest mismatch/);
  const tampered = Buffer.concat([importArtifact(), Buffer.from("SELECT 1;")]);
  assert.throws(() => verifyArtifact(tampered, sha256(tampered)), /exact repository/);
});

test("remote apply is limited to explicit production REPORTS_DB, interactive and outside CI", () => {
  const config = readJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const valid = () => new Map([["--env", "production"], ["--database-id", DATABASE_ID], ["--confirm-production", DATABASE_NAME]]);
  remoteTarget(valid(), { interactive: true, ci: false }, true, config);
  for (const [interactive, ci] of [[false, false], [true, true]]) assert.throws(() => remoteTarget(valid(), { interactive, ci }, true, config), /interactive/);
  for (const key of ["--env", "--database-id", "--confirm-production"]) {
    const flags = valid();
    flags.delete(key);
    assert.throws(() => remoteTarget(flags, { interactive: true, ci: false }, true, config));
  }
  const canonical = valid();
  canonical.set("--database-id", "ffbaea1e-b57e-4064-abeb-a0c53f459662");
  assert.throws(() => remoteTarget(canonical, { interactive: true, ci: false }, true, config));
  assert.throws(() => remoteTarget(valid(), { interactive: true, ci: false }, true, { env: {} }));
});

test("schema comparison ignores SQL comments/formatting but preserves literals", () => {
  const database = fresh();
  try {
    const snapshot = sqliteSnapshot(database);
    snapshot.schema = snapshot.schema.map(object => ({ ...object, sql: object.sql === null ? null : unstable_splitSqlQuery(object.sql).join(";\n") }));
    verifySnapshot(snapshot);
    assert.throws(() => verifySnapshot({ ...snapshot, integrity: null }), /integrity check failed/);
    verifySnapshot({ ...snapshot, integrity: null }, false, true);
    const reports = snapshot.schema.find(object => object.name === "reports")!;
    reports.sql = reports.sql!.replace("'missing'", "' missing '");
    assert.throws(() => verifySnapshot(snapshot), /schema mismatch/);
  } finally { database.close(); }
});

test("exact LF/uppercase trigger bytes and Wrangler client splitting both work in SQLite", () => {
  const bytes = migrationBytes();
  assert.equal(bytes.includes(13), false);
  const database = fresh();
  try {
    const statements = unstable_splitSqlQuery(bytes.toString("utf8"));
    assert.equal(statements.length, 14);
    for (const statement of statements) database.exec(statement);
    assert.equal(database.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name LIKE 'community_photo%' OR name='community_evidence_photos'").get()?.count, 14);
  } finally { database.close(); }
});

test("CLI prepares reviewable bytes, verifies and applies locally; noninteractive remote apply never reaches Wrangler", (context) => {
  const root = mkdtempSync(join(tmpdir(), "reports-migration-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = join(root, "reports.sqlite");
  fresh(databasePath).close();
  const file = join(root, "import.sql");
  const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/reports-migration.ts", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, CI: "true" } });
  assert.equal(run("prepare", "--out", file).status, 0);
  assert.notEqual(run("prepare", "--out", file).status, 0);
  const digest = sha256(readFileSync(file));
  assert.equal(run("verify-local", "--database", databasePath).status, 0);
  const apply = run("apply-local", "--database", databasePath, "--file", file, "--expected-digest", digest);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(run("verify-local", "--database", databasePath, "--completed", "true").status, 0);
  assert.notEqual(run("apply-local", "--database", databasePath, "--file", file, "--expected-digest", digest).status, 0);
  const remote = run("apply-remote", "--env", "production", "--database-id", DATABASE_ID, "--confirm-production", DATABASE_NAME, "--file", file, "--expected-digest", digest);
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /interactive terminal outside CI/);
  assert.doesNotMatch(remote.stdout, /Executing on remote|Importing reviewed/);
});
