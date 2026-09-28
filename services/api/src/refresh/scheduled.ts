// Cloudflare Cron entry point for source checks. Its only job is checkSource for every reviewed adapter
// with a refresh target: no resolve, removal, relocation, publish or promotion is reachable from here, and
// no environment enables a cron schedule in the committed wrangler.jsonc (docs/OPERATIONS.md).

import type { Db } from "../db.ts";
import { SOURCE_ADAPTERS } from "../pipeline/adapters.ts";
import type { SourceAdapter } from "../pipeline/source-adapter.ts";
import { type RawArtifactStore, r2ArtifactStore } from "./artifact-store.ts";
import { type CheckResult, type FetchLike, checkSource } from "./check.ts";

export interface RefreshEnv {
  DB: Db;
  RAW_ARTIFACTS?: R2Bucket;
}

export interface RunDeps {
  db: Db;
  store: RawArtifactStore;
  fetch: FetchLike;
  now: () => Date;
  adapters?: readonly SourceAdapter[];
}

/**
 * Checks each source in turn. One source's unexpected error is reported in its result and does not stop the
 * others; expected failures (network, HTTP, storage) are already recorded as `failed` checks by checkSource.
 */
export async function runSourceChecks(deps: RunDeps, runKey: string, trigger: "scheduled" | "manual") {
  const results: { sourceId: string; result: CheckResult | { status: "error"; error: string } }[] = [];
  for (const adapter of deps.adapters ?? SOURCE_ADAPTERS) {
    const sourceId = adapter.registry.sourceId;
    try {
      results.push({ sourceId, result: await checkSource(deps, adapter, { runKey, trigger }) });
    } catch (e) {
      results.push({ sourceId, result: { status: "error", error: e instanceof Error ? e.message : String(e) } });
    }
  }
  return results;
}

export async function scheduled(controller: ScheduledController, env: RefreshEnv): Promise<void> {
  if (!env.RAW_ARTIFACTS) throw new Error("scheduled source check: the RAW_ARTIFACTS R2 binding is not configured");
  // The scheduled time identifies the run, so Cloudflare's retry of the same invocation is idempotent.
  const runKey = `cron:${new Date(controller.scheduledTime).toISOString()}`;
  const results = await runSourceChecks(
    { db: env.DB, store: r2ArtifactStore(env.RAW_ARTIFACTS), fetch: (url, init) => fetch(url, init), now: () => new Date() },
    runKey, "scheduled",
  );
  // Source ids and outcomes only: nothing here relates to a user or a position.
  console.log(JSON.stringify({ event: "sourceChecks", runKey, results: results.map((r) => ({ sourceId: r.sourceId, status: r.result.status, outcome: "outcome" in r.result ? r.result.outcome : null })) }));
  if (results.some((r) => r.result.status === "error")) throw new Error(`scheduled source check ${runKey}: ${JSON.stringify(results)}`);
}
