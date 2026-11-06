// Rehearsal of support actions using only current APIs and synthetic, local REPORTS_DB data.
// A passing workflow never establishes requester ownership, legal sufficiency or production execution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { receiptStatement, readReceipt, receiptOutcome } from "../src/reports/idempotency.ts";
import { applyAdminDecision, getAdminReport, recordIndependentEvidence } from "../src/reports/admin-review.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { proposeNewSpotReview, exportReview, withdrawReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { reportsD1, type SqliteD1 } from "./support/sqlite-d1.ts";
const received = new Date("2026-01-01T00:00:00Z");
const reportId = `rp_${"0".repeat(26)}`;
const digest = "a".repeat(64), fingerprint = "c".repeat(64);
async function seed() {
  const db = reportsD1();
  await createReport(db, { schemaVersion: 3, type: "missing", proposedLocation: { latitude: 35.68, longitude: 139.76 }, claim: { spotType: "designatedOutdoorArea", accessType: "public" },
    installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", idempotencyKey: "f".repeat(64), acceptedTermsVersion: CURRENT_REPORT_TERMS.version, note: "private-synthetic-note" }, {
    now: received, attestationStatus: "verified", submitterHash: "b".repeat(64), newReportId: () => reportId,
    after: (id, at) => [receiptStatement(db, digest, id, fingerprint, at)],
  });
  return db;
}
const row = (db: SqliteD1) => ({ ...db.raw.prepare("SELECT note,submitter_hash,redacted_at,proposed_latitude,proposed_longitude FROM reports WHERE report_id=?").get(reportId) }) as { note: string | null; submitter_hash: string | null; redacted_at: string | null; proposed_latitude: number | null; proposed_longitude: number | null };
async function queue(db: SqliteD1) {
  await recordIndependentEvidence(db, { reportId, basis: "officialSource", sourceUrl: "https://example.invalid/synthetic-official",
    checkedOn: "2026-01-01", expectedVersion: (await getAdminReport(db, reportId, received)).version,
    operationId: crypto.randomUUID(), decidedBy: "operator", placeConfirmed: true }, received);
  await applyAdminDecision(db, { reportId, state: "accepted", reason: "confirmed", privacyChecked: true,
    expectedVersion: (await getAdminReport(db, reportId, received)).version, operationId: crypto.randomUUID(), decidedBy: "operator" }, received);
  await setReconciliationState(db, reportId, "queued", received);
  return proposeNewSpotReview(db, { reportIds: [reportId], locationReportId: reportId, tier: "communityReported", decidedBy: "operator", now: received });
}

test("rejecting an unqueued report stops review use but keeps content until the existing minimization runs", async () => {
  const db = await seed();
  await recordModerationDecision(db, reportId, { state: "rejected", decidedBy: "operator", reason: "outOfScope", now: received });
  await assert.rejects(proposeNewSpotReview(db, { reportIds: [reportId], locationReportId: reportId, tier: "communityReported", decidedBy: "operator", now: received }), /not accepted/);
  assert.equal(row(db).note, "private-synthetic-note", "a rejection must not be described as erasure");
  assert.throws(() => db.raw.prepare("UPDATE reports SET note='corrected' WHERE report_id=?").run(reportId), /immutable/);
  const due = minimizeAfter(received);
  await applyReportRetention(db, { now: new Date(due.getTime() - 1000) });
  assert.equal(row(db).redacted_at, null);
  await applyReportRetention(db, { now: due });
  assert.deepEqual(row(db), { note: null, submitter_hash: null, redacted_at: "2026-04-01T00:00:00Z", proposed_latitude: null, proposed_longitude: null });
  assert.equal(receiptOutcome((await readReceipt(db, digest))!, fingerprint), "retired");
});

test("withdrawing a proposed review then discarding queued work prevents its export without claiming deletion", async () => {
  const db = await seed(), reviewId = await queue(db);
  await withdrawReview(db, reviewId, { now: received });
  await setReconciliationState(db, reportId, "discarded", received);
  await assert.rejects(exportReview(db, reviewId, { now: received }), /withdrawn/);
  assert.equal(row(db).note, "private-synthetic-note");
  assert.equal(receiptOutcome((await readReceipt(db, digest))!, fingerprint), "replay");
  assert.equal((db.raw.prepare("SELECT count(*) n FROM report_review_evidence").get() as { n: number }).n, 1, "immutable review references still remain");
});

test("an exported review cannot be withdrawn by the proposed-only operation, and minimization does not recall its artifact", async () => {
  const db = await seed(), reviewId = await queue(db);
  const exported = await exportReview(db, reviewId, { now: received });
  assert.equal(exported.status, "exported");
  await assert.rejects(withdrawReview(db, reviewId, { now: received }), /only a proposed/);
  await assert.rejects(setReconciliationState(db, reportId, "discarded", received), /illegal reconciliation/);
  assert.equal((db.raw.prepare("SELECT count(*) n FROM new_spot_evidence_checks").get() as { n: number }).n, 1);
  const before = exported.artifact.sha256;
  await applyReportRetention(db, { now: minimizeAfter(received) });
  assert.equal(row(db).note, null);
  assert.equal((db.raw.prepare("SELECT artifact_sha256 FROM report_reviews WHERE review_id=?").get(reviewId) as { artifact_sha256: string }).artifact_sha256, before);
  assert.equal((db.raw.prepare("SELECT count(*) n FROM new_spot_evidence_checks").get() as { n: number }).n, 1, "independent-check audit survives report minimization");
  assert.equal((db.raw.prepare("SELECT state FROM report_reviews WHERE review_id=?").get(reviewId) as { state: string }).state, "exported");
  assert.equal(receiptOutcome((await readReceipt(db, digest))!, fingerprint), "retired");
});
