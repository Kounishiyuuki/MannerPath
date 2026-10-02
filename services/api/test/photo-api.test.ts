import { test } from "node:test";
import assert from "node:assert/strict";
import { encode } from "fast-png";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { createReport, attestedSubmitter, submitterHash } from "../src/reports/create.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { MemoryEvidencePhotoStorage } from "../src/reports/photo-storage.ts";
import { PHOTO_SUBMISSION_MAX_BYTES } from "../src/reports/photo-dto.ts";
import { assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { reportsD1, SqliteD1 } from "./support/sqlite-d1.ts";

const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID,
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42" };

async function harness(covered = true) {
  const db = reportsD1(), storage = new MemoryEvidencePhotoStorage(), pki = await testPki();
  const now = new Date();
  const app = createApp({ now: () => now, appAttestTrustAnchor: pki.root,
    photoEvidence: { enabled: true, storage, photoTermsCovered: () => covered } });
  const post = (path: string, body: unknown) => app.request(path, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }, { DB: new SqliteD1(), REPORTS_DB: db, ...ENV });
  const device = await testDevice();
  const challenge = async (purpose: "registration" | "report") => {
    const response = await post("/v1/app-attest/challenges", { schemaVersion: 1, purpose,
      ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) });
    assert.equal(response.status, 201);
    return (await response.json() as any).challenge as string;
  };
  const ch = await challenge("registration");
  const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
  assert.equal((await post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64,
    challenge: ch, attestationObject: base64Encode(object) })).status, 201);
  const hash = await submitterHash(attestedSubmitter(device.keyIdBase64), undefined);
  const report = await createReport(db, { schemaVersion: 2, type: "exists",
    spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: crypto.randomUUID(),
    acceptedTermsVersion: CURRENT_REPORT_TERMS.version }, { now, attestationStatus: "verified", submitterHash: hash });
  const input = { schemaVersion: 2, reportId: report.reportId, idempotencyKey: crypto.randomUUID(),
    acceptedTermsVersion: CURRENT_REPORT_TERMS.version, mediaType: "image/png",
    image: base64Encode(encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([1, 2, 3, 255]) })) };
  const sign = async (value: unknown) => {
    const payload = utf8(JSON.stringify(value)), ch = await challenge("report");
    const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, payload)), { appId: APP_ID });
    return { schemaVersion: 2, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } };
  };
  return { app, post, db, storage, input, sign, path: `/v1/reports/${report.reportId}/photos` };
}

test("shipped photo route disabled before reading hostile body; config stays false", async () => {
  const app = createApp();
  const res = await app.request("/v1/reports/unknown/photos", { method: "POST", body: "not JSON" }, { DB: new SqliteD1() });
  assert.equal(res.status, 503);
  assert.equal((await res.json() as any).error, "photoEvidenceDisabled");
  assert.equal((await (await app.request("/v1/config", {}, { DB: new SqliteD1() })).json() as any).reports.photoEvidenceEnabled, false);
});

test("attested photo creation, fresh retry, payload/path binding and challenge replay", async () => {
  const h = await harness();
  const envelope = await h.sign(h.input);
  const first = await h.post(h.path, envelope);
  assert.equal(first.status, 201, await first.clone().text());
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  const photo = await first.json();
  assert.deepEqual(Object.keys(photo as object).sort(), ["photoId", "reportId", "schemaVersion", "state"]);
  assert.equal((await h.post(h.path, envelope)).status, 403);
  const retry = await h.post(h.path, await h.sign(h.input));
  assert.equal(retry.status, 201, await retry.clone().text());
  assert.deepEqual(await retry.json(), photo);
  assert.equal(h.storage.objects.size, 1);
  const mismatched = await h.post("/v1/reports/rp_01V64NN31G72E5KJJ5W22W1A1J/photos", await h.sign(h.input));
  assert.equal(mismatched.status, 400);
  const changed = await h.sign(h.input);
  changed.payload = base64Encode(utf8(JSON.stringify({ ...h.input, idempotencyKey: crypto.randomUUID() })));
  assert.equal((await h.post(h.path, changed)).status, 403);
});

test("terms, ownership and strict privacy schema fail closed; App Attest cannot be disabled", async () => {
  const h = await harness(false);
  const res = await h.post(h.path, await h.sign(h.input));
  assert.equal(res.status, 403);
  assert.equal((await res.json() as any).error, "photoConsentRequired");
  assert.equal(h.storage.objects.size, 0);
  const other = await harness();
  other.db.raw.prepare("UPDATE reports SET submitter_hash=NULL, note=NULL, proposed_latitude=NULL, proposed_longitude=NULL, observed_on=NULL, claim_host_name=NULL, claim_hours_note=NULL, redacted_at=? WHERE report_id=?")
    .run(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), other.input.reportId);
  assert.equal((await other.post(other.path, await other.sign(other.input))).status, 403);
  assert.equal((await h.post(h.path, await h.sign({ ...h.input, gps: { latitude: 1 } }))).status, 400);
  const noAttest = await h.app.request(h.path, { method: "POST", body: "{}" }, { DB: new SqliteD1(), REPORTS_DB: h.db });
  assert.equal(noAttest.status, 503);
});

test("technical route stream limit bounds chunked body before parse or storage", async () => {
  const h = await harness();
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(PHOTO_SUBMISSION_MAX_BYTES + 1)); controller.close();
  } });
  const response = await h.app.fetch(new Request(`http://localhost${h.path}`, {
    method: "POST", body: stream, duplex: "half",
  } as RequestInit), { DB: new SqliteD1(), REPORTS_DB: h.db, ...ENV });
  assert.equal(response.status, 413);
  assert.equal(h.storage.objects.size, 0);
});
