import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { Db } from "../src/db.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { REPORT_DATA_GROUPS, reportPrivacyInventory } from "../src/reports/privacy-inventory.ts";
import { reportsD1, SqliteD1 } from "./support/sqlite-d1.ts";
const received = new Date("2026-01-01T00:00:00Z");

test("inventory reads every reviewed table and never emits personal values or implies external inspection", async () => {
  const db = reportsD1();
  await createReport(db, { schemaVersion: 1, type: "other", spotId: `sp_${"0".repeat(26)}`, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: "private-note-sentinel" }, {
    now: received, attestationStatus: "notProvided", submitterHash: "b".repeat(64), newReportId: () => `rp_${"0".repeat(26)}`,
  });
  const reads: string[] = [];
  const readonly: Db = { prepare(sql) { reads.push(sql); assert.match(sql, /^SELECT/); return db.prepare(sql); }, async batch() { assert.fail("inventory must not write"); } };
  const result = await reportPrivacyInventory(readonly, minimizeAfter(received));
  assert.equal(Object.values(REPORT_DATA_GROUPS).flat().length, 22);
  assert.equal(result.coverage, "reviewed-table-set");
  assert.equal(result.groups.reports.reports, 1);
  assert.deepEqual(result.reportStatus, { notMinimized: 1, dueForMinimization: 1, minimizedSkeletons: 0 });
  assert.deepEqual(result.outsideScope, { engineManagedMetadata: "not-inspected", dataDbArtifacts: "not-inspected", providerLogs: "not-inspected", supportMailbox: "not-inspected", backups: "not-inspected" });
  assert.equal(result.ownershipVerified || result.publicationReady || result.writesPerformed, false);
  assert.doesNotMatch(JSON.stringify(result), /private-note|rp_0|b{64}|2026-|8f1c4d2e/);
  assert.equal(reads.some(sql => /SELECT \*/.test(sql)), false);
  await applyReportRetention(db, { now: minimizeAfter(received) });
  assert.deepEqual((await reportPrivacyInventory(db, minimizeAfter(received))).reportStatus, { notMinimized: 0, dueForMinimization: 0, minimizedSkeletons: 1 });
});
test("unknown tables require review; missing schema and canonical store never count as empty", async () => {
  const db = reportsD1();
  db.raw.exec("CREATE TABLE _cf_METADATA(key TEXT PRIMARY KEY,value BLOB); CREATE TABLE d1_migrations(id INTEGER)");
  assert.equal((await reportPrivacyInventory(db, received)).unreviewedTables, 0);
  db.raw.exec("CREATE TABLE private_unreviewed_table(secret TEXT); CREATE TABLE _cf_unreviewed(secret TEXT)");
  const result = await reportPrivacyInventory(db, received);
  assert.equal(result.coverage, "unreviewed-tables");
  assert.equal(result.unreviewedTables, 2);
  assert.doesNotMatch(JSON.stringify(result), /private_unreviewed|secret/);
  await assert.rejects(reportPrivacyInventory(new SqliteD1(), received));
  const wrong = reportsD1(); wrong.raw.exec("UPDATE report_store_meta SET value='unreviewed-schema' WHERE key='schema'");
  await assert.rejects(reportPrivacyInventory(wrong, received));
  const old = reportsD1(); old.raw.exec("DROP TABLE new_spot_evidence_checks");
  await assert.rejects(reportPrivacyInventory(old, received));
});
test("CLI refuses remote/apply/extra arguments without opening a target or printing error details", () => {
  for (const args of [["--remote"], ["apply"], ["--env", "production"]]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/report-privacy-inventory.ts", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), { event: "reportPrivacyInventory", outcome: "unavailable" });
  }
});

test("impact CLI rejects flags before any database access and never echoes raw diagnostics", () => {
  for (const args of [["--remote"], ["private-report-id"], ["apply", "--env", "production"]]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/report-erasure-impact.ts", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "erasure-impact unavailable\n");
  }
});
