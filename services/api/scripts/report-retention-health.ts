// OFFLINE ONLY: inspect an authorized Cloudflare tail JSONL export. No fetch, DB or wrangler invocation.
// Only fixed states and aggregate counts leave this boundary, never raw log lines or exceptions.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { V1_PRODUCTION } from "./production-v1-plan.ts";

const counts = ["dueReports", "expiredRateWindows", "expiredChallenges", "inconsistentReceipts", "pendingPhotoCleanup"] as const;
type State = "healthy" | "missing" | "stale" | "failed" | "overdue" | "disabled" | "invalid";
export function retentionHealth(events: unknown[], now: number): { event: "reportRetentionHealth"; status: State } {
  const result = (status: State) => ({ event: "reportRetentionHealth" as const, status });
  if (!Number.isSafeInteger(now) || now < 0) return result("invalid");
  const matching = events.filter((e: any) => e?.event?.cron === V1_PRODUCTION.retentionCron) as any[];
  if (matching.length === 0) return result("missing");
  if (matching.some(e => !Number.isSafeInteger(e.eventTimestamp) || e.eventTimestamp < 0 || e.eventTimestamp > now)) return result("invalid");
  // Ties cannot let a successful record mask a failed invocation with the same timestamp.
  const latestTime = Math.max(...matching.map(e => e.eventTimestamp));
  if (now - latestTime > 15 * 60_000) return result("stale");
  const latest = matching.filter(e => e.eventTimestamp === latestTime);
  for (const e of latest) {
    if (!Array.isArray(e.logs)) return result("invalid");
    const records: any[] = [];
    for (const log of e.logs) for (const message of Array.isArray(log?.message) ? log.message : []) {
      if (typeof message !== "string") continue;
      try { const parsed = JSON.parse(message); if (parsed?.event === "reportRetention") records.push(parsed); } catch { /* unrelated logs stay private */ }
    }
    if (records.length !== 1) return result("invalid");
    const r = records[0];
    if (r.outcome === "disabled") return result("disabled");
    if (r.outcome === "failed") return result("failed");
    if (r.mode !== "cleanup" || !["complete", "overdue"].includes(r.outcome)
        || !Number.isSafeInteger(r.batches) || r.batches !== 1 || !r.remaining
        || Object.keys(r.remaining).sort().join() !== [...counts].sort().join()
        || counts.some(k => !Number.isSafeInteger(r.remaining[k]) || r.remaining[k] < 0)) return result("invalid");
    if (r.outcome === "overdue") return result("overdue");
    if (e.outcome !== "ok" || counts.some(k => r.remaining[k] !== 0)) return result("failed");
  }
  return result("healthy");
}

/**
 * The stop criteria of docs/release/V1_PRODUCTION_INTAKE.md §3, over the whole export (give it at least the last 24 hours).
 * `overdue` is normal progress while a backlog drains, so it never counts as a failure: two in a row ask for investigation,
 * and only a backlog left unresolved for a day stops intake. A real failure (failed outcome, an invocation that threw
 * without an overdue record, a malformed record) stops intake when two come in a row; one exceededCpu (1102) stops it at once.
 * No run for a day stops intake too; a shorter gap, or an export with no run at all, asks for investigation.
 * Stopping intake never stops the retention Cron.
 */
type Run = "cpu" | "failed" | "overdue" | "disabled" | "complete";
export type Action = "none" | "watch" | "investigate" | "stopIntake";
export type Reason = "healthy" | "overdue" | "consecutiveOverdue" | "overdueOverOneDay" | "failed" | "consecutiveFailures"
  | "exceededCpu" | "notRunning" | "disabled" | "invalid";
export const OVERDUE_STOP_MS = 24 * 3_600_000;
function classify(e: any): Run {
  if (e?.outcome === "exceededCpu") return "cpu";
  const records: any[] = [];
  for (const log of Array.isArray(e?.logs) ? e.logs : []) for (const message of Array.isArray(log?.message) ? log.message : []) {
    if (typeof message !== "string") continue;
    try { const parsed = JSON.parse(message); if (parsed?.event === "reportRetention") records.push(parsed); } catch { /* unrelated logs stay private */ }
  }
  if (records.length !== 1) return "failed";
  const r = records[0];
  if (r.outcome === "disabled") return "disabled";
  if (r.outcome === "overdue" && r.mode === "cleanup" && Number.isSafeInteger(r.remaining?.dueReports) && r.remaining.dueReports > 0) return "overdue";
  return retentionHealth([e], e.eventTimestamp).status === "healthy" ? "complete" : "failed";
}
export function retentionAction(events: unknown[], now: number): { event: "reportRetentionAction"; action: Action; reason: Reason } {
  const out = (action: Action, reason: Reason) => ({ event: "reportRetentionAction" as const, action, reason });
  if (!Number.isSafeInteger(now) || now < 0) return out("investigate", "invalid");
  const health = retentionHealth(events, now).status;
  const matching = (events.filter((e: any) => e?.event?.cron === V1_PRODUCTION.retentionCron) as any[])
    .filter((e) => Number.isSafeInteger(e.eventTimestamp) && e.eventTimestamp >= 0 && e.eventTimestamp <= now);
  // One invocation per scheduled time; of conflicting records the worst one counts.
  const rank: Run[] = ["cpu", "failed", "overdue", "disabled", "complete"];
  const byTime = new Map<number, Run>();
  for (const e of matching) {
    const run = classify(e), prev = byTime.get(e.eventTimestamp);
    if (!prev || rank.indexOf(run) < rank.indexOf(prev)) byTime.set(e.eventTimestamp, run);
  }
  const runs = [...byTime].sort((a, b) => a[0] - b[0]);
  if (runs.some(([, r]) => r === "cpu")) return out("stopIntake", "exceededCpu");
  // A Cron that stopped running leaves due reports unminimized as surely as an overdue backlog does.
  if (runs.length > 0 && now - runs.at(-1)![0] >= OVERDUE_STOP_MS) return out("stopIntake", "notRunning");
  if (runs.length === 0 || health === "missing" || health === "stale") return out("investigate", "notRunning");
  const latest = runs.at(-1)![1];
  if (latest === "failed" && runs.at(-2)?.[1] === "failed") return out("stopIntake", "consecutiveFailures");
  // The unresolved backlog: the trailing runs that did not complete, if any of them was overdue.
  let start = runs.length;
  while (start > 0 && (runs[start - 1][1] === "overdue" || runs[start - 1][1] === "failed")) start--;
  const tail = runs.slice(start);
  if (tail.some(([, r]) => r === "overdue") && now - tail[0][0] >= OVERDUE_STOP_MS) return out("stopIntake", "overdueOverOneDay");
  if (latest === "failed") return out("investigate", "failed");
  if (latest === "disabled") return out("investigate", "disabled");
  if (latest === "overdue") return runs.at(-2)?.[1] === "overdue" ? out("investigate", "consecutiveOverdue") : out("watch", "overdue");
  return out("none", "healthy");
}

function main(args: string[]) {
  let output: ReturnType<typeof retentionHealth> = { event: "reportRetentionHealth", status: "invalid" };
  let action: Pick<ReturnType<typeof retentionAction>, "action" | "reason"> = { action: "investigate", reason: "invalid" };
  try {
    if (args.length !== 1 || args[0].startsWith("-") || statSync(args[0]).size > 4 * 1024 * 1024) throw new Error();
    const events = readFileSync(args[0], "utf8").split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
    const now = Date.now();
    output = retentionHealth(events, now);
    const { action: a, reason } = retentionAction(events, now);
    action = { action: a, reason };
  } catch { /* fixed failure metadata only */ }
  console.log(JSON.stringify({ ...output, ...action }));
  if (output.status !== "healthy") process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
