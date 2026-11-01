// PoC tests for src/poc/binary-photo (NOT mounted by createApp). Harness: test/support/binary-photo-harness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../src/db.ts";
import { minimizeAfter } from "../src/reports/create.ts";
import { moderateEvidencePhoto, photoEvidenceStrength } from "../src/reports/photos.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { D1PhotoStore, PhotoStoreError } from "../src/poc/binary-photo/d1-photo-store.ts";
import { renderForOperator } from "../src/poc/binary-photo/display.ts";
import { PHOTO_V3_HEADER_MAX_BYTES } from "../src/poc/binary-photo/protocol.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { PHOTOS_DB_SCHEMA } from "../src/poc/binary-photo/d1-photo-store.ts";
import { harness, photo, photosD1 } from "./support/binary-photo-harness.ts";

test("v3 binary upload stores the exact JPEG privately in PHOTOS_DB and is idempotent per key", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device), image = photo();
  const key = crypto.randomUUID();
  const first = await h.send(reportId, await h.body(device, reportId, image, { idempotencyKey: key }));
  assert.equal(first.status, 201); assert.equal(first.json.state, "pending");
  const row = h.reports.raw.prepare("SELECT media_type, byte_length, lifecycle, storage_key FROM community_evidence_photos").get() as Record<string, unknown>;
  assert.deepEqual([row.media_type, row.byte_length, row.lifecycle], ["image/jpeg", image.length, "ready"]);
  const stored = h.photos.raw.prepare("SELECT bytes FROM photo_objects WHERE storage_key = ?").get(row.storage_key as string) as { bytes: Uint8Array };
  assert.deepEqual(new Uint8Array(stored.bytes), image);
  // A resend after a lost response: fresh challenge and assertion, same draft key, same image → same photo.
  const again = await h.send(reportId, await h.body(device, reportId, image, { idempotencyKey: key }));
  assert.equal(again.status, 201); assert.equal(again.json.photoId, first.json.photoId);
  assert.deepEqual(await h.store.usage(), { liveBytes: image.length, liveCount: 1, budgetBytes: 400_000_000 });
  // Same key, different image → conflict; nothing new stored.
  assert.equal((await h.send(reportId, await h.body(device, reportId, photo(320, 240, 2), { idempotencyKey: key }))).status, 409);
  assert.equal((await h.store.usage()).liveCount, 1);
});

test("replay, tampering and cross-domain assertions are refused", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device), image = photo();
  const signed = await h.body(device, reportId, image);
  assert.equal((await h.send(reportId, signed)).status, 201);
  const replay = await h.send(reportId, signed);
  assert.equal(replay.status, 403); // the challenge was burned by the first use
  const tampered = image.slice(); tampered[tampered.length - 10] ^= 1;
  const swapped = await h.send(reportId, await h.body(device, reportId, tampered, { claimed: image }));
  assert.deepEqual([swapped.status, swapped.json.detail], [400, "image: digest_mismatch"]);
  const shorter = await h.send(reportId, await h.body(device, reportId, image.subarray(0, image.length - 2), { claimed: image }));
  assert.deepEqual([shorter.status, shorter.json.detail], [400, "image: length_mismatch"]);
  const reportDomain = await h.send(reportId, await h.body(device, reportId, photo(320, 240, 3), { domain: "report" }));
  assert.deepEqual([reportDomain.status, reportDomain.json.reason], [403, "assertionInvalid"]);
  const other = await h.enrol();
  const foreign = await h.send(reportId, await h.body(other, reportId, photo(320, 240, 4)));
  assert.deepEqual([foreign.status, foreign.json.error], [403, "photoUnauthorized"]);
});

test("bounds and JPEG structure are enforced before anything is stored", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device), image = photo();
  assert.equal((await h.send(reportId, await h.body(device, reportId, image), "application/json")).status, 415);
  const exif = new Uint8Array([...image.subarray(0, 20), 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, ...image.subarray(20)]);
  const withExif = await h.send(reportId, await h.body(device, reportId, exif));
  assert.deepEqual([withExif.status, withExif.json.detail], [422, "image: forbiddenSegment"]);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  assert.equal((await h.send(reportId, await h.body(device, reportId, png))).status, 415);
  const bigHeader = new Uint8Array(4 + PHOTO_V3_HEADER_MAX_BYTES + 1 + 10); new DataView(bigHeader.buffer).setUint32(0, PHOTO_V3_HEADER_MAX_BYTES + 1);
  assert.deepEqual((await h.send(reportId, bigHeader)).json.detail, "frame: header_length");
  assert.equal((await h.send(reportId, new Uint8Array(1_600_000))).status, 413);
  assert.equal(h.reports.raw.prepare("SELECT count(*) n FROM community_evidence_photos").get()!.n, 0);
  assert.equal((await h.store.usage()).liveCount, 0);
});

test("three photos per report; the store budget pauses intake with 503 and keeps the reservation for cleanup", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device);
  for (let i = 0; i < 3; i++) assert.equal((await h.send(reportId, await h.body(device, reportId, photo(64, 48, 10 + i)))).status, 201);
  assert.equal((await h.send(reportId, await h.body(device, reportId, photo(64, 48, 20)))).json.error, "photoAttachmentLimit");
  const small = photo(64, 48, 30);
  const tight = await harness({ budget: small.length + 10 }), d2 = await tight.enrol(), r2 = await tight.newReport(d2);
  assert.equal((await tight.send(r2, await tight.body(d2, r2, small))).status, 201);
  const paused = await tight.send(r2, await tight.body(d2, r2, photo(64, 48, 31)));
  assert.deepEqual([paused.status, paused.json.error], [503, "photoIntakePaused"]);
  assert.equal(tight.reports.raw.prepare("SELECT count(*) n FROM community_evidence_photos WHERE lifecycle='uploading'").get()!.n, 1);
});

test("90-day retention fences the D1 object permanently and frees the budget; gates see no photo", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device), image = photo();
  const sent = await h.send(reportId, await h.body(device, reportId, image));
  const photoId = sent.json.photoId as string;
  assert.equal((await photoEvidenceStrength(h.reports, reportId, h.now)).approvedPhotos, 0); // pending never counts
  await moderateEvidencePhoto(h.reports, photoId, "approved", { now: h.now, decidedBy: "reviewer", reason: "usableEvidence" });
  assert.equal((await photoEvidenceStrength(h.reports, reportId, h.now)).approvedPhotos, 1);
  const key = (h.reports.raw.prepare("SELECT storage_key FROM community_evidence_photos").get() as { storage_key: string }).storage_key;
  await applyReportRetention(h.reports, { now: minimizeAfter(h.now), photoStorage: h.store });
  assert.equal((await photoEvidenceStrength(h.reports, reportId, minimizeAfter(h.now))).approvedPhotos, 0);
  const fenced = h.photos.raw.prepare("SELECT state, bytes FROM photo_objects WHERE storage_key = ?").get(key) as Record<string, unknown>;
  assert.deepEqual([fenced.state, fenced.bytes], ["deleted", null]);
  assert.deepEqual(await h.store.usage(), { liveBytes: 0, liveCount: 0, budgetBytes: 400_000_000 });
  await assert.rejects(h.store.put(key, image, { mediaType: "image/jpeg", contentSha256: await sha256Hex(image), byteLength: image.length, width: 1, height: 1 }),
    (e: unknown) => e instanceof PhotoStoreError && e.code === "permanentlyDeleted");
});

test("D1 store: fence before put, no resurrection, no row removal, create-only", async () => {
  const photos = photosD1(), store = new D1PhotoStore(photos), image = photo(), meta = { mediaType: "image/jpeg" as const, contentSha256: await sha256Hex(image), byteLength: image.length, width: 1, height: 1 };
  await store.delete("k1"); await store.delete("k1");
  await assert.rejects(store.put("k1", image, meta), (e: unknown) => e instanceof PhotoStoreError && e.code === "permanentlyDeleted");
  await store.put("k2", image, meta); await store.put("k2", image, meta);
  await assert.rejects(store.put("k2", photo(320, 240, 9), { ...meta, contentSha256: "0".repeat(64) }), (e: unknown) => e instanceof PhotoStoreError && e.code === "conflict");
  await store.delete("k2");
  assert.throws(() => photos.raw.prepare("UPDATE photo_objects SET state='live', bytes=x'00', content_sha256=?, byte_length=1, stored_at='t', deleted_at=NULL WHERE storage_key='k2'").run("0".repeat(64)), /permanently deleted/);
  assert.throws(() => photos.raw.prepare("DELETE FROM photo_objects WHERE storage_key='k2'").run(), /fences are permanent/);
  assert.equal(await store.getMetadata("k2"), null);
});

test("operator display re-encodes: the browser never receives the uploaded bytes", async () => {
  const image = photo(), shown = await renderForOperator(image);
  assert.equal(shown.mediaType, "image/png");
  assert.deepEqual([...shown.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.notDeepEqual(shown.bytes, image);
  const exif = new Uint8Array([...image.subarray(0, 20), 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, ...image.subarray(20)]);
  await assert.rejects(renderForOperator(exif), /forbiddenSegment/);
});

test("known limitation: after the fence SQLite keeps the photo bytes in free pages (secure_delete is not available on D1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "photos-db-")), path = join(dir, "photos.db");
  try {
    const raw = new DatabaseSync(path); raw.exec("PRAGMA journal_mode = DELETE;"); raw.exec(PHOTOS_DB_SCHEMA);
    const store = new D1PhotoStore(new SqliteD1(raw));
    const sentinel = new TextEncoder().encode("SENTINEL-PHOTO-BYTES-".repeat(2000));
    await store.put("k", sentinel, { mediaType: "image/jpeg", contentSha256: await sha256Hex(sentinel), byteLength: sentinel.length, width: 1, height: 1 });
    await store.delete("k");
    assert.equal(await store.read("k", 1_200_000), null); // unreachable through the adapter and SQL
    raw.close();
    // …but physically present until the pages are reused. If this ever turns false, update V1_FREE_TIER_PROBE_RUNBOOK.md.
    assert.equal(Buffer.from(readFileSync(path)).toString("latin1").includes("SENTINEL-PHOTO-BYTES-"), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("provisional limits: 1.2 MB per photo at the route", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device);
  const atCap = new Uint8Array(1_200_001); atCap[0] = 0xff; atCap[1] = 0xd8;
  const over = await h.send(reportId, await h.body(device, reportId, atCap));
  assert.deepEqual([over.status, over.json.detail], [400, "frame: image_length"]);
});

test("the store's hex binding writes every byte value as a BLOB of the declared length", async () => {
  const d1 = photosD1(), store = new D1PhotoStore(d1 as never);
  const bytes = Uint8Array.from({ length: 4096 }, (_, i) => i % 256);
  await store.put("k/all-bytes.jpg", bytes, { mediaType: "image/jpeg", contentSha256: await sha256Hex(bytes), byteLength: bytes.length, width: 1, height: 1 });
  const row = d1.raw.prepare("SELECT typeof(bytes) AS t, bytes FROM photo_objects WHERE storage_key = 'k/all-bytes.jpg'").get() as { t: string; bytes: Uint8Array };
  assert.equal(row.t, "blob");
  assert.deepEqual(new Uint8Array(row.bytes), bytes);
});
