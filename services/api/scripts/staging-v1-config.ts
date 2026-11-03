// Writes the v1.0 STAGING deploy config (photo-less reports) into git-ignored `.wrangler/staging-v1/worker.jsonc`
// (docs/release/V1_PHOTO_FREE_STAGING_E2E.md §3). Makes no network call and runs no wrangler command.
//
//   npm run staging:v1-config -- --db-id <uuid> --reports-db-id <uuid> --app-id <TEAMID.bundle> \
//     --attest-environment production|development --bundle-versions <n[,n…]> \
//     --registration-max-per-hour <n> --registration-max-per-day <n> --limiter-namespace <id> --limiter-limit <n>
//
// It is the committed `env.staging` with three differences, so a deploy cannot reach R2 or production:
// - no R2 binding (the bucket only serves the scheduled source check, and staging has no cron; R2 is out of scope);
// - the staging databases' real IDs, which must differ from every committed ID and from each other;
// - the App Attest values, registration caps and CHALLENGE_RATE_LIMITER (B2/B3). REPORT_REGISTRATION stays `paused`.
// No photo binding or photo terms are ever set, so photo routes answer 503 and /v1/config says photoEvidenceEnabled:false.
// Secrets (the two peppers) are never written here: set them with `wrangler secret put` interactively.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./disposable-env.ts";

export const STAGING_WORKER = "mannerpath-api-staging";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FLAGS = ["--db-id", "--reports-db-id", "--app-id", "--attest-environment", "--bundle-versions",
  "--registration-max-per-hour", "--registration-max-per-day", "--limiter-namespace", "--limiter-limit"] as const;
type Input = Record<(typeof FLAGS)[number], string>;

function positiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(n)) throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(value)}`);
  return n;
}

export function stagingConfig(committed: any, input: Input, apiDir: string) {
  const staging = committed.env?.staging;
  if (staging?.name !== STAGING_WORKER) throw new Error(`wrangler.jsonc env.staging must be ${STAGING_WORKER}`);
  // Every database committed outside env.staging (top level, production) is off limits. Once staging's own IDs are
  // committed (the guarded 0003 import requires it), the input must equal them.
  const otherIds = new Set<string>();
  const collect = (cfg: any) => (cfg?.d1_databases ?? []).forEach((d: any) => otherIds.add(d.database_id));
  collect(committed);
  for (const [name, env] of Object.entries(committed.env ?? {})) if (name !== "staging") collect(env);
  for (const [flag, slot] of [["--db-id", 0], ["--reports-db-id", 1]] as const) {
    const id = input[flag], own = staging.d1_databases?.[slot]?.database_id;
    if (!UUID.test(id)) throw new Error(`${flag} must be a D1 UUID, got ${JSON.stringify(id)}`);
    if (/^0{8}-0{4}-0{4}-0{4}-/.test(id)) throw new Error(`${flag} is a placeholder; create the staging database first`);
    if (otherIds.has(id)) throw new Error(`${flag} ${id} is committed for another environment; staging needs its own database`);
    if (own && !/^0{8}-0{4}-0{4}-0{4}-/.test(own) && own !== id) throw new Error(`${flag} must equal env.staging's committed ID`);
  }
  if (input["--db-id"] === input["--reports-db-id"]) throw new Error("DB and REPORTS_DB must be distinct databases");
  if (!/^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(input["--app-id"])) throw new Error("--app-id must be <App ID prefix>.<bundle ID>");
  if (!["production", "development"].includes(input["--attest-environment"])) throw new Error("--attest-environment must be production or development");
  if (!/^[0-9][0-9.]*(,[0-9][0-9.]*)*$/.test(input["--bundle-versions"])) throw new Error("--bundle-versions must be comma-separated build numbers");
  const perHour = positiveInt("--registration-max-per-hour", input["--registration-max-per-hour"]);
  const perDay = positiveInt("--registration-max-per-day", input["--registration-max-per-day"]);
  if (perHour > perDay) throw new Error("--registration-max-per-hour must not exceed --registration-max-per-day");

  const [db, reports] = staging.d1_databases;
  const vars = staging.vars ?? {};
  if (vars.REPORT_ATTESTATION !== "required") throw new Error("env.staging must keep REPORT_ATTESTATION=required");
  return {
    $schema: `${apiDir}/node_modules/wrangler/config-schema.json`,
    name: STAGING_WORKER,
    main: `${apiDir}/${committed.main}`,
    compatibility_date: committed.compatibility_date,
    workers_dev: true,
    preview_urls: false,
    observability: staging.observability,
    vars: {
      ...vars,
      REPORT_REGISTRATION: "paused",
      REPORT_APP_ATTEST_APP_ID: input["--app-id"],
      REPORT_APP_ATTEST_ENVIRONMENT: input["--attest-environment"],
      REPORT_APP_ATTEST_BUNDLE_VERSIONS: input["--bundle-versions"],
      REPORT_REGISTRATION_MAX_PER_HOUR: String(perHour),
      REPORT_REGISTRATION_MAX_PER_DAY: String(perDay),
    },
    ratelimits: [{ name: "CHALLENGE_RATE_LIMITER", namespace_id: String(positiveInt("--limiter-namespace", input["--limiter-namespace"])),
      simple: { limit: positiveInt("--limiter-limit", input["--limiter-limit"]), period: 60 } }],
    triggers: { crons: [] },
    d1_databases: [
      { binding: "DB", database_name: db.database_name, database_id: input["--db-id"], migrations_dir: `${apiDir}/${db.migrations_dir}` },
      { binding: "REPORTS_DB", database_name: reports.database_name, database_id: input["--reports-db-id"], migrations_dir: `${apiDir}/${reports.migrations_dir}` },
    ],
  };
}

function main(argv: string[]) {
  const input: Partial<Input> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as (typeof FLAGS)[number];
    if (!FLAGS.includes(flag) || input[flag] !== undefined) throw new Error(`unknown or repeated argument ${argv[i]}`);
    input[flag] = argv[i + 1] ?? "";
  }
  for (const flag of FLAGS) if (!input[flag]) throw new Error(`${flag} is required`);
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const outDir = `${apiDir}/.wrangler/staging-v1`;
  const config = stagingConfig(parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8")), input as Input, apiDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/worker.jsonc`, JSON.stringify(config, null, 2) + "\n");
  console.log(`wrote ${outDir}/worker.jsonc (worker ${STAGING_WORKER}, no R2, no cron, registration paused)`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
