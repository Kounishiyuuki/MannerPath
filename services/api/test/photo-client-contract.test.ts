// The iPhone uploader's wire format (AttestedEvidencePhotoUploader.swift) against the local Worker: the shared
// vector pins the exact signed bytes the app produces; the same encoding then goes through App Attest, the photo
// route, sanitization and memory storage, including the retry and limit paths the app relies on.
import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encode } from "fast-png";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { createReport, attestedSubmitter, submitterHash } from "../src/reports/create.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { MemoryEvidencePhotoStorage } from "../src/reports/photo-storage.ts";
import { PHOTO_PAYLOAD_MAX_BYTES, PHOTO_SUBMISSION_MAX_BYTES, PhotoPayloadV2 } from "../src/reports/photo-dto.ts";
import { assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { reportsD1, SqliteD1 } from "./support/sqlite-d1.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../contracts/app-attest/photo-upload-vectors.v1.json", import.meta.url), "utf8"));
const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID,
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };

/** The app's encoding: sorted keys, no whitespace, unescaped slashes (JSON.stringify never escapes them). */
const appPayload = (value: Record<string, unknown>) =>
  utf8(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))));

test("the shared vector is exactly the app's encoding and a strictly valid photo payload", () => {
  assert.equal(vectors.contract, "mannerpath-photo-upload-vectors");
  for (const c of vectors.cases) {
    const fields = { schemaVersion: 2, reportId: c.reportId, idempotencyKey: c.idempotencyKey,
      acceptedTermsVersion: c.acceptedTermsVersion, mediaType: "image/jpeg", image: c.jpegBase64 };
    assert.equal(base64Encode(appPayload(fields)), c.payloadBase64, c.name);
    assert.ok(PhotoPayloadV2.safeParse(JSON.parse(c.payloadUtf8)).success, c.name);
    assert.equal(c.acceptedTermsVersion, CURRENT_REPORT_TERMS.version, "the vector consents to the current terms");
  }
  // The app derives the same bounds (AttestedEvidencePhotoUploader.maxPayloadBytes / maxSubmissionBytes).
  assert.deepEqual([PHOTO_PAYLOAD_MAX_BYTES, PHOTO_SUBMISSION_MAX_BYTES], [6_991_532, 9_326_140]);
});

async function localWorker(enabled = true) {
  const db = reportsD1(), storage = new MemoryEvidencePhotoStorage(), pki = await testPki(), now = new Date();
  const app = createApp({ now: () => now, appAttestTrustAnchor: pki.root,
    ...(enabled ? { photoEvidence: { enabled: true, storage, photoTermsCovered: () => true } } : {}) });
  const request = (path: string, body?: unknown) => app.request(path, body === undefined ? {} : {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }, { DB: new SqliteD1(), REPORTS_DB: db, ...ENV });
  const device = await testDevice();
  const challenge = async (purpose: "registration" | "report") =>
    (await (await request("/v1/app-attest/challenges", { schemaVersion: 1, purpose,
      ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) })).json() as any).challenge as string;
  const ch = await challenge("registration");
  const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
  assert.equal((await request("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64,
    challenge: ch, attestationObject: base64Encode(object) })).status, 201);
  const report = await createReport(db, { schemaVersion: 2, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J",
    installId: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version },
    { now, attestationStatus: "verified", submitterHash: await submitterHash(attestedSubmitter(device.keyIdBase64), ENV.REPORT_SUBMITTER_PEPPER) });
  /** One app attempt: a fresh report-purpose challenge, an assertion over the exact payload, the schema-2 envelope. */
  const upload = async (idempotencyKey: string, imageBase64: string, mediaType = "image/jpeg") => {
    const payload = appPayload({ schemaVersion: 2, reportId: report.reportId, idempotencyKey,
      acceptedTermsVersion: CURRENT_REPORT_TERMS.version, mediaType, image: imageBase64 });
    const c = await challenge("report");
    const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(c)!, device.keyId, payload)), { appId: APP_ID });
    return request(`/v1/reports/${report.reportId}/photos`, { schemaVersion: 2, payload: base64Encode(payload),
      attestation: { keyId: device.keyIdBase64, challenge: c, assertion: base64Encode(assertion) } });
  };
  return { request, upload, storage, reportId: report.reportId };
}

test("an app-encoded JPEG is accepted once; a retry under the same key returns the same photo", async () => {
  const w = await localWorker();
  const config = await (await w.request("/v1/config")).json() as any;
  assert.equal(config.reports.photoEvidenceEnabled, false, "config never advertises intake, even with injected storage");
  const [c] = vectors.cases;
  const first = await w.upload(c.idempotencyKey, c.jpegBase64);
  assert.equal(first.status, 201, await first.clone().text());
  const photo = await first.json() as any;
  assert.deepEqual([photo.schemaVersion, photo.reportId, photo.state], [2, w.reportId, "pending"]);
  const retry = await w.upload(c.idempotencyKey, c.jpegBase64);
  assert.equal(retry.status, 201);
  assert.deepEqual(await retry.json(), photo);
  assert.equal(w.storage.objects.size, 1, "a retry never stores a second photo");
  // Server sanitization stays the metadata gate: the vector's EXIF segment is not in the stored derivative.
  const [stored] = [...w.storage.objects.values()] as any[];
  const bytes: Uint8Array = stored.bytes ?? stored;
  assert.ok(!Buffer.from(bytes).includes(Buffer.from("Exif")), "EXIF removed");
});

test("the documented refusals the app maps: idempotency conflict, attachment limit, disabled route", async () => {
  const w = await localWorker();
  const png = (seed: number) => base64Encode(encode({ width: 2, height: 2, channels: 3, data: new Uint8Array(12).fill(seed) }));
  // The app sends JPEG only; distinct PNGs keep these limit checks independent of JPEG fixtures.
  const key = crypto.randomUUID();
  assert.equal((await w.upload(key, png(1), "image/png")).status, 201);
  const conflict = await w.upload(key, png(2), "image/png");
  assert.deepEqual([conflict.status, (await conflict.json() as any).error], [409, "photoIdempotencyConflict"]);
  assert.equal((await w.upload(crypto.randomUUID(), png(3), "image/png")).status, 201);
  assert.equal((await w.upload(crypto.randomUUID(), png(4), "image/png")).status, 201);
  const fourth = await w.upload(crypto.randomUUID(), png(5), "image/png");
  assert.deepEqual([fourth.status, (await fourth.json() as any).error], [409, "photoAttachmentLimit"]);
  const disabled = await localWorker(false);
  const refused = await disabled.request(`/v1/reports/${disabled.reportId}/photos`, { schemaVersion: 2 });
  assert.deepEqual([refused.status, (await refused.json() as any).error], [503, "photoEvidenceDisabled"]);
});
