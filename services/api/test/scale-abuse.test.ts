// Correctness bounds, not wall-clock benchmarks. Raw reports stay in REPORTS_DB (ADR-0014).
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import type { DbStatement } from "../src/db.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { REPORT_RATE_LIMITS, consumeReportBudget } from "../src/reports/rate-limit.ts";
import { proposeNewSpotReview } from "../src/reports/review.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { SqliteD1, migratedReportsSqlite, reportsD1 } from "./support/sqlite-d1.ts";
const NOW = new Date("2026-10-02T03:30:00Z");
const PIN = { latitude: 35.69001, longitude: 139.70001 };
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";
const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
class ObservedReports extends SqliteD1 {
  queries: Array<{ sql: string; parameters: number }> = [];
  batches: number[] = [];
  override prepare(sql: string): DbStatement {
    const entry = { sql, parameters: 0 }; this.queries.push(entry);
    const stmt = super.prepare(sql); const bind = stmt.bind.bind(stmt);
    stmt.bind = (...values: unknown[]) => { entry.parameters = values.length; return bind(...values); };
    return stmt;
  }
  override async batch(statements: DbStatement[]): Promise<unknown[]> {
    this.batches.push(statements.length); return super.batch(statements);
  }
  reset(): void { this.queries = []; this.batches = []; }
}
async function missing(db: SqliteD1, hash: string, id: string) {
  return (await createReport(db, {
    schemaVersion: 1, type: "missing", installId: INSTALL, proposedLocation: PIN,
    acceptedTermsVersion: CURRENT_REPORT_TERMS.version, claim: { spotType: "ashtray" },
  }, { now: NOW, attestationStatus: "notProvided", submitterHash: hash, newReportId: () => id })).reportId;
}
test("intake statement and parameter bounds are unchanged by 1,000 reports; DATA_DB and external attest are unused", async () => {
  const db = new ObservedReports(migratedReportsSqlite());
  const unavailableData = { prepare(): never { throw new Error("intake touched DATA_DB"); }, async batch(): Promise<never> { throw new Error("intake wrote DATA_DB"); } };
  const traces: Array<{ queries: typeof db.queries; batches: number[] }> = [];
  let externalCalls = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { externalCalls++; throw new Error("external calls prohibited"); };
  try {
    for (const history of [0, 1000]) {
      if (history) for (let i = 0; i < history; i++) await missing(db, i.toString(16).padStart(64, "0"), `rp_${String(i).padStart(26, "0")}`);
      db.reset();
      const response = await app.request("/v1/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, type: "exists", installId: INSTALL, spotId: SPOT }) }, { DB: unavailableData, REPORTS_DB: db } as any);
      assert.equal(response.status, 201);
      traces.push({ queries: [...db.queries], batches: [...db.batches] });
      assert.ok(db.queries.length <= 8);
      assert.ok(db.queries.every((q) => q.parameters <= 25));
      assert.ok(db.batches.every((size) => size <= 3));
      assert.ok(db.queries.every((q) => !/count\s*\(|group\s+by|\bspots\b|\bcommunity_evidence\b/i.test(q.sql)), "no synchronous historical aggregation or canonical duplicate search");
    }
    assert.deepEqual(traces[0], traces[1]);
    assert.equal(externalCalls, 0); assert.equal(count(db, "reports"), 1002);
  } finally { globalThis.fetch = originalFetch; db.raw.close(); }
});
test("128 duplicate confirmations and repeated pins per submitter cannot bypass or extend their budgets", async () => {
  const db = reportsD1(); const hourly = REPORT_RATE_LIMITS.find((r) => r.kind === "hour")!;
  for (const [hash, type] of [["a".repeat(64), "exists"], ["b".repeat(64), "missing"]] as const) {
    for (let i = 0; i < 128; i++) {
      const decision = await consumeReportBudget(db, hash, NOW);
      assert.equal(decision.allowed, i < hourly.max);
      if (decision.allowed) await createReport(db, { schemaVersion: 1, type, installId: INSTALL, ...(type === "exists" ? { spotId: SPOT } : { proposedLocation: PIN }) }, { now: NOW, attestationStatus: "notProvided", submitterHash: hash });
    }
  }
  assert.equal(count(db, "reports"), hourly.max * 2); assert.equal(count(db, "report_moderation"), hourly.max * 2);
  const counters = db.raw.prepare("SELECT report_count FROM report_rate_windows").all() as { report_count: number }[];
  assert.ok(counters.every((r) => r.report_count === hourly.max));
  assert.equal((await consumeReportBudget(db, "c".repeat(64), NOW)).allowed, true);
  assert.equal((await consumeReportBudget(db, "a".repeat(64), new Date(NOW.getTime() + 3600_000))).allowed, true);
  db.raw.close();
});
test("64 accepted repeated pins cannot create verified evidence; a distinct reporter can corroborate", async () => {
  const db = reportsD1(); const ids: string[] = [];
  async function accepted(hash: string, id: string) {
    await missing(db, hash, id);
    await recordModerationDecision(db, id, { state: "accepted", decidedBy: "synthetic-reviewer", reason: "confirmed", now: NOW });
    await setReconciliationState(db, id, "queued", NOW); return id;
  }
  for (let i = 0; i < 64; i++) ids.push(await accepted("a".repeat(64), `rp_${String(i).padStart(26, "0")}`));
  await assert.rejects(proposeNewSpotReview(db, { reportIds: ids, locationReportId: ids[0], tier: "communityVerified", decidedBy: "synthetic-reviewer", now: NOW }), /not independent evidence/);
  assert.equal(count(db, "report_reviews"), 0, "failure leaves no review to export");
  const other = await accepted("b".repeat(64), `rp_${String(1000).padStart(26, "0")}`);
  await proposeNewSpotReview(db, { reportIds: [ids[0], other], locationReportId: ids[0], tier: "communityVerified", decidedBy: "synthetic-reviewer", now: NOW });
  assert.equal(count(db, "report_reviews"), 1); db.raw.close();
});
