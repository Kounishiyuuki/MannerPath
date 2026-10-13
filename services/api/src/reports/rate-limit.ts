// Per-submitter abuse boundary (ADR-0007 §5). Counters live in D1 because this architecture has no
// KV or Durable Object binding (ADR-0003). A report's debit commits in the report's own batch, and the
// migration-0004 trigger refuses any increment past a limit, so concurrent reports cannot overshoot; and
// an edge rate-limit rule keyed on IP is a deployment-level pre-launch requirement, not something
// application code should implement by storing IPs.

import { type Db, type DbStatement, isoSeconds } from "../db.ts";

export interface RateLimit {
  kind: "hour" | "day";
  windowSeconds: number;
  max: number;
}

export const REPORT_RATE_LIMITS: readonly RateLimit[] = [
  { kind: "hour", windowSeconds: 3600, max: 10 },
  { kind: "day", windowSeconds: 86_400, max: 50 },
];

/** Windows are aligned to the epoch, so a window start is derivable and needs no extra state. */
function windowStart(now: Date, windowSeconds: number): Date {
  const seconds = Math.floor(now.getTime() / 1000);
  return new Date((seconds - (seconds % windowSeconds)) * 1000);
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** The message of the migration-0004 trigger that aborts a debit beyond a window's limit. */
export const BUDGET_EXHAUSTED_MESSAGE = "report_rate_windows: report budget exhausted";

export function isBudgetExhausted(e: unknown): boolean {
  return e instanceof Error && e.message.includes(BUDGET_EXHAUSTED_MESSAGE);
}

function budgetWindows(now: Date) {
  return REPORT_RATE_LIMITS.map((limit) => {
    const start = windowStart(now, limit.windowSeconds);
    return { limit, start: isoSeconds(start), end: new Date(start.getTime() + limit.windowSeconds * 1000) };
  });
}

/**
 * A fast, read-only refusal for a submitter already at a limit. It is advisory: the limit itself is enforced by the
 * trigger on report_rate_windows when reportBudgetDebits commits, so a concurrent request cannot overshoot it.
 */
export async function checkReportBudget(db: Db, submitterHash: string, now: Date): Promise<RateDecision> {
  for (const w of budgetWindows(now)) {
    const row = await db.prepare(
      "SELECT report_count FROM report_rate_windows WHERE submitter_hash = ? AND window_kind = ? AND window_start = ?",
    ).bind(submitterHash, w.limit.kind, w.start).first<{ report_count: number }>();
    if (row !== null && row.report_count >= w.limit.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.end.getTime() - now.getTime()) / 1000)) };
    }
  }
  return { allowed: true };
}

/** Seconds until the shortest window that could have refused a debit at `now` resets. */
export function budgetRetryAfterSeconds(now: Date): number {
  return Math.max(1, Math.ceil((budgetWindows(now)[0].end.getTime() - now.getTime()) / 1000));
}

/**
 * The debit of one report against every window, as statements to batch with the report itself: they commit with it
 * or not at all. Counters outlive their window by 24h so the retention pass can purge them on its own schedule.
 */
export function reportBudgetDebits(db: Db, submitterHash: string, now: Date): DbStatement[] {
  return budgetWindows(now).map((w) => db.prepare(
    `INSERT INTO report_rate_windows (submitter_hash, window_kind, window_start, report_count, expires_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (submitter_hash, window_kind, window_start)
     DO UPDATE SET report_count = report_count + 1`,
  ).bind(submitterHash, w.limit.kind, w.start, isoSeconds(new Date(w.end.getTime() + 86_400_000))));
}

/**
 * Counts one report against every window on its own, or refuses it. On refusal nothing is written, so a rejected
 * request cannot extend its own lockout. Report submission debits inside the report batch instead
 * (reportBudgetDebits); this standalone form remains for callers that debit without a report.
 */
export async function consumeReportBudget(db: Db, submitterHash: string, now: Date): Promise<RateDecision> {
  const decision = await checkReportBudget(db, submitterHash, now);
  if (!decision.allowed) return decision;
  try {
    await db.batch(reportBudgetDebits(db, submitterHash, now));
  } catch (e) {
    if (isBudgetExhausted(e)) return { allowed: false, retryAfterSeconds: budgetRetryAfterSeconds(now) };
    throw e;
  }
  return { allowed: true };
}
