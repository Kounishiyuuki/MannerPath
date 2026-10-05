import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readJsonc } from "./release-preflight.ts";
import { applyLocal, importArtifact, migrationBytes, remoteTarget, sha256, sqliteSnapshot, verifyArtifact, verifySnapshot, type Snapshot } from "./reports-migration-import.ts";

const [command, ...argv] = process.argv.slice(2);
const allowed: Record<string, string[]> = {
  prepare: ["--out"],
  "verify-local": ["--database", "--completed"],
  "apply-local": ["--database", "--file", "--expected-digest"],
  "verify-remote": ["--env", "--database-id", "--confirm-production", "--completed"],
  "apply-remote": ["--env", "--database-id", "--confirm-production", "--file", "--expected-digest"],
};
assert.ok(Object.hasOwn(allowed, command), "command must be prepare, verify-local, apply-local, verify-remote or apply-remote");
const flags = new Map<string, string>();
for (let index = 0; index < argv.length; index += 2) {
  const flag = argv[index], value = argv[index + 1];
  assert.ok(allowed[command].includes(flag) && value && !value.startsWith("--") && !flags.has(flag), `invalid/missing/duplicate option ${flag}`);
  flags.set(flag, value);
}
const required = (flag: string) => {
  const value = flags.get(flag);
  assert.ok(value, `${flag} required`);
  return value;
};
if (flags.has("--completed")) assert.equal(flags.get("--completed"), "true");
const cwd = fileURLToPath(new URL("../", import.meta.url));
const configPath = join(cwd, "wrangler.jsonc");
const wrangler = join(cwd, "node_modules/wrangler/bin/wrangler.js");
const query = "SELECT name FROM d1_migrations ORDER BY id; SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name; PRAGMA table_info(d1_migrations); PRAGMA foreign_key_check;";
function remoteSnapshot(): Snapshot {
  const results = JSON.parse(execFileSync(process.execPath, [wrangler, "d1", "execute", "REPORTS_DB", "--config", configPath, "--env", "production", "--remote", "--command", query, "--json"], { cwd, encoding: "utf8" }));
  assert.equal(results.length, 4);
  assert.ok(results.every((result: any) => result.success === true && result.meta?.rows_written === 0 && result.meta?.changed_db === false));
  return { migrations: results[0].results, schema: results[1].results, columns: results[2].results, integrity: null, foreignKeys: results[3].results };
}

if (command === "prepare") {
  const bytes = importArtifact();
  writeFileSync(resolve(required("--out")), bytes, { flag: "wx" });
  console.log(JSON.stringify({ status: "prepared", migrationSha256: sha256(migrationBytes()), artifactSha256: sha256(bytes), bytes: bytes.length }));
} else if (command.endsWith("local")) {
  const databasePath = resolve(required("--database"));
  assert.ok(existsSync(databasePath), "existing migrated local SQLite database required");
  const database = new DatabaseSync(databasePath, { readOnly: command === "verify-local" });
  try {
    database.exec("PRAGMA foreign_keys=ON");
    if (command === "apply-local") applyLocal(database, readFileSync(required("--file")), required("--expected-digest"));
    else verifySnapshot(sqliteSnapshot(database), flags.get("--completed") === "true");
    console.log(JSON.stringify({ status: command === "apply-local" ? "applied" : "verified", migration: "0003_evidence_photos.sql" }));
  } finally { database.close(); }
} else {
  remoteTarget(flags, { interactive: process.stdin.isTTY === true && process.stdout.isTTY === true, ci: Boolean(process.env.CI) }, command === "apply-remote", readJsonc(readFileSync(configPath, "utf8")));
  if (command === "verify-remote") {
    verifySnapshot(remoteSnapshot(), flags.get("--completed") === "true", true);
    console.log("REPORTS_DB schema/ledger/FK verified; remote integrity_check unsupported; no writes executed");
  } else {
    const bytes = readFileSync(required("--file"));
    verifyArtifact(bytes, required("--expected-digest"));
    verifySnapshot(remoteSnapshot(), false, true);
    const pinned = join(mkdtempSync(join(tmpdir(), "reports-migration-import-")), "0003-import.sql");
    writeFileSync(pinned, bytes, { flag: "wx", mode: 0o600 });
    console.log(`Importing reviewed bytes from ${pinned}; any failure requires read-only investigation, never blind replay`);
    execFileSync(process.execPath, [wrangler, "d1", "execute", "REPORTS_DB", "--config", configPath, "--env", "production", "--remote", "--file", pinned], { cwd, stdio: "inherit" });
    verifySnapshot(remoteSnapshot(), true, true);
    console.log("REPORTS_DB 0003 schema and bookkeeping verified; migration complete");
  }
}
