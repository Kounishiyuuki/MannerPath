// PoC A1 — photo bytes in a dedicated Workers KV namespace, every decision in D1 (docs/release/V1_KV_PHOTO_A1_POC.md).
// NOT bound by the API Worker. Same contract as D1PhotoStore / the R2 adapter: create-only puts, identical retries
// succeed while live, delete() leaves a permanent fence that refuses every later put, also when it arrives first.
//
// KV is eventually consistent and has no conditional write, so it decides nothing: the D1 ledger row (no bytes) is the
// only source of truth for "live", "deleted", capacity and the daily KV write budget. A KV value without a live ledger
// row is never served (read() checks the ledger first and the SHA-256 after), and every KV value carries an absolute
// expiration at the latest 90 days after the put, so a value a failed KV.delete left behind still expires.
import type { Db } from "../../db.ts";
import { isoSeconds, sha256Hex } from "../../db.ts";
import { PhotoStoreError } from "../binary-photo/d1-photo-store.ts";

export const KV_RETENTION_DAYS = 90;
/** 80 % of the Free plan's 1,000 KV writes/day and 1 GB, so the API pauses intake before KV starts failing. */
export const KV_DAILY_WRITE_CAP = 800;
export const KV_BUDGET_BYTES = 800_000_000;

export const KV_PHOTOS_DB_SCHEMA = `
CREATE TABLE kv_photo_objects (
  storage_key    TEXT PRIMARY KEY CHECK (length(storage_key) BETWEEN 1 AND 128),
  state          TEXT NOT NULL CHECK (state IN ('live', 'deleted')),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
  byte_length    INTEGER CHECK (byte_length IS NULL OR byte_length > 0),
  stored_at      TEXT,
  kv_expires_at  INTEGER,
  deleted_at     TEXT,
  CHECK (state = 'deleted' OR (content_sha256 IS NOT NULL AND byte_length IS NOT NULL AND stored_at IS NOT NULL
                               AND kv_expires_at IS NOT NULL AND deleted_at IS NULL)),
  CHECK (state = 'live' OR (content_sha256 IS NULL AND byte_length IS NULL AND stored_at IS NULL AND deleted_at IS NOT NULL))
);
CREATE TRIGGER kv_photo_objects_fence_permanent BEFORE UPDATE ON kv_photo_objects WHEN OLD.state = 'deleted'
BEGIN SELECT RAISE(ABORT, 'photo: permanently deleted'); END;
CREATE TRIGGER kv_photo_objects_live_only_to_fence BEFORE UPDATE ON kv_photo_objects
WHEN OLD.state = 'live' AND NOT (NEW.state = 'deleted' AND NEW.storage_key = OLD.storage_key)
BEGIN SELECT RAISE(ABORT, 'photo: live objects are immutable'); END;
CREATE TRIGGER kv_photo_objects_never_removed BEFORE DELETE ON kv_photo_objects
BEGIN SELECT RAISE(ABORT, 'photo: fences are permanent'); END;

CREATE TABLE kv_photo_usage (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  live_bytes       INTEGER NOT NULL CHECK (live_bytes >= 0),
  live_count       INTEGER NOT NULL CHECK (live_count >= 0),
  budget_bytes     INTEGER NOT NULL CHECK (budget_bytes > 0),
  daily_write_cap  INTEGER NOT NULL CHECK (daily_write_cap > 0)
);
INSERT INTO kv_photo_usage (id, live_bytes, live_count, budget_bytes, daily_write_cap) VALUES (1, 0, 0, ${KV_BUDGET_BYTES}, ${KV_DAILY_WRITE_CAP});
-- One row per UTC day: a new live object is one KV write. Retries of the same object do not count again.
CREATE TABLE kv_write_days (day TEXT PRIMARY KEY CHECK (length(day) = 10), writes INTEGER NOT NULL CHECK (writes >= 0));
CREATE TRIGGER kv_photo_objects_budget BEFORE INSERT ON kv_photo_objects
WHEN NEW.state = 'live' AND (SELECT live_bytes + NEW.byte_length > budget_bytes FROM kv_photo_usage WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'photo: store budget reached'); END;
CREATE TRIGGER kv_photo_objects_daily_cap BEFORE INSERT ON kv_photo_objects
WHEN NEW.state = 'live' AND coalesce((SELECT writes FROM kv_write_days WHERE day = substr(NEW.stored_at, 1, 10)), 0)
  >= (SELECT daily_write_cap FROM kv_photo_usage WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'photo: daily write cap reached'); END;
CREATE TRIGGER kv_photo_objects_count_live AFTER INSERT ON kv_photo_objects WHEN NEW.state = 'live'
BEGIN
  UPDATE kv_photo_usage SET live_bytes = live_bytes + NEW.byte_length, live_count = live_count + 1 WHERE id = 1;
  INSERT INTO kv_write_days (day, writes) VALUES (substr(NEW.stored_at, 1, 10), 1)
    ON CONFLICT (day) DO UPDATE SET writes = writes + 1;
END;
CREATE TRIGGER kv_photo_objects_count_fence AFTER UPDATE OF state ON kv_photo_objects WHEN OLD.state = 'live' AND NEW.state = 'deleted'
BEGIN UPDATE kv_photo_usage SET live_bytes = live_bytes - OLD.byte_length, live_count = live_count - 1 WHERE id = 1; END;
`;

/** The subset of the Workers KV binding used here. */
export interface PhotoKv {
  put(key: string, value: ArrayBuffer | Uint8Array, options: { expiration: number }): Promise<void>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
}

export type PhotoRead =
  | { status: "available"; bytes: Uint8Array }
  | { status: "deleted" | "unknown" }
  // Ledger says live but KV does not (yet) return the matching bytes: replication delay or a failed put. Never shown.
  | { status: "notVisible" };

interface LedgerRow { state: string; content_sha256: string | null; byte_length: number | null; kv_expires_at: number | null }

export class KvPhotoStore {
  private readonly db: Db;
  private readonly kv: PhotoKv;
  private readonly now: () => Date;
  constructor(db: Db, kv: PhotoKv, now: () => Date = () => new Date()) { this.db = db; this.kv = kv; this.now = now; }

  private row(key: string): Promise<LedgerRow | null> {
    return this.db.prepare("SELECT state, content_sha256, byte_length, kv_expires_at FROM kv_photo_objects WHERE storage_key = ?").bind(key).first<LedgerRow>();
  }

  /**
   * Ledger first, KV second. A KV failure leaves a live ledger row without bytes: the caller's attach does not mark the
   * photo ready, and an identical retry re-puts the same bytes under the ledger's own expiration (no second count).
   */
  async put(key: string, bytes: Uint8Array, metadata: { contentSha256: string; byteLength: number }): Promise<void> {
    const now = this.now(), expires = Math.floor(now.getTime() / 1000) + KV_RETENTION_DAYS * 86_400;
    try {
      await this.db.prepare(`INSERT INTO kv_photo_objects (storage_key, state, content_sha256, byte_length, stored_at, kv_expires_at)
          VALUES (?, 'live', ?, ?, ?, ?) ON CONFLICT (storage_key) DO NOTHING`)
        .bind(key, metadata.contentSha256, bytes.length, isoSeconds(now), expires).run();
    } catch (error) {
      if (String(error).includes("store budget reached")) throw new PhotoStoreError("budgetReached");
      if (String(error).includes("daily write cap reached")) throw new KvPhotoStoreError("dailyWriteCapReached");
      throw error;
    }
    const row = await this.row(key);
    if (!row || row.state === "deleted") throw new PhotoStoreError("permanentlyDeleted");
    if (row.content_sha256 !== metadata.contentSha256 || row.byte_length !== bytes.length) throw new PhotoStoreError("conflict");
    await this.kv.put(key, bytes, { expiration: row.kv_expires_at! });
    // A delete that ran between the ledger insert and the KV put fenced the row and deleted a KV value that did not
    // exist yet; this put may have just recreated it. Remove it again and report the fence.
    if ((await this.row(key))?.state !== "live") { await this.kv.delete(key); throw new PhotoStoreError("permanentlyDeleted"); }
  }

  async getMetadata(key: string): Promise<{ byteLength: number; mediaType: string } | null> {
    const row = await this.row(key);
    return row?.state === "live" ? { byteLength: row.byte_length!, mediaType: "image/jpeg" } : null;
  }

  /** Durable fence first (D1, permanent), then KV.delete. If KV.delete throws, the fence still hides the value and its expiration still removes it; the caller retries. */
  async delete(key: string): Promise<void> {
    await this.db.prepare(`INSERT INTO kv_photo_objects (storage_key, state, deleted_at) VALUES (?, 'deleted', ?)
        ON CONFLICT (storage_key) DO UPDATE SET state = 'deleted', content_sha256 = NULL, byte_length = NULL,
          stored_at = NULL, kv_expires_at = NULL, deleted_at = excluded.deleted_at
        WHERE kv_photo_objects.state = 'live'`).bind(key, isoSeconds(this.now())).run();
    await this.kv.delete(key);
  }

  /** The only read path (operator review). The ledger decides; KV bytes must match the ledger's SHA-256 and length. */
  async read(key: string): Promise<PhotoRead> {
    const row = await this.row(key);
    if (!row) return { status: "unknown" };
    if (row.state !== "live") return { status: "deleted" };
    const value = await this.kv.get(key, "arrayBuffer");
    if (!value) return { status: "notVisible" };
    const bytes = new Uint8Array(value);
    if (bytes.length !== row.byte_length || (await sha256Hex(bytes)) !== row.content_sha256) return { status: "notVisible" };
    return { status: "available", bytes };
  }

  async usage(): Promise<{ liveBytes: number; liveCount: number; budgetBytes: number; writesToday: number; dailyWriteCap: number }> {
    const u = await this.db.prepare("SELECT live_bytes, live_count, budget_bytes, daily_write_cap FROM kv_photo_usage WHERE id = 1")
      .first<{ live_bytes: number; live_count: number; budget_bytes: number; daily_write_cap: number }>();
    const d = await this.db.prepare("SELECT writes FROM kv_write_days WHERE day = ?").bind(isoSeconds(this.now()).slice(0, 10)).first<{ writes: number }>();
    return { liveBytes: u!.live_bytes, liveCount: u!.live_count, budgetBytes: u!.budget_bytes, writesToday: d?.writes ?? 0, dailyWriteCap: u!.daily_write_cap };
  }
}

export class KvPhotoStoreError extends Error {
  readonly code: "dailyWriteCapReached";
  constructor(code: KvPhotoStoreError["code"]) { super(code); this.code = code; }
}
