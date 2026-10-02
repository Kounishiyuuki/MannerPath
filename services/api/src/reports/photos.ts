import { type Db, type DbStatement, isoSeconds, sha256Hex } from "../db.ts";
import { sanitizeEvidencePhoto } from "./photo-sanitizer.ts";
import type { EvidencePhotoStorage } from "./photo-storage.ts";

export class PhotoAttachmentError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status: number) { super(code); this.code=code; this.status=status; }
}
export interface PhotoAttachmentInput {
  reportId: string; submitterHash: string; idempotencyKey: string; acceptedTermsVersion: string;
  bytes: Uint8Array; mediaType: string;
}
export interface PhotoAttachmentOptions {
  now: Date; enabled?: boolean;
  /** Injection is only for technical tests: no currently accepted terms covers photos. */
  photoTermsCovered?: (version: string) => boolean;
  guards?: DbStatement[];
}
interface PhotoRow { photo_id: string; storage_key: string; content_sha256: string; lifecycle: string; moderation_status: string; }
export interface PhotoAttachmentAccepted { photoId: string; reportId: string; state: "pending" | "approved" | "rejected"; }

export async function attachEvidencePhoto(db: Db, storage: EvidencePhotoStorage, input: PhotoAttachmentInput, opts: PhotoAttachmentOptions): Promise<PhotoAttachmentAccepted> {
  if (!opts.enabled) throw new PhotoAttachmentError("photoEvidenceDisabled", 403);
  if (!opts.photoTermsCovered?.(input.acceptedTermsVersion)) throw new PhotoAttachmentError("photoConsentRequired", 403);
  const now = isoSeconds(opts.now);
  const report = await db.prepare("SELECT submitter_hash,accepted_terms_version,minimize_after,redacted_at FROM reports WHERE report_id=?")
    .bind(input.reportId).first<{ submitter_hash: string | null; accepted_terms_version: string | null; minimize_after: string; redacted_at: string | null }>();
  if (!report) throw new PhotoAttachmentError("reportNotFound", 404);
  if (report.submitter_hash !== input.submitterHash) throw new PhotoAttachmentError("photoUnauthorized", 403);
  if (report.redacted_at !== null || report.minimize_after <= now) throw new PhotoAttachmentError("reportExpired", 410);
  if (report.accepted_terms_version !== input.acceptedTermsVersion) throw new PhotoAttachmentError("photoConsentRequired", 403);
  const image = await sanitizeEvidencePhoto(input.bytes, input.mediaType);
  const prior = await db.prepare("SELECT q.content_sha256,p.photo_id,p.storage_key,p.lifecycle,p.moderation_status FROM community_photo_requests q LEFT JOIN community_evidence_photos p ON p.photo_id=q.photo_id WHERE q.report_id=? AND q.idempotency_key=?")
    .bind(input.reportId, input.idempotencyKey).first<PhotoRow>();
  if (prior && prior.content_sha256 !== image.contentSha256) throw new PhotoAttachmentError("photoIdempotencyConflict", 409);
  if (prior && !prior.photo_id) throw new PhotoAttachmentError("photoExpired",410);
  const same = prior ?? await db.prepare("SELECT * FROM community_evidence_photos WHERE report_id=? AND content_sha256=?")
    .bind(input.reportId, image.contentSha256).first<PhotoRow>();
  if (same?.lifecycle === "deleting") throw new PhotoAttachmentError("photoExpired", 410);
  const photoId = same?.photo_id ?? `ph_${await sha256Hex(`${input.reportId}\n${image.contentSha256}`)}`;
  let key = same?.storage_key ?? `private/evidence/${crypto.randomUUID()}.png`;
  const statements = [...(opts.guards ?? [])];
  if (!same) statements.push(db.prepare(`INSERT INTO community_evidence_photos(photo_id,report_id,storage_key,content_sha256,media_type,byte_length,width,height,lifecycle,created_at,upload_expires_at,delete_after) VALUES(?,?,?,?,?,?,?,?,'uploading',?,?,?) ON CONFLICT(report_id,content_sha256) DO NOTHING`)
    .bind(photoId,input.reportId,key,image.contentSha256,image.mediaType,image.byteLength,image.width,image.height,now,isoSeconds(new Date(opts.now.getTime()+15*60_000)),report.minimize_after));
  statements.push(db.prepare("INSERT INTO community_photo_requests(report_id,idempotency_key,photo_id,content_sha256) VALUES(?,?,?,?) ON CONFLICT DO NOTHING").bind(input.reportId,input.idempotencyKey,photoId,image.contentSha256));
  try { await db.batch(statements); } catch (error) {
    if (String(error).includes("idempotency conflict")) throw new PhotoAttachmentError("photoIdempotencyConflict", 409);
    if (String(error).includes("attachment limit")) throw new PhotoAttachmentError("photoAttachmentLimit", 409);
    throw error;
  }
  const reserved = await db.prepare("SELECT storage_key,lifecycle FROM community_evidence_photos WHERE photo_id=?").bind(photoId).first<{storage_key:string;lifecycle:string}>();
  if (!reserved || reserved.lifecycle === "deleting") throw new PhotoAttachmentError("photoExpired",410);
  key = reserved.storage_key;
  if (reserved.lifecycle !== "ready") {
    // Raw bytes have never crossed the storage boundary. Failed puts leave a timed reservation for cleanup/retry.
    await storage.put(key,image.bytes,{mediaType:image.mediaType,contentSha256:image.contentSha256,byteLength:image.byteLength,width:image.width,height:image.height});
    await db.prepare("UPDATE community_evidence_photos SET lifecycle='ready' WHERE photo_id=? AND lifecycle='uploading' AND delete_after>? AND EXISTS(SELECT 1 FROM reports WHERE report_id=? AND redacted_at IS NULL)")
      .bind(photoId,now,input.reportId).run();
    const row = await db.prepare("SELECT lifecycle FROM community_evidence_photos WHERE photo_id=?").bind(photoId).first<{lifecycle:string}>();
    if (row?.lifecycle !== "ready") { await storage.delete(key); throw new PhotoAttachmentError("reportExpired",410); }
  }
  return {photoId,reportId:input.reportId,state:(same?.moderation_status ?? "pending") as PhotoAttachmentAccepted["state"]};
}

/** Private reviewer signal only. Photo approval never contributes permission or publication rights. */
export async function photoEvidenceStrength(db: Db, reportId: string, now: Date = new Date()): Promise<{ approvedPhotos: number; permissionToSmoke: false }> {
  const row = await db.prepare("SELECT count(*) AS n FROM community_evidence_photos WHERE report_id=? AND lifecycle='ready' AND moderation_status='approved' AND delete_after>?").bind(reportId,isoSeconds(now)).first<{n:number}>();
  return {approvedPhotos:row?.n ?? 0,permissionToSmoke:false};
}
export const PHOTO_DECISION_REASONS = ["usableEvidence", "privacyRisk", "unrelated", "unsafeContent", "insufficientDetail"] as const;
export type PhotoDecisionReason = typeof PHOTO_DECISION_REASONS[number];
export async function moderateEvidencePhoto(db: Db, photoId: string, state: "approved" | "rejected", opts: {now:Date;decidedBy:string;reason:PhotoDecisionReason}): Promise<void> {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(opts.decidedBy) || !PHOTO_DECISION_REASONS.includes(opts.reason)) throw new PhotoAttachmentError("photoInvalidDecision",400);
  const row=await db.prepare("SELECT moderation_status,lifecycle FROM community_evidence_photos WHERE photo_id=?").bind(photoId).first<{moderation_status:string;lifecycle:string}>();
  if (!row || row.lifecycle!=="ready" || (row.moderation_status!=="pending" && row.moderation_status!==state)) throw new PhotoAttachmentError("photoModerationConflict",409);
  if(row.moderation_status!==state) await db.prepare("UPDATE community_evidence_photos SET moderation_status=?,decided_by=?,decided_at=?,decision_reason=?,lifecycle=? WHERE photo_id=?").bind(state,opts.decidedBy,isoSeconds(opts.now),opts.reason,state === "rejected" ? "deleting" : "ready",photoId).run();
}

/** Bounded durable tombstones survive report deletion and failed object deletes. */
export async function cleanupEvidencePhotos(db: Db, storage: EvidencePhotoStorage, opts: {now:Date;limit?:number}): Promise<{deleted:number;hasMore:boolean}> {
  const now=isoSeconds(opts.now); const limit=Math.max(1,Math.min(opts.limit ?? 100,200));
  const due=await db.prepare("SELECT photo_id,storage_key FROM community_evidence_photos WHERE delete_after<=? OR lifecycle='deleting' OR (lifecycle='uploading' AND upload_expires_at<=?) ORDER BY delete_after,photo_id LIMIT ?").bind(now,now,limit).all<{photo_id:string;storage_key:string}>();
  if(due.results.length) await db.batch(due.results.map(row=>db.prepare("DELETE FROM community_evidence_photos WHERE photo_id=?").bind(row.photo_id)));
  const queued=await db.prepare("SELECT storage_key FROM community_photo_deletions ORDER BY queued_at,storage_key LIMIT ?").bind(limit+1).all<{storage_key:string}>();
  let deleted=0;
  for(const row of queued.results.slice(0,limit)) { await storage.delete(row.storage_key); await db.prepare("DELETE FROM community_photo_deletions WHERE storage_key=?").bind(row.storage_key).run(); deleted++; }
  return {deleted,hasMore:due.results.length===limit || queued.results.length>limit};
}
