// Retention pass (ADR-0007 §4). Minimization does not wait for moderation: an unreviewed backlog
// must not become a way to keep personal content indefinitely. What survives is the non-personal
// skeleton -- id, type, subject, attestation verdict, timestamps -- so counts stay honest.

import { type Db, isoSeconds } from "../db.ts";

export interface RetentionResult {
  redactedReports: number;
  purgedRateWindows: number;
}

export async function applyReportRetention(db: Db, opts: { now: Date }): Promise<RetentionResult> {
  const now = isoSeconds(opts.now);

  const due = await db.prepare(
    "SELECT report_id FROM reports WHERE redacted_at IS NULL AND minimize_after <= ?",
  ).bind(now).all<{ report_id: string }>();

  const expired = await db.prepare(
    "SELECT count(*) AS n FROM report_rate_windows WHERE expires_at <= ?",
  ).bind(now).first<{ n: number }>();

  // One statement per report, so the immutability trigger checks each redaction individually.
  const statements = due.results.map((row) => db.prepare(
    `UPDATE reports
        SET note = NULL, proposed_latitude = NULL, proposed_longitude = NULL,
            observed_on = NULL, submitter_hash = NULL, redacted_at = ?
      WHERE report_id = ? AND redacted_at IS NULL`,
  ).bind(now, row.report_id));
  statements.push(db.prepare("DELETE FROM report_rate_windows WHERE expires_at <= ?").bind(now));

  await db.batch(statements);
  return { redactedReports: due.results.length, purgedRateWindows: expired?.n ?? 0 };
}
