// The v1.0 production plan: committed production databases, no R2, the retention cron only, registration paused, no
// App ID in the file, and registration opens only on approved, non-draft terms (docs/release/V1_PRODUCTION_INTAKE.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonc } from "../scripts/disposable-env.ts";
import { PRODUCTION_WORKER, V1_PRODUCTION, intakeBlockers, productionConfig, productionSteps, rollbackConfigs } from "../scripts/production-v1-plan.ts";
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
  const { launch } = productionSteps(blockers, productionConfig(committed, "/api"));
  assert.equal(launch.some((l) => /BLOCKED/.test(l)), true);
  assert.equal(launch.some((l) => /enabled|secret put REPORT_APP_ATTEST_APP_ID/.test(l)), false);
});

test("only an approved, non-draft version with publication rights unblocks; the draft never does", () => {
  const draft = REPORT_TERMS[0];
  assert.equal(intakeBlockers({ ...draft, publicationRights: "granted" }).length, 1, "a granted draft is still the draft");
  assert.equal(intakeBlockers({ ...draft, version: "report-terms.2026-12-01", publicationRights: "revoked" }).length, 1);
  assert.deepEqual(intakeBlockers({ ...draft, version: "report-terms.2026-12-01", publicationRights: "granted" }), []);
  assert.equal(productionSteps([], productionConfig(committed, "/api")).launch.some((l) => /enabled/.test(l)), true);
});

test("rollback configs: retention off with the Cron kept, then without the Cron; nothing else changes", () => {
  const config = productionConfig(committed, "/api");
  const { retentionOff, noCron } = rollbackConfigs(config);
  assert.equal(retentionOff.vars.REPORT_RETENTION, "off");
  assert.equal(retentionOff.vars.REPORT_RETENTION_CRON, config.vars.REPORT_RETENTION_CRON);
  assert.deepEqual(retentionOff.triggers.crons, config.triggers.crons);
  assert.deepEqual(noCron.triggers.crons, []);
  assert.deepEqual({ ...noCron, triggers: config.triggers, vars: config.vars }, config);
  assert.equal(config.vars.REPORT_RETENTION, "cleanup", "the launch config is untouched");
});

test("stop deletes the App ID (existing keys included) and rollback re-checks it", () => {
  const { stop, rollback } = productionSteps([], productionConfig(committed, "/api"));
  assert.equal(stop.includes("npm run production:v1-stop"), true);
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  assert.match(scripts["production:v1-stop"], /scripts\/production-v1-stop\.ts$/);
  assert.equal(rollback.some((l) => /RE-DELETE the App ID/.test(l)), true);
  assert.equal(rollback.some((l) => /migrations-reports-rollback\/0011_/.test(l)), true);
  // The actual operations and manual gates, in order (other comments ignored).
  const steps = rollback.filter((l) => !l.startsWith("#") || l.startsWith("# CHECKPOINT")).map((l) => l.replace(/\s+#.*$/, "").replace(/ -c \S+/g, ""));
  assert.deepEqual(steps.slice(0, 13), [
    "npm run production:v1-stop",
    "# CHECKPOINT: the stopped preflight above printed PASS. Otherwise STOP HERE: do not switch retention off or roll back.",
    "npx wrangler deploy",
    "npm run production:v1-check -- --stage stopped",
    "# CHECKPOINT: PASS (intake still closed) — otherwise STOP HERE.",
    "npx wrangler triggers deploy",
    "# CHECKPOINT: at least 20 minutes after the line above, an operator confirmed in the dashboard: Triggers empty, no run",
    "npm run production:v1-check -- --stage stopped",
    "# CHECKPOINT: PASS — otherwise STOP HERE.",
    "npx wrangler deployments list",
    "npx wrangler rollback <version-id>",
    "npx wrangler secret list",
    "# CHECKPOINT: REPORT_APP_ATTEST_APP_ID is absent after the rollback. If it is back, RE-DELETE the App ID; never restore it here.",
  ]);
  assert.match(rollback.find((l) => l.startsWith("npx wrangler deploy "))!, /retention-off\.jsonc/);
  assert.match(rollback.find((l) => l.startsWith("npx wrangler triggers deploy "))!, /no-cron\.jsonc/);
});

// Keep dispatch bounded: improve cadence rather than looping past the Free per-invocation query budget.
test("retention proposal has 288 bounded slots daily instead of ten rows per day", () => {
  assert.equal(V1_PRODUCTION.retentionCron, "2-57/5 * * * *");
  assert.deepEqual(productionConfig(committed, "/api").triggers.crons, ["2-57/5 * * * *"]);
});


test("backup bookmarks use configured bindings after a canonical GREEN cutover", () => {
  const config = productionConfig(committed, "/api");
  config.d1_databases[0].database_name = "reviewed-green";
  config.d1_databases[0].database_id = "11111111-1111-4111-8111-111111111111";
  const launch = productionSteps([], config).launch;
  assert.deepEqual(launch.filter(l => l.includes("d1 time-travel info")), [
    "npx wrangler d1 time-travel info REPORTS_DB -c .wrangler/production-v1/worker.jsonc",
    "npx wrangler d1 time-travel info DB -c .wrangler/production-v1/worker.jsonc",
  ]);
  assert.equal(launch.some(l => l.includes("mannerpath-production")), false);
  assert.ok(launch.some(l => l.includes("NOT strictly read-only")));
  assert.ok(launch.some(l => l.includes("PRODUCTION_ADMIN_GATE_PROCEDURE.md")));
  // Names are resolved through the config, never interpolated into shell command text.
  config.d1_databases[0].database_name = "$(do-not-run)";
  assert.equal(productionSteps([], config).launch.some(l => l.includes("do-not-run")), false);
});

test("plan refuses missing or ambiguous configured backup identities", () => {
  const mutations = [
    (c: any) => { delete c.d1_databases; },
    (c: any) => { c.d1_databases.pop(); },
    (c: any) => { c.d1_databases.push({ ...c.d1_databases[0] }); },
    (c: any) => { c.d1_databases[1].binding = "DB"; },
    (c: any) => { delete c.d1_databases[0].database_name; },
    (c: any) => { c.d1_databases[0].database_name = "  "; },
    (c: any) => { c.d1_databases[0].database_name = c.d1_databases[1].database_name; },
    (c: any) => { c.d1_databases[0].database_name = "REPORTS_DB"; },
    (c: any) => { delete c.d1_databases[0].database_id; },
    (c: any) => { c.d1_databases[0].database_id = c.d1_databases[1].database_id; },
  ];
  for (const mutate of mutations) {
    const config = productionConfig(committed, "/api"); mutate(config);
    assert.throws(() => productionSteps([], config), /unambiguous configured/);
  }
});
