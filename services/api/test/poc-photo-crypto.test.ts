// PoC: crypto-erasure envelope (src/poc/binary-photo/photo-crypto.ts). The residue Cloudflare may keep is ciphertext;
// destroying the operator-held epoch private key makes every copy unreadable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EPOCH_DAYS, epochOf, epochStart, keyDestroyBy, openPhoto, sealPhoto, sealedEpoch } from "../src/poc/binary-photo/photo-crypto.ts";
import { D1PhotoStore, PHOTOS_DB_SCHEMA } from "../src/poc/binary-photo/d1-photo-store.ts";
import { sha256Hex } from "../src/db.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
async function epochKeys() {
  const pair = await crypto.subtle.generateKey(P256, true, ["deriveBits"]) as CryptoKeyPair;
  return { pair, publicRaw: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer) };
}
const plain = new TextEncoder().encode("SENTINEL-PHOTO-BYTES-".repeat(2000));

test("round trip with the epoch private key; wrong key, other storage key, other epoch and tampering all fail", async () => {
  const e = await epochKeys(), other = await epochKeys();
  const sealed = await sealPhoto(plain, "private/evidence/a.jpg", 1500, e.publicRaw);
  assert.equal(sealedEpoch(sealed), 1500);
  assert.deepEqual(await openPhoto(sealed, "private/evidence/a.jpg", e.pair.privateKey), plain);
  await assert.rejects(openPhoto(sealed, "private/evidence/a.jpg", other.pair.privateKey));
  await assert.rejects(openPhoto(sealed, "private/evidence/b.jpg", e.pair.privateKey));
  const epochSwapped = sealed.slice(); epochSwapped[5] ^= 1;
  await assert.rejects(openPhoto(epochSwapped, "private/evidence/a.jpg", e.pair.privateKey));
  const tampered = sealed.slice(); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(openPhoto(tampered, "private/evidence/a.jpg", e.pair.privateKey));
  assert.notDeepEqual((await sealPhoto(plain, "k", 1, e.publicRaw)).subarray(6), (await sealPhoto(plain, "k", 1, e.publicRaw)).subarray(6)); // fresh ephemeral key + IV
});

test("what the database file keeps after the fence is ciphertext only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "photos-db-")), path = join(dir, "photos.db");
  try {
    const e = await epochKeys();
    const raw = new DatabaseSync(path); raw.exec("PRAGMA journal_mode = DELETE;"); raw.exec(PHOTOS_DB_SCHEMA);
    const store = new D1PhotoStore(new SqliteD1(raw));
    const sealed = await sealPhoto(plain, "k", 7, e.publicRaw);
    await store.put("k", sealed, { mediaType: "image/jpeg", contentSha256: await sha256Hex(sealed), byteLength: sealed.length, width: 1, height: 1 });
    await store.delete("k");
    raw.close();
    const file = Buffer.from(readFileSync(path)).toString("latin1");
    assert.equal(file.includes("SENTINEL-PHOTO-BYTES-"), false, "plaintext must never reach the store");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("epochs: every photo's key is destroyed within 90 days of storage", () => {
  assert.equal(EPOCH_DAYS, 14);
  const stored = new Date("2026-11-20T12:00:00Z"), epoch = epochOf(stored);
  assert.ok(epochStart(epoch) <= stored && stored < epochStart(epoch + 1));
  const lifetimeDays = (keyDestroyBy(epoch).getTime() - stored.getTime()) / 86_400_000;
  assert.ok(lifetimeDays <= 90 && lifetimeDays > 90 - EPOCH_DAYS, String(lifetimeDays));
});
