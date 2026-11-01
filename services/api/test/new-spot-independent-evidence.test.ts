// v1.0 new places without photos (scope decision 2026-11-02; REPORTS_DB 0011). An attested `missing` report is taken
// without any photo and waits in moderation; nothing publishes it automatically. It can be accepted, and back a new-spot
// review and export, only after an operator recorded an independent check (official source page or visit). The photo
// routes stay closed in v1.0, and every other intake guard (App Attest, idempotency, budget, bounds) is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { AdminReviewError, applyAdminDecision, getAdminReport, recordIndependentEvidence, type EvidenceCheckInput } from "../src/reports/admin-review.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { exportReview, listNewSpotCandidates, proposeNewSpotReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
import { SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const APP_ID = "ABCDE12345.com.example.mannerpath";
const ATTESTED = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production",
  REPORT_APP_ATTEST_BUNDLE_VERSIONS: "42", REPORT_SUBMITTER_PEPPER: "s".repeat(32) };
// The photo bindings a v1.1 deployment would set. v1.0 has no reviewed photo terms, so the routes stay closed anyway.
const PHOTO_BINDINGS = { PHOTO_EVIDENCE: "on", PHOTO_STORAGE_POLICY: "private-no-copies-permanent-fences.v1", REPORT_RETENTION: "cleanup",
  REPORT_RETENTION_CRON: "*/5 * * * *", PRIVATE_PHOTOS: { put: async () => ({}), head: async () => null, get: async () => null, delete: async () => {} } };
const NOW = new Date("2026-10-13T03:00:00Z"); // 12:00 in Japan
const TODAY_JST = "2026-10-13";
const HERE = { latitude: 35.71201, longitude: 139.77701 };
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const CLAIM = { spotType: "designatedOutdoorArea", accessType: "public", hostName: "Example station east exit" };
const OFFICIAL = "https://www.city.example.jp/kurashi/smoking-areas.html";

interface Harness { db: SqliteD1; pki: TestPki; device: TestDevice; post: (path: string, body: unknown) => Promise<{ status: number; json: Row }> }

async function harness(): Promise<Harness> {
  const db = reportsD1();
  const pki = await testPki(NOW);
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => NOW });
  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { DB: new SqliteD1(), REPORTS_DB: db, ...ATTESTED, ...PHOTO_BINDINGS } as any);
    return { status: res.status, json: await res.json() as Row };
  };
  const device = await testDevice();
  const ch = (await post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" })).json.challenge;
  const attestationObject = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki, now: NOW });
  const registered = await post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(attestationObject) });
  assert.equal(registered.status, 201, JSON.stringify(registered.json));
  return { db, pki, device, post };
}

async function signedMissing(h: Harness, idempotencyKey: string, extra: Row = {}) {
  const bytes = utf8(JSON.stringify({ schemaVersion: 3, type: "missing", installId: INSTALL, idempotencyKey, proposedLocation: HERE,
    acceptedTermsVersion: CURRENT_REPORT_TERMS.version, claim: CLAIM, ...extra }));
  const ch = (await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: h.device.keyIdBase64 })).json.challenge;
  const assertion = await makeAssertion(h.device, await sha256(reportClientData(base64Decode(ch)!, h.device.keyId, bytes)), { appId: APP_ID });
  return { schemaVersion: 3, payload: base64Encode(bytes), attestation: { keyId: h.device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } };
}
const idem = (i: number) => i.toString(16).padStart(64, "0");
const count = (db: SqliteD1, sql: string) => (db.raw.prepare(sql).get() as Row).n as number;

async function evidence(db: SqliteD1, reportId: string, extra: Partial<EvidenceCheckInput> = {}, at = NOW): Promise<EvidenceCheckInput> {
  return { reportId, basis: "officialSource", sourceUrl: OFFICIAL, checkedOn: TODAY_JST, expectedVersion: (await getAdminReport(db, reportId, at)).version,
    operationId: crypto.randomUUID(), decidedBy: "operator", ...extra };
}
async function accept(db: SqliteD1, reportId: string, at = NOW) {
  return applyAdminDecision(db, { reportId, state: "accepted", reason: "confirmed", expectedVersion: (await getAdminReport(db, reportId, at)).version,
    operationId: crypto.randomUUID(), privacyChecked: true, decidedBy: "operator" }, at);
}
const code = (c: string) => (e: unknown) => e instanceof AdminReviewError && e.code === c;

test("intake: an attested new place without photos is stored pending and never published; photo routes stay closed", async () => {
  const h = await harness();
  const first = await h.post("/v1/reports", await signedMissing(h, idem(1)));
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const reportId = first.json.reportId as string;
  const row = h.db.raw.prepare(`SELECT r.report_type, r.attestation_status, m.state, m.reconciliation_state FROM reports r
    JOIN report_moderation m USING (report_id) WHERE report_id = ?`).get(reportId) as Row;
  assert.deepEqual({ ...row }, { report_type: "missing", attestation_status: "verified", state: "pending", reconciliation_state: "notQueued" });
  assert.equal(count(h.db, "SELECT count(*) AS n FROM report_reviews"), 0, "nothing is proposed for publication automatically");
  assert.equal(count(h.db, "SELECT count(*) AS n FROM community_evidence_photos"), 0);

  // A retry of the same draft answers the stored report; nothing is stored twice.
  const retry = await h.post("/v1/reports", await signedMissing(h, idem(1)));
  assert.deepEqual([retry.status, retry.json.reportId], [200, reportId]);
  assert.equal(count(h.db, "SELECT count(*) AS n FROM reports"), 1);

  // v1.0 closes photo upload and its retry route even with every v1.1 photo binding present.
  const photo = await h.post(`/v1/reports/${reportId}/photos`, { schemaVersion: 2 });
  assert.deepEqual([photo.status, photo.json.error], [503, "photoEvidenceDisabled"]);
  const config = await createApp({ appAttestTrustAnchor: h.pki.root, now: () => NOW }).request("/v1/config", {},
    { DB: new SqliteD1(), REPORTS_DB: h.db, ...ATTESTED, ...PHOTO_BINDINGS } as any);
  const reports = ((await config.json()) as Row).reports;
  assert.deepEqual([reports.available, reports.photoEvidenceEnabled, reports.newSpotClaims], [true, false, true]);
});

test("intake: pins outside Japan, oversized text and unattested bodies are refused before anything is stored", async () => {
  const h = await harness();
  for (const [i, location] of [[2, { latitude: 51.5, longitude: -0.12 }], [3, { latitude: 0, longitude: 0 }], [4, { latitude: 35.7, longitude: 121.9 }]] as const) {
    const res = await h.post("/v1/reports", await signedMissing(h, idem(i), { proposedLocation: location }));
    assert.deepEqual([res.status, res.json.error, res.json.detail], [400, "invalidReport", "proposedLocation: outside_service_area"], JSON.stringify(location));
  }
  const long = await h.post("/v1/reports", await signedMissing(h, idem(5), { claim: { ...CLAIM, hostName: "x".repeat(81) } }));
  assert.equal(long.status, 400);
  const unattested = await h.post("/v1/reports", { schemaVersion: 1, type: "missing", installId: INSTALL, proposedLocation: HERE });
  assert.equal(unattested.status, 400);
  assert.equal(count(h.db, "SELECT count(*) AS n FROM reports"), 0);
});

test("review: acceptance needs a recorded independent check; the check is audited, immutable and approves nothing", async () => {
  const h = await harness();
  const reportId = (await h.post("/v1/reports", await signedMissing(h, idem(10)))).json.reportId as string;
  await assert.rejects(accept(h.db, reportId), code("independentEvidenceRequired"));

  const input = await evidence(h.db, reportId);
  const recorded = await recordIndependentEvidence(h.db, input, NOW);
  assert.equal(recorded.replayed, false);
  assert.equal(recorded.detail.report.state, "pending", "recording a check is not a decision");
  assert.deepEqual(recorded.detail.evidenceChecks.map((c) => [c.basis, c.source_url, c.checked_on, c.recorded_by]), [["officialSource", OFFICIAL, TODAY_JST, "operator"]]);
  // Same operation again: a replay. Same operation, other content: a conflict. The old version is stale now.
  assert.equal((await recordIndependentEvidence(h.db, input, NOW)).replayed, true);
  await assert.rejects(recordIndependentEvidence(h.db, { ...input, checkedOn: "2026-10-12" }, NOW), code("operationConflict"));
  await assert.rejects(recordIndependentEvidence(h.db, { ...input, operationId: crypto.randomUUID() }, NOW), code("staleDecision"));

  const accepted = await accept(h.db, reportId);
  assert.equal(accepted.detail.report.state, "accepted");
  assert.equal(accepted.detail.publicationState, "awaitingPublication");
  // Nothing beyond the bounded record is stored, and it cannot be edited or removed.
  assert.doesNotMatch(JSON.stringify(h.db.raw.prepare("SELECT * FROM new_spot_evidence_checks").all()), /Example station|appattest|submitter/);
  assert.throws(() => h.db.raw.exec("UPDATE new_spot_evidence_checks SET basis = 'siteVisit'"), /immutable/);
  assert.throws(() => h.db.raw.exec("DELETE FROM new_spot_evidence_checks"), /immutable/);
  // An accepted report takes no further check.
  await assert.rejects(recordIndependentEvidence(h.db, await evidence(h.db, reportId), NOW), code("evidenceNotApplicable"));
});

test("evidence input: https only, no credentials or fragment, a Japan date between arrival and today, URL only for official sources", async () => {
  const h = await harness();
  const reportId = (await h.post("/v1/reports", await signedMissing(h, idem(20)))).json.reportId as string;
  for (const bad of [
    { sourceUrl: "http://www.city.example.jp/a" }, { sourceUrl: "https://user:pw@www.city.example.jp/a" }, { sourceUrl: "https://www.city.example.jp/a#x" },
    { sourceUrl: "https://localhost/x" }, { sourceUrl: "https://www.city.example.jp/ a" }, { sourceUrl: `https://www.city.example.jp/${"a".repeat(300)}` },
    { sourceUrl: undefined }, { basis: "siteVisit", sourceUrl: OFFICIAL }, { basis: "photo" }, { checkedOn: "2026-13-01" }, { checkedOn: "20261013" },
    { decidedBy: "a b" }, { operationId: "not-a-uuid" },
  ] as Partial<EvidenceCheckInput>[]) {
    await assert.rejects(recordIndependentEvidence(h.db, await evidence(h.db, reportId, bad), NOW), code("invalidEvidence"), JSON.stringify(bad));
  }
  await assert.rejects(recordIndependentEvidence(h.db, await evidence(h.db, reportId, { checkedOn: "2026-10-14" }), NOW), code("evidenceDateOutOfRange"));
  await assert.rejects(recordIndependentEvidence(h.db, await evidence(h.db, reportId, { checkedOn: "2026-10-12" }), NOW), code("evidenceDateOutOfRange"));
  const visit = await recordIndependentEvidence(h.db, await evidence(h.db, reportId, { basis: "siteVisit", sourceUrl: undefined }), NOW);
  assert.deepEqual(visit.detail.evidenceChecks.map((c) => [c.basis, c.source_url]), [["siteVisit", null]]);
  assert.equal(count(h.db, "SELECT count(*) AS n FROM new_spot_evidence_checks"), 1);
});

test("the database refuses a check for another report type, a decided or expired report, or a date outside the report", async () => {
  const db = reportsD1();
  const make = async (type: "missing" | "moved") => (await createReport(db, { schemaVersion: 1, type, installId: INSTALL, proposedLocation: HERE,
    ...(type === "moved" ? { spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J" } : {}), acceptedTermsVersion: CURRENT_REPORT_TERMS.version } as any,
  { now: NOW, attestationStatus: "verified", submitterHash: "a".repeat(64) })).reportId;
  const insert = (reportId: string, checkedOn = TODAY_JST, recordedAt = "2026-10-13T03:00:00Z") => db.raw.prepare(`INSERT INTO new_spot_evidence_checks
    (operation_id, report_id, basis, source_url, checked_on, recorded_by, recorded_at, request_hash) VALUES (?, ?, 'siteVisit', NULL, ?, 'operator', ?, ?)`)
    .run(crypto.randomUUID(), reportId, checkedOn, recordedAt, "0".repeat(64));
  const moved = await make("moved");
  assert.throws(() => insert(moved), /not an open new-spot proposal/);
  await assert.rejects(recordIndependentEvidence(db, await evidence(db, moved), NOW), code("evidenceNotApplicable"));
  const open = await make("missing");
  assert.throws(() => insert(open, "2026-10-12"), /not an open new-spot proposal/);
  assert.throws(() => insert(open, "2026-10-14"), /not an open new-spot proposal/);
  assert.throws(() => db.raw.prepare(`INSERT INTO new_spot_evidence_checks VALUES (?, ?, 'officialSource', NULL, ?, 'operator', ?, ?)`)
    .run(crypto.randomUUID(), open, TODAY_JST, "2026-10-13T03:00:00Z", "0".repeat(64)), /CHECK constraint/);
  insert(open);
  const rejected = await make("missing");
  await recordModerationDecision(db, rejected, { state: "rejected", decidedBy: "operator", reason: "abuse", now: NOW });
  assert.throws(() => insert(rejected), /not an open new-spot proposal/);
  // 90 days later the report is minimized: neither the code nor the database records a check any more.
  const late = new Date("2027-01-12T03:00:00Z");
  const expired = await make("missing");
  await assert.rejects(recordIndependentEvidence(db, await evidence(db, expired, {}, late), late), code("reportExpired"));
  assert.throws(() => insert(expired, TODAY_JST, "2027-01-12T03:00:00Z"), /not an open new-spot proposal/);
});

test("publication: a checked report backs a new-spot review and export; an unchecked one is held in code and in the database", async () => {
  const h = await harness();
  const checked = (await h.post("/v1/reports", await signedMissing(h, idem(30)))).json.reportId as string;
  await recordIndependentEvidence(h.db, await evidence(h.db, checked), NOW);
  await accept(h.db, checked);
  await setReconciliationState(h.db, checked, "queued", NOW);
  const later = new Date(NOW.getTime() + 60_000);
  const group = (await listNewSpotCandidates(h.db, { withinMetres: 50, now: later })).find((g) => g.reportIds.includes(checked))!;
  assert.deepEqual(group.independentChecks, [{ reportId: checked, recorded: true }]);
  assert.deepEqual(group.photoGates, [{ reportId: checked, gate: "none" }]);
  const reviewId = await proposeNewSpotReview(h.db, { reportIds: [checked], tier: "communityReported", locationReportId: checked, decidedBy: "operator", now: later });
  const exported = await exportReview(h.db, reviewId, { now: later });
  assert.equal(exported.status, "exported");

  // A report accepted through the legacy CLI without a check stays held: no review, and no direct SQL export.
  const unchecked = (await h.post("/v1/reports", await signedMissing(h, idem(31), { proposedLocation: { latitude: 35.8, longitude: 139.8 } }))).json.reportId as string;
  await recordModerationDecision(h.db, unchecked, { state: "accepted", decidedBy: "legacy-cli", reason: "confirmed", now: NOW });
  await setReconciliationState(h.db, unchecked, "queued", NOW);
  await assert.rejects(proposeNewSpotReview(h.db, { reportIds: [unchecked], tier: "communityReported", locationReportId: unchecked, decidedBy: "operator", now: later }),
    /has no approved evidence photo \(photos: none\) and no independent check/);
  const forged = `ca_${"1".repeat(26)}`;
  h.db.raw.prepare(`INSERT INTO report_reviews (review_id, review_kind, review_key, decision_version, rule_version, evidence_tier, location_report_id, decided_by, decided_at, state)
    SELECT ?, review_kind, 'newSpot:forged', 1, rule_version, evidence_tier, ?, 'x', ?, 'proposed' FROM report_reviews WHERE review_id = ?`).run(forged, unchecked, "2026-10-13T03:01:00Z", reviewId);
  h.db.raw.prepare("INSERT INTO report_review_evidence (report_id, review_id) VALUES (?, ?)").run(unchecked, forged);
  assert.throws(() => h.db.raw.prepare("UPDATE report_reviews SET state = 'exported', artifact_sha256 = ?, exported_at = ? WHERE review_id = ?")
    .run("0".repeat(64), "2026-10-13T03:02:00Z", forged), /no viewable approved evidence photo and no independent check/);
});
