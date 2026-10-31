// PoC — operator-side persistence of the photo day-key seed (docs/release/V1_PHOTO_ERASURE_ANALYSIS.md §5). Local only;
// never runs in a Worker and never sends anything anywhere.
//
// File format: "MPS1" ‖ day(uint32) ‖ seed(32) ‖ SHA-256 of the preceding 40 bytes (32). The day travels with the seed so a
// stale or rolled-back file is detected instead of silently deriving the wrong keys.
//
// Rotation is crash-safe at the file level: write a temporary file, fsync it, rename it over the old one, fsync the
// directory, read it back. A crash before the rename leaves the old seed (key not yet destroyed: retry and alert); a
// crash after it leaves the new one. What this cannot do: erase the old seed's blocks on an SSD/APFS volume, or remove it
// from APFS/Time Machine snapshots or backups taken earlier. See §5 for the mitigations.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { DayKeyChain } from "../src/poc/binary-photo/photo-crypto.ts";

const MAGIC = Buffer.from("MPS1");

export function encodeSeedFile(day: number, seed: Uint8Array): Buffer {
  if (seed.length !== 32 || !Number.isInteger(day) || day < 0 || day > 0xffffffff) throw new Error("seed file: bad input");
  const body = Buffer.alloc(40); MAGIC.copy(body, 0); body.writeUInt32BE(day, 4); Buffer.from(seed).copy(body, 8);
  return Buffer.concat([body, createHash("sha256").update(body).digest()]);
}

export function decodeSeedFile(bytes: Uint8Array): { day: number; seed: Uint8Array } {
  const b = Buffer.from(bytes);
  if (b.length !== 72 || !b.subarray(0, 4).equals(MAGIC)) throw new Error("seed file: malformed");
  if (!createHash("sha256").update(b.subarray(0, 40)).digest().equals(b.subarray(40))) throw new Error("seed file: checksum mismatch");
  return { day: b.readUInt32BE(4), seed: new Uint8Array(b.subarray(8, 40)) };
}

function writeDurably(path: string, bytes: Buffer, hooks: { beforeRename?: () => void } = {}): void {
  const tmp = `${path}.next`;
  const fd = openSync(tmp, "w", 0o600);
  try { writeSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  hooks.beforeRename?.();
  renameSync(tmp, path);
  const dir = openSync(dirname(path), "r");
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

export function loadChain(path: string): DayKeyChain {
  const { day, seed } = decodeSeedFile(readFileSync(path));
  try { return DayKeyChain.fromSeed(day, seed); } finally { seed.fill(0); }
}

/**
 * Daily destruction step: advance the stored seed to `today` (destroying every earlier day's key) and verify the file.
 * Idempotent; refuses to move backwards (a clock or file rollback must be investigated, not "fixed").
 */
export async function rotateSeedFile(path: string, today: number, hooks: { beforeRename?: () => void } = {}): Promise<{ from: number; to: number }> {
  rmSync(`${path}.next`, { force: true }); // a leftover from a crash before rename holds a NEWER seed only; safe to drop
  const chain = loadChain(path);
  if (today < chain.day) throw new Error(`seed file is at day ${chain.day}, ahead of today ${today}: refusing to move backwards`);
  if (today === chain.day) return { from: chain.day, to: chain.day };
  const from = chain.day, next = await chain.advanceTo(today);
  const seed = next.exportSeed();
  try { writeDurably(path, encodeSeedFile(today, seed), hooks); } finally { seed.fill(0); }
  const check = loadChain(path);
  if (check.day !== today) throw new Error("seed file: verification failed after rotation");
  await check.privateKey(today); // derivable
  try { await check.privateKey(today - 1); throw new Error("seed file: yesterday's key is still derivable"); }
  catch (error) { if (!/is destroyed/.test(String(error))) throw error; }
  return { from, to: today };
}

export function createSeedFile(path: string, day: number): void {
  const chain = DayKeyChain.generate(day), seed = chain.exportSeed();
  try { writeDurably(path, encodeSeedFile(day, seed)); } finally { seed.fill(0); }
}
