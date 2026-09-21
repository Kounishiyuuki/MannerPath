// The ONE byte-level binding between an App Attest signature and what it authorizes
// (docs/API.md "App Attest client data", ADR-0007 §6). The iPhone client (Issue #46) implements
// exactly this; test/app-attest-binding.test.ts pins vectors for it.
//
//   clientData     = frame(domain) ‖ frame(field₁) ‖ … ‖ frame(fieldₙ)
//   frame(x)       = uint32_be(byteLength(x)) ‖ x
//   clientDataHash = SHA-256(clientData)
//
// Every part is length-prefixed, so no two different inputs frame to the same bytes, and the
// domain separates registration from report authorization (and future versions from both). The
// report payload is framed as the exact bytes the client sends (base64-transported, never
// re-serialized), so a server and a client can never disagree about JSON key order or escaping.

import { concat, sha256, u32be, utf8 } from "./bytes.ts";

export const REGISTRATION_DOMAIN = "mannerpath.app-attest.registration.v1";
export const REPORT_DOMAIN = "mannerpath.app-attest.report.v1";

export function frame(parts: readonly Uint8Array[]): Uint8Array {
  return concat(...parts.flatMap((p) => [u32be(p.length), p]));
}

/** Registration: the attestKey clientDataHash binds the registration challenge to the key ID. */
export function registrationClientData(challenge: Uint8Array, keyId: Uint8Array): Uint8Array {
  return frame([utf8(REGISTRATION_DOMAIN), challenge, keyId]);
}

/** Report: the generateAssertion clientDataHash binds the report challenge, the key and the payload bytes. */
export function reportClientData(challenge: Uint8Array, keyId: Uint8Array, payload: Uint8Array): Uint8Array {
  return frame([utf8(REPORT_DOMAIN), challenge, keyId, payload]);
}

export const clientDataHash = (clientData: Uint8Array): Promise<Uint8Array> => sha256(clientData);
