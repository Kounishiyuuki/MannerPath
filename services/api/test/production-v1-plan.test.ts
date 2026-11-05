// The v1.0 production plan: committed production databases, no R2, the retention cron only, registration paused, no
// App ID in the file, and registration opens only on approved, non-draft terms (docs/release/V1_PRODUCTION_INTAKE.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonc } from "../scripts/disposable-env.ts";
import { PRODUCTION_WORKER, V1_PRODUCTION, intakeBlockers, productionConfig, productionSteps } from "../scripts/production-v1-plan.ts";
import { CURRENT_REPORT_TERMS, REPORT_TERMS } from "../src/reports/terms.ts";

const committed = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("binds only the committed production databases, no R2, the retention cron only, registration paused, no App ID", () => {
  const c = productionConfig(committed, "/api");
  assert.equal(c.name, PRODUCTION_WORKER);
  assert.equal("env" in c || "r2_buckets" in c || "routes" in c, false);
  assert.deepEqual(c.d1_databases.map((d) => [d.binding, d.database_id]),
    committed.env.production.d1_databases.map((d: any) => [d.binding, d.database_id]));
  assert.deepEqual(c.triggers.crons, [V1_PRODUCTION.retentionCron]);
  assert.equal(c.vars.REPORT_RETENTION, "cleanup");
  assert.equal(c.vars.REPORT_RETENTION_CRON, V1_PRODUCTION.retentionCron);
  assert.equal(c.vars.REPORT_ATTESTATION, "required");
  assert.equal(c.vars.REPORT_REGISTRATION, "paused");
  assert.equal(c.vars.REPORT_APP_ATTEST_ENVIRONMENT, "production");
  assert.equal(c.vars.REPORT_APP_ATTEST_BUNDLE_VERSIONS, "8");
  assert.equal("REPORT_APP_ATTEST_APP_ID" in c.vars, false);
  assert.equal(Object.keys(c.vars).some((k) => /PHOTO|PEPPER/.test(k)), false);
  assert.equal(c.ratelimits[0].namespace_id === "9801", false, "staging's limiter namespace");
});

test("refuses a committed production that is not paused or does not require App Attest", () => {
  for (const vars of [{ REPORT_ATTESTATION: "required", REPORT_REGISTRATION: "enabled" }, { REPORT_ATTESTATION: "disabled", REPORT_REGISTRATION: "paused" }]) {
    const bad = structuredClone(committed);
    bad.env.production.vars = vars;
    assert.throws(() => productionConfig(bad, "/api"));
  }
});

test("the draft terms block registration; the printed launch never opens it", () => {
  assert.equal(CURRENT_REPORT_TERMS.version.endsWith(".draft"), true, "update this test when #124 is approved");
  const blockers = intakeBlockers();
  assert.equal(blockers.length, 2);
  const { launch } = productionSteps(blockers);
  assert.equal(launch.some((l) => /BLOCKED/.test(l)), true);
  assert.equal(launch.some((l) => /enabled|secret put REPORT_APP_ATTEST_APP_ID/.test(l)), false);
});

test("only an approved, non-draft version with publication rights unblocks; the draft never does", () => {
  const draft = REPORT_TERMS[0];
  assert.equal(intakeBlockers({ ...draft, publicationRights: "granted" }).length, 1, "a granted draft is still the draft");
  assert.equal(intakeBlockers({ ...draft, version: "report-terms.2026-12-01", publicationRights: "revoked" }).length, 1);
  assert.deepEqual(intakeBlockers({ ...draft, version: "report-terms.2026-12-01", publicationRights: "granted" }), []);
  assert.equal(productionSteps([]).launch.some((l) => /enabled/.test(l)), true);
});

test("stop deletes the App ID (existing keys included) and rollback re-checks it", () => {
  const { stop, rollback } = productionSteps([]);
  assert.equal(stop.includes("npm run production:v1-stop"), true);
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  assert.match(scripts["production:v1-stop"], /secret delete REPORT_APP_ATTEST_APP_ID .*&& npm run --silent production:v1-check -- --stage stopped$/);
  assert.equal(rollback.some((l) => /RE-DELETE the App ID/.test(l)), true);
  assert.equal(rollback.some((l) => /migrations-reports-rollback\/0011_/.test(l)), true);
});
