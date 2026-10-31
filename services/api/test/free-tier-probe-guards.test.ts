// The FREE-TIER PROBE's safety rails: its generated config can bind only its own databases, and the driver talks only
// to loopback or the probe's workers.dev origin (docs/release/V1_FREE_TIER_PROBE_RUNBOOK.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonc } from "../scripts/disposable-env.ts";
import { PROBE_PHOTOS_DB, PROBE_REPORTS_DB, PROBE_WORKER, probeConfig } from "../scripts/free-tier-probe-config.ts";
import { MAX_UPLOADS, checkTarget } from "../scripts/free-tier-probe-run.ts";

const committed = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const A = "11111111-2222-4333-8444-555555555555", B = "66666666-7777-4888-9999-000000000000";
const base = { cron: false, local: false, apiDir: "/api", outDir: "/api/.wrangler/free-tier-probe" };

test("config binds only the two probe databases, no env block, no routes, required attestation, logs without URLs", () => {
  const c = probeConfig(committed, { ...base, reportsDatabaseId: A, photosDatabaseId: B });
  assert.equal(c.name, PROBE_WORKER);
  assert.deepEqual(c.d1_databases.map((d) => [d.binding, d.database_name, d.database_id]), [["REPORTS_DB", PROBE_REPORTS_DB, A], ["PHOTOS_DB", PROBE_PHOTOS_DB, B]]);
  assert.equal("env" in c, false); assert.equal("routes" in c, false); assert.equal("r2_buckets" in c, false);
  assert.equal(c.vars.REPORT_ATTESTATION, "required");
  assert.equal(c.observability.logs.invocation_logs, false);
  assert.deepEqual(c.triggers.crons, []);
  assert.deepEqual(probeConfig(committed, { ...base, cron: true, reportsDatabaseId: A, photosDatabaseId: B }).triggers.crons, ["*/5 * * * *"]);
});

test("config refuses production/staging IDs, placeholders, equal IDs and malformed IDs", () => {
  const committedIds = [committed, ...Object.values(committed.env ?? {})].flatMap((c: any) => (c.d1_databases ?? []).map((d: any) => d.database_id))
    .filter((id: string) => !/^0{8}-/.test(id));
  assert.ok(committedIds.length >= 2);
  for (const id of committedIds) assert.throws(() => probeConfig(committed, { ...base, reportsDatabaseId: id, photosDatabaseId: B }), /committed in wrangler.jsonc/);
  assert.throws(() => probeConfig(committed, { ...base, reportsDatabaseId: "00000000-0000-0000-0000-000000000001", photosDatabaseId: B }), /placeholder/);
  assert.throws(() => probeConfig(committed, { ...base, reportsDatabaseId: A, photosDatabaseId: A }), /distinct/);
  assert.throws(() => probeConfig(committed, { ...base, reportsDatabaseId: "prod", photosDatabaseId: B }), /UUID/);
});

test("driver targets only loopback or the confirmed probe workers.dev origin", () => {
  assert.equal(checkTarget("http://127.0.0.1:8799", undefined).origin, "http://127.0.0.1:8799");
  assert.equal(checkTarget(`https://${PROBE_WORKER}.acct.workers.dev`, PROBE_WORKER).hostname, `${PROBE_WORKER}.acct.workers.dev`);
  for (const bad of ["https://mannerpath-api-production.acct.workers.dev", "https://api.mannerpath.example", `http://${PROBE_WORKER}.acct.workers.dev`,
    "http://10.0.0.1:8799", "http://127.0.0.1:8799/v1", `https://${PROBE_WORKER}.acct.workers.dev.evil.example`]) {
    assert.throws(() => checkTarget(bad, PROBE_WORKER), /refusing|origin only/, bad);
  }
  assert.throws(() => checkTarget(`https://${PROBE_WORKER}.acct.workers.dev`, undefined), /--confirm-probe/);
  assert.equal(MAX_UPLOADS, 120);
});
