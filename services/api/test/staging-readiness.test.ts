// Staging readiness rehearsal (docs/STAGING_VERIFICATION.md). Everything here is local: the committed staging shape,
// the report-store migration order a staging REPORTS_DB goes through, and the security-hardened write path end to end
// on the fully migrated store. Nothing reaches Cloudflare; a staging deploy, migration or secret stays a maintainer step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { revokeKey } from "../src/attest/revocation.ts";
import { applyBulkReportRejection, planBulkReportRejection } from "../src/reports/bulk-rejection.ts";
import { runRetentionMaintenance } from "../src/reports/retention-automation.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
import { SqliteD1, applyMigration, reportMigrationFiles } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const APP_ID = "ABCDE12345.com.example.mannerpath";
/** What a maintainer would configure on staging (synthetic values; the real ones are secrets, never committed). */
const STAGING_ACTIVATION = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "42", REPORT_SUBMITTER_PEPPER: "s".repeat(32) };
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";
const MIGRATIONS = new URL("../migrations-reports/", import.meta.url);

function readJsonc(url: URL): any {
  let out = "", inString = false;
  const src = readFileSync(url, "utf8");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) { out += c; if (c === "\\") out += src[++i] ?? ""; else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out);
}

/** A report store migrated through the first `count` files of the stream, as a partially migrated staging store is. */
function storeThrough(count: number): SqliteD1 {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const f of reportMigrationFiles().slice(0, count)) applyMigration(raw, readFileSync(new URL(f, MIGRATIONS), "utf8"));
  return new SqliteD1(raw);
}

test("staging mirrors production except for names and IDs, and cannot be deployed or written as committed", () => {
  const { staging, production } = readJsonc(new URL("../wrangler.jsonc", import.meta.url)).env;
  // Everything that decides behavior is identical; only resource names and database IDs may differ.
  const shape = (env: any) => JSON.stringify({ ...env, name: null, r2_buckets: env.r2_buckets.map((b: any) => ({ ...b, bucket_name: null })),
    d1_databases: env.d1_databases.map((d: any) => ({ ...d, database_name: null, database_id: null })) });
  assert.equal(shape(staging), shape(production));
  for (const s of [staging.name, ...staging.d1_databases.map((d: any) => d.database_name), ...staging.r2_buckets.map((b: any) => b.bucket_name)]) {
    assert.match(s, /staging/, `${s}: a staging resource is named as one`);
  }
  // Placeholder IDs: deploy and --remote fail until a reviewed PR lands the real staging IDs.
  assert.deepEqual(staging.d1_databases.map((d: any) => d.database_id), ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000001"]);
  // Writes stay closed: attestation required, registration paused, and no limiter binding, so registration
  // cannot be enabled (it requires CHALLENGE_RATE_LIMITER) without a further reviewed PR.
  assert.deepEqual(staging.vars, { REPORT_ATTESTATION: "required", REPORT_REGISTRATION: "paused" });
  assert.equal(staging.ratelimits, undefined);
  assert.deepEqual(staging.triggers, { crons: [] });
});

test("migration order: the Worker's report routes fail closed until the store reaches 0005, then serve", async () => {
  const files = reportMigrationFiles();
  assert.deepEqual(files, ["0001_report_store.sql", "0002_scale_indexes.sql", "0003_evidence_photos.sql",
    "0004_report_idempotency.sql", "0005_app_attest_key_revocation.sql", "0006_bulk_report_rejection.sql",
    "0007_photo_deletion_attempts.sql"], "update STAGING_VERIFICATION.md when the stream grows");
  const now = new Date("2026-10-13T03:00:00Z");
  const pki = await testPki(now);
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => now });
  const device = await testDevice();
  for (let count = 1; count <= files.length; count++) {
    const res = await app.request("/v1/app-attest/challenges", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 }) },
    { DB: new SqliteD1(), REPORTS_DB: storeThrough(count), ...STAGING_ACTIVATION } as any);
    const body = await res.json() as Row;
    if (count < 5) assert.deepEqual([res.status, body.error], [503, "reportStoreUnavailable"], `through ${files[count - 1]}`);
    else assert.notEqual(res.status, 503, `through ${files[count - 1]}: ${JSON.stringify(body)}`);
  }
});

interface Rehearsal { db: SqliteD1; pki: TestPki; clock: { now: Date }; post: (path: string, body: unknown) => Promise<{ status: number; json: Row }> }

async function rehearsal(): Promise<Rehearsal> {
  const db = storeThrough(reportMigrationFiles().length);
  const clock = { now: new Date("2026-10-13T03:00:00Z") };
  const pki = await testPki(clock.now);
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => clock.now });
  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { DB: new SqliteD1(), REPORTS_DB: db, ...STAGING_ACTIVATION } as any);
    return { status: res.status, json: await res.json() as Row };
  };
  return { db, pki, clock, post };
}

async function register(r: Rehearsal): Promise<TestDevice> {
  const device = await testDevice();
  const ch = (await r.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" })).json.challenge;
  const attestationObject = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki: r.pki, now: r.clock.now });
  const res = await r.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(attestationObject) });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return device;
}

async function signed(r: Rehearsal, device: TestDevice, idempotencyKey: string) {
  const bytes = utf8(JSON.stringify({ schemaVersion: 3, type: "exists", spotId: SPOT, installId: INSTALL, idempotencyKey }));
  const ch = (await r.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 })).json.challenge;
  const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, bytes)), { appId: APP_ID });
  return { schemaVersion: 3, payload: base64Encode(bytes), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } };
}

const idem = (i: number) => i.toString(16).padStart(64, "0");
const count = (db: SqliteD1, sql: string) => (db.raw.prepare(sql).get() as Row).n as number;

test("rehearsal on the fully migrated store: register, report, retry, concurrent budget, revoke, bulk reject, retention", async (t) => {
  const logged: unknown[] = [];
  for (const m of ["log", "error", "warn", "info", "debug"] as const) t.mock.method(console, m, (...a: unknown[]) => logged.push(a));
  const r = await rehearsal();
  const device = await register(r);

  // Idempotency: the same draft re-signed answers the stored report, without a second report or budget debit.
  const first = await r.post("/v1/reports", await signed(r, device, idem(0)));
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const retry = await r.post("/v1/reports", await signed(r, device, idem(0)));
  assert.deepEqual([retry.status, retry.json.reportId], [200, first.json.reportId]);

  // Concurrent sends from one key: each is either stored or refused as counterNotIncreasing (a newer assertion
  // already won); none is stored twice, and stored reports equal budget debits.
  const sendAll = async (keys: number[]) => {
    const bodies = await Promise.all(keys.map((k) => signed(r, device, idem(k))));
    return Promise.all(bodies.map((b) => r.post("/v1/reports", b)));
  };
  let next = 1;
  for (const res of await sendAll([next++, next++, next++])) {
    assert.ok(res.status === 201 || (res.status === 403 && res.json.reason === "counterNotIncreasing"), JSON.stringify(res));
  }
  while (count(r.db, "SELECT count(*) AS n FROM reports") < 10) assert.equal((await r.post("/v1/reports", await signed(r, device, idem(next++)))).status, 201);
  // Atomic budget (10 per hour): concurrent sends past it are refused and store nothing.
  for (const res of await sendAll([next++, next++, next++])) assert.ok(res.status === 429 || res.json.reason === "counterNotIncreasing", JSON.stringify(res));
  assert.equal(count(r.db, "SELECT count(*) AS n FROM reports"), 10);
  assert.equal(count(r.db, "SELECT max(report_count) AS n FROM report_rate_windows"), 10);

  // Revocation: the key is refused at the challenge, and its stored reports stay as they are.
  assert.equal(await revokeKey(r.db, device.keyIdBase64, "abuse", r.clock.now), "revoked");
  const refused = await r.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 });
  assert.deepEqual([refused.status, refused.json.reason], [403, "keyRevoked"]);
  assert.equal(count(r.db, "SELECT count(*) AS n FROM reports"), 10);

  // Bulk reject (maintainer CLI core): two reports by ID, plan then explicit confirmation.
  const ids = (r.db.raw.prepare("SELECT report_id FROM reports ORDER BY received_at, report_id LIMIT 2").all() as Row[]).map((x) => x.report_id);
  const plan = await planBulkReportRejection(r.db, { selector: { reportIds: ids }, reason: "abuse", decidedBy: "staging-rehearsal", now: r.clock.now });
  assert.equal((await applyBulkReportRejection(r.db, plan, { confirmation: plan.digest, now: r.clock.now })).status, "applied");
  assert.equal(count(r.db, "SELECT count(*) AS n FROM report_moderation WHERE state = 'rejected'"), 2);

  // Retention: nothing due now (monitor is read-only); after 90 days one cleanup pass minimizes every report.
  assert.equal((await runRetentionMaintenance(r.db, { now: r.clock.now, mode: "monitor" })).outcome, "complete");
  r.clock.now = new Date(r.clock.now.getTime() + 91 * 86_400_000);
  // A pass is bounded (10 of each row kind), so expired challenges may need further passes: overdue, never failed.
  const outcomes: string[] = [];
  for (let pass = 0; pass < 5 && outcomes.at(-1) !== "complete"; pass++) outcomes.push((await runRetentionMaintenance(r.db, { now: r.clock.now, mode: "cleanup" })).outcome);
  assert.equal(outcomes.at(-1), "complete", outcomes.join());
  assert.equal(outcomes.includes("failed"), false);
  assert.equal(count(r.db, "SELECT count(*) AS n FROM reports WHERE redacted_at IS NULL"), 0);
  assert.deepEqual(r.db.raw.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(logged, [], "no request reaches a log line");
});
