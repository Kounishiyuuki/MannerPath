import type { PhotoBucket } from '../../src/reports/r2-photo-storage.ts';

export interface StoredPhoto {
  bytes: Uint8Array;
  size: number;
  httpMetadata: R2HTTPMetadata;
  customMetadata: Record<string, string>;
}

/** R2's conditional precondition is checked at commit, not when the request starts. */
export class MockPhotoR2 {
  readonly objects = new Map<string, StoredPhoto>();
  beforeCommit?: (key: string, marker: boolean) => Promise<void>;
  failBeforeCommit = false;
  failAfterCommit = false;
  readonly bucket: PhotoBucket = {
    put: (async (key: string, value: Uint8Array, options: R2PutOptions = {}) => {
      const bytes = new Uint8Array(value).slice();
      await this.beforeCommit?.(key, bytes.length === 0);
      if (this.failBeforeCommit) throw Error('private bucket failure');
      const createOnly = options.onlyIf instanceof Headers && options.onlyIf.get('If-None-Match') === '*';
      if (createOnly && this.objects.has(key)) return null;
      const object: StoredPhoto = {
        bytes, size: bytes.length,
        httpMetadata: { ...options.httpMetadata as R2HTTPMetadata },
        customMetadata: { ...options.customMetadata },
      };
      this.objects.set(key, object);
      if (this.failAfterCommit) throw Error('private bucket acknowledgement lost');
      return object as unknown as R2Object;
    }) as PhotoBucket['put'],
    head: (async (key: string) => this.objects.get(key) as unknown as R2Object | null ?? null) as PhotoBucket['head'],
  };
}

export function pause() {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  return { started, release, wait: async () => { entered(); await waiting; } };
}
