import { type Db, isoSeconds, sha256Hex } from "../db.ts";
import { PHOTO_ERASURE_LEAD_MS, type EvidencePhotoStorage } from "./photo-storage.ts";

export { PHOTO_ERASURE_LEAD_MS } from "./photo-storage.ts";
const KEY = /^private\/evidence\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;
type PhotoMetadata = Parameters<EvidencePhotoStorage["put"]>[2];
export type PhotoBucket = Pick<R2Bucket, "put" | "head">;
interface Reservation {
  content_sha256: string; byte_length: number; width: number; height: number;
  delete_after: string; upload_expires_at: string; lifecycle: string;
}
const unavailable = () => new Error("photo storage unavailable");
function validKey(key: string): void { if (!KEY.test(key)) throw unavailable(); }

/**
 * No read-body, URL, multipart, copy or arbitrary metadata API. Use a dedicated PRIVATE bucket.
 * The same-key, zero-byte marker is the durable fence: NEVER remove/expire it or restore over it.
 * Image PUT is create-only; R2 evaluates If-None-Match atomically at commit (including delayed PUT).
 */
export class R2EvidencePhotoStorage implements EvidencePhotoStorage {
  private readonly bucket: PhotoBucket;
  private readonly db: Db;
  private readonly clock: () => Date;
  constructor(bucket: PhotoBucket, reports: Db, clock: () => Date = () => new Date()) {
    this.bucket = bucket; this.db = reports; this.clock = clock;
  }

  private async reservation(key: string): Promise<Reservation | null> {
    validKey(key);
    const now = this.clock();
    return this.db.prepare(`SELECT p.content_sha256,p.byte_length,p.width,p.height,
      p.delete_after,p.upload_expires_at,p.lifecycle
      FROM community_evidence_photos p JOIN reports r ON r.report_id=p.report_id
      WHERE p.storage_key=? AND p.lifecycle IN ('uploading','ready')
        AND p.moderation_status IN ('pending','approved') AND r.redacted_at IS NULL
        AND r.minimize_after=p.delete_after AND p.delete_after>?
        AND (p.lifecycle='ready' OR p.upload_expires_at>?)
        AND NOT EXISTS(SELECT 1 FROM community_photo_deletions d WHERE d.storage_key=p.storage_key)`)
      .bind(key, isoSeconds(new Date(now.getTime() + PHOTO_ERASURE_LEAD_MS)), isoSeconds(now)).first<Reservation>();
  }

  async put(key: string, bytes: Uint8Array, metadata: PhotoMetadata): Promise<void> {
    try {
      const row = await this.reservation(key);
      if (!row || metadata.mediaType !== "image/png" || metadata.byteLength !== bytes.byteLength
        || row.byte_length !== metadata.byteLength || row.width !== metadata.width || row.height !== metadata.height
        || row.content_sha256 !== metadata.contentSha256 || await sha256Hex(bytes) !== metadata.contentSha256) throw unavailable();
      const customMetadata = {
        kind: "sanitized-photo.v1", sha256: row.content_sha256,
        width: String(row.width), height: String(row.height), deleteAfter: row.delete_after,
      };
      const stored = await this.bucket.put(key, bytes, {
        onlyIf: new Headers({ "If-None-Match": "*" }), sha256: metadata.contentSha256,
        httpMetadata: { contentType: "image/png", cacheControl: "private, no-store" }, customMetadata,
      });
      if (!stored) {
        const existing = await this.bucket.head(key);
        if (!existing || existing.size !== row.byte_length || existing.httpMetadata?.contentType !== "image/png"
          || Object.entries(customMetadata).some(([name, value]) => existing.customMetadata?.[name] !== value)) throw unavailable();
      }
      // A parent may have been erased or expired while R2 was writing. Never accept that late success.
      if (!await this.reservation(key)) { await this.delete(key); throw unavailable(); }
    } catch { throw unavailable(); } // Never leak R2 errors, keys, hashes or DB bindings.
  }

  async getMetadata(key: string): Promise<{ byteLength: number; mediaType: string } | null> {
    try {
      const row = await this.reservation(key);
      if (!row) return null;
      const object = await this.bucket.head(key);
      if (!object || object.customMetadata?.kind !== "sanitized-photo.v1") return null;
      if (object.size !== row.byte_length || object.customMetadata.sha256 !== row.content_sha256
        || object.customMetadata.deleteAfter !== row.delete_after || object.httpMetadata?.contentType !== "image/png") throw unavailable();
      return { byteLength: object.size, mediaType: "image/png" };
    } catch { throw unavailable(); }
  }

  async delete(key: string): Promise<void> {
    validKey(key);
    try {
      // Replacing removes the photo and ALL its metadata. A marker contains only a random opaque key.
      // A plain R2 DELETE would re-open the key to a delayed create-only PUT.
      const marker = await this.bucket.put(key, new Uint8Array(), {
        httpMetadata: { contentType: "application/octet-stream", cacheControl: "private, no-store" },
        customMetadata: { kind: "deleted-photo.v1" },
      });
      if (!marker) throw unavailable();
    } catch { throw unavailable(); } // An uncertain acknowledgement MUST retain the D1 deletion job.
  }
}
