// Content-addressed raw artifact storage (R2). The key is a pure function of the bytes' sha256, so an
// object is never overwritten with other bytes and identical bytes are stored once. The check code sees
// only this interface; the Worker passes the R2 binding, tests pass an in-memory store.

export interface RawArtifactStore {
  /** The stored object's size, or null when no object has this key. */
  head(key: string): Promise<{ byteLength: number } | null>;
  /** Stores bytes under key; the store verifies them against sha256 (hex). */
  put(key: string, bytes: Uint8Array, sha256: string): Promise<void>;
}

export function rawArtifactKey(contentSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentSha256)) throw new Error(`rawArtifactKey: not a sha256 hex digest: ${contentSha256}`);
  return `raw/sha256/${contentSha256}`;
}

/** The Worker's R2 binding as a RawArtifactStore. R2 rejects the put if the bytes do not hash to sha256. */
export function r2ArtifactStore(bucket: R2Bucket): RawArtifactStore {
  return {
    async head(key) {
      const object = await bucket.head(key);
      return object ? { byteLength: object.size } : null;
    },
    async put(key, bytes, sha256) {
      await bucket.put(key, bytes, { sha256, httpMetadata: { contentType: "application/octet-stream" } });
    },
  };
}
