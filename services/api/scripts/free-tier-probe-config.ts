// Writes the FREE-TIER PROBE's Wrangler config and migrations into git-ignored `.wrangler/free-tier-probe[-local]/`
// (docs/release/V1_FREE_TIER_PROBE_RUNBOOK.md). Makes no network call and runs no wrangler command.
//
//   npm run free-probe:config -- --local                                   # local rehearsal (wrangler dev --local)
//   npm run free-probe:config -- --reports-database-id <uuid> --photos-database-id <uuid> [--cron]
//
// The generated config has no `env` block and binds ONLY the two probe databases, so no command run with it can reach
// staging or production. Committed database IDs, placeholders (remote mode) and equal IDs are refused.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./disposable-env.ts";
import { PHOTOS_DB_SCHEMA } from "../src/poc/binary-photo/d1-photo-store.ts";
import { PROBE_IDENTITY } from "../src/poc/free-tier-probe/identity.ts";

export const PROBE_WORKER = "mannerpath-free-tier-probe";
export const PROBE_REPORTS_DB = "mannerpath-free-tier-probe-reports";
export const PROBE_PHOTOS_DB = "mannerpath-free-tier-probe-photos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_IDS = ["00000000-0000-0000-0000-00000000f001", "00000000-0000-0000-0000-00000000f002"];

const identitySql = `CREATE TABLE probe_identity (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL);
INSERT INTO probe_identity (id, name) VALUES (1, '${PROBE_IDENTITY}');
`;
export const PHOTOS_MIGRATION = `-- FREE-TIER PROBE ONLY: the PoC photo store plus probe bookkeeping. Synthetic data.
${PHOTOS_DB_SCHEMA}
${identitySql}CREATE TABLE probe_config (id INTEGER PRIMARY KEY CHECK (id = 1), trust_anchor TEXT NOT NULL);
CREATE TABLE probe_blob_checks (id TEXT PRIMARY KEY, bytes BLOB NOT NULL, sha256 TEXT NOT NULL);
`;

export function probeConfig(committed: any, input: { reportsDatabaseId: string; photosDatabaseId: string; cron: boolean; local: boolean; apiDir: string; outDir: string }) {
  for (const [flag, id] of [["--reports-database-id", input.reportsDatabaseId], ["--photos-database-id", input.photosDatabaseId]] as const) {
    if (!UUID.test(id)) throw new Error(`${flag} must be a D1 UUID, got ${JSON.stringify(id)}`);
    if (!input.local && /^0{8}-0{4}-0{4}-0{4}-/.test(id)) throw new Error(`${flag} is a placeholder; create the probe database first`);
  }
  if (input.reportsDatabaseId === input.photosDatabaseId) throw new Error("the two probe databases must be distinct");
  const committedIds = new Set<string>();
  const collect = (cfg: any) => (cfg?.d1_databases ?? []).forEach((d: any) => committedIds.add(d.database_id));
  collect(committed); for (const env of Object.values(committed.env ?? {})) collect(env);
  for (const id of [input.reportsDatabaseId, input.photosDatabaseId]) {
    if (!input.local && committedIds.has(id)) throw new Error(`${id} is a database committed in wrangler.jsonc; the probe needs its own`);
  }
  return {
    $schema: `${input.apiDir}/node_modules/wrangler/config-schema.json`,
    name: PROBE_WORKER,
    main: `${input.apiDir}/src/poc/free-tier-probe/worker.ts`,
    compatibility_date: committed.compatibility_date,
    workers_dev: true,
    preview_urls: false,
    // CPU time is read from Workers analytics (aggregate); request URLs and bodies are never logged.
    observability: { enabled: true, logs: { enabled: true, invocation_logs: false } },
    vars: {
      REPORT_ATTESTATION: "required",
      // A synthetic App ID: the probe trusts only the driver's TEST root, never Apple's, so no real app can enrol.
      REPORT_APP_ATTEST_APP_ID: "PROBE00000.invalid.mannerpath.free-tier-probe",
      REPORT_APP_ATTEST_ENVIRONMENT: "production",
      REPORT_APP_ATTEST_BUNDLE_VERSIONS: "1",
      REPORT_REGISTRATION: "enabled",
      REPORT_REGISTRATION_MAX_PER_HOUR: "20",
      REPORT_REGISTRATION_MAX_PER_DAY: "50",
    },
    ratelimits: [{ name: "CHALLENGE_RATE_LIMITER", namespace_id: "9701", simple: { limit: 120, period: 60 } }],
    triggers: { crons: input.cron ? ["*/5 * * * *"] : [] },
    d1_databases: [
      { binding: "REPORTS_DB", database_name: PROBE_REPORTS_DB, database_id: input.reportsDatabaseId, migrations_dir: `${input.outDir}/migrations-reports` },
      { binding: "PHOTOS_DB", database_name: PROBE_PHOTOS_DB, database_id: input.photosDatabaseId, migrations_dir: `${input.outDir}/migrations-photos` },
    ],
  };
}

/** The report-store stream with the JPEG-at-rest end state and the probe identity; never the committed directory. */
export function writeProbeMigrations(apiDir: string, outDir: string): void {
  rmSync(`${outDir}/migrations-reports`, { recursive: true, force: true });
  rmSync(`${outDir}/migrations-photos`, { recursive: true, force: true });
  mkdirSync(`${outDir}/migrations-reports`, { recursive: true });
  mkdirSync(`${outDir}/migrations-photos`, { recursive: true });
  for (const file of readdirSync(`${apiDir}/migrations-reports`).filter((f) => f.endsWith(".sql")).sort()) {
    if (!file.startsWith("0003_")) { copyFileSync(`${apiDir}/migrations-reports/${file}`, `${outDir}/migrations-reports/${file}`); continue; }
    const sql = readFileSync(`${apiDir}/migrations-reports/${file}`, "utf8");
    if (!sql.includes("CHECK(media_type='image/png')")) throw new Error("0003 no longer has the expected media_type CHECK; review the probe");
    writeFileSync(`${outDir}/migrations-reports/${file}`, sql.replace("CHECK(media_type='image/png')", "CHECK(media_type IN ('image/png','image/jpeg'))"));
  }
  writeFileSync(`${outDir}/migrations-reports/9000_probe_identity.sql`, `-- FREE-TIER PROBE ONLY\n${identitySql}`);
  writeFileSync(`${outDir}/migrations-photos/0001_probe_photo_store.sql`, PHOTOS_MIGRATION);
  // One file per database for `wrangler d1 execute --file` (the import path). A fresh remote store is known not to take
  // 0003 through `migrations apply` (REPORTS_MIGRATION_RECOVERY.md); whether the import path takes it is itself a
  // probe finding. The probe databases are never migrated again, so no migration ledger is needed.
  for (const name of ["reports", "photos"]) {
    const dir = `${outDir}/migrations-${name}`;
    writeFileSync(`${outDir}/${name}-schema.sql`, readdirSync(dir).sort().map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n"));
  }
}

function main(argv: string[]) {
  let reportsDatabaseId = "", photosDatabaseId = "", cron = false, local = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reports-database-id") reportsDatabaseId = argv[++i] ?? "";
    else if (argv[i] === "--photos-database-id") photosDatabaseId = argv[++i] ?? "";
    else if (argv[i] === "--cron") cron = true;
    else if (argv[i] === "--local") local = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (local) { if (reportsDatabaseId || photosDatabaseId) throw new Error("--local takes no database IDs"); [reportsDatabaseId, photosDatabaseId] = LOCAL_IDS; }
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const outDir = `${apiDir}/.wrangler/free-tier-probe${local ? "-local" : ""}`;
  const committed = parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8"));
  const config = probeConfig(committed, { reportsDatabaseId, photosDatabaseId, cron, local, apiDir, outDir });
  writeProbeMigrations(apiDir, outDir);
  writeFileSync(`${outDir}/worker.jsonc`, JSON.stringify(config, null, 2) + "\n");
  console.log(`wrote ${outDir}/worker.jsonc (worker ${PROBE_WORKER}, ${local ? "LOCAL" : "REMOTE"} databases, cron ${cron ? "*/5" : "none"})`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
