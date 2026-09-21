// GET /v1/config — the non-secret compatibility contract (docs/API.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { CONFIG_RESOURCES, CONFIG_SCHEMA_VERSION, ConfigBodyV1 } from "../src/config/dto.ts";
import { DATA_TILE_ZOOM } from "../src/geo/tile.ts";
import {
  ATTESTED_REPORT_SCHEMA_VERSION, REPORT_BODY_MAX_BYTES, REPORT_NOTE_MAX, REPORT_SCHEMA_VERSION, REPORT_SUBMISSION_MAX_BYTES, ReportRequestV1,
} from "../src/reports/dto.ts";
import { MINIMUM_SPOT_DETAIL_SCHEMA_VERSION, SPOT_DETAIL_SCHEMA_VERSION } from "../src/spots/dto.ts";
import { MINIMUM_TILE_SCHEMA_VERSION, TILE_SCHEMA_VERSION } from "../src/tiles/dto.ts";

/** The body the handler builds, read back through the schema like any other config body. */
function configBodyFixture(): unknown {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    apiVersion: "v1",
    dataTileZoom: DATA_TILE_ZOOM,
    schemaVersions: { tile: TILE_SCHEMA_VERSION, spotDetail: SPOT_DETAIL_SCHEMA_VERSION, report: REPORT_SCHEMA_VERSION },
    minimumSupportedSchemaVersions: { tile: MINIMUM_TILE_SCHEMA_VERSION, spotDetail: MINIMUM_SPOT_DETAIL_SCHEMA_VERSION, report: REPORT_SCHEMA_VERSION },
    reports: { available: true, attestation: "none", maxBodyBytes: REPORT_BODY_MAX_BYTES, maxSubmissionBytes: REPORT_BODY_MAX_BYTES, noteMaxLength: REPORT_NOTE_MAX },
  };
}

// The handler is synchronous (it touches no database), so app.request returns a Response directly.
const config = async (env: Record<string, string> = {}) => await app.request("/v1/config", {}, env as any);

test("/v1/config serves the canonical constants, and reaches no database", async () => {
  // No DB binding is provided at all: a handler that touched D1 would throw here.
  const res = await config();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "public, no-cache");

  const body = ConfigBodyV1.parse(await res.json());
  assert.deepEqual(body, {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    apiVersion: "v1",
    dataTileZoom: DATA_TILE_ZOOM,
    schemaVersions: {
      tile: TILE_SCHEMA_VERSION,
      spotDetail: SPOT_DETAIL_SCHEMA_VERSION,
      report: REPORT_SCHEMA_VERSION,
    },
    minimumSupportedSchemaVersions: {
      tile: MINIMUM_TILE_SCHEMA_VERSION,
      spotDetail: MINIMUM_SPOT_DETAIL_SCHEMA_VERSION,
      report: REPORT_SCHEMA_VERSION,
    },
    reports: { available: true, attestation: "none", maxBodyBytes: REPORT_BODY_MAX_BYTES, maxSubmissionBytes: REPORT_BODY_MAX_BYTES, noteMaxLength: REPORT_NOTE_MAX },
  });
  // The values are the ones the rest of the API actually enforces, not a second copy of them.
  assert.equal(body.dataTileZoom, 14);
  assert.equal(body.reports.maxBodyBytes, 4096);
  assert.equal(body.reports.noteMaxLength, 280);
});

test("compatibility is per resource, and each range is one the server really serves", async () => {
  const body = ConfigBodyV1.parse(await config().then((r) => r.json()));
  // Nothing global: tile, spotDetail and report version independently, so a single minimum could
  // only be right about one of them.
  assert.equal("minimumSupportedSchemaVersion" in body, false);
  assert.deepEqual(Object.keys(body.schemaVersions), [...CONFIG_RESOURCES]);
  assert.deepEqual(Object.keys(body.minimumSupportedSchemaVersions), [...CONFIG_RESOURCES]);
  for (const resource of CONFIG_RESOURCES) {
    assert.equal(body.minimumSupportedSchemaVersions[resource] <= body.schemaVersions[resource], true, resource);
  }

  // The report range is the one the request schema actually enforces: a schemaVersion outside
  // [minimum, current] is rejected.
  const request = { type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f" };
  assert.equal(ReportRequestV1.safeParse({ ...request, schemaVersion: body.schemaVersions.report }).success, true);
  assert.equal(ReportRequestV1.safeParse({ ...request, schemaVersion: body.minimumSupportedSchemaVersions.report - 1 }).success, false);
  assert.equal(ReportRequestV1.safeParse({ ...request, schemaVersion: body.schemaVersions.report + 1 }).success, false);
});

test("a body whose minimum outruns the version it serves is not a valid config", () => {
  const body = ConfigBodyV1.parse(configBodyFixture());
  const broken = { ...body, minimumSupportedSchemaVersions: { ...body.minimumSupportedSchemaVersions, tile: body.schemaVersions.tile + 1 } };
  assert.equal(ConfigBodyV1.safeParse(broken).success, false);
});

const APP_ATTEST = { REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath", REPORT_APP_ATTEST_ENVIRONMENT: "production" };

test("/v1/config reports the report endpoint as unavailable exactly when it fails closed", async () => {
  for (const [env, available] of [
    [{}, true],
    [{ REPORT_ATTESTATION: "disabled" }, true],
    // Enforcing and fully configured: reports are accepted, attested.
    [{ REPORT_ATTESTATION: "required", ...APP_ATTEST }, true],
    // Enforcing without what it verifies against, or misspelled: the endpoint answers 503.
    [{ REPORT_ATTESTATION: "required" }, false],
    [{ REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: "com.example.mannerpath", REPORT_APP_ATTEST_ENVIRONMENT: "production" }, false],
    [{ REPORT_ATTESTATION: "required", ...APP_ATTEST, REPORT_APP_ATTEST_ENVIRONMENT: "prod" }, false],
    [{ REPORT_ATTESTATION: "REQUIRED", ...APP_ATTEST }, false],
    [{ REPORT_ATTESTATION: "off" }, false],
  ] as const) {
    const label = JSON.stringify(env);
    const body = ConfigBodyV1.parse(await config(env).then((r) => r.json()));
    assert.equal(body.reports.available, available, label);

    // The advertised availability must match what the endpoint really does.
    const post = await app.request("/v1/reports", { method: "POST", body: "{}" }, env as any);
    assert.equal(post.status === 503, !available, label);
  }
});

test("/v1/config names the one report protocol and schema version the deployment accepts", async () => {
  const disabled = ConfigBodyV1.parse(await config().then((r) => r.json()));
  assert.equal(disabled.reports.attestation, "none");
  assert.equal(disabled.schemaVersions.report, REPORT_SCHEMA_VERSION);
  assert.equal(disabled.minimumSupportedSchemaVersions.report, REPORT_SCHEMA_VERSION);
  assert.equal(disabled.reports.maxSubmissionBytes, REPORT_BODY_MAX_BYTES);

  // A required deployment cannot accept an unattested v1 report, so v1 is below its minimum: an old
  // client is told to update instead of discovering it through a failure.
  const required = ConfigBodyV1.parse(await config({ REPORT_ATTESTATION: "required", ...APP_ATTEST }).then((r) => r.json()));
  assert.equal(required.reports.attestation, "appAttest");
  assert.equal(required.schemaVersions.report, ATTESTED_REPORT_SCHEMA_VERSION);
  assert.equal(required.minimumSupportedSchemaVersions.report, ATTESTED_REPORT_SCHEMA_VERSION);
  assert.equal(required.reports.maxBodyBytes, REPORT_BODY_MAX_BYTES);
  assert.equal(required.reports.maxSubmissionBytes, REPORT_SUBMISSION_MAX_BYTES);

  // And the endpoint refuses the other version explicitly, whichever mode it is in.
  for (const [env, other] of [[{}, ATTESTED_REPORT_SCHEMA_VERSION], [{ REPORT_ATTESTATION: "required", ...APP_ATTEST }, REPORT_SCHEMA_VERSION]] as const) {
    const res = await app.request("/v1/reports", { method: "POST", body: JSON.stringify({ schemaVersion: other }) }, env as any);
    assert.equal(res.status, 400);
    assert.equal((await res.json() as any).error, "reportSchemaUnsupported");
  }
});

test("/v1/config exposes no secret or environment value", async () => {
  const raw = await config({
    REPORT_ATTESTATION: "disabled",
    REPORT_SUBMITTER_PEPPER: "test-pepper-value-not-a-real-secret",
  }).then((r) => r.text());
  // Nor the App Attest deployment values: the App ID carries the Team ID.
  const attested = await config({ REPORT_ATTESTATION: "required", ...APP_ATTEST }).then((r) => r.text());
  assert.equal(attested.includes("ABCDE12345"), false);
  assert.equal(attested.includes("com.example.mannerpath"), false);
  assert.equal(attested.includes("required"), false);
  assert.equal(raw.includes("test-pepper-value-not-a-real-secret"), false);
  assert.equal(raw.toLowerCase().includes("pepper"), false);
  // The configured attestation policy itself is not echoed, only the derived boolean.
  assert.equal(raw.includes("disabled"), false);
  assert.equal(raw.includes("REPORT_"), false);
});
