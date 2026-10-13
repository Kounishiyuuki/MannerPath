// Maintainer-only bulk moderation against the real durable report-store migrations.
// Faults and concurrent changes happen at the D1 batch boundary, never against a remote database.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db, DbStatement } from "../src/db.ts";
import { BULK_REJECTION_MAX, BulkRejectionError, planBulkReportRejection, applyBulkReportRejection } from "../src/reports/bulk-rejection.ts";
import { attestedSubmitter, createReport, submitterHash } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { proposeEffectReview, exportReview } from "../src/reports/review.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { reportsD1, type SqliteD1 } from "./support/sqlite-d1.ts";

const NOW = new Date("2026-10-14T03:00:00Z");
const LATER = new Date("2026-10-14T03:01:00Z");
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";
const NOTE = "TEST-ONLY-PRIVATE-NOTE";
const PEPPER = " " + "p".repeat(32) + " ";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
type Row = Record<string, any>;
const rows = (db: SqliteD1, sql: string) => db.raw.prepare(sql).all() as Row[];
const moderation = (db: SqliteD1) => rows(db, "SELECT * FROM report_moderation ORDER BY report_id");
const snapshot = (db: SqliteD1) => JSON.stringify(rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .map(({ name }) => [name, rows(db, `SELECT * FROM ${name} ORDER BY 1`)]));
async function seed(db: SqliteD1, count = 2, opts: { key?: string; pepper?: string; at?: Date } = {}) {
  const ids: string[] = [];
  const hash = opts.key ? await submitterHash(attestedSubmitter(opts.key), opts.pepper ?? PEPPER) : "a".repeat(64);
  for (let i = 0; i < count; i++) {
    const { reportId } = await createReport(db, { schemaVersion: 1, type: "exists", spotId: SPOT, installId: INSTALL, note: NOTE }, {
      now: opts.at ?? NOW, attestationStatus: opts.key ? "verified" : "notProvided", submitterHash: hash,
    });
    ids.push(reportId);
  }
  return ids;
}
const options = (reportIds: string[]) => ({ selector: { reportIds }, reason: "abuse" as const, decidedBy: "maintainer-1", now: NOW });
const plan = (db: Db, ids: string[]) => planBulkReportRejection(db, options(ids));
const execute = (db: Db, p: Awaited<ReturnType<typeof plan>>) => applyBulkReportRejection(db, p, { confirmation: p.digest, now: LATER });
async function deniedWithoutWrites(db: SqliteD1, action: () => Promise<unknown>) {
  const before = snapshot(db);
  await assert.rejects(action, BulkRejectionError);
  assert.equal(snapshot(db), before);
}
class BatchGate implements Db {
  readonly inner: SqliteD1;
  readonly hook: () => Promise<void> | void;
  constructor(inner: SqliteD1, hook: () => Promise<void> | void) { this.inner = inner; this.hook = hook; }
  prepare(sql: string) { return this.inner.prepare(sql); }
  async batch(statements: DbStatement[]) { await this.hook(); return this.inner.batch(statements); }
}

test("bulk rejection: planning is read-only and deterministic; explicit confirmation rejects only selected reports", async () => {
  const db = reportsD1();
  const ids = await seed(db, 3);
  const before = snapshot(db);
  const p = await plan(db, ids.slice(0, 2));
  assert.equal(snapshot(db), before);
  assert.deepEqual(await plan(db, ids.slice(0, 2)), p);
  assert.deepEqual((await plan(db, ids.slice(0, 2).reverse())).targets, p.targets);
  assert.equal(p.targets.length, 2);
  const result = await execute(db, p);
  assert.equal(result.status, "applied");
  assert.equal(result.count, 2);
  assert.equal(result.digest, p.digest);
  const states = new Map(moderation(db).map((r) => [r.report_id, r.state]));
  assert.equal(states.get(ids[0]), "rejected");
  assert.equal(states.get(ids[1]), "rejected");
  assert.equal(states.get(ids[2]), "pending");
  assert.equal(rows(db, "SELECT note FROM reports").every((r) => r.note === NOTE), true, "immutable reports untouched");
});

test("bulk rejection: missing selector/reason, duplicate IDs, injection strings and invalid limits fail without writes", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  for (const extra of [
    { selector: {} }, { selector: { states: ["pending"] } }, { selector: { reportIds: [] } }, { reason: "" }, { reason: "private free text" },
    { selector: { reportIds: [ids[0], ids[0]] } }, { selector: { reportIds: ["' OR 1=1 --"] } },
    { maxCount: 0 }, { maxCount: -1 }, { maxCount: BULK_REJECTION_MAX + 1 }, { maxCount: 1.5 },
    { selector: { from: "2026-10-14T00:00:00Z" } },
    { selector: { from: "2026-10-14T00:00:00Z", before: "2026-10-16T00:00:00Z" } },
    { selector: { from: "2026-02-30T00:00:00Z", before: "2026-03-01T00:00:00Z" } },
    { selector: { from: "2026-10-15T00:00:00Z", before: "2026-10-14T00:00:00Z" } },
  ]) await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...options(ids), ...extra } as any));
});

test("bulk rejection: limits reject the entire selection rather than truncating", async () => {
  const db = reportsD1();
  const ids = await seed(db, BULK_REJECTION_MAX + 1);
  await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...options(ids.slice(0, 3)), maxCount: 2 }));
  await deniedWithoutWrites(db, () => planBulkReportRejection(db, {
    ...options([]), selector: { from: "2026-10-14T00:00:00Z", before: "2026-10-15T00:00:00Z" },
  }));
  assert.equal(moderation(db).every((r) => r.state === "pending"), true);
});

test("bulk rejection: confirmation, plan tampering, expired plan and wrong report store fail without writes", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  const p = await plan(db, ids);
  await deniedWithoutWrites(db, () => applyBulkReportRejection(db, p, { confirmation: "yes", now: LATER }));
  await deniedWithoutWrites(db, () => execute(db, { ...p, reason: "outOfScope" } as any));
  await deniedWithoutWrites(db, () => applyBulkReportRejection(db, p, { confirmation: p.digest, now: new Date("2026-10-15T03:00:00Z") }));
  const other = reportsD1();
  await deniedWithoutWrites(other, () => execute(other, p));
});

test("bulk rejection: queued or applied evidence cannot be bulk rejected", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  await recordModerationDecision(db, ids[0], { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: NOW });
  await setReconciliationState(db, ids[0], "queued", NOW);
  await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...options(ids), selector: { reportIds: ids, states: ["pending", "accepted"] } }));
  const review = await proposeEffectReview(db, { reportIds: [ids[0]], decidedBy: "reviewer-1", now: NOW });
  await exportReview(db, review.reviewId, { now: NOW });
  assert.equal(moderation(db).find((r) => r.report_id === ids[0])!.reconciliation_state, "applied");
  await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...options(ids), selector: { reportIds: ids, states: ["pending", "accepted"] } }));
});

test("bulk rejection: a moderation race and ABA change invalidate a confirmed plan", async () => {
  for (const aba of [false, true]) {
    const db = reportsD1();
    const ids = await seed(db);
    if (aba) await recordModerationDecision(db, ids[0], { state: "needsInfo", decidedBy: "reviewer-1", reason: "insufficientDetail", now: NOW });
    const p = await planBulkReportRejection(db, { ...options(ids), selector: { reportIds: ids, states: ["pending", "needsInfo"] } });
    await recordModerationDecision(db, ids[0], { state: aba ? "accepted" : "needsInfo", decidedBy: "reviewer-2", reason: "confirmed", now: NOW });
    if (aba) db.raw.prepare("UPDATE report_moderation SET state='needsInfo', decided_at='2026-10-14T03:00:00Z', decided_by='reviewer-1', decision_reason='insufficientDetail' WHERE report_id=?").run(ids[0]);
    await deniedWithoutWrites(db, () => execute(db, p));
  }
});

test("bulk rejection: commit-time race is guarded inside the same transaction", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  const p = await plan(db, ids);
  let concurrent: string | undefined;
  const gate = new BatchGate(db, async () => {
    await recordModerationDecision(db, ids[0], { state: "needsInfo", decidedBy: "reviewer-2", reason: "insufficientDetail", now: LATER });
    concurrent = snapshot(db);
  });
  await assert.rejects(execute(gate, p), BulkRejectionError);
  assert.equal(snapshot(db), concurrent, "concurrent decision survives, no partial rejection");
});

test("bulk rejection: a new range member after preview invalidates the complete selection", async () => {
  const db = reportsD1();
  await seed(db);
  const p = await planBulkReportRejection(db, {
    ...options([]), selector: { from: "2026-10-14T00:00:00Z", before: "2026-10-15T00:00:00Z" },
  });
  await seed(db, 1);
  await deniedWithoutWrites(db, () => execute(db, p));
});

test("bulk rejection: SQL failure after the first moderation update rolls back every row and audit", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  const p = await plan(db, ids);
  db.raw.exec(`CREATE TRIGGER test_bulk_failure BEFORE UPDATE ON report_moderation WHEN NEW.report_id='${p.targets.at(-1)!.reportId}' AND NEW.state='rejected' BEGIN SELECT RAISE(ABORT, 'TEST_ONLY_FAILURE'); END;`);
  const before = snapshot(db);
  await assert.rejects(execute(db, p));
  assert.equal(snapshot(db), before);
});

test("bulk rejection: lost commit response can be replayed without another audit or overwritten later decision", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  const p = await plan(db, ids);
  const lost: Db = { prepare: db.prepare.bind(db), batch: async (statements) => { await db.batch(statements); throw new Error("TEST_ONLY_LOST_RESPONSE"); } };
  assert.deepEqual(await execute(lost, p), { status: "alreadyApplied", count: ids.length, digest: p.digest });
  const after = snapshot(db);
  const replay = await execute(db, p);
  assert.equal(replay.status, "alreadyApplied");
  assert.equal(snapshot(db), after);
  await recordModerationDecision(db, ids[0], { state: "needsInfo", decidedBy: "reviewer-2", reason: "insufficientDetail", now: LATER });
  const changed = snapshot(db);
  assert.equal((await execute(db, p)).status, "alreadyApplied");
  assert.equal(snapshot(db), changed);
});

test("bulk rejection: concurrent duplicate application produces one operation", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  const p = await plan(db, ids);
  const results = await Promise.allSettled([execute(db, p), execute(db, p)]);
  assert.equal(results.every((r) => r.status === "fulfilled"), true);
  assert.deepEqual(results.map((r) => r.status === "fulfilled" ? r.value.status : "failed").sort(), ["alreadyApplied", "applied"]);
  assert.equal((await execute(db, p)).status, "alreadyApplied");
  assert.equal(moderation(db).every((r) => r.state === "rejected"), true);
});

test("bulk rejection: audit history is append-only, complete and does not copy private report fields", async () => {
  const db = reportsD1();
  const ids = await seed(db);
  const p = await plan(db, ids);
  await execute(db, p);
  const tables = ["report_bulk_rejections", "report_bulk_rejection_targets", "report_bulk_rejection_completions"];
  assert.deepEqual(tables.map((t) => rows(db, `SELECT * FROM ${t}`).length), [1, 2, 1]);
  const text = JSON.stringify(tables.map((t) => rows(db, `SELECT * FROM ${t}`)));
  for (const pii of [NOTE, INSTALL, "a".repeat(64), KEY, PEPPER, SPOT]) assert.equal(text.includes(pii), false, pii);
  const before = snapshot(db);
  for (const table of tables) {
    assert.throws(() => db.raw.exec(`UPDATE ${table} SET operation_id=operation_id`), /immutable/);
    assert.throws(() => db.raw.exec(`DELETE FROM ${table}`), /immutable/);
    assert.throws(() => db.raw.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /immutable/);
  }
  assert.equal(snapshot(db), before);
});

test("bulk rejection: key selector uses exact original pepper and canonical key bytes, never persists them", async () => {
  const db = reportsD1();
  const ids = await seed(db, 2, { key: KEY });
  await seed(db, 1);
  const opts = { ...options([]), selector: { keyRequired: true }, key: { keyId: KEY, pepper: PEPPER } };
  const before = snapshot(db);
  const p = await planBulkReportRejection(db, opts);
  assert.equal(snapshot(db), before);
  assert.deepEqual(p.targets.map((r) => r.reportId).sort(), ids.sort());
  const hash = await submitterHash(attestedSubmitter(KEY), PEPPER);
  for (const secret of [KEY, PEPPER, hash, NOTE, INSTALL]) assert.equal(JSON.stringify(p).includes(secret), false);
  await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...opts, key: { keyId: KEY, pepper: PEPPER.trim() } }));
  await deniedWithoutWrites(db, () => applyBulkReportRejection(db, p, { confirmation: p.digest, now: LATER }));
  await deniedWithoutWrites(db, () => applyBulkReportRejection(db, p, { confirmation: p.digest, now: LATER, key: { keyId: KEY, pepper: "wrong-test-pepper".repeat(3) } }));
  const result = await applyBulkReportRejection(db, p, { confirmation: p.digest, now: LATER, key: opts.key });
  assert.equal(result.count, 2);
  const audit = JSON.stringify(["report_bulk_rejections", "report_bulk_rejection_targets", "report_bulk_rejection_completions"].map((t) => rows(db, `SELECT * FROM ${t}`)));
  for (const secret of [KEY, PEPPER, hash, NOTE, INSTALL]) assert.equal(audit.includes(secret), false);
  assert.equal(moderation(db).filter((r) => r.state === "pending").length, 1);
});

test("bulk rejection: malformed or missing key never falls back to an unrestricted selection", async () => {
  const db = reportsD1();
  await seed(db, 2, { key: KEY });
  const opts = { ...options([]), selector: { keyRequired: true } };
  for (const key of [undefined, { keyId: KEY, pepper: String() }, { keyId: KEY, pepper: " ".repeat(40) },
    { keyId: KEY, pepper: "x".repeat(31) }, { keyId: "bad-base64", pepper: PEPPER },
    { keyId: btoa("31-byte-test-key".padEnd(31, "x")), pepper: PEPPER },
    { keyId: KEY.slice(0, -2) + "d=", pepper: PEPPER },
  ]) await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...opts, key }));
});

test("bulk rejection: minimized reports cannot be located by key, but explicit IDs remain moderated", async () => {
  const db = reportsD1();
  const ids = await seed(db, 1, { key: KEY, at: new Date("2026-06-01T00:00:00Z") });
  await applyReportRetention(db, { now: NOW });
  const opts = { ...options([]), selector: { keyRequired: true }, key: { keyId: KEY, pepper: PEPPER } };
  await deniedWithoutWrites(db, () => planBulkReportRejection(db, opts));
  const p = await plan(db, ids);
  assert.equal((await execute(db, p)).count, 1);
  assert.equal(rows(db, "SELECT submitter_hash, note FROM reports")[0].submitter_hash, null);
});

test("bulk rejection: bounded period is start-inclusive/end-exclusive and selectors intersect", async () => {
  const db = reportsD1();
  const inside = await seed(db, 1, { at: new Date("2026-10-14T00:00:00Z") });
  const end = await seed(db, 1, { at: new Date("2026-10-15T00:00:00Z") });
  const p = await planBulkReportRejection(db, { ...options([]), selector: { from: "2026-10-14T00:00:00Z", before: "2026-10-15T00:00:00Z" } });
  assert.deepEqual(p.targets.map((r) => r.reportId), inside);
  await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...options([...inside, ...end]), selector: { reportIds: [...inside, ...end], from: "2026-10-14T00:00:00Z", before: "2026-10-15T00:00:00Z" } }));
});

test("bulk rejection: a newly inserted range member between read and batch aborts the transaction", async () => {
  const db = reportsD1();
  await seed(db);
  const p = await planBulkReportRejection(db, { ...options([]), selector: { from: "2026-10-14T00:00:00Z", before: "2026-10-15T00:00:00Z" } });
  let concurrent: string | undefined;
  const gate = new BatchGate(db, async () => { await seed(db, 1); concurrent = snapshot(db); });
  await assert.rejects(execute(gate, p), BulkRejectionError);
  assert.equal(snapshot(db), concurrent);
  assert.equal(moderation(db).every((r) => r.state === "pending"), true);
});

test("bulk rejection: exact maximum is allowed and completed replay does not expire", async () => {
  const db = reportsD1();
  const ids = await seed(db, BULK_REJECTION_MAX);
  const p = await plan(db, ids);
  assert.equal((await execute(db, p)).count, BULK_REJECTION_MAX);
  const before = snapshot(db);
  assert.equal((await applyBulkReportRejection(db, p, { confirmation: p.digest, now: new Date("2026-10-16T00:00:00Z") })).status, "alreadyApplied");
  assert.equal(snapshot(db), before);
});

test("bulk rejection: a key-derived hash without verified App Attest cannot impersonate verified key reports", async () => {
  const db = reportsD1();
  const ids = await seed(db, 1, { key: KEY });
  const hash = await submitterHash(attestedSubmitter(KEY), PEPPER);
  const unverified = await createReport(db, { schemaVersion: 1, type: "exists", spotId: SPOT, installId: INSTALL }, {
    now: NOW, attestationStatus: "notProvided", submitterHash: hash,
  });
  const opts = { ...options([]), selector: { keyRequired: true }, key: { keyId: KEY, pepper: PEPPER } };
  const p = await planBulkReportRejection(db, opts);
  assert.deepEqual(p.targets.map((r) => r.reportId), ids);
  await applyBulkReportRejection(db, p, { confirmation: p.digest, now: LATER, key: opts.key });
  assert.equal(moderation(db).find((r) => r.report_id === unverified.reportId)!.state, "pending");
});

test("bulk rejection: invalid reason and operator identity are rejected before any DB access", async () => {
  let accesses = 0;
  const tripwire: Db = {
    prepare: () => { accesses++; throw new Error("TEST_ONLY_DB_ACCESS"); },
    batch: async () => { accesses++; throw new Error("TEST_ONLY_DB_ACCESS"); },
  };
  for (const invalid of [{ reason: "" }, { reason: "private free text" }, { decidedBy: "" }, { decidedBy: "contains spaces" }, { decidedBy: "x".repeat(65) }]) {
    await assert.rejects(planBulkReportRejection(tripwire, { ...options(["rp_" + "A".repeat(26)]), ...invalid } as any), BulkRejectionError);
    assert.equal(accesses, 0);
  }
});

test("bulk rejection: a JSON plan round-trip with omitted optional selector fields preserves its digest", async () => {
  const db = reportsD1();
  const ids = await seed(db, 1);
  const p = await planBulkReportRejection(db, {
    ...options(ids), selector: { reportIds: ids, from: undefined, before: undefined, keyRequired: false, states: undefined },
  });
  const saved = JSON.parse(JSON.stringify(p));
  assert.equal(saved.digest, p.digest);
  assert.equal((await execute(db, saved)).status, "applied");
  assert.equal(moderation(db)[0].state, "rejected");
});

test("bulk rejection: legacy moderator names or email cannot be copied into permanent audit", async () => {
  for (const decidedBy of ["TEST_ONLY_NAME WITH SPACES", "test-only@example.invalid"]) {
    const db = reportsD1();
    const ids = await seed(db, 1);
    await recordModerationDecision(db, ids[0], { state: "needsInfo", reason: "insufficientDetail", decidedBy, now: NOW });
    await deniedWithoutWrites(db, () => planBulkReportRejection(db, { ...options(ids), selector: { reportIds: ids, states: ["needsInfo"] } }));
    assert.equal(rows(db, "SELECT count(*) AS n FROM report_bulk_rejection_targets")[0].n, 0);
  }
});
