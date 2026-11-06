// The v1.0 production preflight, one stage at a time (docs/release/V1_PRODUCTION_INTAKE.md §5). READ-ONLY: it runs
// `wrangler d1 migrations list` and `wrangler secret list` (names only) and GETs public routes. Only in a stage where
// intake must be closed, and only after the App ID is seen absent and /v1/config says unavailable, does it POST the two
// requests a closed Worker refuses before any write (a photo upload, a registration challenge). `after-intake` sends
// no POST at all: a live Worker could answer a challenge request by storing a challenge.
//
//   npm run production:v1-check -- --stage before-db|after-db|after-deploy|after-intake|stopped
//
// Result PASS (exit 0) only when every check passes and nothing is left unverified; FAIL (exit 1) on any failed check;
// UNVERIFIED (exit 3) when the checks pass but something can only be shown by a separately approved canary.
// Each check is printed by name, never a secret or a response body.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { V1_PRODUCTION, intakeBlockers, productionConfig } from "./production-v1-plan.ts";
import { parseJsonc } from "./disposable-env.ts";
import { CURRENT_REPORT_TERMS, type ReviewedTerms } from "../src/reports/terms.ts";

export const STAGES = ["before-db", "after-db", "after-deploy", "after-intake", "stopped"] as const;
export type Stage = (typeof STAGES)[number];
export const PRODUCTION_ORIGIN = "https://mannerpath-api-production.happywestyuki.workers.dev";
export const PEPPERS = ["REPORT_SUBMITTER_PEPPER", "RATE_LIMIT_KEY_PEPPER"];
export const APP_ID = "REPORT_APP_ATTEST_APP_ID";
type Database = "DB" | "REPORTS_DB";
const DATABASES: Database[] = ["DB", "REPORTS_DB"];
/**
 * The unapplied migrations seen read-only on 2026-11-05. before-db accepts exactly these, so a migration added to
 * main later, or one applied out of band, stops the launch instead of riding along.
 */
export const EXPECTED_PENDING: Record<Database, string[]> = {
  DB: ["0031_derived_coordinate_evidence_guards.sql", "0032_location_precision_v2.sql", "0033_spot_evidence_holds.sql"],
  REPORTS_DB: ["0004_report_idempotency.sql", "0005_app_attest_key_revocation.sql", "0006_bulk_report_rejection.sql",
    "0007_photo_deletion_attempts.sql", "0008_admin_review_audit.sql", "0009_new_spot_photo_gate.sql",
    "0010_new_spot_photo_erasure_window.sql", "0011_new_spot_independent_evidence.sql"],
};
const CLOSED_STAGES: Stage[] = ["before-db", "after-db", "after-deploy", "stopped"];

export interface MigrationReview { database: Database; name: string; sha256: string; verdict: "approved" | "rejected"; reviewedBy: string }
export interface Probe { status: number; error?: string }
export interface Observed {
  pending: Record<Database, string[]>;
  /** SHA-256 of each local migration file, by database and name. */
  fileSha256: (database: Database, name: string) => string;
  reviews: MigrationReview[];
  secrets: string[];
  config: { status: number; body: any };
  readiness: { status: number; body: any };
  /** Absent when not sent: after-intake, or a closed stage that found intake live. */
  photoUpload?: Probe;
  registrationChallenge?: Probe;
  buildNumbers: string[];
  terms: ReviewedTerms;
  termsFileSha256: string;
}

export type Outcome = "pass" | "fail" | "unverified";
type Check = [name: string, outcome: Outcome];
const check = (name: string, ok: boolean): Check => [name, ok ? "pass" : "fail"];

/** POSTs are safe only when intake is observably closed for every key. */
export function intakeObservablyClosed(secrets: string[], config: { status: number; body: any }): boolean {
  return !secrets.includes(APP_ID) && config.status === 200 && config.body?.reports?.available === false;
}

function local(o: Observed): Check[] {
  return [
    check(`every target builds CURRENT_PROJECT_VERSION ${V1_PRODUCTION.bundleVersions}`,
      o.buildNumbers.length > 0 && o.buildNumbers.every((b) => b === V1_PRODUCTION.bundleVersions)),
    check(`terms ${o.terms.version}: document bytes match the registered SHA-256`, o.termsFileSha256 === o.terms.documentSha256),
  ];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

function beforeDb(o: Observed): Check[] {
  const checks: Check[] = [];
  for (const db of DATABASES) {
    checks.push(check(`${db}: unapplied migrations are exactly the expected ${EXPECTED_PENDING[db].length}`, sameSet(o.pending[db], EXPECTED_PENDING[db])));
    const listed = o.reviews.filter((r) => r.database === db).map((r) => r.name);
    checks.push(check(`${db}: Lane 2's review names exactly the expected migrations`, sameSet(listed, EXPECTED_PENDING[db])));
    for (const name of EXPECTED_PENDING[db]) {
      const r = o.reviews.filter((x) => x.database === db && x.name === name);
      checks.push(check(`${db} ${name}: Lane 2 approved these exact bytes`,
        r.length === 1 && r[0].verdict === "approved" && /^[0-9a-f]{64}$/.test(r[0].sha256) && r[0].sha256 === o.fileSha256(db, name)
        && typeof r[0].reviewedBy === "string" && r[0].reviewedBy.length > 0));
    }
  }
  return checks;
}

function closed(o: Observed): Check[] {
  return [
    check("no App ID secret (intake closed for every key)", !o.secrets.includes(APP_ID)),
    check("/v1/config reports.available:false", o.config.status === 200 && o.config.body?.reports?.available === false),
    check("registration challenge 503 attestationUnavailable (sent only once intake is seen closed)",
      o.registrationChallenge?.status === 503 && o.registrationChallenge.error === "attestationUnavailable"),
  ];
}

function v1Worker(o: Observed, stage: Stage): Check[] {
  const checks = [
    check("/v1/readiness 200 completed", o.readiness.status === 200 && o.readiness.body?.state === "completed"),
    check("/v1/config report schema 3", o.config.body?.schemaVersions?.report === 3 && o.config.body?.minimumSupportedSchemaVersions?.report === 3),
    check("/v1/config photoEvidenceEnabled:false", o.config.body?.reports?.photoEvidenceEnabled === false),
    check(`/v1/config termsVersion is ${o.terms.version}`, o.config.body?.reports?.termsVersion === o.terms.version),
    ...PEPPERS.map((p) => check(`secret ${p} is set`, o.secrets.includes(p))),
  ];
  if (stage !== "after-intake") {
    checks.push(check("photo upload 503 photoEvidenceDisabled", o.photoUpload?.status === 503 && o.photoUpload.error === "photoEvidenceDisabled"));
  }
  return checks;
}

export function evaluate(stage: Stage, o: Observed): Check[] {
  const checks = local(o);
  if (stage === "before-db") {
    checks.push(...beforeDb(o), ...closed(o));
  } else if (stage === "after-db") {
    for (const db of DATABASES) checks.push(check(`${db}: no migration unapplied`, o.pending[db].length === 0));
    checks.push(...closed(o));
  } else if (stage === "after-deploy" || stage === "stopped") {
    for (const db of DATABASES) checks.push(check(`${db}: no migration unapplied`, o.pending[db].length === 0));
    checks.push(...v1Worker(o, stage), ...closed(o));
  } else {
    // after-intake: never passes on unapproved terms, whatever the remote state.
    checks.push(...intakeBlockers(o.terms).map((b) => check(`terms gate: ${b}`, false)));
    for (const db of DATABASES) checks.push(check(`${db}: no migration unapplied`, o.pending[db].length === 0));
    checks.push(...v1Worker(o, stage));
    checks.push(check(`secret ${APP_ID} is set`, o.secrets.includes(APP_ID)));
    checks.push(check("/v1/config reports.available:true", o.config.body?.reports?.available === true));
    // available:true holds with registration paused too, and proving it open needs a write (a stored challenge).
    checks.push(["new-key registration is enabled: not observable read-only; needs the separately approved canary", "unverified"]);
  }
  return checks;
}

export function result(checks: Check[]): "PASS" | "FAIL" | "UNVERIFIED" {
  if (checks.some(([, o]) => o === "fail")) return "FAIL";
  return checks.some(([, o]) => o === "unverified") ? "UNVERIFIED" : "PASS";
}

// ---- collection (read-only) ----

function wrangler(apiDir: string, args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args, "-c", `${apiDir}/.wrangler/production-v1/worker.jsonc`],
    { cwd: apiDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
}

export function parsePending(out: string): string[] {
  if (/No migrations to apply/.test(out)) return [];
  const names = [...out.matchAll(/│\s*(\d{4}_[a-z0-9_]+\.sql)\s*│/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("unrecognized `wrangler d1 migrations list` output");
  return names;
}

async function call(path: string, method: "GET" | "POST", body?: string) {
  const res = await fetch(PRODUCTION_ORIGIN + path, {
    method, redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body,
  });
  const text = (await res.text()).slice(0, 8192);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* the check reports the status only */ }
  return { status: res.status, body: json, error: typeof json?.error === "string" ? json.error : undefined };
}

async function observe(stage: Stage, apiDir: string, repo: string): Promise<Observed> {
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const dirs = { DB: "migrations", REPORTS_DB: "migrations-reports" } as const;
  const review = JSON.parse(readFileSync(`${apiDir}/release/production-migration-review.json`, "utf8"));
  const secrets = (JSON.parse(wrangler(apiDir, ["secret", "list", "--format", "json"])) as { name: string }[]).map((s) => s.name);
  const config = await call("/v1/config", "GET");
  const o: Observed = {
    pending: {
      DB: parsePending(wrangler(apiDir, ["d1", "migrations", "list", "DB", "--remote"])),
      REPORTS_DB: parsePending(wrangler(apiDir, ["d1", "migrations", "list", "REPORTS_DB", "--remote"])),
    },
    fileSha256: (db, name) => sha(`${apiDir}/${dirs[db]}/${name}`),
    reviews: Array.isArray(review.reviews) ? review.reviews : [],
    secrets, config,
    readiness: await call("/v1/readiness", "GET"),
    buildNumbers: [...readFileSync(`${repo}/apps/apple/MannerPath/MannerPath.xcodeproj/project.pbxproj`, "utf8")
      .matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1].trim()),
    terms: CURRENT_REPORT_TERMS,
    termsFileSha256: sha(`${repo}/${CURRENT_REPORT_TERMS.documentPath}`),
  };
  if (CLOSED_STAGES.includes(stage) && intakeObservablyClosed(secrets, config)) {
    o.photoUpload = await call("/v1/reports/rp_preflight/photos", "POST", "{}");
    o.registrationChallenge = await call("/v1/app-attest/challenges", "POST", JSON.stringify({ schemaVersion: 1, purpose: "registration" }));
  }
  return o;
}

async function main(argv: string[]) {
  const stage = argv[1] as Stage;
  if (argv.length !== 2 || argv[0] !== "--stage" || !STAGES.includes(stage)) throw new Error(`usage: --stage ${STAGES.join("|")}`);
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  // The same generated config as production:v1-plan, so both read the committed production databases.
  const config = productionConfig(parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8")), apiDir);
  mkdirSync(`${apiDir}/.wrangler/production-v1`, { recursive: true });
  writeFileSync(`${apiDir}/.wrangler/production-v1/worker.jsonc`, JSON.stringify(config, null, 2) + "\n");
  const checks = evaluate(stage, await observe(stage, apiDir, `${apiDir}/../..`));
  for (const [name, outcome] of checks) console.log(`${outcome.toUpperCase().padEnd(10)} ${name}`);
  const r = result(checks);
  console.log(JSON.stringify({ event: "productionV1Check", stage, result: r, failed: checks.filter(([, o]) => o === "fail").length }));
  process.exitCode = r === "PASS" ? 0 : r === "FAIL" ? 1 : 3;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => { console.error(`production:v1-check failed: ${e instanceof Error ? e.message.split("\n")[0] : "error"}`); process.exitCode = 1; });
}
