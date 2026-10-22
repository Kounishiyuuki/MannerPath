// TEST ONLY: gives a queued `missing` report what the v1.0 new-spot photo gate requires — one ready, moderator-approved
// evidence photo — through the real REPORTS_DB lifecycle (reservation -> ready -> approved) and moderateEvidencePhoto.
// No image bytes or storage are involved; tests of the upload path itself use attachEvidencePhoto (evidence-photos.test.ts).
import { type Db, isoSeconds } from "../../src/db.ts";
import { moderateEvidencePhoto } from "../../src/reports/photos.ts";

let sequence = 0;

/** Adds an approved photo to `reportId` when it is a `missing` report; other report types never need one. */
export async function approveEvidencePhoto(db: Db, reportId: string, at: Date, status: "approved" | "pending" | "rejected" = "approved"): Promise<string | null> {
  const report = await db.prepare("SELECT report_type, minimize_after FROM reports WHERE report_id = ?")
    .bind(reportId).first<{ report_type: string; minimize_after: string }>();
  if (report?.report_type !== "missing") return null;
  const photoId = `ph_test_${++sequence}`;
  const created = isoSeconds(at);
  await db.prepare(`INSERT INTO community_evidence_photos (photo_id, report_id, storage_key, content_sha256, media_type, byte_length,
      width, height, lifecycle, created_at, upload_expires_at, delete_after)
    VALUES (?, ?, ?, ?, 'image/png', 1, 1, 1, 'uploading', ?, ?, ?)`)
    .bind(photoId, reportId, `test/${photoId}`, sequence.toString(16).padStart(64, "0"), created,
      isoSeconds(new Date(at.getTime() + 15 * 60_000)), report.minimize_after).run();
  await db.prepare("UPDATE community_evidence_photos SET lifecycle = 'ready' WHERE photo_id = ?").bind(photoId).run();
  if (status !== "pending") {
    await moderateEvidencePhoto(db, photoId, status, { now: at, decidedBy: "photo-reviewer", reason: status === "approved" ? "usableEvidence" : "privacyRisk" });
  }
  return photoId;
}
