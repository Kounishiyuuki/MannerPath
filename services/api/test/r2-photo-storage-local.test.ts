import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { getPlatformProxy as platformProxy } from "wrangler";
import { encode } from "fast-png";
import { createReport } from "../src/reports/create.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { R2EvidencePhotoStorage } from "../src/reports/r2-photo-storage.ts";
import { attachEvidencePhoto, cleanupEvidencePhotos } from "../src/reports/photos.ts";
import { reportsD1 } from "./support/sqlite-d1.ts";

test("local workerd R2: conditional create, overwrite fence and persisted restart (no remote bindings)", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "mannerpath-photo-r2-test-"));
  // Wrangler's default registry and logs are global user state. Keep this local-only test isolated.
  const previousRegistry = process.env.WRANGLER_REGISTRY_PATH;
  const previousLog = process.env.WRANGLER_LOG_PATH;
  process.env.WRANGLER_REGISTRY_PATH = join(directory, "registry");
  process.env.WRANGLER_LOG_PATH = join(directory, "wrangler.log");
  const configPath = join(directory, "wrangler.json");
  const options = { configPath, persist: { path: join(directory, "state") }, remoteBindings: false, envFiles: [] };
  let proxy: Awaited<ReturnType<typeof platformProxy<{ PRIVATE_PHOTOS: R2Bucket }>>> | undefined;
  try {
    // Import after setting paths: Wrangler resolves its log destination during module initialization.
    const { getPlatformProxy } = await import("wrangler");
    await writeFile(configPath, JSON.stringify({ name: "photo-r2-local-test", compatibility_date: "2026-09-01",
      r2_buckets: [{ binding: "PRIVATE_PHOTOS", bucket_name: "photo-local-test" }] }));
    proxy = await getPlatformProxy<{ PRIVATE_PHOTOS: R2Bucket }>(options);
    const db = reportsD1(), now = new Date("2026-10-01T00:00:00Z"), submitterHash = "a".repeat(64);
    const report = await createReport(db, { schemaVersion: 1, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J",
      installId: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version }, { now, attestationStatus: "verified", submitterHash });
    const storage = new R2EvidencePhotoStorage(proxy.env.PRIVATE_PHOTOS, db, () => now);
    const input = { reportId: report.reportId, submitterHash, idempotencyKey: crypto.randomUUID(),
      acceptedTermsVersion: CURRENT_REPORT_TERMS.version, mediaType: "image/png",
      bytes: encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([1, 2, 3, 255]) }) };
    const opts = { now, enabled: true, photoTermsCovered: () => true };
    const first = await attachEvidencePhoto(db, storage, input, opts);
    assert.deepEqual(await attachEvidencePhoto(db, storage, input, opts), first);
    const key = db.raw.prepare("SELECT storage_key FROM community_evidence_photos").get()!.storage_key as string;
    const original = await proxy.env.PRIVATE_PHOTOS.get(key);
    assert.equal(original?.httpMetadata?.contentType, "image/png");
    const bytes = new Uint8Array(await original!.arrayBuffer());
    // Verify the real Workers binding's failed condition returns null, rather than overwriting.
    assert.equal(await proxy.env.PRIVATE_PHOTOS.put(key, bytes, { onlyIf: new Headers({ "If-None-Match": "*" }) }), null);
    db.raw.prepare("DELETE FROM reports WHERE report_id=?").run(report.reportId);
    await cleanupEvidencePhotos(db, storage, { now });
    const marker = await proxy.env.PRIVATE_PHOTOS.head(key);
    assert.equal(marker?.size, 0);
    assert.deepEqual(marker?.customMetadata, { kind: "deleted-photo.v1" });
    await proxy.dispose(); proxy = undefined;
    proxy = await getPlatformProxy<{ PRIVATE_PHOTOS: R2Bucket }>(options);
    assert.equal((await proxy.env.PRIVATE_PHOTOS.head(key))?.size, 0);
    assert.equal(await proxy.env.PRIVATE_PHOTOS.put(key, bytes, { onlyIf: new Headers({ "If-None-Match": "*" }) }), null);
  } finally {
    try { await proxy?.dispose(); }
    finally {
      if (previousRegistry === undefined) delete process.env.WRANGLER_REGISTRY_PATH;
      else process.env.WRANGLER_REGISTRY_PATH = previousRegistry;
      if (previousLog === undefined) delete process.env.WRANGLER_LOG_PATH;
      else process.env.WRANGLER_LOG_PATH = previousLog;
      await rm(directory, { recursive: true, force: true }); // Only this test's mkdtemp directory.
    }
  }
});
