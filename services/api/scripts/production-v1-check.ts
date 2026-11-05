// The v1.0 production preflight, one stage at a time (docs/release/V1_PRODUCTION_INTAKE.md §5). READ-ONLY: it runs
// `wrangler d1 migrations list` and `wrangler secret list` (names only), GETs public routes, and POSTs only requests
// the Worker refuses before any write (a photo upload, a registration challenge). It never applies, deploys or puts.
//
//   npm run production:v1-check -- --stage before-db|after-db|after-deploy|after-intake|stopped
//
// Exit 0 only when every check of the stage passes; each failed check is printed by name, never a secret or a body.
// Local checks run at every stage: the build number, the terms bytes and hash, and the terms gate (#385).
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

export interface MigrationReview { database: "DB" | "REPORTS_DB"; name: string; sha256: string; verdict: "approved" | "rejected"; reviewedBy: string }
export interface Observed {
  pending: { DB: string[]; REPORTS_DB: string[] };
  /** SHA-256 of each local migration file, by database and name. */
  fileSha256: (database: "DB" | "REPORTS_DB", name: string) => string;
  reviews: MigrationReview[];
  secrets: string[];
  config: { status: number; body: any };
  readiness: { status: number; body: any };
  photoUpload: { status: number; error?: string };
  registrationChallenge: { status: number; error?: string };
  buildNumbers: string[];
  terms: ReviewedTerms;
  termsFileSha256: string;
}

type Check = [name: string, ok: boolean];

function local(o: Observed): Check[] {
  return [
    [`every target builds CURRENT_PROJECT_VERSION ${V1_PRODUCTION.bundleVersions}`,
      o.buildNumbers.length > 0 && o.buildNumbers.every((b) => b === V1_PRODUCTION.bundleVersions)],
    [`terms ${o.terms.version}: document bytes match the registered SHA-256`, o.termsFileSha256 === o.terms.documentSha256],
  ];
}

function reviewed(o: Observed, database: "DB" | "REPORTS_DB"): Check[] {
  return o.pending[database].map((name) => {
    const r = o.reviews.find((x) => x.database === database && x.name === name);
    return [`${database} ${name}: Lane 2 approved these exact bytes`, r?.verdict === "approved" && r.sha256 === o.fileSha256(database, name)];
  });
}

const closed = (o: Observed): Check[] => [
  ["no App ID secret (intake closed for every key)", !o.secrets.includes(APP_ID)],
  ["/v1/config reports.available:false", o.config.status === 200 && o.config.body?.reports?.available === false],
  ["registration challenge 503 attestationUnavailable", o.registrationChallenge.status === 503 && o.registrationChallenge.error === "attestationUnavailable"],
];

const v1Worker = (o: Observed): Check[] => [
  ["/v1/readiness 200 completed", o.readiness.status === 200 && o.readiness.body?.state === "completed"],
  ["/v1/config report schema 3", o.config.body?.schemaVersions?.report === 3 && o.config.body?.minimumSupportedSchemaVersions?.report === 3],
  ["/v1/config photoEvidenceEnabled:false", o.config.body?.reports?.photoEvidenceEnabled === false],
  [`/v1/config termsVersion is ${o.terms.version}`, o.config.body?.reports?.termsVersion === o.terms.version],
  ["photo upload 503 photoEvidenceDisabled", o.photoUpload.status === 503 && o.photoUpload.error === "photoEvidenceDisabled"],
  ...PEPPERS.map((p): Check => [`secret ${p} is set`, o.secrets.includes(p)]),
];

export function evaluate(stage: Stage, o: Observed): Check[] {
  const checks = local(o);
  const blockers = intakeBlockers(o.terms);
  if (stage === "before-db") {
    checks.push(["REPORTS_DB: only 0004-0011 are unapplied, or none", o.pending.REPORTS_DB.every((n) => /^00(0[4-9]|1[01])_/.test(n))]);
    checks.push(...reviewed(o, "REPORTS_DB"), ...reviewed(o, "DB"));
    checks.push(...closed(o));
  } else if (stage === "after-db") {
    checks.push(["REPORTS_DB: no migration unapplied", o.pending.REPORTS_DB.length === 0]);
    checks.push(["DB: no migration unapplied", o.pending.DB.length === 0]);
    checks.push(...closed(o));
  } else if (stage === "after-deploy" || stage === "stopped") {
    checks.push(["no migration unapplied", o.pending.REPORTS_DB.length + o.pending.DB.length === 0]);
    checks.push(...v1Worker(o), ...closed(o));
  } else {
    // after-intake: never passes on unapproved terms, whatever the remote state.
    checks.push(...blockers.map((b): Check => [`terms gate: ${b}`, false]));
    checks.push(...v1Worker(o));
    checks.push([`secret ${APP_ID} is set`, o.secrets.includes(APP_ID)]);
    checks.push(["/v1/config reports.available:true", o.config.body?.reports?.available === true]);
  }
  return checks;
}

// ---- collection (read-only) ----

function wrangler(apiDir: string, args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args, "-c", `${apiDir}/.wrangler/production-v1/worker.jsonc`],
    { cwd: apiDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
}

export function parsePending(out: string): string[] {
  if (/No migrations to apply/.test(out)) return [];
  return [...out.matchAll(/│\s*(\d{4}_[a-z0-9_]+\.sql)\s*│/g)].map((m) => m[1]);
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

async function observe(apiDir: string, repo: string): Promise<Observed> {
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const dirs = { DB: "migrations", REPORTS_DB: "migrations-reports" } as const;
  const review = JSON.parse(readFileSync(`${apiDir}/release/production-migration-review.json`, "utf8"));
  return {
    pending: {
      DB: parsePending(wrangler(apiDir, ["d1", "migrations", "list", "DB", "--remote"])),
      REPORTS_DB: parsePending(wrangler(apiDir, ["d1", "migrations", "list", "REPORTS_DB", "--remote"])),
    },
    fileSha256: (db, name) => sha(`${apiDir}/${dirs[db]}/${name}`),
    reviews: review.reviews,
    secrets: (JSON.parse(wrangler(apiDir, ["secret", "list", "--format", "json"])) as { name: string }[]).map((s) => s.name),
    config: await call("/v1/config", "GET"),
    readiness: await call("/v1/readiness", "GET"),
    photoUpload: await call("/v1/reports/rp_preflight/photos", "POST", "{}"),
    registrationChallenge: await call("/v1/app-attest/challenges", "POST", JSON.stringify({ schemaVersion: 1, purpose: "registration" })),
    buildNumbers: [...readFileSync(`${repo}/apps/apple/MannerPath/MannerPath.xcodeproj/project.pbxproj`, "utf8")
      .matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1].trim()),
    terms: CURRENT_REPORT_TERMS,
    termsFileSha256: sha(`${repo}/${CURRENT_REPORT_TERMS.documentPath}`),
  };
}

async function main(argv: string[]) {
  const stage = argv[1] as Stage;
  if (argv.length !== 2 || argv[0] !== "--stage" || !STAGES.includes(stage)) throw new Error(`usage: --stage ${STAGES.join("|")}`);
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  // The same generated config as production:v1-plan, so both read the committed production databases.
  const config = productionConfig(parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8")), apiDir);
  mkdirSync(`${apiDir}/.wrangler/production-v1`, { recursive: true });
  writeFileSync(`${apiDir}/.wrangler/production-v1/worker.jsonc`, JSON.stringify(config, null, 2) + "\n");
  const checks = evaluate(stage, await observe(apiDir, `${apiDir}/../..`));
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(JSON.stringify({ event: "productionV1Check", stage, result: failed === 0 ? "PASS" : "FAIL", failed }));
  if (failed > 0) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => { console.error(`production:v1-check failed: ${e instanceof Error ? e.message.split("\n")[0] : "error"}`); process.exitCode = 1; });
}
