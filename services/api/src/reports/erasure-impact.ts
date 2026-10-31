// ADR-0021 §10: a read-only view of what references one report today, so the erase decisions (§7) and the later
// early-minimization path (§12) are judged against real rows. Counts and states only: no note, pin, date, hash,
// storage key, review ID or other report ID is returned. Nothing here writes.
import type { Db } from "../db.ts";

const REPORT_ID = /^rp_[0-9A-HJKMNP-TV-Z]{26}$/;

type Counts = Record<string, number>;

export interface ErasureImpact {
  reportId: string;
  report: { redacted: boolean; attestationStatus: string; minimizeDue: boolean };
  moderation: { state: string; reconciliationState: string } | null;
  photos: { lifecycle: Counts; moderation: Counts; queuedDeletions: number };
  photoRequests: number;
  receipt: "active" | "retired" | "none";
  reviewEvidence: { kind: string; state: string } | null;
  locationOfReviews: Counts;
  baseOfReviews: number;
  bulkRejectionTargets: number;
  adminReviewAudit: number;
  // Why a plain DELETE of the report row is refused today (foreign keys without CASCADE).
  deleteBlockedBy: string[];
}

async function count(db: Db, sql: string, ...binds: unknown[]): Promise<number> {
  return Number((await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0);
}

async function grouped(db: Db, sql: string, reportId: string): Promise<Counts> {
  const rows = (await db.prepare(sql).bind(reportId).all<{ k: string; n: number }>()).results;
  return Object.fromEntries(rows.map((row) => [row.k, Number(row.n)]));
}

/** Returns null when no report has this ID. Throws on a malformed ID so nothing arbitrary reaches a LIKE pattern. */
export async function erasureImpact(db: Db, reportId: string, now: Date): Promise<ErasureImpact | null> {
  if (!REPORT_ID.test(reportId)) throw new Error("erasureImpact: malformed report ID");
  const report = await db.prepare("SELECT redacted_at, attestation_status, minimize_after FROM reports WHERE report_id = ?")
    .bind(reportId).first<{ redacted_at: string | null; attestation_status: string; minimize_after: string }>();
  if (!report) return null;
  const moderation = await db.prepare("SELECT state, reconciliation_state FROM report_moderation WHERE report_id = ?")
    .bind(reportId).first<{ state: string; reconciliation_state: string }>();
  const receipt = await db.prepare("SELECT retired_at FROM report_idempotency WHERE report_id = ?")
    .bind(reportId).first<{ retired_at: string | null }>();
  const evidence = await db.prepare(`SELECT v.review_kind AS kind, v.state AS state FROM report_review_evidence e
      JOIN report_reviews v ON v.review_id = e.review_id WHERE e.report_id = ?`)
    .bind(reportId).first<{ kind: string; state: string }>();
  const deleteBlockedBy: string[] = [];
  if (receipt) deleteBlockedBy.push("receipt");
  if (evidence) deleteBlockedBy.push("reviewEvidence");
  return {
    reportId,
    report: {
      redacted: report.redacted_at !== null,
      attestationStatus: report.attestation_status,
      minimizeDue: Date.parse(report.minimize_after) <= now.getTime(),
    },
    moderation: moderation ? { state: moderation.state, reconciliationState: moderation.reconciliation_state } : null,
    photos: {
      lifecycle: await grouped(db, "SELECT lifecycle AS k, count(*) AS n FROM community_evidence_photos WHERE report_id = ? GROUP BY lifecycle", reportId),
      moderation: await grouped(db, "SELECT moderation_status AS k, count(*) AS n FROM community_evidence_photos WHERE report_id = ? GROUP BY moderation_status", reportId),
      queuedDeletions: await count(db, `SELECT count(*) AS n FROM community_photo_deletions d
          JOIN community_evidence_photos p ON p.storage_key = d.storage_key WHERE p.report_id = ?`, reportId),
    },
    photoRequests: await count(db, "SELECT count(*) AS n FROM community_photo_requests WHERE report_id = ?", reportId),
    receipt: !receipt ? "none" : receipt.retired_at === null ? "active" : "retired",
    reviewEvidence: evidence ? { kind: evidence.kind, state: evidence.state } : null,
    locationOfReviews: await grouped(db, "SELECT state AS k, count(*) AS n FROM report_reviews WHERE location_report_id = ? GROUP BY state", reportId),
    // base_report_ids is space-separated; the ID format was checked above, so it is safe inside the pattern.
    baseOfReviews: await count(db, "SELECT count(*) AS n FROM report_reviews WHERE ' ' || base_report_ids || ' ' LIKE ?", `% ${reportId} %`),
    bulkRejectionTargets: await count(db, "SELECT count(*) AS n FROM report_bulk_rejection_targets WHERE report_id = ?", reportId),
    adminReviewAudit: await count(db, "SELECT count(*) AS n FROM admin_review_audit WHERE report_id = ?", reportId),
    deleteBlockedBy,
  };
}
