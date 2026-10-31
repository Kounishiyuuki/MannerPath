// PoC: operator seed file and daily rotation (scripts/photo-key-seed-file.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSeedFile, decodeSeedFile, encodeSeedFile, loadChain, rotateSeedFile } from "../scripts/photo-key-seed-file.ts";
import { DayKeyChain, openPhoto, sealPhoto } from "../src/poc/binary-photo/photo-crypto.ts";

const withDir = async (fn: (dir: string) => Promise<void>) => { const dir = mkdtempSync(join(tmpdir(), "seed-")); try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const plain = new TextEncoder().encode("photo");

test("after rotation no past day key can be regenerated from the stored file, while later days stay readable", async () => withDir(async (dir) => {
  const path = join(dir, "seed"); createSeedFile(path, 100);
  const before = loadChain(path);
  const sealed100 = await sealPhoto(plain, "k", 100, await before.publicKeyRaw(100));
  const sealed101 = await sealPhoto(plain, "k", 101, await before.publicKeyRaw(101));
  const oldFile = readFileSync(path);
  assert.deepEqual(await rotateSeedFile(path, 101), { from: 100, to: 101 });
  const after = loadChain(path);
  await assert.rejects(after.privateKey(100), /is destroyed/);
  assert.deepEqual(await openPhoto(sealed101, "k", await after.privateKey(101)), plain);
  assert.notDeepEqual(readFileSync(path), oldFile);
  // The day-100 public key is not among the keys the new seed can produce (sanity over a year ahead).
  const destroyedPublic = Buffer.from(await before.publicKeyRaw(100)).toString("hex");
  for (let d = 101; d < 466; d += 1) assert.notEqual(Buffer.from(await after.publicKeyRaw(d)).toString("hex"), destroyedPublic);
  // Only a copy of the OLD file (snapshot/backup) can still open day 100 — the residual risk §5 documents.
  const restored = DayKeyChain.fromSeed(decodeSeedFile(oldFile).day, decodeSeedFile(oldFile).seed);
  assert.deepEqual(await openPhoto(sealed100, "k", await restored.privateKey(100)), plain);
}));

test("a crash before the rename leaves the old seed (destruction pending) and the next run completes it", async () => withDir(async (dir) => {
  const path = join(dir, "seed"); createSeedFile(path, 200);
  await assert.rejects(rotateSeedFile(path, 201, { beforeRename: () => { throw new Error("power loss"); } }), /power loss/);
  assert.equal(loadChain(path).day, 200);            // key for day 200 still exists → must alert
  assert.ok(existsSync(`${path}.next`));             // a newer seed only
  assert.deepEqual(await rotateSeedFile(path, 201), { from: 200, to: 201 });
  assert.equal(existsSync(`${path}.next`), false);
  await assert.rejects(loadChain(path).privateKey(200), /is destroyed/);
}));

test("rotation is idempotent, refuses to go backwards, and detects a corrupted file", async () => withDir(async (dir) => {
  const path = join(dir, "seed"); createSeedFile(path, 300);
  await rotateSeedFile(path, 305);
  assert.deepEqual(await rotateSeedFile(path, 305), { from: 305, to: 305 });
  await assert.rejects(rotateSeedFile(path, 304), /refusing to move backwards/);
  const bytes = readFileSync(path); bytes[10] ^= 1; writeFileSync(path, bytes);
  await assert.rejects(rotateSeedFile(path, 306), /checksum mismatch/);
  assert.throws(() => decodeSeedFile(encodeSeedFile(1, new Uint8Array(32)).subarray(0, 71)), /malformed/);
}));
