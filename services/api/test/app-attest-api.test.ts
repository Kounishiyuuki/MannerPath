// The App Attest report protocol end to end over HTTP (ADR-0007 §6, docs/API.md): challenges,
// key registration, request-bound assertions, replay and counter protection, and the guarantee
// that only a verified assertion can store a report. The device is synthetic
// (test/support/app-attest-fixture.ts) and its PKI is injected through createApp — the one place
// a trust anchor other than Apple's can enter, and not reachable from any binding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { CHALLENGE_TTL_SECONDS, MAX_OUTSTANDING_REPORT_CHALLENGES_PER_KEY } from "../src/attest/store.ts";
import { ReportAcceptedV2 } from "../src/reports/dto.ts";
import { REPORT_RATE_LIMITS } from "../src/reports/rate-limit.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { type TestDevice, type TestPki, assert as makeAssertion, attest, testDevice, testPki } from "./support/app-attest-fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production" };
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const SPOT = "sp_01V64NN31G72E5KJJ5W22W1A1J";

const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as Row).n as number;

interface Harness {
  db: SqliteD1;
  pki: TestPki;
  clock: { now: Date };
  post: (path: string, body: unknown, env?: Record<string, string>) => Promise<Response>;
}

async function harness(): Promise<Harness> {
  const db = new SqliteD1();
  const pki = await testPki();
  const clock = { now: new Date() };
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => clock.now });
  const post = (path: string, body: unknown, env: Record<string, string> = ENV) => app.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) },
    { DB: db, ...env } as any,
  );
  return { db, pki, clock, post };
}

async function challenge(h: Harness, body: Record<string, unknown>): Promise<string> {
  const res = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, ...body });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return ((await res.json()) as Row).challenge;
}

async function register(h: Harness, device: TestDevice, opts: Partial<Parameters<typeof attest>[2]> = {}): Promise<Response> {
  const ch = await challenge(h, { purpose: "registration" });
  const cdh = await sha256(registrationClientData(base64Decode(ch)!, device.keyId));
  const attestationObject = await attest(device, cdh, { appId: APP_ID, pki: h.pki, ...opts });
  return h.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(attestationObject) });
}

async function registered(h: Harness): Promise<TestDevice> {
  const device = await testDevice();
  const res = await register(h, device);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return device;
}

const reportPayload = (extra: Record<string, unknown> = {}) =>
  utf8(JSON.stringify({ schemaVersion: 2, type: "exists", spotId: SPOT, installId: INSTALL, ...extra }));

/** Builds a v2 submission the way the iPhone client must: challenge → exact bytes → assertion. */
async function submission(h: Harness, device: TestDevice, payload = reportPayload(), opts: { challenge?: string; counter?: number } = {}) {
  const ch = opts.challenge ?? await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  const cdh = await sha256(reportClientData(base64Decode(ch)!, device.keyId, payload));
  const assertion = await makeAssertion(device, cdh, { appId: APP_ID, counter: opts.counter });
  return {
    schemaVersion: 2,
    payload: base64Encode(payload),
    attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) },
  };
}

async function rejection(res: Response, status = 403) {
  assert.equal(res.status, status);
  const body = await res.json() as Row;
  return body;
}

// ---- Challenges ---------------------------------------------------------------------------------

test("challenges are 32 random bytes with a short expiry and an explicit purpose", async () => {
  const h = await harness();
  const res = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json() as Row;
  assert.deepEqual(Object.keys(body).sort(), ["challenge", "expiresAt", "purpose", "schemaVersion"]);
  assert.equal(base64Decode(body.challenge)!.length, 32);
  assert.equal(body.purpose, "registration");
  assert.equal(new Date(body.expiresAt).getTime() - Math.floor(h.clock.now.getTime() / 1000) * 1000, CHALLENGE_TTL_SECONDS * 1000);
  const again = await challenge(h, { purpose: "registration" });
  assert.notEqual(again, body.challenge, "never reissued");

  // A report challenge is issued only to a registered key.
  const stranger = await testDevice();
  assert.equal((await rejection(await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: stranger.keyIdBase64 }))).reason, "keyNotRegistered");
  for (const bad of [{ schemaVersion: 1, purpose: "anything" }, { schemaVersion: 1, purpose: "registration", keyId: stranger.keyIdBase64 }, { schemaVersion: 1, purpose: "report" }, { purpose: "registration" }]) {
    assert.equal((await h.post("/v1/app-attest/challenges", bad)).status, 400, JSON.stringify(bad));
  }
});

test("challenge issuance is capped per key, so an unauthenticated caller cannot fill D1", async () => {
  const h = await harness();
  const device = await registered(h);
  for (let i = 0; i < MAX_OUTSTANDING_REPORT_CHALLENGES_PER_KEY; i++) await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  const limited = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), String(CHALLENGE_TTL_SECONDS));
  // Once they expire the key can get new ones; expired rows are purged by the retention pass.
  h.clock.now = new Date(h.clock.now.getTime() + (CHALLENGE_TTL_SECONDS + 1) * 1000);
  await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  const before = count(h.db, "app_attest_challenges");
  const retention = await applyReportRetention(h.db, { now: h.clock.now });
  assert.equal(retention.purgedAttestChallenges, before - 1);
  assert.equal(count(h.db, "app_attest_challenges"), 1, "only the live challenge survives");
});

// ---- Registration -------------------------------------------------------------------------------

test("registration happy path stores only the key, its public key, environment and a zero counter", async () => {
  const h = await harness();
  const device = await testDevice();
  const res = await register(h, device);
  assert.equal(res.status, 201);
  const body = await res.json() as Row;
  assert.deepEqual(Object.keys(body).sort(), ["keyId", "registeredAt", "schemaVersion"]);
  assert.equal(body.keyId, device.keyIdBase64);

  const row = h.db.raw.prepare("SELECT * FROM app_attest_keys").get() as Row;
  assert.deepEqual(Object.keys(row).sort(), ["environment", "key_id", "public_key", "registered_at", "sign_count"]);
  assert.equal(row.key_id, device.keyIdBase64);
  assert.equal(row.public_key, Buffer.from(device.publicKey).toString("hex"));
  assert.equal(row.environment, "production");
  assert.equal(row.sign_count, 0);
  // The attestation object, certificates and receipt are not stored anywhere.
  const dump = JSON.stringify(h.db.raw.prepare("SELECT * FROM app_attest_challenges").all());
  assert.equal(dump.includes("receipt"), false);

  // Registering the same key again is a conflict, not a second row.
  assert.equal((await register(h, device)).status, 409);
  assert.equal(count(h.db, "app_attest_keys"), 1);
});

test("registration rejects every attestation that fails an Apple check, and stores nothing", async () => {
  const h = await harness();
  const cases: Array<[string, (d: TestDevice) => Promise<Response>, string]> = [
    ["invalid root", async (d) => {
      const other = await testPki();
      return register(h, d, { pki: other });
    }, "untrustedChain"],
    ["wrong app identity", (d) => register(h, d, { appId: "ABCDE12345.com.example.other" }), "appIdMismatch"],
    ["wrong team", (d) => register(h, d, { appId: "ZZZZZ99999.com.example.mannerpath" }), "appIdMismatch"],
    ["development key in production", (d) => register(h, d, { environment: "development" }), "environmentMismatch"],
    ["credentialId is another key's", (d) => register(h, d, { credentialId: new Uint8Array(32).fill(3) }), "keyIdMismatch"],
    ["certified key is not the COSE key", (d) => register(h, d, { coseX: new Uint8Array(32).fill(4) }), "keyIdMismatch"],
    ["nonce bound to other data", (d) => register(h, d, { nonceOverride: new Uint8Array(32) }), "nonceMismatch"],
  ];
  for (const [name, run, detail] of cases) {
    const body = await rejection(await run(await testDevice()));
    assert.equal(body.error, "attestationRejected", name);
    assert.equal(body.reason, "attestationInvalid", name);
    assert.equal(body.detail, detail, name);
  }

  // The key ID the client submits must be the attested key's.
  const device = await testDevice();
  const imposter = await testDevice();
  const ch = await challenge(h, { purpose: "registration" });
  const cdh = await sha256(registrationClientData(base64Decode(ch)!, imposter.keyId));
  const obj = await attest(device, cdh, { appId: APP_ID, pki: h.pki });
  const mismatch = await rejection(await h.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: imposter.keyIdBase64, challenge: ch, attestationObject: base64Encode(obj) }));
  assert.equal(mismatch.detail, "keyIdMismatch");

  // Malformed attestation objects.
  for (const garbage of [utf8("not cbor"), new Uint8Array(0x10)]) {
    const c = await challenge(h, { purpose: "registration" });
    const body = await rejection(await h.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: c, attestationObject: base64Encode(garbage) }));
    assert.equal(body.detail, "malformed");
  }
  assert.equal(count(h.db, "app_attest_keys"), 0, "no key is registered until every check passed");
});

test("registration challenges are single-use, expire, and cannot cross purposes", async () => {
  const h = await harness();
  const device = await testDevice();

  // Reused: the first use (even a failed one) burns it.
  const ch = await challenge(h, { purpose: "registration" });
  const cdh = await sha256(registrationClientData(base64Decode(ch)!, device.keyId));
  const bad = await attest(device, cdh, { appId: "ABCDE12345.com.example.other", pki: h.pki });
  const good = await attest(device, cdh, { appId: APP_ID, pki: h.pki });
  const send = (obj: Uint8Array, c = ch) => h.post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: c, attestationObject: base64Encode(obj) });
  assert.equal((await rejection(await send(bad))).reason, "attestationInvalid");
  const reused = await rejection(await send(good));
  assert.equal(reused.reason, "challengeInvalid");
  assert.equal(reused.detail, "challenge alreadyConsumed");

  // Expired.
  const late = await challenge(h, { purpose: "registration" });
  const lateObj = await attest(device, await sha256(registrationClientData(base64Decode(late)!, device.keyId)), { appId: APP_ID, pki: h.pki });
  h.clock.now = new Date(h.clock.now.getTime() + (CHALLENGE_TTL_SECONDS + 1) * 1000);
  assert.equal((await rejection(await send(lateObj, late))).detail, "challenge expired");

  // Unknown (client-invented).
  const invented = base64Encode(new Uint8Array(32).fill(0x42));
  const inventedObj = await attest(device, await sha256(registrationClientData(base64Decode(invented)!, device.keyId)), { appId: APP_ID, pki: h.pki });
  assert.equal((await rejection(await send(inventedObj, invented))).detail, "challenge unknown");

  // A report challenge used for registration.
  const owner = await registered(h);
  const reportCh = await challenge(h, { purpose: "report", keyId: owner.keyIdBase64 });
  const crossObj = await attest(device, await sha256(registrationClientData(base64Decode(reportCh)!, device.keyId)), { appId: APP_ID, pki: h.pki });
  assert.equal((await rejection(await send(crossObj, reportCh))).detail, "challenge wrongPurpose");

  assert.equal(count(h.db, "app_attest_keys"), 1, "only the separately registered owner key exists");
});

// ---- Attested reports ---------------------------------------------------------------------------

test("an attested report is stored as verified, with nothing linking it to the key", async () => {
  const h = await harness();
  const device = await registered(h);
  const res = await h.post("/v1/reports", await submission(h, device));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  const body = ReportAcceptedV2.parse(await res.json());
  assert.equal(body.state, "pending");

  const row = h.db.raw.prepare("SELECT * FROM reports WHERE report_id = ?").get(body.reportId) as Row;
  assert.equal(row.schema_version, 2);
  assert.equal(row.attestation_status, "verified");
  assert.equal(row.subject_spot_id, SPOT);
  const stored = JSON.stringify(row);
  assert.equal(stored.includes(device.keyIdBase64), false, "the report does not reference the key");
  assert.equal(stored.includes(INSTALL), false);
  assert.equal((h.db.raw.prepare("SELECT sign_count FROM app_attest_keys").get() as Row).sign_count, 1);
  assert.equal((h.db.raw.prepare("SELECT state FROM report_moderation WHERE report_id = ?").get(body.reportId) as Row).state, "pending");
});

test("the assertion binds the exact payload bytes: the same assertion over another body is refused", async () => {
  const h = await harness();
  const device = await registered(h);
  const signed = await submission(h, device, reportPayload({ note: "灰皿あり" }));
  for (const tampered of [
    reportPayload({ note: "灰皿なし" }),
    reportPayload({ type: "prohibited" }),
    // Same meaning, different bytes: key order and whitespace are part of what is signed.
    utf8(JSON.stringify({ type: "exists", schemaVersion: 2, spotId: SPOT, installId: INSTALL, note: "灰皿あり" })),
    utf8(new TextDecoder().decode(base64Decode(signed.payload)!) + " "),
  ]) {
    const fresh = await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
    // Re-sign the original bytes for the fresh challenge, then swap in the tampered payload.
    const original = await submission(h, device, base64Decode(signed.payload)!, { challenge: fresh });
    const body = await rejection(await h.post("/v1/reports", { ...original, payload: base64Encode(tampered) }));
    assert.equal(body.reason, "assertionInvalid");
    assert.equal(body.detail, "signature");
  }
  assert.equal(count(h.db, "reports"), 0);
  assert.equal((await h.post("/v1/reports", signed)).status, 201, "the untampered submission still verifies");
});

test("replay: a challenge is used once, and a stale or equal counter is refused", async () => {
  const h = await harness();
  const device = await registered(h);
  const first = await submission(h, device);
  assert.equal((await h.post("/v1/reports", first)).status, 201);

  // The identical request again: the challenge is gone.
  const replay = await rejection(await h.post("/v1/reports", first));
  assert.equal(replay.reason, "challengeInvalid");
  assert.equal(replay.detail, "challenge alreadyConsumed");

  // A fresh challenge with a counter that did not advance (equal), or went back.
  for (const counter of [1, 0]) {
    const body = await rejection(await h.post("/v1/reports", await submission(h, device, reportPayload(), { counter })));
    assert.equal(body.reason, "counterNotIncreasing", `counter ${counter}`);
  }
  // A higher counter — including a jump, as after assertions the server never saw — is accepted.
  assert.equal((await h.post("/v1/reports", await submission(h, device, reportPayload(), { counter: 7 }))).status, 201);
  assert.equal((h.db.raw.prepare("SELECT sign_count FROM app_attest_keys").get() as Row).sign_count, 7);
  assert.equal(count(h.db, "reports"), 2);
});

test("challenges cannot cross purposes, keys or time", async () => {
  const h = await harness();
  const device = await registered(h);
  const other = await registered(h);

  // A registration challenge used as a report challenge.
  const registration = await challenge(h, { purpose: "registration" });
  assert.equal((await rejection(await h.post("/v1/reports", await submission(h, device, reportPayload(), { challenge: registration })))).detail, "challenge wrongPurpose");

  // Another key's report challenge.
  const theirs = await challenge(h, { purpose: "report", keyId: other.keyIdBase64 });
  assert.equal((await rejection(await h.post("/v1/reports", await submission(h, device, reportPayload(), { challenge: theirs })))).detail, "challenge wrongKey");

  // A client-invented challenge.
  const invented = base64Encode(crypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await rejection(await h.post("/v1/reports", await submission(h, device, reportPayload(), { challenge: invented })))).detail, "challenge unknown");

  // An expired one.
  const late = await submission(h, device);
  h.clock.now = new Date(h.clock.now.getTime() + (CHALLENGE_TTL_SECONDS + 1) * 1000);
  assert.equal((await rejection(await h.post("/v1/reports", late))).detail, "challenge expired");

  assert.equal(count(h.db, "reports"), 0);
  assert.equal((h.db.raw.prepare("SELECT max(sign_count) AS n FROM app_attest_keys").get() as Row).n, 0, "no counter moved");
});

test("concurrent replay: of two requests racing on one challenge or one counter, exactly one stores", async () => {
  const h = await harness();
  const device = await registered(h);

  // Same challenge, submitted twice at once.
  const same = await submission(h, device);
  const raced = await Promise.all([h.post("/v1/reports", same), h.post("/v1/reports", same)]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [201, 403]);
  assert.equal(count(h.db, "reports"), 1);

  // Two different challenges, both signed with the same counter: whichever commits first wins, the
  // other loses the counter — whether the verifier or the database trigger catches it.
  const a = await submission(h, device, reportPayload({ note: "a" }), { counter: 5 });
  const b = await submission(h, device, reportPayload({ note: "b" }), { counter: 5 });
  const both = await Promise.all([h.post("/v1/reports", a), h.post("/v1/reports", b)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 403]);
  const loser = both.find((r) => r.status === 403)!;
  assert.equal((await loser.json() as Row).reason, "counterNotIncreasing");
  assert.equal(count(h.db, "reports"), 2);
  assert.equal((h.db.raw.prepare("SELECT sign_count FROM app_attest_keys").get() as Row).sign_count, 5);
});

test("the database refuses a non-increasing counter even when the verifier is bypassed", async () => {
  const h = await harness();
  const device = await registered(h);
  const update = (n: number) => h.db.raw.prepare("UPDATE app_attest_keys SET sign_count = ? WHERE key_id = ?").run(n, device.keyIdBase64);
  update(3);
  assert.throws(() => update(3), /sign_count must strictly increase/);
  assert.throws(() => update(2), /sign_count must strictly increase/);
  assert.throws(() => h.db.raw.prepare("UPDATE app_attest_keys SET public_key = ? WHERE key_id = ?").run("04" + "00".repeat(64), device.keyIdBase64), /key material is immutable/);
  assert.throws(() => h.db.raw.prepare("INSERT INTO app_attest_keys VALUES (?, ?, 'production', 9, '2026-01-01T00:00:00Z')").run(base64Encode(new Uint8Array(32)), "04" + "11".repeat(64)), /sign_count 0/);

  // The report insert and the counter advance are one transaction: a lost race stores no report.
  const before = count(h.db, "reports");
  const ch = await challenge(h, { purpose: "report", keyId: device.keyIdBase64 });
  const consumed = h.db.raw.prepare("UPDATE app_attest_challenges SET consumed_at = ? WHERE challenge = ?");
  consumed.run("2026-01-01T00:00:00Z", ch);
  assert.throws(() => consumed.run("2026-01-01T00:00:01Z", ch), /consumed exactly once/);
  assert.equal(count(h.db, "reports"), before);
});

test("malformed attestation material is rejected without storing a report or moving a counter", async () => {
  const h = await harness();
  const device = await registered(h);
  // Each case gets its own fresh submission (issuing all of them up front would hit the per-key
  // challenge cap), and each consumes or never reaches a challenge.
  const cases: Array<[string, () => Promise<unknown>, number, string?]> = [
    ["assertion is not CBOR", async () => {
      const s = await submission(h, device);
      return { ...s, attestation: { ...s.attestation, assertion: base64Encode(utf8("junk")) } };
    }, 403, "assertionInvalid"],
    ["assertion is not base64", async () => {
      const s = await submission(h, device);
      return { ...s, attestation: { ...s.attestation, assertion: "!!!!" } };
    }, 400],
    ["key ID is not 32 bytes", async () => {
      const s = await submission(h, device);
      return { ...s, attestation: { ...s.attestation, keyId: base64Encode(new Uint8Array(16)) } };
    }, 400],
    ["non-canonical base64 payload", async () => {
      const s = await submission(h, device);
      return { ...s, payload: s.payload.replace(/=+$/, "") };
    }, 400],
    ["unknown envelope field", async () => ({ ...(await submission(h, device)), extra: true }), 400],
    ["missing attestation", async () => ({ schemaVersion: 2, payload: (await submission(h, device)).payload }), 400],
    ["payload is not a report", () => submission(h, device, utf8(JSON.stringify({ schemaVersion: 2, type: "bogus", installId: INSTALL }))), 400],
    ["payload is v1-shaped", () => submission(h, device, utf8(JSON.stringify({ schemaVersion: 1, type: "exists", spotId: SPOT, installId: INSTALL }))), 400],
    ["payload is not JSON", () => submission(h, device, utf8("not json")), 400],
  ];
  for (const [name, build, status, reason] of cases) {
    const res = await h.post("/v1/reports", await build());
    assert.equal(res.status, status, name);
    if (reason !== undefined) assert.equal((await res.json() as Row).reason, reason, name);
    // Keep the per-key cap clear: whatever the case left outstanding expires before the next one.
    h.clock.now = new Date(h.clock.now.getTime() + (CHALLENGE_TTL_SECONDS + 1) * 1000);
  }
  assert.equal(count(h.db, "reports"), 0);
  assert.equal((h.db.raw.prepare("SELECT sign_count FROM app_attest_keys").get() as Row).sign_count, 0);
});

test("required mode stores only verified submissions and refuses unattested v1 reports", async () => {
  const h = await harness();
  const v1 = await h.post("/v1/reports", { schemaVersion: 1, type: "exists", spotId: SPOT, installId: INSTALL });
  assert.equal(v1.status, 400);
  assert.equal((await v1.json() as Row).error, "reportSchemaUnsupported");
  // An unregistered key cannot sign its way in.
  const stranger = await testDevice();
  const res = await h.post("/v1/reports", await submission(h, await registered(h), reportPayload()).then((s) => ({ ...s, attestation: { ...s.attestation, keyId: stranger.keyIdBase64 } })));
  assert.equal((await rejection(res)).reason, "challengeInvalid", "the challenge belonged to another key");
  assert.equal(count(h.db, "reports"), 0);
  const statuses = new Set((h.db.raw.prepare("SELECT attestation_status FROM reports").all() as Row[]).map((r) => r.attestation_status));
  assert.equal(statuses.has("notProvided"), false);
});

test("App Attest endpoints are unavailable outside required mode, and a bad policy still fails closed", async () => {
  const h = await harness();
  for (const env of [{}, { REPORT_ATTESTATION: "disabled" }, { REPORT_ATTESTATION: "required" }, { REPORT_ATTESTATION: "enabled", REPORT_APP_ATTEST_APP_ID: APP_ID, REPORT_APP_ATTEST_ENVIRONMENT: "production" }]) {
    for (const path of ["/v1/app-attest/challenges", "/v1/app-attest/keys"]) {
      const res = await h.post(path, { schemaVersion: 1, purpose: "registration" }, env as any);
      assert.equal(res.status, 503, `${path} ${JSON.stringify(env)}`);
      assert.equal((await res.json() as Row).error, "attestationUnavailable");
    }
  }
  // Disabled mode keeps the local unattested workflow.
  const local = await h.post("/v1/reports", { schemaVersion: 1, type: "exists", spotId: SPOT, installId: INSTALL }, {});
  assert.equal(local.status, 201);
  assert.equal((h.db.raw.prepare("SELECT attestation_status FROM reports").get() as Row).attestation_status, "notProvided");
  assert.equal(count(h.db, "app_attest_challenges"), 0);
});

test("the per-install rate limit still applies to attested reports, after verification", async () => {
  const h = await harness();
  const device = await registered(h);
  const hourly = REPORT_RATE_LIMITS.find((l) => l.kind === "hour")!;
  for (let i = 0; i < hourly.max; i++) assert.equal((await h.post("/v1/reports", await submission(h, device))).status, 201, `report ${i + 1}`);
  const limited = await h.post("/v1/reports", await submission(h, device));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json() as Row).error, "reportRateLimited");
  assert.equal(count(h.db, "reports"), hourly.max);
  // The refused request advanced no counter: the next valid assertion still has a higher one.
  assert.equal((h.db.raw.prepare("SELECT sign_count FROM app_attest_keys").get() as Row).sign_count, hourly.max);
});

test("a lost response leaves consistent state: the retry is refused, and nothing is stored twice", async () => {
  // The server stored the report, consumed the challenge and advanced the counter, and then the
  // response was lost. Resending the identical request can never store a second copy; the client
  // must treat the first POST as possibly accepted (docs/API.md "Ambiguous delivery").
  const h = await harness();
  const device = await registered(h);
  const sent = await submission(h, device);
  assert.equal((await h.post("/v1/reports", sent)).status, 201); // response "lost"
  const retry = await rejection(await h.post("/v1/reports", sent));
  assert.equal(retry.reason, "challengeInvalid");
  assert.equal(count(h.db, "reports"), 1);
  assert.equal((h.db.raw.prepare("SELECT sign_count FROM app_attest_keys").get() as Row).sign_count, 1);
});

test("attestation material and report content are never logged", async () => {
  const h = await harness();
  const captured: unknown[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { captured.push(...args); };
  try {
    const device = await registered(h);
    await h.post("/v1/reports", await submission(h, device, reportPayload({ note: "секрет" })));
    await h.post("/v1/reports", { ...(await submission(h, device)), payload: base64Encode(utf8("junk")) });
    await register(h, await testDevice(), { appId: "ABCDE12345.com.example.other" });
  } finally {
    methods.forEach((m, i) => { console[m] = originals[i]!; });
  }
  assert.deepEqual(captured, []);
});
