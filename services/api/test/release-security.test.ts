import { test } from "node:test";
import assert from "node:assert/strict";
import { app, REQUEST_URL_MAX_BYTES } from "../src/app.ts";
import type { Db } from "../src/db.ts";
import { ConfigBodyV1 } from "../src/config/dto.ts";
import { KEY_REGISTRATION_MAX_BYTES } from "../src/attest/protocol.ts";
import { REPORT_BODY_MAX_BYTES, REPORT_SUBMISSION_MAX_BYTES } from "../src/reports/dto.ts";

const SENTINEL = "synthetic-sensitive-value-location-35.71-139.77";
const tripwire = (): Db => ({
  prepare() { assert.fail("request must be rejected before database access"); },
  async batch() { assert.fail("request must be rejected before database access"); },
});
const attested = {
  REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath",
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41",
};
function streamed(chunks: Uint8Array[]) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { const chunk = chunks[pulls++]; if (chunk) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = (path: string, headers: Record<string, string> = {}) => new Request(`https://example.test${path}`, {
    method: "POST", body, headers, duplex: "half",
  } as RequestInit);
  return { request, state: () => ({ pulls, cancelled }) };
}

test("unexpected database errors neither log nor disclose credentials or locations", async (t) => {
  const calls: unknown[][] = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) t.mock.method(console, method, (...args: unknown[]) => calls.push(args));
  const db: Db = { prepare() { throw new Error(SENTINEL); }, async batch() { throw new Error(SENTINEL); } };
  const response = await app.request("/v1/tiles/14/14553/6450", {}, { DB: db });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), { error: "serviceUnavailable", detail: "the service is temporarily unavailable" });
  assert.deepEqual(calls, []);
});

test("unsupported public-read methods do no database work; HEAD retains GET headers with no body", async () => {
  for (const path of ["/v1/config", "/v1/readiness", "/v1/tiles/14/14553/6450", "/v1/spots/sp_01V64NN31G72E5KJJ5W22W1A1J"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.equal((await app.request(path, { method }, { DB: tripwire() })).status, 404, `${method} ${path}`);
    }
  }
  const response = await app.request("/v1/config", { method: "HEAD" }, { DB: tripwire() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(await response.text(), "");
});

test("oversized paths, queries and conditional headers fail before D1 access", async () => {
  for (const path of [`/v1/spots/${"x".repeat(REQUEST_URL_MAX_BYTES)}`, `/v1/readiness?q=${"x".repeat(REQUEST_URL_MAX_BYTES)}`]) {
    const response = await app.request(path, {}, { DB: tripwire() });
    assert.equal(response.status, 413);
    assert.equal((await response.json() as any).error, "requestTooLarge");
  }
  for (const value of ["x".repeat(4097), "é".repeat(2049)]) {
    assert.equal((await app.request("/v1/tiles/14/14553/6450", { headers: { "If-None-Match": value } }, { DB: tripwire() })).status, 413);
  }
  const atLimit = "http://localhost/v1/config?q=".padEnd(REQUEST_URL_MAX_BYTES, "x");
  assert.equal((await app.request(atLimit, {}, { DB: tripwire() })).status, 200);
  assert.equal((await app.request(`${atLimit}x`, {}, { DB: tripwire() })).status, 413);
});

test("chunked bodies cancel at their byte limit, including multibyte input and false Content-Length", async () => {
  for (const [path, max, env] of [
    ["/v1/reports", REPORT_BODY_MAX_BYTES, {}], ["/v1/reports", REPORT_SUBMISSION_MAX_BYTES, attested],
    ["/v1/app-attest/challenges", 256, attested], ["/v1/app-attest/keys", KEY_REGISTRATION_MAX_BYTES, attested],
  ] as const) {
    const boundary = streamed([new Uint8Array(max)]);
    const atLimit = await app.fetch(boundary.request(path), { DB: tripwire(), REPORTS_DB: tripwire(), ...env });
    assert.equal(atLimit.status, 400, "exactly the byte limit is parsed, not refused as oversized");
    assert.equal((await atLimit.json() as any).error, "invalidJson");
    assert.deepEqual(boundary.state(), { pulls: 2, cancelled: false });
    for (const unicode of [false, true]) {
      const first = new TextEncoder().encode(unicode ? "あ".repeat(Math.floor(max / 3)) : "x".repeat(max));
      const stream = streamed([first, new Uint8Array(4), new Uint8Array(1024)]);
      const response = await app.fetch(stream.request(path, { "Content-Length": "1" }), { DB: tripwire(), REPORTS_DB: tripwire(), ...env });
      assert.equal(response.status, 413, path);
      assert.deepEqual(stream.state(), { pulls: 2, cancelled: true });
    }
  }
});

test("compressed report and App Attest bodies are refused without reading or inflating", async () => {
  for (const path of ["/v1/reports", "/v1/app-attest/challenges", "/v1/app-attest/keys"]) {
    const stream = streamed([new Uint8Array(1024)]);
    const response = await app.fetch(stream.request(path, { "Content-Encoding": "gzip" }), { DB: tripwire(), REPORTS_DB: tripwire(), ...attested });
    assert.equal(response.status, 415);
    assert.equal((await response.json() as any).error, "unsupportedContentEncoding");
    assert.equal(stream.state().pulls, 0);
  }
});

test("inactive remote writes and photo foundation reject without consuming bodies or touching stores", async () => {
  const env = { DB: tripwire(), REPORTS_DB: tripwire(), REPORT_ATTESTATION: "required" };
  const config = await (await app.request("/v1/config", {}, env)).json() as any;
  assert.equal(config.reports.available, false);
  assert.equal(config.reports.photoEvidenceEnabled, false);
  for (const path of ["/v1/reports", "/v1/app-attest/challenges", "/v1/app-attest/keys", "/v1/reports/test/photos"]) {
    const stream = streamed([new Uint8Array(1024)]);
    const response = await app.fetch(stream.request(path), env);
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(stream.state().pulls, 0);
  }
  assert.equal((await app.request("/v1/reports/test/photos", {}, env)).status, 404);
});

test("public config ignores arbitrary secret bindings and strict contract rejects added fields", async () => {
  const config = await (await app.request("/v1/config", {}, { DB: tripwire(), API_KEY: SENTINEL, WEBHOOK_SECRET: SENTINEL, REPORT_SUBMITTER_PEPPER: SENTINEL } as any)).json() as any;
  assert.equal(JSON.stringify(config).includes(SENTINEL), false);
  assert.equal(ConfigBodyV1.safeParse(config).success, true);
  for (const altered of [{ ...config, apiKey: SENTINEL }, { ...config, reports: { ...config.reports, credential: SENTINEL } }, { ...config, schemaVersions: { ...config.schemaVersions, token: SENTINEL } }]) assert.equal(ConfigBodyV1.safeParse(altered).success, false);
});
