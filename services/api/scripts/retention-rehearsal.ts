// LOCAL ONLY: disposable local D1, synthetic reports, no target/config/env/remote options.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../src/db.ts";

export function checkArguments(args: string[]): void {
  if (args.length) throw new Error("No arguments allowed: disposable local rehearsal only");
}

let phase = "arguments";
async function main(args: string[]) {
  checkArguments(args); // before loading Wrangler/runtime, directory creation, migrations or any DB connection
  const [{ getPlatformProxy }, { createReport, minimizeAfter }, { receiptStatement }, { retentionStatus },
    { dispatchScheduled, V1_RETENTION_CRON }] = await Promise.all([
    import("wrangler"), import("../src/reports/create.ts"), import("../src/reports/idempotency.ts"),
    import("../src/reports/retention-automation.ts"), import("../src/scheduled.ts"),
  ]);
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const dir = mkdtempSync(join(tmpdir(), "mannerpath-retention-rehearsal-"));
  const config = join(dir, "wrangler.jsonc");
  const received = new Date("2026-01-01T00:00:00Z"), due = minimizeAfter(received);
  let canonicalAccesses = 0, sourceCalls = 0;
  const forbidden = () => { canonicalAccesses++; throw new Error("Canonical/R2 access forbidden"); };
  const canonical: Db = { prepare: forbidden, batch: forbidden };
  const bucket = new Proxy({}, { get: forbidden }) as R2Bucket;
  const logs: any[] = [];
  const controller = { cron: V1_RETENTION_CRON, scheduledTime: due.getTime(), noRetry() {} } as ScheduledController;
  const dispatch = async (db: Db, at = due, mode = "cleanup") => {
    const start = logs.length;
    try {
      await dispatchScheduled(controller, { DB: canonical, RAW_ARTIFACTS: bucket, REPORTS_DB: db,
        REPORT_RETENTION: mode, REPORT_RETENTION_CRON: V1_RETENTION_CRON }, {
        now: () => at, log: line => { logs.push(JSON.parse(line)); },
        source: async () => { sourceCalls++; throw new Error("Source dispatch forbidden"); },
      });
    } catch (error) {
      // The dispatcher deliberately throws for failed/overdue; unexpected errors must fail the rehearsal.
      assert.equal((error as Error).message, "Report retention maintenance incomplete");
    }
    assert.equal(logs.length, start + 1);
    return logs.at(-1);
  };
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ REPORTS_DB: any }>>> | undefined;
  const open = () => getPlatformProxy<{ REPORTS_DB: any }>({ configPath: config,
    persist: { path: join(dir, "v3") }, remoteBindings: false, envFiles: [] });
  try {
    writeFileSync(config, JSON.stringify({ name: "retention-rehearsal-local", main: `${apiDir}/src/index.ts`,
      compatibility_date: "2025-01-01", d1_databases: [{ binding: "REPORTS_DB", database_name: "retention-rehearsal-local",
        database_id: "00000000-0000-4000-8000-000000000000", migrations_dir: `${apiDir}/migrations-reports` }] }));
    phase = "migrations";
    execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "REPORTS_DB", "--local", "--persist-to", dir, "-c", config],
      { cwd: apiDir, stdio: ["ignore", "ignore", "pipe"], timeout: 120_000, env: { ...process.env, CI: "1" } });
    phase = "open";
    proxy = await open();
    phase = "seed";
    let raw = proxy.env.REPORTS_DB;
    for (let i = 0; i < 23; i++) await createReport(raw, { schemaVersion: 3, type: "exists", spotId: `sp_${"0".repeat(26)}`,
      installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", idempotencyKey: "a".repeat(64), note: "synthetic-private-note" }, {
      now: received, attestationStatus: "verified", submitterHash: "b".repeat(64), newReportId: () => `rp_${String(i).padStart(26, "0")}`,
      after: (id, at) => [receiptStatement(raw, i.toString(16).padStart(64, "0"), id, "c".repeat(64), at)],
    });
    phase = "before-deadline";
    assert.equal((await dispatch(raw, new Date(due.getTime() - 1000))).outcome, "complete");
    const count = async (sql: string) => Number((await raw.prepare(sql).first()).n);
    assert.equal(await count("SELECT count(*) n FROM reports WHERE note IS NOT NULL"), 23);
    phase = "failure-rollback";
    await raw.prepare("CREATE TRIGGER rehearsal_failure BEFORE UPDATE ON report_idempotency BEGIN SELECT RAISE(ABORT, 'synthetic-private-note'); END").run();
    assert.equal((await dispatch(raw)).outcome, "failed");
    assert.equal(await count("SELECT count(*) n FROM reports WHERE redacted_at IS NULL AND note IS NOT NULL"), 23);
    assert.equal(await count("SELECT count(*) n FROM report_idempotency WHERE retired_at IS NULL AND request_sha256 IS NOT NULL"), 23);
    await raw.prepare("DROP TRIGGER rehearsal_failure").run();
    phase = "overlap";
    const stopped: Db = { prepare() { throw new Error("Stopped retention touched DB"); }, async batch() { throw new Error("Stopped retention wrote DB"); } };
    let selected!: () => void;
    const firstSelected = new Promise<void>(resolve => { selected = resolve; });
    let arrivals = 0, release!: () => void, rejectBarrier!: (error: Error) => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const both = new Promise<void>((resolve, reject) => { release = resolve; rejectBarrier = reject; });
    const overlapping: Db = { prepare: sql => raw.prepare(sql), async batch(statements) {
      if (++arrivals === 1) selected();
      if (arrivals === 2) { clearTimeout(timer); release(); }
      else timer = setTimeout(() => rejectBarrier(new Error("Overlap rendezvous timed out")), 15_000);
      await both;
      return raw.batch(statements);
    } };
    // Both invocations select the same first batch before either commits; D1 handles the actual atomic batches.
    // They share the log sink, so check their aggregate output rather than per-call sink length.
    const invoke = () => dispatchScheduled(controller, { DB: canonical, RAW_ARTIFACTS: bucket, REPORTS_DB: overlapping,
      REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: V1_RETENTION_CRON }, {
      now: () => due, log: line => { logs.push(JSON.parse(line)); }, source: async () => { sourceCalls++; throw new Error(); },
    });
    const first = invoke();
    await Promise.race([firstSelected, first.then(() => { throw new Error("No batch selected"); })]);
    // Switching future invocations off does not cancel a batch already selected by an older invocation.
    assert.equal((await dispatch(stopped, due, "off")).outcome, "disabled");
    const overlap = await Promise.allSettled([first, invoke()]);
    clearTimeout(timer);
    assert.equal(arrivals, 2);
    for (const r of overlap) { assert.equal(r.status, "rejected"); if (r.status === "rejected") assert.equal(r.reason.message, "Report retention maintenance incomplete"); }
    assert.ok(logs.slice(-2).every(r => r.outcome === "overdue" && r.remaining.dueReports === 13));
    assert.equal(await count("SELECT count(*) n FROM report_idempotency WHERE retired_at IS NOT NULL AND request_sha256 IS NULL"), 10);
    // Restart the local D1 proxy with the persisted data, then resume at the next scheduled times.
    phase = "restart";
    await proxy.dispose(); proxy = undefined;
    proxy = await open(); raw = proxy.env.REPORTS_DB;
    for (const [minutes, remaining] of [[5, 3], [10, 0]] as const) {
      const r = await dispatch(raw, new Date(due.getTime() + minutes * 60_000));
      assert.equal(r.remaining.dueReports, remaining);
      assert.equal(r.outcome, remaining ? "overdue" : "complete");
    }
    phase = "final-checks";
    assert.equal((await dispatch(raw)).outcome, "complete");
    assert.deepEqual(await retentionStatus(raw, due, "full"), { dueReports: 0, expiredRateWindows: 0,
      expiredChallenges: 0, inconsistentReceipts: 0, pendingPhotoCleanup: 0 });
    assert.equal(await count("SELECT count(*) n FROM reports WHERE redacted_at IS NOT NULL AND note IS NULL AND submitter_hash IS NULL"), 23);
    assert.equal(await count("SELECT count(*) n FROM report_moderation WHERE state='pending' AND reconciliation_state='notQueued'"), 23);
    assert.equal((await dispatch(stopped, due, "off")).outcome, "disabled");
    assert.equal(canonicalAccesses, 0); assert.equal(sourceCalls, 0);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-private-note|rp_|submitter|cursor/);
    console.log(JSON.stringify({ event: "retentionRehearsal", outcome: "pass", localOnly: true, reports: 23,
      failureRollback: true, overlappingSelections: true, restartAndRetry: true, stoppedWithoutDbAccess: true, stopDuringRun: true,
      moderationUnchanged: true, canonicalAccesses, sourceCalls, productionVerified: false, workersCpuMeasured: false }));
  } finally { try { await proxy?.dispose(); } finally { rmSync(dir, { recursive: true, force: true }); } }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch(() => { console.error(`retention rehearsal failed (local only): ${phase}`); process.exit(1); });
}
