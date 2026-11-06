// The scheduled cleanup's D1 reads stay bounded as stored reports grow (docs/release/V1_RETENTION_CAPACITY.md): its
// receipt check reads only live and recently received reports, by index, and still catches what a pass can break.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db.ts";
import { REPORT_MINIMIZE_AFTER_DAYS, createReport, minimizeAfter } from "../src/reports/create.ts";
import { receiptStatement } from "../src/reports/idempotency.ts";
import { runReportRetention } from "../src/reports/retention.ts";
import { PASS_RECEIPT_DAYS, retentionStatus, runRetentionMaintenance } from "../src/reports/retention-automation.ts";
import { reportsD1, type SqliteD1 } from "./support/sqlite-d1.ts";

const DAY = 86_400_000;
async function seed(db: SqliteD1, from: number, count: number, received: Date) {
  for (let i = from; i < from + count; i++) await createReport(db, { schemaVersion: 3, type: "exists", spotId: `sp_${"0".repeat(26)}`, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", idempotencyKey: "a".repeat(64), note: "synthetic", observedOn: "2026-01-01" }, {
    now: received, attestationStatus: "verified", submitterHash: "b".repeat(64), newReportId: () => `rp_${String(i).padStart(26, "0")}`,
    after: (id, at) => [receiptStatement(db, i.toString(16).padStart(64, "0"), id, "c".repeat(64), at)],
  });
}
const plan = (db: SqliteD1, sql: string, n: number) =>
  (db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill("2026-01-01T00:00:00Z")) as { detail: string }[]).map((r) => r.detail);

test("the cleanup run reads reports and receipts only through indexes; no full scan of either", async () => {
  const db = reportsD1(); const statements: string[] = [];
  const spy: Db = { prepare(sql) { statements.push(sql); return db.prepare(sql); }, batch: (s) => db.batch(s) };
  await runRetentionMaintenance(spy, { now: new Date("2026-06-01T00:00:00Z"), mode: "cleanup" });
  const status = statements.filter((s) => s.includes("inconsistentReceipts"));
  assert.ok(status.length >= 2);
  for (const sql of status) {
    const details = plan(db, sql, (sql.match(/\?/g) ?? []).length);
    assert.equal(details.some((d) => /^SCAN (i|r|report_idempotency|reports)\b(?! USING INDEX reports_minimize_due)/.test(d)), false, details.join(" | "));
    assert.ok(details.some((d) => /^SEARCH r USING INDEX reports_received_page \(received_at>\? AND received_at<\?\)/.test(d)), details.join(" | "));
    assert.ok(details.some((d) => /^SEARCH r USING INDEX reports_minimize_due \(minimize_after<\?\)/.test(d)), details.join(" | "));
  }
});

test("the pass scope catches what a pass can break; only full sees drift outside it", async () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const id = (i: number) => `rp_${String(i).padStart(26, "0")}`;
  const db = reportsD1();
  await seed(db, 0, 1, ago(REPORT_MINIMIZE_AFTER_DAYS + PASS_RECEIPT_DAYS + 30)); // minimized long ago
  await seed(db, 1, 1, ago(REPORT_MINIMIZE_AFTER_DAYS + 3));                      // minimized this week
  await runReportRetention(db, { now, batchSize: 200 });
  await seed(db, 2, 1, ago(REPORT_MINIMIZE_AFTER_DAYS + 40));                     // due, not minimized yet (backlog)
  await seed(db, 3, 1, ago(10));                                                  // live, not due
  assert.equal((await retentionStatus(db, now, "full")).inconsistentReceipts, 0);
  // Drift the triggers forbid (e.g. a restore from an old copy), made behind their back.
  db.raw.exec("DROP TRIGGER report_idempotency_retire_only");
  for (const i of [0, 1]) db.raw.exec(`UPDATE report_idempotency SET retired_at = NULL, request_sha256 = '${"c".repeat(64)}' WHERE report_id = '${id(i)}'`);
  for (const i of [2, 3]) db.raw.exec(`UPDATE report_idempotency SET retired_at = '${now.toISOString().slice(0, 19)}Z', request_sha256 = NULL WHERE report_id = '${id(i)}'`);
  assert.equal((await retentionStatus(db, now, "pass")).inconsistentReceipts, 2, "this week's minimized one and the due one");
  assert.equal((await retentionStatus(db, now, "full")).inconsistentReceipts, 4);
  assert.equal((await runRetentionMaintenance(db, { now, mode: "cleanup" })).outcome, "failed");
  assert.equal((await runRetentionMaintenance(db, { now, mode: "monitor" })).remaining?.inconsistentReceipts, 4);
});

test("cleanup drains a backlog in bounded passes and a re-run changes nothing", async () => {
  const received = new Date("2026-01-01T00:00:00Z"), now = minimizeAfter(received);
  const db = reportsD1(); await seed(db, 0, 23, received);
  const outcomes = [];
  for (let i = 0; i < 4; i++) outcomes.push((await runRetentionMaintenance(db, { now, mode: "cleanup" })).outcome);
  assert.deepEqual(outcomes, ["overdue", "overdue", "complete", "complete"]);
  const snapshot = db.raw.prepare("SELECT group_concat(report_id || ':' || redacted_at) s FROM reports").get();
  assert.equal((await runRetentionMaintenance(db, { now: new Date(now.getTime() + 300_000), mode: "cleanup" })).outcome, "complete");
  assert.deepEqual(db.raw.prepare("SELECT group_concat(report_id || ':' || redacted_at) s FROM reports").get(), snapshot);
  assert.equal((await retentionStatus(db, now, "full")).inconsistentReceipts, 0);
});
