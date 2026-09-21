// App Attest attestation and assertion verification against Apple's documented procedure
// (src/attest/verify.ts). The first test replays Apple's own sample attestation object from the
// "Attestation Object Validation Guide" through the real pinned Apple root: it is genuine Apple
// output, so it proves the chain, nonce, key-ID, RP-ID, aaguid, COSE and extension handling are
// right for Apple's encoding, not just for our fixture's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPLE_APP_ATTEST_ROOT_DER } from "../src/attest/apple-root.ts";
import { base64Decode, concat, hex, sha256, utf8 } from "../src/attest/bytes.ts";
import { CborError, decodeCbor } from "../src/attest/cbor.ts";
import { ACCEPTED_VALIDATION_CATEGORIES, verifyAssertion, verifyAttestation } from "../src/attest/verify.ts";
import { assert as makeAssertion, attest, cbor, testDevice, testPki } from "./support/app-attest-fixture.ts";

// Apple's example: appIDPrefix 1234567890, bundle com.example.myapp, keyId below, and the sample
// passes the raw challenge bytes as clientDataHash (the guide's "expected clientDataHash" is
// authData ‖ "example_server_challenge").
const APPLE_SAMPLE = base64Decode(readFileSync(new URL("./support/apple-sample-attestation.b64", import.meta.url), "utf8").trim())!;
const APPLE_KEY_ID = base64Decode("zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=")!;
const APPLE_APP_ID = "1234567890.com.example.myapp";
const APPLE_CLIENT_DATA_HASH = utf8("example_server_challenge");
// Inside the sample credential certificate's validity window (2026-04-20T18:13:12Z – 04-23).
const APPLE_SAMPLE_NOW = new Date("2026-04-21T12:00:00Z");

const appleInput = (overrides: Partial<Parameters<typeof verifyAttestation>[0]> = {}) => ({
  attestationObject: APPLE_SAMPLE,
  keyId: APPLE_KEY_ID,
  clientDataHash: APPLE_CLIENT_DATA_HASH,
  appId: APPLE_APP_ID,
  environment: "production" as const,
  now: APPLE_SAMPLE_NOW,
  trustAnchor: APPLE_APP_ATTEST_ROOT_DER,
  // The sample reports category 1 (an OS executable), which a real MannerPath build never does;
  // widen the policy for this vector only, and check separately that the default refuses it.
  acceptedValidationCategories: [1],
  ...overrides,
});

test("the pinned root is Apple's App Attestation Root CA, byte for byte", async () => {
  assert.equal(
    hex(await sha256(APPLE_APP_ATTEST_ROOT_DER)),
    "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932",
  );
});

test("Apple's sample attestation verifies through the pinned Apple root", async () => {
  const result = await verifyAttestation(appleInput());
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.validationCategory, 1);
  assert.equal(hex(await sha256(result.publicKey)), hex(APPLE_KEY_ID), "the stored public key is the one the key ID names");
});

test("Apple's sample is refused on every binding it does not satisfy", async () => {
  const cases: Array<[string, Partial<Parameters<typeof verifyAttestation>[0]>, string]> = [
    ["a different challenge binding", { clientDataHash: utf8("another_challenge") }, "nonceMismatch"],
    ["a different key ID", { keyId: new Uint8Array(32) }, "keyIdMismatch"],
    ["a different app", { appId: "1234567890.com.example.otherapp" }, "appIdMismatch"],
    ["a different team", { appId: "0987654321.com.example.myapp" }, "appIdMismatch"],
    ["the development environment", { environment: "development" }, "environmentMismatch"],
    ["an expired credential certificate", { now: new Date("2026-04-24T00:00:00Z") }, "untrustedChain"],
    ["a not-yet-valid credential certificate", { now: new Date("2026-04-19T00:00:00Z") }, "untrustedChain"],
    ["the default launch-category policy (1 is an OS executable)", { acceptedValidationCategories: undefined }, "validationCategory"],
  ];
  for (const [name, overrides, reason] of cases) {
    const result = await verifyAttestation(appleInput(overrides));
    assert.deepEqual(result, { ok: false, reason }, name);
  }
});

test("a chain that does not end at the pinned root is untrusted", async () => {
  // The sample's own chain, checked against some other root: nothing about it is trusted then.
  const other = await testPki();
  assert.deepEqual(await verifyAttestation(appleInput({ trustAnchor: other.root })), { ok: false, reason: "untrustedChain" });

  // And a well-formed attestation from a lookalike PKI is untrusted by the real Apple root.
  const device = await testDevice();
  const cdh = await sha256(utf8("challenge"));
  const forged = await attest(device, cdh, { appId: APPLE_APP_ID, pki: other });
  const result = await verifyAttestation({
    attestationObject: forged, keyId: device.keyId, clientDataHash: cdh, appId: APPLE_APP_ID,
    environment: "production", now: new Date(), trustAnchor: APPLE_APP_ATTEST_ROOT_DER,
  });
  assert.deepEqual(result, { ok: false, reason: "untrustedChain" });
});

test("a tampered sample is malformed or untrusted, never accepted", async () => {
  // Flip every byte in turn: every mutation outside the receipt must fail closed. The
  // receipt is the one opaque member: it exists for Apple's server-to-server fraud-risk metric, is
  // not part of what Apple's procedure trusts, and is neither verified nor stored here (ADR-0007 §6).
  const receiptKey = Buffer.from(APPLE_SAMPLE).indexOf("receipt");
  const receiptStart = receiptKey + "receipt".length + 3; // 0x59 + two length bytes
  const receiptEnd = receiptStart + ((APPLE_SAMPLE[receiptStart - 2]! << 8) | APPLE_SAMPLE[receiptStart - 1]!);
  assert.equal(APPLE_SAMPLE[receiptStart - 3], 0x59, "the receipt is a byte string with a two-byte length");
  let checked = 0;
  for (let offset = 0; offset < APPLE_SAMPLE.length; offset++) {
    if (offset >= receiptStart && offset < receiptEnd) continue;
    const mutated = APPLE_SAMPLE.slice();
    mutated[offset] ^= 0x01;
    const result = await verifyAttestation(appleInput({ attestationObject: mutated }));
    assert.equal(result.ok, false, `byte ${offset}`);
    checked++;
  }
  assert.equal(checked, APPLE_SAMPLE.length - (receiptEnd - receiptStart));
  // Truncated, extended, empty, or not CBOR at all.
  for (const bytes of [APPLE_SAMPLE.subarray(0, 100), concat(APPLE_SAMPLE, new Uint8Array([0])), new Uint8Array(), utf8("{}")]) {
    assert.deepEqual(await verifyAttestation(appleInput({ attestationObject: bytes })), { ok: false, reason: "malformed" });
  }
});

test("the CBOR decoder refuses every form the App Attest structures do not use", () => {
  const refused: Array<[string, number[]]> = [
    ["indefinite-length map", [0xbf, 0xff]],
    ["tag", [0xc0, 0x00]],
    ["float", [0xf9, 0x00, 0x00]],
    ["duplicate map key", [0xa2, 0x01, 0x00, 0x01, 0x00]],
    ["byte-string map key", [0xa1, 0x41, 0x00, 0x00]],
    ["invalid UTF-8", [0x62, 0xc3, 0x28]],
    ["truncated", [0x58, 0x05, 0x00]],
    ["trailing bytes", [0x00, 0x00]],
  ];
  for (const [name, bytes] of refused) assert.throws(() => decodeCbor(Uint8Array.from(bytes)), CborError, name);
});

test("attestation: each Apple check rejects its own violation (synthetic PKI)", async () => {
  const pki = await testPki();
  const appId = "ABCDE12345.com.example.mannerpath";
  const cdh = await sha256(utf8("registration client data"));
  const check = async (name: string, reason: string, build: (d: Awaited<ReturnType<typeof testDevice>>) => Promise<Uint8Array>, keyId?: Uint8Array) => {
    const device = await testDevice();
    const result = await verifyAttestation({
      attestationObject: await build(device), keyId: keyId ?? device.keyId, clientDataHash: cdh, appId,
      environment: "production", now: new Date(), trustAnchor: pki.root,
    });
    assert.deepEqual(result, { ok: false, reason }, name);
  };

  const good = await testDevice();
  const ok = await verifyAttestation({
    attestationObject: await attest(good, cdh, { appId, pki }), keyId: good.keyId, clientDataHash: cdh, appId,
    environment: "production", now: new Date(), trustAnchor: pki.root,
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));

  await check("key ID of another key", "keyIdMismatch", (d) => attest(d, cdh, { appId, pki }), new Uint8Array(32).fill(7));
  await check("credentialId that is not the key ID", "keyIdMismatch", (d) => attest(d, cdh, { appId, pki, credentialId: new Uint8Array(32).fill(1) }));
  await check("COSE key that is not the certified key", "keyIdMismatch", (d) => attest(d, cdh, { appId, pki, coseX: new Uint8Array(32).fill(9) }));
  await check("wrong app identity", "appIdMismatch", (d) => attest(d, cdh, { appId: "ABCDE12345.com.example.other", pki }));
  await check("nonzero attestation counter", "counterNotZero", (d) => attest(d, cdh, { appId, pki, counter: 1 }));
  await check("development key on a production deployment", "environmentMismatch", (d) => attest(d, cdh, { appId, pki, environment: "development" }));
  await check("nonce over other client data", "nonceMismatch", (d) => attest(d, cdh, { appId, pki, nonceOverride: new Uint8Array(32) }));
  await check("an enterprise/ad hoc launch category", "validationCategory", (d) =>
    attest(d, cdh, { appId, pki, extensions: new Map([["apple_validation_category_01", Uint8Array.from([5, 0, 0, 0])]]) }));
  await check("an expired credential certificate", "untrustedChain", (d) =>
    attest(d, cdh, { appId, pki, now: new Date(Date.now() - 10 * 86_400_000), leafNotAfter: new Date(Date.now() - 86_400_000) }));

  // App Store and TestFlight launch categories are the production distributions and are accepted.
  for (const category of ACCEPTED_VALIDATION_CATEGORIES.production) {
    const device = await testDevice();
    const result = await verifyAttestation({
      attestationObject: await attest(device, cdh, { appId, pki, extensions: new Map([["apple_validation_category_01", Uint8Array.from([category, 0, 0, 0])], ["apple_bundle_version_01", "1.0"]]) }),
      keyId: device.keyId, clientDataHash: cdh, appId, environment: "production", now: new Date(), trustAnchor: pki.root,
    });
    assert.equal(result.ok && result.validationCategory, category);
  }
});

test("assertion: signature, RP ID and strictly increasing counter", async () => {
  const appId = "ABCDE12345.com.example.mannerpath";
  const device = await testDevice();
  const cdh = await sha256(utf8("report client data"));
  const base = { clientDataHash: cdh, publicKey: device.publicKey, appId, environment: "production" as const };

  const first = await makeAssertion(device, cdh, { appId });
  assert.deepEqual(await verifyAssertion({ ...base, assertion: first, previousCounter: 0 }), { ok: true, counter: 1 });
  // The same assertion again: its counter is no longer greater than the stored one.
  assert.deepEqual(await verifyAssertion({ ...base, assertion: first, previousCounter: 1 }), { ok: false, reason: "counterNotIncreasing" });
  // Equal and lower counters are both stale.
  assert.deepEqual(await verifyAssertion({ ...base, assertion: await makeAssertion(device, cdh, { appId, counter: 5 }), previousCounter: 5 }), { ok: false, reason: "counterNotIncreasing" });
  assert.deepEqual(await verifyAssertion({ ...base, assertion: await makeAssertion(device, cdh, { appId, counter: 4 }), previousCounter: 5 }), { ok: false, reason: "counterNotIncreasing" });
  assert.deepEqual(await verifyAssertion({ ...base, assertion: await makeAssertion(device, cdh, { appId, counter: 6 }), previousCounter: 5 }), { ok: true, counter: 6 });

  // Bound to the exact client data: the same assertion over other bytes fails the signature.
  const other = await sha256(utf8("report client data, modified"));
  assert.deepEqual(await verifyAssertion({ ...base, clientDataHash: other, assertion: first, previousCounter: 0 }), { ok: false, reason: "signature" });
  // Signed by some other key.
  const stranger = await testDevice();
  assert.deepEqual(await verifyAssertion({ ...base, assertion: await makeAssertion(device, cdh, { appId, signWith: stranger.keys.privateKey }), previousCounter: 0 }), { ok: false, reason: "signature" });
  // For another app.
  assert.deepEqual(await verifyAssertion({ ...base, assertion: await makeAssertion(device, cdh, { appId: "ABCDE12345.com.example.other" }), previousCounter: 0 }), { ok: false, reason: "appIdMismatch" });
  // A present launch category must be an accepted one.
  assert.deepEqual(
    await verifyAssertion({ ...base, assertion: await makeAssertion(device, cdh, { appId, extensions: new Map([["apple_validation_category_01", Uint8Array.from([6, 0, 0, 0])]]) }), previousCounter: 0 }),
    { ok: false, reason: "validationCategory" },
  );
  // Malformed envelopes.
  for (const bytes of [new Uint8Array(), cbor(new Map([["signature", new Uint8Array(8)]])), cbor(new Map<string, any>([["signature", new Uint8Array(8)], ["authenticatorData", new Uint8Array(10)]])), utf8("not cbor")]) {
    const result = await verifyAssertion({ ...base, assertion: bytes, previousCounter: 0 });
    assert.equal(result.ok, false);
  }
});
