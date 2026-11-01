// Writes the A1 probe's Wrangler config and delta schemas into git-ignored `.wrangler/kv-photo-probe[-local]/`
// (docs/release/V1_KV_PHOTO_A1_POC.md). Makes no network call and runs no wrangler command.
//
//   npm run kv-probe:config -- --local
//   npm run kv-probe:config -- --reports-database-id <uuid> --photos-database-id <uuid> --kv-namespace-id <32 hex>
//
// Same isolation as free-tier-probe-config.ts (it reuses probeConfig: no `env` block, committed IDs refused) plus ONE
// KV binding, PHOTO_KV, whose ID must not be any KV namespace committed in wrangler.jsonc.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./disposable-env.ts";
import { probeConfig, writeProbeMigrations } from "./free-tier-probe-config.ts";
import { KV_PHOTOS_DB_SCHEMA } from "../src/poc/kv-photo/kv-photo-store.ts";
import { PHOTO_INTENTS_SCHEMA } from "../src/poc/kv-photo/two-step.ts";

export const PROBE_KV = "mannerpath-free-tier-probe-photo-kv";
const LOCAL_KV = "0000000000000000000000000000f003";

export function kvProbeConfig(committed: any, input: Parameters<typeof probeConfig>[1] & { kvNamespaceId: string }) {
  if (!/^[0-9a-f]{32}$/.test(input.kvNamespaceId)) throw new Error(`--kv-namespace-id must be a 32-hex KV namespace ID, got ${JSON.stringify(input.kvNamespaceId)}`);
  const committedKv = new Set<string>();
  const collect = (cfg: any) => (cfg?.kv_namespaces ?? []).forEach((k: any) => { committedKv.add(k.id); if (k.preview_id) committedKv.add(k.preview_id); });
  collect(committed); for (const env of Object.values(committed.env ?? {})) collect(env);
  if (committedKv.has(input.kvNamespaceId)) throw new Error(`${input.kvNamespaceId} is a KV namespace committed in wrangler.jsonc; the probe needs its own`);
  const base = probeConfig(committed, input);
  return { ...base, main: `${input.apiDir}/src/poc/kv-photo/probe-worker.ts`, kv_namespaces: [{ binding: "PHOTO_KV", id: input.kvNamespaceId }] };
}

function main(argv: string[]) {
  let reportsDatabaseId = "", photosDatabaseId = "", kvNamespaceId = "", local = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reports-database-id") reportsDatabaseId = argv[++i] ?? "";
    else if (argv[i] === "--photos-database-id") photosDatabaseId = argv[++i] ?? "";
    else if (argv[i] === "--kv-namespace-id") kvNamespaceId = argv[++i] ?? "";
    else if (argv[i] === "--local") local = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (local) {
    if (reportsDatabaseId || photosDatabaseId || kvNamespaceId) throw new Error("--local takes no IDs");
    [reportsDatabaseId, photosDatabaseId, kvNamespaceId] = ["00000000-0000-0000-0000-00000000f001", "00000000-0000-0000-0000-00000000f002", LOCAL_KV];
  }
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const outDir = `${apiDir}/.wrangler/kv-photo-probe${local ? "-local" : ""}`;
  mkdirSync(outDir, { recursive: true });
  const committed = parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8"));
  const config = kvProbeConfig(committed, { reportsDatabaseId, photosDatabaseId, kvNamespaceId, cron: false, local, apiDir, outDir });
  writeProbeMigrations(apiDir, outDir); // full schemas, for a fresh (local) database
  // Deltas for the existing probe databases (already hold the base schema): A1 tables only, nothing dropped.
  writeFileSync(`${outDir}/a1-reports-delta.sql`, `-- FREE-TIER PROBE ONLY (A1)\n${PHOTO_INTENTS_SCHEMA}`);
  writeFileSync(`${outDir}/a1-photos-delta.sql`, `-- FREE-TIER PROBE ONLY (A1)\n${KV_PHOTOS_DB_SCHEMA}`);
  writeFileSync(`${outDir}/worker.jsonc`, JSON.stringify(config, null, 2) + "\n");
  console.log(`wrote ${outDir}/worker.jsonc (A1 probe, ${local ? "LOCAL" : "REMOTE"} databases + KV)`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
