// The v1.0 (8) PRODUCTION plan for photo-less reports (docs/release/V1_PRODUCTION_INTAKE.md). LOCAL ONLY: it makes no
// network call, runs no wrangler command and changes nothing remote. It writes the deploy config to git-ignored
// `.wrangler/production-v1/worker.jsonc` and prints the ordered launch, stop and rollback steps.
//
//   npm run production:v1-plan
//
// The config is the committed `env.production` with the reviewed v1.0 values below, so nothing is typed by hand:
// - no R2 binding (it only serves the source check, which has no cron here; R2 is out of scope);
// - the committed production database IDs, unchanged;
// - App Attest `production`, build 8, conservative registration caps and CHALLENGE_RATE_LIMITER;
// - the daily retention run (90-day minimization) as the only cron;
// - REPORT_REGISTRATION always `paused`, and no REPORT_APP_ATTEST_APP_ID: it is a secret, so deleting it stops all
//   intake at once without a deploy (docs/SECRETS_AND_ROTATION.md).
// Opening registration is printed only when the current report terms are an approved, non-draft version with
// publication rights (Issue #124). Consent to the draft never becomes a publication right (src/reports/terms.ts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./disposable-env.ts";
import { CURRENT_REPORT_TERMS, type ReviewedTerms } from "../src/reports/terms.ts";
import { validRetentionCron } from "../src/reports/photo-policy.ts";

export const PRODUCTION_WORKER = "mannerpath-api-production";
/** Reviewed v1.0 values (2026-11-05). Each change is a reviewed PR, not a command-line flag. */
export const V1_PRODUCTION = {
  attestEnvironment: "production",
  bundleVersions: "8",
  // Half of staging's caps while CPU headroom and the limiter's 429 are unverified (§2 of the runbook).
  registrationMaxPerHour: 5,
  registrationMaxPerDay: 20,
  // Account-unique; staging uses 9801.
  limiterNamespace: "9802",
  limiterLimit: 60,
  // 03:17 JST daily. Off the hour, so it does not share a minute with other accounts' jobs.
  retentionCron: "17 18 * * *",
} as const;

export function productionConfig(committed: any, apiDir: string) {
  const prod = committed.env?.production;
  if (prod?.name !== PRODUCTION_WORKER) throw new Error(`wrangler.jsonc env.production must be ${PRODUCTION_WORKER}`);
  if (prod.vars?.REPORT_ATTESTATION !== "required") throw new Error("env.production must keep REPORT_ATTESTATION=required");
  if (prod.vars?.REPORT_REGISTRATION !== "paused") throw new Error("env.production must commit REPORT_REGISTRATION=paused");
  const [db, reports] = prod.d1_databases ?? [];
  if (db?.binding !== "DB" || reports?.binding !== "REPORTS_DB") throw new Error("env.production must bind DB then REPORTS_DB");
  if (!validRetentionCron(V1_PRODUCTION.retentionCron)) throw new Error("retention cron is malformed");
  const d1 = (d: any) => ({ binding: d.binding, database_name: d.database_name, database_id: d.database_id, migrations_dir: `${apiDir}/${d.migrations_dir}` });
  return {
    $schema: `${apiDir}/node_modules/wrangler/config-schema.json`,
    name: PRODUCTION_WORKER,
    main: `${apiDir}/${committed.main}`,
    compatibility_date: committed.compatibility_date,
    workers_dev: true,
    preview_urls: false,
    observability: prod.observability,
    vars: {
      ...prod.vars,
      REPORT_REGISTRATION: "paused",
      REPORT_APP_ATTEST_ENVIRONMENT: V1_PRODUCTION.attestEnvironment,
      REPORT_APP_ATTEST_BUNDLE_VERSIONS: V1_PRODUCTION.bundleVersions,
      REPORT_REGISTRATION_MAX_PER_HOUR: String(V1_PRODUCTION.registrationMaxPerHour),
      REPORT_REGISTRATION_MAX_PER_DAY: String(V1_PRODUCTION.registrationMaxPerDay),
      REPORT_RETENTION: "cleanup",
      REPORT_RETENTION_CRON: V1_PRODUCTION.retentionCron,
    },
    ratelimits: [{ name: "CHALLENGE_RATE_LIMITER", namespace_id: V1_PRODUCTION.limiterNamespace,
      simple: { limit: V1_PRODUCTION.limiterLimit, period: 60 } }],
    triggers: { crons: [V1_PRODUCTION.retentionCron] },
    d1_databases: [d1(db), d1(reports)],
  };
}

/** Why registration may not open yet; empty when the terms allow it. */
export function intakeBlockers(terms: ReviewedTerms = CURRENT_REPORT_TERMS): string[] {
  const problems: string[] = [];
  if (terms.version.endsWith(".draft")) problems.push(`current terms ${terms.version} are the draft (Issue #124 open)`);
  if (terms.publicationRights !== "granted") problems.push(`current terms grant no publication rights (${terms.publicationRights})`);
  return problems;
}

export function productionSteps(blockers: string[]): { launch: string[]; stop: string[]; rollback: string[] } {
  const C = "-c .wrangler/production-v1/worker.jsonc";
  const launch = [
    "# 0. Read-only state (expect REPORTS_DB 0004-0011 and DB 0031-0033 unapplied, no secrets, no keys):",
    `npx wrangler d1 migrations list REPORTS_DB ${C} --remote`,
    `npx wrangler d1 migrations list DB ${C} --remote`,
    `npx wrangler secret list ${C}`,
    "# 1. Back up: note the D1 Time Travel bookmark of both databases (Free keeps 7 days).",
    `npx wrangler d1 time-travel info mannerpath-production-reports`,
    `npx wrangler d1 time-travel info mannerpath-production`,
    "npm run production:v1-check -- --stage before-db   # also requires Lane 2's review of each unapplied migration",
    "# 2. Migrations (REPORTS_DB holds no report yet; DB 0031-0033 are the read path's own):",
    `npx wrangler d1 migrations apply REPORTS_DB ${C} --remote`,
    `npx wrangler d1 migrations apply DB ${C} --remote`,
    "npm run production:v1-check -- --stage after-db",
    "# 3. The two peppers, interactively (never on the command line).",
    `npx wrangler secret put REPORT_SUBMITTER_PEPPER ${C}`,
    `npx wrangler secret put RATE_LIMIT_KEY_PEPPER ${C}`,
    "# 4. Deploy. Without the App ID intake is closed: /v1/config available:false, report routes 503 attestationUnavailable.",
    `npx wrangler deploy ${C}`,
    "npm run production:v1-check -- --stage after-deploy",
  ];
  if (blockers.length > 0) {
    launch.push(`# 5. BLOCKED — no App ID, registration paused: ${blockers.join("; ")}.`);
  } else {
    launch.push(
      "# 5. Open intake (operator approval): the App ID, then REPORT_REGISTRATION=enabled in the generated file only.",
      `npx wrangler secret put REPORT_APP_ATTEST_APP_ID ${C}   # 58A7G4U27M.com.kounishiyuuki.MannerPath (not confidential)`,
      `npx wrangler deploy ${C}`,
      "npm run production:v1-check -- --stage after-intake",
      "# 6. First 24h: watch 1102, CPU, 429 and duplicates against the stop criteria (runbook §3).",
    );
  }
  const stop = [
    "# Stop ALL intake, existing keys included, without a deploy (fail-closed: 503 attestationUnavailable, available:false);",
    "# it deletes the App ID after wrangler's own confirmation, then runs the `stopped` preflight:",
    "npm run production:v1-stop",
    "# Stop only new keys: re-run this plan (paused) and deploy.",
    `npx wrangler deploy ${C}`,
  ];
  const rollback = [
    "# Worker: roll back to the previous version, then RE-DELETE the App ID if intake was stopped (a rollback can restore it).",
    `npx wrangler rollback ${C}`,
    `npx wrangler secret list ${C}`,
    "# REPORTS_DB 0011 only (photo-only gate returns; no new-spot export without photos):",
    `npx wrangler d1 execute REPORTS_DB ${C} --remote --file migrations-reports-rollback/0011_new_spot_independent_evidence.sql`,
    "# Anything else: D1 Time Travel restore to the bookmark from step 1 (loses every write after it).",
  ];
  return { launch, stop, rollback };
}

function main(argv: string[]) {
  if (argv.length > 0) throw new Error("production:v1-plan takes no arguments; its values are reviewed constants");
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const outDir = `${apiDir}/.wrangler/production-v1`;
  const config = productionConfig(parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8")), apiDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/worker.jsonc`, JSON.stringify(config, null, 2) + "\n");
  const blockers = intakeBlockers();
  const { launch, stop, rollback } = productionSteps(blockers);
  console.log(`wrote ${outDir}/worker.jsonc (worker ${PRODUCTION_WORKER}, no R2, retention cron only, registration paused)`);
  console.log(["", "## launch", ...launch, "", "## stop", ...stop, "", "## rollback", ...rollback].join("\n"));
  if (blockers.length > 0) process.exitCode = 2;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
