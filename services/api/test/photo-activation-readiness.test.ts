// Photo intake activation readiness (docs/release/V1_PHOTO_ACTIVATION_HANDOFF.md). The repository keeps photo intake
// closed: no photo terms version is reviewed on either side. The approved state is exercised only through the
// `reviewed` test seam; nothing here registers a version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configBody } from "../src/config/dto.ts";
import { photoIntakePolicy, PHOTO_RETENTION_CRON, PHOTO_STORAGE_POLICY, REVIEWED_PHOTO_TERMS } from "../src/reports/photo-policy.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { reportsD1, SqliteD1 } from "./support/sqlite-d1.ts";

const repo = (path: string) => new URL(`../../../${path}`, import.meta.url);
const bucket = { async put() { assert.fail("not called"); }, async head() { assert.fail("not called"); } };
const configured = () => ({
  DB: new SqliteD1(), REPORTS_DB: reportsD1(), PRIVATE_PHOTOS: bucket,
  PHOTO_EVIDENCE: "on", PHOTO_STORAGE_POLICY,
  REPORT_RETENTION: "cleanup", REPORT_RETENTION_CRON: PHOTO_RETENTION_CRON,
  REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath",
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41",
  REPORT_SUBMITTER_PEPPER: "x".repeat(32),
});

test("no photo terms version is reviewed, so a fully configured deployment still advertises no photo intake", () => {
  assert.deepEqual(REVIEWED_PHOTO_TERMS, []);
  assert.equal(photoIntakePolicy(configured()).enabled, false);
  assert.equal(configBody(configured()).reports.photoEvidenceEnabled, false);
});

test("the app's reviewed photo terms list mirrors the server's", () => {
  const swift = readFileSync(repo("apps/apple/MannerPath/MannerPath/Features/Reports/ReportPhotos.swift"), "utf8");
  const declared = /static let reviewedPhotoTerms: \[String\] = \[([^\]]*)\]/.exec(swift);
  assert.ok(declared, "PhotoEvidencePolicy.reviewedPhotoTerms is declared as a literal list");
  const versions = [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(versions, [...REVIEWED_PHOTO_TERMS]);
});

test("once the current terms version is reviewed, intake opens only with every binding in place", () => {
  const reviewed = [CURRENT_REPORT_TERMS.version];
  const policy = photoIntakePolicy(configured(), undefined, reviewed);
  assert.equal(policy.enabled, true);
  assert.equal(policy.photoTermsCovered(CURRENT_REPORT_TERMS.version), true);
  assert.equal(policy.photoTermsCovered("report-terms.2099-01-01"), false, "consent to another version is not covered");
  // A reviewed version that is not the one /v1/config shows (version mismatch) keeps intake closed.
  assert.equal(photoIntakePolicy(configured(), undefined, ["report-terms.2099-01-01"]).enabled, false);
  for (const missing of ["REPORTS_DB", "PRIVATE_PHOTOS", "PHOTO_STORAGE_POLICY", "PHOTO_EVIDENCE",
    "REPORT_RETENTION", "REPORT_RETENTION_CRON", "REPORT_ATTESTATION", "REPORT_APP_ATTEST_APP_ID"]) {
    const env = configured();
    delete (env as Record<string, unknown>)[missing];
    assert.equal(photoIntakePolicy(env, undefined, reviewed).enabled, false, missing);
  }
});
