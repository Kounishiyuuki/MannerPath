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
 * The reconciliation transitions this module can make. `applied` is absent on purpose: it is reached
 * only by applyCommunityApplication (src/pipeline/community-reconciliation.ts), in the same batch that
 * writes the evidence, and the database refuses it for a report without an applied application
 * (migrations 0003, 0020).
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
  /** The terms version the submitter consented to; null for a report without consent (never a publication basis). */
  accepted_terms_version: string | null;
  /** ADR-0012 new-spot claims, for the moderator to check against the pin. Null when not stated. */
  claim_spot_type: string | null;
  claim_spot_subtype: string | null;
  claim_access_type: string | null;
  claim_access_detail: string | null;
  claim_host_type: string | null;
  claim_environment: string | null;
  claim_supports_paper: string | null;
  claim_supports_heated: string | null;
  claim_host_name: string | null;
  claim_hours_note: string | null;
  /** ADR-0013 existing-spot finding of an `other` report (notFound, removed, wrongType); null otherwise. */
  finding: string | null;
}

export async function listModerationQueue(
  db: Db,
  opts: { state?: ModerationState; limit?: number } = {},
): Promise<ModerationQueueRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const sql =
    `SELECT r.report_id, r.report_type, r.subject_spot_id, r.proposed_latitude, r.proposed_longitude,
            r.observed_on, r.note, r.attestation_status, r.received_at, r.redacted_at,
            m.state, m.reconciliation_state, r.accepted_terms_version,
            r.claim_spot_type, r.claim_spot_subtype, r.claim_access_type, r.claim_access_detail, r.claim_host_type,
            r.claim_environment, r.claim_supports_paper, r.claim_supports_heated, r.claim_host_name, r.claim_hours_note,
            r.finding
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

export interface PipelineSummary {
  /** Report counts by moderation state and reconciliation state, e.g. {"accepted/queued": 3}. */
  reports: Record<string, number>;
  newSpotApplications: Record<string, number>;
  effectApplications: Record<string, number>;
  activeCommunityHolds: number;
  absenceApplications: Record<string, number>;
  activeAbsenceHolds: number;
}

/**
 * The whole moderation pipeline at a glance: pending -> accepted -> queued -> application -> applied. Counts only,
 * so it is safe to paste into a ticket or a log (no note, pin, date or submitter key).
 */
export async function moderationPipelineSummary(db: Db): Promise<PipelineSummary> {
  const tally = async (sql: string) => Object.fromEntries(
    (await db.prepare(sql).all<{ k: string; n: number }>()).results.map((r) => [r.k, r.n]),
  );
  const holds = await db.prepare("SELECT count(*) AS n FROM community_publication_holds WHERE lifted_at IS NULL").first<{ n: number }>();
  return {
    reports: await tally(`SELECT m.state || '/' || m.reconciliation_state AS k, count(*) AS n FROM report_moderation m GROUP BY k ORDER BY k`),
    newSpotApplications: await tally("SELECT state AS k, count(*) AS n FROM community_reconciliation_applications GROUP BY k ORDER BY k"),
    effectApplications: await tally("SELECT effect || '/' || state AS k, count(*) AS n FROM community_effect_applications GROUP BY k ORDER BY k"),
    activeCommunityHolds: holds?.n ?? 0,
    absenceApplications: await tally("SELECT state AS k, count(*) AS n FROM community_absence_applications GROUP BY k ORDER BY k"),
    activeAbsenceHolds: (await db.prepare("SELECT count(*) AS n FROM community_absence_holds WHERE lifted_at IS NULL").first<{ n: number }>())?.n ?? 0,
  };
}

/**
 * Moves an accepted report through the reconciliation states a moderator sets: queueing it for
 * review or discarding it. `applied` cannot be reached from here; only the reconciliation apply
 * reaches it. The database rejects the same moves, plus any transition from a report that is not accepted.
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
