// FREE-TIER PROBE — D1 facts that only real D1 can answer (docs/release/V1_FREE_TIER_PROBE_RUNBOOK.md §D1).
// Runs against the probe's PHOTOS_DB only (identity-checked by worker.ts), in its own scratch table plus the real
// photo store contract. Returns plain facts (ok / error text / D1 meta); it decides nothing. Synthetic random bytes only.
import type { Db } from "../../db.ts";
import { sha256Hex } from "../../db.ts";
import { D1PhotoStore, PhotoStoreError } from "../binary-photo/d1-photo-store.ts";

type Meta = Record<string, unknown> | undefined;
interface Fact { check: string; ok: boolean; detail?: string; meta?: Meta }

function random(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(length, i + 65_536)));
  return out;
}
const short = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 160);
const metaOf = (result: unknown): Meta => (result as { meta?: Record<string, unknown> })?.meta;

export const BLOB_SIZES = [90_000, 100_000, 100_001, 500_000, 1_000_000, 1_200_000, 1_999_000, 2_000_000, 2_000_001] as const;

export async function runD1Checks(db: Db): Promise<Fact[]> {
  const facts: Fact[] = [];
  const run = async (check: string, fn: () => Promise<{ detail?: string; meta?: Meta } | void>) => {
    try { const r = await fn(); facts.push({ check, ok: true, ...(r ?? {}) }); }
    catch (error) { facts.push({ check, ok: false, detail: short(error) }); }
  };
  await db.prepare("DELETE FROM probe_blob_checks").run();

  // 1. A bound BLOB of each size: is it accepted (100 KB statement rule vs 2 MB row rule) and read back intact?
  for (const size of BLOB_SIZES) {
    await run(`bound BLOB ${size} B: insert`, async () => {
      const bytes = random(size);
      const meta = metaOf(await db.prepare("INSERT INTO probe_blob_checks (id, bytes, sha256) VALUES (?, ?, ?)").bind(`b${size}`, bytes, await sha256Hex(bytes)).run());
      const row = await db.prepare("SELECT bytes, sha256 FROM probe_blob_checks WHERE id = ?").bind(`b${size}`).first<{ bytes: ArrayBuffer | Uint8Array; sha256: string }>();
      const back = row ? (row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes)) : new Uint8Array(0);
      return { detail: `read back ${back.length} B, sha256 ${row && (await sha256Hex(back)) === row.sha256 ? "matches" : "DIFFERS"}`, meta };
    });
  }
  // 2. The same bytes as SQL text instead of a parameter: where does the statement-length limit bite?
  for (const size of [40_000, 49_000, 50_001]) {
    await run(`literal X'' BLOB ${size} B (statement ≈ ${2 * size + 80} chars)`, async () => {
      const hex = Array.from(random(size), (b) => b.toString(16).padStart(2, "0")).join("");
      await db.prepare(`INSERT INTO probe_blob_checks (id, bytes, sha256) VALUES ('lit${size}', X'${hex}', 'literal')`).run();
    });
  }
  // 3. Is PRAGMA secure_delete accepted, and does it stay on inside a batch?
  await run("PRAGMA secure_delete = ON (single)", async () => ({ meta: metaOf(await db.prepare("PRAGMA secure_delete = ON").run()) }));
  await run("PRAGMA secure_delete in batch, then read back", async () => {
    const out = await db.batch([db.prepare("PRAGMA secure_delete = ON"), db.prepare("PRAGMA secure_delete")]) as { results?: unknown[] }[];
    return { detail: JSON.stringify(out[1]?.results ?? out[1]) };
  });
  // 4. The photo-store contract on real D1: create-only, fence, no resurrection, no removal, usage ledger.
  const store = new D1PhotoStore(db), key = `probe/${crypto.randomUUID()}.jpg`, bytes = random(1_200_000);
  const meta = { mediaType: "image/jpeg" as const, contentSha256: await sha256Hex(bytes), byteLength: bytes.length, width: 1, height: 1 };
  await run("store.put 1.2 MB", async () => { await store.put(key, bytes, meta); return { detail: JSON.stringify(await store.usage()) }; });
  await run("store.put identical retry", async () => { await store.put(key, bytes, meta); });
  // The key and fence time are printed so the runbook's Time Travel step can restore to just before the fence.
  await run("store.delete (fence)", async () => {
    const before = new Date().toISOString();
    await store.delete(key);
    return { detail: JSON.stringify({ key, fencedAfter: before, usage: await store.usage() }) };
  });
  await run("store.put after fence is refused", async () => {
    try { await store.put(key, bytes, meta); } catch (error) { if (error instanceof PhotoStoreError && error.code === "permanentlyDeleted") return { detail: "refused" }; throw error; }
    throw new Error("ACCEPTED — fence broken");
  });
  await run("raw resurrect UPDATE is refused", async () => {
    try { await db.prepare("UPDATE photo_objects SET state = 'live' WHERE storage_key = ?").bind(key).run(); }
    catch (error) { return { detail: short(error) }; }
    throw new Error("ACCEPTED — trigger missing");
  });
  await run("raw DELETE of a fence is refused", async () => {
    try { await db.prepare("DELETE FROM photo_objects WHERE storage_key = ?").bind(key).run(); }
    catch (error) { return { detail: short(error) }; }
    throw new Error("ACCEPTED — trigger missing");
  });
  await run("database size after checks", async () => ({ meta: metaOf(await db.prepare("SELECT 1").run()) }));
  await db.prepare("DELETE FROM probe_blob_checks").run();
  return facts;
}
