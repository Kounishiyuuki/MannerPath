// Moderation queue and decisions (ADR-0007 §2, §8). There is no authenticated admin HTTP surface
// in this slice; these functions run against local D1 (see services/api/README.md).
//
// Nothing here writes spots, spot_field_provenance or any published table. Accepting a report
// records a judgement; queuing it for reconciliation is a second, explicit step, and even then the
// claim still has to re-enter the ordinary ingest -> resolve -> publish path (ADR-0006).

import { type Db, isoSeconds } from "../db.ts";

export type ModerationState = "pending" | "accepted" | "rejected" | "duplicate" | "needsInfo";
export type ReconciliationState = "notQueued" | "queued" | "applied" | "discarded";

/**
 * Why a report was decided, from a bounded non-personal vocabulary. Moderation metadata carries no
 * free text: it would be an unbounded channel for reporter content that outlives the report's own
 * 90-day minimization deadline (ADR-0007 §4).
 */
export const DECISION_REASONS = [
  "confirmed", "contradictedBySource", "insufficientDetail",
  "duplicateOfExistingReport", "outOfScope", "abuse", "unspecified",
] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];

/**
 * The reconciliation transitions that exist today. `applied` is absent on purpose: this slice has
 * no reconciliation implementation, so nothing here may claim that a report was applied. The
 * database enforces the same table (migration 0003).
 */
export const RECONCILIATION_TRANSITIONS: Readonly<Record<ReconciliationState, readonly ReconciliationState[]>> = {
  notQueued: ["queued", "discarded"],
  queued: ["discarded"],
  applied: [],
  discarded: [],
};
export type ExposedReconciliationState = "queued" | "discarded";

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
  decision: { state: Exclude<ModerationState, "pending">; decidedBy: string; reason?: DecisionReason; now: Date },
): Promise<void> {
  const at = isoSeconds(decision.now);
  await db.prepare(
    `UPDATE report_moderation
        SET state = ?, decided_at = ?, decided_by = ?, decision_reason = ?, updated_at = ?
      WHERE report_id = ?`,
  ).bind(decision.state, at, decision.decidedBy, decision.reason ?? "unspecified", at, reportId).run();
}

/**
 * Moves an accepted report through the reconciliation states that exist today: queueing it for
 * review or discarding it. `applied` cannot be reached from here, because nothing applies reports
 * yet. The database rejects the same moves, plus any transition from a report that is not accepted.
 */
export async function setReconciliationState(
  db: Db,
  reportId: string,
  state: ExposedReconciliationState,
  now: Date,
): Promise<void> {
  const current = await db.prepare(
    "SELECT reconciliation_state FROM report_moderation WHERE report_id = ?",
  ).bind(reportId).first<{ reconciliation_state: ReconciliationState }>();
  if (current === null) throw new Error(`no such report: ${reportId}`);
  const allowed = RECONCILIATION_TRANSITIONS[current.reconciliation_state];
  if (!allowed.includes(state)) {
    throw new Error(
      `illegal reconciliation transition ${current.reconciliation_state} -> ${state} (allowed: ${allowed.join(", ") || "none"})`,
    );
  }
  await db.prepare(
    "UPDATE report_moderation SET reconciliation_state = ?, updated_at = ? WHERE report_id = ?",
  ).bind(state, isoSeconds(now), reportId).run();
}
