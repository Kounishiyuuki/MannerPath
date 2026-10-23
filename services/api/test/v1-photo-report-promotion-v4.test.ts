// v1.0 P8 follow-up: the photo-backed single-report listing (`communityReported`) through the CURRENT promotion format,
// v4, on top of an already published corpus. SYNTHETIC only (local SQLite, memory photo store); no staging or production.
//
// Proves on the existing pipeline, without relaxing any gate:
//  - one photo-backed report is added as a new community spot while every published spot keeps its ID, row and tile entry;
//  - duplicates: before queueing the report is moderated `duplicate`; after queueing it is `discarded`; both keep their
//    moderation record (state, decider, reason, time);
//  - promotion v4 carries the corpus plus the community spot to a fresh GREEN, with the same IDs and tile entries;
//  - no photo, submitter, install, note or report-store data reaches the artifact, DATA_DB, tiles or the v4 bundle.
// Issue #124 (community source blocked, terms draft) is simulated as approved INSIDE THIS TEST ONLY.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { isoSeconds } from "../src/db.ts";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { importCommunityArtifact } from "../src/pipeline/community-artifact.ts";
import { applyCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import type { PromotionRegistry } from "../src/pipeline/promotion.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { attachEvidencePhoto, moderateEvidencePhoto } from "../src/reports/photos.ts";
import { MemoryEvidencePhotoStorage } from "../src/reports/photo-storage.ts";
import { exportReview, listNewSpotCandidates, proposeNewSpotReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS, reviewedTerms } from "../src/reports/terms.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { applyPromotionV4 } from "../scripts/promotion-v4-apply.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1, migratedSqlite, reportsD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

type Row = Record<string, any>;
const TERMS = CURRENT_REPORT_TERMS.version;
const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
const HERE = { latitude: 35.60001, longitude: 139.60001 };
const NEAR = { latitude: 35.60004, longitude: 139.60003 };
const NOTE = "v4昇格テスト非公開メモ PRV-5531";
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const EXIF_TEXT = "GPSLatitude=35.60001;Device=PRIVATE-PHONE";
const CLAIM = { spotType: "ashtray", hostType: "convenienceStore", environment: "outdoor", accessType: "public" };
const HASHES = ["0123456789abcdef", "fedcba9876543210", "0f1e2d3c4b5a6978"].map((h) => h.repeat(4));

// ---- TEST ONLY simulation of the future #124 approval; production stays blocked / draft ---------------------------
const SIM = { attributionText: "TEST ONLY simulated community attribution", licenseName: "TEST ONLY simulated report terms",
  licenseUrl: "https://example.invalid/report-terms" };
const SIMULATED_REGISTRY: PromotionRegistry = {
  source: (id) => id === COMMUNITY_SOURCE_ID ? { ...COMMUNITY_REGISTRY, publicationStatus: "approved", ...SIM } : reviewedSource(id),
  terms: (v) => ({ ...reviewedTerms(v), publicationRights: "granted" }),
};
const simulateRightsGranted = (db: SqliteD1) => {
  db.raw.prepare("UPDATE sources SET publication_status = 'approved', attribution_text = ?, license_name = ?, license_url = ? WHERE source_id = ?")
    .run(SIM.attributionText, SIM.licenseName, SIM.licenseUrl, COMMUNITY_SOURCE_ID);
  db.raw.prepare("UPDATE report_terms_versions SET publication_rights = 'granted' WHERE terms_version = ?").run(TERMS);
};

const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

function phoneJpeg(seed: number): Uint8Array {
  const plain = new Uint8Array(jpeg.encode({ width: 4, height: 3, data: new Uint8Array(48).map((_, i) => (i % 4 === 3 ? 255 : (seed + i) & 255)) }, 90).data);
  const exif = new Uint8Array(112);
  exif.set([69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  exif.set(new TextEncoder().encode(EXIF_TEXT), 32);
  const segment = new Uint8Array([255, 225, (exif.length + 2) >> 8, (exif.length + 2) & 255, ...exif]);
  return new Uint8Array([...plain.subarray(0, 2), ...segment, ...plain.subarray(2)]);
}

/** A received new-place report with one sanitized photo stored through the real attach path. */
async function reportWithPhoto(reports: SqliteD1, storage: MemoryEvidencePhotoStorage, hash: string, at: typeof HERE, seed: number) {
  const { reportId } = await createReport(reports, { schemaVersion: 1, type: "missing", proposedLocation: at, installId: INSTALL, note: NOTE,
    acceptedTermsVersion: TERMS, claim: CLAIM } as any, { now: RECEIVED, attestationStatus: "verified", submitterHash: hash });
  const { photoId } = await attachEvidencePhoto(reports, storage, { reportId, submitterHash: hash, idempotencyKey: crypto.randomUUID(),
    acceptedTermsVersion: TERMS, bytes: phoneJpeg(seed), mediaType: "image/jpeg" }, { now: RECEIVED, enabled: true, photoTermsCovered: (v) => v === TERMS });
  return { reportId, photoId };
}

/** Each published spot's tile entry, keyed by spot ID, exactly as a v1 client receives it. */
function tileEntries(db: SqliteD1 | { raw: any }): Map<string, string> {
  const entries = new Map<string, string>();
  for (const tile of v1TileRows(db)) for (const spot of JSON.parse(tile.body_json).spots as Row[]) entries.set(spot.id, JSON.stringify(spot));
  return entries;
}
const spotRows = (db: SqliteD1 | { raw: any }) => new Map((db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all() as Row[]).map((r) => [r.spot_id as string, JSON.stringify(r)]));

async function bundleText(directory: string): Promise<string> {
  const files = await readdir(directory);
  return (await Promise.all(files.map((f) => readFile(join(directory, f), "utf8")))).join("\n");
}

test("a photo-backed single report joins a published corpus as communityReported and promotes through v4 without touching existing spots", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "photo-report-v4-"));
  const data = new SqliteD1(), reports = reportsD1(), storage = new MemoryEvidencePhotoStorage();
  const baselineGreen = migratedSqlite(), green = migratedSqlite();
  t.after(async () => { data.raw.close(); reports.raw.close(); baselineGreen.close(); green.close(); await rm(root, { recursive: true, force: true }); });

  // ---- the published corpus before any community spot -------------------------------------------------------
  await importAllReviewedSources(data, isoSeconds(RECEIVED));
  await publishTiles(data, { now: isoSeconds(RECEIVED) });
  const beforeRows = spotRows(data), beforeTiles = tileEntries(data);
  assert.ok(beforeTiles.size > 100, "a real published corpus");
  const baseline = await exportPromotionV4(data.raw, join(root, "baseline"), { chunkBytes: 90_000 });
  assert.equal((await applyPromotionV4(baselineGreen, join(root, "baseline"), baseline.wholeBundleSha256)).status, "completed");

  // ---- intake and moderation (REPORTS_DB) ---------------------------------------------------------------------
  const main = await reportWithPhoto(reports, storage, HASHES[0], HERE, 10);
  const early = await reportWithPhoto(reports, storage, HASHES[1], NEAR, 60);   // duplicate seen before queueing
  const late = await reportWithPhoto(reports, storage, HASHES[2], NEAR, 110);   // duplicate seen after queueing
  for (const { bytes } of storage.objects.values()) for (const m of ["Exif", "GPS", "PRIVATE-PHONE"]) assert.equal(Buffer.from(bytes).includes(Buffer.from(m)), false);
  for (const r of [main, late]) {
    await recordModerationDecision(reports, r.reportId, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
    await setReconciliationState(reports, r.reportId, "queued", RECEIVED);
  }
  // Before queueing: moderated `duplicate`.
  await recordModerationDecision(reports, early.reportId, { state: "duplicate", decidedBy: "reviewer-1", reason: "duplicateOfExistingReport", now: RECEIVED });
  // After queueing: `duplicate` is refused by the database, so the report is discarded from reconciliation instead.
  await assert.rejects(recordModerationDecision(reports, late.reportId, { state: "duplicate", decidedBy: "reviewer-2", reason: "duplicateOfExistingReport", now: APPLY }),
    /reconciliation_state = 'notQueued' OR state = 'accepted'/);
  const [group] = await listNewSpotCandidates(reports, { withinMetres: 50, now: APPLY });
  assert.deepEqual([...group.reportIds].sort(), [main.reportId, late.reportId].sort(), "the candidate view shows the queued duplicate");
  await setReconciliationState(reports, late.reportId, "discarded", APPLY);
  // Both duplicates keep their moderation record; neither can back a review.
  const record = (id: string) => one(reports, "SELECT state, reconciliation_state, decided_by, decision_reason, decided_at FROM report_moderation WHERE report_id = ?", id);
  assert.deepEqual(record(early.reportId), { state: "duplicate", reconciliation_state: "notQueued", decided_by: "reviewer-1", decision_reason: "duplicateOfExistingReport", decided_at: isoSeconds(RECEIVED) });
  assert.deepEqual(record(late.reportId), { state: "accepted", reconciliation_state: "discarded", decided_by: "reviewer-1", decision_reason: "confirmed", decided_at: isoSeconds(RECEIVED) });
  for (const d of [early, late]) {
    await moderateEvidencePhoto(reports, d.photoId, "approved", { now: APPLY, decidedBy: "photo-reviewer", reason: "usableEvidence" });
    await assert.rejects(proposeNewSpotReview(reports, { reportIds: [d.reportId], locationReportId: d.reportId, decidedBy: "r", now: APPLY, tier: "communityReported" }),
      /not accepted|not queued/);
  }
  // The photo gate holds the main report until its photo is approved.
  await assert.rejects(proposeNewSpotReview(reports, { reportIds: [main.reportId], locationReportId: main.reportId, decidedBy: "r", now: APPLY, tier: "communityReported" }), /photos: pending/);
  await moderateEvidencePhoto(reports, main.photoId, "approved", { now: APPLY, decidedBy: "photo-reviewer", reason: "usableEvidence" });
  const reviewId = await proposeNewSpotReview(reports, { reportIds: [main.reportId], locationReportId: main.reportId, decidedBy: "reviewer-1", now: APPLY, tier: "communityReported" });
  const { artifact } = await exportReview(reports, reviewId, { now: APPLY });

  const storageKeys = (reports.raw.prepare("SELECT storage_key FROM community_evidence_photos").all() as Row[]).map((r) => r.storage_key as string);
  const PRIVATE = [NOTE, INSTALL, EXIF_TEXT, "PRIVATE-PHONE", ...HASHES, ...storageKeys, "private/evidence",
    main.photoId, early.photoId, late.photoId, early.reportId, late.reportId];
  const artifactText = new TextDecoder().decode(artifact.bytes);
  for (const needle of [...PRIVATE, "photo"]) assert.equal(artifactText.includes(needle), false, `artifact carries ${needle}`);

  // ---- DATA_DB: import, apply, publish ------------------------------------------------------------------------
  const imported = await importCommunityArtifact(data, artifact.bytes, { now: APPLY });
  assert.equal(imported.status, "imported", JSON.stringify(imported));
  const { spotId } = await applyCommunityApplication(data, reviewId, { now: APPLY, newSpotId: sequentialSpotIds("P") }) as { spotId: string };
  assert.equal(beforeRows.has(spotId), false, "a new ID, never a reused one");
  // Still blocked by #124: canonical, not published, and the published corpus is byte-for-byte the same.
  await publishTiles(data, { now: isoSeconds(APPLY) });
  assert.equal(tileEntries(data).has(spotId), false);
  assert.deepEqual(tileEntries(data), beforeTiles);
  // TEST ONLY: simulated #124 approval.
  simulateRightsGranted(data);
  await publishTiles(data, { now: isoSeconds(APPLY) });
  const afterTiles = tileEntries(data), afterRows = spotRows(data);
  assert.equal(JSON.parse(afterTiles.get(spotId)!).evidenceQuality, "communityReported");
  // Every previously published spot keeps its ID, canonical row and tile entry; the only addition is the new spot.
  assert.deepEqual([...afterTiles.keys()].filter((id) => id !== spotId).sort(), [...beforeTiles.keys()].sort());
  for (const [id, entry] of beforeTiles) assert.equal(afterTiles.get(id), entry, `tile entry of ${id} changed`);
  for (const [id, row] of beforeRows) assert.equal(afterRows.get(id), row, `spot row ${id} changed`);
  assert.equal(afterRows.size, beforeRows.size + 1);
  const tables = (data.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) => r.name as string);
  assert.equal(tables.some((n) => /photo/.test(n)), false);
  const dump = JSON.stringify(tables.flatMap((n) => data.raw.prepare(`SELECT * FROM "${n}"`).all()));
  for (const needle of PRIVATE) assert.equal(dump.includes(needle), false, `DATA_DB carries ${needle}`);

  // ---- promotion v4 -----------------------------------------------------------------------------------------
  // The reviewed registry in code still says blocked/pending: v4 refuses to carry the now-published community spot.
  await assert.rejects(exportPromotionV4(data.raw, join(root, "refused"), { chunkBytes: 90_000 }));
  const manifest = await exportPromotionV4(data.raw, join(root, "bundle"), { chunkBytes: 90_000, registry: SIMULATED_REGISTRY });
  assert.ok(manifest.sources.some((s) => s.sourceId === COMMUNITY_SOURCE_ID), "the community release is declared");
  const bundle = await bundleText(join(root, "bundle"));
  for (const needle of [...PRIVATE, "community_evidence_photos", "submitter_hash", "INSERT INTO reports", "report_moderation"]) {
    assert.equal(bundle.includes(needle), false, `v4 bundle carries ${needle}`);
  }
  // Existing design (same as v3): the community release and source record name the review and evidence report IDs as provenance.
  // They are opaque IDs, only on those canonical rows, never in a tile or the spot detail.
  const lines = bundle.split("\n").filter((l) => l.includes(main.reportId) || l.includes(reviewId));
  assert.ok(lines.length > 0 && lines.every((l) => l.startsWith("INSERT INTO source_records ") || l.startsWith("INSERT INTO source_releases ")),
    lines.map((l) => l.slice(0, 60)).join(" | "));
  for (const tile of v1TileRows(data)) for (const id of [main.reportId, reviewId]) assert.equal(tile.body_json.includes(id), false, `tile names ${id}`);
  assert.equal((await applyPromotionV4(green, join(root, "bundle"), manifest.wholeBundleSha256)).status, "completed");
  const target = { raw: green };
  const greenTiles = tileEntries(target);
  assert.deepEqual(greenTiles, afterTiles, "GREEN serves exactly the source's tile entries");
  // Against the GREEN promoted before the report: same IDs and entries, plus one communityReported spot.
  const baselineTiles = tileEntries({ raw: baselineGreen });
  for (const [id, entry] of baselineTiles) assert.equal(greenTiles.get(id), entry, `promoted entry of ${id} changed`);
  assert.deepEqual([...greenTiles.keys()].filter((id) => !baselineTiles.has(id)), [spotId]);
  // v4 carries the published corpus: every promoted row equals its source row; a source spot absent from GREEN must be
  // one that is not published (e.g. a blocked source), never a published one.
  const greenRows = spotRows(target);
  for (const [id, row] of greenRows) assert.equal(row, afterRows.get(id), `promoted spot row ${id} differs`);
  const notCarried = [...afterRows.keys()].filter((id) => !greenRows.has(id));
  for (const id of notCarried) assert.equal(afterTiles.has(id), false, `published ${id} was not promoted`);
  const baselineRows = spotRows({ raw: baselineGreen });
  assert.deepEqual(notCarried.filter((id) => baselineRows.has(id)), [], "the report did not change which spots promote");
  for (const [id, row] of baselineRows) assert.equal(greenRows.get(id), row, `promoted spot row ${id} changed`);
});
