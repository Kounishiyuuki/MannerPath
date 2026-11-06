// Free-tier capacity of the scheduled 90-day minimization (docs/release/V1_RETENTION_CAPACITY.md). LOCAL ONLY: an
// isolated, throw-away local D1 (miniflare, the same SQLite engine D1 runs) under a fresh temporary directory, filled
// with SYNTHETIC reports only. No remote binding, no network, no wrangler deploy; the directory is deleted at the end.
//
//   npm run reports:retention-capacity -- [--history <n>[,<n>...]] [--per-day <n>] [--due <n>]
//
// For each history size (reports minimized long ago, whose receipts the store keeps forever), plus steady intake of
// `--per-day` reports a day over the last 97 days (90 live, 7 minimized this week), plus `--due` reports past their
// 90 days and not minimized yet, it runs the exact scheduled pass (runRetentionMaintenance, cleanup, no photo storage) until it is
// complete, then once more, and prints per run: D1 rows read and written (D1's own meta), statements and round trips,
// and the JS CPU of the pass in this process. Then it projects the daily D1 reads at one run every five minutes.
// The JS CPU here is Node's, not workerd's, and excludes D1's own time: it bounds the order of magnitude only.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import type { Db, DbStatement } from "../src/db.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { receiptStatement } from "../src/reports/idempotency.ts";
import { runReportRetention } from "../src/reports/retention.ts";
import { retentionStatus, runRetentionMaintenance } from "../src/reports/retention-automation.ts";

/** D1 Free: rows read per day (developers.cloudflare.com/d1/platform/limits, read 2026-11-06). */
export const D1_FREE_ROWS_READ_PER_DAY = 5_000_000;
export const RUNS_PER_DAY = 288;

export interface Meter { statements: number; roundTrips: number; rowsRead: number; rowsWritten: number }

/** Wraps a D1 binding so every statement's own meta is summed; first() goes through all() to see its meta. */
export function metered(d1: any, m: Meter): Db {
  const add = (meta: any) => { m.rowsRead += meta?.rows_read ?? 0; m.rowsWritten += meta?.rows_written ?? 0; };
  const wrap = (stmt: any): DbStatement & { inner: any } => ({
    inner: stmt,
    bind: (...v: unknown[]) => wrap(stmt.bind(...v)),
    async first<T>() { m.statements++; m.roundTrips++; const r = await stmt.all(); add(r.meta); return (r.results[0] ?? null) as T; },
    async all<T>() { m.statements++; m.roundTrips++; const r = await stmt.all(); add(r.meta); return r as { results: T[] }; },
    async run() { m.statements++; m.roundTrips++; const r = await stmt.run(); add(r.meta); return r; },
  }) as any;
  return {
    prepare: (sql: string) => wrap(d1.prepare(sql)),
    async batch(statements: DbStatement[]) {
      m.statements += statements.length; m.roundTrips++;
      const results = await d1.batch(statements.map((s: any) => s.inner));
      for (const r of results) add(r.meta);
      return results;
    },
  } as Db;
}

const received = new Date("2026-01-01T00:00:00Z");
const now = minimizeAfter(received);
/** History is older than any receipt window: received half a year before the due reports. */
const historyReceived = new Date("2025-07-01T00:00:00Z");
const id = (prefix: string, i: number) => `${prefix}${String(i).padStart(26, "0")}`;

async function seed(db: Db, from: number, count: number, at: Date) {
  for (let i = from; i < from + count; i++) {
    await createReport(db, {
      schemaVersion: 3, type: "exists", spotId: `sp_${"0".repeat(26)}`, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f",
      idempotencyKey: "a".repeat(64), note: "synthetic retention capacity note", observedOn: "2026-01-01",
    }, {
      now: at, attestationStatus: "verified", submitterHash: "b".repeat(64), newReportId: () => id("rp_", i),
      after: (reportId, at) => [receiptStatement(db, i.toString(16).padStart(64, "0"), reportId, "c".repeat(64), at)],
    });
  }
}

async function measure(apiDir: string, history: number, perDay: number, due: number) {
  const dir = mkdtempSync(join(tmpdir(), "mannerpath-retention-capacity-"));
  try {
    const config = join(dir, "wrangler.jsonc");
    writeFileSync(config, JSON.stringify({
      name: "retention-capacity-local", main: `${apiDir}/src/index.ts`, compatibility_date: "2025-01-01",
      d1_databases: [{ binding: "REPORTS_DB", database_name: "retention-capacity-local", database_id: "00000000-0000-4000-8000-000000000000",
        migrations_dir: `${apiDir}/migrations-reports` }],
    }));
    execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "REPORTS_DB", "--local", "--persist-to", dir, "-c", config],
      { cwd: apiDir, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, CI: "1" } });
    const proxy = await getPlatformProxy<{ REPORTS_DB: any }>({ configPath: config, persist: { path: join(dir, "v3") }, remoteBindings: false, envFiles: [] });
    try {
      const raw = proxy.env.REPORTS_DB;
      const plain = metered(raw, { statements: 0, roundTrips: 0, rowsRead: 0, rowsWritten: 0 });
      await seed(plain, 0, history, historyReceived);
      let next = history;
      for (let day = 1; day <= 97; day++, next += perDay) await seed(plain, next, perDay, new Date(now.getTime() - day * 86_400_000));
      // History and the week past its 90 days: minimized, receipts retired (what every report becomes).
      await runReportRetention(plain, { now, batchSize: 200 });
      await seed(plain, next, due, new Date(received.getTime() - 3_600_000));
      const runs: Array<Meter & { outcome: string; dueAfter: number; cpuMs: number }> = [];
      for (let i = 0; i < Math.ceil(due / 10) + 1; i++) {
        const m: Meter = { statements: 0, roundTrips: 0, rowsRead: 0, rowsWritten: 0 };
        const cpu = process.cpuUsage();
        const r = await runRetentionMaintenance(metered(raw, m), { now, mode: "cleanup" });
        const used = process.cpuUsage(cpu);
        runs.push({ ...m, outcome: r.outcome, dueAfter: r.remaining?.dueReports ?? -1, cpuMs: (used.user + used.system) / 1000 });
      }
      const status = await retentionStatus(plain, now);
      const idle = runs.at(-1)!;
      return {
        history, perDay, due, runs, finalStatus: status,
        idleRowsReadPerRun: idle.rowsRead, projectedIdleRowsReadPerDay: idle.rowsRead * RUNS_PER_DAY,
        shareOfFreeDailyReads: Number(((idle.rowsRead * RUNS_PER_DAY) / D1_FREE_ROWS_READ_PER_DAY).toFixed(4)),
      };
    } finally { await proxy.dispose(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function main(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--history", "--per-day", "--due"].includes(argv[i]) || argv[i + 1] === undefined || flags.has(argv[i])) throw new Error(`invalid argument ${argv[i]}`);
    flags.set(argv[i], argv[i + 1]);
  }
  const histories = (flags.get("--history") ?? "0,1000,3000").split(",").map(Number);
  const due = Number(flags.get("--due") ?? "23");
  const perDay = Number(flags.get("--per-day") ?? "10");
  if (![...histories, due, perDay].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 20_000)) throw new Error("sizes must be integers 0..20000");
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  for (const h of histories) console.log(JSON.stringify(await measure(apiDir, h, perDay, due)));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => { console.error(`retention capacity failed: ${e instanceof Error ? e.message.split("\n")[0] : "error"}`); process.exitCode = 1; });
}
