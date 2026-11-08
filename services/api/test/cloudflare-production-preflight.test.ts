import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "../scripts/disposable-env.ts";
import { productionConfig, PRODUCTION_WORKER } from "../scripts/production-v1-plan.ts";
import { EXPECTED_PENDING } from "../scripts/production-v1-check.ts";
import { preflight, candidateDigest, sha256, ADMIN_GATES, type Inputs } from "../scripts/cloudflare-production-preflight.ts";
const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const committed = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const candidate = productionConfig(committed, apiDir), commit = "a".repeat(40), version = "11111111-1111-4111-8111-111111111111";
const fileSha256 = (db: "DB" | "REPORTS_DB", name: string) => sha256(readFileSync(`${apiDir}/${db === "DB" ? "migrations" : "migrations-reports"}/${name}`));
const reviews = JSON.parse(readFileSync(`${apiDir}/release/production-migration-review.json`, "utf8")).reviews;
function base(stage: Inputs["stage"] = "before-deploy"): Inputs {
  const target = { worker: PRODUCTION_WORKER, accountReviewRef: "TEST ONLY",
    DB: { id: "ffbaea1e-b57e-4064-abeb-a0c53f459662", name: "mannerpath-production" },
    REPORTS_DB: { id: "e641b1df-8042-4522-8463-804c6ba57868", name: "mannerpath-production-reports" },
    currentCrons: [], reviewedBy: "TEST ONLY", reviewedAt: "2026-11-09T09:50:00Z" };
  const targetBytes = JSON.stringify(target);
  const evidence = { observedAt: "2026-11-09T09:59:00Z", gitCommit: commit, configSha256: candidateDigest(candidate), targetSha256: sha256(targetBytes),
    worker: PRODUCTION_WORKER, versionId: version, activeVersionIds: [version],
    bindings: [{ binding: "DB", id: target.DB.id }, { binding: "REPORTS_DB", id: target.REPORTS_DB.id }],
    secretNames: ["REPORT_SUBMITTER_PEPPER", "RATE_LIMIT_KEY_PEPPER"], pending: stage === "before-deploy" ? { DB: [], REPORTS_DB: [] } : EXPECTED_PENDING,
    deployedCrons: [], proposedCron: candidate.vars.REPORT_RETENTION_CRON,
    configGet: { status: 200, reportsAvailable: false, photoEvidenceEnabled: false },
    readinessGet: { status: 200, state: "completed", versionId: version, databaseId: target.DB.id },
    gates: Object.fromEntries(ADMIN_GATES.map(name => [name, "TEST ONLY"])), reviewedBy: "TEST ONLY" };
  return { candidate: structuredClone(candidate), committed, gitCommit: commit, targetBytes, evidenceBytes: JSON.stringify(evidence), reviews: structuredClone(reviews), migrationDirs: { DB: `${apiDir}/migrations`, REPORTS_DB: `${apiDir}/migrations-reports` }, fileSha256, stage, now: new Date("2026-11-09T10:00:00Z") };
}
function change(m: (e: any) => void) { const o = base(), e = JSON.parse(o.evidenceBytes!); m(e); o.evidenceBytes = JSON.stringify(e); return o; }
test("complete synthetic receipts cover both stages without writes or deployment approval", () => {
  for (const stage of ["before-migration", "before-deploy"] as const) { const o = base(stage), before = JSON.stringify(o); assert.equal(preflight(o).result, "REVIEW_COMPLETE"); assert.equal(JSON.stringify(o), before); }
});
test("missing evidence and each administrator gate remain unverified", () => {
  const o = base(); delete o.targetBytes; delete o.evidenceBytes; assert.equal(preflight(o).result, "UNVERIFIED");
  for (const gate of ADMIN_GATES) assert.equal(preflight(change(e => { e.gates[gate] = null; })).result, "UNVERIFIED", gate);
});
test("swapped DBs, duplicate bindings, staging and wrong migration streams cannot pass", () => {
  assert.equal(preflight(change(e => { [e.bindings[0].id, e.bindings[1].id] = [e.bindings[1].id, e.bindings[0].id]; })).result, "FAIL");
  assert.equal(preflight(change(e => { e.bindings[1].binding = "DB"; })).result, "FAIL");
  for (const kind of ["staging", "duplicate", "name", "stream"] as const) { const o = base(), d = o.candidate.d1_databases;
    if (kind === "staging") d[0].database_id = committed.env.staging.d1_databases[0].database_id;
    if (kind === "duplicate") d[1].database_id = d[0].database_id;
    if (kind === "name") d[0].database_name = "wrong";
    if (kind === "stream") d[0].migrations_dir = d[1].migrations_dir;
    assert.equal(preflight(o).result, "FAIL", kind); }
});
test("pending migrations, approvals and file SHA are stage-bound", () => {
  assert.equal(preflight(change(e => { e.pending.DB = EXPECTED_PENDING.DB; })).result, "FAIL");
  const b = base("before-migration"); b.evidenceBytes = JSON.stringify({ ...JSON.parse(b.evidenceBytes!), pending: { DB: [], REPORTS_DB: [] } }); assert.equal(preflight(b).result, "FAIL");
  const o = base(); o.reviews = []; assert.equal(preflight(o).result, "FAIL");
  for (const db of ["DB", "REPORTS_DB"] as const) { const o = base(); o.fileSha256 = (d, n) => d === db ? "0".repeat(64) : fileSha256(d, n); assert.equal(preflight(o).result, "FAIL"); }
});
test("stale/future evidence, multiple versions, wrong digests and readiness identities fail", () => {
  for (const mutate of [
    (e: any) => { e.observedAt = "2026-11-08T09:59:00Z"; }, (e: any) => { e.observedAt = "2026-11-09T10:01:00Z"; },
    (e: any) => { e.activeVersionIds.push("22222222-2222-4222-8222-222222222222"); }, (e: any) => { e.gitCommit = "b".repeat(40); },
    (e: any) => { e.targetSha256 = "0".repeat(64); }, (e: any) => { e.configSha256 = "0".repeat(64); },
    (e: any) => { e.readinessGet.databaseId = e.bindings[1].id; }, (e: any) => { e.readinessGet.status = 503; },
  ]) assert.equal(preflight(change(mutate)).result, "FAIL");
});
test("secrets accept names only and cannot open intake or echo values", () => {
  for (const mutate of [(e: any) => { e.secretNames = []; }, (e: any) => { e.secretNames.push("REPORT_APP_ATTEST_APP_ID"); },
    (e: any) => { e.configGet.reportsAvailable = true; }, (e: any) => { e.secretValue = "should-not-echo"; },
    (e: any) => { e.secretNames = [{ name: "RATE_LIMIT_KEY_PEPPER", value: "should-not-echo" }]; }]) {
    const r = preflight(change(mutate)); assert.equal(r.result, "FAIL"); assert.ok(!JSON.stringify(r).includes("should-not-echo")); }
});
test("current empty Cron and proposal differ; frequency text alone never approves CPU or fees", () => {
  assert.equal(preflight(change(e => { e.deployedCrons = [e.proposedCron]; })).result, "FAIL");
  assert.equal(preflight(change(e => { e.proposedCron = "0 * * * *"; })).result, "FAIL");
  const o = base(); o.candidate.vars.PHOTO_EVIDENCE = "on"; assert.equal(preflight(o).result, "FAIL");
});
test("CLI has no network, subprocess or file-write operation and never authorizes deployment", () => {
  const s = readFileSync(new URL("../scripts/cloudflare-production-preflight.ts", import.meta.url), "utf8");
  assert.doesNotMatch(s, /execFile|spawn\(|fetch\(|writeFile|mkdir/); assert.match(s, /deploymentAuthorized: false/);
});

test("receipt freshness is bounded inclusively; placeholder and wrong-version receipts fail", () => {
  const o = change(e => { e.observedAt = "2026-11-09T09:45:00Z"; });
  const t = JSON.parse(o.targetBytes!); t.reviewedAt = "2026-11-09T09:40:00Z"; o.targetBytes = JSON.stringify(t);
  const e = JSON.parse(o.evidenceBytes!); e.targetSha256 = sha256(o.targetBytes); o.evidenceBytes = JSON.stringify(e);
  assert.equal(preflight(o).result, "REVIEW_COMPLETE");
  o.now = new Date("2026-11-09T10:00:00.001Z"); assert.equal(preflight(o).result, "FAIL");
  assert.equal(preflight(change(e => { e.readinessGet.versionId = "22222222-2222-4222-8222-222222222222"; })).result, "FAIL");
  const p = base(), target = JSON.parse(p.targetBytes!); target.DB.id = "00000000-0000-0000-0000-000000000000";
  p.targetBytes = JSON.stringify(target); const observed = JSON.parse(p.evidenceBytes!); observed.targetSha256 = sha256(p.targetBytes);
  observed.bindings[0].id = target.DB.id; observed.readinessGet.databaseId = target.DB.id; p.candidate.d1_databases[0].database_id = target.DB.id;
  observed.configSha256 = candidateDigest(p.candidate); p.evidenceBytes = JSON.stringify(observed); assert.equal(preflight(p).result, "FAIL");
});
test("real CLI returns unverified without receipts and never writes config or echoes invalid inputs", () => {
  const paths = ["wrangler.jsonc", "release/production-migration-review.json", ".wrangler/production-v1/worker.jsonc"];
  const snapshot = () => paths.map(path => existsSync(`${apiDir}/${path}`) ? sha256(readFileSync(`${apiDir}/${path}`)) : null);
  const before = snapshot(), dir = mkdtempSync(join(tmpdir(), "preflight-cli-"));
  const invoke = (more: string[] = []) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings",
    `${apiDir}/scripts/cloudflare-production-preflight.ts`, "--stage", "before-deploy", "--commit", commit, ...more],
    { cwd: apiDir, env: { PATH: process.env.PATH }, encoding: "utf8" });
  try {
    const missing = invoke(); assert.equal(missing.status, 3, missing.stderr);
    const report = JSON.parse(missing.stdout); assert.equal(report.result, "UNVERIFIED"); assert.equal(report.deploymentAuthorized, false);
    const targetPath = join(dir, "target.json"), evidencePath = join(dir, "evidence.json");
    writeFileSync(targetPath, base().targetBytes!);
    for (const bad of ["private-evidence-should-not-echo", JSON.stringify({ ...JSON.parse(base().evidenceBytes!), secretValue: "should-not-echo" })]) {
      writeFileSync(evidencePath, bad); const invalid = invoke(["--expected-target", targetPath, "--evidence", evidencePath]);
      assert.equal(invalid.status, 1); assert.doesNotMatch(invalid.stdout + invalid.stderr, /should-not-echo/);
    }
    assert.deepEqual(snapshot(), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reviewed migration stream uses exact normalized directory, not just its basename", () => {
  for (const db of ["DB", "REPORTS_DB"] as const) {
    const o = base(), d = o.candidate.d1_databases.find((d: any) => d.binding === db);
    d.migrations_dir = `${apiDir}/../unreviewed/${db === "DB" ? "migrations" : "migrations-reports"}`;
    // Match the new config digest too: a receipt cannot bless a different directory from the hashed one.
    const e = JSON.parse(o.evidenceBytes!); e.configSha256 = candidateDigest(o.candidate); o.evidenceBytes = JSON.stringify(e);
    assert.ok(preflight(o).checks.some(c => c.id === `local.${db}.migrationStream` && c.outcome === "fail"));
  }
});
test("missing peppers before migration are deferred, never a request to change secrets early", () => {
  const o = base("before-migration"), e = JSON.parse(o.evidenceBytes!); e.secretNames = []; o.evidenceBytes = JSON.stringify(e);
  assert.equal(preflight(o).result, "UNVERIFIED");
  assert.ok(preflight(o).checks.some(c => c.id === "remote.peppersPresentByName" && c.outcome === "unverified"));
});
test("a prospective BLUE to GREEN cutover is not approved as a same-DB rollout", () => {
  const o = base(), t = JSON.parse(o.targetBytes!), e = JSON.parse(o.evidenceBytes!);
  t.DB.id = "22222222-2222-4222-8222-222222222222"; t.DB.name = "reviewed-green";
  o.targetBytes = JSON.stringify(t); o.candidate.d1_databases[0].database_id = t.DB.id; o.candidate.d1_databases[0].database_name = t.DB.name;
  e.targetSha256 = sha256(o.targetBytes); e.configSha256 = candidateDigest(o.candidate); o.evidenceBytes = JSON.stringify(e);
  assert.equal(preflight(o).result, "FAIL", "the active Worker remains BLUE: use the existing cutover runbook instead");
});
