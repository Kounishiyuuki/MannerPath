// Disposable remote environment for App Attest E2E (Issue #55, docs/OPERATIONS.md "Disposable E2E
// environment").
//
// Writes a Wrangler configuration for ONE throwaway Worker bound to ONE throwaway D1 database, into
// the git-ignored `.wrangler/e2e/` directory. The generated file has no `env` block at all, so every
// command run with `--config <that file>` can resolve the `DB` binding only to the disposable
// database: there is no staging or production binding in it to fall back to. The committed
// `wrangler.jsonc` is read, never written, and keeps its placeholder IDs.
//
// It makes no network call and runs no wrangler command; it prints the commands the maintainer runs.
//
//   npm run e2e:config -- --suffix p21 --database-id <uuid from `wrangler d1 create mannerpath-e2e-p21`>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const E2E_WORKER_PREFIX = "mannerpath-api-e2e-";
export const E2E_DATABASE_PREFIX = "mannerpath-e2e-";
const SUFFIX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

/** Minimal JSONC reader: strips // and /* *\/ comments outside of string literals. */
export function parseJsonc(src: string): any {
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

/**
 * Builds the disposable configuration from the committed one. Throws, naming the input, whenever
 * the result could reach a committed (normal staging/production) Worker or database.
 */
export function disposableConfig(committed: any, input: { suffix: string; databaseId: string; apiDir: string }) {
  if (!SUFFIX.test(input.suffix)) {
    throw new Error(`--suffix must be 3-32 chars of a-z, 0-9 and inner '-', got ${JSON.stringify(input.suffix)}`);
  }
  if (!UUID.test(input.databaseId) || input.databaseId === PLACEHOLDER_DATABASE_ID) {
    throw new Error(`--database-id must be the UUID printed by \`wrangler d1 create ${E2E_DATABASE_PREFIX}${input.suffix}\`, got ${JSON.stringify(input.databaseId)}`);
  }
  const environments = [committed, ...Object.values(committed.env ?? {})] as any[];
  const committedIds = new Set(environments.flatMap((e) => (e.d1_databases ?? []).map((d: any) => d.database_id)));
  const committedNames = new Set(environments.flatMap((e) => [e.name, ...(e.d1_databases ?? []).map((d: any) => d.database_name)]));
  if (committedIds.has(input.databaseId)) {
    throw new Error(`--database-id ${input.databaseId} is a database committed in wrangler.jsonc; the E2E environment needs its own fresh database`);
  }
  const name = `${E2E_WORKER_PREFIX}${input.suffix}`;
  const databaseName = `${E2E_DATABASE_PREFIX}${input.suffix}`;
  for (const n of [name, databaseName]) {
    if (committedNames.has(n)) throw new Error(`${n} collides with a committed Worker or database name`);
  }
  // Privacy settings are copied, not re-derived, so the disposable Worker cannot drift from them.
  if (committed.observability?.logs?.invocation_logs !== false) {
    throw new Error("committed wrangler.jsonc must disable invocation_logs before a disposable environment is generated");
  }
  return {
    name,
    main: `${input.apiDir}/src/index.ts`,
    compatibility_date: committed.compatibility_date,
    observability: committed.observability,
    // Fails closed until the three App Attest values are set as secrets on this Worker, exactly as
    // staging/production. Never `disabled` on a remote Worker.
    vars: { REPORT_ATTESTATION: "required" },
    d1_databases: [{
      binding: "DB",
      database_name: databaseName,
      database_id: input.databaseId,
      migrations_dir: `${input.apiDir}/migrations`,
    }],
  };
}

function parseArgs(argv: string[]) {
  const args = { suffix: "", databaseId: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suffix") args.suffix = argv[++i] ?? "";
    else if (argv[i] === "--database-id") args.databaseId = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${argv[i]}. Usage: disposable-env.ts --suffix <s> --database-id <uuid>`);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const args = parseArgs(process.argv.slice(2));
  const committed = parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8"));
  const config = disposableConfig(committed, { ...args, apiDir });
  const dir = `${apiDir}/.wrangler/e2e`;
  const out = `${dir}/${args.suffix}.json`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
  const cfg = `.wrangler/e2e/${args.suffix}.json`;
  console.log(`wrote ${cfg}: Worker ${config.name}, D1 ${config.d1_databases[0].database_name}, REPORT_ATTESTATION=required`);
  console.log(`Every remote command below uses --config ${cfg} and never --env (docs/OPERATIONS.md):`);
  console.log(`  npx wrangler d1 migrations apply DB --config ${cfg} --remote`);
  console.log(`  npx wrangler d1 execute DB --config ${cfg} --remote --file promotion.sql`);
  console.log(`  npx wrangler deploy --config ${cfg}`);
  console.log(`  npx wrangler secret put REPORT_SUBMITTER_PEPPER --config ${cfg}`);
}
