// Per-submitter abuse boundary (ADR-0007 §5). Counters live in D1 because this architecture has no
// KV or Durable Object binding (ADR-0003); they are therefore best-effort under concurrency, and
// an edge rate-limit rule keyed on IP is a deployment-level pre-launch requirement, not something
// application code should implement by storing IPs.

import { type Db, isoSeconds } from "../db.ts";

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

/**
 * Counts this report against every window, or refuses it. On refusal nothing is written, so a
 * rejected request cannot extend its own lockout.
 */
export async function consumeReportBudget(db: Db, submitterHash: string, now: Date): Promise<RateDecision> {
  const windows = REPORT_RATE_LIMITS.map((limit) => {
    const start = windowStart(now, limit.windowSeconds);
    const end = new Date(start.getTime() + limit.windowSeconds * 1000);
    return { limit, start: isoSeconds(start), end };
  });

  for (const w of windows) {
    const row = await db.prepare(
      "SELECT report_count FROM report_rate_windows WHERE submitter_hash = ? AND window_kind = ? AND window_start = ?",
    ).bind(submitterHash, w.limit.kind, w.start).first<{ report_count: number }>();
    if (row !== null && row.report_count >= w.limit.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.end.getTime() - now.getTime()) / 1000)) };
    }
  }

  // Counters outlive their window by 24h so the retention pass can purge them on its own schedule.
  await db.batch(windows.map((w) => db.prepare(
    `INSERT INTO report_rate_windows (submitter_hash, window_kind, window_start, report_count, expires_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (submitter_hash, window_kind, window_start)
     DO UPDATE SET report_count = report_count + 1`,
  ).bind(submitterHash, w.limit.kind, w.start, isoSeconds(new Date(w.end.getTime() + 86_400_000)))));

  return { allowed: true };
}
