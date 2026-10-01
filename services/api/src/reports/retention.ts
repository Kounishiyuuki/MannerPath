// Retention pass (ADR-0007 §4), run against the durable REPORTS_DB (ADR-0014). Minimization does not wait for
// moderation: an unreviewed backlog must not become a way to keep personal content indefinitely. What survives is the
// non-personal skeleton -- id, type, subject, attestation verdict, timestamps, and the categorical claims about a place
// (ADR-0012) -- so counts stay honest. The free-text claims (host name, hours note) are personal content and go with
// the note.
//
// The report store is long-lived and may hold many reports, so a pass is BOUNDED: at most `batchSize` rows of each
// kind per call, each call one atomic batch. It is idempotent (every statement re-checks its own condition, so a row
// already handled is never touched twice) and resumable (an interrupted run loses nothing; the next call continues
// where the last committed batch stopped). `complete` says whether anything due is left; runReportRetention loops.

import { decodeReportCursor, encodeReportCursor, pageLimit } from "./moderation.ts";
import { type Db, isoSeconds } from "../db.ts";

export interface RetentionResult {
  redactedReports: number;
  purgedRateWindows: number;
  purgedAttestChallenges: number;
  complete: boolean;
  nextCursor: string | null;
  /** Repeat until false; each pass commits at most three bounded batches. */
  hasMore: boolean;
}

export async function applyReportRetention(db: Db, opts: { now: Date; batchSize?: number; limit?: number; cursor?: string }): Promise<RetentionResult> {
  const now = isoSeconds(opts.now);
  const limit = pageLimit(opts.limit ?? opts.batchSize, 200, 200);
  const cursor = decodeReportCursor(opts.cursor);

  const due = await db.prepare(
    `SELECT report_id, minimize_after FROM reports WHERE redacted_at IS NULL AND minimize_after <= ?
       AND (minimize_after > ? OR (minimize_after = ? AND report_id > ?))
     ORDER BY minimize_after, report_id LIMIT ?`,
  ).bind(now, cursor?.receivedAt ?? "", cursor?.receivedAt ?? "", cursor?.reportId ?? "", limit + 1)
    .all<{ report_id: string; minimize_after: string }>();

  const expired = await db.prepare(
    "SELECT submitter_hash, window_kind, window_start FROM report_rate_windows WHERE expires_at <= ? ORDER BY expires_at, submitter_hash, window_kind, window_start LIMIT ?",
  ).bind(now, limit + 1).all<{ submitter_hash: string; window_kind: string; window_start: string }>();
  const expiredChallenges = await db.prepare(
    "SELECT challenge FROM app_attest_challenges WHERE expires_at <= ? ORDER BY expires_at, challenge LIMIT ?",
  ).bind(now, limit + 1).all<{ challenge: string }>();
  const rows = due.results.slice(0, limit);
  // One statement per report, so the immutability trigger checks each redaction individually.
  const statements = rows.map((row) => db.prepare(
    `UPDATE reports
        SET note = NULL, proposed_latitude = NULL, proposed_longitude = NULL,
            observed_on = NULL, submitter_hash = NULL, claim_host_name = NULL, claim_hours_note = NULL, redacted_at = ?
      WHERE report_id = ? AND redacted_at IS NULL`,
  ).bind(now, row.report_id));
  for (const row of expired.results.slice(0, limit)) statements.push(db.prepare(
    "DELETE FROM report_rate_windows WHERE submitter_hash = ? AND window_kind = ? AND window_start = ? AND expires_at <= ?",
  ).bind(row.submitter_hash, row.window_kind, row.window_start, now));
  for (const row of expiredChallenges.results.slice(0, limit)) statements.push(db.prepare(
    "DELETE FROM app_attest_challenges WHERE challenge = ? AND expires_at <= ?",
  ).bind(row.challenge, now));

  if (statements.length > 0) await db.batch(statements);
  return {
    complete: due.results.length <= limit && expired.results.length <= limit && expiredChallenges.results.length <= limit,
    redactedReports: rows.length,
    purgedRateWindows: Math.min(expired.results.length, limit),
    purgedAttestChallenges: Math.min(expiredChallenges.results.length, limit),
    nextCursor: due.results.length > limit && rows.length > 0
      ? encodeReportCursor({ receivedAt: rows.at(-1)!.minimize_after, reportId: rows.at(-1)!.report_id }) : null,
    hasMore: due.results.length > limit || expired.results.length > limit || expiredChallenges.results.length > limit,
  };
}

/** Runs bounded passes until nothing due is left (or `maxBatches` is reached), and sums them. */
export async function runReportRetention(db: Db, opts: { now: Date; batchSize?: number; maxBatches?: number }): Promise<RetentionResult & { batches: number }> {
  const total = { redactedReports: 0, purgedRateWindows: 0, purgedAttestChallenges: 0, complete: false, hasMore: true, nextCursor: null as string | null, batches: 0 };
  const max = opts.maxBatches ?? Number.POSITIVE_INFINITY;
  while (!total.complete && total.batches < max) {
    const pass = await applyReportRetention(db, opts);
    total.redactedReports += pass.redactedReports;
    total.purgedRateWindows += pass.purgedRateWindows;
    total.purgedAttestChallenges += pass.purgedAttestChallenges;
    total.complete = pass.complete;
    total.hasMore = pass.hasMore;
    total.nextCursor = pass.nextCursor;
    total.batches++;
  }
  return total;
}
