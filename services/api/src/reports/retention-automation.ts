import { type Db, isoSeconds } from "../db.ts";
import { REPORT_MINIMIZE_AFTER_DAYS } from "./create.ts";
import { REPORT_STORE_SCHEMA } from "./evidence-artifact.ts";
import { applyReportRetention } from "./retention.ts";
import { PHOTO_ERASURE_LEAD_MS, type EvidencePhotoStorage } from "./photo-storage.ts";
import { PhotoCleanupError } from "./photos.ts";

export interface RetentionStatus {
  dueReports: number;
  expiredRateWindows: number;
  expiredChallenges: number;
  inconsistentReceipts: number;
  pendingPhotoCleanup: number;
}

export interface RetentionMaintenanceResult {
  event: "reportRetention";
  mode: "cleanup" | "monitor";
  outcome: "complete" | "overdue" | "failed";
  batches: number;
  remaining: RetentionStatus | null;
}

/**
 * Which receipts the check reads. `full` reads every receipt; receipts are never deleted, so its D1 reads grow with
 * every report ever stored, and at one run per five minutes it alone passes the D1 Free daily read limit at about
 * 3,000 stored reports (docs/release/V1_RETENTION_CAPACITY.md). `pass` reads only what a cleanup pass can touch, by
 * index range: reports due but not yet minimized (reports_minimize_due), and reports minimized whose 90 days ended
 * within the last PASS_RECEIPT_DAYS (reports_received_page, both bounds), so its reads follow the backlog and a week of intake,
 * not history. Receipts outside it cannot be broken by a pass: a minimized report never changes again
 * (reports_only_redaction_updates) and a receipt changes only by its one retirement, never deleted (0004 triggers).
 * Drift outside it (a restore from an old copy) needs the `full` check, which `monitor` runs.
 */
export type ReceiptScope = "full" | "pass";
export const PASS_RECEIPT_DAYS = 7;

const BROKEN = `((r.redacted_at IS NOT NULL AND (i.request_sha256 IS NOT NULL OR i.retired_at IS NULL))
         OR (r.redacted_at IS NULL AND (i.retired_at IS NOT NULL OR i.request_sha256 IS NULL)))`;

function receiptCheck(scope: ReceiptScope): string {
  if (scope === "full") return `(SELECT count(*) FROM report_idempotency i JOIN reports r ON r.report_id = i.report_id WHERE ${BROKEN})`;
  return `((SELECT count(*) FROM reports r JOIN report_idempotency i ON i.report_id = r.report_id
      WHERE r.redacted_at IS NULL AND r.minimize_after <= ? AND (i.retired_at IS NOT NULL OR i.request_sha256 IS NULL))
    + (SELECT count(*) FROM reports r JOIN report_idempotency i ON i.report_id = r.report_id
      WHERE r.received_at >= ? AND r.received_at <= ? AND r.redacted_at IS NOT NULL
        AND (i.request_sha256 IS NOT NULL OR i.retired_at IS NULL)))`;
}

/** Aggregate counts only: no report, receipt, device or object identifiers leave this boundary. */
export async function retentionStatus(db: Db, now: Date, scope: ReceiptScope = "full"): Promise<RetentionStatus> {
  const timestamp = isoSeconds(now);
  // minimize_after is received_at + REPORT_MINIMIZE_AFTER_DAYS, so these received_at bounds are "due within the last week".
  const dueEdge = now.getTime() - REPORT_MINIMIZE_AFTER_DAYS * 86_400_000;
  const passReceipts = [timestamp, isoSeconds(new Date(dueEdge - PASS_RECEIPT_DAYS * 86_400_000)), isoSeconds(new Date(dueEdge))];
  const status = await db.prepare(`SELECT
    (SELECT count(*) FROM reports WHERE redacted_at IS NULL AND minimize_after <= ?) AS dueReports,
    (SELECT count(*) FROM report_rate_windows WHERE expires_at <= ?) AS expiredRateWindows,
    (SELECT count(*) FROM app_attest_challenges WHERE expires_at <= ?) AS expiredChallenges,
    ${receiptCheck(scope)} AS inconsistentReceipts,
    (SELECT count(*) FROM (
      SELECT storage_key FROM community_evidence_photos
        WHERE delete_after <= ? OR lifecycle = 'deleting' OR (lifecycle = 'uploading' AND upload_expires_at <= ?)
      UNION SELECT storage_key FROM community_photo_deletions
    )) AS pendingPhotoCleanup`)
    .bind(timestamp, timestamp, timestamp, ...(scope === "pass" ? passReceipts : []), isoSeconds(new Date(now.getTime()+PHOTO_ERASURE_LEAD_MS)), timestamp).first<RetentionStatus>();
  if (!status || [status.dueReports, status.expiredRateWindows, status.expiredChallenges, status.inconsistentReceipts, status.pendingPhotoCleanup].some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Report retention status unavailable");
  }
  return {
    dueReports: status.dueReports,
    expiredRateWindows: status.expiredRateWindows,
    expiredChallenges: status.expiredChallenges,
    inconsistentReceipts: status.inconsistentReceipts,
    pendingPhotoCleanup: status.pendingPhotoCleanup,
  };
}

/** v1 remains the store identity; querying status also requires receipt and photo migrations. */
export async function validateReportRetentionStore(db: Db, now = new Date(0), scope: ReceiptScope = "full"): Promise<void> {
  const identity = await db.prepare(`SELECT
    (SELECT value FROM report_store_meta WHERE key = 'store') AS store,
    (SELECT value FROM report_store_meta WHERE key = 'schema') AS schema`)
    .first<{ store: string; schema: string }>();
  if (identity?.store !== "mannerpath-reports" || identity.schema !== REPORT_STORE_SCHEMA) {
    throw new Error("Report retention store unavailable");
  }
  await retentionStatus(db, now, scope);
}

/** Reserve subrequest budget for D1 cleanup plus R2 fences when photo storage is configured. */
export async function runRetentionMaintenance(
  db: Db,
  opts: { now: Date; mode: "cleanup" | "monitor"; photoStorage?: EvidencePhotoStorage },
): Promise<RetentionMaintenanceResult> {
  let batches = 0;
  try {
    // The scheduled cleanup runs every five minutes, so it checks receipts in the bounded `pass` scope; monitor
    // (an operator's on-demand look) keeps the full check.
    const scope: ReceiptScope = opts.mode === "cleanup" ? "pass" : "full";
    await validateReportRetentionStore(db, opts.now, scope);
    const before = await retentionStatus(db, opts.now, scope);
    if (before.inconsistentReceipts > 0) {
      return { event: "reportRetention", mode: opts.mode, outcome: "failed", batches, remaining: before };
    }
    if (opts.mode === "monitor") {
      return {
        event: "reportRetention", mode: opts.mode,
        outcome: Object.values(before).some((count) => count > 0) ? "overdue" : "complete",
        batches, remaining: before,
      };
    }
    // Absent storage never acknowledges photo cleanup; report minimization can still progress.
    let deletionFailed = false;
    try { await applyReportRetention(db, { now: opts.now, limit: opts.photoStorage ? 5 : 10, photoStorage: opts.photoStorage }); }
    catch (error) { if (!(error instanceof PhotoCleanupError)) throw error; deletionFailed = true; }
    batches = 1;
    const remaining = await retentionStatus(db, opts.now, scope);
    return {
      event: "reportRetention", mode: opts.mode,
      outcome: deletionFailed || remaining.inconsistentReceipts > 0 || remaining.pendingPhotoCleanup > 0
        ? "failed" : Object.values(remaining).some((count) => count > 0) ? "overdue" : "complete",
      batches, remaining,
    };
  } catch {
    // Fixed failure metadata only; database errors can contain private data or query bindings.
    return { event: "reportRetention", mode: opts.mode, outcome: "failed", batches, remaining: null };
  }
}
