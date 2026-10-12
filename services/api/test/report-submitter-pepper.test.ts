import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import type { Db } from "../src/db.ts";
import { SUBMITTER_PEPPER_MIN_BYTES, attestationConfig } from "../src/reports/attestation.ts";

// REPORT_SUBMITTER_PEPPER is part of the App Attest deployment configuration: without a usable one an enforcing
// deployment must accept nothing, rather than store a hash with an empty or weak pepper.

const ATTESTED = {
  REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath",
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41",
};
const SHORT = "s".repeat(SUBMITTER_PEPPER_MIN_BYTES - 1);
const UNUSABLE: [string, string | undefined][] = [
  ["missing", undefined],
  ["empty", ""],
  ["whitespace only", " \t\n".repeat(20)],
  ["short", SHORT],
  ["short, padded with whitespace to the minimum", `${SHORT}${" ".repeat(8)}`],
  // 10 × 3-byte characters: 10 characters, 30 bytes. The minimum is bytes, not characters.
  ["short in bytes", "あ".repeat(10)],
];
const tripwire = (): Db => ({
  prepare() { assert.fail("must fail closed before any database access"); },
  async batch() { assert.fail("must fail closed before any database access"); },
});
const withPepper = (pepper: string | undefined) => (pepper === undefined ? { ...ATTESTED } : { ...ATTESTED, REPORT_SUBMITTER_PEPPER: pepper });

test("an unusable submitter pepper makes an enforcing deployment unsupported", () => {
  for (const [label, pepper] of UNUSABLE) {
    assert.equal(attestationConfig(withPepper(pepper)).kind, "unsupported", label);
  }
});

test("a pepper of at least the minimum UTF-8 bytes enables App Attest and is what the hash uses", () => {
  for (const pepper of ["p".repeat(SUBMITTER_PEPPER_MIN_BYTES), "あ".repeat(11), "x".repeat(64)]) {
    const config = attestationConfig(withPepper(pepper));
    assert.equal(config.kind, "appAttest", pepper);
    assert.equal(config.kind === "appAttest" && config.submitterPepper, pepper);
  }
});

test("an unusable pepper fails closed on every intake route, writes nothing and discloses nothing", async (t) => {
  const logged: unknown[] = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) t.mock.method(console, method, (...args: unknown[]) => logged.push(args));
  for (const [label, pepper] of UNUSABLE) {
    const env = { ...withPepper(pepper), DB: tripwire(), REPORTS_DB: tripwire() };
    for (const path of ["/v1/reports", "/v1/app-attest/challenges", "/v1/app-attest/keys"]) {
      const response = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env);
      assert.equal(response.status, 503, `${label} ${path}`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const text = await response.text();
      assert.equal(JSON.parse(text).error, "attestationUnavailable", `${label} ${path}`);
      for (const leak of ["PEPPER", "pepper", "length", "bytes", String(SUBMITTER_PEPPER_MIN_BYTES)]) {
        assert.equal(text.includes(leak), false, `${label} ${path}: response mentions ${leak}`);
      }
      if (pepper !== undefined && pepper.trim() !== "") assert.equal(text.includes(pepper), false, `${label}: value echoed`);
    }
    const config = await (await app.request("/v1/config", {}, env)).json() as { reports: { available: boolean } };
    assert.equal(config.reports.available, false, `${label}: /v1/config`);
  }
  assert.deepEqual(logged, []);
});
