import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { unstable_splitSqlQuery } from "wrangler";

export const MIGRATION = "0003_evidence_photos.sql";
export const DATABASE_ID = "e641b1df-8042-4522-8463-804c6ba57868";
export const DATABASE_NAME = "mannerpath-production-reports";
export const MIGRATION_SHA256 = "17602d3af875ea3a346513b212a6e2ecbd34938eb10e656679de3039c701dc93";
export const BOOKKEEPING_SCHEMA = `CREATE TABLE "d1_migrations"(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT UNIQUE,
 applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;
const DIRECTORY = new URL("../migrations-reports/", import.meta.url);
const PREVIOUS = ["0001_report_store.sql", "0002_scale_indexes.sql"];

export interface SchemaObject { type: string; name: string; tbl_name: string; sql: string | null }
export interface Snapshot {
  migrations: { name: string }[];
  schema: SchemaObject[];
  columns: unknown[];
  integrity: { integrity_check: string }[] | null;
  foreignKeys: unknown[];
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function migrationBytes(): Buffer {
  assert.deepEqual(readdirSync(DIRECTORY).filter(name => name.endsWith(".sql")).sort(), [...PREVIOUS, MIGRATION], "only the reviewed three-migration stream is supported");
  const bytes = readFileSync(new URL(MIGRATION, DIRECTORY));
  assert.equal(sha256(bytes), MIGRATION_SHA256, "0003 repository bytes changed; independent review required");
  return bytes;
}

export function importArtifact(): Buffer {
  const bookkeeping = `\nINSERT INTO "d1_migrations" (name, applied_at)
SELECT '${MIGRATION}', CASE WHEN
 (SELECT count(*) FROM "d1_migrations") = 2 AND
 (SELECT count(*) FROM "d1_migrations" WHERE name IN ('${PREVIOUS[0]}', '${PREVIOUS[1]}')) = 2
 THEN CURRENT_TIMESTAMP ELSE NULL END;\n`;
  return Buffer.concat([migrationBytes(), Buffer.from(bookkeeping)]);
}

export function sqliteSnapshot(database: DatabaseSync): Snapshot {
  return {
    migrations: database.prepare("SELECT name FROM d1_migrations ORDER BY id").all() as Snapshot["migrations"],
    schema: database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all() as SchemaObject[],
    columns: database.prepare("PRAGMA table_info(d1_migrations)").all(),
    integrity: database.prepare("PRAGMA integrity_check").all() as Snapshot["integrity"],
    foreignKeys: database.prepare("PRAGMA foreign_key_check").all(),
  };
}

function applicationSchema(schema: SchemaObject[]): SchemaObject[] {
  return schema.filter(object => object.name !== "d1_migrations" && object.tbl_name !== "d1_migrations"
    && !object.name.startsWith("sqlite_") && !object.name.startsWith("_cf_"));
}

function schemaTokens(sql: string | null): string[] | null {
  if (sql === null) return null;
  return unstable_splitSqlQuery(`${sql}; SELECT 1;`).slice(0, -1).join(";").match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[\w]+|[^\s]/g) ?? [];
}

function reference(completed: boolean): Snapshot {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON");
    database.exec(BOOKKEEPING_SCHEMA);
    for (const name of PREVIOUS) {
      database.exec(readFileSync(new URL(name, DIRECTORY), "utf8"));
      database.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
    }
    if (completed) database.exec(importArtifact().toString("utf8"));
    return sqliteSnapshot(database);
  } finally { database.close(); }
}

export function verifySnapshot(snapshot: Snapshot, completed = false, remote = false): void {
  const expected = reference(completed);
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(snapshot.migrations), plain(expected.migrations), "migration ledger mismatch; do not retry or clean up");
  assert.deepEqual(plain(snapshot.columns), plain(expected.columns), "unexpected d1_migrations columns");
  const bookkeeping = snapshot.schema.filter(object => object.tbl_name === "d1_migrations");
  const normalize = (objects: SchemaObject[]) => objects.map(object => ({ ...object, sql: schemaTokens(object.sql) }));
  assert.deepEqual(normalize(bookkeeping), normalize(expected.schema.filter(object => object.tbl_name === "d1_migrations")), "unexpected d1_migrations uniqueness/schema");
  assert.deepEqual(normalize(applicationSchema(snapshot.schema)), normalize(applicationSchema(expected.schema)), "report schema mismatch or partial migration; stop without cleanup");
  if (remote) assert.equal(snapshot.integrity, null, "D1 remote integrity_check is unsupported, not a passing result");
  else assert.deepEqual(plain(snapshot.integrity), [{ integrity_check: "ok" }], "integrity check failed");
  assert.deepEqual(snapshot.foreignKeys, [], "foreign key check failed");
}

export function verifyArtifact(bytes: Buffer, expectedDigest: string): void {
  assert.match(expectedDigest, /^[0-9a-f]{64}$/, "reviewed artifact digest required");
  assert.equal(sha256(bytes), expectedDigest, "artifact digest mismatch");
  assert.equal(bytes.equals(importArtifact()), true, "artifact must contain exact repository migration bytes and reviewed bookkeeping only");
}

export function applyLocal(database: DatabaseSync, bytes: Buffer, expectedDigest: string): void {
  verifyArtifact(bytes, expectedDigest);
  verifySnapshot(sqliteSnapshot(database));
  database.exec("BEGIN");
  try {
    database.exec(bytes.toString("utf8"));
    verifySnapshot(sqliteSnapshot(database), true);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function remoteTarget(flags: Map<string, string>, runtime: { interactive: boolean; ci: boolean }, write: boolean, config: any): void {
  assert.equal(flags.get("--env"), "production", "explicit production environment required");
  assert.equal(flags.get("--database-id"), DATABASE_ID, "only the reviewed production REPORTS_DB is supported");
  assert.equal(flags.get("--confirm-production"), DATABASE_NAME, "typed production report-store confirmation required");
  if (write) assert.equal(runtime.interactive && !runtime.ci, true, "remote apply requires an interactive terminal outside CI");
  const databases = config.env?.production?.d1_databases ?? [];
  const reports = databases.find((entry: any) => entry.binding === "REPORTS_DB");
  assert.equal(reports?.database_id, DATABASE_ID);
  assert.equal(reports?.database_name, DATABASE_NAME);
  assert.equal(reports?.migrations_dir, "migrations-reports");
  assert.equal(databases.some((entry: any) => entry.binding !== "REPORTS_DB" && entry.database_id === DATABASE_ID), false);
}
