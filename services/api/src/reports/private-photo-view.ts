import { type Db, isoSeconds, sha256Hex } from '../db.ts';
import { MAX_PHOTO_PIXELS } from './photo-sanitizer.ts';
import { PHOTO_ERASURE_LEAD_MS } from './photo-storage.ts';

// Fresh RGBA PNG: pixels + per-row filters + generous deflate/chunk overhead.
// Bound derivatives independently of the (smaller) incoming compressed upload limit.
export const MAX_PRIVATE_PHOTO_BYTES = Math.min(16 * 1024 * 1024, MAX_PHOTO_PIXELS * 5 + 64 * 1024);
export interface PrivatePhotoReader {
  read(key: string, maximumBytes: number): Promise<Uint8Array | null>;
}
export class PrivatePhotoViewError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
interface PrivateBucket {
  get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array> } | null>;
}
/** Read-only R2 seam: never publishes a URL or writes bytes to disk. */
export class R2PrivatePhotoReader implements PrivatePhotoReader {
  private readonly bucket: PrivateBucket;
  constructor(bucket: PrivateBucket) { this.bucket = bucket; }
  async read(key: string, maximumBytes: number): Promise<Uint8Array | null> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_PRIVATE_PHOTO_BYTES)
      throw new PrivatePhotoViewError('photoInvalidLimit', 422);
    const object = await this.bucket.get(key);
    if (!object) return null;
    if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > maximumBytes) {
      await object.body.cancel();
      throw new PrivatePhotoViewError('photoInvalidBody', 422);
    }
    const reader = object.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maximumBytes || total > object.size) {
          await reader.cancel();
          throw new PrivatePhotoViewError('photoInvalidBody', 422);
        }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    if (total !== object.size) throw new PrivatePhotoViewError('photoInvalidBody', 422);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
}
interface PhotoRow { storage_key: string; byte_length: number; content_sha256: string; media_type: string; }
async function eligible(db: Db, photoId: string, now: Date): Promise<PhotoRow> {
  const row = await db.prepare(`SELECT p.storage_key,p.byte_length,p.content_sha256,p.media_type
    FROM community_evidence_photos p JOIN reports r ON r.report_id=p.report_id
    WHERE p.photo_id=? AND p.lifecycle='ready' AND p.moderation_status IN ('pending','approved')
    AND p.delete_after>? AND r.redacted_at IS NULL AND r.minimize_after=p.delete_after
    AND NOT EXISTS(SELECT 1 FROM community_photo_deletions d WHERE d.storage_key=p.storage_key)`)
    .bind(photoId, isoSeconds(new Date(now.getTime()+PHOTO_ERASURE_LEAD_MS))).first<PhotoRow>();
  if (!row) throw new PrivatePhotoViewError('photoUnavailable', 404);
  if (row.media_type !== 'image/png' || !Number.isSafeInteger(row.byte_length) || row.byte_length < 8 || row.byte_length > MAX_PRIVATE_PHOTO_BYTES)
    throw new PrivatePhotoViewError('photoInvalidBody', 422);
  return row;
}
/** Caller must authorize the operator and serve no-store; no public retrieval route. */
export async function readPrivateEvidencePhoto(db: Db, reader: PrivatePhotoReader, photoId: string, now: () => Date = () => new Date()): Promise<{ bytes: Uint8Array; mediaType: 'image/png' }> {
  const before = await eligible(db, photoId, now());
  let bytes: Uint8Array | null;
  try { bytes = await reader.read(before.storage_key, before.byte_length); }
  catch (error) {
    if (error instanceof PrivatePhotoViewError) throw error;
    throw new PrivatePhotoViewError('photoStorageUnavailable', 502);
  }
  if (!bytes) throw new PrivatePhotoViewError('photoObjectMissing', 404);
  if (bytes.byteLength !== before.byte_length || bytes.byteLength > MAX_PRIVATE_PHOTO_BYTES ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes![index] === byte) ||
      await sha256Hex(bytes) !== before.content_sha256) throw new PrivatePhotoViewError('photoInvalidBody', 422);
  // Hashing is asynchronous too: recheck after all reads/digests, directly before returning.
  const after = await eligible(db, photoId, now());
  if (after.storage_key !== before.storage_key || after.content_sha256 !== before.content_sha256 || after.byte_length !== before.byte_length)
    throw new PrivatePhotoViewError('photoUnavailable', 404);
  return { bytes, mediaType: 'image/png' };
}
