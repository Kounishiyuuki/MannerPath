import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { receiptStatement } from "../src/reports/idempotency.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { erasureImpact } from "../src/reports/erasure-impact.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { approveEvidencePhoto } from "./support/evidence-photo.ts";
import { reportsD1, type SqliteD1 } from "./support/sqlite-d1.ts";

const received = new Date("2026-01-01T00:00:00Z");
const id = (n: number) => `rp_${String(n).padStart(26, "0")}`;

async function seed(db: SqliteD1, n: number, type: "exists" | "missing" = "exists", receipt = true) {
  const body = type === "missing"
    ? { schemaVersion: 3, type, latitude: 35.68, longitude: 139.76, claim: { spotType: "ashtray" } }
    : { schemaVersion: 3, type, spotId: `sp_${"0".repeat(26)}` };
  await createReport(db, { ...body, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", idempotencyKey: "a".repeat(64), note: "private-note-sentinel", observedOn: "2026-01-01" } as never, {
    now: received, attestationStatus: "verified", submitterHash: "b".repeat(64), newReportId: () => id(n),
    after: (reportId, at) => !receipt ? [] : [receiptStatement(db, n.toString(16).padStart(64, "0"), reportId, "c".repeat(64), at)],
  });
}

test("reports counts and states only, and never writes", async () => {
  const db = reportsD1(); await seed(db, 1, "missing");
  await approveEvidencePhoto(db, id(1), received);
  const readonly: Db = { prepare(sql) { assert.match(sql.trimStart(), /^SELECT/); return db.prepare(sql); }, async batch() { assert.fail("must not write"); } };
  const impact = await erasureImpact(readonly, id(1), received);
  assert.deepEqual(impact, {
    reportId: id(1),
    report: { redacted: false, attestationStatus: "verified", minimizeDue: false },
    moderation: { state: "pending", reconciliationState: "notQueued" },
    photos: { lifecycle: { ready: 1 }, moderation: { approved: 1 }, queuedDeletions: 0 },
    photoRequests: 0, receipt: "active", reviewEvidence: null, locationOfReviews: {}, baseOfReviews: 0,
    bulkRejectionTargets: 0, adminReviewAudit: 0, deleteBlockedBy: ["receipt"],
  });
  assert.doesNotMatch(JSON.stringify(impact), /private-note-sentinel|35\.68|2026-|test\/ph_|b{64}|c{64}/);
});

test("unknown and malformed IDs", async () => {
  const db = reportsD1();
  assert.equal(await erasureImpact(db, id(9), received), null);
  for (const bad of ["rp_x", `rp_${"0".repeat(25)}' OR '1`, `${id(1)} `, "%"]) {
    await assert.rejects(erasureImpact(db, bad, received), /malformed report ID/);
  }
});

test("after 90-day minimization the photos are queued and the receipt retired", async () => {
  const db = reportsD1(); await seed(db, 1, "missing"); await approveEvidencePhoto(db, id(1), received);
  const now = minimizeAfter(received);
  await applyReportRetention(db, { now });
  const impact = await erasureImpact(db, id(1), now);
  assert.deepEqual(impact?.report, { redacted: true, attestationStatus: "verified", minimizeDue: true });
  assert.equal(impact?.receipt, "retired");
  assert.deepEqual(impact?.photos, { lifecycle: { deleting: 1 }, moderation: { approved: 1 }, queuedDeletions: 1 });
});

test("review evidence is reported with kind and state only", async () => {
  const db = reportsD1(); await seed(db, 1);
  await recordModerationDecision(db, id(1), { state: "accepted", decidedBy: "m", reason: "confirmed", now: received });
  await setReconciliationState(db, id(1), "queued", received);
  db.raw.prepare(`INSERT INTO report_reviews (review_id, review_kind, review_key, decision_version, rule_version, subject_spot_id,
      report_type, decided_by, decided_at, state) VALUES (?, 'effect', 'k', 1, 'community-effects.v1', ?, 'exists', 'm', ?, 'proposed')`)
    .run(`ce_${"0".repeat(26)}`, `sp_${"0".repeat(26)}`, "2026-01-01T00:00:00Z");
  db.raw.prepare("INSERT INTO report_review_evidence (report_id, review_id) VALUES (?, ?)").run(id(1), `ce_${"0".repeat(26)}`);
  const impact = await erasureImpact(db, id(1), received);
  assert.deepEqual(impact?.reviewEvidence, { kind: "effect", state: "proposed" });
  assert.deepEqual(impact?.deleteBlockedBy, ["receipt", "reviewEvidence"]);
  assert.doesNotMatch(JSON.stringify(impact), /ce_0/);
});

// Characterization (ADR-0021 §10): today neither the report row nor what pins it can be deleted. The erase
// migration (0007 in the ADR's numbering) must change these deliberately.
test("characterization: a receipt blocks DELETE of its report and is itself never deleted", async () => {
  const db = reportsD1(); await seed(db, 1);
  assert.throws(() => db.raw.prepare("DELETE FROM reports WHERE report_id = ?").run(id(1)), /FOREIGN KEY/);
  assert.throws(() => db.raw.prepare("DELETE FROM report_idempotency WHERE report_id = ?").run(id(1)), /never deleted/);
});

test("characterization: review evidence blocks DELETE of its report and is itself never deleted", async () => {
  const db = reportsD1(); await seed(db, 1, "exists", false);
  await recordModerationDecision(db, id(1), { state: "accepted", decidedBy: "m", reason: "confirmed", now: received });
  await setReconciliationState(db, id(1), "queued", received);
  db.raw.prepare(`INSERT INTO report_reviews (review_id, review_kind, review_key, decision_version, rule_version, subject_spot_id,
      report_type, decided_by, decided_at, state) VALUES (?, 'effect', 'k', 1, 'community-effects.v1', ?, 'exists', 'm', ?, 'proposed')`)
    .run(`ce_${"0".repeat(26)}`, `sp_${"0".repeat(26)}`, "2026-01-01T00:00:00Z");
  db.raw.prepare("INSERT INTO report_review_evidence (report_id, review_id) VALUES (?, ?)").run(id(1), `ce_${"0".repeat(26)}`);
  assert.deepEqual((await erasureImpact(db, id(1), received))?.deleteBlockedBy, ["reviewEvidence"]);
  assert.throws(() => db.raw.prepare("DELETE FROM reports WHERE report_id = ?").run(id(1)), /FOREIGN KEY/);
  assert.throws(() => db.raw.prepare("DELETE FROM report_review_evidence WHERE report_id = ?").run(id(1)), /never deleted/);
});
