// App Attest key revocation (migration 0005): the maintainer CLI's revokeKey, the Worker's refusals at every boundary
// (challenge, assertion, idempotent retry, registration), the database guards that close the race between a request's
// verification and its commit, and the append-only audit row (docs/OPERATIONS.md "Revoke an App Attest key").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { unstable_splitSqlQuery } from "wrangler";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { REVOCATION_REASONS, listRevocations, revokeKey } from "../src/attest/revocation.ts";
import type { Db } from "../src/db.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
import { SqliteD1, applyMigration, reportMigrationFiles, reportsD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
const n = (db: SqliteD1, sql: string) => (db.raw.prepare(sql).get() as Row).n as number;
/** Everything a revocation must leave alone. */
const untouched = (db: SqliteD1) => JSON.stringify(["reports", "report_moderation", "report_idempotency", "report_rate_windows", "app_attest_keys"]
  .map((t) => db.raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));

/** A REPORTS_DB that can run a step (a concurrent revocation) just before the next batch commits. */
class Gate implements Db {
  beforeBatch: (() => Promise<void>) | null = null;
  readonly inner: SqliteD1;
  constructor(inner: SqliteD1) { this.inner = inner; }
  prepare(sql: string) { return this.inner.prepare(sql); }
  async batch(statements: Parameters<Db["batch"]>[0]) {
    const step = this.beforeBatch;
    this.beforeBatch = null;
    if (step) await step();
    return this.inner.batch(statements);
  }
}

interface Harness { db: SqliteD1; gate: Gate; pki: TestPki; now: Date; post: (path: string, body: unknown) => Promise<Response> }

async function harness(): Promise<Harness> {
  const db = reportsD1();
  const gate = new Gate(db);
  const now = new Date("2026-10-13T03:00:00Z");
  const pki = await testPki(now);
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => now });
  const post = (path: string, body: unknown) => app.request(path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    { DB: new SqliteD1(), REPORTS_DB: gate, ...ENV } as any);
  return { db, gate, pki, now, post };
}

async function challenge(h: Harness, body: Record<string, unknown>) {
  const res = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, ...body });
  return { status: res.status, json: await res.json() as Row };
}

async function register(h: Harness, device: TestDevice) {
  const ch = (await challenge(h, { purpose: "registration" })).json.challenge;
  const cdh = await sha256(registrationClientData(base64Decode(ch)!, device.keyId));
  const attestationObject = await attest(device, cdh, { appId: APP_ID, pki: h.pki, now: h.now });
  return h.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(attestationObject) });
}

async function registered(h: Harness): Promise<TestDevice> {
  const device = await testDevice();
  assert.equal((await register(h, device)).status, 201);
  return device;
}

const draft = (idempotencyKey: string) => ({ schemaVersion: 3, type: "exists", spotId: SPOT, installId: INSTALL, idempotencyKey });

/** A fully signed attempt (fresh challenge and assertion), not yet sent. */
async function attempt(h: Harness, device: TestDevice, key: string) {
  const bytes = utf8(JSON.stringify(draft(key)));
  const ch = (await challenge(h, { purpose: "report", keyId: device.keyIdBase64 })).json.challenge;
  const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, bytes)), { appId: APP_ID });
  return { schemaVersion: 3, payload: base64Encode(bytes), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } };
}

const send = async (h: Harness, body: unknown) => { const res = await h.post("/v1/reports", body); return { status: res.status, json: await res.json() as Row }; };
const isRevoked = (r: { status: number; json: Row }) => r.status === 403 && r.json.error === "attestationRejected" && r.json.reason === "keyRevoked";

test("revokeKey: one append-only row per registered key, a closed reason, idempotent, unknown keys refused", async () => {
  const h = await harness();
  const device = await registered(h);
  const other = await testDevice();
  assert.equal(await revokeKey(h.db, other.keyIdBase64, "abuse", h.now), "unknownKey");
  assert.equal(await revokeKey(h.db, device.keyIdBase64, "compromised", h.now), "revoked");
  assert.equal(await revokeKey(h.db, device.keyIdBase64, "abuse", new Date(h.now.getTime() + 60_000)), "alreadyRevoked");
  assert.deepEqual(await listRevocations(h.db), [{ keyId: device.keyIdBase64, reason: "compromised", revokedAt: "2026-10-13T03:00:00Z" }]);
  await assert.rejects(revokeKey(h.db, device.keyIdBase64, "because they said so" as any, h.now), /reason must be one of/);
  await assert.rejects(revokeKey(h.db, "not-a-key", "abuse", h.now), /canonical base64/);
  assert.deepEqual([...REVOCATION_REASONS], ["compromised", "abuse", "maintainerRequest"]);

  const raw = h.db.raw;
  assert.throws(() => raw.exec("UPDATE app_attest_key_revocations SET reason = 'abuse'"), /append-only/);
  assert.throws(() => raw.exec("DELETE FROM app_attest_key_revocations"), /append-only/);
  assert.throws(() => raw.prepare("DELETE FROM app_attest_keys WHERE key_id = ?").run(device.keyIdBase64), /FOREIGN KEY/, "a revoked keyId can never be freed for re-registration");
  assert.throws(() => raw.prepare("INSERT INTO app_attest_key_revocations VALUES (?, 'typo', '2026-01-01T00:00:00Z')").run(other.keyIdBase64), /CHECK|FOREIGN KEY/);
});

test("a revoked key gets no challenge, cannot submit with one it already holds, and cannot re-register", async () => {
  const h = await harness();
  const device = await registered(h);
  const signedBefore = await attempt(h, device, newKey()); // challenge issued and signed before the revocation
  await revokeKey(h.db, device.keyIdBase64, "compromised", h.now);
  const before = untouched(h.db);

  const ch = await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  assert.ok(isRevoked(ch), JSON.stringify(ch));
  const sent = await send(h, signedBefore);
  assert.ok(isRevoked(sent), JSON.stringify(sent));
  assert.equal((await register(h, device)).status, 409, "the keyId stays taken: no re-registration");
  assert.equal(untouched(h.db), before, "nothing stored, no counter moved");
  assert.equal(n(h.db, "SELECT count(*) AS n FROM reports"), 0);
});

test("a revoked key's idempotent retry is refused, not answered from its receipt; its stored report is untouched", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, device, key));
  assert.equal(first.status, 201);
  const retry = await attempt(h, device, key); // signed before the revocation
  await revokeKey(h.db, device.keyIdBase64, "abuse", h.now);
  const before = untouched(h.db);
  const res = await send(h, retry);
  assert.ok(isRevoked(res), JSON.stringify(res));
  assert.equal(JSON.stringify(res.json).includes(first.json.reportId), false, "no receipt answer for a revoked key");
  assert.equal(untouched(h.db), before, "the report, its moderation row and receipt are unchanged");
});

test("race: a revocation that commits between verification and the report batch aborts the whole batch", async () => {
  const h = await harness();
  const device = await registered(h);
  const sent = await attempt(h, device, newKey());
  const counter = n(h.db, "SELECT sign_count AS n FROM app_attest_keys");
  h.gate.beforeBatch = async () => { assert.equal(await revokeKey(h.db, device.keyIdBase64, "compromised", h.now), "revoked"); };
  const res = await send(h, sent);
  assert.ok(isRevoked(res), JSON.stringify(res));
  for (const t of ["reports", "report_moderation", "report_idempotency", "report_rate_windows"]) assert.equal(n(h.db, `SELECT count(*) AS n FROM ${t}`), 0, t);
  assert.equal(n(h.db, "SELECT sign_count AS n FROM app_attest_keys"), counter, "the counter advance rolled back with the batch");
});

test("race: a revocation that commits before a retry records its counter refuses the receipt answer", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, device, key));
  const retry = await attempt(h, device, key);
  h.gate.beforeBatch = async () => { await revokeKey(h.db, device.keyIdBase64, "abuse", h.now); };
  const res = await send(h, retry);
  assert.ok(isRevoked(res), JSON.stringify(res));
  assert.equal(JSON.stringify(res.json).includes(first.json.reportId), false);
});

test("race: a revocation that commits after the challenge route read the key refuses the challenge insert", async () => {
  const h = await harness();
  const device = await registered(h);
  const original = h.gate.prepare.bind(h.gate);
  let armed = true;
  h.gate.prepare = (sql: string) => {
    if (armed && sql.trimStart().startsWith("INSERT INTO app_attest_challenges")) {
      armed = false;
      h.db.raw.prepare("INSERT INTO app_attest_key_revocations VALUES (?, 'compromised', '2026-10-13T03:00:00Z')").run(device.keyIdBase64);
    }
    return original(sql);
  };
  const ch = await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  assert.ok(isRevoked(ch), JSON.stringify(ch));
  assert.equal(n(h.db, "SELECT count(*) AS n FROM app_attest_challenges WHERE key_id IS NOT NULL"), 0);
});

test("revocation affects only its key: another key keeps submitting, and refusals log nothing", async (t) => {
  const logged: unknown[] = [];
  for (const m of ["log", "error", "warn", "info", "debug"] as const) t.mock.method(console, m, (...a: unknown[]) => logged.push(a));
  const h = await harness();
  const revoked = await registered(h);
  const fine = await registered(h);
  await revokeKey(h.db, revoked.keyIdBase64, "abuse", h.now);
  assert.equal((await send(h, await attempt(h, fine, newKey()))).status, 201);
  assert.ok(isRevoked(await challenge(h, { purpose: "report", keyId: revoked.keyIdBase64 })));
  assert.deepEqual(logged, []);
});

test("migration 0005: forward-only, fresh and upgraded stores match, existing keys and reports stay valid, Wrangler splits it", () => {
  const files = reportMigrationFiles();
  assert.equal(files.at(-1), "0005_app_attest_key_revocation.sql");
  const sql = (f: string) => readFileSync(new URL(`../migrations-reports/${f}`, import.meta.url), "utf8");
  const text = sql(files.at(-1)!);
  assert.equal(/\bcase\b/i.test(text), false, "no conditional expression in a trigger (REPORTS_MIGRATION_RECOVERY.md)");
  assert.equal(/\b(drop|alter|delete\s+from|update\s+\w+\s+set)\b/i.test(text.replace(/--.*$/gm, "")), false, "additive only");
  const open = () => { const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys = ON;"); return db; };
  const fresh = open();
  for (const f of files) applyMigration(fresh, sql(f));
  const upgraded = open();
  for (const f of files.slice(0, -1)) applyMigration(upgraded, sql(f));
  upgraded.exec(`INSERT INTO app_attest_keys VALUES ('${"A".repeat(43)}=', '04${"a".repeat(128)}', 'production', 0, '2026-01-01T00:00:00Z')`);
  upgraded.exec(`UPDATE app_attest_keys SET sign_count = 5`);
  const split = open();
  for (const f of files.slice(0, -1)) applyMigration(split, sql(f));
  const statements = unstable_splitSqlQuery(text);
  assert.equal(statements.length, 5);
  for (const s of statements) split.exec(s);
  for (const s of statements) upgraded.exec(s);
  const schema = (db: DatabaseSync) => db.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all();
  assert.deepEqual(schema(upgraded), schema(fresh));
  assert.deepEqual(schema(split), schema(fresh));
  // An unrevoked key keeps working after the upgrade.
  upgraded.exec("UPDATE app_attest_keys SET sign_count = 6");
  assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a Worker deployed before migration 0005 fails closed: key lookups answer 503, nothing is accepted", async () => {
  const files = reportMigrationFiles().slice(0, -1);
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const f of files) applyMigration(raw, readFileSync(new URL(`../migrations-reports/${f}`, import.meta.url), "utf8"));
  const pki = await testPki(new Date("2026-10-13T03:00:00Z"));
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => new Date("2026-10-13T03:00:00Z") });
  const device = await testDevice();
  const res = await app.request("/v1/app-attest/challenges", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 }) }, { DB: new SqliteD1(), REPORTS_DB: new SqliteD1(raw), ...ENV } as any);
  assert.deepEqual([res.status, ((await res.json()) as Row).error], [503, "reportStoreUnavailable"]);
});
