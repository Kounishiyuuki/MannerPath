import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { configBody } from "../src/config/dto.ts";
import { configuredPhotoStorage, photoIntakePolicy, PHOTO_RETENTION_CRON, PHOTO_STORAGE_POLICY } from "../src/reports/photo-policy.ts";
import { reportsD1, SqliteD1 } from "./support/sqlite-d1.ts";

const bucket = { async put() { assert.fail("no write before reviewed photo consent"); }, async head() { assert.fail("no read before reviewed photo consent"); } };
const configured = () => ({
  DB: new SqliteD1(), REPORTS_DB: reportsD1(), PRIVATE_PHOTOS: bucket,
  PHOTO_EVIDENCE: "on", PHOTO_STORAGE_POLICY,
  REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: PHOTO_RETENTION_CRON,
  REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath",
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41",
  REPORT_SUBMITTER_PEPPER: "x".repeat(32),
});

test("no binding or environment switch grants photo consent; config and intake fail closed", async () => {
  const app = createApp();
  for (const missing of ["none", "REPORTS_DB", "PRIVATE_PHOTOS", "PHOTO_STORAGE_POLICY", "PHOTO_EVIDENCE",
    "REPORT_RETENTION", "REPORT_RETENTION_CRON", "REPORT_ATTESTATION", "REPORT_APP_ATTEST_APP_ID",
    "REPORT_APP_ATTEST_ENVIRONMENT", "REPORT_APP_ATTEST_BUNDLE_VERSIONS", "REPORT_SUBMITTER_PEPPER"]) {
    const env = configured();
    delete (env as Record<string, unknown>)[missing];
    assert.equal(photoIntakePolicy(env).enabled, false, missing);
    assert.equal(configBody(env).reports.photoEvidenceEnabled, false, missing);
    const response = await app.request("/v1/reports/unknown/photos", { method: "POST", body: "hostile-not-json" }, env);
    assert.equal(response.status, 503, missing);
    assert.equal((await response.json() as any).error, "photoEvidenceDisabled", missing);
  }
});

test("storage maintenance needs a dedicated bucket and exact operational policy, independent of intake", () => {
  const env = configured();
  assert.ok(configuredPhotoStorage(env));
  assert.equal(configuredPhotoStorage({ ...env, PRIVATE_PHOTOS: undefined }), undefined);
  assert.equal(configuredPhotoStorage({ ...env, PRIVATE_PHOTOS: {} as any }), undefined);
  for (const policy of [undefined, "", "public", "private-no-copies-permanent-fences.v1 "]) {
    assert.equal(configuredPhotoStorage({ ...env, PHOTO_STORAGE_POLICY: policy }), undefined);
  }
  for (const flag of [undefined, "off", "true", "ON", "on "]) assert.equal(photoIntakePolicy({ ...env, PHOTO_EVIDENCE: flag }).enabled, false);
  assert.equal(typeof configuredPhotoStorage(env)?.getMetadata, "function");
  assert.equal("get" in configuredPhotoStorage(env)!, false);
  assert.equal("url" in configuredPhotoStorage(env)!, false);
});
