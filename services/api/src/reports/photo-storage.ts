/** Private sanitized objects only. Implementations must overwrite a key atomically and never expose a public URL. */
export interface EvidencePhotoStorage {
  put(key: string, bytes: Uint8Array, metadata: { mediaType: "image/png"; contentSha256: string; byteLength: number; width: number; height: number }): Promise<void>;
  getMetadata(key: string): Promise<{ byteLength: number; mediaType: string } | null>;
  /** Durable fencing: completion prevents all in-flight and future puts to this key. Plain R2.delete alone is insufficient. */
  delete(key: string): Promise<void>;
}

/** Deterministic test double; no raw-upload or arbitrary metadata channel. */
export class MemoryEvidencePhotoStorage implements EvidencePhotoStorage {
  private readonly deletedKeys = new Set<string>();
  readonly objects = new Map<string, { bytes: Uint8Array; metadata: { mediaType: "image/png"; contentSha256: string; byteLength: number; width: number; height: number } }>();
  async put(key: string, bytes: Uint8Array, metadata: { mediaType: "image/png"; contentSha256: string; byteLength: number; width: number; height: number }): Promise<void> {
    if(this.deletedKeys.has(key)) throw new Error("photo storage key permanently deleted");
    this.objects.set(key, { bytes: bytes.slice(), metadata: { ...metadata } });
  }
  async getMetadata(key: string): Promise<{ byteLength: number; mediaType: string } | null> {
    return this.objects.get(key)?.metadata ?? null;
  }
  async delete(key: string): Promise<void> { this.deletedKeys.add(key); this.objects.delete(key); }
}
