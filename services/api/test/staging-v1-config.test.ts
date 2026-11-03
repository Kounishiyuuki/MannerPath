// The v1.0 staging deploy config: staging databases only, no R2, no cron, no photo bindings, registration paused,
// App Attest and the challenge limiter set (docs/release/V1_PHOTO_FREE_STAGING_E2E.md §3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonc } from "../scripts/disposable-env.ts";
import { STAGING_WORKER, stagingConfig } from "../scripts/staging-v1-config.ts";

const committed = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const A = "11111111-2222-4333-8444-555555555555", B = "66666666-7777-4888-9999-000000000000";
const input = {
  "--db-id": A, "--reports-db-id": B, "--app-id": "ABCDE12345.com.example.mannerpath.staging",
  "--attest-environment": "production", "--bundle-versions": "42", "--registration-max-per-hour": "20",
  "--registration-max-per-day": "50", "--limiter-namespace": "9801", "--limiter-limit": "60",
};

test("binds only the staging databases with their own IDs, no R2, no cron, no photo bindings, registration paused", () => {
  const c = stagingConfig(committed, input, "/api");
  assert.equal(c.name, STAGING_WORKER);
  assert.equal("env" in c || "r2_buckets" in c || "routes" in c, false);
  assert.deepEqual(c.triggers.crons, []);
  assert.deepEqual(c.d1_databases.map((d) => [d.binding, d.database_name, d.database_id]),
    [["DB", "mannerpath-staging", A], ["REPORTS_DB", "mannerpath-staging-reports", B]]);
  assert.equal(c.vars.REPORT_ATTESTATION, "required");
  assert.equal(c.vars.REPORT_REGISTRATION, "paused");
  assert.equal(Object.keys(c.vars).some((k) => /PHOTO|PEPPER/.test(k)), false);
  assert.deepEqual(c.ratelimits, [{ name: "CHALLENGE_RATE_LIMITER", namespace_id: "9801", simple: { limit: 60, period: 60 } }]);
  assert.equal(c.observability.logs.invocation_logs, false);
});

test("refuses placeholders, committed (production) IDs, a shared ID and malformed App Attest or cap values", () => {
  const production = committed.env.production.d1_databases.map((d: any) => d.database_id);
  const bad: Array<[string, string]> = [
    ["--db-id", "00000000-0000-0000-0000-000000000000"], ["--reports-db-id", production[1]], ["--db-id", production[0]],
    ["--reports-db-id", A], ["--app-id", "com.example.mannerpath"], ["--attest-environment", "sandbox"],
    ["--bundle-versions", "1;2"], ["--registration-max-per-hour", "0"], ["--registration-max-per-day", "10"],
    ["--limiter-limit", "-1"],
  ];
  for (const [flag, value] of bad) assert.throws(() => stagingConfig(committed, { ...input, [flag]: value }, "/api"), undefined, `${flag}=${value}`);
});

test("once staging's IDs are committed, only those IDs are accepted", () => {
  const withIds = structuredClone(committed);
  withIds.env.staging.d1_databases[0].database_id = A; withIds.env.staging.d1_databases[1].database_id = B;
  assert.equal(stagingConfig(withIds, input, "/api").d1_databases[1].database_id, B);
  assert.throws(() => stagingConfig(withIds, { ...input, "--reports-db-id": "77777777-7777-4777-8777-777777777777" }, "/api"), /committed ID/);
});
