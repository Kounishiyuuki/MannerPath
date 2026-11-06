import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SOURCE_CHECK_CRONS, V1_RETENTION_CRON, dispatchScheduled } from "../src/scheduled.ts";
import { PHOTO_RETENTION_CRON } from "../src/reports/photo-policy.ts";
import { V1_PRODUCTION } from "../scripts/production-v1-plan.ts";
import { createReport } from "../src/reports/create.ts";
import { SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";
import type { Db } from "../src/db.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const CRON = "0 * * * *"; // test-only dispatch identity, no schedule is enabled
const controller = (cron: string) => ({ cron, scheduledTime: NOW.getTime(), noRetry() {} }) as ScheduledController;
const tripwire: Db = { prepare() { assert.fail("canonical database must remain untouched"); }, async batch() { assert.fail("canonical database must remain untouched"); } };
function deps() {
  const logs: string[] = [];
  const sourceCalls: string[] = [];
  return { logs, sourceCalls, now: () => NOW, log: (line: string) => logs.push(line),
    source: async (c: ScheduledController) => { sourceCalls.push(c.cron); } };
}

const SOURCE_CRON = SOURCE_CHECK_CRONS[0];

test("unconfigured retention preserves source dispatch; a designated off cron touches no store", async () => {
  const d = deps();
  await dispatchScheduled(controller(SOURCE_CRON), { DB: tripwire }, d);
  assert.deepEqual(d.sourceCalls, [SOURCE_CRON]);
  assert.deepEqual(d.logs, []);
  await dispatchScheduled(controller(CRON), { DB: tripwire, REPORTS_DB: tripwire, REPORT_RETENTION_CRON: CRON }, d);
  assert.deepEqual(d.sourceCalls, [SOURCE_CRON]);
  assert.deepEqual(d.logs.map((line) => JSON.parse(line)), [{ event: "reportRetention", outcome: "disabled" }]);
});

test("retention dispatch is isolated from canonical DB, R2 source checks and scheduler time", async () => {
  const d = deps();
  await dispatchScheduled({ ...controller(CRON), scheduledTime: 0 }, { DB: tripwire, REPORTS_DB: reportsD1(), REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: CRON }, d);
  assert.deepEqual(d.sourceCalls, []);
  const result = JSON.parse(d.logs[0]);
  assert.equal(result.outcome, "complete");
  assert.equal(result.batches, 1);
  assert.deepEqual(Object.keys(result).sort(), ["batches", "event", "mode", "outcome", "remaining"]);
  await dispatchScheduled(controller(SOURCE_CRON), { DB: tripwire, REPORT_RETENTION: "monitor", REPORT_RETENTION_CRON: CRON }, d);
  assert.deepEqual(d.sourceCalls, [SOURCE_CRON]);
});

test("the v1 retention cron runs retention; off, unexpected or unmapped events never reach source checks, R2 or DB", async () => {
  assert.equal(V1_RETENTION_CRON, V1_PRODUCTION.retentionCron);
  const bucket = new Proxy({}, { get() { assert.fail("R2 must remain untouched"); } });
  const base = { DB: tripwire, RAW_ARTIFACTS: bucket as R2Bucket };
  const ok = deps();
  await dispatchScheduled(controller(V1_RETENTION_CRON), { ...base, REPORTS_DB: reportsD1(), REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: V1_RETENTION_CRON }, ok);
  assert.equal(JSON.parse(ok.logs[0]).outcome, "complete");
  assert.deepEqual(ok.sourceCalls, []);
  const off = deps();
  await dispatchScheduled(controller(V1_RETENTION_CRON), { ...base, REPORTS_DB: tripwire, REPORT_RETENTION: "off", REPORT_RETENTION_CRON: V1_RETENTION_CRON }, off);
  assert.deepEqual(off.logs.map((l) => JSON.parse(l)), [{ event: "reportRetention", outcome: "disabled" }]);
  assert.deepEqual(off.sourceCalls, []);
  for (const [cron, env] of [
    ["7 * * * *", { REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: V1_RETENTION_CRON }], // unexpected schedule
    [V1_RETENTION_CRON, {}],                                                                   // old config: no mapping at all
    [V1_RETENTION_CRON, { REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: "2-57/10 * * * *" }], // mapping mismatch
    [PHOTO_RETENTION_CRON, { REPORT_RETENTION: "off", REPORT_RETENTION_CRON: V1_RETENTION_CRON }],
  ] as const) {
    const d = deps();
    await assert.rejects(dispatchScheduled(controller(cron), { ...base, REPORTS_DB: tripwire, ...env }, d), /matches no configured handler/);
    assert.deepEqual(d.sourceCalls, [], cron);
    assert.deepEqual(d.logs.map((l) => JSON.parse(l)), [{ event: "scheduled", outcome: "failed", reason: "unexpectedCron" }]);
  }
});

test("invalid maintenance configuration and absent store fail without exposing values", async () => {
  for (const env of [
    { REPORT_RETENTION: "secret-private-report-body" },
    { REPORT_RETENTION: "cleanup" },
    { REPORT_RETENTION: "monitor", REPORT_RETENTION_CRON: "invalid" },
    { REPORT_RETENTION: "off", REPORT_RETENTION_CRON: "invalid" },
    { REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: CRON },
  ]) {
    const d = deps();
    await assert.rejects(dispatchScheduled(controller(CRON), { DB: tripwire, ...env }, d), /Report retention maintenance failed/);
    assert.deepEqual(d.sourceCalls, []);
    assert.equal(d.logs.length, 1);
    assert.equal(JSON.parse(d.logs[0]).outcome, "failed");
    assert.equal(d.logs[0].includes("secret-private-report-body"), false);
  }
});

test("overdue read-only monitoring fails the Cron and emits counts, never report details", async () => {
  const db = reportsD1();
  const old = new Date(NOW.getTime() - 91 * 86400_000);
  const accepted = await createReport(db, { schemaVersion: 1, type: "other", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: "private-report-body" }, { now: old, attestationStatus: "notProvided", submitterHash: "a".repeat(64) });
  const d = deps();
  await assert.rejects(dispatchScheduled(controller(CRON), { DB: tripwire, REPORTS_DB: db, REPORT_RETENTION: "monitor", REPORT_RETENTION_CRON: CRON }, d), /incomplete/);
  const result = JSON.parse(d.logs[0]);
  assert.equal(result.remaining.dueReports, 1);
  assert.equal(result.outcome, "overdue");
  assert.equal(result.batches, 0);
  assert.equal(d.logs[0].includes(accepted.reportId), false);
  assert.equal(d.logs[0].includes("private-report-body"), false);
  assert.equal((db.raw.prepare("SELECT note FROM reports").get() as { note: string }).note, "private-report-body");
  const clean = deps();
  await dispatchScheduled(controller(CRON), { DB: tripwire, REPORTS_DB: db, REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: CRON }, clean);
  assert.equal(JSON.parse(clean.logs[0]).outcome, "complete");
});

test("missing migration and database errors yield fixed failure metadata", async () => {
  for (const db of [new SqliteD1(), { prepare() { throw new Error("private-report-id-and-secret"); }, async batch() { throw new Error("private-report-id-and-secret"); } }]) {
    const d = deps();
    await assert.rejects(dispatchScheduled(controller(CRON), { DB: tripwire, REPORTS_DB: db, REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: CRON }, d), /incomplete/);
    assert.equal(d.logs[0].includes("private-report-id-and-secret"), false);
    assert.equal(JSON.parse(d.logs[0]).outcome, "failed");
    assert.equal(JSON.parse(d.logs[0]).remaining, null);
  }
});

test("retention CLI refuses remote/extra arguments before opening any database", () => {
  for (const args of [["--remote"], ["run", "--env", "production"], ["status", "private-report-id"]]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/report-retention.ts", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.deepEqual(JSON.parse(child.stdout), { event: "reportRetention", outcome: "failed", reason: "unavailable" });
    assert.equal(child.stderr, "");
  }
});
