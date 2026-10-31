// PoC — attachEvidencePhoto (src/reports/photos.ts) for a JPEG that the route already validated, instead of the
// decode/re-encode. Same REPORTS_DB statements, same order, same lifecycle (uploading → ready), same fence checks.
// A production change would not copy this: it would split attachEvidencePhoto into "prepare image" and "attach
// prepared image" so both paths share one body. Kept separate here so no shipped code path changes.
import { type Db, type DbStatement, isoSeconds, sha256Hex } from "../../db.ts";
import { PhotoAttachmentError, type PhotoAttachmentAccepted } from "../../reports/photos.ts";
import type { D1PhotoStore } from "./d1-photo-store.ts";

export interface ValidatedJpeg { bytes: Uint8Array; contentSha256: string; width: number; height: number }

interface PhotoRow { photo_id: string; storage_key: string; content_sha256: string; lifecycle: string; moderation_status: string }

export async function attachValidatedJpeg(db: Db, storage: D1PhotoStore,
  input: { reportId: string; submitterHash: string; idempotencyKey: string; acceptedTermsVersion: string; image: ValidatedJpeg },
  opts: { now: Date; photoTermsCovered: (version: string) => boolean; guards?: DbStatement[] }): Promise<PhotoAttachmentAccepted> {
  if (!opts.photoTermsCovered(input.acceptedTermsVersion)) throw new PhotoAttachmentError("photoConsentRequired", 403);
  const now = isoSeconds(opts.now), image = input.image;
  const report = await db.prepare("SELECT submitter_hash,accepted_terms_version,minimize_after,redacted_at FROM reports WHERE report_id=?")
    .bind(input.reportId).first<{ submitter_hash: string | null; accepted_terms_version: string | null; minimize_after: string; redacted_at: string | null }>();
  if (!report) throw new PhotoAttachmentError("reportNotFound", 404);
  if (report.submitter_hash !== input.submitterHash) throw new PhotoAttachmentError("photoUnauthorized", 403);
  if (report.redacted_at !== null || report.minimize_after <= now) throw new PhotoAttachmentError("reportExpired", 410);
  if (report.accepted_terms_version !== input.acceptedTermsVersion) throw new PhotoAttachmentError("photoConsentRequired", 403);
  const prior = await db.prepare("SELECT q.content_sha256,p.photo_id,p.storage_key,p.lifecycle,p.moderation_status FROM community_photo_requests q LEFT JOIN community_evidence_photos p ON p.photo_id=q.photo_id WHERE q.report_id=? AND q.idempotency_key=?")
    .bind(input.reportId, input.idempotencyKey).first<PhotoRow>();
  if (prior && prior.content_sha256 !== image.contentSha256) throw new PhotoAttachmentError("photoIdempotencyConflict", 409);
  if (prior && !prior.photo_id) throw new PhotoAttachmentError("photoExpired", 410);
  const same = prior ?? await db.prepare("SELECT * FROM community_evidence_photos WHERE report_id=? AND content_sha256=?")
    .bind(input.reportId, image.contentSha256).first<PhotoRow>();
  if (same?.lifecycle === "deleting") throw new PhotoAttachmentError("photoExpired", 410);
  const photoId = same?.photo_id ?? `ph_${await sha256Hex(`${input.reportId}\n${image.contentSha256}`)}`;
  let key = same?.storage_key ?? `private/evidence/${crypto.randomUUID()}.jpg`;
  const statements = [...(opts.guards ?? [])];
  if (!same) statements.push(db.prepare(`INSERT INTO community_evidence_photos(photo_id,report_id,storage_key,content_sha256,media_type,byte_length,width,height,lifecycle,created_at,upload_expires_at,delete_after) VALUES(?,?,?,?,'image/jpeg',?,?,?,'uploading',?,?,?) ON CONFLICT(report_id,content_sha256) DO NOTHING`)
    .bind(photoId, input.reportId, key, image.contentSha256, image.bytes.length, image.width, image.height, now, isoSeconds(new Date(opts.now.getTime() + 15 * 60_000)), report.minimize_after));
  statements.push(db.prepare("INSERT INTO community_photo_requests(report_id,idempotency_key,photo_id,content_sha256) VALUES(?,?,?,?) ON CONFLICT DO NOTHING").bind(input.reportId, input.idempotencyKey, photoId, image.contentSha256));
  try { await db.batch(statements); } catch (error) {
    if (String(error).includes("idempotency conflict")) throw new PhotoAttachmentError("photoIdempotencyConflict", 409);
    if (String(error).includes("attachment limit")) throw new PhotoAttachmentError("photoAttachmentLimit", 409);
    throw error;
  }
  const reserved = await db.prepare("SELECT storage_key,lifecycle FROM community_evidence_photos WHERE photo_id=?").bind(photoId).first<{ storage_key: string; lifecycle: string }>();
  if (!reserved || reserved.lifecycle === "deleting") throw new PhotoAttachmentError("photoExpired", 410);
  key = reserved.storage_key;
  if (reserved.lifecycle !== "ready") {
    await storage.put(key, image.bytes, { mediaType: "image/jpeg", contentSha256: image.contentSha256, byteLength: image.bytes.length, width: image.width, height: image.height });
    await db.prepare("UPDATE community_evidence_photos SET lifecycle='ready' WHERE photo_id=? AND lifecycle='uploading' AND delete_after>? AND EXISTS(SELECT 1 FROM reports WHERE report_id=? AND redacted_at IS NULL)")
      .bind(photoId, now, input.reportId).run();
    const row = await db.prepare("SELECT lifecycle FROM community_evidence_photos WHERE photo_id=?").bind(photoId).first<{ lifecycle: string }>();
    if (row?.lifecycle !== "ready") { await storage.delete(key); throw new PhotoAttachmentError("reportExpired", 410); }
  }
  if (!await storage.getMetadata(key)) throw new PhotoAttachmentError("photoExpired", 410);
  return { photoId, reportId: input.reportId, state: (same?.moderation_status ?? "pending") as PhotoAttachmentAccepted["state"] };
}
