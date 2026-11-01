// PoC A1 (src/poc/kv-photo): two-request upload, single-use tickets in D1, bytes in KV, every decision in D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { createApp } from "../src/app.ts";
import { registrationClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { sha256Hex } from "../src/db.ts";
import { attestedSubmitter, createReport, submitterHash } from "../src/reports/create.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { runRetentionMaintenance } from "../src/reports/retention-automation.ts";
import { queueDuePhotosForErasure } from "../src/poc/binary-photo/erasure.ts";
import { photoClientData } from "../src/poc/binary-photo/protocol.ts";
import { KV_PHOTOS_DB_SCHEMA, KvPhotoStore, type PhotoKv } from "../src/poc/kv-photo/kv-photo-store.ts";
import { PHOTO_INTENTS_SCHEMA, VOID_ISSUED_TICKETS_AFTER_RESTORE, handlePhotoIntent, handlePhotoUpload, photoIntentClientData } from "../src/poc/kv-photo/two-step.ts";
import { assert as makeAssertion, attest, type TestDevice, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { jpegReportsD1, photo } from "./support/binary-photo-harness.ts";
import { REGISTRATION_TEST_ENV } from "./support/registration-env.ts";
import { SqliteD1, withoutTrigger } from "./support/sqlite-d1.ts";

const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID,
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };

/** Workers KV stand-in: no conditional writes, optional failures and replication delay, expirations recorded. */
class FakeKv implements PhotoKv {
  readonly values = new Map<string, { bytes: Uint8Array; expiration: number }>();
  failPuts = 0; failDeletes = 0; invisible = false; puts = 0;
  onPut?: (key: string) => Promise<void>;
  async put(key: string, value: ArrayBuffer | Uint8Array, options: { expiration: number }) {
    this.puts++;
    if (this.failPuts > 0) { this.failPuts--; throw new Error("KV put failed (injected)"); }
    await this.onPut?.(key);
    this.values.set(key, { bytes: new Uint8Array(value).slice(), expiration: options.expiration });
  }
  async get(key: string) { if (this.invisible) return null; const v = this.values.get(key); return v ? v.bytes.slice().buffer : null; }
  async delete(key: string) { if (this.failDeletes > 0) { this.failDeletes--; throw new Error("KV delete failed (injected)"); } this.values.delete(key); }
}

async function setup() {
  const reports = jpegReportsD1();
  reports.raw.exec(PHOTO_INTENTS_SCHEMA);
  const ledgerDb = new DatabaseSync(":memory:"); ledgerDb.exec(KV_PHOTOS_DB_SCHEMA);
  const ledger = new SqliteD1(ledgerDb), kv = new FakeKv(), pki = await testPki();
  let current = new Date();
  const store = new KvPhotoStore(ledger, kv, () => current);
  const core = createApp({ now: () => current, appAttestTrustAnchor: pki.root });
  const env = { DB: new SqliteD1(), REPORTS_DB: reports, ...ENV };
  const opts = { now: () => current, store, photoTermsCovered: () => true, trustAnchor: pki.root };
  const app = new Hono();
  app.post("/v4/reports/:id/photo-intents", (c) => handlePhotoIntent(c.req.raw, c.req.param("id"), ENV, reports, opts));
  app.put("/v4/photo-uploads/:ticket", (c) => handlePhotoUpload(c.req.raw, c.req.param("ticket"), ENV, reports, opts));
  const postJson = (path: string, body: unknown) => core.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, env);
  const challenge = async (device: TestDevice, purpose: "registration" | "report") => ((await (await postJson("/v1/app-attest/challenges",
    { schemaVersion: 1, purpose, ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) })).json()) as { challenge: string }).challenge;
  const device = await testDevice(), ch = await challenge(device, "registration");
  const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
  assert.equal((await postJson("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(object) })).status, 201);
  const reportId = (await createReport(reports, { schemaVersion: 2, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J",
    installId: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version },
  { now: current, attestationStatus: "verified", submitterHash: await submitterHash(attestedSubmitter(device.keyIdBase64), ENV.REPORT_SUBMITTER_PEPPER) })).reportId;

  /** ① as the iPhone would send it; `claimed` lets a test attest other bytes than it uploads. */
  const intentBody = async (image: Uint8Array, o: { claimed?: Uint8Array; domain?: "intent" | "v3photo"; idempotencyKey?: string; challenge?: string } = {}) => {
    const claimed = o.claimed ?? image;
    const payload = utf8(JSON.stringify({ schemaVersion: 4, kind: "photoIntent", reportId, idempotencyKey: o.idempotencyKey ?? crypto.randomUUID(),
      acceptedTermsVersion: CURRENT_REPORT_TERMS.version, mediaType: "image/jpeg", byteLength: claimed.length, sha256: await sha256Hex(claimed) }));
    const c = o.challenge ?? await challenge(device, "report");
    const clientData = (o.domain ?? "intent") === "intent" ? photoIntentClientData(base64Decode(c)!, device.keyId, payload) : photoClientData(base64Decode(c)!, device.keyId, payload);
    const assertion = await makeAssertion(device, await sha256(clientData), { appId: APP_ID });
    return { schemaVersion: 4, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: c, assertion: base64Encode(assertion) } };
  };
  const intent = async (body: unknown) => {
    const res = await app.request(`/v4/reports/${reportId}/photo-intents`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    return { status: res.status, json: await res.json() as Record<string, string> };
  };
  const upload = async (ticket: string, bytes: Uint8Array) => {
    const res = await app.request(`/v4/photo-uploads/${ticket}`, { method: "PUT", body: bytes, headers: { "Content-Type": "image/jpeg" } });
    return { status: res.status, json: await res.json() as Record<string, string> };
  };
  const ticketFor = async (image: Uint8Array, o: Parameters<typeof intentBody>[1] = {}) => {
    const r = await intent(await intentBody(image, o)); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.ticket;
  };
  return { reports, ledger, kv, store, reportId, intentBody, intent, upload, ticketFor, setNow: (d: Date) => { current = d; }, now: () => current };
}

const photoRow = (t: Awaited<ReturnType<typeof setup>>) => t.reports.raw.prepare("SELECT storage_key, lifecycle FROM community_evidence_photos").all() as { storage_key: string; lifecycle: string }[];
const intentState = (t: Awaited<ReturnType<typeof setup>>) => (t.reports.raw.prepare("SELECT state FROM photo_upload_intents").all() as { state: string }[]).map((r) => r.state);

test("intent then upload stores the exact JPEG in KV with a ≤ 90-day expiration; the ledger in D1 holds no bytes", async () => {
  const t = await setup(), image = photo();
  const ticket = await t.ticketFor(image);
  const r = await t.upload(ticket, image);
  assert.equal(r.status, 201); assert.equal(r.json.state, "pending");
  const [row] = photoRow(t);
  assert.equal(row.lifecycle, "ready");
  const value = t.kv.values.get(row.storage_key)!;
  assert.deepEqual(value.bytes, image);
  const ninety = Math.floor(t.now().getTime() / 1000) + 90 * 86_400;
  assert.ok(value.expiration <= ninety && value.expiration > ninety - 5);
  assert.deepEqual(t.ledger.raw.prepare("PRAGMA table_info(kv_photo_objects)").all().map((c) => (c as { name: string }).name).filter((n) => /bytes$/.test(n)), []);
  const read = await t.store.read(row.storage_key);
  assert.equal(read.status, "available");
  assert.deepEqual(intentState(t), ["consumed"]);
});

test("a used ticket cannot be replayed, and parallel uses of one ticket store one photo", async () => {
  const t = await setup(), image = photo();
  const ticket = await t.ticketFor(image);
  const both = await Promise.all([t.upload(ticket, image), t.upload(ticket, image), t.upload(ticket, image)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal((await t.upload(ticket, image)).json.error, "ticketUsed");
  assert.equal(t.kv.values.size, 1);
  assert.equal((await t.store.usage()).writesToday, 1);
});

test("the ticket binds the attested bytes: other bytes, other length, EXIF and expired tickets are refused before anything is stored", async () => {
  const t = await setup(), image = photo(), other = image.slice(); other[other.length >> 1] ^= 1;
  assert.equal((await t.upload(await t.ticketFor(image), other)).json.detail, "image: digest_mismatch");
  const longer = photo(640, 480, 7); assert.notEqual(longer.length, image.length);
  assert.equal((await t.upload(await t.ticketFor(image), longer)).json.detail, "image: length_mismatch");
  assert.equal((await t.upload(await t.ticketFor(image), image.subarray(0, image.length - 1))).json.detail, "image: length_mismatch");
  // A refused body releases the claim: the same ticket still takes the attested bytes.
  const kept = await t.ticketFor(image);
  assert.equal((await t.upload(kept, other)).status, 400);
  assert.equal((await t.upload(kept, image)).status, 201);
  t.kv.values.clear(); t.kv.puts = 0;
  const withExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...image.subarray(2)]);
  const exif = await t.upload(await t.ticketFor(withExif), withExif);
  assert.equal(exif.status, 422); assert.match(exif.json.detail, /forbidden/i);
  const late = await t.ticketFor(image);
  t.setNow(new Date(t.now().getTime() + 5 * 60_000 + 1000));
  assert.equal((await t.upload(late, image)).status, 410);
  assert.equal((await t.upload("A".repeat(43), image)).status, 404);
  assert.equal(t.kv.values.size, 0); assert.equal(t.kv.puts, 0);
});

test("the intent assertion has its own domain and a challenge is single use", async () => {
  const t = await setup(), image = photo();
  const v3 = await t.intent(await t.intentBody(image, { domain: "v3photo" }));
  assert.equal(v3.status, 403);
  const body = await t.intentBody(image);
  assert.equal((await t.intent(body)).status, 201);
  assert.equal((await t.intent(body)).status, 403);
});

test("a failed KV put releases the ticket; the retry stores once and counts one KV write", async () => {
  const t = await setup(), image = photo();
  const ticket = await t.ticketFor(image);
  t.kv.failPuts = 1;
  const first = await t.upload(ticket, image);
  assert.equal(first.status, 503); assert.equal(first.json.error, "photoStoreUnavailable");
  assert.deepEqual(intentState(t), ["issued"]);
  assert.equal(photoRow(t)[0].lifecycle, "uploading");
  const again = await t.upload(ticket, image);
  assert.equal(again.status, 201);
  assert.equal(photoRow(t)[0].lifecycle, "ready");
  assert.equal((await t.store.usage()).writesToday, 1);
});

test("the D1 fence decides: a stale KV value after a failed KV.delete is never served and the key never takes a new put", async () => {
  const t = await setup(), image = photo();
  await t.upload(await t.ticketFor(image), image);
  const key = photoRow(t)[0].storage_key;
  t.kv.failDeletes = 1;
  await assert.rejects(t.store.delete(key), /KV delete failed/);
  assert.ok(t.kv.values.has(key), "the stale value is still in KV");
  assert.deepEqual(await t.store.read(key), { status: "deleted" });
  await assert.rejects(t.store.put(key, image, { contentSha256: await sha256Hex(image), byteLength: image.length }), /permanentlyDeleted/);
  await t.store.delete(key); // the retry removes it
  assert.ok(!t.kv.values.has(key));
  assert.equal((await t.store.usage()).liveCount, 0);
});

test("a delete that races a put leaves no KV value behind", async () => {
  const t = await setup(), image = photo(), key = "private/evidence/race.jpg";
  t.kv.onPut = async (k) => { t.kv.onPut = undefined; await t.store.delete(k); };
  await assert.rejects(t.store.put(key, image, { contentSha256: await sha256Hex(image), byteLength: image.length }), /permanentlyDeleted/);
  assert.ok(!t.kv.values.has(key));
});

test("KV replication delay or foreign bytes are reported as notVisible, never as the photo", async () => {
  const t = await setup(), image = photo();
  await t.upload(await t.ticketFor(image), image);
  const key = photoRow(t)[0].storage_key;
  t.kv.invisible = true;
  assert.deepEqual(await t.store.read(key), { status: "notVisible" });
  t.kv.invisible = false;
  t.kv.values.set(key, { bytes: photo(320, 240, 5), expiration: 1 });
  assert.deepEqual(await t.store.read(key), { status: "notVisible" });
});

test("the daily KV write cap and the byte budget pause intake with 503 and keep the ticket for a retry", async () => {
  const t = await setup(), image = photo();
  t.ledger.raw.exec("UPDATE kv_photo_usage SET daily_write_cap = 1");
  await t.upload(await t.ticketFor(image), image);
  const second = photo(320, 240, 3), ticket = await t.ticketFor(second);
  const paused = await t.upload(ticket, second);
  assert.equal(paused.status, 503); assert.equal(paused.json.error, "photoIntakePaused");
  assert.equal(t.kv.values.size, 1);
  t.ledger.raw.exec(`UPDATE kv_photo_usage SET daily_write_cap = 800, budget_bytes = ${image.length + 1}`);
  assert.equal((await t.upload(ticket, second)).json.error, "photoIntakePaused");
  t.ledger.raw.exec("UPDATE kv_photo_usage SET budget_bytes = 800000000");
  assert.equal((await t.upload(ticket, second)).status, 201);
});

test("intent rows are immutable where it matters and consumed is final", async () => {
  const t = await setup(), image = photo();
  await t.upload(await t.ticketFor(image), image);
  assert.throws(() => t.reports.raw.exec("UPDATE photo_upload_intents SET state = 'issued', claim_token = NULL"), /invalid transition/);
  assert.throws(() => t.reports.raw.exec("UPDATE photo_upload_intents SET content_sha256 = '" + "0".repeat(64) + "'"), /immutable/);
});

test("the existing retention pass erases the photo from KV inside the erasure lead and leaves a permanent fence", async () => {
  const t = await setup(), image = photo();
  await t.upload(await t.ticketFor(image), image);
  const key = photoRow(t)[0].storage_key;
  t.setNow(new Date(t.now().getTime() + 82 * 86_400_000)); // inside the −9 day lead of the 90-day deadline
  await queueDuePhotosForErasure(t.reports, t.now());
  const result = await runRetentionMaintenance(t.reports, { now: t.now(), mode: "cleanup", photoStorage: t.store as never });
  assert.equal(result.outcome, "complete");
  assert.ok(!t.kv.values.has(key));
  assert.deepEqual(await t.store.read(key), { status: "deleted" });
  assert.equal((await t.store.usage()).liveCount, 0);
});

/** Counts D1 round trips (one per first/all/run, one per batch) without changing what runs. */
function countTrips(db: { prepare: (sql: string) => unknown; batch: (s: never[]) => Promise<unknown[]> }) {
  const counter = { trips: 0, log: [] as string[] };
  const prepare = db.prepare.bind(db), batch = db.batch.bind(db);
  const wrap = (stmt: any): any => ({
    __inner: stmt,
    bind: (...v: unknown[]) => wrap(stmt.bind(...v)),
    first: () => { counter.trips++; counter.log.push(stmt.sql.trim().slice(0, 40)); return stmt.first(); },
    all: () => { counter.trips++; counter.log.push(stmt.sql.trim().slice(0, 40)); return stmt.all(); },
    run: () => { counter.trips++; counter.log.push(stmt.sql.trim().slice(0, 40)); return stmt.run(); },
  });
  (db as any).prepare = (sql: string) => wrap(prepare(sql));
  (db as any).batch = (s: any[]) => { counter.trips++; counter.log.push(`batch(${s.length})`); return batch(s.map((x) => x.__inner ?? x) as never[]); };
  return counter;
}

test("D1 round trips of one ② upload (REPORTS_DB + PHOTOS_DB), probe guards excluded", async () => {
  const t = await setup(), image = photo();
  const ticket = await t.ticketFor(image);
  const r = countTrips(t.reports as never), p = countTrips(t.ledger as never);
  assert.equal((await t.upload(ticket, image)).status, 201);
  console.log(`② trips: reports=${r.trips} photos=${p.trips}\n  ${[...r.log, "--", ...p.log].join("\n  ")}`);
  // Was 11 + 4 before the round-trip reduction (docs/release/V1_KV_PHOTO_A1_POC.md §7).
  assert.deepEqual([r.trips, p.trips], [4, 3]);
});

test("KV.put succeeds but the D1 ready update fails: nothing is served, the ticket retries, or retention removes the value", async () => {
  const t = await setup(), image = photo();
  const ticket = await t.ticketFor(image);
  const batch = t.reports.batch.bind(t.reports);
  let failReady = 1;
  t.reports.batch = async (s) => {
    if (failReady > 0 && s.some((x) => /SET lifecycle='ready'/.test((x as { sql: string }).sql))) { failReady--; throw new Error("D1 unavailable (injected)"); }
    return batch(s);
  };
  const first = await t.upload(ticket, image);
  assert.equal(first.status, 503); assert.equal(first.json.error, "photoStoreUnavailable");
  const [row] = photoRow(t);
  assert.equal(row.lifecycle, "uploading"); assert.ok(t.kv.values.has(row.storage_key));
  assert.deepEqual(intentState(t), ["issued"]); // the consume rolled back with the ready update
  assert.equal((await t.upload(ticket, image)).status, 201);
  assert.deepEqual(intentState(t), ["consumed"]);
  assert.equal((await t.store.usage()).writesToday, 1);

  // Without a retry: the abandoned upload expires (15 min) and the retention pass deletes the KV value and fences it.
  const u = await setup(), other = photo(320, 240, 9), ticket2 = await u.ticketFor(other);
  const batch2 = u.reports.batch.bind(u.reports);
  u.reports.batch = async (s) => {
    if (s.some((x) => /SET lifecycle='ready'/.test((x as { sql: string }).sql))) throw new Error("D1 unavailable (injected)");
    return batch2(s);
  };
  assert.equal((await u.upload(ticket2, other)).status, 503);
  const key = photoRow(u)[0].storage_key;
  u.setNow(new Date(u.now().getTime() + 16 * 60_000));
  assert.equal((await u.upload(ticket2, other)).status, 410); // the ticket expired too
  const result = await runRetentionMaintenance(u.reports, { now: u.now(), mode: "cleanup", photoStorage: u.store as never });
  assert.equal(result.outcome, "complete");
  assert.ok(!u.kv.values.has(key));
  assert.deepEqual(await u.store.read(key), { status: "deleted" });
});

test("a report past its photo deadline refuses the upload and the ticket stays dead", async () => {
  const t = await setup(), image = photo();
  const ticket = await t.ticketFor(image);
  t.setNow(new Date(t.now().getTime() + 4 * 60_000));
  withoutTrigger(t.reports.raw, "reports_only_redaction_updates", () =>
    t.reports.raw.prepare("UPDATE reports SET minimize_after = ?").run(new Date(t.now().getTime() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z")));
  const r = await t.upload(ticket, image);
  assert.equal(r.status, 410); assert.equal(r.json.error, "reportExpired");
  assert.equal(t.kv.puts, 0);
  assert.equal((await t.upload(ticket, image)).status, 409);
});

test("Time Travel: a rewound ticket cannot create a second photo, cannot revive a fenced key, dies after 5 min, and the restore runbook voids it", async () => {
  const t = await setup(), image = photo();
  const ticket = await t.ticketFor(image);
  assert.equal((await t.upload(ticket, image)).status, 201);
  // REPORTS_DB intent table rewound to before the upload (PHOTOS_DB, KV unchanged).
  const rewind = () => withoutTrigger(t.reports.raw, "photo_upload_intents_transitions", () => t.reports.raw.exec("UPDATE photo_upload_intents SET state = 'issued', claim_token = NULL"));
  rewind();
  assert.equal((await t.upload(ticket, image)).status, 201, "same attested bytes: idempotent");
  assert.equal(photoRow(t).length, 1); assert.equal(t.kv.values.size, 1); assert.equal((await t.store.usage()).writesToday, 1);
  // The photo was erased (fence) after the restore point: the rewound ticket does not bring it back.
  const key = photoRow(t)[0].storage_key;
  await t.store.delete(key); rewind();
  assert.equal((await t.upload(ticket, image)).status, 410);
  assert.ok(!t.kv.values.has(key)); assert.deepEqual(await t.store.read(key), { status: "deleted" });
  // Outside the 5-minute window a rewound ticket is dead.
  rewind(); t.setNow(new Date(t.now().getTime() + 5 * 60_000 + 1000));
  assert.equal((await t.upload(ticket, image)).status, 410);
  // A full REPORTS_DB rewind to before the upload WOULD let an unexpired ticket store its attested bytes again under a
  // new key, so the restore runbook voids every issued ticket first.
  const u = await setup(), ticket2 = await u.ticketFor(image);
  u.reports.raw.exec(VOID_ISSUED_TICKETS_AFTER_RESTORE);
  assert.equal((await u.upload(ticket2, image)).status, 409);
  assert.equal(u.kv.puts, 0);
});
