// Production release preflight (docs/RELEASE_CHECKLIST.md). LOCAL and READ-ONLY: it opens no connection, runs no
// wrangler command and writes nothing. It checks that the committed environment is safe to deploy, that the database
// names and ids the maintainer is about to use are the ones in wrangler.jsonc, and that the promotion v4 import plan
// verifies against its two independently reviewed digests — then prints the exact, ordered launch and rollback
// commands, so no step (initialize once, chunks in order, finalize last, readiness before deploy) is left to memory.
//
//   npm run release:preflight -- --env production --plan-dir <import-plan> \
//     --expected-digest <reviewed wholeBundleSha256> --expected-plan-digest <reviewed wholePlanSha256> \
//     [--worker-host <host>] [--pre-landing --database-id <uuid> --reports-database-id <uuid>]
//
// `--pre-landing` checks ids that are not committed yet (before the reviewed PR that lands them); without it the
// committed ids must be real. Exit 1 on any problem; the command list is printed only when there is none.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iterateV4Tiles } from "./promotion-v4-metadata.ts";
import { readV4Manifest } from "./promotion-v4-verify.ts";
import { verifyV4ImportPlan } from "./promotion-v4-import-plan.ts";

export const PLACEHOLDER_IDS = ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000001"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PreflightOptions {
  config: unknown;
  env: string;
  planDir: string;
  expectedDigest: string;
  expectedPlanDigest: string;
  workerHost?: string;
  /** Ids to check before they are committed (the landing PR); otherwise the committed ids are checked. */
  preLanding?: { databaseId: string; reportsDatabaseId: string };
}

export interface PreflightResult { problems: string[]; launch: string[]; rollback: string[] }

/** Minimal JSONC reader (the same one test/deploy-config.test.ts uses): strips comments outside string literals. */
export function readJsonc(src: string): unknown {
  let out = "", inString = false;
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

type D1Entry = { binding: string; database_name: string; database_id: string; migrations_dir: string };

export async function releasePreflight(o: PreflightOptions): Promise<PreflightResult> {
  const problems: string[] = [];
  const env = (o.config as { env?: Record<string, any> }).env?.[o.env];
  if (!env) return { problems: [`wrangler.jsonc has no env.${o.env}`], launch: [], rollback: [] };
  const d1 = (env.d1_databases ?? []) as D1Entry[];
  const db = d1.find((d) => d.binding === "DB"), reports = d1.find((d) => d.binding === "REPORTS_DB");
  // The committed environment: fail-closed reports, no request-URL logs, no schedule, two separate streams.
  if (env.vars?.REPORT_ATTESTATION !== "required") problems.push(`env.${o.env}: REPORT_ATTESTATION must be "required" (reports fail closed until App Attest is configured)`);
  if (env.observability?.logs?.invocation_logs !== false) problems.push(`env.${o.env}: invocation logs must stay disabled (they persist tile URLs)`);
  if ((env.triggers?.crons ?? []).length !== 0) problems.push(`env.${o.env}: no cron schedule may be committed`);
  if (!db || !reports) problems.push(`env.${o.env}: both DB and REPORTS_DB bindings are required`);
  const bucket = ((env.r2_buckets ?? []) as { binding: string; bucket_name: string }[]).find((b) => b.binding === "RAW_ARTIFACTS")?.bucket_name;
  if (!bucket) problems.push(`env.${o.env}: the RAW_ARTIFACTS R2 binding is required`);
  else {
    if (db.migrations_dir !== "migrations") problems.push(`env.${o.env}: DB must use migrations_dir "migrations"`);
    if (reports.migrations_dir !== "migrations-reports") problems.push(`env.${o.env}: REPORTS_DB must use migrations_dir "migrations-reports"`);
    if (db.database_name === reports.database_name) problems.push(`env.${o.env}: DB and REPORTS_DB must be different databases`);
    const ids = o.preLanding ? { db: o.preLanding.databaseId, reports: o.preLanding.reportsDatabaseId } : { db: db.database_id, reports: reports.database_id };
    for (const [name, id] of [["DB", ids.db], ["REPORTS_DB", ids.reports]] as const) {
      if (!UUID.test(id)) problems.push(`${name} database_id ${id} is not a D1 UUID`);
      else if (PLACEHOLDER_IDS.includes(id)) problems.push(`${name} database_id is still the placeholder: land the real id in a reviewed PR first`);
    }
    if (ids.db === ids.reports) problems.push("DB and REPORTS_DB must have different database ids");
    if (!o.preLanding) {
      // Every other environment must not point at the same databases (a staging command must never reach production).
      for (const [name, other] of Object.entries((o.config as { env: Record<string, any> }).env)) {
        if (name === o.env) continue;
        for (const e of (other.d1_databases ?? []) as D1Entry[]) {
          if (!PLACEHOLDER_IDS.includes(e.database_id) && [db.database_id, reports.database_id].includes(e.database_id)) {
            problems.push(`env.${name} ${e.binding} shares a database id with env.${o.env}`);
          }
        }
      }
    }
  }
  // The reviewed promotion: the import plan must verify against both reviewed digests (it opens no database).
  let files: string[] = [], initialFiles: string[] = [], payloadFiles: string[] = [], tile: string | undefined;
  try {
    const plan = await verifyV4ImportPlan(o.planDir, o.expectedPlanDigest, o.expectedDigest);
    files = plan.files.map((f) => f.file);
    const manifest = await readV4Manifest(o.planDir, o.expectedDigest);
    const initializationCount = files.indexOf(manifest.chunks[0].file);
    initialFiles = files.slice(0, initializationCount); payloadFiles = files.slice(initializationCount, -1);
    let maximum = -1;
    for await (const candidate of iterateV4Tiles(o.planDir, manifest)) {
      if (candidate.spotCount > maximum || candidate.spotCount === maximum && (!tile || candidate.tileId < tile)) { maximum = candidate.spotCount; tile = candidate.tileId; }
    }
    if (!tile) problems.push("the promotion publishes no tile");
  } catch (e) {
    problems.push(`import plan does not verify: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (problems.length > 0 || !db || !reports || !bucket) return { problems, launch: [], rollback: [] };

  const e = `--env ${o.env} --remote`;
  const host = o.workerHost ?? "<worker-host>";
  const file = (f: string) => join(o.planDir, f);
  const launch = [
    `# First launch: ${db.database_name} is empty and not yet served, so the binding form addresses it. For a later`,
    `# data release use blue/green instead (docs/OPERATIONS.md step 6): never import into the live database.`,
    `npx wrangler r2 bucket info ${bucket}            # expect: the provisioned bucket exists; stop if this check fails`,
    `npx wrangler d1 migrations apply DB ${e}`,
    `npx wrangler d1 migrations list DB ${e}            # expect: no pending migrations`,
    `npx wrangler d1 migrations apply REPORTS_DB ${e}`,
    `npx wrangler d1 migrations list REPORTS_DB ${e}    # expect: no pending migrations`,
    ...initialFiles.map(f => `npx wrangler d1 execute DB ${e} --file ${file(f)}`),
    `npx wrangler d1 execute DB ${e} --command "SELECT manifest_sha256 FROM promotion_v4_manifests"   # expect: ${o.expectedDigest}`,
    ...payloadFiles.flatMap((f, i) => [
      `npx wrangler d1 execute DB ${e} --command "SELECT min(e.ordinal) AS next_chunk FROM promotion_v4_expected_chunks e LEFT JOIN promotion_v4_applied_chunks a USING (ordinal) WHERE a.ordinal IS NULL"   # expect: ${i + 1}`,
      `npx wrangler d1 execute DB ${e} --file ${file(f)}`,
    ]),
    `npm run promotion:v4:verify-import-plan -- --dir ${o.planDir} --expected-digest ${o.expectedDigest} --expected-plan-digest ${o.expectedPlanDigest}   # re-verify before finalizing`,
    `npx wrangler d1 execute DB ${e} --file ${file(files.at(-1)!)}`,
    `npx wrangler d1 execute DB ${e} --command "SELECT count(*) AS sealed FROM promotion_multi_bootstrap_completions"   # expect: 1`,
    `npx wrangler deploy --env ${o.env}`,
    `node --experimental-strip-types --no-warnings scripts/smoke.ts --base-url https://${host} --remote --tile ${tile}`,
    `# expect every check ok; readiness completed; report endpoint 503 attestationUnavailable (reports off in v1)`,
  ];
  const rollback = [
    `# Bad code: previous Worker deployment (data untouched)`,
    `npx wrangler rollback --env ${o.env}`,
    `# Bad data after a later blue/green release: restore the previous DB database_id in wrangler.jsonc (reviewed PR), then`,
    `npx wrangler deploy --env ${o.env}`,
    `node --experimental-strip-types --no-warnings scripts/smoke.ts --base-url https://${host} --remote --tile ${tile}`,
    `# First launch has no previous database: take the API down instead (the database is kept)`,
    `npx wrangler delete --env ${o.env}`,
    `# REPORTS_DB is never part of a rollback (ADR-0014).`,
  ];
  return { problems, launch, rollback };
}

async function main(argv: string[]): Promise<number> {
  const flags = new Map<string, string>();
  let preLanding = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--pre-landing") { preLanding = true; continue; }
    const value = argv[i + 1];
    if (!["--env", "--plan-dir", "--expected-digest", "--expected-plan-digest", "--worker-host", "--database-id", "--reports-database-id"].includes(flag)
      || value === undefined || value.startsWith("--") || flags.has(flag)) {
      console.error(`release:preflight: invalid, missing or duplicate option ${flag}`);
      return 2;
    }
    flags.set(flag, value); i++;
  }
  for (const required of ["--env", "--plan-dir", "--expected-digest", "--expected-plan-digest"]) {
    if (!flags.has(required)) { console.error(`release:preflight: ${required} is required`); return 2; }
  }
  if (preLanding && (!flags.has("--database-id") || !flags.has("--reports-database-id"))) {
    console.error("release:preflight: --pre-landing needs --database-id and --reports-database-id");
    return 2;
  }
  const result = await releasePreflight({
    config: readJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")),
    env: flags.get("--env")!, planDir: flags.get("--plan-dir")!,
    expectedDigest: flags.get("--expected-digest")!, expectedPlanDigest: flags.get("--expected-plan-digest")!,
    workerHost: flags.get("--worker-host"),
    preLanding: preLanding ? { databaseId: flags.get("--database-id")!, reportsDatabaseId: flags.get("--reports-database-id")! } : undefined,
  });
  if (result.problems.length > 0) {
    console.error(`PREFLIGHT BLOCKED (${result.problems.length}):`);
    for (const p of result.problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log("PREFLIGHT OK. Nothing was executed. Launch, in this order (maintainer terminal):\n");
  console.log(result.launch.join("\n"));
  console.log("\nRollback:\n");
  console.log(result.rollback.join("\n"));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
