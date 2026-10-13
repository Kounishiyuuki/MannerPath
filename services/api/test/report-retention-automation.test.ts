import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
type Row = Record<string, any>;
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { receiptStatement } from "../src/reports/idempotency.ts";
import { retentionStatus, runRetentionMaintenance, validateReportRetentionStore } from "../src/reports/retention-automation.ts";
import { reportsD1, SqliteD1 } from "./support/sqlite-d1.ts";
const received = new Date("2026-01-01T00:00:00Z"), now = minimizeAfter(received);
const zero = { dueReports: 0, expiredRateWindows: 0, expiredChallenges: 0, inconsistentReceipts: 0, pendingPhotoCleanup: 0 };
const count = (db: SqliteD1, sql: string) => Number(db.raw.prepare(sql).get()?.n);
async function seed(db: SqliteD1, size = 1) {
  for (let i = 0; i < size; i++) await createReport(db, { schemaVersion: 3, type: "exists", spotId: `sp_${"0".repeat(26)}`, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", idempotencyKey: "a".repeat(64), note: "private-note-sentinel", observedOn: "2026-01-01" }, {
    now: received, attestationStatus: "verified", submitterHash: "b".repeat(64), newReportId: () => `rp_${String(i).padStart(26, "0")}`,
    after: (id, at) => [receiptStatement(db, i.toString(16).padStart(64, "0"), id, "c".repeat(64), at)],
  });
}
function metadata(result: Awaited<ReturnType<typeof runRetentionMaintenance>>) {
  assert.deepEqual(Object.keys(result).sort(), ["batches", "event", "mode", "outcome", "remaining"]);
  if (result.remaining) { assert.deepEqual(Object.keys(result.remaining).sort(), Object.keys(zero).sort()); for (const n of Object.values(result.remaining)) assert.ok(Number.isSafeInteger(n) && n >= 0); }
  assert.doesNotMatch(JSON.stringify(result), /rp_|private-note-sentinel|2026-|cursor|submitter|secret-key/);
}
test("monitor reads only aggregate counts; bounded repeated cleanup drains the backlog", async () => {
  const db = reportsD1(); await seed(db, 23); const reads: string[] = [];
  const readonly: Db = { prepare(sql) { reads.push(sql); assert.match(sql, /^SELECT/); return db.prepare(sql); }, async batch() { assert.fail("monitor must not write"); } };
  assert.deepEqual(await runRetentionMaintenance(readonly, { now, mode: "monitor" }), { event: "reportRetention", mode: "monitor", outcome: "overdue", batches: 0, remaining: { ...zero, dueReports: 23 } });
  assert.ok(reads.filter(sql => sql.includes("FROM reports")).every(sql => sql.includes("count(*)")));
  assert.equal(count(db, "SELECT count(*) n FROM reports WHERE note IS NOT NULL"), 23);
  for (const [due, outcome] of [[13, "overdue"], [3, "overdue"], [0, "complete"]] as const) {
    const result = await runRetentionMaintenance(db, { now, mode: "cleanup" });
    assert.deepEqual(result.remaining, { ...zero, dueReports: due }); assert.equal(result.outcome, outcome); assert.equal(result.batches, 1); metadata(result);
    assert.equal(count(db, "SELECT count(*) n FROM report_idempotency WHERE retired_at IS NOT NULL"), 23 - due);
  }
  assert.equal(count(db, "SELECT count(*) n FROM report_moderation WHERE state='pending'"), 23);
  assert.equal(count(db, "SELECT count(*) n FROM reports WHERE note IS NOT NULL OR observed_on IS NOT NULL OR submitter_hash IS NOT NULL"), 0);
  assert.equal((await runRetentionMaintenance(db, { now, mode: "cleanup" })).outcome, "complete");
});
test("SQL receipt failure rolls back redaction; later pass failure preserves prior progress", async () => {
  const db = reportsD1(); await seed(db, 11);
  const inject = () => db.raw.exec("CREATE TRIGGER injected_failure BEFORE UPDATE ON report_idempotency BEGIN SELECT RAISE(ABORT, 'private-note-sentinel rp_00000000000000000000000000 2026-01-01 cursor secret-key'); END");
  inject(); const failed = await runRetentionMaintenance(db, { now, mode: "cleanup" });
  assert.deepEqual(failed, { event: "reportRetention", mode: "cleanup", outcome: "failed", batches: 0, remaining: null }); metadata(failed);
  assert.equal(count(db, "SELECT count(*) n FROM reports WHERE redacted_at IS NULL AND note IS NOT NULL"), 11);
  assert.equal(count(db, "SELECT count(*) n FROM report_idempotency WHERE retired_at IS NULL AND request_sha256 IS NOT NULL"), 11);
  db.raw.exec("DROP TRIGGER injected_failure"); assert.equal((await runRetentionMaintenance(db, { now, mode: "cleanup" })).remaining?.dueReports, 1);
  inject(); assert.equal((await runRetentionMaintenance(db, { now, mode: "cleanup" })).outcome, "failed");
  assert.equal(count(db, "SELECT count(*) n FROM reports WHERE redacted_at IS NOT NULL"), 10);
  db.raw.exec("DROP TRIGGER injected_failure"); assert.equal((await runRetentionMaintenance(db, { now, mode: "cleanup" })).outcome, "complete");
});
test("overlapping cleanup selections retire each receipt once", async () => {
  const db = reportsD1(); await seed(db, 2); let arrivals = 0; let release!: () => void;
  const both = new Promise<void>(resolve => { release = resolve; });
  const gated: Db = { prepare: sql => db.prepare(sql), async batch(statements) { if (++arrivals === 2) release(); await both; return db.batch(statements); } };
  const results = await Promise.all([runRetentionMaintenance(gated, { now, mode: "cleanup" }), runRetentionMaintenance(gated, { now, mode: "cleanup" })]);
  assert.equal(arrivals, 2); for (const r of results) { assert.equal(r.outcome, "complete"); assert.deepEqual(r.remaining, zero); }
  assert.equal(count(db, "SELECT count(*) n FROM report_idempotency WHERE retired_at IS NOT NULL AND request_sha256 IS NULL"), 2);
});
test("canonical identity and inconsistent receipts fail before writes", async () => {
  const canonical = new SqliteD1(); await assert.rejects(validateReportRetentionStore(canonical));
  assert.equal((await runRetentionMaintenance(canonical, { now, mode: "cleanup" })).outcome, "failed");
  const db = reportsD1(); await seed(db); db.raw.exec("UPDATE report_store_meta SET value='reports-store.invalid' WHERE key='schema'");
  await assert.rejects(validateReportRetentionStore(db)); db.raw.exec("UPDATE report_store_meta SET value='reports-store.v1' WHERE key='schema'"); await validateReportRetentionStore(db);
  db.raw.exec("UPDATE report_idempotency SET request_sha256=NULL, retired_at='2026-04-01T00:00:00Z'");
  const readonly: Db = { prepare: sql => db.prepare(sql), async batch() { assert.fail("inconsistency must stop writes"); } };
  const r = await runRetentionMaintenance(readonly, { now, mode: "cleanup" }); assert.equal(r.outcome, "failed"); assert.equal(r.batches, 0); assert.equal(r.remaining?.inconsistentReceipts, 1);
  assert.equal(count(db, "SELECT count(*) n FROM reports WHERE note IS NOT NULL"), 1);
});
test("pending photo deletion stays visible without storage adapter", async () => {
  const db = reportsD1(); await seed(db); db.raw.exec("INSERT INTO community_photo_deletions VALUES ('private-object-key', '2026-01-01T00:00:00Z')");
  assert.deepEqual(await retentionStatus(db, now), { ...zero, dueReports: 1, pendingPhotoCleanup: 1 });
  assert.equal((await runRetentionMaintenance(db, { now, mode: "monitor" })).outcome, "overdue");
  const r = await runRetentionMaintenance(db, { now, mode: "cleanup" }); assert.equal(r.outcome, "failed"); assert.deepEqual(r.remaining, { ...zero, pendingPhotoCleanup: 1 }); metadata(r);
  assert.equal(count(db, "SELECT count(*) n FROM community_photo_deletions"), 1);
});

const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
const n = (db: SqliteD1, sql: string) => (db.raw.prepare(sql).get() as Row).n as number;
const reports = (db: SqliteD1) => n(db, "SELECT count(*) AS n FROM reports");
const receipts = (db: SqliteD1) => n(db, "SELECT count(*) AS n FROM report_idempotency");
const moderation = (db: SqliteD1) => n(db, "SELECT count(*) AS n FROM report_moderation");
const debited = (db: SqliteD1) => n(db, "SELECT coalesce(sum(report_count), 0) AS n FROM report_rate_windows WHERE window_kind = 'hour'");
const signCount = (db: SqliteD1) => n(db, "SELECT sign_count AS n FROM app_attest_keys");

class Gate implements Db {
  hook: (() => Promise<void>) | null = null;
  readonly inner: SqliteD1;
  constructor(inner: SqliteD1) { this.inner = inner; }
  prepare(sql: string) {
    const stmt = this.inner.prepare(sql);
    if (!sql.startsWith("SELECT report_id, request_sha256")) return stmt;
    const bind = stmt.bind.bind(stmt);
    return Object.assign(stmt, { bind: (...values: unknown[]) => {
      const bound = bind(...values);
      const first = bound.first.bind(bound);
      return Object.assign(bound, { first: async <T>() => {
        const row = await first<T>();
        const hook = this.hook; this.hook = null;
        if (hook) await hook();
        return row;
      } });
    } });
  }
  batch(statements: Parameters<Db["batch"]>[0]) { return this.inner.batch(statements); }
}
interface Harness { db: SqliteD1; gate: Gate; pki: TestPki; clock: { now: Date }; post: (path: string, body: unknown, env?: Record<string, string>) => Promise<Response> }

async function harness(): Promise<Harness> {
  const db = reportsD1();
  const gate = new Gate(db);
  // A fixed clock, so budget windows never straddle an hour; the test PKI and attestations are issued for it too.
  const clock = { now: new Date("2026-10-13T03:00:00Z") };
  const pki = await testPki(clock.now);
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => clock.now });
  const post = (path: string, body: unknown, env: Record<string, string> = ENV) => app.request(path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    { DB: new SqliteD1(), REPORTS_DB: gate, ...env } as any);
  return { db, gate, pki, clock, post };
}

async function challenge(h: Harness, body: Record<string, unknown>): Promise<string> {
  const res = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, ...body });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return ((await res.json()) as Row).challenge;
}

async function registered(h: Harness): Promise<TestDevice> {
  const device = await testDevice();
  const ch = await challenge(h, { purpose: "registration" });
  const cdh = await sha256(registrationClientData(base64Decode(ch)!, device.keyId));
  const attestationObject = await attest(device, cdh, { appId: APP_ID, pki: h.pki, now: h.clock.now });
  const res = await h.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(attestationObject) });
  assert.equal(res.status, 201);
  return device;
}

const draft = (idempotencyKey: string, extra: Record<string, unknown> = {}) =>
  ({ schemaVersion: 3, type: "exists", spotId: SPOT, installId: INSTALL, idempotencyKey, ...extra });

/** One attempt: a fresh challenge and a fresh assertion over the exact payload bytes. */
async function attempt(h: Harness, device: TestDevice, payload: Record<string, unknown> | string | Uint8Array, opts: { counter?: number; signWith?: CryptoKey } = {}) {
  const bytes = payload instanceof Uint8Array ? payload : utf8(typeof payload === "string" ? payload : JSON.stringify(payload));
  const ch = await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, bytes)), { appId: APP_ID, ...opts });
  return { body: { schemaVersion: 3, payload: base64Encode(bytes), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } }, counter: device.counter };
}

const send = async (h: Harness, a: { body: unknown }) => { const res = await h.post("/v1/reports", a.body); return { status: res.status, json: await res.json() as Row }; };

test("signed retry when cleanup wins receipt lookup is 410; lookup-first overlap may confirm without resurrection", async () => {
  for (const order of ["cleanupFirst", "lookupFirst"] as const) {
    const h = await harness(); const device = await registered(h); const key = newKey();
    const first = await send(h, await attempt(h, device, draft(key, { note: "private-note-sentinel" })));
    assert.equal(first.status, 201);
    // Prepare a fresh assertion at the retention deadline; no challenge expires during the race.
    h.clock.now = minimizeAfter(h.clock.now);
    const retry = await attempt(h, device, draft(key, { note: "private-note-sentinel" }));
    const cleanup = async () => {
      assert.equal((await runRetentionMaintenance(h.db, { now: h.clock.now, mode: "cleanup" })).outcome, "complete");
    };
    if (order === "cleanupFirst") await cleanup(); else h.gate.hook = cleanup;
    const raced = await send(h, retry);
    assert.equal(raced.status, order === "cleanupFirst" ? 410 : 200);
    assert.equal(reports(h.db), 1); assert.equal(receipts(h.db), 1); assert.equal(moderation(h.db), 1);
    assert.equal(count(h.db, "SELECT count(*) n FROM reports WHERE redacted_at IS NOT NULL AND note IS NULL AND submitter_hash IS NULL"), 1);
    assert.equal(count(h.db, "SELECT count(*) n FROM report_idempotency WHERE request_sha256 IS NULL AND retired_at IS NOT NULL"), 1);
    assert.equal(signCount(h.db), retry.counter);
    const fresh = await send(h, await attempt(h, device, draft(key, { note: "private-note-sentinel" })));
    assert.equal(fresh.status, 410); assert.equal(reports(h.db), 1); assert.equal(debited(h.db), 0);
  }
});

test("expiration counts and cleanup use inclusive deadlines and preserve future rows", async () => {
  const db = reportsD1();
  const deadline = now.toISOString().replace('.000Z', 'Z');
  const future = new Date(now.getTime() + 1000).toISOString().replace('.000Z', 'Z');
  for (let i = 0; i < 12; i++) {
    const expiry = i === 11 ? future : deadline;
    db.raw.prepare("INSERT INTO report_rate_windows VALUES (?, 'hour', ?, 1, ?)").run(i.toString(16).padStart(64, '0'), received.toISOString(), expiry);
    db.raw.prepare("INSERT INTO app_attest_challenges VALUES (?, 'registration', NULL, ?, ?, NULL)").run(String(i).padStart(43, 'A') + '=', received.toISOString(), expiry);
  }
  assert.deepEqual(await retentionStatus(db, now), { ...zero, expiredRateWindows: 11, expiredChallenges: 11 });
  const first = await runRetentionMaintenance(db, { now, mode: 'cleanup' });
  assert.equal(first.outcome, 'overdue'); assert.deepEqual(first.remaining, { ...zero, expiredRateWindows: 1, expiredChallenges: 1 });
  const second = await runRetentionMaintenance(db, { now, mode: 'cleanup' });
  assert.equal(second.outcome, 'complete'); assert.deepEqual(second.remaining, zero);
  assert.equal(count(db, "SELECT count(*) n FROM report_rate_windows"), 1);
  assert.equal(count(db, "SELECT count(*) n FROM app_attest_challenges"), 1);
});

test("worst-case cleanup stays within the 47-query budget", async () => {
  const db = reportsD1(); await seed(db, 10);
  const expiry = now.toISOString().replace('.000Z', 'Z');
  for (let i = 0; i < 10; i++) {
    db.raw.prepare("INSERT INTO report_rate_windows VALUES (?, 'hour', ?, 1, ?)").run(i.toString(16).padStart(64, '0'), received.toISOString(), expiry);
    db.raw.prepare("INSERT INTO app_attest_challenges VALUES (?, 'registration', NULL, ?, ?, NULL)").run(String(i).padStart(43, 'A') + '=', received.toISOString(), expiry);
  }
  let queries = 0;
  let writes = 0;
  const budgeted: Db = {
    prepare(sql) {
      const wrap = (statement: ReturnType<Db['prepare']>): ReturnType<Db['prepare']> => ({
        bind: (...values) => wrap(statement.bind(...values)),
        first: async <T>() => { queries++; return statement.first<T>(); },
        all: async <T>() => { queries++; return statement.all<T>(); },
        run: async () => { queries++; return statement.run(); },
      });
      // Batch receives the adapter's statements directly and counts each execution below.
      return /^SELECT/.test(sql) ? wrap(db.prepare(sql)) : db.prepare(sql);
    },
    async batch(statements) { writes += statements.length; queries += statements.length; return db.batch(statements); },
  };
  const result = await runRetentionMaintenance(budgeted, { now, mode: 'cleanup' });
  assert.equal(result.outcome, 'complete'); assert.deepEqual(result.remaining, zero);
  assert.equal(writes, 40, 'ten report/receipt pairs plus ten windows and ten challenges');
  assert.equal(queries, 47, 'identity, schema status, before status, three selections, forty writes and after status');
  assert.ok(queries <= 47);
});

test("missing and malformed aggregate counts fail closed before cleanup writes", async () => {
  const db = reportsD1(); await seed(db);
  for (const field of Object.keys(zero)) {
    for (const value of [undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "0", Number.NaN]) {
      const malformed: Record<string, unknown> = { ...zero, [field]: value };
      if (value === undefined) delete malformed[field];
      const broken: Db = {
        prepare(sql) {
          const statement = db.prepare(sql);
          if (!sql.includes("AS dueReports")) return statement;
          const bind = statement.bind.bind(statement);
          return Object.assign(statement, { bind: (...values: unknown[]) => Object.assign(bind(...values), {
            first: async <T>() => malformed as T,
          }) });
        },
        async batch() { assert.fail("invalid aggregate counts must stop cleanup writes"); },
      };
      await assert.rejects(retentionStatus(broken, now), /Report retention status unavailable/, `${field}=${String(value)}`);
      const result = await runRetentionMaintenance(broken, { now, mode: "cleanup" });
      assert.deepEqual(result, { event: "reportRetention", mode: "cleanup", outcome: "failed", batches: 0, remaining: null });
    }
  }
  assert.equal(count(db, "SELECT count(*) n FROM reports WHERE note IS NOT NULL AND redacted_at IS NULL"), 1);
});
