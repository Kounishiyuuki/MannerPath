// v1.0 new-spot photo publication gate (ADR-0016 "New-spot photo gate", REPORTS_DB migration 0009). A new-spot report is
// received first and its photos follow, so a report can exist without photos (the app closed, an upload failed). Such a
// report is held: it can be moderated and queued, but no new-spot review can be proposed or exported — so no evidence
// artifact, canonical row or tile can carry it — until one of its photos is ready, moderator-approved and inside its
// deadline. Approval is necessary, never sufficient, and existing-spot reports never need a photo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode } from "fast-png";
import { importCommunityArtifact } from "../src/pipeline/community-artifact.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { attachEvidencePhoto, cleanupEvidencePhotos, moderateEvidencePhoto, newSpotPhotoGate } from "../src/reports/photos.ts";
import { MemoryEvidencePhotoStorage } from "../src/reports/photo-storage.ts";
import { exportReview, listNewSpotCandidates, proposeEffectReview, proposeNewSpotReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { approveEvidencePhoto } from "./support/evidence-photo.ts";
import { SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";

const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
const PIN = { latitude: 35.71201, longitude: 139.77701 };
const NEAR = { latitude: 35.71205, longitude: 139.77706 };
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
let hashes = 0;
const nextHash = () => (++hashes).toString(16).padStart(64, "0");
const png = (seed: number) => encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([seed, 1, 1, 255]) });

/** A received, accepted and queued report: everything before the photo gate. */
async function queued(db: SqliteD1, type: "missing" | "moved" = "missing", at = PIN, hash = nextHash()): Promise<{ id: string; hash: string }> {
  const request = type === "missing"
    ? { schemaVersion: 1, type, proposedLocation: at, installId: INSTALL, acceptedTermsVersion: CURRENT_REPORT_TERMS.version }
    : { schemaVersion: 1, type, spotId: SPOT, proposedLocation: at, installId: INSTALL, acceptedTermsVersion: CURRENT_REPORT_TERMS.version };
  const { reportId } = await createReport(db, request as any, { now: RECEIVED, attestationStatus: "verified", submitterHash: hash });
  await recordModerationDecision(db, reportId, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
  await setReconciliationState(db, reportId, "queued", RECEIVED);
  return { id: reportId, hash };
}

async function pair(db: SqliteD1) {
  return [(await queued(db, "missing", PIN)).id, (await queued(db, "missing", NEAR)).id] as const;
}
const propose = (db: SqliteD1, [a, b]: readonly string[]) =>
  proposeNewSpotReview(db, { reportIds: [a, b], locationReportId: a, decidedBy: "reviewer-1", now: APPLY });

test("no photo, an upload in progress, a pending or rejected photo: the report is held and never reaches a review", async () => {
  const db = reportsD1();
  const [a, b] = await pair(db);
  await approveEvidencePhoto(db, b, RECEIVED);
  // 0 photos (the app closed before uploading).
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "none");
  await assert.rejects(propose(db, [a, b]), new RegExp(`report ${a} has no approved evidence photo \\(photos: none\\)`));
  // Uploading: a reservation still inside its 15-minute window.
  db.raw.prepare(`INSERT INTO community_evidence_photos (photo_id, report_id, storage_key, content_sha256, media_type, byte_length, width, height,
    lifecycle, created_at, upload_expires_at, delete_after) VALUES ('ph_up', ?, 'k/up', ?, 'image/png', 1, 1, 1, 'uploading', ?, ?, ?)`)
    .run(a, "e".repeat(64), "2026-09-25T02:55:00Z", "2026-09-25T03:10:00Z", minimizeAfter(RECEIVED).toISOString().replace(".000", ""));
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "uploading");
  await assert.rejects(propose(db, [a, b]), /photos: uploading/);
  // Pending: received, awaiting the photo moderator.
  const pending = (await approveEvidencePhoto(db, a, RECEIVED, "pending"))!;
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "pending");
  await assert.rejects(propose(db, [a, b]), /photos: pending/);
  // Rejected: the only received photo is refused (privacy risk) and queued for deletion.
  await moderateEvidencePhoto(db, pending, "rejected", { now: APPLY, decidedBy: "photo-reviewer", reason: "privacyRisk" });
  db.raw.prepare("UPDATE community_evidence_photos SET lifecycle = 'deleting' WHERE photo_id = 'ph_up'").run();
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "rejected");
  await assert.rejects(propose(db, [a, b]), /photos: rejected/);
  // The reviewer's reading aid shows the same states; the report stays queued, never applied.
  const [group] = await listNewSpotCandidates(db, { withinMetres: 50, now: APPLY });
  assert.deepEqual(group.photoGates.map((g) => g.gate).sort(), ["approved", "rejected"]);
  assert.equal(db.raw.prepare("SELECT reconciliation_state AS s FROM report_moderation WHERE report_id = ?").get(a)?.s, "queued");
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM report_reviews").get()?.n, 0);
});

test("an approved photo opens the gate only together with every other premise", async () => {
  const db = reportsD1();
  const [a, b] = await pair(db);
  for (const id of [a, b]) await approveEvidencePhoto(db, id, RECEIVED);
  // A single report is still not a communityVerified spot, and an unclassified report is still not a communityReported one.
  await assert.rejects(proposeNewSpotReview(db, { reportIds: [a], locationReportId: a, decidedBy: "r", now: APPLY }), /needs at least 2/);
  await assert.rejects(proposeNewSpotReview(db, { reportIds: [a], locationReportId: a, decidedBy: "r", now: APPLY, tier: "communityReported" }), /states no known spot type/);
  const same = await queued(db, "missing", NEAR, db.raw.prepare("SELECT submitter_hash AS h FROM reports WHERE report_id = ?").get(a)?.h as string);
  await approveEvidencePhoto(db, same.id, RECEIVED);
  await assert.rejects(proposeNewSpotReview(db, { reportIds: [a, same.id], locationReportId: a, decidedBy: "r", now: APPLY }), /same submitter/);
  // With independence, consent and a pin: the review proposes and exports.
  const reviewId = await propose(db, [a, b]);
  const { artifact } = await exportReview(db, reviewId, { now: APPLY });
  // Photos never travel: no photo ID, storage key, hash or count in the artifact, and the canonical side has no photo table.
  const text = new TextDecoder().decode(artifact.bytes);
  assert.doesNotMatch(text, /photo|ph_test|storage|image/i);
  const data = new SqliteD1();
  const imported = await importCommunityArtifact(data, artifact.bytes, { now: APPLY });
  assert.equal(imported.status, "imported", JSON.stringify(imported));
  const canonicalTables = (data.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  assert.equal(canonicalTables.some((t) => /photo/.test(t)), false);
});

test("a photo that stops being usable after the proposal blocks the export, in code and in the database", async () => {
  const db = reportsD1();
  const [a, b] = await pair(db);
  const photo = (await approveEvidencePhoto(db, a, RECEIVED))!;
  await approveEvidencePhoto(db, b, RECEIVED);
  const reviewId = await propose(db, [a, b]);
  // The photo is withdrawn (deleting) before export: the code check refuses.
  db.raw.prepare("UPDATE community_evidence_photos SET lifecycle = 'deleting' WHERE photo_id = ?").run(photo);
  await assert.rejects(exportReview(db, reviewId, { now: APPLY }), new RegExp(`report ${a} has no approved evidence photo`));
  // A direct SQL export (bypassing the code) is refused by migration 0009 inside REPORTS_DB.
  assert.throws(() => db.raw.prepare("UPDATE report_reviews SET state = 'exported', artifact_sha256 = ?, exported_at = ? WHERE review_id = ?")
    .run("0".repeat(64), "2026-09-25T03:00:00Z", reviewId), /a new-spot report has no approved evidence photo/);
  assert.equal(db.raw.prepare("SELECT state FROM report_reviews WHERE review_id = ?").get(reviewId)?.state, "proposed");
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM report_moderation WHERE reconciliation_state = 'applied'").get()?.n, 0);
});

test("retries keep one photo; abandoned and expired photos never count; the report minimizes on its own clock", async () => {
  const db = reportsD1(), storage = new MemoryEvidencePhotoStorage();
  const [a, b] = await pair(db);
  await approveEvidencePhoto(db, b, RECEIVED);
  const hash = db.raw.prepare("SELECT submitter_hash AS h FROM reports WHERE report_id = ?").get(a)?.h as string;
  const input = { reportId: a, submitterHash: hash, idempotencyKey: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version, bytes: png(1), mediaType: "image/png" };
  const opts = { now: RECEIVED, enabled: true, photoTermsCovered: () => true };
  // A failed upload leaves an abandoned reservation: after its window it is expired, not pending.
  const put = storage.put.bind(storage);
  storage.put = async () => { throw new Error("offline"); };
  await assert.rejects(attachEvidencePhoto(db, storage, input, opts));
  assert.equal(await newSpotPhotoGate(db, a, new Date(RECEIVED.getTime() + 16 * 60_000)), "expired");
  await cleanupEvidencePhotos(db, storage, { now: new Date(RECEIVED.getTime() + 16 * 60_000) });
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "expired", "a cleaned-up attempt is still visible as expired, not as never-sent");
  // The app retries with a new attempt: the same request twice gives one photo.
  storage.put = put;
  const retry = { ...input, idempotencyKey: crypto.randomUUID() };
  const first = await attachEvidencePhoto(db, storage, retry, opts);
  assert.deepEqual(await attachEvidencePhoto(db, storage, retry, opts), first);
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM community_evidence_photos WHERE report_id = ? AND lifecycle = 'ready'").get(a)?.n, 1);
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "pending");
  await moderateEvidencePhoto(db, first.photoId, "approved", { now: APPLY, decidedBy: "photo-reviewer", reason: "usableEvidence" });
  assert.equal(await newSpotPhotoGate(db, a, APPLY), "approved");
  // At the report's deadline every photo expires with it: no review can rest on it any more.
  assert.equal(await newSpotPhotoGate(db, a, minimizeAfter(RECEIVED)), "expired");
  await assert.rejects(proposeNewSpotReview(db, { reportIds: [a, b], locationReportId: a, decidedBy: "r", now: minimizeAfter(RECEIVED) }), /past its minimization deadline/);
});

test("existing-spot reports keep their photo-free path", async () => {
  const db = reportsD1();
  const x = await queued(db, "moved", PIN), y = await queued(db, "moved", NEAR);
  assert.equal(await approveEvidencePhoto(db, x.id, RECEIVED), null, "the test helper adds photos to new-spot reports only");
  const { reviewId } = await proposeEffectReview(db, { reportIds: [x.id, y.id], decidedBy: "reviewer-1", now: APPLY });
  assert.equal((await exportReview(db, reviewId, { now: APPLY })).status, "exported");
});
