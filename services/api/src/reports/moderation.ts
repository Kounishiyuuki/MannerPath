// Moderation queue and decisions (ADR-0007 §2, §8). There is no authenticated admin HTTP surface
// in this slice; these functions run against local D1 (see services/api/README.md).
//
// Nothing here writes spots, spot_field_provenance or any published table. Accepting a report
// records a judgement; queuing it for reconciliation is a second, explicit step, and even then the
// claim still has to re-enter the ordinary ingest -> resolve -> publish path (ADR-0006).

import { type Db, isoSeconds } from "../db.ts";

export type ModerationState = "pending" | "accepted" | "rejected" | "duplicate" | "needsInfo";
export type ReconciliationState = "notQueued" | "queued" | "applied" | "discarded";

/** A moderator judges the claim, not the submitter, so submitter_hash is never selected here. */
export interface ModerationQueueRow {
  report_id: string;
  report_type: string;
  subject_spot_id: string | null;
  proposed_latitude: number | null;
  proposed_longitude: number | null;
  observed_on: string | null;
  note: string | null;
  attestation_status: string;
  received_at: string;
  redacted_at: string | null;
  state: string;
  reconciliation_state: string;
}

export async function listModerationQueue(
  db: Db,
  opts: { state?: ModerationState; limit?: number } = {},
): Promise<ModerationQueueRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const sql =
    `SELECT r.report_id, r.report_type, r.subject_spot_id, r.proposed_latitude, r.proposed_longitude,
            r.observed_on, r.note, r.attestation_status, r.received_at, r.redacted_at,
            m.state, m.reconciliation_state
       FROM reports r
       JOIN report_moderation m ON m.report_id = r.report_id
      WHERE (? IS NULL OR m.state = ?)
      ORDER BY r.received_at, r.report_id
      LIMIT ?`;
  const rows = await db.prepare(sql).bind(opts.state ?? null, opts.state ?? null, limit).all<ModerationQueueRow>();
  return rows.results;
}

export async function recordModerationDecision(
  db: Db,
  reportId: string,
  decision: { state: Exclude<ModerationState, "pending">; decidedBy: string; note?: string; now: Date },
): Promise<void> {
  const at = isoSeconds(decision.now);
  await db.prepare(
    `UPDATE report_moderation
        SET state = ?, decided_at = ?, decided_by = ?, decision_note = ?, updated_at = ?
      WHERE report_id = ?`,
  ).bind(decision.state, at, decision.decidedBy, decision.note ?? null, at, reportId).run();
}

/**
 * Marks an accepted report as picked up by reconciliation. The database rejects this for any
 * report that is not accepted; it still does not make the report canonical evidence.
 */
export async function setReconciliationState(
  db: Db,
  reportId: string,
  state: ReconciliationState,
  now: Date,
): Promise<void> {
  await db.prepare(
    "UPDATE report_moderation SET reconciliation_state = ?, updated_at = ? WHERE report_id = ?",
  ).bind(state, isoSeconds(now), reportId).run();
}
