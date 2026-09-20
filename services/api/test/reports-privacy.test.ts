// Report immutability, retention/minimization, moderation state and the canonical-data boundary
// (ADR-0007 §1, §2, §4). These exercise the database contract and the moderation module directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { isoSeconds } from "../src/db.ts";
import { REPORT_MINIMIZE_AFTER_DAYS, createReport, minimizeAfter, submitterHash } from "../src/reports/create.ts";
import { listModerationQueue, recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];

const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";
const AT = new Date("2026-09-21T03:00:00Z");
const HASH = "a".repeat(64);

async function storeReport(db: SqliteD1, overrides: Record<string, unknown> = {}, now = AT): Promise<string> {
  const request = { schemaVersion: 1 as const, type: "exists" as const, spotId: SPOT, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: "灰皿あり", observedOn: "2026-09-19", ...overrides } as any;
  const { reportId } = await createReport(db, request, { now, attestationStatus: "notProvided", submitterHash: HASH });
  return reportId;
}

test("a stored report cannot be rewritten into a different claim", async () => {
  const db = new SqliteD1();
  const id = await storeReport(db);
  const update = (sql: string, ...p: any[]) => () => db.raw.prepare(sql).run(...p, id);

  assert.throws(update("UPDATE reports SET report_type = 'prohibited' WHERE report_id = ?"), /immutable proposals/);
  assert.throws(update("UPDATE reports SET subject_spot_id = NULL WHERE report_id = ?"), /immutable proposals/);
  assert.throws(update("UPDATE reports SET note = 'rewritten' WHERE report_id = ?"), /immutable proposals/);
  assert.throws(update("UPDATE reports SET attestation_status = 'verified' WHERE report_id = ?"), /immutable proposals/);
  assert.throws(update("UPDATE reports SET received_at = '2020-01-01T00:00:00Z' WHERE report_id = ?"), /immutable proposals/);
  assert.throws(update("UPDATE reports SET minimize_after = '2099-01-01T00:00:00Z' WHERE report_id = ?"), /immutable proposals/);
  // Clearing one personal column without recording the redaction is a half-redaction, not allowed.
  assert.throws(update("UPDATE reports SET note = NULL WHERE report_id = ?"), /immutable proposals/);

  assert.equal(one(db, "SELECT note FROM reports WHERE report_id = ?", id).note, "灰皿あり");
});

test("retention minimizes personal content after 90 days whatever the moderation state", async () => {
  const db = new SqliteD1();
  const due = await storeReport(db, { type: "moved", proposedLocation: { latitude: 35.7112, longitude: 139.77377 } });
  const fresh = await storeReport(db, {}, new Date(AT.getTime() + 86_400_000));
  const decided = await storeReport(db);
  await recordModerationDecision(db, decided, { state: "accepted", decidedBy: "reviewer-1", now: AT });

  const later = new Date(minimizeAfter(AT).getTime() + 1000);
  assert.equal(REPORT_MINIMIZE_AFTER_DAYS, 90);
  const result = await applyReportRetention(db, { now: later });
  assert.equal(result.redactedReports, 2, "the pending and the accepted report are both due");

  for (const id of [due, decided]) {
    const row = one(db, "SELECT * FROM reports WHERE report_id = ?", id);
    assert.equal(row.note, null);
    assert.equal(row.observed_on, null);
    assert.equal(row.proposed_latitude, null);
    assert.equal(row.proposed_longitude, null);
    assert.equal(row.submitter_hash, null);
    assert.equal(row.redacted_at, isoSeconds(later));
    // The non-personal skeleton survives, so counts and abuse statistics stay honest.
    assert.equal(row.report_type === "moved" || row.report_type === "exists", true);
    assert.equal(row.subject_spot_id !== undefined, true);
    assert.equal(row.received_at, isoSeconds(AT));
  }
  assert.equal(one(db, "SELECT note FROM reports WHERE report_id = ?", fresh).note, "灰皿あり", "a fresh report is untouched");
  // Moderation state survives minimization: the queue stays auditable.
  assert.equal(one(db, "SELECT state FROM report_moderation WHERE report_id = ?", decided).state, "accepted");

  // A second pass is a no-op; redaction is one-way and cannot be re-applied or undone.
  assert.equal((await applyReportRetention(db, { now: later })).redactedReports, 0, "nothing is redacted twice");
  assert.throws(
    () => db.raw.prepare("UPDATE reports SET redacted_at = NULL WHERE report_id = ?").run(due),
    /immutable proposals/,
  );
});

test("expired rate-limit counters are purged by the retention pass", async () => {
  const db = new SqliteD1();
  db.raw.prepare(
    "INSERT INTO report_rate_windows (submitter_hash, window_kind, window_start, report_count, expires_at) VALUES (?, 'hour', ?, 3, ?)",
  ).run(HASH, isoSeconds(AT), isoSeconds(new Date(AT.getTime() + 3600_000)));
  const result = await applyReportRetention(db, { now: new Date(AT.getTime() + 7200_000) });
  assert.equal(result.purgedRateWindows, 1);
  assert.equal(all(db, "SELECT * FROM report_rate_windows").length, 0);
});

test("the submitter hash depends on the pepper and never contains the install id", async () => {
  const installId = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
  const plain = await submitterHash(installId, undefined);
  const peppered = await submitterHash(installId, "deployment-pepper");
  assert.match(plain, /^[0-9a-f]{64}$/);
  assert.notEqual(plain, peppered);
  assert.equal(await submitterHash(installId.toUpperCase(), undefined), plain, "case-insensitive UUID");
});

test("moderation state is explicit and acceptance alone never queues reconciliation", async () => {
  const db = new SqliteD1();
  const id = await storeReport(db);

  // Reconciliation cannot start from a pending report.
  await assert.rejects(setReconciliationState(db, id, "queued", AT), /CHECK constraint failed/);

  await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer-1", note: "写真と一致", now: AT });
  let row = one(db, "SELECT * FROM report_moderation WHERE report_id = ?", id);
  assert.equal(row.state, "accepted");
  assert.equal(row.reconciliation_state, "notQueued", "accepted is a judgement, not evidence");
  assert.equal(row.decided_by, "reviewer-1");

  await setReconciliationState(db, id, "queued", AT);
  assert.equal(one(db, "SELECT reconciliation_state FROM report_moderation WHERE report_id = ?", id).reconciliation_state, "queued");

  assert.throws(
    () => db.raw.prepare("UPDATE report_moderation SET state = 'pending', decided_at = NULL, decided_by = NULL WHERE report_id = ?").run(id),
    /cannot return to pending/,
  );

  const rejected = await storeReport(db);
  await recordModerationDecision(db, rejected, { state: "rejected", decidedBy: "reviewer-1", now: AT });
  await assert.rejects(setReconciliationState(db, rejected, "queued", AT), /CHECK constraint failed/);
});

test("the moderation queue shows the claim, never the submitter", async () => {
  const db = new SqliteD1();
  const id = await storeReport(db);
  await storeReport(db, {}, new Date(AT.getTime() + 1000)).then((other) =>
    recordModerationDecision(db, other, { state: "duplicate", decidedBy: "reviewer-1", now: AT }));

  const pending = await listModerationQueue(db, { state: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.report_id, id);
  assert.equal(pending[0]!.note, "灰皿あり");
  assert.equal(Object.keys(pending[0]!).includes("submitter_hash"), false);
  assert.equal(JSON.stringify(pending).includes(HASH), false);
  assert.equal((await listModerationQueue(db)).length, 2);
});

test("reports never mutate canonical or published data", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  await publishTiles(db, { now: NOW });
  const canonical = () => JSON.stringify([
    all(db, "SELECT * FROM spots ORDER BY spot_id"),
    all(db, "SELECT * FROM spot_field_provenance ORDER BY spot_id, field"),
    all(db, "SELECT * FROM tile_snapshots ORDER BY tile_id"),
    all(db, "SELECT * FROM tile_snapshot_spots ORDER BY spot_id"),
    all(db, "SELECT * FROM source_records ORDER BY record_id"),
  ]);
  const before = canonical();
  const publishedId = one(db, "SELECT spot_id FROM tile_snapshot_spots LIMIT 1").spot_id;

  const res = await app.request(
    "/v1/reports",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, type: "prohibited", spotId: publishedId, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: "撤去されていました" }),
    },
    { DB: db },
  );
  assert.equal(res.status, 201);
  const { reportId } = await res.json() as Row;
  await recordModerationDecision(db, reportId, { state: "accepted", decidedBy: "reviewer-1", now: AT });
  await setReconciliationState(db, reportId, "queued", AT);
  await applyReportRetention(db, { now: new Date(minimizeAfter(AT).getTime() + 1000) });

  assert.equal(canonical(), before, "accepting, queuing and minimizing a report changes no canonical row");
  // The report tables are a separate space: no foreign key ties a report to a canonical spot.
  const fks = all(db, "SELECT * FROM pragma_foreign_key_list('reports')");
  assert.deepEqual(fks, []);
});
