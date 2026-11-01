// PoC A1 — attachValidatedJpeg (../binary-photo/attach.ts) with fewer D1 round trips, for the KV store only. Same
// statements, same checks, same order of effects; reads that do not depend on each other share one batch, the
// reservation read-back joins the reservation batch, and the `ready` update, its read-back and the caller's
// `onReady` statements (the ticket consume) commit together. binary-photo/attach.ts stays as the production mirror.
import { type Db, type DbStatement, isoSeconds, sha256Hex } from "../../db.ts";
import { PhotoAttachmentError, type PhotoAttachmentAccepted } from "../../reports/photos.ts";
import type { ValidatedJpeg } from "../binary-photo/attach.ts";
import { D1_PHOTO_ERASURE_LEAD_DAYS } from "../binary-photo/erasure.ts";
import type { KvPhotoStore } from "./kv-photo-store.ts";

interface PhotoRow { photo_id: string; storage_key: string; content_sha256: string; lifecycle: string; moderation_status: string }
interface ReportRow { submitter_hash: string | null; accepted_terms_version: string | null; minimize_after: string; redacted_at: string | null }
const rows = <T>(out: unknown) => (out as { results: T[] }).results;

export async function attachKvJpeg(db: Db, storage: KvPhotoStore,
  input: { reportId: string; submitterHash: string; idempotencyKey: string; acceptedTermsVersion: string; image: ValidatedJpeg },
  opts: { now: Date; photoTermsCovered: (version: string) => boolean; onReady: (photoId: string) => DbStatement[] }): Promise<PhotoAttachmentAccepted> {
  if (!opts.photoTermsCovered(input.acceptedTermsVersion)) throw new PhotoAttachmentError("photoConsentRequired", 403);
  const now = isoSeconds(opts.now), image = input.image;
  const read = await db.batch([
    db.prepare("SELECT submitter_hash,accepted_terms_version,minimize_after,redacted_at FROM reports WHERE report_id=?").bind(input.reportId),
    db.prepare("SELECT q.content_sha256,p.photo_id,p.storage_key,p.lifecycle,p.moderation_status FROM community_photo_requests q LEFT JOIN community_evidence_photos p ON p.photo_id=q.photo_id WHERE q.report_id=? AND q.idempotency_key=?")
      .bind(input.reportId, input.idempotencyKey),
    db.prepare("SELECT * FROM community_evidence_photos WHERE report_id=? AND content_sha256=?").bind(input.reportId, image.contentSha256),
  ]);
  const report = rows<ReportRow>(read[0])[0];
  if (!report) throw new PhotoAttachmentError("reportNotFound", 404);
  if (report.submitter_hash !== input.submitterHash) throw new PhotoAttachmentError("photoUnauthorized", 403);
  if (report.redacted_at !== null || report.minimize_after <= now) throw new PhotoAttachmentError("reportExpired", 410);
  if (Date.parse(report.minimize_after) - D1_PHOTO_ERASURE_LEAD_DAYS * 86_400_000 <= opts.now.getTime()) throw new PhotoAttachmentError("reportExpired", 410);
  if (report.accepted_terms_version !== input.acceptedTermsVersion) throw new PhotoAttachmentError("photoConsentRequired", 403);
  const prior = rows<PhotoRow>(read[1])[0];
  if (prior && prior.content_sha256 !== image.contentSha256) throw new PhotoAttachmentError("photoIdempotencyConflict", 409);
  if (prior && !prior.photo_id) throw new PhotoAttachmentError("photoExpired", 410);
  const same = prior ?? rows<PhotoRow>(read[2])[0];
  if (same?.lifecycle === "deleting") throw new PhotoAttachmentError("photoExpired", 410);
  const photoId = same?.photo_id ?? `ph_${await sha256Hex(`${input.reportId}\n${image.contentSha256}`)}`;
  const statements: DbStatement[] = [];
  if (!same) statements.push(db.prepare(`INSERT INTO community_evidence_photos(photo_id,report_id,storage_key,content_sha256,media_type,byte_length,width,height,lifecycle,created_at,upload_expires_at,delete_after) VALUES(?,?,?,?,'image/jpeg',?,?,?,'uploading',?,?,?) ON CONFLICT(report_id,content_sha256) DO NOTHING`)
    .bind(photoId, input.reportId, `private/evidence/${crypto.randomUUID()}.jpg`, image.contentSha256, image.bytes.length, image.width, image.height, now, isoSeconds(new Date(opts.now.getTime() + 15 * 60_000)), report.minimize_after));
  statements.push(db.prepare("INSERT INTO community_photo_requests(report_id,idempotency_key,photo_id,content_sha256) VALUES(?,?,?,?) ON CONFLICT DO NOTHING").bind(input.reportId, input.idempotencyKey, photoId, image.contentSha256));
  statements.push(db.prepare("SELECT storage_key,lifecycle FROM community_evidence_photos WHERE photo_id=?").bind(photoId));
  let written: unknown[];
  try { written = await db.batch(statements); } catch (error) {
    if (String(error).includes("idempotency conflict")) throw new PhotoAttachmentError("photoIdempotencyConflict", 409);
    if (String(error).includes("attachment limit")) throw new PhotoAttachmentError("photoAttachmentLimit", 409);
    throw error;
  }
  const reserved = rows<{ storage_key: string; lifecycle: string }>(written[written.length - 1])[0];
  if (!reserved || reserved.lifecycle === "deleting") throw new PhotoAttachmentError("photoExpired", 410);
  const key = reserved.storage_key;
  if (reserved.lifecycle !== "ready") {
    await storage.put(key, image.bytes, { contentSha256: image.contentSha256, byteLength: image.bytes.length });
    const done = await db.batch([
      db.prepare("UPDATE community_evidence_photos SET lifecycle='ready' WHERE photo_id=? AND lifecycle='uploading' AND delete_after>? AND EXISTS(SELECT 1 FROM reports WHERE report_id=? AND redacted_at IS NULL)")
        .bind(photoId, now, input.reportId),
      db.prepare("SELECT lifecycle FROM community_evidence_photos WHERE photo_id=?").bind(photoId),
      ...opts.onReady(photoId),
    ]);
    if (rows<{ lifecycle: string }>(done[1])[0]?.lifecycle !== "ready") { await storage.delete(key); throw new PhotoAttachmentError("reportExpired", 410); }
  } else {
    await db.batch(opts.onReady(photoId));
  }
  if (!await storage.getMetadata(key)) throw new PhotoAttachmentError("photoExpired", 410);
  return { photoId, reportId: input.reportId, state: (same?.moderation_status ?? "pending") as PhotoAttachmentAccepted["state"] };
}
