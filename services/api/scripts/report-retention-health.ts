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

function main(args: string[]) {
  let output: ReturnType<typeof retentionHealth> = { event: "reportRetentionHealth", status: "invalid" };
  try {
    if (args.length !== 1 || args[0].startsWith("-") || statSync(args[0]).size > 4 * 1024 * 1024) throw new Error();
    const events = readFileSync(args[0], "utf8").split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
    output = retentionHealth(events, Date.now());
  } catch { /* fixed failure metadata only */ }
  console.log(JSON.stringify(output));
  if (output.status !== "healthy") process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
