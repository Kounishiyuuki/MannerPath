// P0 follow-up to the new-spot photo gate (REPORTS_DB migration 0010). R2 erasure of a photo may start
// PHOTO_ERASURE_LEAD_MS (24 h) before its delete_after, and a key queued in community_photo_deletions is on its way out:
// neither is evidence an operator can still view, so neither may open the gate — in code (newSpotPhotoGate, propose,
// export) or in REPORTS_DB when a review is exported by direct SQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { cleanupEvidencePhotos, newSpotPhotoGate, photoEvidenceStrength } from "../src/reports/photos.ts";
import { MemoryEvidencePhotoStorage, PHOTO_ERASURE_LEAD_MS } from "../src/reports/photo-storage.ts";
import { exportReview, proposeEffectReview, proposeNewSpotReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { approveEvidencePhoto } from "./support/evidence-photo.ts";
import { type SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";

const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
// The instant R2 erasure may begin for every photo of a report received at RECEIVED.
const ERASE = new Date(minimizeAfter(RECEIVED).getTime() - PHOTO_ERASURE_LEAD_MS);
const at = (ms: number) => new Date(ERASE.getTime() + ms);
const PIN = { latitude: 35.71201, longitude: 139.77701 };
const NEAR = { latitude: 35.71205, longitude: 139.77706 };
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
let hashes = 0;

async function queued(db: SqliteD1, type: "missing" | "moved" = "missing", where = PIN): Promise<string> {
  const request = type === "missing"
    ? { schemaVersion: 1, type, proposedLocation: where, installId: INSTALL, acceptedTermsVersion: CURRENT_REPORT_TERMS.version }
    : { schemaVersion: 1, type, spotId: SPOT, proposedLocation: where, installId: INSTALL, acceptedTermsVersion: CURRENT_REPORT_TERMS.version };
  const { reportId } = await createReport(db, request as any, { now: RECEIVED, attestationStatus: "verified", submitterHash: (++hashes).toString(16).padStart(64, "a") });
  await recordModerationDecision(db, reportId, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
  await setReconciliationState(db, reportId, "queued", RECEIVED);
  return reportId;
}
/** Two independent new-spot reports, each with one approved photo, and a proposed review over them. */
async function proposed(db: SqliteD1, now = APPLY) {
  const a = await queued(db, "missing", PIN), b = await queued(db, "missing", NEAR);
  const photo = (await approveEvidencePhoto(db, a, RECEIVED))!;
  await approveEvidencePhoto(db, b, RECEIVED);
  const reviewId = await proposeNewSpotReview(db, { reportIds: [a, b], locationReportId: a, decidedBy: "reviewer-1", now });
  return { a, b, photo, reviewId };
}
const storageKey = (db: SqliteD1, photo: string) =>
  db.raw.prepare("SELECT storage_key AS k FROM community_evidence_photos WHERE photo_id = ?").get(photo)?.k as string;
const queueDeletion = (db: SqliteD1, photo: string) =>
  db.raw.prepare("INSERT INTO community_photo_deletions VALUES (?, ?)").run(storageKey(db, photo), "2026-09-25T02:00:00Z");
const sqlExport = (db: SqliteD1, reviewId: string, exportedAt: string) =>
  db.raw.prepare("UPDATE report_reviews SET state = 'exported', artifact_sha256 = ?, exported_at = ? WHERE review_id = ?")
    .run("0".repeat(64), exportedAt, reviewId);
const NO_VIEWABLE = /no viewable approved evidence photo/;

test("the gate closes when R2 erasure may begin: just before, exactly at and just after the boundary", async () => {
  const db = reportsD1();
  const { a, reviewId } = await proposed(db);
  assert.equal(await newSpotPhotoGate(db, a, at(-1000)), "approved");
  assert.equal((await photoEvidenceStrength(db, a, at(-1000))).approvedPhotos, 1);
  for (const ms of [0, 1000]) {
    assert.equal(await newSpotPhotoGate(db, a, at(ms)), "expired", `+${ms}ms`);
    assert.equal((await photoEvidenceStrength(db, a, at(ms))).approvedPhotos, 0);
    await assert.rejects(exportReview(db, reviewId, { now: at(ms) }), /has no approved evidence photo \(photos: expired\)/);
  }
  // The report itself is still inside its deadline, so only the photo premise refuses.
  assert.ok(at(1000) < minimizeAfter(RECEIVED));
  assert.equal((await exportReview(db, reviewId, { now: at(-1000) })).status, "exported");
});

test("a direct SQL export at or after the erasure boundary is refused, whatever the timestamp spelling", async () => {
  for (const exportedAt of [ERASE.toISOString(), ERASE.toISOString().replace(".000Z", "Z"), ERASE.toISOString().replace("Z", "+00:00"),
    at(1000).toISOString().replace(".000Z", "Z"), "not-a-timestamp"]) {
    const db = reportsD1();
    const { reviewId } = await proposed(db);
    assert.throws(() => sqlExport(db, reviewId, exportedAt), NO_VIEWABLE, exportedAt);
    assert.equal(db.raw.prepare("SELECT state FROM report_reviews WHERE review_id = ?").get(reviewId)?.state, "proposed");
  }
  // One second earlier the same direct update passes this trigger (0009 and 0010 both satisfied).
  const db = reportsD1();
  const { reviewId } = await proposed(db);
  sqlExport(db, reviewId, at(-1000).toISOString().replace(".000Z", "Z"));
  assert.equal(db.raw.prepare("SELECT state FROM report_reviews WHERE review_id = ?").get(reviewId)?.state, "exported");
});

test("a photo queued for deletion is not evidence, even while its row still reads ready and approved", async () => {
  const db = reportsD1();
  const { a, photo, reviewId } = await proposed(db);
  queueDeletion(db, photo);
  assert.equal(db.raw.prepare("SELECT lifecycle || '/' || moderation_status AS s FROM community_evidence_photos WHERE photo_id = ?").get(photo)?.s, "ready/approved");
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "expired");
  await assert.rejects(exportReview(db, reviewId, { now: APPLY }), /has no approved evidence photo/);
  assert.throws(() => sqlExport(db, reviewId, "2026-09-25T03:00:00Z"), NO_VIEWABLE);
  // A fresh proposal over a report whose only photo is queued is refused too.
  const c = await queued(db, "missing", PIN), d = await queued(db, "missing", NEAR);
  queueDeletion(db, (await approveEvidencePhoto(db, c, RECEIVED))!);
  await approveEvidencePhoto(db, d, RECEIVED);
  await assert.rejects(proposeNewSpotReview(db, { reportIds: [c, d], locationReportId: c, decidedBy: "r", now: APPLY }),
    new RegExp(`report ${c} has no approved evidence photo \\(photos: expired\\)`));
});

test("delayed cleanup: a ready row past the boundary or a queued key whose R2 delete keeps failing never reopens the gate", async () => {
  const db = reportsD1(), storage = new MemoryEvidencePhotoStorage();
  const { a, reviewId } = await proposed(db);
  // Cleanup has not run yet: the row is still ready/approved, but the erasure window has started.
  assert.equal(await newSpotPhotoGate(db, a, at(60_000)), "expired");
  // Cleanup runs, removes the row, and the R2 delete keeps failing so the key stays queued.
  storage.delete = async () => { throw new Error("r2 down"); };
  await assert.rejects(cleanupEvidencePhotos(db, storage, { now: at(60_000) }), /photo deletion incomplete/);
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM community_evidence_photos WHERE report_id = ?").get(a)?.n, 0);
  assert.ok((db.raw.prepare("SELECT count(*) AS n FROM community_photo_deletions").get()?.n as number) >= 1);
  // This helper photo had no idempotency request, so the report now reads as photo-less; either way it is held.
  assert.equal(await newSpotPhotoGate(db, a, at(60_000)), "none");
  await assert.rejects(exportReview(db, reviewId, { now: at(60_000) }), /has no approved evidence photo/);
});

test("mixed photos: one viewable approved photo is enough, and losing it closes the gate", async () => {
  const db = reportsD1();
  const { a, photo, reviewId } = await proposed(db);
  const queuedOut = (await approveEvidencePhoto(db, a, RECEIVED))!;
  queueDeletion(db, queuedOut);
  await approveEvidencePhoto(db, a, RECEIVED, "rejected");
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "approved", "approved + queued + rejected");
  assert.equal((await photoEvidenceStrength(db, a, APPLY)).approvedPhotos, 1);
  queueDeletion(db, photo);
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "rejected", "queued + queued + rejected");
  assert.throws(() => sqlExport(db, reviewId, "2026-09-25T03:00:00Z"), NO_VIEWABLE);
  await assert.rejects(exportReview(db, reviewId, { now: APPLY }), /photos: rejected/);
});

test("a viewable approved pair still exports with no photo or submitter data in the artifact", async () => {
  const db = reportsD1();
  const { reviewId } = await proposed(db);
  const { artifact } = await exportReview(db, reviewId, { now: APPLY });
  const text = new TextDecoder().decode(artifact.bytes);
  assert.doesNotMatch(text, /photo|ph_test|storage|image|install/i);
  assert.doesNotMatch(text, new RegExp(INSTALL));
  for (const { h } of db.raw.prepare("SELECT submitter_hash AS h FROM reports").all() as { h: string }[]) assert.equal(text.includes(h), false);
});

test("existing-spot reports are unaffected by photo deletion state", async () => {
  const db = reportsD1();
  const x = await queued(db, "moved", PIN), y = await queued(db, "moved", NEAR);
  const { reviewId } = await proposeEffectReview(db, { reportIds: [x, y], decidedBy: "reviewer-1", now: at(1000) });
  assert.equal((await exportReview(db, reviewId, { now: at(1000) })).status, "exported");
});
