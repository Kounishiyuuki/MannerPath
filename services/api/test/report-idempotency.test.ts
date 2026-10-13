// Report idempotency (schema v3, migration 0004) and the atomic report budget: retries, conflicts, retirement,
// concurrency and failure injection against the real report-store migrations (docs/API.md "POST /reports").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { unstable_splitSqlQuery } from "wrangler";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import type { Db } from "../src/db.ts";
import { minimizeAfter } from "../src/reports/create.ts";
import { ReportPayloadV3 } from "../src/reports/dto.ts";
import { canonicalJson, idempotencyDigest, requestSha256 } from "../src/reports/idempotency.ts";
import { REPORT_RATE_LIMITS } from "../src/reports/rate-limit.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { SqliteD1, applyMigration, reportMigrationFiles, reportsD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
const n = (db: SqliteD1, sql: string) => (db.raw.prepare(sql).get() as Row).n as number;
const reports = (db: SqliteD1) => n(db, "SELECT count(*) AS n FROM reports");
const receipts = (db: SqliteD1) => n(db, "SELECT count(*) AS n FROM report_idempotency");
const moderation = (db: SqliteD1) => n(db, "SELECT count(*) AS n FROM report_moderation");
const debited = (db: SqliteD1) => n(db, "SELECT coalesce(sum(report_count), 0) AS n FROM report_rate_windows WHERE window_kind = 'hour'");
const signCount = (db: SqliteD1) => n(db, "SELECT sign_count AS n FROM app_attest_keys");

/** A REPORTS_DB wrapper that can hide the fast-path reads, to drive the commit-time guards deterministically. */
class Gate implements Db {
  hideReceipts = 0;
  hideBudget = false;
  readonly inner: SqliteD1;
  constructor(inner: SqliteD1) { this.inner = inner; }
  prepare(sql: string) {
    const stmt = this.inner.prepare(sql);
    const hidden = (sql.startsWith("SELECT report_id, request_sha256") && this.hideReceipts > 0 && this.hideReceipts--)
      || (sql.startsWith("SELECT report_count FROM report_rate_windows") && this.hideBudget);
    if (!hidden) return stmt;
    const bind = stmt.bind.bind(stmt);
    return Object.assign(stmt, { bind: (...v: unknown[]) => Object.assign(bind(...v), { first: async () => null }) });
  }
  /** Why each rolled-back batch aborted, to prove which commit-time guard answered. */
  readonly aborts: string[] = [];
  async batch(statements: Parameters<Db["batch"]>[0]) {
    try { return await this.inner.batch(statements); } catch (e) { this.aborts.push(e instanceof Error ? e.message : String(e)); throw e; }
  }
}

interface Harness { db: SqliteD1; gate: Gate; pki: TestPki; clock: { now: Date }; post: (path: string, body: unknown, env?: Record<string, string>) => Promise<Response> }

async function harness(): Promise<Harness> {
  const db = reportsD1();
  const gate = new Gate(db);
  const pki = await testPki();
  const clock = { now: new Date("2026-10-13T03:00:00Z") };
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
  const attestationObject = await attest(device, cdh, { appId: APP_ID, pki: h.pki });
  const res = await h.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(attestationObject) });
  assert.equal(res.status, 201);
  return device;
}

const draft = (idempotencyKey: string, extra: Record<string, unknown> = {}) =>
  ({ schemaVersion: 3, type: "exists", spotId: SPOT, installId: INSTALL, idempotencyKey, ...extra });

/** One attempt: a fresh challenge and a fresh assertion over the exact payload bytes. */
async function attempt(h: Harness, device: TestDevice, payload: Record<string, unknown> | string) {
  const bytes = utf8(typeof payload === "string" ? payload : JSON.stringify(payload));
  const ch = await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, bytes)), { appId: APP_ID });
  return { body: { schemaVersion: 3, payload: base64Encode(bytes), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } }, counter: device.counter };
}

const send = async (h: Harness, a: { body: unknown }) => { const res = await h.post("/v1/reports", a.body); return { status: res.status, json: await res.json() as Row }; };

test("schema v3 requires a 64-hex idempotency key inside the signed payload; v2 is refused", async () => {
  for (const bad of [undefined, "", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64)]) {
    assert.equal(ReportPayloadV3.safeParse({ ...draft("0".repeat(64)), idempotencyKey: bad }).success, false, String(bad));
  }
  const h = await harness();
  const device = await registered(h);
  const v2 = await attempt(h, device, { ...draft(newKey()), schemaVersion: 2 });
  assert.equal((await h.post("/v1/reports", { ...v2.body, schemaVersion: 2 })).status, 400);
  const missingKey = await attempt(h, device, { schemaVersion: 3, type: "exists", spotId: SPOT, installId: INSTALL });
  assert.equal((await send(h, missingKey)).status, 400);
  assert.equal(reports(h.db), 0);
});

test("F: a lost response is retried with a fresh challenge and assertion: 200, the same report, no second debit", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, device, draft(key)));
  assert.equal(first.status, 201);
  const retry = await attempt(h, device, draft(key));
  const again = await send(h, retry);
  assert.deepEqual([again.status, again.json.reportId, again.json.state, again.json.receivedAt], [200, first.json.reportId, "pending", first.json.receivedAt]);
  assert.deepEqual([reports(h.db), receipts(h.db), moderation(h.db), debited(h.db)], [1, 1, 1, 1]);
  // The retry's valid assertion is recorded: its counter is the key's new high-water mark.
  assert.equal(signCount(h.db), retry.counter);
});

test("G: the first attempt's challenge and assertion are never accepted again", async () => {
  const h = await harness();
  const device = await registered(h);
  const sent = await attempt(h, device, draft(newKey()));
  assert.equal((await send(h, sent)).status, 201);
  const replay = await send(h, sent);
  assert.deepEqual([replay.status, replay.json.reason], [403, "challengeInvalid"]);
  assert.equal(reports(h.db), 1);
});

test("H/I: the request hash is the validated meaning, independent of property order; one changed field is a 409", async () => {
  const key = newKey();
  const a = ReportPayloadV3.parse(draft(key, { observedOn: "2026-10-12", note: "灰皿あり" }));
  const b = ReportPayloadV3.parse(JSON.parse(`{"note":"灰皿あり","observedOn":"2026-10-12","installId":"${INSTALL.toUpperCase()}","idempotencyKey":"${key}","spotId":"${SPOT}","type":"exists","schemaVersion":3}`));
  assert.equal(await requestSha256(a as any), await requestSha256(b as any));
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: "é" } }), '{"a":{"c":"é","d":[2,{"x":0,"y":1}]},"b":1}');
  // The key itself is not part of the meaning, every other field is.
  assert.equal(await requestSha256({ ...a, idempotencyKey: newKey() } as any), await requestSha256(a as any));
  assert.notEqual(await requestSha256({ ...a, note: "灰皿なし" } as any), await requestSha256(a as any));

  const h = await harness();
  const device = await registered(h);
  const first = await send(h, await attempt(h, device, draft(key, { observedOn: "2026-10-12", note: "灰皿あり" })));
  const reordered = await send(h, await attempt(h, device, `{"note":"灰皿あり","observedOn":"2026-10-12","installId":"${INSTALL}","idempotencyKey":"${key}","spotId":"${SPOT}","type":"exists","schemaVersion":3}`));
  assert.deepEqual([first.status, reordered.status, reordered.json.reportId], [201, 200, first.json.reportId]);
  const changed = await send(h, await attempt(h, device, draft(key, { observedOn: "2026-10-12", note: "灰皿なし" })));
  assert.deepEqual([changed.status, changed.json.error], [409, "idempotencyConflict"]);
  assert.deepEqual([reports(h.db), receipts(h.db), debited(h.db)], [1, 1, 1]);
});

test("D: a retry that loses the receipt race at commit answers 200 with the winner's report; one report, one debit", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, device, draft(key)));
  const loser = await attempt(h, device, draft(key));
  h.gate.hideReceipts = 1; // the fast path misses the receipt, as a concurrent request would
  const raced = await send(h, loser);
  assert.deepEqual([raced.status, raced.json.reportId], [200, first.json.reportId]);
  assert.match(h.gate.aborts.join("\n"), /UNIQUE constraint failed: report_idempotency\.idempotency_digest/, "the commit-time receipt guard answered");
  assert.deepEqual([reports(h.db), receipts(h.db), moderation(h.db), debited(h.db)], [1, 1, 1, 1]);
  // The batch rolled back with its counter advance; the counter was then recorded on its own, never left reusable.
  assert.equal(signCount(h.db), loser.counter);
});

test("D (concurrent): two attempts of one draft in flight together store at most one report and one debit", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const [a, b] = [await attempt(h, device, draft(key)), await attempt(h, device, draft(key))];
  const results = await Promise.all([send(h, a), send(h, b)]);
  assert.deepEqual([reports(h.db), receipts(h.db), debited(h.db)], [1, 1, 1]);
  const ids = results.filter((r) => r.status === 201 || r.status === 200).map((r) => r.json.reportId);
  assert.ok(ids.length >= 1 && ids.every((id) => id === ids[0]), JSON.stringify(results));
  for (const r of results) assert.ok([200, 201].includes(r.status) || r.json.reason === "counterNotIncreasing", JSON.stringify(r));
});

test("E: the same key with different content racing at commit: one report, the other 409", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  assert.equal((await send(h, await attempt(h, device, draft(key, { note: "a" })))).status, 201);
  const other = await attempt(h, device, draft(key, { note: "b" }));
  h.gate.hideReceipts = 1;
  const raced = await send(h, other);
  assert.deepEqual([raced.status, raced.json.error], [409, "idempotencyConflict"]);
  assert.match(h.gate.aborts.join("\n"), /UNIQUE constraint failed: report_idempotency/);
  assert.deepEqual([reports(h.db), receipts(h.db), debited(h.db)], [1, 1, 1]);
  assert.equal(signCount(h.db), other.counter);
});

test("A/B: a failing report or moderation insert rolls back the receipt, the debit and the counter", async () => {
  for (const table of ["reports", "report_moderation"]) {
    const h = await harness();
    const device = await registered(h);
    h.db.raw.exec(`CREATE TRIGGER inject BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    const res = await send(h, await attempt(h, device, draft(newKey())));
    assert.deepEqual([res.status, res.json.error], [503, "reportStoreUnavailable"], table);
    assert.match(h.gate.aborts.join("\n"), /injected failure/, table);
    assert.deepEqual([reports(h.db), receipts(h.db), moderation(h.db), debited(h.db), signCount(h.db)], [0, 0, 0, 0, 0], table);
  }
});

test("C: the budget is enforced at commit, not by the fast check; a refusal stores and debits nothing", async () => {
  const h = await harness();
  const device = await registered(h);
  const hourly = REPORT_RATE_LIMITS.find((l) => l.kind === "hour")!;
  for (let i = 0; i < hourly.max; i++) assert.equal((await send(h, await attempt(h, device, draft(newKey())))).status, 201);
  const counterBefore = signCount(h.db);
  h.gate.hideBudget = true; // the fast check sees an empty window; only the trigger can refuse
  const refused = await send(h, await attempt(h, device, draft(newKey())));
  assert.deepEqual([refused.status, refused.json.error], [429, "reportRateLimited"]);
  assert.match(h.gate.aborts.join("\n"), /report budget exhausted/, "the trigger, not the fast check, refused");
  assert.deepEqual([reports(h.db), receipts(h.db), debited(h.db)], [hourly.max, hourly.max, hourly.max]);
  assert.equal(signCount(h.db), counterBefore, "a budget refusal writes nothing, the counter included (ADR-0007 §5)");
});

test("C (concurrent): attempts racing for the last budget unit commit at most the limit", async () => {
  const h = await harness();
  const device = await registered(h);
  const hourly = REPORT_RATE_LIMITS.find((l) => l.kind === "hour")!;
  for (let i = 0; i < hourly.max - 1; i++) assert.equal((await send(h, await attempt(h, device, draft(newKey())))).status, 201);
  const pending = [];
  for (let i = 0; i < 3; i++) pending.push(await attempt(h, device, draft(newKey())));
  h.gate.hideBudget = true;
  const outcomes = await Promise.all(pending.map((a) => send(h, a)));
  assert.equal(outcomes.filter((o) => o.status === 201).length, 1);
  assert.equal(reports(h.db), hourly.max);
  assert.equal(debited(h.db), hourly.max);
});

test("duplicate, conflict and retired answers debit no budget, including at the limit", async () => {
  const h = await harness();
  const device = await registered(h);
  const hourly = REPORT_RATE_LIMITS.find((l) => l.kind === "hour")!;
  const keys = Array.from({ length: hourly.max }, newKey);
  for (const key of keys) assert.equal((await send(h, await attempt(h, device, draft(key)))).status, 201);
  assert.equal((await send(h, await attempt(h, device, draft(keys[0])))).status, 200);
  assert.equal((await send(h, await attempt(h, device, draft(keys[1], { note: "other" })))).status, 409);
  assert.equal(debited(h.db), hourly.max);
});

test("J: retention retires the receipt with the report's content; a later retry is 410 and never a new report", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, device, draft(key, { note: "personal" })));
  await applyReportRetention(h.db, { now: minimizeAfter(h.clock.now) });
  const receipt = h.db.raw.prepare("SELECT * FROM report_idempotency").get() as Row;
  assert.deepEqual([receipt.report_id, receipt.request_sha256, typeof receipt.retired_at], [first.json.reportId, null, "string"]);
  h.clock.now = new Date(minimizeAfter(h.clock.now).getTime() + 1000);
  const late = await send(h, await attempt(h, device, draft(key, { note: "personal" })));
  assert.deepEqual([late.status, late.json.error], [410, "idempotencyRetired"]);
  assert.deepEqual([reports(h.db), receipts(h.db)], [1, 1]);
  // Running retention again is a no-op for an already retired receipt.
  await applyReportRetention(h.db, { now: h.clock.now });
  assert.equal(n(h.db, "SELECT count(*) AS n FROM report_idempotency WHERE retired_at IS NOT NULL"), 1);
});

test("a pepper rotation does not turn a retry into a second report", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, device, draft(key)));
  const rotated = await h.post("/v1/reports", (await attempt(h, device, draft(key))).body, { ...ENV, REPORT_SUBMITTER_PEPPER: "y".repeat(32) });
  assert.deepEqual([rotated.status, ((await rotated.json()) as Row).reportId], [200, first.json.reportId]);
  assert.equal(reports(h.db), 1);
});

test("receipts store a domain-separated digest, are immutable but for one retirement, and are never deleted", async () => {
  const key = "a".repeat(64);
  assert.equal(await idempotencyDigest(key), Buffer.from(await sha256(utf8(`mannerpath.report-idempotency.v1\n${key}`))).toString("hex"));
  const h = await harness();
  const device = await registered(h);
  const first = await send(h, await attempt(h, device, draft(key)));
  const raw = h.db.raw;
  assert.equal(JSON.stringify(raw.prepare("SELECT * FROM report_idempotency").all()).includes(key), false);
  assert.throws(() => raw.exec(`UPDATE report_idempotency SET request_sha256 = '${"0".repeat(64)}'`), /one retirement/);
  assert.throws(() => raw.exec("DELETE FROM report_idempotency"), /never deleted/);
  assert.throws(() => raw.prepare("DELETE FROM reports WHERE report_id = ?").run(first.json.reportId), /FOREIGN KEY/);
  assert.throws(() => raw.exec(`INSERT INTO report_idempotency VALUES ('${"1".repeat(64)}', '${first.json.reportId}', NULL, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`), /created active|UNIQUE/);
});

test("the budget triggers hold exactly REPORT_RATE_LIMITS", () => {
  const db = reportsD1().raw;
  for (const limit of REPORT_RATE_LIMITS) {
    const insert = (count: number, start: string) => db.prepare("INSERT INTO report_rate_windows VALUES (?, ?, ?, ?, ?)")
      .run("e".repeat(64), limit.kind, start, count, "2099-01-01T00:00:00Z");
    insert(limit.max, `2026-01-01T00:00:0${limit.kind === "hour" ? 0 : 1}Z`);
    assert.throws(() => insert(limit.max + 1, "2026-01-02T00:00:00Z"), /budget exhausted/, limit.kind);
    assert.throws(() => db.prepare("UPDATE report_rate_windows SET report_count = report_count + 1 WHERE window_kind = ?").run(limit.kind), /budget exhausted/);
  }
});

test("migration 0004: fresh and upgraded stores match, existing reports stay valid, and Wrangler splits it cleanly", () => {
  const files = reportMigrationFiles();
  assert.equal(files.at(-1), "0004_report_idempotency.sql");
  const sql = (f: string) => readFileSync(new URL(`../migrations-reports/${f}`, import.meta.url), "utf8");
  const fresh = new DatabaseSync(":memory:");
  fresh.exec("PRAGMA foreign_keys = ON;");
  for (const f of files) applyMigration(fresh, sql(f));
  const upgraded = new DatabaseSync(":memory:");
  upgraded.exec("PRAGMA foreign_keys = ON;");
  for (const f of files.slice(0, -1)) applyMigration(upgraded, sql(f));
  upgraded.exec(`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status, received_at, minimize_after)
    VALUES ('rp_${"0".repeat(26)}', 2, 'exists', '${SPOT}', 'verified', '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z')`);
  applyMigration(upgraded, sql(files.at(-1)!));
  const schema = (db: DatabaseSync) => db.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all();
  assert.deepEqual(schema(upgraded), schema(fresh));
  assert.equal((upgraded.prepare("SELECT count(*) AS n FROM report_idempotency").get() as Row).n, 0);
  assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
  // A pre-0004 report has no receipt; retention still redacts it.
  const store = new SqliteD1(upgraded);
  return applyReportRetention(store, { now: new Date("2026-05-01T00:00:00Z") }).then((r) => {
    assert.equal(r.redactedReports, 1);
    const text = sql(files.at(-1)!);
    assert.equal(/\bcase\b/i.test(text), false, "no conditional expression in a trigger (REPORTS_MIGRATION_RECOVERY.md)");
    const statements = unstable_splitSqlQuery(text);
    assert.equal(statements.length, 6);
    const split = new DatabaseSync(":memory:");
    split.exec("PRAGMA foreign_keys = ON;");
    for (const f of files.slice(0, -1)) applyMigration(split, sql(f));
    for (const s of statements) split.exec(s);
    assert.deepEqual(schema(split), schema(fresh));
  });
});
