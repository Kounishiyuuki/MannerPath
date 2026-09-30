// Community report reconciliation (Issue #123, migration 0020, ADR-0007 §2 amendment): queued new-spot reports
// -> reviewed immutable application -> sanitized userReport release -> ordinary resolve, all in one batch, and
// nothing personal outlives the report. The community source is blocked (Issue #124); the tests that need a
// published community spot approve the local row by hand, as a simulation of that future amendment, and say so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { isoSeconds } from "../src/db.ts";
import { COMMUNITY_ADAPTER, COMMUNITY_SOURCE_ID, communityArtifact, observeCommunityRecord } from "../src/pipeline/community-adapter.ts";
import {
  CommunityReconciliationError, applyCommunityApplication, listCommunityCandidates, proposeCommunityApplication,
  withdrawCommunityApplication,
} from "../src/pipeline/community-reconciliation.ts";
import { generateCrossSourceCandidates } from "../src/pipeline/cross-source.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { applyReviewedSourceRegistry, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { observeSourceRecord } from "../src/pipeline/source-adapter.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const count = (db: SqliteD1, table: string) => one(db, `SELECT count(*) AS n FROM ${table}`).n as number;

const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
const NOTE = "コミュニティ報告テスト用メモ ZQX-7731";
const OBSERVED = "2026-07-07";
const HASH_A = "0123456789abcdef".repeat(4);
const HASH_B = "fedcba9876543210".repeat(4);
const HASH_C = "0f1e2d3c4b5a6978".repeat(4);
const PIN = { latitude: 35.71201, longitude: 139.77701 };
const NEAR = { latitude: 35.71205, longitude: 139.77706 };

async function report(db: SqliteD1, hash: string, at = PIN, type = "missing", consent?: string): Promise<string> {
  const terms = consent === undefined ? {} : { acceptedTermsVersion: consent };
  const request = type === "missing"
    ? { schemaVersion: 1, type, proposedLocation: at, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: NOTE, observedOn: OBSERVED, ...terms }
    : { schemaVersion: 1, type, spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: NOTE, ...terms };
  const { reportId } = await createReport(db, request as any, { now: RECEIVED, attestationStatus: "notProvided", submitterHash: hash });
  return reportId;
}

async function queuedReport(db: SqliteD1, hash: string, at = PIN, consent?: string): Promise<string> {
  const id = await report(db, hash, at, "missing", consent);
  await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
  await setReconciliationState(db, id, "queued", RECEIVED);
  return id;
}

async function proposed(db: SqliteD1) {
  const a = await queuedReport(db, HASH_A, PIN);
  const b = await queuedReport(db, HASH_B, NEAR);
  const applicationId = await proposeCommunityApplication(db, { reportIds: [a, b], locationReportId: a, decidedBy: "reviewer-1", now: APPLY });
  return { a, b, applicationId };
}

const canonicalCounts = (db: SqliteD1) => Object.fromEntries(
  ["source_releases", "source_records", "source_observations", "source_entities", "spots", "spot_field_provenance", "tile_snapshot_spots"]
    .map((t) => [t, count(db, t)]),
);

const approveCommunityForSimulation = (db: SqliteD1) => db.raw.prepare(
  "UPDATE sources SET publication_status = 'approved', attribution_text = 'TEST ONLY simulated community attribution' WHERE source_id = ?",
).run(COMMUNITY_SOURCE_ID);
// TEST ONLY: simulates the legal/maintainer approval of the draft terms (Issue #124), which only a reviewed change to
// REPORT_TERMS may make in reality.
const grantTermsForSimulation = (db: SqliteD1) => db.raw.prepare(
  "UPDATE report_terms_versions SET publication_rights = 'granted' WHERE terms_version = ?",
).run(CURRENT_REPORT_TERMS.version);

// 1-3 ------------------------------------------------------------------------------------------------------
test("pending, rejected and accepted-but-not-queued reports cannot back an application", async () => {
  const db = new SqliteD1();
  const pending = await report(db, HASH_A);
  const rejected = await report(db, HASH_B);
  await recordModerationDecision(db, rejected, { state: "rejected", decidedBy: "reviewer-1", reason: "abuse", now: RECEIVED });
  const unqueued = await report(db, HASH_C);
  await recordModerationDecision(db, unqueued, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
  const good = await queuedReport(db, "1".repeat(64));

  for (const [bad, reason] of [[pending, /is pending, not accepted/], [rejected, /is rejected, not accepted/], [unqueued, /is notQueued, not queued/]] as const) {
    await assert.rejects(
      proposeCommunityApplication(db, { reportIds: [good, bad], locationReportId: good, decidedBy: "reviewer-1", now: APPLY }), reason);
  }
  // The database refuses the same link even when the module is bypassed.
  db.raw.prepare("INSERT INTO community_reconciliation_applications (application_id, claim_type, location_report_id, reconciliation_version, decided_by, decided_at, state) VALUES (?, 'newSpot', ?, 'community-reconciliation.v1', 'r', ?, 'proposed')")
    .run("ca_" + "0".repeat(26), good, isoSeconds(APPLY));
  for (const bad of [pending, rejected, unqueued]) {
    assert.throws(() => db.raw.prepare("INSERT INTO community_reconciliation_evidence (report_id, application_id) VALUES (?, ?)").run(bad, "ca_" + "0".repeat(26)),
      /not an accepted, queued, unredacted missing-spot proposal/);
  }
  // An existing-spot report type is not a new-spot proposal (moved/prohibited/closure are out of scope, Issue #123).
  const prohibited = await report(db, HASH_A, PIN, "prohibited");
  await recordModerationDecision(db, prohibited, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
  await setReconciliationState(db, prohibited, "queued", RECEIVED);
  await assert.rejects(proposeCommunityApplication(db, { reportIds: [good, prohibited], locationReportId: good, decidedBy: "r", now: APPLY }), /not a new-spot proposal/);
  assert.equal(count(db, "source_releases"), 0);
});

// 4-6 ------------------------------------------------------------------------------------------------------
test("queued accepted reports become candidates; one submitter twice is not independent; independent reports group", async () => {
  const db = new SqliteD1();
  const a = await queuedReport(db, HASH_A, PIN);
  const b = await queuedReport(db, HASH_B, NEAR);
  const sameAsA = await queuedReport(db, HASH_A, NEAR);
  const far = await queuedReport(db, HASH_C, { latitude: 35.8, longitude: 139.9 });

  await assert.rejects(listCommunityCandidates(db, { withinMetres: 0, now: APPLY }), /explicit positive grouping radius/);
  const groups = await listCommunityCandidates(db, { withinMetres: 50, now: APPLY });
  const near = groups.find((g) => g.reportIds.includes(a))!;
  assert.deepEqual(new Set(near.reportIds), new Set([a, b, sameAsA]));
  assert.equal(near.distinctSubmitters, 2, "two reports of one submitter count once");
  assert.ok(near.maxPairDistanceMetres > 0 && near.maxPairDistanceMetres < 50);
  assert.deepEqual(groups.find((g) => g.reportIds.includes(far))!.reportIds, [far]);
  assert.doesNotMatch(JSON.stringify(groups), new RegExp(`${HASH_A}|${HASH_B}|${NOTE}|${OBSERVED}`), "no submitter key, note or date is shown");

  await assert.rejects(proposeCommunityApplication(db, { reportIds: [a, sameAsA], locationReportId: a, decidedBy: "r", now: APPLY }), /same submitter/);
  await assert.rejects(proposeCommunityApplication(db, { reportIds: [a], locationReportId: a, decidedBy: "r", now: APPLY }), /needs at least 2/);
  await assert.rejects(proposeCommunityApplication(db, { reportIds: [a, b], locationReportId: far, decidedBy: "r", now: APPLY }), /adopted location must be one of/);
  const id = await proposeCommunityApplication(db, { reportIds: [a, b], locationReportId: b, decidedBy: "reviewer-1", now: APPLY });
  assert.match(id, /^ca_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(count(db, "source_releases"), 0, "an application changes nothing canonical");
  assert.equal(one(db, "SELECT state FROM community_reconciliation_applications").state, "proposed");
  // Grouped, linked reports leave the candidate list.
  assert.equal((await listCommunityCandidates(db, { withinMetres: 50, now: APPLY })).some((g) => g.reportIds.includes(a)), false);
});

// 7, 8, 16 (blocked half), 18 ------------------------------------------------------------------------------
test("apply writes one sanitized userReport release and spot in one batch; nothing personal reaches evidence", async () => {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  const before = await publishTiles(db, { now: isoSeconds(RECEIVED) });
  const { a, b, applicationId } = await proposed(db);

  const result = await applyCommunityApplication(db, applicationId, { now: APPLY, newSpotId: sequentialSpotIds("C") });
  assert.equal(result.status, "applied");
  const spotId = (result as { spotId: string }).spotId;

  const release = one(db, "SELECT * FROM source_releases WHERE release_id = ?", result.releaseId);
  assert.deepEqual([release.source_id, release.status, release.is_current, release.observed_on, release.record_count], [COMMUNITY_SOURCE_ID, "applied", 0, null, 1]);
  const record = one(db, "SELECT * FROM source_records WHERE release_id = ?", result.releaseId);
  assert.deepEqual(JSON.parse(record.raw_values_json),
    [applicationId, "newSpot", String(PIN.latitude), String(PIN.longitude), [a, b].sort().join(" "), "community-reconciliation.v1", ""],
    "reports stored without consent leave the rights basis empty (Issue #124)");
  const spot = one(db, "SELECT * FROM spots WHERE spot_id = ?", spotId);
  assert.deepEqual([spot.latitude, spot.longitude, spot.evidence_quality, spot.last_verified_at, spot.name, spot.supports_paper, spot.opening_hours_status],
    [PIN.latitude, PIN.longitude, "communityReviewed", null, null, "unknown", "none"]);
  assert.deepEqual(all(db, "SELECT field, rule FROM spot_field_provenance WHERE spot_id = ? ORDER BY field", spotId).map((p) => p.field), ["existence", "lifecycle", "location"]);
  assert.deepEqual(all(db, "SELECT reconciliation_state FROM report_moderation WHERE report_id IN (?, ?)", a, b).map((r) => r.reconciliation_state), ["applied", "applied"]);
  assert.deepEqual(one(db, "SELECT state, release_id FROM community_reconciliation_applications"), { state: "applied", release_id: result.releaseId });

  // Free text, submitter keys and the observation date exist only in the report tables.
  const reportTables = new Set(["reports", "report_moderation", "report_rate_windows"]);
  for (const { name } of all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'")) {
    if (reportTables.has(name)) continue;
    const dump = JSON.stringify(all(db, `SELECT * FROM ${name}`));
    assert.ok(!dump.includes(NOTE), `${name} holds report free text`);
    for (const h of [HASH_A, HASH_B]) assert.ok(!dump.includes(h), `${name} holds a submitter hash`);
  }
  const communityEvidence = JSON.stringify([release, record, spot, all(db, "SELECT * FROM source_observations WHERE record_id = ?", record.record_id)]);
  assert.ok(!communityEvidence.includes(OBSERVED), "the report's observation date is not evidence");

  // Blocked source: the spot exists canonically but is not published; municipal publication is unchanged.
  const after = await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(count(db, "tile_snapshot_spots"), before.published.reduce((n, t) => n + t.spotCount, 0));
  assert.ok(after.excluded.some((e: any) => JSON.stringify(e).includes(COMMUNITY_SOURCE_ID)));
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n, 0);
  assert.equal((await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).status, 404);
});

// 9 --------------------------------------------------------------------------------------------------------
test("a report redacted (or past its deadline) before apply fails closed and writes nothing", async () => {
  const db = new SqliteD1();
  const { applicationId } = await proposed(db);
  const late = new Date(minimizeAfter(RECEIVED).getTime() + 1000);
  const counts = canonicalCounts(db);
  await assert.rejects(applyCommunityApplication(db, applicationId, { now: late }), /past its minimization deadline/);
  await applyReportRetention(db, { now: late });
  await assert.rejects(applyCommunityApplication(db, applicationId, { now: APPLY }), /is redacted/);
  assert.deepEqual(canonicalCounts(db), counts);
  assert.equal(one(db, "SELECT state FROM community_reconciliation_applications").state, "proposed");
});

// 10, 11 ---------------------------------------------------------------------------------------------------
test("apply is idempotent, and a report can never back a second application", async () => {
  const db = new SqliteD1();
  const { a, b, applicationId } = await proposed(db);
  const first = await applyCommunityApplication(db, applicationId, { now: APPLY });
  const counts = canonicalCounts(db);
  assert.deepEqual(await applyCommunityApplication(db, applicationId, { now: APPLY }), { status: "alreadyApplied", releaseId: first.releaseId });
  assert.deepEqual(canonicalCounts(db), counts);

  const c = await queuedReport(db, HASH_C, NEAR);
  await assert.rejects(proposeCommunityApplication(db, { reportIds: [b, c], locationReportId: c, decidedBy: "r", now: APPLY }), /is applied, not queued/);
  // Withdrawn is terminal, and its reports stay spent.
  const d = await queuedReport(db, "2".repeat(64), NEAR);
  const e = await queuedReport(db, "3".repeat(64), NEAR);
  const withdrawn = await proposeCommunityApplication(db, { reportIds: [d, e], locationReportId: d, decidedBy: "r", now: APPLY });
  assert.throws(() => db.raw.prepare("UPDATE community_reconciliation_applications SET decided_by = 'x' WHERE application_id = ?").run(withdrawn), /immutable|only proposed/);
  await withdrawCommunityApplication(db, withdrawn, { now: APPLY });
  await assert.rejects(applyCommunityApplication(db, withdrawn, { now: APPLY }), /was withdrawn/);
  await assert.rejects(proposeCommunityApplication(db, { reportIds: [c, d], locationReportId: c, decidedBy: "r", now: APPLY }), /already backs application/);
  assert.throws(() => db.raw.prepare("INSERT INTO community_reconciliation_evidence (report_id, application_id) VALUES (?, ?)").run(a, withdrawn), /UNIQUE|PRIMARY KEY|not proposed|not an accepted/);
  assert.throws(() => db.raw.prepare("UPDATE community_reconciliation_applications SET state = 'withdrawn', withdrawn_at = 'x' WHERE application_id = ?").run(applicationId), /only proposed/);
  assert.throws(() => db.raw.prepare("DELETE FROM community_reconciliation_evidence").run(), /never deleted/);
});

// 12 -------------------------------------------------------------------------------------------------------
test("a stale application is rejected before any write, and the database re-checks the premise inside the batch", async () => {
  const db = new SqliteD1();
  const { b, applicationId } = await proposed(db);
  await setReconciliationState(db, b, "discarded", APPLY);
  const counts = canonicalCounts(db);
  await assert.rejects(applyCommunityApplication(db, applicationId, { now: APPLY }), CommunityReconciliationError);
  assert.deepEqual(canonicalCounts(db), counts);

  // Module bypassed: the release exists, but the application cannot become applied on a stale premise, and the
  // release cannot become applied without it.
  await ensureReviewedSource(db, COMMUNITY_SOURCE_ID, isoSeconds(APPLY));
  const { releaseId } = await ingestRelease(db, COMMUNITY_ADAPTER, communityArtifact({
    applicationId, latitude: PIN.latitude, longitude: PIN.longitude, reportIds: [b, "rp_" + "1".repeat(26)], version: "community-reconciliation.v1",
  }), { sourceUrl: "urn:test", observedOn: null, fetchedAt: isoSeconds(APPLY), httpLastModified: null });
  assert.throws(() => db.raw.prepare("UPDATE community_reconciliation_applications SET state = 'applied', release_id = ?, applied_at = ? WHERE application_id = ?")
    .run(releaseId, isoSeconds(APPLY), applicationId), /no longer accepted, queued and unredacted/);
});

// 13 -------------------------------------------------------------------------------------------------------
test("the community artifact accepts only plain in-range decimals and its own shape", () => {
  const row = (lat: string, lon: string) => ["ca_" + "0".repeat(26), "newSpot", lat, lon, `rp_${"0".repeat(26)} rp_${"1".repeat(26)}`, "community-reconciliation.v1"];
  assert.equal(observeSourceRecord(COMMUNITY_ADAPTER, row("35.71201", "139.77701")).latitude, 35.71201);
  for (const [lat, lon] of [["91", "139"], ["35", "181"], ["NaN", "139"], ["1e1", "139"], ["", "139"], [" 35", "139"], ["35.", "139"]]) {
    assert.throws(() => observeSourceRecord(COMMUNITY_ADAPTER, row(lat, lon)), /community|out-of-range/, `${lat},${lon}`);
  }
  assert.throws(() => observeCommunityRecord([...row("35", "139").slice(0, 4), `rp_${"0".repeat(26)}`, "community-reconciliation.v1"]), /at least two reports/);
  assert.throws(() => COMMUNITY_ADAPTER.parse(new TextEncoder().encode("application_id,note\nx,y\n")), /unexpected header/);
});

// 14, 15 ---------------------------------------------------------------------------------------------------
test("the userReport source comes only from the reviewed registry, and nothing reaches canonical data around the review", async () => {
  const db = new SqliteD1();
  await assert.rejects(ensureReviewedSource(db, "some-community-source", isoSeconds(APPLY)), /not a reviewed source/);
  await ensureReviewedSource(db, COMMUNITY_SOURCE_ID, isoSeconds(APPLY));
  assert.deepEqual(one(db, "SELECT kind, publication_status, attribution_text FROM sources WHERE source_id = ?", COMMUNITY_SOURCE_ID),
    { kind: "userReport", publication_status: "blocked", attribution_text: null });
  // A hand-approved row is put back to the reviewed status by the registry upgrade path.
  approveCommunityForSimulation(db);
  assert.equal((await applyReviewedSourceRegistry(db, COMMUNITY_SOURCE_ID, isoSeconds(APPLY))).publicationStatus, "blocked");

  // A community release resolved without an applied application is refused by the database, and nothing is written.
  const { releaseId } = await ingestRelease(db, COMMUNITY_ADAPTER, communityArtifact({
    applicationId: "ca_" + "2".repeat(26), latitude: 35.7, longitude: 139.7, reportIds: ["rp_" + "1".repeat(26), "rp_" + "2".repeat(26)],
    version: "community-reconciliation.v1",
  }), { sourceUrl: "urn:test", observedOn: null, fetchedAt: isoSeconds(APPLY), httpLastModified: null });
  await assert.rejects(resolveFirstRelease(db, COMMUNITY_ADAPTER, releaseId, { now: isoSeconds(APPLY) }), /applied only by its applied reconciliation application/);
  assert.equal(count(db, "spots"), 0);
  assert.throws(() => db.raw.prepare("UPDATE source_releases SET status = 'applied', applied_at = ?, is_current = 1 WHERE release_id = ?").run(isoSeconds(APPLY), releaseId), /userReport release/);

  // `applied` cannot be set by hand on a report, and the moderation module does not offer it.
  const r = await queuedReport(db, HASH_A);
  assert.throws(() => db.raw.prepare("UPDATE report_moderation SET reconciliation_state = 'applied' WHERE report_id = ?").run(r), /illegal reconciliation transition/);
  await assert.rejects(setReconciliationState(db, r, "applied" as never, APPLY), /illegal reconciliation transition queued -> applied/);

  // Static boundary: the report slice writes no canonical table, and reconciliation writes spots only via resolve.
  for (const file of ["create.ts", "moderation.ts", "retention.ts", "dto.ts"]) {
    const src = readFileSync(new URL(`../src/reports/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /(INSERT INTO|UPDATE|DELETE FROM) (spots|spot_field_provenance|source_records|source_releases|tile_snapshot)/, file);
  }
  const reconciliation = readFileSync(new URL("../src/pipeline/community-reconciliation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(reconciliation, /(INSERT INTO|UPDATE) (spots|spot_field_provenance|spot_source_entities|source_records|tile_snapshot)/);
});

// 16, 17, 19 (simulated approval) --------------------------------------------------------------------------
test("simulated approval: a community spot passes the ordinary publication gate, carries its evidence label, and meets municipal spots only as a cross-source candidate", async () => {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  const taito = one(db, `SELECT s.spot_id, s.latitude, s.longitude FROM spots s JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
    JOIN source_records r ON r.record_id = p.record_id JOIN source_releases rel ON rel.release_id = r.release_id
    WHERE rel.source_id = 'taito-public-smoking-areas' AND s.publication_hold IS NULL ORDER BY s.spot_id LIMIT 1`);
  const nearTaito = { latitude: Math.round((taito.latitude + 0.0002) * 1e5) / 1e5, longitude: taito.longitude };
  const a = await queuedReport(db, HASH_A, nearTaito, CURRENT_REPORT_TERMS.version);
  const b = await queuedReport(db, HASH_B, nearTaito, CURRENT_REPORT_TERMS.version);
  const applicationId = await proposeCommunityApplication(db, { reportIds: [a, b], locationReportId: a, decidedBy: "reviewer-1", now: APPLY });
  const { spotId } = await applyCommunityApplication(db, applicationId, { now: APPLY, newSpotId: sequentialSpotIds("C") }) as { spotId: string };

  // Blocked: no cross-source candidate either, because recall reads approved sources only.
  assert.equal((await generateCrossSourceCandidates(db, { now: isoSeconds(APPLY) })).length > 0
    && all(db, "SELECT 1 FROM cross_source_candidates WHERE ? IN (spot_a_id, spot_b_id)", spotId).length > 0, false);

  approveCommunityForSimulation(db);
  // Source approved, terms still the draft: the rights gate holds the spot back (Issue #124).
  const draft = await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(draft.excluded.some((e) => e.sourceId === COMMUNITY_SOURCE_ID && e.publicationStatus === "rightsNotGranted"));
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n, 0);
  grantTermsForSimulation(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n, 1, "passes the ordinary publication trigger");
  const detail = await (await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).json() as any;
  assert.equal(detail.spot.evidenceQuality, "communityReviewed");
  assert.equal(detail.spot.evidenceQualityVersion, "evidence-quality.v2");
  assert.equal(detail.spot.lastVerifiedAt, null);
  assert.ok(JSON.stringify(detail).includes("TEST ONLY simulated community attribution"));
  const tile = one(db, "SELECT body_json FROM tile_snapshots t JOIN tile_snapshot_spots s ON s.tile_id = t.tile_id WHERE s.spot_id = ?", spotId);
  assert.ok(tile.body_json.includes('"evidenceQuality":"communityReviewed"'));

  await generateCrossSourceCandidates(db, { now: isoSeconds(APPLY) });
  const candidate = one(db, "SELECT * FROM cross_source_candidates WHERE ? IN (spot_a_id, spot_b_id) AND ? IN (spot_a_id, spot_b_id)", spotId, taito.spot_id);
  assert.ok(candidate, "community + municipal overlap is a cross-source candidate");
  assert.match(candidate.reasons_json, /proximity100m/);
  assert.equal(count(db, "cross_source_merge_applications"), 0, "never merged automatically");
  assert.deepEqual(all(db, "SELECT merged_into FROM spots WHERE spot_id IN (?, ?)", spotId, taito.spot_id).map((s) => s.merged_into), [null, null]);
});

// 20 -------------------------------------------------------------------------------------------------------
test("promotion: report and reconciliation tables never travel; a blocked community release is left out, and a published one is refused", async () => {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  const { a, b, applicationId } = await proposed(db);
  const { releaseId, spotId } = await applyCommunityApplication(db, applicationId, { now: APPLY, newSpotId: sequentialSpotIds("C") }) as { releaseId: number; spotId: string };
  await publishTiles(db, { now: isoSeconds(APPLY) });

  const bundle = await buildMultiSourcePromotionBundle(db);
  assert.equal(bundle.manifest.sources.some((s: any) => s.sourceId === COMMUNITY_SOURCE_ID), false, "an additive release is never current");
  for (const needle of [COMMUNITY_SOURCE_ID, applicationId, a, b, spotId, NOTE, HASH_A, "INSERT INTO reports", "INSERT INTO report_moderation", "community_reconciliation"]) {
    assert.ok(!bundle.sql.includes(needle), `bundle carries ${needle}`);
  }
  // Naming the community release is refused (not current, not approved); so is a published community spot.
  await assert.rejects(buildMultiSourcePromotionBundle(db, { releaseIds: [releaseId] }), /not its source's current release|blocked|not approved/);
  // A hand-approved row alone publishes nothing (no consent, terms not granted) and adds nothing to the bundle:
  // the reviewed registry in code still says blocked. The approved simulation is test/community-publication-readiness.test.ts.
  approveCommunityForSimulation(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n, 0);
  assert.equal((await buildMultiSourcePromotionBundle(db)).sql, bundle.sql, "a blocked community source leaves the bundle bytes unchanged");
  await assert.rejects(buildMultiSourcePromotionBundle(db, { releaseIds: [releaseId] }), /not approved in REVIEWED_SOURCES/);
});
