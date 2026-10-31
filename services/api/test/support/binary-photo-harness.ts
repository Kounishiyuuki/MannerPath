// TEST/PoC ONLY: harness for src/poc/binary-photo (shared by test/poc-binary-photo.test.ts and scripts/photo-v3-cpu-poc.ts).
// REPORTS_DB is the real migration stream with one end-state change a production migration would make:
// community_evidence_photos.media_type also allows image/jpeg.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import jpeg from "jpeg-js";
import { REGISTRATION_TEST_ENV } from "./registration-env.ts";
import { createApp } from "../../src/app.ts";
import { registrationClientData, reportClientData } from "../../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../../src/attest/bytes.ts";
import { sha256Hex } from "../../src/db.ts";
import { attestedSubmitter, createReport, submitterHash } from "../../src/reports/create.ts";
import { CURRENT_REPORT_TERMS } from "../../src/reports/terms.ts";
import { D1PhotoStore, PHOTOS_DB_SCHEMA } from "../../src/poc/binary-photo/d1-photo-store.ts";
import { PHOTO_V3_CONTENT_TYPE, encodePhotoBody, photoClientData } from "../../src/poc/binary-photo/protocol.ts";
import { handleBinaryPhoto } from "../../src/poc/binary-photo/route.ts";
import { assert as makeAssertion, attest, type TestDevice, testDevice, testPki } from "./app-attest-fixture.ts";
import { SqliteD1, applyMigration, reportMigrationFiles } from "./sqlite-d1.ts";

const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID,
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };

/** The report-store stream with the JPEG-at-rest end state (production would need a reviewed table-rebuild migration). */
export function jpegReportsD1(): SqliteD1 {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of reportMigrationFiles()) {
    let sql = readFileSync(new URL(`../../migrations-reports/${file}`, import.meta.url), "utf8");
    if (file.startsWith("0003_")) {
      assert.ok(sql.includes("CHECK(media_type='image/png')"));
      sql = sql.replace("CHECK(media_type='image/png')", "CHECK(media_type IN ('image/png','image/jpeg'))");
    }
    applyMigration(db, sql);
  }
  return new SqliteD1(db);
}
export function photosD1(budget?: number): SqliteD1 {
  const db = new DatabaseSync(":memory:");
  db.exec(PHOTOS_DB_SCHEMA);
  if (budget) db.prepare("UPDATE photo_store_usage SET budget_bytes = ? WHERE id = 1").run(budget);
  return new SqliteD1(db);
}
export function photo(width = 320, height = 240, seed = 1): Uint8Array {
  const data = new Uint8Array(width * height * 4).map((_, i) => (i * 7 + seed * 31) & 255);
  return new Uint8Array(jpeg.encode({ data, width, height }, 85).data);
}

export async function harness(opts: { budget?: number; now?: Date } = {}) {
  const reports = jpegReportsD1(), photos = photosD1(opts.budget), pki = await testPki(), now = opts.now ?? new Date();
  let current = now; // movable clock for the route and the store; reports are created at `now`
  const setNow = (date: Date) => { current = date; };
  const store = new D1PhotoStore(photos, () => current);
  const core = createApp({ now: () => current, appAttestTrustAnchor: pki.root });
  const dataDb = new SqliteD1();
  const env = { DB: dataDb, REPORTS_DB: reports, ...ENV };
  const app = new Hono();
  app.post("/v3/reports/:reportId/photos", (c) => handleBinaryPhoto(c.req.raw, c.req.param("reportId"), ENV, reports,
    { now: () => current, store, photoTermsCovered: () => true, trustAnchor: pki.root }));
  const postJson = (path: string, body: unknown) => core.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, env);
  const challenge = async (device: TestDevice, purpose: "registration" | "report") => ((await (await postJson("/v1/app-attest/challenges",
    { schemaVersion: 1, purpose, ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) })).json()) as { challenge: string }).challenge;
  const enrol = async () => {
    const device = await testDevice(), ch = await challenge(device, "registration");
    const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
    assert.equal((await postJson("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(object) })).status, 201);
    return device;
  };
  const newReport = async (device: TestDevice) => (await createReport(reports, { schemaVersion: 2, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J",
    installId: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version },
  { now, attestationStatus: "verified", submitterHash: await submitterHash(attestedSubmitter(device.keyIdBase64), ENV.REPORT_SUBMITTER_PEPPER) })).reportId;
  /** Builds a signed v3 body the way the iPhone would. `domain` lets a test sign with the wrong domain. */
  const body = async (device: TestDevice, reportId: string, image: Uint8Array, o: { idempotencyKey?: string; claimed?: Uint8Array; domain?: "photo" | "report" } = {}) => {
    const claimed = o.claimed ?? image;
    const payload = utf8(JSON.stringify({ schemaVersion: 3, kind: "photo", reportId, idempotencyKey: o.idempotencyKey ?? crypto.randomUUID(),
      acceptedTermsVersion: CURRENT_REPORT_TERMS.version, mediaType: "image/jpeg", byteLength: claimed.length, sha256: await sha256Hex(claimed) }));
    const ch = await challenge(device, "report");
    const clientData = (o.domain ?? "photo") === "photo" ? photoClientData(base64Decode(ch)!, device.keyId, payload) : reportClientData(base64Decode(ch)!, device.keyId, payload);
    const assertion = await makeAssertion(device, await sha256(clientData), { appId: APP_ID });
    return encodePhotoBody({ schemaVersion: 3, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } }, image);
  };
  const request = (reportId: string, bytes: Uint8Array, contentType = PHOTO_V3_CONTENT_TYPE) =>
    app.request(`/v3/reports/${reportId}/photos`, { method: "POST", body: bytes, headers: { "Content-Type": contentType } });
  const send = async (reportId: string, bytes: Uint8Array, contentType = PHOTO_V3_CONTENT_TYPE) => {
    const res = await app.request(`/v3/reports/${reportId}/photos`, { method: "POST", body: bytes, headers: { "Content-Type": contentType } });
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };
  return { reports, photos, store, now, setNow, enrol, newReport, body, send, request };
}

