// POST /v1/reports: payload minimization, the abuse boundary, the attestation boundary and the
// guarantee that a submission is a proposal, not a canonical mutation (ADR-0007, docs/API.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import type { AttestationVerifier } from "../src/reports/attestation.ts";
import { REPORT_BODY_MAX_BYTES, ReportAcceptedV1 } from "../src/reports/dto.ts";
import { REPORT_RATE_LIMITS } from "../src/reports/rate-limit.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];

const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";

const post = (db: SqliteD1, body: unknown, env: Record<string, unknown> = {}) =>
  app.request(
    "/v1/reports",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) },
    { DB: db, ...env },
  );

const existsReport = (extra: Record<string, unknown> = {}) =>
  ({ schemaVersion: 1, type: "exists", spotId: SPOT, installId: INSTALL, ...extra });

test("a valid report is stored as a pending proposal and the response reveals nothing else", async () => {
  const db = new SqliteD1();
  const res = await post(db, existsReport({ observedOn: "2026-09-19", note: "灰皿ありました" }));
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("Cache-Control"), "no-store");

  const body = ReportAcceptedV1.parse(await res.json());
  assert.deepEqual(Object.keys(body), ["schemaVersion", "reportId", "state", "receivedAt"]);
  assert.equal(body.state, "pending", "acceptance is a later human decision, never a submission response");

  const row = one(db, "SELECT * FROM reports WHERE report_id = ?", body.reportId);
  assert.equal(row.report_type, "exists");
  assert.equal(row.subject_spot_id, SPOT);
  assert.equal(row.observed_on, "2026-09-19");
  assert.equal(row.note, "灰皿ありました");
  assert.equal(row.attestation_status, "notProvided");
  assert.equal(row.redacted_at, null);
  assert.ok(row.minimize_after > row.received_at);
  // The raw install identifier is never stored; only its hash is.
  assert.match(row.submitter_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes(INSTALL), false);

  const moderation = one(db, "SELECT * FROM report_moderation WHERE report_id = ?", body.reportId);
  assert.equal(moderation.state, "pending");
  assert.equal(moderation.reconciliation_state, "notQueued");
  assert.equal(moderation.decided_at, null);
});

test("a location proposal is quantized to ~1m and only the location types may send one", async () => {
  const db = new SqliteD1();
  const missing = await post(db, {
    schemaVersion: 1, type: "missing", installId: INSTALL,
    proposedLocation: { latitude: 35.711234567, longitude: 139.773771234 },
  });
  assert.equal(missing.status, 201);
  const row = one(db, "SELECT proposed_latitude, proposed_longitude, subject_spot_id FROM reports");
  assert.equal(row.proposed_latitude, 35.71123);
  assert.equal(row.proposed_longitude, 139.77377);
  assert.equal(row.subject_spot_id, null);

  const rejected = await post(db, existsReport({ proposedLocation: { latitude: 35.7, longitude: 139.7 } }));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json() as Row).error, "invalidReport");
});

test("invalid payloads are rejected and the error never echoes a submitted value", async () => {
  const db = new SqliteD1();
  const cases: Array<[string, unknown]> = [
    ["unknown field", existsReport({ deviceLocation: { latitude: 35.7, longitude: 139.7 } })],
    ["missing installId", { schemaVersion: 1, type: "exists", spotId: SPOT }],
    ["unknown report type", existsReport({ type: "smokedHere" })],
    ["spotId on a missing report", { schemaVersion: 1, type: "missing", spotId: SPOT, installId: INSTALL, proposedLocation: { latitude: 35.7, longitude: 139.7 } }],
    ["missing report without a location", { schemaVersion: 1, type: "missing", installId: INSTALL }],
    ["moved report without a location", existsReport({ type: "moved" })],
    ["note over 280 characters", existsReport({ note: "あ".repeat(281) })],
    ["observedOn with a time of day", existsReport({ observedOn: "2026-09-19T12:30:00Z" })],
    ["malformed spot id", existsReport({ spotId: "sp_not-an-id" })],
    ["a future schema version", existsReport({ schemaVersion: 2 })],
    ["a non-object body", "[]"],
  ];
  for (const [name, payload] of cases) {
    const res = await post(db, payload);
    assert.equal(res.status, 400, name);
    const body = await res.json() as Row;
    assert.equal(body.error, "invalidReport", name);
    assert.equal(body.detail.includes("あ"), false, name);
    assert.equal(body.detail.includes(INSTALL), false, name);
    assert.equal(body.detail.includes("smokedHere"), false, name);
  }
  assert.equal(one(db, "SELECT count(*) AS n FROM reports").n, 0, "no invalid report was stored");
});

test("malformed JSON and oversized bodies are refused before parsing", async () => {
  const db = new SqliteD1();
  const bad = await post(db, "{not json");
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as Row).error, "invalidJson");

  const huge = JSON.stringify(existsReport({ note: "x".repeat(REPORT_BODY_MAX_BYTES) }));
  const res = await post(db, huge);
  assert.equal(res.status, 413);
  assert.equal((await res.json() as Row).error, "reportTooLarge");
  assert.equal(one(db, "SELECT count(*) AS n FROM reports").n, 0);
});

test("an unknown or unpublished spot id is accepted exactly like a known one", async () => {
  const db = new SqliteD1();
  const unknown = await post(db, existsReport({ spotId: "sp_00000000000000000000000001" }));
  assert.equal(unknown.status, 201);
  const known = await post(db, existsReport());
  assert.equal(known.status, 201);
  const [a, b] = await Promise.all([unknown.json(), known.json()]) as Row[];
  // Identical shape and state: the endpoint must not tell a client which spots exist.
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.equal(a.state, b.state);
});

test("the per-install hourly budget refuses further reports with Retry-After and writes nothing", async () => {
  const db = new SqliteD1();
  const hourly = REPORT_RATE_LIMITS.find((l) => l.kind === "hour")!;
  for (let i = 0; i < hourly.max; i++) assert.equal((await post(db, existsReport())).status, 201, `report ${i + 1}`);

  const refused = await post(db, existsReport());
  assert.equal(refused.status, 429);
  assert.equal((await refused.json() as Row).error, "reportRateLimited");
  const retryAfter = Number(refused.headers.get("Retry-After"));
  assert.ok(retryAfter > 0 && retryAfter <= hourly.windowSeconds, `Retry-After ${retryAfter}`);
  assert.equal(one(db, "SELECT count(*) AS n FROM reports").n, hourly.max);

  // A different install has its own budget, and counters are keyed only on the hashed submitter.
  const other = await post(db, existsReport({ installId: "11111111-2222-3333-4444-555555555555" }));
  assert.equal(other.status, 201);
  const windows = all(db, "SELECT DISTINCT submitter_hash FROM report_rate_windows");
  assert.equal(windows.length, 2);
  for (const w of windows) assert.match(w.submitter_hash, /^[0-9a-f]{64}$/);
});

test("attestation: required fails closed, a verifier decides, and no material is ever stored", async () => {
  const accepting: AttestationVerifier = { async verify() { return true; } };
  const rejecting: AttestationVerifier = { async verify() { return false; } };
  const attestation = { keyId: "key-abc", assertion: "YXNzZXJ0aW9u", challenge: "chal-123" };

  const closed = new SqliteD1();
  const unavailable = await post(closed, existsReport({ attestation }), { REPORT_ATTESTATION: "required" });
  assert.equal(unavailable.status, 503, "required attestation with no verifier must not degrade to accepting");
  assert.equal((await unavailable.json() as Row).error, "attestationUnavailable");
  assert.equal(one(closed, "SELECT count(*) AS n FROM reports").n, 0);

  const missing = await post(closed, existsReport(), { REPORT_ATTESTATION: "required", ATTESTATION: accepting });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json() as Row).error, "attestationInvalid");

  const denied = await post(closed, existsReport({ attestation }), { REPORT_ATTESTATION: "required", ATTESTATION: rejecting });
  assert.equal(denied.status, 400);
  assert.equal(one(closed, "SELECT count(*) AS n FROM reports").n, 0);

  const db = new SqliteD1();
  assert.equal((await post(db, existsReport({ attestation }), { REPORT_ATTESTATION: "required", ATTESTATION: accepting })).status, 201);
  // Policy disabled: an attestation is accepted by the schema, never trusted, and dropped.
  assert.equal((await post(db, existsReport({ attestation })).then((r) => r.status)), 201);
  const statuses = all(db, "SELECT attestation_status FROM reports ORDER BY received_at, report_id").map((r) => r.attestation_status);
  assert.deepEqual([...statuses].sort(), ["unverified", "verified"]);

  const dump = JSON.stringify(all(db, "SELECT * FROM reports"));
  for (const secret of [attestation.keyId, attestation.assertion, attestation.challenge]) {
    assert.equal(dump.includes(secret), false, `attestation material ${secret} must not be persisted`);
  }
});

test("a report submission logs nothing", async () => {
  const db = new SqliteD1();
  const captured: unknown[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { captured.push(...args); };
  try {
    await post(db, existsReport({ note: "секрет", observedOn: "2026-09-19" }));
    await post(db, { schemaVersion: 1, type: "bogus", installId: INSTALL });
  } finally {
    methods.forEach((m, i) => { console[m] = originals[i]!; });
  }
  assert.deepEqual(captured, [], "report payloads and validation failures must not be logged");
});
