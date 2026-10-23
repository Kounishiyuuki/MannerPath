import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
// v1.0 P8: the photo-backed new-place flow end to end on SYNTHETIC data only — local SQLite stand-ins for REPORTS_DB and
// DATA_DB, the in-process Worker, a memory photo store and a synthetic App Attest PKI. A pass here proves the code path,
// not a staging or production run (docs/release/V1_PHOTO_REPORT_E2E.md lists what only a deployed run can show).
//
//   STEP 1 user: attested `missing` report (pin, type, access) -> 1–3 photos, retry, idempotency, metadata stripped.
//   STEP 2 operator: moderation queue, private photo check (test abstraction: no operator viewer exists on main),
//          photo approve/reject, report accept/hold/reject, duplicate candidates.
//   STEP 3 gate: no photo / pending / rejected / erasure lead / deletion queue / other premises missing -> refused.
//   STEP 4 pipeline: review -> sealed artifact -> DATA_DB import -> apply -> quality -> tiles -> promotion.
//
// The single-report route is the existing `communityReported` tier (ADR-0012): one moderated, consented report with an
// explicit spot type. The community source is BLOCKED and the report terms are a DRAFT (Issue #124); publication is
// shown by simulating that approval explicitly, exactly as community-publication-readiness.test.ts does.
import { test } from "node:test";
import assert from "node:assert/strict";
import jpeg from "jpeg-js";
import { createApp, app as readApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { isoSeconds } from "../src/db.ts";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { importCommunityArtifact } from "../src/pipeline/community-artifact.ts";
import { applyCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { type PromotionRegistry, buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { minimizeAfter } from "../src/reports/create.ts";
import { runReportRetention } from "../src/reports/retention.ts";
import { moderationQueuePage, recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { moderateEvidencePhoto, newSpotPhotoGate, photoEvidenceStrength } from "../src/reports/photos.ts";
import { MemoryEvidencePhotoStorage, PHOTO_ERASURE_LEAD_MS } from "../src/reports/photo-storage.ts";
import { exportReview, listNewSpotCandidates, proposeNewSpotReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS, reviewedTerms } from "../src/reports/terms.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { assert as makeAssertion, attest, testDevice, testPki, type TestDevice } from "./support/app-attest-fixture.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { assertNothingPrivate, publicSurface } from "./support/public-surface.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite, reportsD1 } from "./support/sqlite-d1.ts";
import { v1TileBody, v1TileRows } from "./support/tiles.ts";

type Row = Record<string, any>;
const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID,
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };
const TERMS = CURRENT_REPORT_TERMS.version;
const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
// Away from every reviewed fixture, so the community pin is its own place.
const HERE = { latitude: 35.60001, longitude: 139.60001 };
const NEAR = { latitude: 35.60005, longitude: 139.60004 };
const NOTE = "E2E非公開メモ PRV-8841";
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const CLAIM = { spotType: "ashtray", hostType: "convenienceStore", environment: "outdoor", accessType: "public" };
const EXIF_TEXT = "GPSLatitude=35.60001;Device=PRIVATE-PHONE";

// ---- TEST ONLY simulation of the future #124 approval (same as the readiness tests) ---------------------------------
const SIM_ATTRIBUTION = "TEST ONLY simulated community attribution";
const simulateRightsGranted = (db: SqliteD1) => {
  db.raw.prepare(`UPDATE sources SET publication_status = 'approved', attribution_text = ?, license_name = 'TEST ONLY simulated report terms',
    license_url = 'https://example.invalid/report-terms' WHERE source_id = ?`).run(SIM_ATTRIBUTION, COMMUNITY_SOURCE_ID);
  db.raw.prepare("UPDATE report_terms_versions SET publication_rights = 'granted' WHERE terms_version = ?").run(TERMS);
};
const SIMULATED_REGISTRY: PromotionRegistry = {
  source: (id) => id === COMMUNITY_SOURCE_ID
    ? { ...COMMUNITY_REGISTRY, publicationStatus: "approved", attributionText: SIM_ATTRIBUTION,
        licenseName: "TEST ONLY simulated report terms", licenseUrl: "https://example.invalid/report-terms" }
    : reviewedSource(id),
  terms: (v) => ({ ...reviewedTerms(v), publicationRights: "granted" }),
};

const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");

/** A JPEG as a phone would send it: an EXIF (TIFF, orientation 1) segment that also carries location and device text. */
function phoneJpeg(seed: number): Uint8Array {
  const plain = new Uint8Array(jpeg.encode({ width: 4, height: 3, data: new Uint8Array(48).map((_, i) => (i % 4 === 3 ? 255 : (seed + i) & 255)) }, 90).data);
  const exif = new Uint8Array(112);
  exif.set([69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  exif.set(new TextEncoder().encode(EXIF_TEXT), 32);
  const segment = new Uint8Array([255, 225, (exif.length + 2) >> 8, (exif.length + 2) & 255, ...exif]);
  return new Uint8Array([...plain.subarray(0, 2), ...segment, ...plain.subarray(2)]);
}

/** The local Worker with photo intake on, a memory photo store, and one App Attest identity per device. */
async function intake() {
  const reports = reportsD1(), storage = new MemoryEvidencePhotoStorage(), pki = await testPki();
  const clock = { now: RECEIVED };
  const worker = createApp({ now: () => clock.now, appAttestTrustAnchor: pki.root,
    photoEvidence: { enabled: true, storage, photoTermsCovered: (v) => v === TERMS } });
  const post = (path: string, body: unknown) => worker.request(path, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }, { DB: new SqliteD1(), REPORTS_DB: reports, ...ENV } as any)
    // Read every body once here: an unread Worker response stream keeps the test from settling.
    .then(async (res) => new Response(await res.text(), { status: res.status, headers: res.headers }));
  const challenge = async (purpose: "registration" | "report", device: TestDevice) => {
    const res = await post("/v1/app-attest/challenges", { schemaVersion: 1, purpose, ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) });
    assert.equal(res.status, 201);
    return (await res.json() as Row).challenge as string;
  };
  // The synthetic attestation certificate is valid around the real clock, so registration alone runs at real time.
  const device = async () => {
    const intakeTime = clock.now;
    clock.now = new Date();
    const d = await testDevice(), ch = await challenge("registration", d);
    const object = await attest(d, await sha256(registrationClientData(base64Decode(ch)!, d.keyId)), { appId: APP_ID, pki });
    const reg = await post("/v1/app-attest/keys", { schemaVersion: 1, keyId: d.keyIdBase64, challenge: ch, attestationObject: base64Encode(object) });
    assert.equal(reg.status, 201, await reg.clone().text());
    clock.now = intakeTime;
    return d;
  };
  /** challenge -> exact payload bytes -> assertion, as the iPhone client signs reports and photos. */
  const signed = async (d: TestDevice, schemaVersion: number, value: unknown) => {
    const payload = utf8(JSON.stringify(value)), ch = await challenge("report", d);
    const assertion = await makeAssertion(d, await sha256(reportClientData(base64Decode(ch)!, d.keyId, payload)), { appId: APP_ID });
    return { schemaVersion, payload: base64Encode(payload), attestation: { keyId: d.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } };
  };
  const report = (d: TestDevice, value: Row) => signed(d, 3, value).then((e) => post("/v1/reports", e));
  const photo = (d: TestDevice, reportId: string, value: Row) => signed(d, 2, value).then((e) => post(`/v1/reports/${reportId}/photos`, e));
  return { reports, storage, clock, device, report, photo, post };
}
type Intake = Awaited<ReturnType<typeof intake>>;

const newPlace = (at = HERE, claim: Row | null = CLAIM) => ({ schemaVersion: 3, type: "missing", proposedLocation: at, installId: INSTALL,
  idempotencyKey: hex32(), acceptedTermsVersion: TERMS, note: NOTE, ...(claim ? { claim } : {}) });
const photoInput = (reportId: string, seed: number) => ({ schemaVersion: 2, reportId, idempotencyKey: crypto.randomUUID(),
  acceptedTermsVersion: TERMS, mediaType: "image/jpeg", image: base64Encode(phoneJpeg(seed)) });

/** STEP 1 for one device: an attested report and `photos` uploads; returns the report and photo IDs. */
async function submitWithPhotos(h: Intake, photos: number, at = HERE, claim: Row | null = CLAIM) {
  const d = await h.device();
  const res = await h.report(d, newPlace(at, claim));
  assert.equal(res.status, 201, await res.clone().text());
  const { reportId } = await res.json() as Row;
  const photoIds: string[] = [];
  for (let i = 0; i < photos; i++) {
    const p = await h.photo(d, reportId, photoInput(reportId, 40 + i * 50));
    assert.equal(p.status, 201, await p.clone().text());
    photoIds.push((await p.json() as Row).photoId);
  }
  return { device: d, reportId, photoIds };
}

const decidePhoto = (h: Intake, photoId: string, state: "approved" | "rejected") =>
  moderateEvidencePhoto(h.reports, photoId, state, { now: APPLY, decidedBy: "photo-reviewer", reason: state === "approved" ? "usableEvidence" : "privacyRisk" });
async function acceptAndQueue(h: Intake, reportId: string) {
  await recordModerationDecision(h.reports, reportId, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
  await setReconciliationState(h.reports, reportId, "queued", RECEIVED);
}
const proposeReported = (h: Intake, reportId: string, now = APPLY) =>
  proposeNewSpotReview(h.reports, { reportIds: [reportId], locationReportId: reportId, decidedBy: "reviewer-1", now, tier: "communityReported" });

async function world() {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  await publishTiles(db, { now: isoSeconds(RECEIVED) });
  return db;
}

test("STEP 1: an attested report, then 1–3 photos; retries are idempotent and the stored image carries no metadata", async () => {
  const h = await intake();
  const d = await h.device();
  const body = newPlace();
  const first = await h.report(d, body);
  assert.equal(first.status, 201, await first.clone().text());
  const { reportId } = await first.json() as Row;
  // The app lost the response and resends the same draft (same idempotency key, fresh assertion): one report.
  const resent = await h.report(d, body);
  assert.equal((await resent.json() as Row).reportId, reportId);
  assert.equal(one(h.reports, "SELECT count(*) AS n FROM reports").n, 1);
  const row = one(h.reports, "SELECT * FROM reports WHERE report_id = ?", reportId);
  assert.deepEqual([row.report_type, row.attestation_status, row.accepted_terms_version, row.proposed_latitude, row.claim_spot_type],
    ["missing", "verified", TERMS, HERE.latitude, "ashtray"]);
  assert.equal(JSON.stringify(row).includes(d.keyIdBase64) || JSON.stringify(row).includes(INSTALL), false, "no key or install ID stored");

  // Photo 1 fails in storage (network/R2), the app retries the same photo key: one stored object.
  const input = photoInput(reportId, 10);
  const put = h.storage.put.bind(h.storage);
  h.storage.put = async () => { throw new Error("r2 offline"); };
  assert.notEqual((await h.photo(d, reportId, input)).status, 201);
  assert.notEqual(await newSpotPhotoGate(h.reports, reportId, RECEIVED), "approved");
  h.storage.put = put;
  const ok = await h.photo(d, reportId, input);
  assert.equal(ok.status, 201, await ok.clone().text());
  const again = await h.photo(d, reportId, input);
  assert.deepEqual(await again.json(), await ok.json());
  for (const seed of [60, 110]) assert.equal((await h.photo(d, reportId, photoInput(reportId, seed))).status, 201);
  assert.equal(h.storage.objects.size, 3);
  assert.notEqual((await h.photo(d, reportId, photoInput(reportId, 200))).status, 201, "a fourth photo is refused");
  // A photo signed by another device cannot attach to this report.
  const other = await h.device();
  assert.notEqual((await h.photo(other, reportId, photoInput(reportId, 220))).status, 201);

  // Stored bytes are re-encoded PNG with no EXIF, location or device text.
  for (const { bytes, metadata } of h.storage.objects.values()) {
    assert.equal(metadata.mediaType, "image/png");
    for (const marker of ["Exif", "GPS", "PRIVATE-PHONE"]) assert.equal(Buffer.from(bytes).includes(Buffer.from(marker)), false, marker);
  }
  assert.equal(await newSpotPhotoGate(h.reports, reportId, RECEIVED), "pending", "received photos wait for the photo moderator");
});

test("STEP 2+3: the operator reviews photos and the report; every gate state short of approval refuses publication", async () => {
  const h = await intake();
  const { reportId, photoIds: [p1, p2, p3] } = await submitWithPhotos(h, 3);
  // The report is in the moderation queue; queue items carry no photo bytes.
  const queue = await moderationQueuePage(h.reports, { state: "pending" });
  assert.ok(queue.items.some((i: Row) => i.report_id === reportId));
  assert.equal(JSON.stringify(queue).includes("private/evidence/"), false);
  // Private photo check: on main there is no operator viewer (P6/#321); the test reads the private store directly.
  const keys = (h.reports.raw.prepare("SELECT storage_key FROM community_evidence_photos WHERE report_id = ?").all(reportId) as Row[]).map((r) => r.storage_key);
  for (const key of keys) assert.ok(h.storage.objects.get(key)!.bytes.length > 0);

  // Not accepted yet: no review, whatever the photos.
  await assert.rejects(proposeReported(h, reportId), /not accepted/);
  // Hold: needsInfo is not accepted either.
  await recordModerationDecision(h.reports, reportId, { state: "needsInfo", decidedBy: "reviewer-1", reason: "insufficientDetail", now: RECEIVED });
  await assert.rejects(proposeReported(h, reportId), /needsInfo, not accepted/);
  await acceptAndQueue(h, reportId);
  // Pending photos -> refused.
  await assert.rejects(proposeReported(h, reportId), /photos: pending/);
  // Rejected photos only (privacy risk) -> refused.
  for (const p of [p1, p2]) await decidePhoto(h, p, "rejected");
  assert.equal(await newSpotPhotoGate(h.reports, reportId, APPLY), "pending");
  await decidePhoto(h, p3, "rejected");
  await assert.rejects(proposeReported(h, reportId), /photos: rejected/);
  assert.equal(one(h.reports, "SELECT count(*) AS n FROM report_reviews").n, 0);

  // A second report without any photo (the app closed after the report): held as `none`.
  const bare = await submitWithPhotos(h, 0, NEAR);
  await acceptAndQueue(h, bare.reportId);
  await assert.rejects(proposeReported(h, bare.reportId), /photos: none/);

  // Approved photo but no stated spot type: the other premises still refuse a single-report listing.
  const vague = await submitWithPhotos(h, 1, { latitude: 35.7, longitude: 139.7 }, null);
  await acceptAndQueue(h, vague.reportId);
  await decidePhoto(h, vague.photoIds[0], "approved");
  assert.equal(await newSpotPhotoGate(h.reports, vague.reportId, APPLY), "approved");
  assert.deepEqual(await photoEvidenceStrength(h.reports, vague.reportId, APPLY), { approvedPhotos: 1, permissionToSmoke: false });
  await assert.rejects(proposeReported(h, vague.reportId), /states no known spot type/);
  // ...and a lone report is never communityVerified.
  await assert.rejects(proposeNewSpotReview(h.reports, { reportIds: [vague.reportId], locationReportId: vague.reportId, decidedBy: "r", now: APPLY }), /needs at least 2/);

  // A rejected report never reaches a review.
  const spam = await submitWithPhotos(h, 1, { latitude: 35.8, longitude: 139.8 });
  await recordModerationDecision(h.reports, spam.reportId, { state: "rejected", decidedBy: "reviewer-1", reason: "insufficientDetail", now: RECEIVED });
  await decidePhoto(h, spam.photoIds[0], "approved");
  await assert.rejects(proposeReported(h, spam.reportId), /rejected, not accepted/);
});

test("duplicates: two devices report the same place; the operator sees one candidate group and keeps one report", async () => {
  const h = await intake();
  const a = await submitWithPhotos(h, 1, HERE), b = await submitWithPhotos(h, 1, NEAR);
  for (const r of [a, b]) await acceptAndQueue(h, r.reportId);
  await decidePhoto(h, a.photoIds[0], "approved");
  const groups = await listNewSpotCandidates(h.reports, { withinMetres: 50, now: APPLY });
  const group = groups.find((g) => g.reportIds.includes(a.reportId))!;
  assert.deepEqual([...group.reportIds].sort(), [a.reportId, b.reportId].sort());
  assert.equal(group.distinctSubmitters, 2);
  assert.deepEqual(Object.fromEntries(group.photoGates.map((g) => [g.reportId, g.gate])), { [a.reportId]: "approved", [b.reportId]: "pending" });
  assert.equal(JSON.stringify(group).includes(NOTE), false);
  // Both as communityVerified needs both photos approved; with b pending it is refused.
  await assert.rejects(proposeNewSpotReview(h.reports, { reportIds: [a.reportId, b.reportId], locationReportId: a.reportId, decidedBy: "r", now: APPLY }), /photos: pending/);
  // The operator discards b from reconciliation (a queued report can no longer be re-moderated as `duplicate`);
  // a alone proceeds as communityReported, and b cannot back anything.
  await setReconciliationState(h.reports, b.reportId, "discarded", APPLY);
  await assert.rejects(proposeReported(h, b.reportId), /discarded, not queued/);
  assert.match(await proposeReported(h, a.reportId), /^ca_/);
});

test("expiry and deletion races: the erasure lead and the deletion queue close the gate between proposal and export", async () => {
  const h = await intake();
  const { reportId, photoIds: [photo] } = await submitWithPhotos(h, 1);
  await acceptAndQueue(h, reportId);
  await decidePhoto(h, photo, "approved");
  const erase = new Date(minimizeAfter(RECEIVED).getTime() - PHOTO_ERASURE_LEAD_MS);
  const reviewId = await proposeReported(h, reportId, new Date(erase.getTime() - 60_000));
  await assert.rejects(exportReview(h.reports, reviewId, { now: erase }), /photos: expired/);
  const queued = await submitWithPhotos(h, 1, NEAR);
  await acceptAndQueue(h, queued.reportId);
  await decidePhoto(h, queued.photoIds[0], "approved");
  const second = await proposeReported(h, queued.reportId);
  h.reports.raw.prepare("INSERT INTO community_photo_deletions SELECT storage_key, ? FROM community_evidence_photos WHERE photo_id = ?").run(isoSeconds(APPLY), queued.photoIds[0]);
  await assert.rejects(exportReview(h.reports, second, { now: APPLY }), /no approved evidence photo/);
  assert.throws(() => h.reports.raw.prepare("UPDATE report_reviews SET state = 'exported', artifact_sha256 = ?, exported_at = ? WHERE review_id = ?")
    .run("0".repeat(64), isoSeconds(APPLY), second), /evidence photo/);
});

test("STEP 4: one approved, photo-backed report becomes a communityReported listing through the existing pipeline; nothing private travels", async () => {
  const h = await intake();
  const { reportId, photoIds } = await submitWithPhotos(h, 2);
  await acceptAndQueue(h, reportId);
  await decidePhoto(h, photoIds[0], "approved");
  await decidePhoto(h, photoIds[1], "rejected");
  const reviewId = await proposeReported(h, reportId);
  const { artifact } = await exportReview(h.reports, reviewId, { now: APPLY });
  const storageKeys = (h.reports.raw.prepare("SELECT storage_key FROM community_evidence_photos").all() as Row[]).map((r) => r.storage_key);
  const submitter = one(h.reports, "SELECT submitter_hash FROM reports WHERE report_id = ?", reportId).submitter_hash as string;
  const PRIVATE = [NOTE, INSTALL, submitter, ...photoIds, ...storageKeys, "private/evidence", "photo", "Exif", "PRIVATE-PHONE"];
  const artifactText = new TextDecoder().decode(artifact.bytes);
  for (const needle of PRIVATE) assert.equal(artifactText.includes(needle), false, `artifact carries ${needle}`);

  const data = await world();
  const imported = await importCommunityArtifact(data, artifact.bytes, { now: APPLY });
  assert.equal(imported.status, "imported", JSON.stringify(imported));
  const { spotId } = await applyCommunityApplication(data, reviewId, { now: APPLY, newSpotId: sequentialSpotIds("E") }) as { spotId: string };
  assert.deepEqual({ ...one(data, "SELECT spot_type, access_type, evidence_quality, community_confirmations FROM spots WHERE spot_id = ?", spotId) },
    { spot_type: "ashtray", access_type: "public", evidence_quality: "communityReported", community_confirmations: 1 });
  const tables = (data.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((t) => t.name);
  assert.equal(tables.some((t) => /photo/.test(t)), false, "DATA_DB has no photo table");
  const dump = JSON.stringify(tables.flatMap((t) => data.raw.prepare(`SELECT * FROM "${t}"`).all()));
  for (const needle of [NOTE, INSTALL, submitter, ...photoIds, ...storageKeys, "private/evidence"]) assert.equal(dump.includes(needle), false, `DATA_DB carries ${needle}`);

  // Blocked source / draft terms (#124): canonical, never published.
  await publishTiles(data, { now: isoSeconds(APPLY) });
  const published = () => one(data, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n === 1;
  assert.equal(published(), false);
  // TEST ONLY: simulate the future rights approval; the existing quality and publish gates then list it.
  simulateRightsGranted(data);
  await publishTiles(data, { now: isoSeconds(APPLY) });
  assert.equal(published(), true);
  const tileBody = v1TileBody(data, one(data, "SELECT tile_id FROM tile_snapshot_spots WHERE spot_id = ?", spotId).tile_id)!;
  const tileSpot = TileBodyV1.parse(JSON.parse(tileBody)).spots.find((s) => s.id === spotId)!;
  assert.equal(tileSpot.evidenceQuality, "communityReported", "labelled as one reviewed report, never as official");
  const quality = await analyzeCorpus(data, { now: isoSeconds(APPLY) });
  assert.equal(quality.nationwide.community.publishedSpots, 1);
  for (const tile of v1TileRows(data)) for (const needle of [...PRIVATE, reportId, reviewId]) assert.equal(tile.body_json.includes(needle), false, `tile carries ${needle}`);
  const detail = await (await readApp.request(`/v1/spots/${spotId}`, {}, { DB: data })).text();
  for (const needle of [...PRIVATE, reportId]) assert.equal(detail.includes(needle), false, `detail carries ${needle}`);

  // Promotion to a fresh database carries the listing and nothing from the report store.
  const bundle = await buildMultiSourcePromotionBundle(data, { registry: SIMULATED_REGISTRY });
  for (const needle of [...PRIVATE, "INSERT INTO reports", "community_evidence_photos", "submitter_hash"]) assert.equal(bundle.sql.includes(needle), false, `bundle carries ${needle}`);
  const target = new SqliteD1(migratedSqlite());
  applyPromotionBundle(target.raw, bundle.sql);
  assert.equal(one(target, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n, 1);

  // Privacy boundary (docs/PRIVACY_BOUNDARY.md): every public read route, on the pipeline DB and on the promoted one,
  // names no photo, key, submitter, note, report ID or review ID.
  const key = one(h.reports, "SELECT key_id, public_key FROM app_attest_keys LIMIT 1");
  const NEEDLES = [NOTE, INSTALL, submitter, key.key_id, key.public_key, ...photoIds, ...storageKeys, EXIF_TEXT, "PRIVATE-PHONE", reportId, reviewId];
  for (const [label, db] of [["pipeline", data], ["promoted", target]] as const) {
    assertNothingPrivate(await publicSurface(db, [spotId]), NEEDLES, label);
    // G5 (unchanged): the promoted source rows keep the review and report IDs internally, for audit.
    const internal = JSON.stringify(db.raw.prepare(`SELECT r.upstream_row_ref, r.raw_values_json, rel.source_url FROM source_records r
      JOIN source_releases rel ON rel.release_id = r.release_id WHERE rel.source_id = ?`).all(COMMUNITY_SOURCE_ID));
    assert.ok(internal.includes(reviewId) && internal.includes(reportId), `${label}: G5 internal IDs kept in source_records`);
    for (const needle of [NOTE, INSTALL, submitter, key.key_id, ...photoIds, ...storageKeys]) assert.equal(internal.includes(needle), false, `${label}: source_records carry ${needle}`);
  }

  // After the 90-day minimization and photo deletion the published facts stay and still name nothing private.
  const LATE = new Date(minimizeAfter(RECEIVED).getTime() + 1000);
  await runReportRetention(h.reports, { now: LATE, photoStorage: h.storage });
  assert.equal(h.storage.objects.size, 0, "every photo object deleted");
  assert.equal(one(h.reports, "SELECT count(*) AS n FROM community_evidence_photos").n, 0);
  assert.deepEqual({ ...one(h.reports, "SELECT note, submitter_hash, proposed_latitude FROM reports WHERE report_id = ?", reportId) },
    { note: null, submitter_hash: null, proposed_latitude: null });
  await publishTiles(data, { now: isoSeconds(LATE) });
  assert.equal(published(), true, "a reviewed fact outlives the report's minimization");
  assertNothingPrivate(await publicSurface(data, [spotId]), NEEDLES, "after retention");
});
