// Deployment configuration guard (docs/OPERATIONS.md, services/AGENTS.md).
//
// These assertions are about what may be *committed*, not about what a maintainer does at the
// console: no environment in the repository may point at a real database, hold a secret, or enable
// a report attestation mode that does not exist yet (Issue #37).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

test("no environment enables a report attestation mode that does not exist yet (Issue #37)", () => {
  for (const [name, env] of environments) {
    const value = (env.vars ?? {}).REPORT_ATTESTATION;
    assert.equal(
      attestationConfig(value).kind,
      "disabled",
      `${name}: REPORT_ATTESTATION=${value} would make POST /v1/reports fail closed with 503`,
    );
  }
});

test("request logs are sampled rather than complete", () => {
  for (const [name, env] of environments) {
    assert.equal(env.observability?.enabled, true, `${name}: observability`);
    assert.equal(env.observability.head_sampling_rate < 1, true, `${name}: request logs must be sampled`);
  }
});
