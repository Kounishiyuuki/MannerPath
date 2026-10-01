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

import { type Db, isoSeconds } from "../db.ts";

export interface RetentionResult {
  redactedReports: number;
  purgedRateWindows: number;
  purgedAttestChallenges: number;
  /** True when nothing due was left behind by this call. */
  complete: boolean;
}

/** Rows per kind per call. Small enough for one D1 batch; the platform's own limits are not hard-coded here. */
export const RETENTION_BATCH_SIZE = 200;

export async function applyReportRetention(db: Db, opts: { now: Date; batchSize?: number }): Promise<RetentionResult> {
  const now = isoSeconds(opts.now);
  const limit = opts.batchSize ?? RETENTION_BATCH_SIZE;
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`retention: batchSize must be a positive integer, got ${limit}`);

  const due = await db.prepare(
    "SELECT report_id FROM reports WHERE redacted_at IS NULL AND minimize_after <= ? ORDER BY minimize_after, report_id LIMIT ?",
  ).bind(now, limit).all<{ report_id: string }>();
  const windows = await db.prepare("SELECT rowid AS id FROM report_rate_windows WHERE expires_at <= ? LIMIT ?")
    .bind(now, limit).all<{ id: number }>();
  // App Attest challenges are not personal content, but an expired one is useless, consumed or not (ADR-0007 §6).
  // Registered keys are kept: they are what verifies the next assertion.
  const challenges = await db.prepare("SELECT challenge FROM app_attest_challenges WHERE expires_at <= ? LIMIT ?")
    .bind(now, limit).all<{ challenge: string }>();

  // One statement per row, so the immutability trigger checks each redaction individually, and each re-states its
  // condition, so a concurrent or repeated pass changes nothing twice.
  const statements = [
    ...due.results.map((row) => db.prepare(
      `UPDATE reports
          SET note = NULL, proposed_latitude = NULL, proposed_longitude = NULL,
              observed_on = NULL, submitter_hash = NULL, claim_host_name = NULL, claim_hours_note = NULL, redacted_at = ?
        WHERE report_id = ? AND redacted_at IS NULL AND minimize_after <= ?`,
    ).bind(now, row.report_id, now)),
    ...windows.results.map((w) => db.prepare("DELETE FROM report_rate_windows WHERE rowid = ? AND expires_at <= ?").bind(w.id, now)),
    ...challenges.results.map((c) => db.prepare("DELETE FROM app_attest_challenges WHERE challenge = ? AND expires_at <= ?").bind(c.challenge, now)),
  ];
  if (statements.length > 0) await db.batch(statements);
  return {
    redactedReports: due.results.length,
    purgedRateWindows: windows.results.length,
    purgedAttestChallenges: challenges.results.length,
    complete: due.results.length < limit && windows.results.length < limit && challenges.results.length < limit,
  };
}

/** Runs bounded passes until nothing due is left (or `maxBatches` is reached), and sums them. */
export async function runReportRetention(db: Db, opts: { now: Date; batchSize?: number; maxBatches?: number }): Promise<RetentionResult & { batches: number }> {
  const total = { redactedReports: 0, purgedRateWindows: 0, purgedAttestChallenges: 0, complete: false, batches: 0 };
  const max = opts.maxBatches ?? Number.POSITIVE_INFINITY;
  while (!total.complete && total.batches < max) {
    const pass = await applyReportRetention(db, opts);
    total.redactedReports += pass.redactedReports;
    total.purgedRateWindows += pass.purgedRateWindows;
    total.purgedAttestChallenges += pass.purgedAttestChallenges;
    total.complete = pass.complete;
    total.batches++;
  }
  return total;
}
