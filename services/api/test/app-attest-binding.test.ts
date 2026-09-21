// The clientDataHash binding (src/attest/binding.ts) against the frozen vectors in
// contracts/app-attest/client-data-vectors.v1.json, which an independent Python generator produced.
// The iPhone client (Issue #46) consumes the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGISTRATION_DOMAIN, REPORT_DOMAIN, clientDataHash, registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, hex } from "../src/attest/bytes.ts";
import { ReportPayloadV2 } from "../src/reports/dto.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../contracts/app-attest/client-data-vectors.v1.json", import.meta.url), "utf8"));

test("the TypeScript binding reproduces every frozen vector byte for byte", async () => {
  assert.equal(vectors.contract, "mannerpath-app-attest-client-data-vectors");
  assert.equal(vectors.version, 1);
  assert.ok(vectors.cases.length >= 4);
  for (const c of vectors.cases) {
    const challenge = base64Decode(c.challengeBase64)!;
    const keyId = base64Decode(c.keyIdBase64)!;
    let clientData: Uint8Array;
    if (c.domain === REGISTRATION_DOMAIN) {
      clientData = registrationClientData(challenge, keyId);
    } else {
      assert.equal(c.domain, REPORT_DOMAIN, c.name);
      const payload = base64Decode(c.payloadBase64)!;
      assert.equal(new TextDecoder().decode(payload), c.payloadUtf8, `${c.name}: payloadBase64 is payloadUtf8`);
      clientData = reportClientData(challenge, keyId, payload);
    }
    assert.equal(hex(clientData), c.clientDataHex, c.name);
    assert.equal(hex(await clientDataHash(clientData)), c.clientDataHashHex, c.name);
  }
});

test("the report vectors are valid v2 payloads, and different bytes never share a hash", () => {
  const reports = vectors.cases.filter((c: any) => c.domain === REPORT_DOMAIN);
  for (const c of reports) assert.equal(ReportPayloadV2.safeParse(JSON.parse(c.payloadUtf8)).success, true, c.name);
  const hashes = new Set(vectors.cases.map((c: any) => c.clientDataHashHex));
  assert.equal(hashes.size, vectors.cases.length, "every case hashes differently, including a reordered or newline-terminated copy");
});

test("framing is unambiguous: moving a byte between fields changes the bytes", async () => {
  const challenge = new Uint8Array(32).fill(1);
  const keyId = new Uint8Array(32).fill(2);
  const a = reportClientData(challenge, keyId, new TextEncoder().encode("ab"));
  const b = reportClientData(challenge, keyId, new TextEncoder().encode("a"));
  assert.notEqual(hex(a), hex(b));
  // Registration and report client data for the same challenge and key never coincide, even with
  // an empty payload: the domain separates them.
  assert.notEqual(hex(registrationClientData(challenge, keyId)), hex(reportClientData(challenge, keyId, new Uint8Array())));
  assert.notEqual(hex(await clientDataHash(registrationClientData(challenge, keyId))), hex(await clientDataHash(reportClientData(challenge, keyId, new Uint8Array()))));
});
