// Node API handler + actual workerd D1: no remote deployment, Apple service or edge limiter claimed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { getPlatformProxy } from "wrangler";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { revokeKey } from "../src/attest/revocation.ts";
import { planBulkReportRejection, applyBulkReportRejection } from "../src/reports/bulk-rejection.ts";
import { minimizeAfter } from "../src/reports/create.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { runRetentionMaintenance } from "../src/reports/retention-automation.ts";
import { type Db } from "../src/db.ts";
import { type TestDevice, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";

process.env.WRANGLER_WRITE_LOGS = "false";
process.env.WRANGLER_LOG = "error";
process.env.WRANGLER_SEND_METRICS = "false";

test("isolated local Wrangler migration recovery and signed report lifecycle on workerd D1", { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "staging-local-d1-"));
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  const { getPlatformProxy } = await import("wrangler");
  const { importArtifact } = await import("../scripts/reports-migration-import.ts");
  const api = new URL("../", import.meta.url).pathname;
  const migrationDir = join(dir, "migrations"); mkdirSync(migrationDir);
  const files = readdirSync(join(api, "migrations-reports")).filter(f => f.endsWith(".sql")).sort();
  for (const f of files.slice(0, 2)) copyFileSync(join(api, "migrations-reports", f), join(migrationDir, f));
  const config = join(dir, "wrangler.json");
  writeFileSync(config, JSON.stringify({ name: "mannerpath-isolated-reports-test", main: join(api, "src/index.ts"), compatibility_date: "2026-09-01",
    d1_databases: [{ binding: "REPORTS_DB", database_name: "isolated-reports", database_id: "00000000-0000-0000-0000-000000000001", migrations_dir: migrationDir }] }));
  const state = join(dir, "state");
  const env = { ...process.env, CI: "true", XDG_CONFIG_HOME: join(dir, "config"), WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG: "error", WRANGLER_SEND_METRICS: "false" };
  const wrangler = (...args: string[]) => {
    // Fixed local command, private temporary config and no remote flag / actual database identifier.
    const r = spawnSync(process.execPath, [join(api, "node_modules/wrangler/bin/wrangler.js"), "d1", ...args,
      "--config", config, "--local", "--persist-to", state], { env, cwd: api, encoding: "utf8", timeout: 30_000 });
    assert.equal(r.status, 0, "isolated local D1 command must succeed");
  };
  let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | undefined;
  try {
    wrangler("migrations", "apply", "REPORTS_DB");
    const recovery = join(dir, "0003-reviewed-import.sql"); writeFileSync(recovery, importArtifact());
    wrangler("execute", "REPORTS_DB", "--file", recovery);
    for (const f of files.slice(2)) copyFileSync(join(api, "migrations-reports", f), join(migrationDir, f));
    wrangler("migrations", "apply", "REPORTS_DB");
    proxy = await getPlatformProxy({ configPath: config, remoteBindings: false, persist: { path: join(state, "v3") } });
    const db = proxy.env.REPORTS_DB as Db;
    const logged: unknown[] = [];
    for (const method of ["log", "error", "warn", "info", "debug"] as const) {
      t.mock.method(console, method, (...args: unknown[]) => { logged.push(args); });
    }
    const n = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;
    assert.deepEqual((await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{name: string}>()).results.map(r => r.name), files);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    const clock = { now: new Date("2026-10-14T03:00:00Z") };
    const pki = await testPki(clock.now);
    const appId = "ABCDE12345.com.example.mannerpath";
    const app = createApp({ appAttestTrustAnchor: pki.root, now: () => clock.now });
    // Generated per run, never committed, logged, sent remotely or used outside this isolated store.
    const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const bindings = { REPORTS_DB: db, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: appId,
      REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42",
      REPORT_SUBMITTER_PEPPER: random(), RATE_LIMIT_KEY_PEPPER: random(), REPORT_REGISTRATION: "enabled",
      REPORT_REGISTRATION_MAX_PER_HOUR: "1000", REPORT_REGISTRATION_MAX_PER_DAY: "10000",
      CHALLENGE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
    const post = async (path: string, body: unknown, overrides = {}) => {
      const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, { ...bindings, ...overrides } as any);
      return { status: res.status, json: await res.json() as Record<string, any> };
    };
    const challenge = async (body: unknown, overrides = {}) => post("/v1/app-attest/challenges", body, overrides);
    const register = async (environment: "production" | "development", serverEnvironment = environment) => {
      const device = await testDevice();
      const overrides = { REPORT_APP_ATTEST_ENVIRONMENT: serverEnvironment };
      const ch = await challenge({ schemaVersion: 1, purpose: "registration" }, overrides); assert.equal(ch.status, 201);
      const object = await attest(device, await sha256(registrationClientData(base64Decode(ch.json.challenge)!, device.keyId)), { appId, environment, pki, now: clock.now });
      const res = await post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch.json.challenge, attestationObject: base64Encode(object) }, overrides);
      assert.equal(res.status, environment === serverEnvironment ? 201 : 403); return device;
    };
    const draft = (key: string, note = "synthetic test observation") => ({ schemaVersion: 3, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J",
      installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", idempotencyKey: key, note });
    const signed = async (device: TestDevice, payload: unknown) => {
      const bytes = utf8(JSON.stringify(payload));
      const ch = await challenge({ schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 }); assert.equal(ch.status, 201);
      const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch.json.challenge)!, device.keyId, bytes)), { appId });
      return { schemaVersion: 3, payload: base64Encode(bytes), attestation: { keyId: device.keyIdBase64, challenge: ch.json.challenge, assertion: base64Encode(assertion) } };
    };
    const submit = async (device: TestDevice, payload: unknown, overrides = {}) => post("/v1/reports", await signed(device, payload), overrides);
    const device = await register("production");
    await register("development");
    await register("development", "production");
    await register("production", "development");
    assert.equal(await n("SELECT count(*) n FROM app_attest_keys"), 2, "cross-environment attestations register no key");
    const idempotency = random(); let reportId = "";
    await t.test("fresh signed retry 201/200, changed meaning 409, registration pause preserves existing keys", async () => {
      const first = await submit(device, draft(idempotency)); assert.equal(first.status, 201); reportId = first.json.reportId;
      const retry = await submit(device, draft(idempotency)); assert.equal(retry.status, 200); assert.equal(retry.json.reportId, reportId);
      assert.equal((await submit(device, draft(idempotency, "different"))).status, 409);
      assert.equal(await n("SELECT count(*) n FROM reports"), 1);
      assert.equal(await n("SELECT sum(report_count) n FROM report_rate_windows WHERE window_kind='hour'"), 1);
      const paused = { REPORT_REGISTRATION: "paused" };
      assert.equal((await challenge({ schemaVersion: 1, purpose: "registration" }, paused)).json.error, "registrationPaused");
      assert.equal((await submit(device, draft(idempotency), paused)).status, 200);
    });
    await t.test("limiter outage and limiter 429 do not touch D1", async () => {
      const count = await n("SELECT count(*) n FROM app_attest_challenges");
      const body = { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 };
      assert.equal((await challenge(body, { CHALLENGE_RATE_LIMITER: { limit: async () => { throw new Error("synthetic outage"); } } })).status, 503);
      assert.equal((await challenge(body, { CHALLENGE_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
      assert.equal(await n("SELECT count(*) n FROM app_attest_challenges"), count);
    });
    await t.test("workerd D1 batch abort rolls back every prior write; immutable receipt guards work", async () => {
      const before = await n("SELECT sign_count n FROM app_attest_keys WHERE environment='production'");
      await assert.rejects(db.batch([
        db.prepare("UPDATE app_attest_keys SET sign_count=sign_count+1 WHERE environment='production'"),
        db.prepare("DELETE FROM report_idempotency"),
      ]));
      assert.equal(await n("SELECT sign_count n FROM app_attest_keys WHERE environment='production'"), before);
      assert.equal(await n("SELECT count(*) n FROM report_idempotency"), 1);
    });
    await t.test("bulk audit apply and replay, atomic budget ceiling and revocation refusal", async () => {
      const plan = await planBulkReportRejection(db, { selector: { reportIds: [reportId] }, reason: "abuse", decidedBy: "test-maintainer", now: clock.now });
      assert.equal((await applyBulkReportRejection(db, plan, { confirmation: plan.digest, now: clock.now })).status, "applied");
      assert.equal((await applyBulkReportRejection(db, plan, { confirmation: plan.digest, now: clock.now })).status, "alreadyApplied");
      assert.equal(await n("SELECT count(*) n FROM report_bulk_rejection_targets"), 1);
      await assert.rejects(db.prepare("DELETE FROM report_bulk_rejections").run());
      for (let i = 1; i < 10; i++) assert.equal((await submit(device, draft(random()))).status, 201);
      assert.equal((await submit(device, draft(random()))).status, 429);
      assert.equal(await n("SELECT count(*) n FROM reports"), 10);
      await assert.rejects(db.prepare("UPDATE report_rate_windows SET report_count=11 WHERE window_kind='hour'").run());
      assert.equal(await n("SELECT sum(report_count) n FROM report_rate_windows WHERE window_kind='hour'"), 10, "commit-time budget trigger refuses an over-budget debit");
      const prepared = await signed(device, draft(idempotency));
      assert.equal(await revokeKey(db, device.keyIdBase64, "abuse", clock.now), "revoked");
      assert.equal((await post("/v1/reports", prepared)).json.reason, "keyRevoked");
      assert.equal((await challenge({ schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 })).json.reason, "keyRevoked");
      await assert.rejects(db.prepare("DELETE FROM app_attest_key_revocations").run());
    });
    await t.test("retention overdue is read-only; cleanup racing a retry retires receipts and then returns 410", async () => {
      const other = await register("production"); const key = random();
      const created = await submit(other, draft(key)); assert.equal(created.status, 201);
      clock.now = new Date(minimizeAfter(clock.now).getTime() + 1000);
      const monitor = await runRetentionMaintenance(db, { now: clock.now, mode: "monitor" });
      assert.equal(monitor.outcome, "overdue"); assert.equal(monitor.remaining!.dueReports, 11);
      assert.equal(await n("SELECT count(*) n FROM reports WHERE redacted_at IS NOT NULL"), 0);
      const pending = await signed(other, draft(key));
      const [retry] = await Promise.all([post("/v1/reports", pending), applyReportRetention(db, { now: clock.now })]);
      assert.ok([200, 410].includes(retry.status));
      assert.equal((await submit(other, draft(key))).status, 410);
      const done = await runRetentionMaintenance(db, { now: clock.now, mode: "cleanup" });
      assert.equal(done.outcome, "complete");
      assert.equal(await n("SELECT count(*) n FROM reports WHERE note IS NOT NULL OR submitter_hash IS NOT NULL"), 0);
      assert.equal(await n("SELECT count(*) n FROM report_idempotency WHERE retired_at IS NULL OR request_sha256 IS NOT NULL"), 0);
      assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    });
    assert.deepEqual(logged, [], "signed requests and refusals emit no payload, identifiers, IP or secret logs");
  } finally { await proxy?.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
