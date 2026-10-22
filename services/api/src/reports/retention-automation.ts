import { type Db, isoSeconds } from "../db.ts";
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

/** Aggregate counts only: no report, receipt, device or object identifiers leave this boundary. */
export async function retentionStatus(db: Db, now: Date): Promise<RetentionStatus> {
  const timestamp = isoSeconds(now);
  const status = await db.prepare(`SELECT
    (SELECT count(*) FROM reports WHERE redacted_at IS NULL AND minimize_after <= ?) AS dueReports,
    (SELECT count(*) FROM report_rate_windows WHERE expires_at <= ?) AS expiredRateWindows,
    (SELECT count(*) FROM app_attest_challenges WHERE expires_at <= ?) AS expiredChallenges,
    (SELECT count(*) FROM report_idempotency i JOIN reports r ON r.report_id = i.report_id
      WHERE (r.redacted_at IS NOT NULL AND (i.request_sha256 IS NOT NULL OR i.retired_at IS NULL))
         OR (r.redacted_at IS NULL AND (i.retired_at IS NOT NULL OR i.request_sha256 IS NULL))) AS inconsistentReceipts,
    (SELECT count(*) FROM (
      SELECT storage_key FROM community_evidence_photos
        WHERE delete_after <= ? OR lifecycle = 'deleting' OR (lifecycle = 'uploading' AND upload_expires_at <= ?)
      UNION SELECT storage_key FROM community_photo_deletions
    )) AS pendingPhotoCleanup`)
    .bind(timestamp, timestamp, timestamp, isoSeconds(new Date(now.getTime()+PHOTO_ERASURE_LEAD_MS)), timestamp).first<RetentionStatus>();
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
export async function validateReportRetentionStore(db: Db): Promise<void> {
  const identity = await db.prepare(`SELECT
    (SELECT value FROM report_store_meta WHERE key = 'store') AS store,
    (SELECT value FROM report_store_meta WHERE key = 'schema') AS schema`)
    .first<{ store: string; schema: string }>();
  if (identity?.store !== "mannerpath-reports" || identity.schema !== REPORT_STORE_SCHEMA) {
    throw new Error("Report retention store unavailable");
  }
  await retentionStatus(db, new Date(0));
}

/** Reserve subrequest budget for D1 cleanup plus R2 fences when photo storage is configured. */
export async function runRetentionMaintenance(
  db: Db,
  opts: { now: Date; mode: "cleanup" | "monitor"; photoStorage?: EvidencePhotoStorage },
): Promise<RetentionMaintenanceResult> {
  let batches = 0;
  try {
    await validateReportRetentionStore(db);
    const before = await retentionStatus(db, opts.now);
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
    const remaining = await retentionStatus(db, opts.now);
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
