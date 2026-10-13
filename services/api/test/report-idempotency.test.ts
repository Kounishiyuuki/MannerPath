import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
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
import { ambiguousPayload, canonicalJson, idempotencyDigest, requestSha256 } from "../src/reports/idempotency.ts";
import { REPORT_RATE_LIMITS } from "../src/reports/rate-limit.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { SqliteD1, applyMigration, reportMigrationFiles, reportsD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
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
  const b = ReportPayloadV3.parse(JSON.parse(`{"note":"灰皿あり","observedOn":"2026-10-12","installId":"${INSTALL.toUpperCase().replace("8F1C", "0000")}","idempotencyKey":"${key}","spotId":"${SPOT}","type":"exists","schemaVersion":3}`));
  assert.equal(await requestSha256(a as any), await requestSha256(b as any));
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: "é" } }), '{"a":{"c":"é","d":[2,{"x":0,"y":1}]},"b":1}');
  // The key and the installId (never stored for an attested report) are not part of the meaning, every other field is.
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

test("A/B: any failing write of the report batch rolls back the report, receipt, moderation, debits and counter", async () => {
  const writes = [["INSERT", "reports"], ["INSERT", "report_moderation"], ["INSERT", "report_idempotency"],
    ["INSERT", "report_rate_windows"], ["UPDATE", "app_attest_keys"], ["INSERT", "report_terms_documents"]];
  for (const [op, table] of writes) {
    const h = await harness();
    const device = await registered(h);
    h.db.raw.exec(`CREATE TRIGGER inject BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    const res = await send(h, await attempt(h, device, draft(newKey(), { acceptedTermsVersion: CURRENT_REPORT_TERMS.version })));
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
  const h = await harness();
  const device = await registered(h);
  assert.equal(await idempotencyDigest(device.keyIdBase64, key),
    Buffer.from(await sha256(utf8(`mannerpath.report-idempotency.v2\n${device.keyIdBase64}\n${key}`))).toString("hex"));
  const first = await send(h, await attempt(h, device, draft(key)));
  const raw = h.db.raw;
  const stored = JSON.stringify(raw.prepare("SELECT * FROM report_idempotency").all());
  assert.equal(stored.includes(key) || stored.includes(device.keyIdBase64), false, "neither the raw key nor the keyId is stored");
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
  // Checked against the stream as it stood at 0004; later migrations have their own tests.
  const all = reportMigrationFiles();
  const files = all.slice(0, all.indexOf("0004_report_idempotency.sql") + 1);
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

test("P0: an idempotency key is bound to its App Attest key; another key holding it learns nothing and gets its own draft", async () => {
  const h = await harness();
  const owner = await registered(h);
  const attacker = await registered(h);
  const key = newKey();
  const mine = await send(h, await attempt(h, owner, draft(key, { note: "owner" })));
  assert.equal(mine.status, 201);
  // The same key with the same content, and with different content: neither a 200 with the owner's reportId nor a
  // 409/410 that would confirm the key is in use. Both are the attacker's own new reports, budgeted as such.
  const other = await send(h, await attempt(h, attacker, draft(key, { note: "attacker" })));
  const copier = await registered(h);
  const same = await send(h, await attempt(h, copier, draft(key, { note: "owner" })));
  for (const r of [other, same]) {
    assert.equal(r.status, 201);
    assert.notEqual(r.json.reportId, mine.json.reportId);
  }
  // The owner's retry is unaffected.
  const retry = await send(h, await attempt(h, owner, draft(key, { note: "owner" })));
  assert.deepEqual([retry.status, retry.json.reportId], [200, mine.json.reportId]);
  assert.deepEqual([reports(h.db), receipts(h.db)], [3, 3]);
});

test("P0: a new App Attest key (re-registration or another device) is a new owner; no receipt carries over", async () => {
  const h = await harness();
  const before = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, before, draft(key)));
  const after = await registered(h);
  const moved = await send(h, await attempt(h, after, draft(key)));
  assert.equal(moved.status, 201);
  assert.notEqual(moved.json.reportId, first.json.reportId);
});

test("P0: receipts are reached only after a verified assertion: forged, stale and unregistered keys learn nothing", async () => {
  const h = await harness();
  const owner = await registered(h);
  const key = newKey();
  const first = await send(h, await attempt(h, owner, draft(key)));
  const stale = await attempt(h, owner, draft(key), { counter: owner.counter });
  const outsider = await testDevice();
  const forged = await attempt(h, owner, draft(key), { signWith: outsider.keys.privateKey });
  for (const [label, a, reason] of [["forged", forged, "assertionInvalid"], ["stale counter", stale, "counterNotIncreasing"]] as const) {
    const res = await send(h, a);
    assert.deepEqual([res.status, res.json.reason], [403, reason], label);
    assert.equal(JSON.stringify(res.json).includes(first.json.reportId), false, label);
  }
  // A key that was never registered (or is no longer) cannot even obtain a report challenge.
  const unknown = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: outsider.keyIdBase64 });
  assert.equal(unknown.status, 403);
  assert.deepEqual([reports(h.db), receipts(h.db)], [1, 1]);
});

test("canonicalization report-request.v1 is pinned: a fixed report hashes to a fixed value", async () => {
  const fixed = ReportPayloadV3.parse({ schemaVersion: 3, idempotencyKey: "0".repeat(64), type: "exists", spotId: SPOT, installId: INSTALL,
    observedOn: "2026-10-12", note: "灰皿 é", acceptedTermsVersion: CURRENT_REPORT_TERMS.version });
  assert.equal(canonicalJson(Object.fromEntries(Object.entries({ ...fixed, idempotencyKey: undefined, installId: undefined }))),
    `{"acceptedTermsVersion":"${CURRENT_REPORT_TERMS.version}","note":"灰皿 é","observedOn":"2026-10-12","schemaVersion":3,"spotId":"${SPOT}","type":"exists"}`);
  assert.equal(await requestSha256({ ...fixed, acceptedTermsVersion: "2026-10-01" } as any), GOLDEN);
});
// Computed independently: sha256("mannerpath.report-request.v1\n" + the canonical JSON above with acceptedTermsVersion "2026-10-01").
const GOLDEN = "6c1b04d1d7552ad6ddeda50bacf7a47909f3174e4c436cff16b474fe0fe4c274";

test("canonical meaning: quantization, -0, Unicode normalization and consent", async () => {
  const pin = (latitude: number, longitude: number) => ReportPayloadV3.parse({ schemaVersion: 3, idempotencyKey: "0".repeat(64), type: "missing",
    installId: INSTALL, proposedLocation: { latitude, longitude } }) as any;
  // Pins the store quantizes to one value hash alike; -0 is 0; a pin the store can tell apart does not.
  assert.equal(await requestSha256(pin(35.123454, 139.0000001)), await requestSha256(pin(35.1234549, 139)));
  assert.equal(await requestSha256(pin(-0.000001, -0)), await requestSha256(pin(0, 0)));
  assert.notEqual(await requestSha256(pin(35.12345, 139)), await requestSha256(pin(35.12346, 139)));
  // Strings are stored as sent, so NFC and NFD are different meanings (a different key would be a different draft).
  const note = (text: string) => ReportPayloadV3.parse(draft("0".repeat(64), { note: text })) as any;
  assert.notEqual(await requestSha256(note("é".normalize("NFC"))), await requestSha256(note("é".normalize("NFD"))));
  // Consent is part of the meaning.
  assert.notEqual(await requestSha256(note("x")), await requestSha256({ ...note("x"), acceptedTermsVersion: CURRENT_REPORT_TERMS.version }));
});

test("ambiguous payload bytes are refused before any hash or receipt: duplicate members, lone surrogates, invalid UTF-8", async () => {
  assert.equal(ambiguousPayload('{"a":1,"b":{"a":2},"c":[{"a":1},{"a":2}]}'), null);
  assert.equal(ambiguousPayload('{"a":"\\"a\\":1,","b":["a","a"]}'), null);
  assert.equal(ambiguousPayload('{"a":1,"a":1}'), "duplicate_key");
  assert.equal(ambiguousPayload('{"a":1,"\\u0061":2}'), "duplicate_key");
  assert.equal(ambiguousPayload('{"x":[{"k":1,"k":2}]}'), "duplicate_key");
  assert.equal(ambiguousPayload('{"note":"\\ud800"}'), "ill_formed_unicode");
  assert.equal(ambiguousPayload('{"note":"\\ud83d\\ude00"}'), null);

  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const body = JSON.stringify(draft(key));
  const cases: [string, string | Uint8Array, string][] = [
    ["duplicate note", body.replace("{", '{"note":"a",').replace(/}$/, ',"note":"b"}'), "payload: duplicate_key"],
    ["duplicate idempotencyKey", body.replace(/}$/, `,"idempotencyKey":"${newKey()}"}`), "payload: duplicate_key"],
    ["lone surrogate", body.replace(/}$/, ',"note":"\\udc00"}'), "payload: ill_formed_unicode"],
    ["invalid UTF-8", new Uint8Array([...utf8(body.slice(0, -1)), ...utf8(',"note":"'), 0xc3, 0x28, ...utf8('"}')]), "payload: invalid_json"],
  ];
  for (const [label, payload, detail] of cases) {
    const res = await send(h, await attempt(h, device, payload));
    assert.deepEqual([res.status, res.json.error, res.json.detail], [400, "invalidReport", detail], label);
  }
  assert.deepEqual([reports(h.db), receipts(h.db)], [0, 0]);
});

test("the assertion covers the exact bytes: a canonically equal re-serialization under the original assertion is refused", async () => {
  const h = await harness();
  const device = await registered(h);
  const key = newKey();
  const sent = await attempt(h, device, draft(key, { note: "n" }));
  const reordered = `{"note":"n","installId":"${INSTALL}","idempotencyKey":"${key}","spotId":"${SPOT}","type":"exists","schemaVersion":3}`;
  const swapped = { ...sent.body, payload: base64Encode(utf8(reordered)) };
  const res = await send(h, { body: swapped });
  assert.deepEqual([res.status, res.json.reason], [403, "assertionInvalid"]);
  assert.deepEqual([reports(h.db), receipts(h.db)], [0, 0]);
});

test("a retry racing retention answers 200 or 410 and never revives the report", async () => {
  for (let round = 0; round < 2; round++) {
    const h = await harness();
    const device = await registered(h);
    const key = newKey();
    const first = await send(h, await attempt(h, device, draft(key, { note: "personal" })));
    h.clock.now = new Date(minimizeAfter(h.clock.now).getTime() + 1000);
    const retry = await attempt(h, device, draft(key, { note: "personal" }));
    const [res] = await Promise.all([send(h, retry), applyReportRetention(h.db, { now: h.clock.now })]);
    assert.ok(res.status === 410 || (res.status === 200 && res.json.reportId === first.json.reportId), JSON.stringify(res));
    assert.deepEqual([reports(h.db), receipts(h.db)], [1, 1]);
    assert.equal(n(h.db, "SELECT count(*) AS n FROM reports WHERE note IS NOT NULL"), 0, "the content stays redacted");
    const after = await send(h, await attempt(h, device, draft(key, { note: "personal" })));
    assert.equal(after.status, 410);
  }
});
