// The durable community report store (ADR-0014, Issue #67 child). Reports, moderation, App Attest and anti-abuse state
// live in REPORTS_DB, which no blue/green cutover or rollback touches; the canonical DATA_DB (binding `DB`) is
// replaceable and sees community evidence only as a reviewed, sanitized, digest-bound artifact.
//
//   1. route ownership and failure modes        4. the three-database blue/green simulation (BLUE, REPORTS, GREEN)
//   2. the artifact: deterministic and private   5. retention at scale: bounded, idempotent, resumable
//   3. replay protection and canonical premises  6. migration streams, remote moderation guards, #124 still blocked
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { type Db, isoSeconds } from "../src/db.ts";
import { COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { importCommunityArtifact } from "../src/pipeline/community-artifact.ts";
import { applyCommunityEffect, holdCommunityEffect } from "../src/pipeline/community-effects.ts";
import { communityRelocationCandidates } from "../src/pipeline/community-evidence.ts";
import { applyCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { upgradeCommunityEvidence } from "../src/pipeline/community-verification.ts";
import { buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { COMMUNITY_PUBLICATION } from "../src/reports/community-publication.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { ArtifactContent, canonicalJson, openArtifact, sealArtifact } from "../src/reports/evidence-artifact.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { moderationTarget } from "../src/reports/moderation-target.ts";
import { applyReportRetention, runReportRetention } from "../src/reports/retention.ts";
import { exportReview, proposeEffectReview, proposeNewSpotReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { type Stores, exportAndImport, proposeConfirmation, stores } from "./support/community.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite, reportsD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const count = (db: SqliteD1, table: string) => one(db, `SELECT count(*) AS n FROM ${table}`).n as number;
const tables = (db: SqliteD1) => all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").map((r) => r.name as string);
/** Every row of every table: the whole observable state of a database. */
const snapshot = (db: SqliteD1) => JSON.stringify(tables(db).map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1`)]));

const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
const TERMS = CURRENT_REPORT_TERMS.version;
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const NOTE = "耐久ストア用メモ DRS-4417";
const OBSERVED = "2026-09-19";
const HOST_NAME = "店舗名 DRS-HN-0042";
const HASHES = ["0123456789abcdef", "fedcba9876543210", "0f1e2d3c4b5a6978", "1111222233334444"].map((h) => h.repeat(4));
const HERE = { latitude: 35.69001, longitude: 139.70001 };
const APP_ID = "ABCDE12345.com.example.mannerpath";
const ATTESTED = { REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42" };

async function report(db: SqliteD1, hash: string, body: Record<string, unknown>, opts: { at?: Date; id?: string } = {}) {
  const { reportId } = await createReport(db, { schemaVersion: 1, installId: INSTALL, acceptedTermsVersion: TERMS, ...body } as any, {
    now: opts.at ?? RECEIVED, attestationStatus: "notProvided", submitterHash: hash, ...(opts.id ? { newReportId: () => opts.id! } : {}),
  });
  return reportId;
}
async function acceptAndQueue(db: SqliteD1, ...ids: string[]) {
  for (const id of ids) {
    await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
    await setReconciliationState(db, id, "queued", RECEIVED);
  }
}
async function canonicalWorld(): Promise<Stores> {
  const s = stores();
  await importAllReviewedSources(s.data, isoSeconds(RECEIVED));
  await publishTiles(s.data, { now: isoSeconds(RECEIVED) });
  return s;
}
const officialSpot = (db: SqliteD1) => one(db, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 1").spot_id as string;

/** A database binding that fails every call, like an unreachable D1. */
const failing = (): Db => ({
  prepare: () => { throw new Error("D1_ERROR: database unavailable"); },
  batch: async () => { throw new Error("D1_ERROR: database unavailable"); },
});

// =============================================================================================================
// 1. Route ownership and failure modes
test("POST /v1/reports writes REPORTS_DB only; the canonical database is byte-identical afterwards", async () => {
  const s = await canonicalWorld();
  const before = snapshot(s.data);
  const app = createApp();
  const res = await app.request("/v1/reports", { method: "POST", body: JSON.stringify({ schemaVersion: 1, type: "missing", proposedLocation: HERE,
    installId: INSTALL, note: NOTE, acceptedTermsVersion: TERMS, claim: { spotType: "ashtray", hostName: HOST_NAME } }) }, { DB: s.data, REPORTS_DB: s.reports } as any);
  assert.equal(res.status, 201);
  assert.equal(snapshot(s.data), before, "no canonical row of any table changed");
  assert.equal(count(s.reports, "reports"), 1);
  assert.equal(count(s.reports, "report_moderation"), 1);
  assert.equal(count(s.reports, "report_rate_windows") > 0, true, "anti-abuse state is report-store owned");
  assert.equal(one(s.reports, "SELECT terms_version FROM report_terms_documents").terms_version, TERMS, "consent is report-store owned");
});

test("REPORTS_DB unavailable: report and App Attest endpoints fail closed with 503; tiles and spots keep serving", async () => {
  const s = await canonicalWorld();
  const app = createApp();
  const tile = one(s.data, "SELECT tile_id FROM tile_snapshots ORDER BY tile_id LIMIT 1").tile_id;
  const spot = officialSpot(s.data);
  for (const reportsBinding of [undefined, failing()]) {
    const env = { DB: s.data, ...(reportsBinding === undefined ? {} : { REPORTS_DB: reportsBinding }) } as any;
    const calls: [string, unknown, Record<string, string>][] = [
      ["/v1/reports", { schemaVersion: 1, type: "exists", spotId: spot, installId: INSTALL }, { REPORT_ATTESTATION: "disabled" }],
      ["/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" }, ATTESTED],
    ];
    // Without a binding nothing is even parsed; with a failing one, the first store access fails the request.
    if (reportsBinding === undefined) calls.push(["/v1/app-attest/keys", {}, ATTESTED]);
    for (const [path, body, vars] of calls) {
      const res = await app.request(path, { method: "POST", body: JSON.stringify(body) }, { ...env, ...vars });
      assert.equal(res.status, 503, `${path} with ${reportsBinding === undefined ? "no binding" : "a failing binding"}`);
      assert.equal(((await res.json()) as Row).error, "reportStoreUnavailable");
    }
    assert.equal((await app.request(`/v1/tiles/${tile}`, {}, env)).status, 200);
    assert.equal((await app.request(`/v1/spots/${spot}`, {}, env)).status, 200);
    assert.equal((await app.request("/v1/coverage/tasks", {}, env)).status, 200);
  }
  assert.equal(count(s.data, "reports"), 0, "nothing fell back to the canonical database");
});

test("DATA_DB unavailable: reads fail as reads; report intake does not depend on it and keeps accepting", async () => {
  const reports = reportsD1();
  const app = createApp();
  const env = { DB: failing(), REPORTS_DB: reports } as any;
  const tile = await app.request("/v1/tiles/14/14552/6451", {}, env);
  assert.equal(tile.status, 500, "a canonical read cannot be served without the canonical database");
  const res = await app.request("/v1/reports", { method: "POST", body: JSON.stringify({ schemaVersion: 1, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: INSTALL }) }, env);
  assert.equal(res.status, 201, "a report names its spot opaquely, so intake never reads the canonical database");
  assert.equal(count(reports, "reports"), 1);
});

// =============================================================================================================
// 2. The artifact
async function reviewedNewSpot(fixedIds: boolean) {
  const reports = reportsD1();
  const a = await report(reports, HASHES[0], { type: "missing", proposedLocation: HERE, note: NOTE, observedOn: OBSERVED,
    claim: { spotType: "ashtray", hostType: "convenienceStore", hostName: HOST_NAME } }, fixedIds ? { id: `rp_${"A".repeat(26)}` } : {});
  const b = await report(reports, HASHES[1], { type: "missing", proposedLocation: { latitude: 35.69003, longitude: 139.70002 }, note: NOTE,
    claim: { spotType: "ashtray" } }, fixedIds ? { id: `rp_${"B".repeat(26)}` } : {});
  await acceptAndQueue(reports, a, b);
  const reviewId = await proposeNewSpotReview(reports, { reportIds: [a, b], locationReportId: a, decidedBy: "reviewer-1", now: APPLY,
    ...(fixedIds ? { newReviewId: () => `ca_${"C".repeat(26)}` } : {}) });
  return { reports, a, b, reviewId };
}

test("the artifact is deterministic: the same review state gives byte-identical bytes, and re-export reproduces them", async () => {
  const first = await reviewedNewSpot(true);
  const second = await reviewedNewSpot(true);
  const x = await exportReview(first.reports, first.reviewId, { now: APPLY });
  const y = await exportReview(second.reports, second.reviewId, { now: new Date("2026-09-26T09:00:00Z") });
  assert.equal(x.status, "exported");
  assert.deepEqual(x.artifact.bytes, y.artifact.bytes, "independent of the export time and of the database");
  assert.equal(x.artifact.sha256, y.artifact.sha256);
  const again = await exportReview(first.reports, first.reviewId, { now: APPLY });
  assert.deepEqual([again.status, again.artifact.sha256], ["reExported", x.artifact.sha256]);
  assert.equal(one(first.reports, "SELECT artifact_sha256 FROM report_reviews").artifact_sha256, x.artifact.sha256);
  // Envelope: canonical JSON + newline, digest over the canonical content, schema and store versions bound.
  const envelope = JSON.parse(new TextDecoder().decode(x.artifact.bytes));
  assert.equal(new TextDecoder().decode(x.artifact.bytes), `${canonicalJson(envelope)}\n`);
  assert.equal(envelope.contentSha256, x.artifact.sha256);
  assert.deepEqual([envelope.content.artifactSchemaVersion, envelope.content.reportStoreSchema, envelope.content.review.decisionVersion,
    envelope.content.independence.version, envelope.content.termsVersion], [1, "reports-store.v1", 1, "community-independence.v1", TERMS]);
  // Once the evidence is minimized it can no longer be regenerated at all (nothing personal is kept to rebuild it).
  await applyReportRetention(first.reports, { now: new Date(minimizeAfter(RECEIVED).getTime() + 1000) });
  await assert.rejects(exportReview(first.reports, first.reviewId, { now: APPLY }), /minimized; its artifact can no longer be regenerated/);
});

test("the artifact carries no private field: no note, submitter key, raw timestamp, install or App Attest material, free text or unadopted pin", async () => {
  const { reports, b, reviewId } = await reviewedNewSpot(false);
  const { artifact } = await exportReview(reports, reviewId, { now: APPLY });
  const text = new TextDecoder().decode(artifact.bytes);
  const stored = all(reports, "SELECT received_at, minimize_after FROM reports");
  for (const secret of [NOTE, OBSERVED, HOST_NAME, INSTALL, ...HASHES, ...stored.flatMap((r) => [r.received_at, r.minimize_after]), "submitter", "installId",
    "note", "observedOn", "receivedAt", "keyId", "assertion", "attestation_status", "hostName", "hoursNote", "35.69003"]) {
    assert.equal(text.includes(secret), false, `artifact carries ${secret}`);
  }
  const evidence = artifact.content.evidence.find((e) => e.reportId === b)!;
  assert.deepEqual([evidence.latitude, evidence.longitude], [null, null], "only the adopted pin crosses");
  assert.deepEqual(Object.keys(evidence).sort(), ["acceptedTermsVersion", "claims", "finding", "latitude", "longitude", "reportId", "reportType", "subjectSpotId", "usableUntil"]);
  // The schema itself refuses any extra field, so a private one cannot ride along.
  assert.equal(ArtifactContent.safeParse({ ...artifact.content, evidence: artifact.content.evidence.map((e) => ({ ...e, note: NOTE })) }).success, false);
  assert.equal(ArtifactContent.safeParse({ ...artifact.content, submitterHashes: HASHES }).success, false);
});

test("digest validation: a tampered, re-encoded or malformed artifact is refused and writes nothing", async () => {
  const s = stores();
  const { reports, reviewId } = await reviewedNewSpot(false);
  s.reports = reports;
  const { artifact } = await exportReview(reports, reviewId, { now: APPLY });
  const before = snapshot(s.data);
  const text = new TextDecoder().decode(artifact.bytes);
  const tampered = text.replace('"independentSubmitters":2', '"independentSubmitters":1');
  assert.notEqual(tampered, text);
  const pretty = `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  for (const [bytes, reason] of [
    [tampered, "digestMismatch"], [pretty, "notCanonical"], ["{not json", "malformed"], ['{"content":{},"contentSha256":"00"}', "malformed"],
  ] as const) {
    const result = await importCommunityArtifact(s.data, utf8(bytes), { now: APPLY });
    assert.deepEqual([result.status, (result as Row).reason], ["refused", reason]);
  }
  assert.equal((await openArtifact(artifact.bytes)).ok, true);
  assert.equal(snapshot(s.data), before, "a refused import changes nothing canonical");
});

// =============================================================================================================
// 3. Replay protection and canonical premises
test("replay: the same artifact is alreadyImported, another digest for the review is a conflict, an older decision is stale", async () => {
  const s = await canonicalWorld();
  const spotId = officialSpot(s.data);
  const p1 = await report(s.reports, HASHES[0], { type: "prohibited", spotId });
  await acceptAndQueue(s.reports, p1);
  const first = await proposeEffectReview(s.reports, { reportIds: [p1], decidedBy: "reviewer-1", now: APPLY });
  const v1 = (await exportReview(s.reports, first.reviewId, { now: APPLY })).artifact;
  const p2 = await report(s.reports, HASHES[1], { type: "prohibited", spotId });
  await acceptAndQueue(s.reports, p2);
  const second = await proposeEffectReview(s.reports, { reportIds: [p2], decidedBy: "reviewer-1", now: APPLY });
  const v2 = (await exportReview(s.reports, second.reviewId, { now: APPLY })).artifact;
  assert.deepEqual([v1.content.review.reviewKey, v1.content.review.decisionVersion, v2.content.review.decisionVersion],
    [`effect:${spotId}:prohibited`, 1, 2], "a new decision about the same key is the next version");

  assert.equal((await importCommunityArtifact(s.data, v2.bytes, { now: APPLY })).status, "imported");
  const state = snapshot(s.data);
  assert.deepEqual(await importCommunityArtifact(s.data, v2.bytes, { now: APPLY }), { status: "alreadyImported", reviewId: second.reviewId, sha256: v2.sha256 });
  assert.equal(snapshot(s.data), state, "idempotent: no second canonical mutation");

  const stale = await importCommunityArtifact(s.data, v1.bytes, { now: APPLY });
  assert.deepEqual(stale, { status: "stale", reviewId: first.reviewId, reviewKey: `effect:${spotId}:prohibited`, decisionVersion: 1, importedDecisionVersion: 2 });
  // The same review re-decided by hand with a valid digest is a conflict, never a second application.
  const forged = await sealArtifact({ ...v2.content, review: { ...v2.content.review, decidedBy: "someone-else" } });
  const conflict = await importCommunityArtifact(s.data, forged.bytes, { now: APPLY });
  assert.deepEqual(conflict, { status: "conflict", reviewId: second.reviewId, sha256: forged.sha256, importedSha256: v2.sha256 });
  assert.equal(snapshot(s.data), state, "stale and conflicting artifacts write nothing");
  // The ledger refuses the same around the module.
  const ledger = one(s.data, "SELECT * FROM community_artifact_ledger");
  assert.throws(() => s.data.raw.prepare(`INSERT INTO community_artifact_ledger (artifact_sha256, artifact_schema_version, report_store_schema, review_id, review_kind,
    review_key, decision_version, rule_version, independence_version, evidence_count, independent_submitters, imported_at)
    VALUES (?, 1, 'reports-store.v1', ?, 'effect', ?, 1, 'community-effects.v1', 'community-independence.v1', 1, 1, 'x')`)
    .run("f".repeat(64), first.reviewId, ledger.review_key), /stale artifact/);
  assert.throws(() => s.data.raw.prepare("UPDATE community_artifact_ledger SET decision_version = 9").run(), /immutable/);
  assert.throws(() => s.data.raw.prepare("DELETE FROM community_artifact_ledger").run(), /append-only/);
});

test("canonical premises are re-checked at import: an unknown or merged spot, or a changed base, is refused for re-review", async () => {
  const s = await canonicalWorld();
  const [spotA, spotB] = all(s.data, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 2").map((r) => r.spot_id as string);
  const unknown = await report(s.reports, HASHES[0], { type: "hoursChanged", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J" });
  const merged = await report(s.reports, HASHES[1], { type: "hoursChanged", spotId: spotA });
  await acceptAndQueue(s.reports, unknown, merged);
  const before = count(s.data, "community_artifact_ledger");
  const r1 = await proposeEffectReview(s.reports, { reportIds: [unknown], decidedBy: "r", now: APPLY });
  const a1 = (await exportReview(s.reports, r1.reviewId, { now: APPLY })).artifact;
  assert.equal(((await importCommunityArtifact(s.data, a1.bytes, { now: APPLY })) as Row).reason, "spotNotLive");
  const r2 = await proposeEffectReview(s.reports, { reportIds: [merged], decidedBy: "r", now: APPLY });
  const a2 = (await exportReview(s.reports, r2.reviewId, { now: APPLY })).artifact;
  // The spot is merged after the review was decided (stable IDs + redirect semantics): the decision is not silently
  // redirected; the reviewer re-reviews against the successor.
  s.data.raw.exec("PRAGMA foreign_keys = OFF");
  for (const t of all(s.data, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'spots'")) s.data.raw.exec(`DROP TRIGGER ${t.name}`);
  s.data.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(spotB, spotA);
  const refused = await importCommunityArtifact(s.data, a2.bytes, { now: APPLY }) as Row;
  assert.equal(refused.reason, "spotMerged");
  assert.match(refused.detail, new RegExp(spotB));
  assert.equal(count(s.data, "community_artifact_ledger"), before);
});

test("an artifact naming an unreviewed terms version is refused; the canonical terms mirror comes only from code", async () => {
  const { reports, reviewId } = await reviewedNewSpot(false);
  const { artifact } = await exportReview(reports, reviewId, { now: APPLY });
  const data = new SqliteD1();
  const forged = await sealArtifact({ ...artifact.content, termsVersion: "report-terms.2099-01-01",
    evidence: artifact.content.evidence.map((e) => ({ ...e, acceptedTermsVersion: "report-terms.2099-01-01" })) });
  assert.equal(((await importCommunityArtifact(data, forged.bytes, { now: APPLY })) as Row).reason, "unknownTerms");
  assert.equal((await importCommunityArtifact(data, artifact.bytes, { now: APPLY })).status, "imported");
  assert.deepEqual(one(data, "SELECT terms_version, publication_rights FROM report_terms_versions"), { terms_version: TERMS, publication_rights: "pending" },
    "the draft stays pending: an artifact never carries rights");
});

test("correction, relocation and absence cross the boundary as reviewed candidates only; no coordinate is written from them", async () => {
  const s = await canonicalWorld();
  const spotId = officialSpot(s.data);
  const before = one(s.data, "SELECT latitude, longitude FROM spots WHERE spot_id = ?", spotId);
  const pin = { latitude: Math.round((before.latitude + 0.0009) * 1e5) / 1e5, longitude: before.longitude };
  const m1 = await report(s.reports, HASHES[0], { type: "moved", spotId, proposedLocation: pin });
  const m2 = await report(s.reports, HASHES[1], { type: "moved", spotId, proposedLocation: { latitude: pin.latitude + 0.0001, longitude: pin.longitude } });
  const n1 = await report(s.reports, HASHES[2], { type: "notFound", spotId });
  const n2 = await report(s.reports, HASHES[3], { type: "removed", spotId });
  await acceptAndQueue(s.reports, m1, m2, n1, n2);
  const relocation = await proposeEffectReview(s.reports, { reportIds: [m1, m2], decidedBy: "r", now: APPLY });
  await exportAndImport(s, relocation.reviewId, APPLY);
  await applyCommunityEffect(s.data, relocation.reviewId, { now: APPLY });
  const [candidate] = await communityRelocationCandidates(s.data);
  assert.deepEqual([candidate.spotId, candidate.status, candidate.independentSubmitters, candidate.pins.length], [spotId, "relocationCandidate", 2, 2]);
  assert.ok(candidate.distanceFromCurrentMetres! > 90);
  assert.deepEqual(one(s.data, "SELECT latitude, longitude FROM spots WHERE spot_id = ?", spotId), before, "relocation goes to ADR-0009 review; nothing moves");
  // Absence: an imported, applied review is a hold candidate; the hold itself stays refused while #124 is open.
  const { proposeAbsenceReview } = await import("../src/reports/review.ts");
  const absence = await proposeAbsenceReview(s.reports, { reportIds: [n1, n2], decidedBy: "r", now: APPLY });
  await exportAndImport(s, absence, APPLY);
  const { applyCommunityAbsence, holdCommunityAbsence } = await import("../src/pipeline/community-absence.ts");
  await applyCommunityAbsence(s.data, absence, { now: APPLY });
  const hold = await holdCommunityAbsence(s.data, absence, { now: APPLY });
  assert.ok(hold.status === "blocked" && hold.blockers.includes("sourceNotApproved"));
  assert.equal(one(s.data, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n, 1, "published state changes only through DATA_DB review");
  // REPORTS_DB has no path to a canonical table at all.
  for (const t of ["spots", "tile_snapshot_spots", "source_records", "community_artifact_ledger"]) assert.equal(tables(s.reports).includes(t), false, t);
});

// =============================================================================================================
// 4. Blue/green: DATA_BLUE, REPORTS, DATA_GREEN

/** A deployment: one Worker whose `DB` binding a cutover may switch, and whose `REPORTS_DB` never changes. */
function deployment(pki: TestPki, reports: SqliteD1, initial: SqliteD1, clock: { now: Date }) {
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => clock.now });
  const binding = { data: initial };
  const call = (path: string, body?: unknown) => app.request(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
    { DB: binding.data, REPORTS_DB: reports, ...ATTESTED } as any);
  return { binding, call };
}

async function registerDevice(d: ReturnType<typeof deployment>, pki: TestPki): Promise<TestDevice> {
  const device = await testDevice();
  const ch = ((await (await d.call("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" })).json()) as Row).challenge;
  const att = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
  const res = await d.call("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(att) });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return device;
}

let counter = 0;
async function attestedReport(d: ReturnType<typeof deployment>, device: TestDevice, body: Record<string, unknown>): Promise<Response> {
  const challengeRes = await d.call("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 });
  if (challengeRes.status !== 201) return challengeRes;
  const ch = ((await challengeRes.json()) as Row).challenge;
  const payload = utf8(JSON.stringify({ schemaVersion: 2, installId: INSTALL, acceptedTermsVersion: TERMS, ...body }));
  const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, payload)), { appId: APP_ID, counter: ++counter });
  return d.call("/v1/reports", { schemaVersion: 2, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } });
}

const reportStoreState = (reports: SqliteD1) => JSON.stringify(["reports", "report_moderation", "report_reviews", "report_review_evidence", "app_attest_keys",
  "report_rate_windows", "report_terms_documents"].map((t) => all(reports, `SELECT * FROM ${t} ORDER BY 1`)));

test("blue/green: reports, moderation, App Attest keys and rate-limit identity survive a cutover and a rollback; only DB switches", async () => {
  // The synthetic App Attest PKI is issued for the real clock, as in test/app-attest-api.test.ts.
  const clock = { now: new Date() };
  const pki = await testPki(clock.now);
  const REPORTS = reportsD1();

  // The local canonical pipeline: six official sources, published. Its bundle bootstraps BLUE, which goes live.
  const local = new SqliteD1();
  await importAllReviewedSources(local, isoSeconds(RECEIVED));
  await publishTiles(local, { now: isoSeconds(RECEIVED) });
  const official = [...new Set(all(local, `SELECT rel.source_id FROM tile_snapshot_spots t JOIN spot_field_provenance p ON p.spot_id = t.spot_id AND p.field = 'existence'
    JOIN source_records r ON r.record_id = p.record_id JOIN source_releases rel ON rel.release_id = r.release_id`).map((r) => r.source_id))].sort();
  assert.equal(official.length, 6, "the six reviewed official sources publish");
  assert.deepEqual(official, SOURCE_ADAPTERS.map((a) => a.registry.sourceId).sort());
  const blueBundle = await buildMultiSourcePromotionBundle(local);
  const BLUE = new SqliteD1(migratedSqlite());
  applyPromotionBundle(BLUE.raw, blueBundle.sql);
  const live = deployment(pki, REPORTS, BLUE, clock);
  const tile = one(BLUE, "SELECT tile_id FROM tile_snapshots ORDER BY tile_id LIMIT 1").tile_id;
  assert.equal((await live.call(`/v1/tiles/${tile}`)).status, 200);

  // REPORTS: two devices register; new-spot reports, a confirmation and a correction arrive while BLUE is live.
  const alice = await registerDevice(live, pki);
  const bob = await registerDevice(live, pki);
  const spotId = officialSpot(BLUE);
  const claim = { spotType: "ashtray", hostType: "convenienceStore" };
  const ids: string[] = [];
  for (const [device, body] of [
    [alice, { type: "missing", proposedLocation: HERE, claim }],
    [bob, { type: "missing", proposedLocation: { latitude: 35.69002, longitude: 139.70001 }, claim }],
    [alice, { type: "exists", spotId }],
    [bob, { type: "moved", spotId, proposedLocation: { latitude: 35.7, longitude: 139.7 } }],
  ] as const) {
    const res = await attestedReport(live, device, body);
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    ids.push(((await res.json()) as Row).reportId);
  }
  assert.equal(count(REPORTS, "app_attest_keys"), 2);
  assert.equal(count(BLUE, "app_attest_keys") + count(BLUE, "reports") + count(BLUE, "report_rate_windows"), 0, "nothing user-derived in BLUE");

  // Moderation and review in REPORTS; the sanitized artifact goes to the local pipeline, never to a live database.
  await acceptAndQueue(REPORTS, ids[0], ids[1]);
  await recordModerationDecision(REPORTS, ids[3], { state: "rejected", decidedBy: "reviewer-1", reason: "insufficientDetail", now: RECEIVED });
  const reviewId = await proposeNewSpotReview(REPORTS, { reportIds: [ids[0], ids[1]], locationReportId: ids[0], decidedBy: "reviewer-1", now: APPLY });
  const pipeline: Stores = { reports: REPORTS, data: local };
  await exportAndImport(pipeline, reviewId, APPLY);
  const applied = await applyCommunityApplication(local, reviewId, { now: APPLY, newSpotId: sequentialSpotIds("C") }) as { spotId: string };
  await publishTiles(local, { now: isoSeconds(APPLY) });
  assert.equal(one(local, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", applied.spotId).n, 0, "#124 open: the community spot stays unpublished");

  // GREEN: fresh migration + promotion v3 from the local pipeline. No report-store table or private value travels.
  const greenBundle = await buildMultiSourcePromotionBundle(local);
  for (const needle of ["INSERT INTO reports", "report_moderation", "report_review", "app_attest", "report_rate_windows", "report_terms_documents",
    "community_artifact_ledger", "community_evidence_reports", ...ids, alice.keyIdBase64, bob.keyIdBase64, "submitter", INSTALL]) {
    assert.equal(greenBundle.sql.includes(needle), false, `promotion.sql carries ${needle}`);
  }
  const GREEN = new SqliteD1(migratedSqlite());
  applyPromotionBundle(GREEN.raw, greenBundle.sql);
  assert.equal(count(GREEN, "promotion_multi_bootstrap_completions"), 1);
  assert.deepEqual(all(GREEN, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id"), all(local, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id"),
    "GREEN publishes exactly what the pipeline publishes");
  assert.equal(one(GREEN, "SELECT publication_status FROM sources WHERE source_id = ?", COMMUNITY_SOURCE_ID).publication_status, undefined, "a blocked community source does not travel");

  // Cutover BLUE -> GREEN: only DB changes.
  const beforeCutover = reportStoreState(REPORTS);
  const windowsBefore = one(REPORTS, "SELECT sum(report_count) AS n FROM report_rate_windows").n as number;
  live.binding.data = GREEN;
  assert.equal(reportStoreState(REPORTS), beforeCutover, "the cutover itself changes nothing in REPORTS");
  assert.equal((await live.call(`/v1/tiles/${tile}`)).status, 200);
  // The same device keeps reporting: its key is still registered, its counter continues, its rate-limit identity is the same.
  const afterCutover = await attestedReport(live, alice, { type: "exists", spotId });
  assert.equal(afterCutover.status, 201, "no keyNotRegistered after the cutover");
  // One report counts once in its hourly and once in its daily window, under the submitter identity it already had.
  assert.equal(one(REPORTS, "SELECT sum(report_count) AS n FROM report_rate_windows").n, windowsBefore + 2, "the same submitter identity keeps counting");
  assert.equal(one(REPORTS, "SELECT count(DISTINCT submitter_hash) AS n FROM report_rate_windows").n, 2, "no new identity appeared");
  assert.equal(count(REPORTS, "reports"), 5, "reports, old and new, in the same store");
  assert.deepEqual(all(REPORTS, "SELECT state FROM report_moderation WHERE report_id = ?", ids[3]).map((r) => r.state), ["rejected"], "moderation decisions remain");
  assert.equal(one(REPORTS, "SELECT state FROM report_reviews WHERE review_id = ?", reviewId).state, "exported");
  assert.equal(count(GREEN, "reports") + count(GREEN, "app_attest_keys"), 0, "GREEN holds no report state");

  // Rollback GREEN -> BLUE: report history does not roll back; published state does.
  live.binding.data = BLUE;
  const afterRollback = await attestedReport(live, bob, { type: "exists", spotId });
  assert.equal(afterRollback.status, 201);
  assert.equal(count(REPORTS, "reports"), 6, "nothing in REPORTS was rolled back");
  assert.equal(count(BLUE, "reports"), 0);
  assert.deepEqual(all(BLUE, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id").length > 0, true, "BLUE serves its own published state again");
  // A failed promotion (a corrupt bundle on a fresh target) changes no report either.
  const reportsBeforeFailure = reportStoreState(REPORTS);
  assert.throws(() => applyPromotionBundle(new SqliteD1(migratedSqlite()).raw, greenBundle.sql.replace("INSERT INTO promotion_multi_bootstrap_completions", "INSERT INTO no_such_table")));
  assert.equal(reportStoreState(REPORTS), reportsBeforeFailure, "canonical promotion failure: reports preserved");
  // Issue #124 is untouched by all of it.
  assert.equal(COMMUNITY_PUBLICATION.state, "pending");
  assert.equal(CURRENT_REPORT_TERMS.publicationRights, "pending");
});

test("a communityReported spot's confirmation: independence is attested in REPORTS_DB and bound to the spot's evidence in DATA_DB", async () => {
  const s = await canonicalWorld();
  const a = await report(s.reports, HASHES[0], { type: "missing", proposedLocation: HERE, claim: { spotType: "ashtray" } });
  await acceptAndQueue(s.reports, a);
  const reviewId = await proposeNewSpotReview(s.reports, { reportIds: [a], locationReportId: a, decidedBy: "r", now: APPLY, tier: "communityReported" });
  await exportAndImport(s, reviewId, APPLY);
  const { spotId } = await applyCommunityApplication(s.data, reviewId, { now: APPLY, newSpotId: sequentialSpotIds("R") }) as { spotId: string };
  const confirm = await report(s.reports, HASHES[1], { type: "exists", spotId });
  await acceptAndQueue(s.reports, confirm);
  const effect = await proposeConfirmation(s, { spotId, reportIds: [confirm], decidedBy: "r", now: APPLY });
  assert.deepEqual(JSON.parse(one(s.data, "SELECT base_report_ids FROM community_artifact_ledger WHERE review_id = ?", effect.applicationId).base_report_ids), [a]);
  await applyCommunityEffect(s.data, effect.applicationId, { now: APPLY });
  assert.deepEqual(await upgradeCommunityEvidence(s.data, effect.applicationId, { decidedBy: "r", now: APPLY }), { spotId, confirmations: 2 });
});

// =============================================================================================================
// 5. Retention at scale
test("retention is bounded, idempotent and resumable: each pass is one batch, a repeat changes nothing, and runs finish", async () => {
  const reports = reportsD1();
  for (let i = 0; i < 5; i++) await report(reports, HASHES[i % 4], { type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", note: NOTE });
  const late = new Date(minimizeAfter(RECEIVED).getTime() + 1000);
  const first = await applyReportRetention(reports, { now: late, batchSize: 2 });
  assert.deepEqual([first.redactedReports, first.complete], [2, false]);
  assert.equal(one(reports, "SELECT count(*) AS n FROM reports WHERE redacted_at IS NULL").n, 3, "an interrupted run keeps what it committed");
  const rest = await runReportRetention(reports, { now: late, batchSize: 2 });
  assert.deepEqual([rest.redactedReports, rest.complete, rest.batches], [3, true, 2]);
  const again = await applyReportRetention(reports, { now: late, batchSize: 2 });
  assert.deepEqual([again.redactedReports, again.purgedRateWindows, again.complete], [0, 0, true], "idempotent");
  assert.equal(JSON.stringify(all(reports, "SELECT * FROM reports")).includes(NOTE), false);
  await assert.rejects(applyReportRetention(reports, { now: late, batchSize: 0 }), /positive integer/);
});

// =============================================================================================================
// 6. Migration streams, remote moderation guards, #124
test("migration streams are separate, and the long-lived report stream is append-only with no destructive statement", () => {
  const canonical = readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql"));
  const reportStream = readdirSync(new URL("../migrations-reports/", import.meta.url)).filter((f) => f.endsWith(".sql"));
  assert.ok(reportStream.length >= 1 && reportStream.every((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)));
  assert.equal(reportStream.some((f) => canonical.includes(f)), false, "no file name is shared between the streams");
  for (const f of reportStream) {
    const sql = readFileSync(new URL(`../migrations-reports/${f}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /DROP\s+TABLE|DELETE\s+FROM\s+reports|ALTER\s+TABLE\s+\w+\s+DROP|\bVACUUM\b/i, `${f} must stay non-destructive`);
  }
  const canonical25 = readFileSync(new URL("../migrations/0025_durable_report_store_boundary.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(canonical25, /DROP\s+TABLE|DELETE\s+FROM/i, "the legacy report tables are kept, not dropped");
  const reports = reportsD1();
  assert.deepEqual(tables(reports), ["app_attest_challenges", "app_attest_keys", "report_moderation", "report_rate_windows", "report_review_evidence",
    "report_reviews", "report_store_meta", "report_terms_documents", "reports"], "REPORTS_DB holds no canonical table");
  const data = new SqliteD1();
  for (const t of ["report_reviews", "report_review_evidence", "report_store_meta", "report_terms_documents"]) assert.equal(tables(data).includes(t), false, t);
});

test("remote moderation needs every explicit flag, a typed production confirmation and an interactive terminal; the default is local", () => {
  const tty = { interactive: true, ci: false };
  const id = "12345678-1234-4234-8234-123456789abc";
  assert.deepEqual(moderationTarget(["list"], tty), { ok: true, target: { kind: "local" }, rest: ["list"] });
  assert.deepEqual(moderationTarget([], { interactive: false, ci: true }), { ok: true, target: { kind: "local" }, rest: [] }, "local needs no terminal");
  const refusals: [string[], RegExp][] = [
    [["--env", "staging", "list"], /pass --remote explicitly/],
    [["--remote", "list"], /--env staging\|production/],
    [["--remote", "--env", "local", "list"], /--env staging\|production/],
    [["--remote", "--env", "staging", "list"], /--database-id/],
    [["--remote", "--env", "staging", "--database-id", "00000000-0000-0000-0000-000000000001"], /placeholders/],
    [["--remote", "--env", "production", "--database-id", id], /--confirm-production mannerpath-production-reports/],
    [["--remote", "--env", "production", "--database-id", id, "--confirm-production", "mannerpath-production"], /typed exactly/],
    [["--remot"], /unknown flag/],
  ];
  for (const [argv, error] of refusals) {
    const r = moderationTarget(argv, tty);
    assert.equal(r.ok, false, argv.join(" "));
    assert.match((r as { error: string }).error, error);
  }
  const prod = ["--remote", "--env", "production", "--database-id", id, "--confirm-production", "mannerpath-production-reports", "list"];
  for (const facts of [{ interactive: false, ci: false }, { interactive: true, ci: true }]) {
    assert.match((moderationTarget(prod, facts) as { error: string }).error, /interactive terminal/, "never unattended");
  }
  assert.deepEqual(moderationTarget(prod, tty), { ok: true, rest: ["list"],
    target: { kind: "remote", environment: "production", databaseName: "mannerpath-production-reports", databaseId: id } });
});

test("#124 stays a maintainer decision: publication pending, draft terms grant nothing, the community source is blocked", async () => {
  assert.equal(COMMUNITY_PUBLICATION.state, "pending");
  assert.equal(CURRENT_REPORT_TERMS.publicationRights, "pending");
  const { reviewedSource } = await import("../src/pipeline/registry.ts");
  assert.equal(reviewedSource(COMMUNITY_SOURCE_ID).publicationStatus, "blocked");
  // An old draft-consented artifact never gains rights through the boundary.
  const s = await canonicalWorld();
  const spotId = officialSpot(s.data);
  const p1 = await report(s.reports, HASHES[0], { type: "prohibited", spotId });
  const p2 = await report(s.reports, HASHES[1], { type: "prohibited", spotId });
  await acceptAndQueue(s.reports, p1, p2);
  const { reviewId } = await proposeEffectReview(s.reports, { reportIds: [p1, p2], decidedBy: "r", now: APPLY });
  await exportAndImport(s, reviewId, APPLY);
  await applyCommunityEffect(s.data, reviewId, { now: APPLY });
  const hold = await holdCommunityEffect(s.data, reviewId, { now: APPLY, sourceApprovedInCode: true });
  assert.ok(hold.status === "blocked" && hold.blockers.includes("termsNotGranted"));
});
