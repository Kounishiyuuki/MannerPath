import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, moderationQueuePage } from "../src/reports/moderation.ts";
import { triageQueuePage } from "../src/reports/triage.ts";
import { applyReportRetention, runReportRetention } from "../src/reports/retention.ts";
import { listNewSpotCandidates, listExistingSpotQueue } from "../src/reports/review.ts";
import { correctionCandidates, duplicateCandidates, duplicateCandidatePage } from "../src/pipeline/community-evidence.ts";

const NOW = new Date("2026-09-21T03:00:00Z");
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";
let sequence = 0;
async function report(db: ReturnType<typeof reportsD1>, type = "exists", at = NOW, hash = "a".repeat(64)) {
  return (await createReport(db, { schemaVersion: 1, type, spotId: type === "missing" ? undefined : SPOT,
    proposedLocation: type === "moved" || type === "missing" ? { latitude: 35.69, longitude: 139.70 } : undefined,
    installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: "private" } as any,
    { now: at, attestationStatus: "notProvided", submitterHash: hash,
      newReportId: () => `rp_${String(++sequence).padStart(26, "0")}` })).reportId;
}

test("moderation tied timestamps traverse once and retention resumes/retries bounded batches", async () => {
  const db = reportsD1();
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(await report(db));
  let cursor: string | undefined;
  const seen: string[] = [];
  do {
    const page = await moderationQueuePage(db, { limit: 2, cursor });
    seen.push(...page.items.map((r) => r.report_id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(seen, ids);
  await assert.rejects(moderationQueuePage(db, { cursor: "bad" }), /invalid/);
  const now = new Date("2027-01-01T00:00:00Z");
  const first = await applyReportRetention(db, { now, limit: 2 });
  assert.equal(first.redactedReports, 2);
  assert.equal(first.hasMore, true);
  const next = await applyReportRetention(db, { now, limit: 2, cursor: first.nextCursor! });
  assert.equal(next.redactedReports, 2);
  const retry = await applyReportRetention(db, { now, limit: 2, cursor: first.nextCursor! });
  assert.equal(retry.redactedReports, 2, "retry safely processes the next still-unredacted rows");
  assert.equal((await runReportRetention(db, { now, batchSize: 2 })).redactedReports, 1);
  assert.equal((await runReportRetention(db, { now })).redactedReports, 0);
});

test("triage age fairness, priorities, inserts fence, and changed-state cursor refusal", async () => {
  const db = reportsD1();
  const data = new SqliteD1();
  const old = await report(db, "hoursChanged", new Date("2026-09-01T00:00:00Z"));
  const moved = await report(db, "moved");
  const exists = await report(db);
  await report(db, "missing");
  await report(db, "hoursChanged");
  const first = await triageQueuePage(db, data, { now: NOW, limit: 2 });
  assert.deepEqual(first.items.map((r) => [r.reportId, r.priority]), [[old, "P0"], [moved, "P0"]]);
  const inserted = await report(db);
  const second = await triageQueuePage(db, data, { now: NOW, limit: 2, cursor: first.nextCursor! });
  assert.equal(second.items[0].reportId, exists);
  assert.ok(!second.items.some((r) => r.reportId === inserted));
  await recordModerationDecision(db, exists, { state: "accepted", decidedBy: "reviewer", now: NOW });
  await assert.rejects(triageQueuePage(db, data, { now: NOW, limit: 2, cursor: first.nextCursor! }), /stale/);
  await assert.rejects(triageQueuePage(db, data, { now: NOW, limit: 2, cursor: "bad" }), /cursor|JSON|character/);
});

test("same-submitter queue counts stay independent and new-spot groups explicitly page-local", async () => {
  const db = reportsD1();
  for (let i = 0; i < 4; i++) {
    const id = await report(db);
    await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer", now: NOW });
    await db.prepare("UPDATE report_moderation SET reconciliation_state = 'queued' WHERE report_id = ?").bind(id).run();
  }
  const queue = await listExistingSpotQueue(db, { now: NOW, limit: 1 });
  assert.equal(queue[0].reportCount, 4);
  assert.equal(queue[0].independentSubmitters, 1);
  assert.equal((await listExistingSpotQueue(db, { now: NOW, cursor: queue[0].cursor })).length, 0);
  for (let i = 0; i < 3; i++) {
    const id = await report(db, "missing");
    await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer", now: NOW });
    await db.prepare("UPDATE report_moderation SET reconciliation_state = 'queued' WHERE report_id = ?").bind(id).run();
  }
  const groups = await listNewSpotCandidates(db, { now: NOW, withinMetres: 50, limit: 2 });
  assert.equal(groups[0].scope, "pageLocal");
  assert.equal(groups[0].reportIds.length, 2);
  assert.equal(groups[0].distinctSubmitters, 1);
  assert.ok(groups[0].nextReportId);
  const next = await listNewSpotCandidates(db, { now: NOW, withinMetres: 50, limit: 2, afterReportId: groups[0].nextReportId! });
  assert.equal(next[0].reportIds.length, 1);
});

test("dense duplicate output declares truncation; complete correction groups are never silently split", async () => {
  const db = reportsD1();
  const data = new SqliteD1();
  for (let i = 0; i < 205; i++) await report(db, "missing");
  const duplicates = await duplicateCandidates(db, data, { now: NOW, limit: 1 });
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].nearbyReports.length, 200);
  assert.equal(duplicates[0].nearbyReportsTruncated, true);
  for (let i = 0; i < 3; i++) {
    const id = await report(db, "moved", NOW, String(i).repeat(64));
    await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer", now: NOW });
  }
  const corrections = await correctionCandidates(db, data, { now: NOW, limit: 1 });
  assert.equal(corrections[0].reports, 3, "limit pages subjects, not their evidence");
  assert.equal(corrections[0].distinctSubmitters, 3);
});

test("independent accepted negatives put conflicting confirmations in P0; empty duplicate pages still advance", async () => {
  const db = reportsD1();
  const data = new SqliteD1();
  const positive = await report(db);
  const negative = (await createReport(db, { schemaVersion: 2, type: "notFound", spotId: SPOT } as any,
    { now: NOW, attestationStatus: "notProvided", submitterHash: "b".repeat(64),
      newReportId: () => `rp_${String(++sequence).padStart(26, "0")}` })).reportId;
  await recordModerationDecision(db, negative, { state: "accepted", decidedBy: "reviewer", now: NOW });
  const page = await triageQueuePage(db, data, { now: NOW });
  assert.equal(page.items.find((r) => r.reportId === positive)!.priority, "P0");
  for (let i = 0; i < 3; i++) await createReport(db, { schemaVersion: 1, type: "missing",
    proposedLocation: { latitude: 35 + i, longitude: 139 } } as any,
    { now: NOW, attestationStatus: "notProvided", submitterHash: "a".repeat(64), newReportId: () => `rp_${String(++sequence).padStart(26, "0")}` });
  const empty = await duplicateCandidatePage(db, data, { now: NOW, limit: 1 });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.scanned, 1);
  assert.ok(empty.nextCursor);
  const next = await duplicateCandidatePage(db, data, { now: NOW, limit: 1, cursor: empty.nextCursor! });
  assert.equal(next.scanned, 1);
  assert.notEqual(next.nextCursor, empty.nextCursor);
});


test("duplicate spatial probe starts at the indexed pin range rather than the nationwide moderation queue", async () => {
  const db = reportsD1(), data = new SqliteD1();
  const id = await report(db, "missing");
  let probe = "";
  const audited = {
    prepare(sql: string) { if (sql.includes("r.report_id <> ?")) probe = sql; return db.prepare(sql); },
    batch: db.batch.bind(db),
  };
  await duplicateCandidates(audited, data, { now: NOW, limit: 1 });
  const pad = (50 / 111_000) * 2;
  const plan = db.raw.prepare("EXPLAIN QUERY PLAN " + probe).all(NOW.toISOString().slice(0,19)+"Z", id,
    35.69-pad, 35.69+pad, 139.70-pad*1.5, 139.70+pad*1.5) as { detail: string }[];
  assert.ok(plan.some((r) => /SEARCH r USING INDEX reports_proposal_spatial/.test(r.detail)));
  assert.ok(!plan.some((r) => /SEARCH m USING INDEX report_moderation_queue/.test(r.detail)));
});
