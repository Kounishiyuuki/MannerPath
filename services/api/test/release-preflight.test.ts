// scripts/release-preflight.ts: local and read-only. It must block on placeholder, malformed, shared or mismatched
// database ids, an unsafe committed environment and an import plan that does not match its reviewed digests, and
// otherwise print the launch commands in the one safe order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPromotionV4 } from "../scripts/promotion-v4-export.ts";
import { prepareV4ImportPlan } from "../scripts/promotion-v4-import-plan.ts";
import { readJsonc, releasePreflight } from "../scripts/release-preflight.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const committed = readJsonc(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")) as any;
const REAL = { databaseId: "11111111-2222-4333-8444-555555555555", reportsDatabaseId: "66666666-7777-4888-9999-000000000000" };

async function plan(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "release-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  const manifest = await exportPromotionV4(db.raw, join(root, "bundle"), { chunkBytes: 4_194_304 });
  const prepared = await prepareV4ImportPlan(join(root, "bundle"), manifest.wholeBundleSha256, join(root, "plan"));
  return { planDir: join(root, "plan"), expectedDigest: manifest.wholeBundleSha256, expectedPlanDigest: prepared.wholePlanSha256 };
}

test("release preflight: committed placeholders block; real ids print the launch in the one safe order", async (t) => {
  const p = await plan(t);
  const blocked = await releasePreflight({ config: committed, env: "production", ...p });
  assert.deepEqual(blocked.launch, []);
  assert.equal(blocked.problems.filter((x) => /still the placeholder/.test(x)).length, 2);

  const ok = await releasePreflight({ config: committed, env: "production", ...p, preLanding: REAL, workerHost: "api.example.invalid" });
  assert.deepEqual(ok.problems, []);
  const run = ok.launch.filter((l) => !l.startsWith("#"));
  const at = (re: RegExp) => run.findIndex((l) => re.test(l));
  // migrate both -> initialize -> digest check -> chunks in order -> re-verify -> finalize -> sealed -> deploy -> smoke
  const order = [/migrations apply DB /, /migrations apply REPORTS_DB /, /initialize\.sql/, /manifest_sha256/, /chunk-0001\.sql/,
    /verify-import-plan/, /finalize\.sql/, /sealed/, /wrangler deploy --env production$/, /smoke\.ts --base-url https:\/\/api\.example\.invalid --remote --tile 14\//];
  const positions = order.map(at);
  assert.ok(positions.every((i) => i >= 0), `every step present: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "steps in order");
  assert.ok(run.every((l) => !/--env staging/.test(l)), "never addresses staging");
  assert.ok(ok.launch.join("\n").includes(p.expectedDigest), "the reviewed digest is checked against the target");
  assert.ok(ok.rollback.some((l) => /wrangler rollback --env production/.test(l)));
});

test("release preflight: unsafe config, bad ids or an unreviewed plan block the launch", async (t) => {
  const p = await plan(t);
  const clone = () => JSON.parse(JSON.stringify(committed));
  const cases: [string, any, Partial<typeof REAL> | undefined, Partial<typeof p>, RegExp][] = [
    ["same id twice", committed, { reportsDatabaseId: REAL.databaseId }, {}, /different database ids/],
    ["malformed id", committed, { databaseId: "prod-db" }, {}, /not a D1 UUID/],
    ["reports not required", (() => { const c = clone(); c.env.production.vars.REPORT_ATTESTATION = "disabled"; return c; })(), {}, {}, /REPORT_ATTESTATION/],
    ["invocation logs on", (() => { const c = clone(); c.env.production.observability.logs.invocation_logs = true; return c; })(), {}, {}, /invocation logs/],
    ["cron committed", (() => { const c = clone(); c.env.production.triggers.crons = ["0 * * * *"]; return c; })(), {}, {}, /cron/],
    ["plan digest not the reviewed one", committed, {}, { expectedPlanDigest: "0".repeat(64) }, /does not verify/],
    ["bundle digest not the reviewed one", committed, {}, { expectedDigest: "f".repeat(64) }, /does not verify/],
  ];
  for (const [name, config, ids, override, expected] of cases) {
    const r = await releasePreflight({ config, env: "production", ...p, ...override, preLanding: { ...REAL, ...ids } });
    assert.ok(r.problems.some((x) => expected.test(x)), `${name}: ${r.problems.join("; ")}`);
    assert.deepEqual(r.launch, [], `${name}: no launch commands`);
  }
  // Committed ids shared with another environment are refused (a staging command must never reach production).
  const shared = clone();
  for (const e of ["staging", "production"]) {
    shared.env[e].d1_databases[0].database_id = REAL.databaseId;
    shared.env[e].d1_databases[1].database_id = REAL.reportsDatabaseId;
  }
  const r = await releasePreflight({ config: shared, env: "production", ...p });
  assert.ok(r.problems.some((x) => /shares a database id/.test(x)), r.problems.join("; "));
});
