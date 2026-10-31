// PoC: crypto-erasure with per-deadline-day keys (src/poc/binary-photo/photo-crypto.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DayKeyChain, keyDayFor, keyDestroyAt, openPhoto, sealPhoto, sealedDay } from "../src/poc/binary-photo/photo-crypto.ts";
import { D1PhotoStore, PHOTOS_DB_SCHEMA } from "../src/poc/binary-photo/d1-photo-store.ts";
import { sha256Hex } from "../src/db.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const DAY = 86_400_000;
const plain = new TextEncoder().encode("SENTINEL-PHOTO-BYTES-".repeat(2000));

test("every photo's key is destroyed in (stored + 89 d, stored + 90 d], for any time of day", () => {
  for (const iso of ["2026-11-20T00:00:00Z", "2026-11-20T00:00:01Z", "2026-11-20T12:34:56Z", "2026-11-20T23:59:59.999Z"]) {
    const t = new Date(iso), lifetime = keyDestroyAt(keyDayFor(t)).getTime() - t.getTime();
    assert.ok(lifetime <= 90 * DAY && lifetime > 89 * DAY, `${iso}: ${lifetime / DAY} days`);
  }
});

test("round trip; wrong day key, other storage key, swapped day and tampering are refused", async () => {
  const chain = DayKeyChain.generate(20_000);
  const sealed = await sealPhoto(plain, "private/evidence/a.jpg", 20_001, await chain.publicKeyRaw(20_001));
  assert.equal(sealedDay(sealed), 20_001);
  assert.deepEqual(await openPhoto(sealed, "private/evidence/a.jpg", await chain.privateKey(20_001)), plain);
  await assert.rejects(openPhoto(sealed, "private/evidence/a.jpg", await chain.privateKey(20_002)));
  await assert.rejects(openPhoto(sealed, "private/evidence/b.jpg", await chain.privateKey(20_001)));
  const swapped = sealed.slice(); swapped[7] ^= 1;
  await assert.rejects(openPhoto(swapped, "private/evidence/a.jpg", await chain.privateKey(20_001)));
  const tampered = sealed.slice(); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(openPhoto(tampered, "private/evidence/a.jpg", await chain.privateKey(20_001)));
});

test("destroying one day's key leaves photos of later days under review readable", async () => {
  const start = new Date("2026-11-20T09:00:00Z");
  const chain = DayKeyChain.generate(keyDayFor(start));
  const photos: { day: number; sealed: Uint8Array }[] = [];
  for (let i = 0; i < 5; i++) { // one photo per day for five days
    const day = keyDayFor(new Date(start.getTime() + i * DAY));
    photos.push({ day, sealed: await sealPhoto(plain, `k${i}`, day, await chain.publicKeyRaw(day)) });
  }
  assert.equal(new Set(photos.map((p) => p.day)).size, 5);
  const advanced = await chain.advanceTo(photos[1].day); // day 0's key destroyed
  await assert.rejects(advanced.privateKey(photos[0].day), /destroyed/);
  await assert.rejects(chain.privateKey(photos[1].day), /seed is destroyed/); // the old chain object is unusable
  for (let i = 1; i < 5; i++) assert.deepEqual(await openPhoto(photos[i].sealed, `k${i}`, await advanced.privateKey(photos[i].day)), plain);
  // Persisting and reloading the advanced seed gives the same keys; the old seed is not recoverable from it.
  const reloaded = DayKeyChain.fromSeed(advanced.day, advanced.exportSeed());
  assert.deepEqual(await openPhoto(photos[4].sealed, "k4", await reloaded.privateKey(photos[4].day)), plain);
  await assert.rejects(reloaded.privateKey(photos[0].day), /destroyed/);
});

test("what the database file keeps after the fence is ciphertext only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "photos-db-")), path = join(dir, "photos.db");
  try {
    const chain = DayKeyChain.generate(30_000);
    const raw = new DatabaseSync(path); raw.exec("PRAGMA journal_mode = DELETE;"); raw.exec(PHOTOS_DB_SCHEMA);
    const store = new D1PhotoStore(new SqliteD1(raw));
    const sealed = await sealPhoto(plain, "k", 30_000, await chain.publicKeyRaw(30_000));
    await store.put("k", sealed, { mediaType: "image/jpeg", contentSha256: await sha256Hex(sealed), byteLength: sealed.length, width: 1, height: 1 });
    await store.delete("k");
    raw.close();
    assert.equal(Buffer.from(readFileSync(path)).toString("latin1").includes("SENTINEL-PHOTO-BYTES-"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
