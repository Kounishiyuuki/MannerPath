// Coverage-first multi-confidence listing model (ADR-0012, migration 0023). Lower-confidence spots may be visible,
// but every published spot carries its separate trust axes — existence evidence, location precision, review month,
// spot taxonomy and access — and no axis is ever stated above its evidence.
//
// Reports live in the durable REPORTS_DB paired with each canonical test database (test/support/community.ts,
// ADR-0014); the canonical side sees only imported, sanitized review artifacts.
//
// The community source is BLOCKED and the report terms are a DRAFT (Issue #124 is open). Every test that needs a
// published community spot simulates the future approval explicitly — the local rows by hand and the reviewed lists
// through the injection points only tests use — and says so. Nothing here approves anything for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { isoSeconds } from "../src/db.ts";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { applyCommunityEffect, holdCommunityEffect } from "../src/pipeline/community-effects.ts";
import { applyCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { importCommunityArtifact } from "../src/pipeline/community-artifact.ts";
import { sealArtifact } from "../src/reports/evidence-artifact.ts";
import { proposeNewSpotReview } from "../src/reports/review.ts";
import { upgradeCommunityEvidence } from "../src/pipeline/community-verification.ts";
import { generateCrossSourceCandidates } from "../src/pipeline/cross-source.ts";
import { type PromotionRegistry, buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { spotFreshness } from "../src/quality/freshness.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { CURRENT_REPORT_TERMS, reviewedTerms } from "../src/reports/terms.ts";
import { TileBodyV1, type TileSpotV1 } from "../src/tiles/dto.ts";
import { type CandidateRow, publishTiles, verificationDto } from "../src/tiles/publish.ts";
import { TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite, reportsD1 } from "./support/sqlite-d1.ts";
import { proposeConfirmation, proposeEffect, proposeNewSpot, reportsOf, storesOf } from "./support/community.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];

const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
const LATER = new Date("2026-10-02T03:00:00Z");
const TERMS = CURRENT_REPORT_TERMS.version;
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const NOTE = "多信頼度テスト用メモ MCF-4471";
const HOST_NAME = "テスト用店舗名 HNQ-0192";
const HOURS_NOTE = "平日のみ HRS-5530";
const HASHES = ["0123456789abcdef", "fedcba9876543210", "0f1e2d3c4b5a6978", "1111222233334444"].map((h) => h.repeat(4));
const SIM_ATTRIBUTION = "TEST ONLY simulated community attribution";
// Away from every reviewed fixture's spots, so a community pin is its own place unless a test says otherwise.
const HERE = { latitude: 35.60001, longitude: 139.60001 };

// ---- simulation of the future approval (TEST ONLY) -----------------------------------------------------------
// A granted community source will need its reviewed terms named as its license, like every published source.
const approveSourceRow = (db: SqliteD1) => db.raw.prepare(
  `UPDATE sources SET publication_status = 'approved', attribution_text = ?, license_name = 'TEST ONLY simulated report terms',
     license_url = 'https://example.invalid/report-terms' WHERE source_id = ?`,
).run(SIM_ATTRIBUTION, COMMUNITY_SOURCE_ID);
const grantTerms = (db: SqliteD1) => db.raw.prepare(
  "UPDATE report_terms_versions SET publication_rights = 'granted' WHERE terms_version = ?",
).run(TERMS);
const simulateRightsGranted = (db: SqliteD1) => { approveSourceRow(db); grantTerms(db); };
const SIMULATED_REGISTRY: PromotionRegistry = {
  source: (id) => id === COMMUNITY_SOURCE_ID
    ? { ...COMMUNITY_REGISTRY, publicationStatus: "approved", attributionText: SIM_ATTRIBUTION,
        licenseName: "TEST ONLY simulated report terms", licenseUrl: "https://example.invalid/report-terms" }
    : reviewedSource(id),
  terms: (v) => ({ ...reviewedTerms(v), publicationRights: "granted" }),
};

// ---- reports ----------------------------------------------------------------------------------------------
type Claim = Record<string, string>;

async function newSpotReport(db: SqliteD1, hash: string, claim: Claim | null, opts: { at?: typeof HERE; consent?: boolean } = {}) {
  const request = {
    schemaVersion: 1, type: "missing", proposedLocation: opts.at ?? HERE, installId: INSTALL, note: NOTE,
    ...(opts.consent === false ? {} : { acceptedTermsVersion: TERMS }),
    ...(claim === null ? {} : { claim }),
  };
  const { reportId } = await createReport(reportsOf(db), request as any, { now: RECEIVED, attestationStatus: "notProvided", submitterHash: hash });
  return reportId;
}

async function existingSpotReport(db: SqliteD1, hash: string, spotId: string, type: "exists" | "prohibited") {
  const request = { schemaVersion: 1, type, spotId, installId: INSTALL, note: NOTE, acceptedTermsVersion: TERMS };
  const { reportId } = await createReport(reportsOf(db), request as any, { now: RECEIVED, attestationStatus: "notProvided", submitterHash: hash });
  return reportId;
}

async function acceptAndQueue(db: SqliteD1, ...ids: string[]) {
  for (const id of ids) {
    await recordModerationDecision(reportsOf(db), id, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
    await setReconciliationState(reportsOf(db), id, "queued", RECEIVED);
  }
}

async function reportedSpot(db: SqliteD1, claim: Claim, prefix = "R", hash = HASHES[0], at = HERE) {
  const id = await newSpotReport(db, hash, claim, { at });
  await acceptAndQueue(db, id);
  const applicationId = await proposeNewSpot(storesOf(db), { reportIds: [id], locationReportId: id, decidedBy: "reviewer-1", now: APPLY, tier: "communityReported" });
  const result = await applyCommunityApplication(db, applicationId, { now: APPLY, newSpotId: sequentialSpotIds(prefix) }) as { spotId: string; releaseId: number };
  return { ...result, reportId: id };
}

async function verifiedSpot(db: SqliteD1, claims: [Claim | null, Claim | null], prefix = "V", at = HERE) {
  const a = await newSpotReport(db, HASHES[0], claims[0], { at });
  const b = await newSpotReport(db, HASHES[1], claims[1], { at });
  await acceptAndQueue(db, a, b);
  const applicationId = await proposeNewSpot(storesOf(db), { reportIds: [a, b], locationReportId: a, decidedBy: "reviewer-1", now: APPLY });
  return await applyCommunityApplication(db, applicationId, { now: APPLY, newSpotId: sequentialSpotIds(prefix) }) as { spotId: string; releaseId: number };
}

async function world() {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  await publishTiles(db, { now: isoSeconds(RECEIVED) });
  return db;
}

const published = (db: SqliteD1, spotId: string) => one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n === 1;
async function tileSpot(db: SqliteD1, spotId: string): Promise<TileSpotV1> {
  const { body_json } = one(db, "SELECT t.body_json FROM tile_snapshots t JOIN tile_snapshot_spots s ON s.tile_id = t.tile_id WHERE s.spot_id = ?", spotId);
  return TileBodyV1.parse(JSON.parse(body_json)).spots.find((s) => s.id === spotId)!;
}
const detail = async (db: SqliteD1, spotId: string) => (await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).json() as Promise<Row>;

const ASHTRAY_AT_STORE: Claim = { spotType: "ashtray", hostType: "convenienceStore", environment: "outdoor", accessType: "public" };
const SMOKING_CAFE: Claim = { spotType: "smokingPermittedVenue", hostType: "restaurantOrCafe", accessType: "customerOnly", environment: "indoor" };

// =============================================================================================================
// 1, 20, 30 — official spots stay exactly official
test("official spots remain official: officialListing, publisherPoint, no confirmation count, review month from the release", async () => {
  const db = await world();
  const spots = all(db, "SELECT body_json FROM tile_snapshots").flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
  assert.ok(spots.length > 0);
  for (const s of spots) {
    assert.equal(s.evidenceQuality, "officialListing");
    assert.equal(s.evidenceQualityVersion, "evidence-quality.v1", "the six reviewed sources keep their v1 value");
    assert.deepEqual(s.verification, {
      version: "spot-verification.v1", existence: "official", locationPrecision: "publisherPoint", confirmations: null,
      lastReviewedMonth: s.lastVerifiedAt?.slice(0, 7) ?? null,
    });
    assert.deepEqual([s.spotSubtype, s.hostType, s.accessDetail], [null, "unknown", null], "no official source states them, so nothing is inferred");
  }
});

// 2, 7, 10, 13, 14, 24
test("one moderated, explicit convenience-store ashtray report becomes a communityReported listing — visible only once rights are granted", async () => {
  const db = await world();
  const { spotId, releaseId } = await reportedSpot(db, ASHTRAY_AT_STORE);
  const spot = one(db, "SELECT * FROM spots WHERE spot_id = ?", spotId);
  assert.deepEqual([spot.spot_type, spot.host_type, spot.environment, spot.access_type, spot.evidence_quality, spot.evidence_quality_version,
    spot.community_confirmations, spot.last_reviewed_on, spot.last_verified_at],
  ["ashtray", "convenienceStore", "outdoor", "public", "communityReported", "evidence-quality.v3", 1, "2026-09-25", null]);
  const record = JSON.parse(one(db, "SELECT raw_values_json FROM source_records WHERE release_id = ?", releaseId).raw_values_json);
  assert.equal(record[6], TERMS, "the rights basis stays at the index 0021 reads");
  assert.deepEqual(record.slice(7, 9), ["communityReported", "1"]);

  // 14: blocked (#124) — canonical, never published.
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), false);
  assert.equal((await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).status, 404);
  approveSourceRow(db);
  const draft = await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(draft.excluded.some((e) => e.sourceId === COMMUNITY_SOURCE_ID && e.publicationStatus === "rightsNotGranted"), "draft terms still hold it back");
  assert.equal(published(db, spotId), false);

  // 13: rights simulated granted — visible, and labelled for what it is.
  grantTerms(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const t = await tileSpot(db, spotId);
  assert.deepEqual([t.spotType, t.hostType, t.environment, t.accessType, t.evidenceQuality, t.lastVerifiedAt],
    ["ashtray", "convenienceStore", "outdoor", "public", "communityReported", null]);
  assert.deepEqual(t.verification, { version: "spot-verification.v1", existence: "communityReported", locationPrecision: "communityPinned", confirmations: 1, lastReviewedMonth: "2026-09" });
  // 24: the detail endpoint repeats the tile spot field for field.
  const d = await detail(db, spotId);
  const { tile, ...detailSpot } = d.spot;
  assert.deepEqual(detailSpot, t);
  assert.equal(tile, one(db, "SELECT tile_id FROM spots WHERE spot_id = ?", spotId).tile_id);
  assert.deepEqual(d.provenance.map((p: Row) => p.field).sort(), ["accessType", "environment", "existence", "hostType", "lifecycle", "location", "spotType"]);
});

// 3
test("raw or unmoderated reports stay invisible: a pending, rejected or unqueued report cannot become a listing", async () => {
  const db = await world();
  const pending = await newSpotReport(db, HASHES[0], ASHTRAY_AT_STORE);
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [pending], locationReportId: pending, decidedBy: "r", now: APPLY, tier: "communityReported" }), /not accepted/);
  const rejected = await newSpotReport(db, HASHES[1], ASHTRAY_AT_STORE);
  await recordModerationDecision(reportsOf(db), rejected, { state: "rejected", decidedBy: "r", reason: "insufficientDetail", now: RECEIVED });
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [rejected], locationReportId: rejected, decidedBy: "r", now: APPLY, tier: "communityReported" }), /not accepted/);
  const accepted = await newSpotReport(db, HASHES[2], ASHTRAY_AT_STORE);
  await recordModerationDecision(reportsOf(db), accepted, { state: "accepted", decidedBy: "r", reason: "confirmed", now: RECEIVED });
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [accepted], locationReportId: accepted, decidedBy: "r", now: APPLY, tier: "communityReported" }), /not queued/);
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(one(db, "SELECT count(*) AS n FROM spots s JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence' JOIN source_records r ON r.record_id = p.record_id JOIN source_releases rel ON rel.release_id = r.release_id WHERE rel.source_id = ?", COMMUNITY_SOURCE_ID).n, 0);
});

// 4, 5
test("two independent reports verify; one submitter twice does not", async () => {
  const db = await world();
  const { spotId } = await verifiedSpot(db, [ASHTRAY_AT_STORE, ASHTRAY_AT_STORE]);
  assert.deepEqual(Object.values(one(db, "SELECT evidence_quality, community_confirmations, spot_type FROM spots WHERE spot_id = ?", spotId)),
    ["communityVerified", 2, "ashtray"]);

  const a = await newSpotReport(db, HASHES[2], ASHTRAY_AT_STORE, { at: { latitude: 35.5, longitude: 139.5 } });
  const again = await newSpotReport(db, HASHES[2], ASHTRAY_AT_STORE, { at: { latitude: 35.5, longitude: 139.5 } });
  await acceptAndQueue(db, a, again);
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [a, again], locationReportId: a, decidedBy: "r", now: APPLY }), /same submitter/);
  // Nor can a single report be applied as verified, or two reports as reported.
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [a], locationReportId: a, decidedBy: "r", now: APPLY }), /needs at least 2/);
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [a, again], locationReportId: a, decidedBy: "r", now: APPLY, tier: "communityReported" }), /exactly one report/);
});

// 6, 8
test("a host business alone is never a smoking place: no convenience store or café becomes a listing, and no type is inferred", async () => {
  const db = await world();
  for (const [hash, claim] of [[HASHES[0], { spotType: "unknown", hostType: "convenienceStore" }], [HASHES[1], { spotType: "unknown", hostType: "restaurantOrCafe" }]] as const) {
    const id = await newSpotReport(db, hash, claim);
    await acceptAndQueue(db, id);
    await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [id], locationReportId: id, decidedBy: "r", now: APPLY, tier: "communityReported" }),
      /states no known spot type/);
  }
  // A report without any claim (every client before ADR-0012) cannot be a single-report listing either.
  const bare = await newSpotReport(db, HASHES[2], null);
  await acceptAndQueue(db, bare);
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [bare], locationReportId: bare, decidedBy: "r", now: APPLY, tier: "communityReported" }), /states no known spot type/);
  // A hand-built artifact that skips the review (its digest is valid: a digest proves integrity, not a review) is still
  // refused by the canonical guards inside the apply batch.
  const app1 = "ca_" + "7".repeat(26);
  const forged = await sealArtifact({
    artifact: "mannerpath.community-evidence", artifactSchemaVersion: 1, reportStoreSchema: "reports-store.v1",
    review: { reviewId: app1, kind: "newSpot", reviewKey: `newSpot:${bare}`, decisionVersion: 1, ruleVersion: "community-reconciliation.v1", decidedBy: "r",
      decidedAt: isoSeconds(APPLY), subjectSpotId: null, reportType: null, evidenceTier: "communityReported", locationReportId: bare },
    termsVersion: TERMS,
    independence: { version: "community-independence.v1", evidenceCount: 1, independentSubmitters: 1, baseReportIds: null, baseIndependentSubmitters: null, confirmationsAfter: null },
    evidence: [{ reportId: bare, reportType: "missing", finding: null, subjectSpotId: null, latitude: HERE.latitude, longitude: HERE.longitude, acceptedTermsVersion: TERMS,
      claims: { spotType: null, spotSubtype: null, accessType: null, accessDetail: null, hostType: null, environment: null, supportsPaper: null, supportsHeated: null },
      usableUntil: "2026-12-20" }],
  });
  assert.equal((await importCommunityArtifact(db, forged.bytes, { now: APPLY })).status, "imported");
  await assert.rejects(applyCommunityApplication(db, app1, { now: APPLY }), /no known spot type/);

  // Corroborated reports that agree only on the host: the spot exists (two people said a smoking place is here), but
  // its type stays unknown — being a café is not evidence of a smoking-permitted venue.
  const { spotId } = await verifiedSpot(db, [{ spotType: "unknown", hostType: "restaurantOrCafe" }, { spotType: "unknown", hostType: "restaurantOrCafe" }], "K",
    { latitude: 35.51, longitude: 139.51 });
  assert.deepEqual(Object.values(one(db, "SELECT spot_type, host_type, access_type FROM spots WHERE spot_id = ?", spotId)), ["unknown", "restaurantOrCafe", "unknown"]);
});

// 9, 10, 11, 12
test("explicit claims round-trip: smoking-permitted café, customersOnly access, unknown access, tobacco-shop subtype, ticketed access", async () => {
  const db = await world();
  const cafe = await reportedSpot(db, SMOKING_CAFE, "A", HASHES[0], { latitude: 35.52, longitude: 139.52 });
  const unknownAccess = await reportedSpot(db, { spotType: "designatedOutdoorArea" }, "B", HASHES[1], { latitude: 35.53, longitude: 139.53 });
  const shop = await reportedSpot(db, { spotType: "smokingPermittedVenue", spotSubtype: "tobaccoShopSmokingSpace", hostType: "tobaccoShop", supportsHeated: "yes" }, "C", HASHES[2], { latitude: 35.54, longitude: 139.54 });
  const stadium = await reportedSpot(db, { spotType: "facilitySmokingRoom", spotSubtype: "smokingCorner", accessType: "facilityOnly", accessDetail: "ticketedUsersOnly", hostType: "other" }, "D", HASHES[3], { latitude: 35.55, longitude: 139.55 });
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });

  const c = await tileSpot(db, cafe.spotId);
  assert.deepEqual([c.spotType, c.hostType, c.accessType, c.accessDetail, c.environment], ["smokingPermittedVenue", "restaurantOrCafe", "customerOnly", null, "indoor"]);
  const u = await tileSpot(db, unknownAccess.spotId);
  assert.deepEqual([u.accessType, u.hostType, u.environment, u.supportsPaper], ["unknown", "unknown", "unknown", "unknown"], "unstated stays unknown");
  const s = await tileSpot(db, shop.spotId);
  assert.deepEqual([s.spotType, s.spotSubtype, s.hostType, s.supportsHeated, s.supportsPaper], ["smokingPermittedVenue", "tobaccoShopSmokingSpace", "tobaccoShop", "yes", "unknown"]);
  const t = await tileSpot(db, stadium.spotId);
  assert.deepEqual([t.spotType, t.spotSubtype, t.accessType, t.accessDetail], ["facilitySmokingRoom", "smokingCorner", "facilityOnly", "ticketedUsersOnly"]);
});

test("the report API accepts a structured claim only on a new-spot report, and validates it", async () => {
  const db = reportsD1();
  const post = (body: unknown) => app.request("/v1/reports", { method: "POST", body: JSON.stringify(body) }, { DB: new SqliteD1(), REPORTS_DB: db } as any);
  const base = { schemaVersion: 1, type: "missing", proposedLocation: HERE, installId: INSTALL, acceptedTermsVersion: TERMS };
  const ok = await post({ ...base, claim: { ...ASHTRAY_AT_STORE, hostName: HOST_NAME, hoursNote: HOURS_NOTE, supportsPaper: "yes" } });
  assert.equal(ok.status, 201);
  assert.deepEqual(Object.values(one(db, "SELECT claim_spot_type, claim_host_type, claim_access_type, claim_supports_paper, claim_host_name, claim_hours_note FROM reports")),
    ["ashtray", "convenienceStore", "public", "yes", HOST_NAME, HOURS_NOTE]);
  for (const bad of [
    { ...base, type: "exists", proposedLocation: undefined, spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", claim: ASHTRAY_AT_STORE },
    { ...base, claim: { hostType: "convenienceStore" } },
    { ...base, claim: { spotType: "unknown", spotSubtype: "smokingCorner" } },
    { ...base, claim: { spotType: "ashtray", accessType: "public", accessDetail: "ticketedUsersOnly" } },
    { ...base, claim: { spotType: "ashtray", accessType: "staffOnly" } },
    { ...base, claim: { spotType: "ashtray", hostName: "x".repeat(81) } },
    { ...base, claim: { spotType: "ashtray", photo: "data:" } },
  ]) {
    const res = await post(bad);
    assert.equal(res.status, 400, JSON.stringify(bad.claim));
  }
  assert.equal(one(db, "SELECT count(*) AS n FROM reports").n, 1, "a refused claim stores nothing");
  // The database refuses a claim on another report type even around the API.
  assert.throws(() => db.raw.prepare(`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status,
    received_at, minimize_after, claim_spot_type) VALUES ('rp_${"9".repeat(26)}', 1, 'exists', 'sp_01V64NN31G72E5KJJ5W22W1A1J', 'notProvided', 'a', 'b', 'ashtray')`).run(),
  /this claim is not accepted on this report type/);
});

// 15, 16, 17
test("stale stays visible; a single negative report deletes nothing; only a reviewed, corroborated hold withdraws a spot", async () => {
  const db = await world();
  const before = one(db, "SELECT count(*) AS n FROM tile_snapshot_spots").n as number;
  // 15: five years on, every official spot is stale — and every one is still published.
  const later = await analyzeCorpus(db, { now: "2031-09-21T03:00:00Z" });
  assert.equal(later.corpus.publishedSpots, before);
  assert.equal(later.nationwide.confidence.freshness.fresh, undefined);
  assert.equal(later.nationwide.confidence.freshness.aging, undefined);
  assert.ok(later.nationwide.confidence.freshness.stale > 0, "dated evidence is stale; undated evidence stays unknown");
  const failingNow = (await analyzeCorpus(db, { now: isoSeconds(RECEIVED) })).checks.filter((c) => c.status === "fail").map((c) => c.id);
  assert.ok(later.checks.filter((c) => c.status === "fail").every((c) => failingNow.includes(c.id)), "staleness fails no quality check");

  const { spotId } = await reportedSpot(db, ASHTRAY_AT_STORE);
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, spotId));

  // 17: one `prohibited` report: reviewed into a hold candidate, but a hold needs two independent submitters.
  const one1 = await existingSpotReport(db, HASHES[1], spotId, "prohibited");
  await acceptAndQueue(db, one1);
  const single = await proposeEffect(storesOf(db), { reportIds: [one1], decidedBy: "r", now: APPLY });
  await applyCommunityEffect(db, single.applicationId, { now: APPLY });
  const refused = await holdCommunityEffect(db, single.applicationId, { now: APPLY, sourceApprovedInCode: true });
  assert.equal(refused.status, "blocked");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, spotId), "a single negative report changes nothing public");
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", spotId).lifecycle, "active", "and nothing canonical");

  // 16: two independent negative reports -> reviewed hold -> gone from every published surface; the row stays.
  const p2 = await existingSpotReport(db, HASHES[2], spotId, "prohibited");
  const p3 = await existingSpotReport(db, HASHES[3], spotId, "prohibited");
  await acceptAndQueue(db, p2, p3);
  const pair = await proposeEffect(storesOf(db), { reportIds: [p2, p3], decidedBy: "r", now: APPLY });
  await applyCommunityEffect(db, pair.applicationId, { now: APPLY });
  assert.equal((await holdCommunityEffect(db, pair.applicationId, { now: APPLY, sourceApprovedInCode: true })).status, "held");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), false);
  assert.equal((await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).status, 404);
  assert.equal(one(db, "SELECT count(*) AS n FROM spots WHERE spot_id = ?", spotId).n, 1, "held, never hard-deleted");
});

test("freshness.v1: fresh within 365 days, aging within 730, then stale; month-precision evidence is dated to its first day; no date is unknown", () => {
  const spot = (lastVerifiedAt: string | null, lastReviewedMonth: string | null) =>
    ({ lastVerifiedAt, verification: { version: "spot-verification.v1", existence: "official", locationPrecision: "publisherPoint", confirmations: null, lastReviewedMonth } }) as TileSpotV1;
  const now = "2026-10-01T00:00:00Z";
  assert.equal(spotFreshness(spot("2025-10-01", "2025-10"), now), "fresh");
  assert.equal(spotFreshness(spot("2025-09-30", "2025-09"), now), "aging");
  assert.equal(spotFreshness(spot("2024-10-01", "2024-10"), now), "aging");
  assert.equal(spotFreshness(spot("2024-09-30", "2024-09"), now), "stale");
  assert.equal(spotFreshness(spot(null, "2025-10"), now), "fresh");
  assert.equal(spotFreshness(spot(null, "2024-09"), now), "stale");
  assert.equal(spotFreshness(spot(null, null), now), "unknown");
  assert.equal(spotFreshness(spot("2027-01-01", "2027-01"), now), "unknown", "a future date is not fresh");
});

// 5, 18 (upgrade half) — communityReported -> communityVerified
test("an independent `exists` confirmation upgrades communityReported to communityVerified; the original reporter cannot", async () => {
  const db = await world();
  const { spotId } = await reportedSpot(db, ASHTRAY_AT_STORE);
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });

  const self = await existingSpotReport(db, HASHES[0], spotId, "exists");
  await acceptAndQueue(db, self);
  // Independence is judged in REPORTS_DB, where the keys exist: the original reporter's confirmation is refused there.
  await assert.rejects(proposeConfirmation(storesOf(db), { spotId, reportIds: [self], decidedBy: "r", now: APPLY }), /original submitter/);

  const other = await existingSpotReport(db, HASHES[1], spotId, "exists");
  await acceptAndQueue(db, other);
  const effect = await proposeConfirmation(storesOf(db), { spotId, reportIds: [other], decidedBy: "r", now: APPLY });
  await applyCommunityEffect(db, effect.applicationId, { now: APPLY });
  // The database refuses any upgrade the attestation does not state, and the tier cannot be edited by hand.
  assert.throws(() => db.raw.prepare(`INSERT INTO community_evidence_upgrades VALUES (?, ?, 'community-verification.v1', 3, 'r', ?)`)
    .run(spotId, effect.applicationId, isoSeconds(LATER)), /not independent evidence/);
  assert.throws(() => db.raw.prepare("UPDATE spots SET evidence_quality = 'communityVerified', evidence_quality_version = 'evidence-quality.v3' WHERE spot_id = ?").run(spotId),
    /only through a recorded community evidence upgrade/);
  assert.deepEqual(await upgradeCommunityEvidence(db, effect.applicationId, { decidedBy: "reviewer-2", now: LATER }), { spotId, confirmations: 2 });
  await publishTiles(db, { now: isoSeconds(LATER) });
  const t = await tileSpot(db, spotId);
  assert.deepEqual([t.id, t.evidenceQuality, t.verification.existence, t.verification.confirmations, t.verification.lastReviewedMonth],
    [spotId, "communityVerified", "communityVerified", 2, "2026-10"], "same identity, upgraded evidence");
  await assert.rejects(upgradeCommunityEvidence(db, effect.applicationId, { decidedBy: "r", now: LATER }), /not a live communityReported spot/);
  assert.throws(() => db.raw.prepare("DELETE FROM community_evidence_upgrades").run(), /never deleted/);
});

test("an upgrade cannot rest on a redacted report: independence is provable only while every key exists", async () => {
  const db = await world();
  const { spotId, reportId } = await reportedSpot(db, ASHTRAY_AT_STORE);
  const other = await existingSpotReport(db, HASHES[1], spotId, "exists");
  await acceptAndQueue(db, other);
  // Only the spot's own report is minimized in REPORTS_DB (the redaction update the retention pass issues): its key is
  // gone, so no confirmation over it can be attested any more, though the confirming report itself is fresh.
  reportsOf(db).raw.prepare(`UPDATE reports SET note = NULL, proposed_latitude = NULL, proposed_longitude = NULL, observed_on = NULL,
    submitter_hash = NULL, claim_host_name = NULL, claim_hours_note = NULL, redacted_at = ? WHERE report_id = ?`).run(isoSeconds(APPLY), reportId);
  await assert.rejects(proposeConfirmation(storesOf(db), { spotId, reportIds: [other], decidedBy: "r", now: APPLY }), /base report .* is redacted/);
  // An exists effect without an attestation over the spot's evidence (an official or verified spot) upgrades nothing.
  assert.equal(one(db, "SELECT evidence_quality FROM spots WHERE spot_id = ?", spotId).evidence_quality, "communityReported", "the listing stays, at its tier");
});

// 18, 19 — official evidence meets community listings only through cross-source review
test("communityReported and communityVerified spots enter cross-source review next to an official spot; nothing merges automatically", async () => {
  const db = await world();
  const official = one(db, `SELECT s.spot_id, s.latitude, s.longitude FROM spots s JOIN tile_snapshot_spots t ON t.spot_id = s.spot_id
    JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence' JOIN source_records r ON r.record_id = p.record_id
    JOIN source_releases rel ON rel.release_id = r.release_id WHERE rel.source_id = ? ORDER BY s.spot_id LIMIT 1`, TAITO_SOURCE_ID);
  const near = { latitude: Math.round((official.latitude + 0.00005) * 1e5) / 1e5, longitude: official.longitude };
  const reported = await reportedSpot(db, ASHTRAY_AT_STORE, "R", HASHES[2], near);
  const verified = await verifiedSpot(db, [ASHTRAY_AT_STORE, ASHTRAY_AT_STORE], "V", near);
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  await generateCrossSourceCandidates(db, { now: isoSeconds(APPLY) });
  for (const spotId of [reported.spotId, verified.spotId]) {
    assert.ok(one(db, "SELECT count(*) AS n FROM cross_source_candidates WHERE ? IN (spot_a_id, spot_b_id) AND ? IN (spot_a_id, spot_b_id)", spotId, official.spot_id).n === 1,
      `${spotId} is a cross-source candidate of the official spot`);
  }
  assert.equal(one(db, "SELECT count(*) AS n FROM cross_source_merge_applications").n, 0, "never merged without a reviewed decision");
  assert.ok(published(db, reported.spotId) && published(db, verified.spotId) && published(db, official.spot_id), "all stay visible meanwhile");
});

// 20 — location precision is its own axis
test("location precision is independent of existence evidence", () => {
  const row = (source_kind: string, evidence_quality: string) => ({ source_kind, evidence_quality, community_confirmations: source_kind === "userReport" ? 2 : null,
    last_reviewed_on: "2026-09-25", last_verified_at: source_kind === "userReport" ? null : "2026-08-18" }) as unknown as CandidateRow;
  assert.deepEqual([verificationDto(row("municipal", "officialListing")).existence, verificationDto(row("municipal", "officialListing")).locationPrecision], ["official", "publisherPoint"]);
  // An official listing whose pin is derived from its address (ADR-0011, still Proposed): official existence, derived pin.
  assert.deepEqual([verificationDto(row("municipal", "officialListingDerivedLocation")).existence, verificationDto(row("municipal", "officialListingDerivedLocation")).locationPrecision], ["official", "reviewedDerived"]);
  assert.deepEqual([verificationDto(row("userReport", "communityVerified")).existence, verificationDto(row("userReport", "communityVerified")).locationPrecision], ["communityVerified", "communityPinned"]);
  assert.deepEqual([verificationDto(row("operator", "operatorListing")).existence, verificationDto(row("operator", "operatorListing")).confirmations], ["operator", null]);
  // A legacy (pre-0023) community spot: two-submitter evidence without a recorded count.
  assert.deepEqual(verificationDto({ ...row("userReport", "communityReviewed"), community_confirmations: null }).existence, "communityVerified");
});

// 21, 22
test("promotion v3 carries a sanitized communityReported spot; no report, note, host name, hours note or submitter key travels", async () => {
  const db = await world();
  const { spotId } = await reportedSpot(db, { ...ASHTRAY_AT_STORE });
  const withText = await newSpotReport(db, HASHES[3], { ...SMOKING_CAFE, hostName: HOST_NAME, hoursNote: HOURS_NOTE }, { at: { latitude: 35.56, longitude: 139.56 } });
  await acceptAndQueue(db, withText);
  const app2 = await proposeNewSpot(storesOf(db), { reportIds: [withText], locationReportId: withText, decidedBy: "r", now: APPLY, tier: "communityReported" });
  const cafe = await applyCommunityApplication(db, app2, { now: APPLY, newSpotId: sequentialSpotIds("T") }) as { spotId: string };
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });

  // 22: free text exists only in REPORTS_DB, and retention removes it there. No canonical table holds it.
  for (const { name } of all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    const dump = JSON.stringify(all(db, `SELECT * FROM ${name}`));
    for (const needle of [NOTE, HOST_NAME, HOURS_NOTE, ...HASHES]) assert.ok(!dump.includes(needle), `${name} holds ${needle}`);
  }
  const bundle = await buildMultiSourcePromotionBundle(db, { registry: SIMULATED_REGISTRY });
  for (const needle of [NOTE, HOST_NAME, HOURS_NOTE, ...HASHES, "INSERT INTO reports", "community_reconciliation", "community_evidence_upgrades", "submitter",
    "community_artifact_ledger", "community_evidence_reports"]) {
    assert.ok(!bundle.sql.includes(needle), `bundle carries ${needle}`);
  }
  const target = migratedSqlite();
  applyPromotionBundle(target, bundle.sql);
  const onTarget = new SqliteD1(target);
  for (const id of [spotId, cafe.spotId]) {
    const t = await detail(onTarget, id);
    assert.equal(t.spot.verification.existence, "communityReported");
    assert.deepEqual(t.spot, (await detail(db, id)).spot, "the target serves the same spot, axes included");
  }
  await applyReportRetention(reportsOf(db), { now: new Date("2027-01-01T00:00:00Z") });
  assert.deepEqual(Object.values(one(reportsOf(db), "SELECT claim_host_name, claim_hours_note, claim_spot_type FROM reports WHERE report_id = ?", withText)),
    [null, null, "smokingPermittedVenue"], "free text is minimized; the categorical claim about the place survives");
});

// 23
test("an older client that knows only the pre-ADR-0012 fields still reads every lower-confidence spot", async () => {
  const db = await world();
  const { spotId } = await reportedSpot(db, SMOKING_CAFE);
  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const res = await app.request(`/v1/tiles/${one(db, "SELECT tile_id FROM spots WHERE spot_id = ?", spotId).tile_id}`, {}, { DB: db });
  const body = await res.json() as Row;
  assert.equal(body.schemaVersion, 1, "no schema bump: every addition is an ignorable field or an already tolerated value");
  const V1_FIELDS = ["id", "name", "latitude", "longitude", "spotType", "accessType", "environment", "supportsPaper", "supportsHeated",
    "openingHours", "lifecycle", "evidenceQuality", "evidenceQualityVersion", "lastVerifiedAt", "sourceIds"];
  const legacyView = body.spots.find((s: Row) => s.id === spotId);
  for (const f of V1_FIELDS) assert.ok(f in legacyView, `${f} is still present`);
  // v1 values an old client already decodes: spotType/accessType stay in the v1 vocabulary; the new evidence value is a
  // string the contract says to treat as non-official.
  assert.ok(["designatedOutdoorArea", "publicSmokingRoom", "facilitySmokingRoom", "ashtray", "smokingPermittedVenue", "unknown"].includes(legacyView.spotType));
  assert.ok(["public", "customerOnly", "facilityOnly", "unknown"].includes(legacyView.accessType));
  assert.notEqual(legacyView.evidenceQuality, "officialListing");
});

// 25
test("quality counts tiers separately and never fails because a lower tier exists", async () => {
  const db = await world();
  const baseline = await analyzeCorpus(db, { now: isoSeconds(APPLY) });
  const official = baseline.nationwide.coverage.official;
  await reportedSpot(db, ASHTRAY_AT_STORE, "R", HASHES[2], { latitude: 35.57, longitude: 139.57 });
  await verifiedSpot(db, [SMOKING_CAFE, SMOKING_CAFE], "V", { latitude: 35.58, longitude: 139.58 });
  await publishTiles(db, { now: isoSeconds(APPLY) });

  const blocked = await analyzeCorpus(db, { now: isoSeconds(APPLY) });
  assert.deepEqual(blocked.nationwide.coverage, { ...baseline.nationwide.coverage }, "blocked: nothing counts as coverage");
  assert.deepEqual(blocked.nationwide.confidence.communityCanonicalByTier,
    { communityReported: { canonical: 1, unpublished: 1 }, communityVerified: { canonical: 1, unpublished: 1 } });

  simulateRightsGranted(db);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const granted = await analyzeCorpus(db, { now: isoSeconds(APPLY) });
  assert.deepEqual(granted.nationwide.coverage, { official, operator: 0, communityVerified: 1, communityReported: 1, allVisible: official + 2 });
  assert.equal(granted.nationwide.confidence.locationPrecision.communityPinned, 2);
  assert.equal(granted.nationwide.confidence.existence.official, official);
  // The simulated approval edits the community source row by hand, so the registry-drift checks rightly flag that
  // row; every other check — the confidence checks included — is exactly as before.
  const failing = (a: typeof granted) => a.checks.filter((c) => c.status === "fail").map((c) => c.id).sort();
  assert.deepEqual(failing(granted).filter((id) => id !== "registry-row-matches-reviewed-entry"),
    failing(baseline), `lower-confidence listings fail nothing: ${failing(granted)}`);
  assert.equal(granted.checks.find((c) => c.id === "confidence-never-overstated")!.status, "pass");

  // A community spot labelled official is a misrepresentation, and the check fails on it.
  const tile = one(db, "SELECT tile_id, body_json FROM tile_snapshots WHERE body_json LIKE '%communityReported%'");
  const forged = tile.body_json.replace('"existence":"communityReported"', '"existence":"official"');
  db.raw.prepare("UPDATE tile_snapshots SET body_json = ?, revision = revision + 1 WHERE tile_id = ?").run(forged, tile.tile_id);
  assert.equal((await analyzeCorpus(db, { now: isoSeconds(APPLY) })).checks.find((c) => c.id === "confidence-never-overstated")!.status, "fail");
});

test("static boundary: the upgrade module's only canonical write is the guarded evidence-tier update", () => {
  const source = readFileSync(new URL("../src/pipeline/community-verification.ts", import.meta.url), "utf8");
  const writes = [...source.matchAll(/(INSERT INTO|UPDATE) ([a-z_]+)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(writes, ["INSERT INTO community_evidence_upgrades", "UPDATE spots"]);
  const update = source.slice(source.indexOf("UPDATE spots"), source.indexOf("WHERE spot_id", source.indexOf("UPDATE spots")));
  assert.deepEqual([...update.matchAll(/([a-z_]+) = /g)].map((m) => m[1]),
    ["evidence_quality", "evidence_quality_version", "community_confirmations", "last_reviewed_on", "updated_at"]);
});

test("research replay separates rights blockers from data blockers, and relaxes only current-operation age", async () => {
  const { classifyReview } = await import("../src/quality/coverage-replay.ts");
  const c = (blockerCodes: string[] | string, kind?: string) => classifyReview({ jurisdiction: "x", verdict: "blocked", blockerCodes, kind });
  assert.deepEqual([c(["reuseForbidden", "currentOperationUnknown"]).blockedBy, c(["reuseForbidden"]).route], ["rightsOnly", "D-referenceLead"]);
  assert.deepEqual([c(["hostPointOnly"]).blockedBy, c(["hostPointOnly"]).route], ["dataOnly", "C-communityAcquisition"], "a host facility is never a spot; people on site can report one");
  assert.deepEqual([c(["coordinatesMissing", "licenseUnknown"]).blockedBy, c(["coordinatesMissing", "licenseUnknown"]).route], ["rightsAndData", "D-referenceLead"]);
  assert.equal(c(["currentOperationUnknown"]).blockedBy, "relaxedByAdr0012", "an old official listing publishes with its date");
  assert.equal(c(["rawUnavailable"]).route, "retryAccess");
  assert.equal(c(["duplicateKnownResearch"], "operator").route, "B-operatorReusable");
  assert.deepEqual(c("['noSmokingPoint', 'coordinatesMissing']").blockers, ["noSmokingPoint", "coordinatesMissing"], "Python-repr lists parse");
});

test("coordinate sanity: a pin outside Japan never becomes a listing, whatever its tier", async () => {
  const db = await world();
  const honolulu = await newSpotReport(db, HASHES[0], ASHTRAY_AT_STORE, { at: { latitude: 21.30694, longitude: -157.85833 } });
  await acceptAndQueue(db, honolulu);
  await assert.rejects(proposeNewSpotReview(reportsOf(db), { reportIds: [honolulu], locationReportId: honolulu, decidedBy: "r", now: APPLY, tier: "communityReported" }),
    /outside Japan/);
});
