// GET /v1/config — the non-secret compatibility contract (docs/API.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { CONFIG_SCHEMA_VERSION, ConfigBodyV1, MINIMUM_SUPPORTED_SCHEMA_VERSION } from "../src/config/dto.ts";
import { DATA_TILE_ZOOM } from "../src/geo/tile.ts";
import { REPORT_BODY_MAX_BYTES, REPORT_NOTE_MAX, REPORT_SCHEMA_VERSION } from "../src/reports/dto.ts";
import { SPOT_DETAIL_SCHEMA_VERSION } from "../src/spots/dto.ts";
import { TILE_SCHEMA_VERSION } from "../src/tiles/dto.ts";

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
    minimumSupportedSchemaVersion: MINIMUM_SUPPORTED_SCHEMA_VERSION,
    dataTileZoom: DATA_TILE_ZOOM,
    schemaVersions: {
      tile: TILE_SCHEMA_VERSION,
      spotDetail: SPOT_DETAIL_SCHEMA_VERSION,
      report: REPORT_SCHEMA_VERSION,
    },
    reports: { available: true, maxBodyBytes: REPORT_BODY_MAX_BYTES, noteMaxLength: REPORT_NOTE_MAX },
  });
  // The values are the ones the rest of the API actually enforces, not a second copy of them.
  assert.equal(body.dataTileZoom, 14);
  assert.equal(body.reports.maxBodyBytes, 4096);
  assert.equal(body.reports.noteMaxLength, 280);
});

test("/v1/config reports the report endpoint as unavailable exactly when it fails closed", async () => {
  for (const [value, available] of [
    [undefined, true],
    ["disabled", true],
    // Enforcing and misspelled policies both make POST /v1/reports answer 503 until Issue #37.
    ["required", false],
    ["REQUIRED", false],
    ["off", false],
  ] as const) {
    const env = value === undefined ? {} : { REPORT_ATTESTATION: value };
    const body = ConfigBodyV1.parse(await config(env).then((r) => r.json()));
    assert.equal(body.reports.available, available, `REPORT_ATTESTATION=${value}`);

    // The advertised availability must match what the endpoint really does.
    const post = await app.request("/v1/reports", { method: "POST", body: "{}" }, env as any);
    assert.equal(post.status === 503, !available, `REPORT_ATTESTATION=${value}`);
  }
});

test("/v1/config exposes no secret or environment value", async () => {
  const raw = await config({
    REPORT_ATTESTATION: "disabled",
    REPORT_SUBMITTER_PEPPER: "test-pepper-value-not-a-real-secret",
  }).then((r) => r.text());
  assert.equal(raw.includes("test-pepper-value-not-a-real-secret"), false);
  assert.equal(raw.toLowerCase().includes("pepper"), false);
  // The configured attestation policy itself is not echoed, only the derived boolean.
  assert.equal(raw.includes("disabled"), false);
  assert.equal(raw.includes("REPORT_"), false);
});
