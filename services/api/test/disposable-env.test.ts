// Disposable App Attest E2E environment guard (Issue #55, docs/OPERATIONS.md).
//
// The generated configuration must never be able to resolve the committed staging/production Worker
// or database, must fail closed on reports until its App Attest values are set, and must keep
// invocation logs off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configBody } from "../src/config/dto.ts";
import { attestationConfig } from "../src/reports/attestation.ts";
import { disposableConfig, parseJsonc } from "../scripts/disposable-env.ts";

const committed = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const ID = "0123abcd-0123-4abc-8def-0123456789ab";
const make = (over: Partial<{ suffix: string; databaseId: string }> = {}) =>
  disposableConfig(committed, { suffix: "p21", databaseId: ID, apiDir: "/repo/services/api", ...over });

test("the disposable config holds one Worker and one D1 binding, with no env block to fall back to", () => {
  const config = make();
  assert.equal("env" in config, false);
  assert.equal(config.name, "mannerpath-api-e2e-p21");
  assert.deepEqual(config.d1_databases, [{
    binding: "DB",
    database_name: "mannerpath-e2e-p21",
    database_id: ID,
    migrations_dir: "/repo/services/api/migrations",
  }]);
  assert.equal(config.main, "/repo/services/api/src/index.ts");
});

test("it refuses anything that could resolve a committed database or Worker", () => {
  const committedIds = [committed, ...Object.values(committed.env)].flatMap((e: any) => e.d1_databases.map((d: any) => d.database_id));
  for (const id of committedIds) assert.throws(() => make({ databaseId: id }), /database-id/);
  const withRealStaging = structuredClone(committed);
  withRealStaging.env.staging.d1_databases[0].database_id = ID;
  assert.throws(() => disposableConfig(withRealStaging, { suffix: "p21", databaseId: ID, apiDir: "/x" }), /committed in wrangler.jsonc/);
  for (const bad of ["", "ab", "Staging", "p21;rm", "-p21", "a".repeat(33)]) assert.throws(() => make({ suffix: bad }), /--suffix/);
  for (const bad of ["", "not-a-uuid", ID.toUpperCase()]) assert.throws(() => make({ databaseId: bad }), /--database-id/);
});

test("reports fail closed until the three App Attest values are set, then speak App Attest", () => {
  const vars = make().vars;
  assert.deepEqual(vars, { REPORT_ATTESTATION: "required" });
  assert.equal(attestationConfig(vars).kind, "unsupported");
  assert.equal(configBody(vars).reports.available, false);
  const configured = {
    ...vars,
    REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath",
    REPORT_APP_ATTEST_ENVIRONMENT: "development",
    REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41",
  };
  for (const missing of Object.keys(configured).filter((k) => k !== "REPORT_ATTESTATION")) {
    const partial: Record<string, string> = { ...configured };
    delete partial[missing];
    assert.equal(configBody(partial).reports.available, false, `without ${missing}`);
  }
  assert.equal(configBody(configured).reports.attestation, "appAttest");
  assert.equal(configBody(configured).schemaVersions.report, 2);
});

test("invocation logs stay off, and a committed config that enabled them is refused", () => {
  assert.equal(make().observability.logs.invocation_logs, false);
  const leaky = structuredClone(committed);
  leaky.observability.logs.invocation_logs = true;
  assert.throws(() => disposableConfig(leaky, { suffix: "p21", databaseId: ID, apiDir: "/x" }), /invocation_logs/);
});
