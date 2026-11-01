// FREE-TIER PROBE — one upload stage per request, so Workers' per-invocation CPU (tail `cpuTime`) isolates its cost
// (docs/release/V1_FREE_TIER_PROBE_RUNBOOK.md §10). Synthetic bytes only; rows go to probe_blob_checks and are removed.
//
// Why: the 2026-10-31 run spent 26–184 ms CPU per v3 upload. The D1 binding (workerd `cloudflare-internal:d1-api`)
// turns a bound ArrayBuffer/view into `Array.from(bytes)` and JSON-encodes it, so a 1 MB BLOB becomes a million-element
// array; results come back the same way. These stages compare that with passing the bytes as one hex/base64 string.
import type { Db } from "../../db.ts";
import { sha256Hex } from "../../db.ts";
import { validateJpegStructure } from "../../reports/jpeg-structure.ts";
import { splitPhotoBody } from "../binary-photo/protocol.ts";

export const STAGES = ["read", "split", "jpeg", "sha256", "blob-write", "hex-write", "b64-write", "blob-read", "hex-read", "b64-read"] as const;
export type Stage = typeof STAGES[number];

type Codec = { toHex(b: Uint8Array): string; fromHex(s: string): Uint8Array; toB64(b: Uint8Array): string; fromB64(s: string): Uint8Array; native: boolean };

/** Uint8Array.prototype.toHex/toBase64 (TC39) where the runtime has them; otherwise reported as non-native. */
export function codec(): Codec {
  const u = Uint8Array as unknown as { fromHex?: (s: string) => Uint8Array; fromBase64?: (s: string) => Uint8Array };
  const p = Uint8Array.prototype as unknown as { toHex?: () => string; toBase64?: () => string };
  if (p.toHex && p.toBase64 && u.fromHex && u.fromBase64) {
    return { native: true, toHex: (b) => (b as unknown as { toHex(): string }).toHex(), fromHex: (s) => u.fromHex!(s),
      toB64: (b) => (b as unknown as { toBase64(): string }).toBase64(), fromB64: (s) => u.fromBase64!(s) };
  }
  const bin = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 32_768) s += String.fromCharCode(...b.subarray(i, i + 32_768)); return s; };
  return { native: false, toHex: (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""),
    fromHex: (s) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16)), toB64: (b) => btoa(bin(b)),
    fromB64: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
}

/** Runs one stage on `body` (a raw JPEG, or a v3 frame for "split"); every stage first reads the whole body. */
export async function runStage(stage: Stage, body: Uint8Array, db: Db): Promise<Record<string, unknown>> {
  const c = codec(), id = "stage";
  switch (stage) {
    case "read": return { bytes: body.length };
    case "split": { const r = splitPhotoBody(body); return { ok: r.ok }; }
    case "jpeg": return { size: validateJpegStructure(body) };
    case "sha256": return { sha256: await sha256Hex(body) };
    case "blob-write": await put(db, id, "?", body); return { stored: body.length };
    case "hex-write": await put(db, id, "unhex(?)", c.toHex(body)); return { stored: body.length, native: c.native };
    case "b64-write": await put(db, id, "?", c.toB64(body)); return { stored: body.length, native: c.native };
    case "blob-read": {
      const row = await db.prepare("SELECT bytes FROM probe_blob_checks WHERE id = ?").bind(id).first<{ bytes: ArrayBuffer | number[] }>();
      return { read: row ? new Uint8Array(row.bytes as ArrayBuffer).length : -1 };
    }
    case "hex-read": {
      const row = await db.prepare("SELECT hex(bytes) AS h FROM probe_blob_checks WHERE id = ?").bind(id).first<{ h: string }>();
      return { read: row ? c.fromHex(row.h).length : -1, native: c.native };
    }
    case "b64-read": {
      const row = await db.prepare("SELECT bytes FROM probe_blob_checks WHERE id = ?").bind(id).first<{ bytes: string }>();
      return { read: row && typeof row.bytes === "string" ? c.fromB64(row.bytes).length : -1, native: c.native };
    }
  }
}

async function put(db: Db, id: string, valueSql: string, value: Uint8Array | string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM probe_blob_checks WHERE id = ?").bind(id),
    db.prepare(`INSERT INTO probe_blob_checks (id, bytes, sha256) VALUES (?, ${valueSql}, 'stage')`).bind(id, value),
  ]);
}
