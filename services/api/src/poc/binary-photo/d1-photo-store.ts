// PoC — private photo bytes in a dedicated D1 database (PHOTOS_DB) instead of R2, for a Workers Free account that holds
// no billable product. NOT bound anywhere; see docs/release/V1_BINARY_PHOTO_D1_POC.md.
//
// Same contract as the R2 adapter (src/reports/r2-photo-storage.ts): create-only puts, identical retries succeed while
// live, and delete() leaves a permanent fence that refuses every later put — also when the delete arrives first. The
// fence is a SQL state, so "conditional write" is the database's own constraint check, not a provider feature.
// A separate database (not REPORTS_DB) keeps photo bytes from consuming the report store's 500 MB.
import type { Db } from "../../db.ts";
import { isoSeconds } from "../../db.ts";

export const PHOTOS_DB_SCHEMA = `
CREATE TABLE photo_objects (
  storage_key    TEXT PRIMARY KEY CHECK (length(storage_key) BETWEEN 1 AND 128),
  state          TEXT NOT NULL CHECK (state IN ('live', 'deleted')),
  bytes          BLOB,
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
  byte_length    INTEGER,
  stored_at      TEXT,
  deleted_at     TEXT,
  CHECK ((state = 'live') = (bytes IS NOT NULL)),
  CHECK (state = 'deleted' OR (typeof(bytes) = 'blob' AND length(bytes) = byte_length AND content_sha256 IS NOT NULL
                               AND stored_at IS NOT NULL AND deleted_at IS NULL)),
  CHECK (state = 'live' OR (content_sha256 IS NULL AND byte_length IS NULL AND stored_at IS NULL AND deleted_at IS NOT NULL))
);
-- A fence is permanent: no resurrection, no edit, no row removal (a removed row would let a delayed put succeed).
CREATE TRIGGER photo_objects_fence_permanent BEFORE UPDATE ON photo_objects WHEN OLD.state = 'deleted'
BEGIN SELECT RAISE(ABORT, 'photo: permanently deleted'); END;
CREATE TRIGGER photo_objects_live_only_to_fence BEFORE UPDATE ON photo_objects
WHEN OLD.state = 'live' AND NOT (NEW.state = 'deleted' AND NEW.storage_key = OLD.storage_key)
BEGIN SELECT RAISE(ABORT, 'photo: live objects are immutable'); END;
CREATE TRIGGER photo_objects_never_removed BEFORE DELETE ON photo_objects
BEGIN SELECT RAISE(ABORT, 'photo: fences are permanent'); END;

-- Capacity: live bytes are tracked exactly and new photos are refused at the budget, inside the same statement.
CREATE TABLE photo_store_usage (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  live_bytes  INTEGER NOT NULL CHECK (live_bytes >= 0),
  live_count  INTEGER NOT NULL CHECK (live_count >= 0),
  budget_bytes INTEGER NOT NULL CHECK (budget_bytes > 0)
);
INSERT INTO photo_store_usage (id, live_bytes, live_count, budget_bytes) VALUES (1, 0, 0, 400000000);
CREATE TRIGGER photo_objects_budget BEFORE INSERT ON photo_objects
WHEN NEW.state = 'live' AND (SELECT live_bytes + NEW.byte_length > budget_bytes FROM photo_store_usage WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'photo: store budget reached'); END;
CREATE TRIGGER photo_objects_count_live AFTER INSERT ON photo_objects WHEN NEW.state = 'live'
BEGIN UPDATE photo_store_usage SET live_bytes = live_bytes + NEW.byte_length, live_count = live_count + 1 WHERE id = 1; END;
CREATE TRIGGER photo_objects_count_fence AFTER UPDATE OF state ON photo_objects WHEN OLD.state = 'live' AND NEW.state = 'deleted'
BEGIN UPDATE photo_store_usage SET live_bytes = live_bytes - OLD.byte_length, live_count = live_count - 1 WHERE id = 1; END;
`;

export class PhotoStoreError extends Error {
  readonly code: "permanentlyDeleted" | "conflict" | "budgetReached";
  constructor(code: PhotoStoreError["code"]) { super(code); this.code = code; }
}

export interface PhotoStoreMetadata { mediaType: "image/png" | "image/jpeg"; contentSha256: string; byteLength: number; width: number; height: number }

const toHex = (bytes: Uint8Array): string => {
  const native = (bytes as unknown as { toHex?: () => string }).toHex;
  return native ? native.call(bytes) : Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export class D1PhotoStore {
  private readonly db: Db;
  private readonly now: () => Date;
  constructor(db: Db, now: () => Date = () => new Date()) { this.db = db; this.now = now; }

  async put(key: string, bytes: Uint8Array, metadata: PhotoStoreMetadata): Promise<void> {
    try {
      // Bound as one hex string and decoded by SQLite: the D1 binding JSON-encodes a bound BLOB as an array of numbers,
      // which cost 63–111 ms CPU per 1 MB on Workers (runbook §10). The column still receives a BLOB, so the CHECKs on
      // typeof(bytes) and length(bytes) = byte_length below still decide; malformed hex becomes NULL and is refused.
      await this.db.prepare(`INSERT INTO photo_objects (storage_key, state, bytes, content_sha256, byte_length, stored_at)
          VALUES (?, 'live', unhex(?), ?, ?, ?) ON CONFLICT (storage_key) DO NOTHING`)
        .bind(key, toHex(bytes), metadata.contentSha256, bytes.length, isoSeconds(this.now())).run();
    } catch (error) {
      if (String(error).includes("store budget reached")) throw new PhotoStoreError("budgetReached");
      throw error;
    }
    const row = await this.db.prepare("SELECT state, content_sha256, byte_length FROM photo_objects WHERE storage_key = ?")
      .bind(key).first<{ state: string; content_sha256: string | null; byte_length: number | null }>();
    if (!row || row.state === "deleted") throw new PhotoStoreError("permanentlyDeleted");
    if (row.content_sha256 !== metadata.contentSha256 || row.byte_length !== bytes.length) throw new PhotoStoreError("conflict");
  }

  async getMetadata(key: string): Promise<{ byteLength: number; mediaType: string } | null> {
    const row = await this.db.prepare("SELECT byte_length FROM photo_objects WHERE storage_key = ? AND state = 'live'")
      .bind(key).first<{ byte_length: number }>();
    return row ? { byteLength: row.byte_length, mediaType: "image/jpeg" } : null;
  }

  /**
   * Durable fence; also creates the fence when no object was ever stored under this key. Idempotent.
   * It must not depend on anything D1 may refuse: D1 (local workerd) answers `PRAGMA secure_delete` with SQLITE_AUTH,
   * and an earlier version that batched it here failed the whole fence. Consequence, pinned by a test: SQLite keeps the
   * old bytes in free pages until they are reused, and overwriting with zeroblob() first does not change that. Those
   * pages are not reachable through SQL, export or this adapter; Time Travel restore is (see erasure.ts lead).
   */
  async delete(key: string): Promise<void> {
    await this.db.prepare(`INSERT INTO photo_objects (storage_key, state, deleted_at) VALUES (?, 'deleted', ?)
        ON CONFLICT (storage_key) DO UPDATE SET state = 'deleted', bytes = NULL, content_sha256 = NULL, byte_length = NULL,
          stored_at = NULL, deleted_at = excluded.deleted_at
        WHERE photo_objects.state = 'live'`).bind(key, isoSeconds(this.now())).run();
  }

  /** Operator read (local Admin only). Bounded by the stored length, never by the caller. */
  async read(key: string, maximumBytes: number): Promise<Uint8Array | null> {
    const row = await this.db.prepare("SELECT bytes, byte_length FROM photo_objects WHERE storage_key = ? AND state = 'live'")
      .bind(key).first<{ bytes: ArrayBuffer | Uint8Array; byte_length: number }>();
    if (!row) return null;
    if (row.byte_length > maximumBytes) throw new PhotoStoreError("conflict");
    return row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes);
  }

  async usage(): Promise<{ liveBytes: number; liveCount: number; budgetBytes: number }> {
    const row = await this.db.prepare("SELECT live_bytes, live_count, budget_bytes FROM photo_store_usage WHERE id = 1")
      .first<{ live_bytes: number; live_count: number; budget_bytes: number }>();
    return { liveBytes: Number(row!.live_bytes), liveCount: Number(row!.live_count), budgetBytes: Number(row!.budget_bytes) };
  }
}
