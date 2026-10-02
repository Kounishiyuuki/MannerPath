// Community acquisition engine (ADR-0013, migration 0024): the community channel as a nationwide collection path.
// Reports live in the durable REPORTS_DB paired with each canonical test database (test/support/community.ts,
// ADR-0014); the canonical side sees only imported, sanitized review artifacts.
//
// The community source is BLOCKED and the report terms are a DRAFT (Issue #124 is open). Tests that need a published
// community spot simulate the future approval explicitly — the local rows by hand and the reviewed lists through the
// injection points only tests use — and say so. Nothing here approves anything for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { isoSeconds } from "../src/db.ts";
import { COVERAGE_TASKS_SCHEMA_VERSION, CoverageTasksBodyV1 } from "../src/coverage/dto.ts";
import { communityAcquisitionMetrics, prefectureOf } from "../src/coverage/metrics.ts";
import { PREFECTURES } from "../src/coverage/prefectures.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";
import { gapTasks, recheckTasks, spotTaskKinds } from "../src/coverage/tasks.ts";
import { COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import {
  applyCommunityAbsence, holdCommunityAbsence, liftCommunityAbsence, withdrawCommunityAbsence,
} from "../src/pipeline/community-absence.ts";
import { applyCommunityEffect } from "../src/pipeline/community-effects.ts";
import {
  communityStage, correctionCandidates, duplicateCandidates, spotEvidenceStates,
} from "../src/pipeline/community-evidence.ts";
import { applyCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { proposeAbsenceReview } from "../src/reports/review.ts";
import { upgradeCommunityEvidence } from "../src/pipeline/community-verification.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { CURRENT_REPORT_TERMS, applyReportTermsRegistry } from "../src/reports/terms.ts";
import { triageCategory, triageQueue, triageSummary } from "../src/reports/triage.ts";
import { TileBodyV1, type TileSpotV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";
import { proposeAbsence, proposeConfirmation, proposeEffect, proposeNewSpot, reportsOf, storesOf } from "./support/community.ts";
import { v1TileRows } from "./support/tiles.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];

const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
const TERMS = CURRENT_REPORT_TERMS.version;
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const NOTE = "収集エンジン用メモ CAE-7731";
const HASHES = ["0123456789abcdef", "fedcba9876543210", "0f1e2d3c4b5a6978", "1111222233334444"].map((h) => h.repeat(4));
// Inside the Shinjuku seed area and away from every reviewed fixture's spots.
const HERE = { latitude: 35.69001, longitude: 139.70001 };
const SPOT_A = "sp_01V64NN31G72E5KJJ5W22W1A1J";

// ---- simulation of the future approval (TEST ONLY) -----------------------------------------------------------
const simulateRightsGranted = (db: SqliteD1) => {
  db.raw.prepare(`UPDATE sources SET publication_status = 'approved', attribution_text = 'TEST ONLY simulated community attribution',
    license_name = 'TEST ONLY simulated report terms', license_url = 'https://example.invalid/report-terms' WHERE source_id = ?`).run(COMMUNITY_SOURCE_ID);
  db.raw.prepare("UPDATE report_terms_versions SET publication_rights = 'granted' WHERE terms_version = ?").run(TERMS);
};

async function report(db: SqliteD1, hash: string, body: Record<string, unknown>, at = RECEIVED) {
  const { reportId } = await createReport(reportsOf(db), { schemaVersion: 1, installId: INSTALL, acceptedTermsVersion: TERMS, ...body } as any,
    { now: at, attestationStatus: "notProvided", submitterHash: hash });
  return reportId;
}
async function acceptAndQueue(db: SqliteD1, ...ids: string[]) {
  for (const id of ids) {
    await recordModerationDecision(reportsOf(db), id, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
    await setReconciliationState(reportsOf(db), id, "queued", RECEIVED);
  }
}
async function world() {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  await publishTiles(db, { now: isoSeconds(RECEIVED) });
  return db;
}
async function reportedSpot(db: SqliteD1, prefix = "R", at = HERE) {
  const id = await report(db, HASHES[0], { type: "missing", proposedLocation: at, note: NOTE, claim: { spotType: "ashtray", hostType: "convenienceStore" } });
  await acceptAndQueue(db, id);
  const applicationId = await proposeNewSpot(storesOf(db), { reportIds: [id], locationReportId: id, decidedBy: "reviewer-1", now: APPLY, tier: "communityReported" });
  return (await applyCommunityApplication(db, applicationId, { now: APPLY, newSpotId: sequentialSpotIds(prefix) }) as { spotId: string }).spotId;
}
const published = (db: SqliteD1, spotId: string) => one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n === 1;
const anyOfficialSpot = (db: SqliteD1) => one(db, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 1").spot_id as string;
const publishedSpots = (db: SqliteD1) => v1TileRows(db).flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
const post = (db: SqliteD1, body: unknown) => app.request("/v1/reports", { method: "POST", body: JSON.stringify(body) }, { DB: db, REPORTS_DB: reportsOf(db) } as any);

// =============================================================================================================
test("the report API takes the structured existing-spot findings and correction claims, and stores them as findings", async () => {
  const db = new SqliteD1();
  const base = { schemaVersion: 1, spotId: SPOT_A, installId: INSTALL, acceptedTermsVersion: TERMS };
  for (const [body, stored] of [
    [{ ...base, type: "exists" }, ["exists", null, null, null]],
    [{ ...base, type: "notFound" }, ["other", "notFound", null, null]],
    [{ ...base, type: "removed" }, ["other", "removed", null, null]],
    [{ ...base, type: "typeChanged", claim: { spotType: "smokingPermittedVenue" } }, ["other", "wrongType", "smokingPermittedVenue", null]],
    [{ ...base, type: "accessChanged", claim: { accessType: "customerOnly" } }, ["accessChanged", null, null, "customerOnly"]],
    [{ ...base, type: "tobaccoTypeChanged", claim: { supportsHeated: "yes" } }, ["tobaccoTypeChanged", null, null, null]],
  ] as const) {
    const res = await post(db, body);
    assert.equal(res.status, 201, JSON.stringify(body));
    const { reportId } = await res.json() as { reportId: string };
    assert.deepEqual(Object.values(one(reportsOf(db), "SELECT report_type, finding, claim_spot_type, claim_access_type FROM reports WHERE report_id = ?", reportId)), stored);
  }
  for (const bad of [
    { ...base, type: "notFound", claim: { spotType: "ashtray" } },
    { ...base, type: "typeChanged", claim: { accessType: "public" } },
    { ...base, type: "accessChanged", claim: { accessType: "public", accessDetail: "ticketedUsersOnly" } },
    { ...base, type: "typeChanged", claim: { spotType: "ashtray", hostName: "x" } },
    { ...base, type: "removed", proposedLocation: HERE },
    { schemaVersion: 1, type: "notFound", installId: INSTALL },
  ]) assert.equal((await post(db, bad)).status, 400, JSON.stringify(bad));
  assert.equal(one(reportsOf(db), "SELECT count(*) AS n FROM reports").n, 6);
  const config = await (await app.request("/v1/config", {}, { DB: db, REPORTS_DB: reportsOf(db) } as any)).json() as Row;
  assert.equal(config.reports.existingSpotFindings, true);
  // The database refuses a finding outside `other`, a host claim on a correction, and any later change.
  assert.throws(() => reportsOf(db).raw.prepare(`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status,
    received_at, minimize_after, finding) VALUES ('rp_${"9".repeat(26)}', 1, 'exists', '${SPOT_A}', 'notProvided', 'a', 'b', 'removed')`).run(), /finding is stored only on an other/);
  assert.throws(() => reportsOf(db).raw.prepare(`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status,
    received_at, minimize_after, claim_host_type) VALUES ('rp_${"8".repeat(26)}', 1, 'accessChanged', '${SPOT_A}', 'notProvided', 'a', 'b', 'station')`).run(), /not accepted on this report type/);
  assert.throws(() => reportsOf(db).raw.prepare("UPDATE reports SET finding = 'notFound' WHERE finding = 'removed'").run(), /immutable/);
});

test("an older client's report and tile reads are unchanged", async () => {
  const db = await world();
  const res = await post(db, { schemaVersion: 1, type: "other", spotId: anyOfficialSpot(db), installId: INSTALL, note: "旧クライアント" });
  assert.equal(res.status, 201);
  assert.equal(one(reportsOf(db), "SELECT finding FROM reports").finding, null, "a plain `other` report stays a plain other report");
  assert.equal(one(db, "SELECT count(*) AS n FROM reports").n, 0, "and the canonical database holds no report");
  for (const s of publishedSpots(db)) assert.ok(TileBodyV1.shape.spots.element.safeParse(s).success);
  assert.equal(JSON.parse(v1TileRows(db)[0].body_json).schemaVersion, 1);
});

test("one-tap still-here needs no free text; an independent confirmation makes a reported spot visitedConfirmed, a repeat does not", async () => {
  const db = await world();
  const spotId = await reportedSpot(db);
  const stage = async () => {
    const s = one(db, "SELECT evidence_quality, community_confirmations FROM spots WHERE spot_id = ?", spotId);
    const upgraded = one(db, "SELECT count(*) AS n FROM community_evidence_upgrades WHERE spot_id = ?", spotId).n === 1;
    return communityStage({ existence: s.evidence_quality, confirmations: s.community_confirmations, upgradedByVisit: upgraded });
  };
  assert.equal(await stage(), "reported");
  // The original reporter confirming their own spot is not independent evidence.
  const self = await report(db, HASHES[0], { type: "exists", spotId });
  await acceptAndQueue(db, self);
  await assert.rejects(proposeConfirmation(storesOf(db), { spotId, reportIds: [self], decidedBy: "r", now: APPLY }), /not independent/);
  assert.equal(await stage(), "reported");
  // Another person's one-tap confirmation: no note, no date, no pin.
  const other = await report(db, HASHES[1], { type: "exists", spotId });
  assert.deepEqual(Object.values(one(reportsOf(db), "SELECT note, observed_on, proposed_latitude FROM reports WHERE report_id = ?", other)), [null, null, null]);
  await acceptAndQueue(db, other);
  const effect = await proposeConfirmation(storesOf(db), { spotId, reportIds: [other], decidedBy: "r", now: APPLY });
  await applyCommunityEffect(db, effect.applicationId, { now: APPLY });
  assert.equal((await upgradeCommunityEvidence(db, effect.applicationId, { decidedBy: "r", now: APPLY })).confirmations, 2);
  assert.equal(await stage(), "visitedConfirmed");
  assert.equal(communityStage({ existence: "communityVerified", confirmations: 3, upgradedByVisit: true }), "communityVerified");
  assert.equal(communityStage({ existence: "communityVerified", confirmations: 2, upgradedByVisit: false }), "communityVerified");
  assert.equal(communityStage({ existence: "official", confirmations: null, upgradedByVisit: false }), null);
});

test("a single negative report deletes nothing: the spot needs a recheck and stays published", async () => {
  const db = await world();
  const spotId = anyOfficialSpot(db);
  const id = await report(db, HASHES[0], { type: "notFound", spotId });
  await acceptAndQueue(db, id);
  const [state] = await spotEvidenceStates(reportsOf(db), db, { now: APPLY, spotIds: [spotId] });
  assert.equal(state.state, "needsRecheck");
  const applicationId = await proposeAbsence(storesOf(db), { reportIds: [id], decidedBy: "r", now: APPLY });
  await applyCommunityAbsence(db, applicationId, { now: APPLY });
  const hold = await holdCommunityAbsence(db, applicationId, { now: APPLY, sourceApprovedInCode: true });
  assert.equal(hold.status, "blocked");
  assert.ok(hold.status === "blocked" && hold.blockers.includes("tooFewIndependentSubmitters"));
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, spotId));
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", spotId).lifecycle, "active");
});

test("independent negatives become a review candidate; the hold is refused while rights are pending and unpublishes once simulated granted", async () => {
  const db = await world();
  const spotId = await reportedSpot(db);
  const a = await report(db, HASHES[1], { type: "notFound", spotId });
  const b = await report(db, HASHES[2], { type: "removed", spotId });
  await acceptAndQueue(db, a, b);
  assert.equal((await spotEvidenceStates(reportsOf(db), db, { now: APPLY, spotIds: [spotId] }))[0].state, "reviewCandidate");
  const applicationId = await proposeAbsence(storesOf(db), { reportIds: [a, b], decidedBy: "r", now: APPLY });
  assert.deepEqual(await applyCommunityAbsence(db, applicationId, { now: APPLY }), { status: "applied", spotId });
  assert.deepEqual(all(reportsOf(db), "SELECT reconciliation_state FROM report_moderation WHERE report_id IN (?, ?)", a, b).map((r) => r.reconciliation_state), ["applied", "applied"]);
  // Rights pending (#124): nothing is written.
  const blocked = await holdCommunityAbsence(db, applicationId, { now: APPLY });
  assert.ok(blocked.status === "blocked" && blocked.blockers.includes("sourceNotApproved") && blocked.blockers.includes("termsNotGranted"));
  assert.equal(one(db, "SELECT count(*) AS n FROM community_absence_holds").n, 0);
  // The database refuses the hold around the module as well.
  assert.throws(() => db.raw.prepare(`INSERT INTO community_absence_holds (application_id, spot_id, executor_version, terms_version, held_at)
    VALUES (?, ?, 'community-absence-hold.v1', ?, ?)`).run(applicationId, spotId, TERMS, isoSeconds(APPLY)), /community absence hold/);

  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, spotId), "granted simulation: the community spot publishes");
  assert.equal((await holdCommunityAbsence(db, applicationId, { now: APPLY, sourceApprovedInCode: true })).status, "held");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), false);
  assert.equal(one(db, "SELECT count(*) AS n FROM spots WHERE spot_id = ?", spotId).n, 1, "held, never deleted");
  assert.equal((await spotEvidenceStates(reportsOf(db), db, { now: APPLY, spotIds: [spotId] }))[0].state, "held");
  await liftCommunityAbsence(db, applicationId, { liftedBy: "reviewer-2", now: APPLY });
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, spotId), "a reviewed lift republishes");
});

test("negatives from one submitter are not independent; a newer positive supersedes older negatives; mixed evidence is flagged, not voted", async () => {
  const db = await world();
  const spotId = anyOfficialSpot(db);
  const first = await report(db, HASHES[0], { type: "notFound", spotId }, new Date("2026-09-10T00:00:00Z"));
  const again = await report(db, HASHES[0], { type: "removed", spotId }, new Date("2026-09-11T00:00:00Z"));
  await acceptAndQueue(db, first, again);
  let [s] = await spotEvidenceStates(reportsOf(db), db, { now: APPLY, spotIds: [spotId] });
  assert.deepEqual([s.state, s.negativesSinceLastPositive, s.independentNegativesSinceLastPositive], ["needsRecheck", 2, 1]);
  const appId = await proposeAbsence(storesOf(db), { reportIds: [first, again], decidedBy: "r", now: APPLY });
  await applyCommunityAbsence(db, appId, { now: APPLY });
  simulateRightsGranted(db);
  const refused = await holdCommunityAbsence(db, appId, { now: APPLY, sourceApprovedInCode: true });
  assert.ok(refused.status === "blocked" && refused.blockers.includes("tooFewIndependentSubmitters"));

  // User A: removed. User B: still there (newer). User C: removed (older than B). Order and independence decide.
  const db2 = await world();
  const spot2 = anyOfficialSpot(db2);
  const removedA = await report(db2, HASHES[0], { type: "removed", spotId: spot2 }, new Date("2026-09-12T00:00:00Z"));
  const removedC = await report(db2, HASHES[2], { type: "notFound", spotId: spot2 }, new Date("2026-09-13T00:00:00Z"));
  const stillB = await report(db2, HASHES[1], { type: "exists", spotId: spot2 }, new Date("2026-09-14T00:00:00Z"));
  await acceptAndQueue(db2, removedA, removedC, stillB);
  [s] = await spotEvidenceStates(reportsOf(db2), db2, { now: APPLY, spotIds: [spot2] });
  assert.deepEqual([s.state, s.conflicting, s.negativeReports, s.positiveReports], ["normal", true, 2, 1],
    "two negatives do not outvote a newer positive, and the disagreement is surfaced for review");
  const removedD = await report(db2, HASHES[3], { type: "removed", spotId: spot2 }, new Date("2026-09-20T00:00:00Z"));
  await acceptAndQueue(db2, removedD);
  [s] = await spotEvidenceStates(reportsOf(db2), db2, { now: APPLY, spotIds: [spot2] });
  assert.deepEqual([s.state, s.conflicting], ["needsRecheck", true], "one newer negative after the positive is a recheck, not a removal");
});

test("a location correction never moves a spot; independent agreeing pins become a relocation candidate for review", async () => {
  const db = await world();
  const spotId = anyOfficialSpot(db);
  const before = one(db, "SELECT latitude, longitude FROM spots WHERE spot_id = ?", spotId);
  const pin = { latitude: before.latitude + 0.0009, longitude: before.longitude };
  const a = await report(db, HASHES[0], { type: "moved", spotId, proposedLocation: pin });
  await acceptAndQueue(db, a);
  let [c] = await correctionCandidates(reportsOf(db), db, { now: APPLY });
  assert.deepEqual([c.spotId, c.status, c.agreeingSubmitters], [spotId, "awaitingIndependentConfirmation", 1]);
  assert.ok(c.distanceFromCurrentMetres! > 90 && c.distanceFromCurrentMetres! < 110);
  // A second person pins within 30 m; a third pins far away and does not join the agreeing group.
  const b = await report(db, HASHES[1], { type: "moved", spotId, proposedLocation: { latitude: pin.latitude + 0.0001, longitude: pin.longitude } });
  const far = await report(db, HASHES[2], { type: "moved", spotId, proposedLocation: { latitude: pin.latitude + 0.01, longitude: pin.longitude } });
  await acceptAndQueue(db, b, far);
  [c] = await correctionCandidates(reportsOf(db), db, { now: APPLY });
  assert.deepEqual([c.status, c.agreeingSubmitters, c.reports, c.agreeingReportIds.sort()], ["relocationCandidate", 2, 3, [a, b].sort()]);
  // The effect path records the relocation review candidate and still changes nothing canonical.
  const effect = await proposeEffect(storesOf(db), { reportIds: [a, b], decidedBy: "r", now: APPLY });
  assert.equal(effect.effect, "relocationReview");
  await applyCommunityEffect(db, effect.applicationId, { now: APPLY });
  assert.deepEqual(one(db, "SELECT latitude, longitude FROM spots WHERE spot_id = ?", spotId), before);
});

test("type and access corrections are review candidates with the proposed value; nothing canonical changes", async () => {
  const db = await world();
  const spotId = anyOfficialSpot(db);
  const before = one(db, "SELECT spot_type, access_type FROM spots WHERE spot_id = ?", spotId);
  const t = await report(db, HASHES[0], { type: "typeChanged", spotId, claim: { spotType: "facilitySmokingRoom" } });
  const acc = await report(db, HASHES[1], { type: "accessChanged", spotId, claim: { accessType: "facilityOnly", accessDetail: "ticketedUsersOnly" } });
  await acceptAndQueue(db, acc);
  const effect = await proposeEffect(storesOf(db), { reportIds: [acc], decidedBy: "r", now: APPLY });
  assert.equal(effect.effect, "accessReview");
  await applyCommunityEffect(db, effect.applicationId, { now: APPLY });
  assert.deepEqual(one(db, "SELECT spot_type, access_type FROM spots WHERE spot_id = ?", spotId), before);
  assert.equal(triageCategory("other", "wrongType"), "typeChange");
  assert.deepEqual((await triageQueue(reportsOf(db), db, { now: APPLY, categories: ["correction"] })).map((r) => r.reportId), [t]);
});

test("a new spot proposed next to an existing one is a duplicate candidate; nothing is merged", async () => {
  const db = await world();
  const spotId = anyOfficialSpot(db);
  const s = one(db, "SELECT latitude, longitude FROM spots WHERE spot_id = ?", spotId);
  const near = await report(db, HASHES[0], { type: "missing", proposedLocation: { latitude: s.latitude + 0.0002, longitude: s.longitude }, claim: { spotType: "ashtray" } });
  const twin = await report(db, HASHES[1], { type: "missing", proposedLocation: { latitude: s.latitude + 0.0003, longitude: s.longitude }, claim: { spotType: "ashtray" } });
  const lonely = await report(db, HASHES[2], { type: "missing", proposedLocation: HERE, claim: { spotType: "ashtray" } });
  const dups = await duplicateCandidates(reportsOf(db), db, { now: APPLY });
  const forNear = dups.find((d) => d.reportId === near)!;
  assert.equal(forNear.nearbySpots[0].spotId, spotId);
  assert.ok(forNear.nearbySpots[0].distanceMetres <= 50);
  assert.deepEqual(forNear.nearbyReports.map((r) => r.reportId), [twin]);
  assert.equal(dups.some((d) => d.reportId === lonely), false);
  const queue = await triageQueue(reportsOf(db), db, { now: APPLY, flag: "duplicateCandidate" });
  assert.deepEqual(queue.map((r) => r.reportId).sort(), [near, twin].sort());
  assert.equal(one(db, "SELECT count(*) AS n FROM spots WHERE merged_into IS NOT NULL").n, 0);
});

test("moderation triage: filters, flags, a fixed order and a summary — IDs and counts only, never content", async () => {
  const db = await world();
  const spotId = anyOfficialSpot(db);
  const ids = [
    await report(db, HASHES[0], { type: "exists", spotId, note: NOTE }),
    await report(db, HASHES[1], { type: "notFound", spotId }),
    await report(db, HASHES[2], { type: "removed", spotId }),
    await report(db, HASHES[3], { type: "missing", proposedLocation: HERE, claim: { spotType: "ashtray" } }),
    await report(db, HASHES[0], { type: "hoursChanged", spotId }, new Date("2026-09-01T00:00:00Z")),
  ];
  const queue = await triageQueue(reportsOf(db), db, { now: APPLY });
  assert.equal(queue.length, 5);
  assert.ok(queue.filter((r) => r.spotId === spotId).every((r) => r.flags.includes("highReportCount")));
  assert.ok(queue.find((r) => r.reportId === ids[4])!.flags.includes("old"));
  assert.deepEqual(queue.map((r) => r.priority), [...queue.map((r) => r.priority)].sort(), "priority buckets first; old refinements graduate to P0");
  assert.deepEqual((await triageQueue(reportsOf(db), db, { now: APPLY, categories: ["missing"] })).map((r) => r.reportId).sort(), [ids[1], ids[2]].sort());
  assert.deepEqual((await triageQueue(reportsOf(db), db, { now: APPLY, categories: ["stillExists", "newSpot"] })).map((r) => r.category).sort(), ["newSpot", "stillExists"]);
  await acceptAndQueue(db, ids[0], ids[1]);
  await recordModerationDecision(reportsOf(db), ids[2], { state: "rejected", decidedBy: "r", reason: "insufficientDetail", now: APPLY });
  const summary = await triageSummary(reportsOf(db), db);
  assert.deepEqual([summary.pending, summary.accepted, summary.rejected, summary.applied, summary.rightsBlocked], [2, 2, 1, 0, 2],
    "every accepted report is rights-blocked while #124 is open");
  const text = JSON.stringify([queue, summary]);
  for (const secret of [NOTE, ...HASHES, String(HERE.latitude), "2026-09-"]) assert.equal(text.includes(secret), false, secret);
  await ensureReviewedSource(db, COMMUNITY_SOURCE_ID, isoSeconds(APPLY));
  // The canonical terms mirror comes from the reviewed list in code, never from a report (ADR-0014).
  await applyReportTermsRegistry(db, isoSeconds(APPLY));
  simulateRightsGranted(db);
  assert.equal((await triageSummary(reportsOf(db), db)).rightsBlocked, 0, "granted simulation: consented accepted reports are no longer blocked");
});

test("coverage-tasks.v1 spot rules match the shared contract vectors", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../../contracts/coverage/coverage-tasks.v1.json", import.meta.url), "utf8"));
  assert.equal(vectors.rules, "coverage-tasks.v1");
  for (const c of vectors.cases) assert.deepEqual(spotTaskKinds(c.spot, vectors.now), c.expected, c.name);
});

test("tasks: gaps are areas, not places; recheck tasks need granted rights; the public endpoint carries no user-derived data", async () => {
  const db = await world();
  const before = await (await app.request("/v1/coverage/tasks", {}, { DB: db } as any)).json() as Row;
  const body = CoverageTasksBodyV1.parse(before);
  assert.equal(body.schemaVersion, COVERAGE_TASKS_SCHEMA_VERSION);
  assert.equal(body.tasks.some((t) => t.seedAreaId === "tokyo-shinjuku"), true, "no published spot near Shinjuku in the fixtures");
  assert.equal(body.tasks.some((t) => t.seedAreaId === "tokyo-ueno"), false, "Taito's official spots cover Ueno");
  assert.deepEqual(body.tasks.map((t) => t.priority), [...body.tasks.map((t) => t.priority)].sort());
  // Pending and accepted reports near Shinjuku change nothing public.
  const spotId = await reportedSpot(db);
  const neg = await report(db, HASHES[1], { type: "notFound", spotId });
  await acceptAndQueue(db, neg);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const after = await (await app.request("/v1/coverage/tasks", {}, { DB: db } as any)).text();
  assert.equal(after, JSON.stringify(before), "unpublished community data moves no task");
  for (const secret of [spotId, neg, NOTE, ...HASHES]) assert.equal(after.includes(secret), false);
  const states = await spotEvidenceStates(reportsOf(db), db, { now: APPLY });
  assert.deepEqual(recheckTasks(states, { communityRightsGranted: false }), []);
  assert.deepEqual(recheckTasks(states, { communityRightsGranted: true }), [{ kind: "needsRecheck", spotId }]);
  // Rights simulated granted: the reported spot publishes, closes the Shinjuku gap, and becomes a spot task.
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const granted = CoverageTasksBodyV1.parse(await (await app.request("/v1/coverage/tasks", {}, { DB: db } as any)).json());
  assert.equal(granted.tasks.some((t) => t.seedAreaId === "tokyo-shinjuku"), false);
  const reported = publishedSpots(db).find((s) => s.id === spotId)!;
  // The report stated no access, so access is a check too.
  assert.deepEqual(spotTaskKinds(reported, isoSeconds(APPLY)), ["needsConfirmation", "needsLocationCheck", "needsAccessCheck"]);
  assert.deepEqual(gapTasks([HERE], { seedAreas: SEED_AREAS.filter((a) => a.id === "tokyo-shinjuku") }), []);
});

test("acquisition metrics: tiers apart, 47 prefectures, seed stations official-only vs all-visible; community counted only once published", async () => {
  const db = await world();
  const spotId = await reportedSpot(db);
  const pending = (await analyzeCorpus(db, { now: isoSeconds(APPLY) })).nationwide.communityAcquisition;
  assert.equal(pending.published.reportedSpots, 0, "rights pending: a canonical community spot is not counted as visible");
  assert.deepEqual(pending.canonicalCommunity, { communityReported: 1 });
  assert.equal(pending.prefectureCoverage.prefectures.length, 47);
  assert.deepEqual(pending.prefectureCoverage.prefectures.map((p) => p.code), PREFECTURES.map(([c]) => c));
  const tokyo = pending.prefectureCoverage.prefectures.find((p) => p.code === "13")!;
  const osaka = pending.prefectureCoverage.prefectures.find((p) => p.code === "27")!;
  const kyoto = pending.prefectureCoverage.prefectures.find((p) => p.code === "26")!;
  assert.ok(tokyo.official > 0 && osaka.official > 0 && kyoto.official > 0);
  assert.equal(pending.prefectureCoverage.prefecturesWithOfficialSpots, 3);
  assert.equal(pending.prefectureCoverage.unassigned, 0);
  assert.ok(pending.seedStationCoverage.officialOnly.covered <= pending.seedStationCoverage.allVisible.covered);
  assert.equal(pending.confirmations, null, "a canonical-only analysis reads no report store (ADR-0014)");
  assert.equal(pending.moderation, null);
  const withReports = await communityAcquisitionMetrics(db, [], { now: isoSeconds(APPLY), reportsDb: reportsOf(db) });
  assert.deepEqual(withReports.confirmations, { last7Days: 0, last30Days: 0 });
  assert.equal(withReports.moderation!.accepted, 1);

  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const granted = (await analyzeCorpus(db, { now: isoSeconds(APPLY) })).nationwide.communityAcquisition;
  assert.equal(granted.published.reportedSpots, 1);
  assert.equal(granted.published.officialVerified, pending.published.officialVerified, "official coverage is never inflated");
  assert.equal(granted.prefectureCoverage.assignedBySeedArea, 1, "the Shinjuku report is placed by the seed area it lies in");
  assert.equal(granted.prefectureCoverage.prefectures.find((p) => p.code === "13")!.communityReported, 1);
  assert.equal(granted.seedStationCoverage.allVisible.covered, pending.seedStationCoverage.allVisible.covered + 1);
  assert.equal(granted.seedStationCoverage.officialOnly.covered, pending.seedStationCoverage.officialOnly.covered);
  assert.equal(granted.spotsNeedingConfirmation, pending.spotsNeedingConfirmation + 1);
  // Far from every seed area and with no jurisdiction: unassigned, never guessed.
  const remote = { ...publishedSpots(db).find((s) => s.id === spotId)!, latitude: 44.5, longitude: 142.5 } as TileSpotV1;
  assert.equal(prefectureOf(remote), null);
  assert.ok(await communityAcquisitionMetrics(db, [remote], { now: isoSeconds(APPLY) }).then((m) => m.prefectureCoverage.unassigned === 1));
});

test("privacy: the engine adds no location history — no new device position, route, dwell time or per-user index — and findings survive redaction", async () => {
  const db = await world();
  const migration = readFileSync(new URL("../migrations/0024_community_acquisition.sql", import.meta.url), "utf8");
  const sql = migration.replace(/--.*$/gm, "");
  for (const forbidden of [/latitude/i, /longitude/i, /install/i, /device/i, /route/i, /duration/i, /dwell/i, /submitter_hash\s+TEXT/i]) {
    assert.doesNotMatch(sql, forbidden, `0024 must not store ${forbidden}`);
  }
  const spotId = anyOfficialSpot(db);
  const id = await report(db, HASHES[0], { type: "removed", spotId, note: NOTE });
  const confirm = await report(db, HASHES[0], { type: "exists", spotId });
  await applyReportRetention(reportsOf(db), { now: new Date("2027-01-01T00:00:00Z") });
  assert.deepEqual(Object.values(one(reportsOf(db), "SELECT report_type, finding, note, submitter_hash FROM reports WHERE report_id = ?", id)), ["other", "removed", null, null]);
  assert.equal(one(reportsOf(db), "SELECT submitter_hash FROM reports WHERE report_id = ?", confirm).submitter_hash, null);
  // An `exists` report names a spot, not a person's path: there is no proposed or device location on it at all.
  assert.equal(one(reportsOf(db), "SELECT proposed_latitude FROM reports WHERE report_id = ?", confirm).proposed_latitude, null);
  // The evidence views return no report date, no key and no note.
  const views = JSON.stringify([await spotEvidenceStates(reportsOf(db), db, { now: APPLY }), await correctionCandidates(reportsOf(db), db, { now: APPLY }), await duplicateCandidates(reportsOf(db), db, { now: APPLY })]);
  for (const secret of [NOTE, ...HASHES, "2026-09-21"]) assert.equal(views.includes(secret), false, secret);
});

test("absence review state machine: immutable decisions, one application per report, withdraw is terminal", async () => {
  const db = await world();
  const spotId = anyOfficialSpot(db);
  const a = await report(db, HASHES[0], { type: "notFound", spotId });
  const pending = await report(db, HASHES[1], { type: "notFound", spotId });
  const positive = await report(db, HASHES[2], { type: "exists", spotId });
  await acceptAndQueue(db, a, positive);
  await assert.rejects(proposeAbsenceReview(reportsOf(db), { reportIds: [pending], decidedBy: "r", now: APPLY }), /not accepted/);
  await assert.rejects(proposeAbsenceReview(reportsOf(db), { reportIds: [positive], decidedBy: "r", now: APPLY }), /not a notFound\/removed finding/);
  const appId = await proposeAbsence(storesOf(db), { reportIds: [a], decidedBy: "r", now: APPLY });
  await assert.rejects(proposeAbsenceReview(reportsOf(db), { reportIds: [a], decidedBy: "r", now: APPLY }), /already backs|is applied, not queued/);
  assert.throws(() => db.raw.prepare("UPDATE community_absence_applications SET decided_by = 'x'").run(), /community_absence_applications/);
  assert.throws(() => db.raw.prepare("DELETE FROM community_absence_applications").run(), /never deleted/);
  await withdrawCommunityAbsence(db, appId, { now: APPLY });
  await assert.rejects(applyCommunityAbsence(db, appId, { now: APPLY }), /withdrawn/);
  await assert.rejects(holdCommunityAbsence(db, appId, { now: APPLY }), /not applied/);
});
