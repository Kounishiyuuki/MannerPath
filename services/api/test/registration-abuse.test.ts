// Registration controls use a real migrated report database and synthetic Apple-shaped PKI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { CHALLENGE_TTL_SECONDS, registerKey, issueChallenge, MAX_OUTSTANDING_REGISTRATION_CHALLENGES } from "../src/attest/store.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { assert as makeAssertion, attest, testDevice, testPki, type TestDevice } from "./support/app-attest-fixture.ts";
import { SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";

const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = {
  REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID,
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42",
  REPORT_SUBMITTER_PEPPER: "s".repeat(32), RATE_LIMIT_KEY_PEPPER: "r".repeat(32),
  REPORT_REGISTRATION: "enabled", REPORT_REGISTRATION_MAX_PER_HOUR: "2", REPORT_REGISTRATION_MAX_PER_DAY: "3",
};
type Row = Record<string, any>;
async function harness() {
  const db = reportsD1();
  const clock = { now: new Date() };
  const pki = await testPki(clock.now);
  const limiter = { success: true, outage: false, malformed: false, keys: [] as string[] };
  const env: Record<string, unknown> = { ...ENV, DB: new SqliteD1(), REPORTS_DB: db,
    CHALLENGE_RATE_LIMITER: { limit: async ({ key }: { key: string }) => {
      limiter.keys.push(key);
      if (limiter.outage) throw new Error("limiter down");
      return limiter.malformed ? {} : { success: limiter.success };
    } },
  };
  const app = createApp({ appAttestTrustAnchor: pki.root, now: () => clock.now });
  const post = (path: string, body: unknown, overrides: Record<string, unknown> = {}) => app.request(path, {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.19" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }, { ...env, ...overrides } as any);
  return { db, clock, pki, limiter, env, post };
}
type Harness = Awaited<ReturnType<typeof harness>>;
const count = (h: Harness, table: string) => (h.db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as Row).n;
async function challenge(h: Harness) {
  const res = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  const body = await res.json() as Row;
  assert.equal(new Date(body.expiresAt).getTime() - Math.floor(h.clock.now.getTime() / 1000) * 1000, 300_000);
  return body.challenge as string;
}
async function request(h: Harness, device: TestDevice, ch = "", appId = APP_ID) {
  ch ||= await challenge(h);
  const obj = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId, pki: h.pki, now: h.clock.now });
  return { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(obj) };
}
async function register(h: Harness, device?: TestDevice) {
  device ??= await testDevice();
  return h.post("/v1/app-attest/keys", await request(h, device));
}
async function error(res: Response, status: number, name: string) {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  assert.equal((await res.json() as Row).error, name);
}

test("successful registration budgets count verified unique keys, not invalid attempts or duplicates", async () => {
  const h = await harness();
  const device = await testDevice();
  assert.equal((await register(h, device)).status, 201);
  assert.equal((await register(h, device)).status, 409);
  const bad = await h.post("/v1/app-attest/keys", await request(h, await testDevice(), "", "ABCDE12345.com.example.other"));
  assert.equal(bad.status, 403);
  assert.equal((await register(h)).status, 201);
  const limited = await register(h);
  assert.equal(limited.headers.get("Retry-After"), "3600");
  await error(limited, 429, "registrationLimited");
  assert.equal(count(h, "app_attest_keys"), 2);
  assert.equal(CHALLENGE_TTL_SECONDS, 300);
});

test("rolling hourly and daily caps release slots exactly at their respective boundaries", async () => {
  const h = await harness();
  assert.equal((await register(h)).status, 201);
  assert.equal((await register(h)).status, 201);
  h.clock.now = new Date(h.clock.now.getTime() + 3_599_000);
  await error(await register(h), 429, "registrationLimited");
  h.clock.now = new Date(h.clock.now.getTime() + 1_000);
  assert.equal((await register(h)).status, 201);
  h.clock.now = new Date(h.clock.now.getTime() + 82_799_000);
  await error(await register(h), 429, "registrationLimited");
  h.clock.now = new Date(h.clock.now.getTime() + 1_000);
  assert.equal((await register(h)).status, 201);
});

test("concurrent callers cannot spend the same final global slot", async () => {
  const h = await harness();
  assert.equal((await register(h)).status, 201);
  const bodies = await Promise.all([request(h, await testDevice()), request(h, await testDevice())]);
  const results = await Promise.all(bodies.map(body => h.post("/v1/app-attest/keys", body)));
  assert.deepEqual(results.map(res => res.status).sort(), [201, 429]);
  assert.equal(count(h, "app_attest_keys"), 2);
});

test("retained keys remain duplicate registrations after their budget windows expire", async () => {
  const h = await harness();
  const device = await testDevice();
  const key = { keyId: device.keyIdBase64, publicKey: device.publicKey, environment: "production" as const };
  assert.equal(await registerKey(h.db, key, h.clock.now, { hour: 2, day: 3 }), "registered");
  h.clock.now = new Date(h.clock.now.getTime() + 86_400_000);
  assert.equal(await registerKey(h.db, key, h.clock.now, { hour: 2, day: 3 }), "alreadyRegistered");
  assert.equal(count(h, "app_attest_keys"), 1);
});

test("unset and paused registration fail before keys body parsing and do not burn preissued challenges", async () => {
  const h = await harness();
  const device = await testDevice();
  const body = await request(h, device);
  for (const value of [undefined, "paused"]) {
    const overrides = { REPORT_REGISTRATION: value };
    await error(await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" }, overrides), 503, "registrationPaused");
    await error(await h.post("/v1/app-attest/keys", "not JSON", overrides), 503, "registrationPaused");
    await error(await h.post("/v1/app-attest/keys", body, overrides), 503, "registrationPaused");
  }
  assert.equal((h.db.raw.prepare("SELECT consumed_at FROM app_attest_challenges").get() as Row).consumed_at, null);
  assert.equal((await h.post("/v1/app-attest/keys", body)).status, 201);
  const report = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 }, { REPORT_REGISTRATION: "paused" });
  assert.equal(report.status, 201);
});

test("noncanonical registration policies and absent limiter controls fail closed", async () => {
  const h = await harness();
  const cases = [
    { REPORT_REGISTRATION: "enable" }, { REPORT_REGISTRATION_MAX_PER_HOUR: undefined },
    ...["0", "-1", "01", "1.5", " 2", "2 ", "1e2", "9007199254740992"].map(value => ({ REPORT_REGISTRATION_MAX_PER_HOUR: value })),
    { REPORT_REGISTRATION_MAX_PER_DAY: "1" },
  ];
  for (const overrides of cases) {
    await error(await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" }, overrides), 503, "registrationMisconfigured");
    await error(await h.post("/v1/app-attest/keys", "not JSON", overrides), 503, "registrationMisconfigured");
  }
  for (const overrides of [{ CHALLENGE_RATE_LIMITER: undefined }, { RATE_LIMIT_KEY_PEPPER: undefined }]) {
    await error(await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" }, overrides), 503, "challengeBudgetMisconfigured");
    await error(await h.post("/v1/app-attest/keys", "not JSON", overrides), 503, "challengeBudgetMisconfigured");
  }
  assert.equal(count(h, "app_attest_challenges"), 0);
  assert.equal(count(h, "app_attest_keys"), 0);
});

test("key registration limiter refusal and outage happen before body parsing or challenge consumption", async () => {
  const h = await harness();
  const body = await request(h, await testDevice());
  const originalPrepare = h.db.prepare.bind(h.db);
  let d1Calls = 0;
  h.db.prepare = (...args: Parameters<typeof h.db.prepare>) => { d1Calls++; return originalPrepare(...args); };
  h.limiter.success = false;
  for (const input of ["not JSON", body]) await error(await h.post("/v1/app-attest/keys", input), 429, "challengeRateLimited");
  h.limiter.outage = true;
  for (const input of ["not JSON", body]) await error(await h.post("/v1/app-attest/keys", input), 503, "serviceUnavailable");
  assert.equal(d1Calls, 0, "limiter refusals never reach D1");
  assert.equal((h.db.raw.prepare("SELECT consumed_at FROM app_attest_challenges").get() as Row).consumed_at, null);
  assert.equal(count(h, "app_attest_keys"), 0);
  h.limiter.outage = false;
  h.limiter.malformed = true;
  await error(await h.post("/v1/app-attest/keys", body), 503, "serviceUnavailable");
  assert.equal(d1Calls, 0, "malformed limiter results never reach D1");
  h.limiter.malformed = false;
  h.limiter.success = true;
  assert.equal((await h.post("/v1/app-attest/keys", body)).status, 201);
  assert.ok(h.limiter.keys.every(key => /^[a-f0-9]{64}$/.test(key)));
  const dump = JSON.stringify([...h.db.raw.prepare("SELECT * FROM app_attest_challenges").all(), ...h.db.raw.prepare("SELECT * FROM app_attest_keys").all()]);
  assert.equal(dump.includes("203.0.113.19"), false);
  for (const key of h.limiter.keys) assert.equal(dump.includes(key), false);
});


test("production defaults pause registration even with valid App Attest configuration", async () => {
  const db = reportsD1();
  const app = createApp();
  for (const path of ["/v1/app-attest/challenges", "/v1/app-attest/keys"]) {
    const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, purpose: "registration" }) },
      { ...ENV, REPORT_REGISTRATION: undefined, RATE_LIMIT_KEY_PEPPER: undefined, DB: new SqliteD1(), REPORTS_DB: db } as any);
    await error(res, 503, "registrationPaused");
  }
  assert.equal((db.raw.prepare("SELECT count(*) AS n FROM app_attest_challenges").get() as Row).n, 0);
});


test("registration challenge floods are stopped before writing beyond the client budget", async () => {
  const h = await harness();
  let calls = 0;
  const overrides = { CHALLENGE_RATE_LIMITER: { limit: async () => ({ success: ++calls <= 2 }) } };
  const results = await Promise.all(Array.from({ length: 8 }, () => h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" }, overrides)));
  assert.deepEqual(results.map(res => res.status).sort(), [201, 201, 429, 429, 429, 429, 429, 429]);
  assert.equal(count(h, "app_attest_challenges"), 2);
});

test("the deployment challenge ceiling atomically grants only the final outstanding slot", async () => {
  const h = await harness();
  for (let i = 0; i < MAX_OUTSTANDING_REGISTRATION_CHALLENGES - 1; i++) {
    assert.notEqual(await issueChallenge(h.db, { purpose: "registration" }, h.clock.now), null);
  }
  const results = await Promise.all([issueChallenge(h.db, { purpose: "registration" }, h.clock.now), issueChallenge(h.db, { purpose: "registration" }, h.clock.now)]);
  assert.equal(results.filter(result => result !== null).length, 1);
  assert.equal(count(h, "app_attest_challenges"), MAX_OUTSTANDING_REGISTRATION_CHALLENGES);
});

test("concurrent registration of the same key spends one successful-registration slot", async () => {
  const h = await harness();
  const device = await testDevice();
  const bodies = await Promise.all([request(h, device), request(h, device)]);
  const results = await Promise.all(bodies.map(body => h.post("/v1/app-attest/keys", body)));
  assert.deepEqual(results.map(res => res.status).sort(), [201, 409]);
  assert.equal(count(h, "app_attest_keys"), 1);
  assert.equal((await register(h)).status, 201, "duplicate race did not spend the second slot");
  await error(await register(h), 429, "registrationLimited");
});

test("budget refusal burns its challenge and only a fresh challenge can retry after the window", async () => {
  const h = await harness();
  assert.equal((await register(h)).status, 201);
  assert.equal((await register(h)).status, 201);
  const device = await testDevice();
  const body = await request(h, device);
  await error(await h.post("/v1/app-attest/keys", body), 429, "registrationLimited");
  const row = h.db.raw.prepare("SELECT consumed_at FROM app_attest_challenges WHERE challenge = ?").get(body.challenge) as Row;
  assert.notEqual(row.consumed_at, null);
  const replay = await h.post("/v1/app-attest/keys", body);
  assert.equal(replay.status, 403);
  assert.equal((await replay.json() as Row).reason, "challengeInvalid");
  h.clock.now = new Date(h.clock.now.getTime() + 3_600_000);
  assert.equal((await register(h, device)).status, 201);
});

test("an already registered key can submit a verified report while registration is paused", async () => {
  const h = await harness();
  const device = await testDevice();
  assert.equal((await register(h, device)).status, 201);
  const overrides = { REPORT_REGISTRATION: "paused" };
  const res = await h.post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 }, overrides);
  assert.equal(res.status, 201);
  const ch = (await res.json() as Row).challenge;
  const payload = utf8(JSON.stringify({ schemaVersion: 2, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", acceptedTermsVersion: CURRENT_REPORT_TERMS.version }));
  const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, payload)), { appId: APP_ID });
  const submitted = await h.post("/v1/reports", { schemaVersion: 2, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } }, overrides);
  assert.equal(submitted.status, 201, JSON.stringify(await submitted.clone().json()));
  assert.equal(count(h, "reports"), 1);
  assert.equal((h.db.raw.prepare("SELECT attestation_status FROM reports").get() as Row).attestation_status, "verified");
});
