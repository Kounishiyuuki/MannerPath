import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { retentionHealth } from "../scripts/report-retention-health.ts";
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
    assert.deepEqual(JSON.parse(child.stdout), { event: "reportRetentionHealth", status: "invalid" });
  }
});
