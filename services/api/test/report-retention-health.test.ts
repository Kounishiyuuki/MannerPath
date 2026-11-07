import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { OVERDUE_STOP_MS, retentionAction, retentionHealth } from "../scripts/report-retention-health.ts";
import { V1_PRODUCTION } from "../scripts/production-v1-plan.ts";
const now = Date.parse("2026-11-05T12:00:00Z");
function event(outcome = "complete", at = now) {
  return { eventTimestamp: at, outcome: "ok", event: { cron: String(V1_PRODUCTION.retentionCron) }, logs: [{ message: [JSON.stringify({
    event: "reportRetention", mode: "cleanup", outcome, batches: 1,
    remaining: { dueReports: 0, expiredRateWindows: 0, expiredChallenges: 0, inconsistentReceipts: 0, pendingPhotoCleanup: 0 },
  })] }] };
}
const status = (events: unknown[]) => retentionHealth(events, now).status;
test("requires a recent cleanup heartbeat; missing/stale never counts as success", () => {
  assert.equal(status([]), "missing");
  assert.equal(status([event()]), "healthy");
  assert.equal(status([event("complete", now - 15 * 60_000)]), "healthy");
  assert.equal(status([event("complete", now - 15 * 60_000 - 1)]), "stale");
  const other = event(); other.event.cron = "0 18 * * *";
  assert.equal(status([other]), "missing");
  assert.equal(status([event("complete", now + 1)]), "invalid");
});
test("latest failures and simultaneous conflicting records cannot hide behind successes", () => {
  for (const failure of ["failed", "overdue", "disabled"]) {
    assert.equal(status([event("complete", now - 1), event(failure)]), failure);
    assert.equal(status([event(), event(failure)]), failure);
    assert.equal(status([event(failure), event()]), failure);
  }
  const crash = event(); crash.outcome = "exception";
  assert.equal(status([crash]), "failed");
});
test("rejects malformed/false zero-backlog claims without echoing private logs", () => {
  for (const mutate of [
    (r: any) => { r.remaining.dueReports = 1; },
    (r: any) => { r.remaining.dueReports = -1; },
    (r: any) => { r.remaining.dueReports = "private-note"; },
    (r: any) => { r.mode = "monitor"; },
    (r: any) => { r.remaining.reportId = "rp_private"; },
    (r: any) => { delete r.remaining.expiredChallenges; },
  ]) {
    const e = event(), r = JSON.parse(e.logs[0].message[0]); mutate(r);
    e.logs[0].message[0] = JSON.stringify(r);
    const result = retentionHealth([e], now);
    assert.notEqual(result.status, "healthy");
    assert.doesNotMatch(JSON.stringify(result), /private|rp_|2026|remaining|reportId/);
  }
  const noLog = event(); noLog.logs = [];
  assert.equal(status([noLog]), "invalid");
});
test("offline CLI refuses remote/extra flags and unreadable input with fixed metadata", () => {
  for (const args of [["--remote"], ["--env", "production"], ["/not-a-real-file/private-note"]]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/report-retention-health.ts", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), { event: "reportRetentionHealth", status: "invalid", action: "investigate", reason: "invalid" });
  }
  for (const args of [["--covered-since", "2026-11-05", "x.jsonl"], ["--covered-since", "2026-11-05T00:00:00Z"], ["x.jsonl", "--covered-since", "2026-11-05T00:00:00Z"]]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/report-retention-health.ts", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(child.status, 1);
    assert.deepEqual(JSON.parse(child.stdout), { event: "reportRetentionHealth", status: "invalid", action: "investigate", reason: "invalid" });
  }
});

const FIVE = 5 * 60_000;
function run(outcome: string, at: number, due = outcome === "overdue" ? 3 : 0) {
  const e = event(outcome, at); const r = JSON.parse(e.logs[0].message[0]); r.remaining.dueReports = due;
  e.logs[0].message[0] = JSON.stringify(r); if (outcome !== "complete") e.outcome = "exception"; return e;
}
const act = (events: unknown[]) => { const a = retentionAction(events, now); return `${a.action}:${a.reason}`; };
test("stop criteria: overdue is progress, not failure; two real failures or one 1102 stop intake", () => {
  assert.equal(act([run("complete", now - FIVE), run("complete", now)]), "none:healthy");
  // A backlog draining over consecutive overdue runs never stops intake by itself.
  assert.equal(act([run("complete", now - FIVE), run("overdue", now)]), "watch:overdue");
  assert.equal(act([run("overdue", now - FIVE, 13), run("overdue", now, 3)]), "investigate:overdueDraining");
  assert.equal(act([run("overdue", now - FIVE, 13), run("overdue", now, 13)]), "investigate:overdueNotDraining");
  const day = Array.from({ length: 288 }, (_, i) => run("overdue", now - (287 - i) * FIVE));
  assert.equal(act(day), "investigate:overdueNotDraining", "just under a day");
  assert.equal(act([run("overdue", now - OVERDUE_STOP_MS), ...day]), "stopIntake:overdueOverOneDay");
  assert.equal(act([run("overdue", now - OVERDUE_STOP_MS), run("failed", now - FIVE), run("overdue", now)]), "stopIntake:overdueOverOneDay");
  assert.equal(act([run("overdue", now - OVERDUE_STOP_MS), run("complete", now - FIVE), run("overdue", now)]), "watch:overdue", "a complete run resets the clock");
  // Real failures.
  assert.equal(act([run("complete", now - FIVE), run("failed", now)]), "investigate:failed");
  assert.equal(act([run("failed", now - FIVE), run("failed", now)]), "stopIntake:consecutiveFailures");
  assert.equal(act([run("overdue", now - FIVE), run("failed", now)]), "investigate:failed", "overdue is not a failure");
  const crash = run("complete", now); crash.logs = []; crash.outcome = "exception";
  assert.equal(act([run("failed", now - FIVE), crash]), "stopIntake:consecutiveFailures", "a throw without a record is a failure");
  const cpu = run("complete", now - 6 * FIVE); cpu.outcome = "exceededCpu"; cpu.logs = [];
  assert.equal(act([cpu, run("complete", now - FIVE), run("complete", now)]), "stopIntake:exceededCpu");
  // Regression (#398 review): two real failures in a row anywhere in the window, even if later runs are healthy.
  assert.equal(act([run("failed", now - 2 * FIVE), run("failed", now - FIVE), run("complete", now)]), "stopIntake:consecutiveFailures");
  assert.equal(act([run("failed", now - 3 * FIVE), run("overdue", now - 2 * FIVE), run("failed", now - FIVE), run("complete", now)]), "investigate:failed", "overdue breaks a failure streak; the failures stay visible");
  // Regression: a future-dated or malformed record never leaves the history healthy.
  assert.equal(act([run("complete", now - FIVE), run("complete", now + FIVE)]), "investigate:invalid");
  assert.equal(act([run("complete", now), { ...run("complete", now), eventTimestamp: "yesterday" }]), "investigate:invalid");
  assert.equal(act([run("failed", now + 2 * FIVE), run("failed", now - FIVE), run("failed", now)]), "stopIntake:consecutiveFailures", "stops still win");
  // CPU: half or more of the last hour's runs over 10 ms asks for investigation only.
  const cpuRun = (at: number, ms: number) => Object.assign(run("complete", at), { cpuTime: ms });
  assert.equal(act([cpuRun(now - 3 * FIVE, 12), cpuRun(now - 2 * FIVE, 14), cpuRun(now - FIVE, 6), cpuRun(now, 5)]), "investigate:cpuOver10ms");
  assert.equal(act([cpuRun(now - 3 * FIVE, 12), cpuRun(now - 2 * FIVE, 6), cpuRun(now - FIVE, 6), cpuRun(now, 5)]), "none:healthy");
  assert.equal(act([cpuRun(now - 13 * FIVE, 30), cpuRun(now - FIVE, 6), cpuRun(now, 5)]), "none:healthy", "older than an hour");
  // Not running, paused.
  assert.equal(act([]), "investigate:notRunning");
  assert.equal(act([run("complete", now - 4 * FIVE)]), "investigate:notRunning");
  // A day without runs stops intake only with confirmed continuous capture over that day.
  assert.equal(act([run("complete", now - OVERDUE_STOP_MS)]), "investigate:unconfirmedCoverage", "an old export may be truncated");
  const covered = (events: unknown[], since: number) => { const a = retentionAction(events, now, since); return `${a.action}:${a.reason}`; };
  assert.equal(covered([], now - OVERDUE_STOP_MS), "stopIntake:notRunning");
  assert.equal(covered([run("complete", now - OVERDUE_STOP_MS - FIVE)], now - 2 * OVERDUE_STOP_MS), "stopIntake:notRunning");
  assert.equal(covered([], now - OVERDUE_STOP_MS + FIVE), "investigate:unconfirmedCoverage", "capture shorter than a day");
  assert.equal(covered([run("complete", now)], now - OVERDUE_STOP_MS), "none:healthy");
  assert.equal(covered([run("complete", now)], now + 1), "investigate:invalid");
  assert.equal(act([run("disabled", now)]), "investigate:disabled");
  assert.equal(act([run("complete", now - FIVE)].concat([{ ...run("complete", now), event: { cron: "0 18 * * *" } }])), "none:healthy");
});
