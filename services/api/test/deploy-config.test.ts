// Deployment configuration guard (docs/OPERATIONS.md, services/AGENTS.md).
//
// These assertions are about what may be *committed*, not about what a maintainer does at the
// console: no environment in the repository may point at a real database, hold a secret, commit the
// App Attest App ID (it carries the Team ID), or accept unattested reports remotely (Issue #37).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { configBody } from "../src/config/dto.ts";
import { attestationConfig } from "../src/reports/attestation.ts";

const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
const CONFIG = new URL("../wrangler.jsonc", import.meta.url);

/** Minimal JSONC reader: strips // and /* *\/ comments outside of string literals. */
function readJsonc(url: URL): any {
  const src = readFileSync(url, "utf8");
  let out = "";
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "\\") { out += src[++i] ?? ""; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out);
}

const config = readJsonc(CONFIG);
const environments: [string, any][] = [
  ["<top level>", config],
  ...Object.entries(config.env ?? {}).map(([name, env]) => [name, env] as [string, any]),
];

test("staging and production-like environments exist and are distinctly named", () => {
  assert.deepEqual(Object.keys(config.env), ["staging", "production"]);
  const names = environments.map(([, env]) => env.name);
  assert.deepEqual(names, ["mannerpath-api", "mannerpath-api-staging", "mannerpath-api-production"]);
  assert.equal(new Set(names).size, names.length);
});

test("no committed environment can reach a real database", () => {
  for (const [name, env] of environments) {
    const databases = env.d1_databases;
    assert.equal(Array.isArray(databases) && databases.length === 1, true, `${name}: one D1 binding`);
    const [db] = databases;
    assert.equal(db.binding, "DB", `${name}: binding name`);
    assert.equal(db.migrations_dir, "migrations", `${name}: migrations dir`);
    assert.equal(db.database_id, PLACEHOLDER_DATABASE_ID, `${name}: database_id must stay the placeholder`);
  }
});

test("no environment commits a secret, and every var is non-secret", () => {
  const secretish = /pepper|secret|token|password|credential|api[_-]?key|private/i;
  for (const [name, env] of environments) {
    for (const key of Object.keys(env.vars ?? {})) {
      assert.equal(secretish.test(key), false, `${name}: ${key} belongs in \`wrangler secret put\`, not vars`);
    }
  }
  assert.equal(existsSync(new URL("../.dev.vars", import.meta.url)), false, ".dev.vars must never be committed");
});

test("remote-like environments require App Attest, and fail closed until a maintainer configures it (Issue #37)", () => {
  // Local accepts unattested schema-1 reports so the endpoint is testable. A deployed environment
  // must never accept an unattested report: it commits REPORT_ATTESTATION=required, and because the
  // App ID (Team ID + bundle ID) and environment are deployment configuration that is never
  // committed, the committed shape alone accepts nothing at all.
  const expected: Record<string, "disabled" | "unsupported"> = {
    "<top level>": "disabled",
    staging: "unsupported",
    production: "unsupported",
  };
  for (const [name, env] of environments) {
    const vars = env.vars ?? {};
    assert.equal("REPORT_APP_ATTEST_APP_ID" in vars, false, `${name}: the App ID carries the Team ID and is set per deployment, not committed`);
    assert.equal("REPORT_APP_ATTEST_ENVIRONMENT" in vars, false, `${name}: the App Attest environment is set per deployment`);
    assert.equal(attestationConfig(vars).kind, expected[name], `${name}: REPORT_ATTESTATION=${vars.REPORT_ATTESTATION}`);
    // The advertised availability follows from the same derivation the Worker uses.
    assert.equal(configBody(vars).reports.available, expected[name] === "disabled", `${name}: /v1/config reports.available`);
  }
  assert.equal((config.env.staging.vars ?? {}).REPORT_ATTESTATION, "required");
  assert.equal((config.env.production.vars ?? {}).REPORT_ATTESTATION, "required");

  // Once a maintainer supplies the two deployment values, the same committed vars enforce App Attest.
  const configured = { ...config.env.production.vars, REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath", REPORT_APP_ATTEST_ENVIRONMENT: "production" };
  assert.equal(attestationConfig(configured).kind, "appAttest");
  assert.equal(configBody(configured).reports.attestation, "appAttest");
});

test("automatic invocation logs, which persist request URLs, are disabled everywhere", () => {
  for (const [name, env] of environments) {
    assert.equal(env.observability?.enabled, true, `${name}: observability`);
    // A Fetch invocation log records the request URL, and a tile path is the z14 cell the user was
    // looking at. Sampling would keep a smaller location history, not none, so it is not the control.
    assert.equal(env.observability.logs?.invocation_logs, false, `${name}: invocation logs must be off`);
    assert.equal("head_sampling_rate" in env.observability, false, `${name}: sampling is not the privacy control`);
  }
});
