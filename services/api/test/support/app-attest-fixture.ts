// A synthetic App Attest device for tests. It builds a three-level ECDSA PKI shaped like Apple's
// (P-384 root → P-384 intermediate → P-256 credential certificate carrying the nonce extension),
// attestation objects and assertions exactly as DCAppAttestService lays them out, so the server's
// verifier can be exercised end to end — including every way to get it wrong.
//
// Nothing here is trusted by the Worker: the test PKI is injected through createApp's
// appAttestTrustAnchor option, which no binding can set. Apple's real sample attestation is covered
// separately in test/app-attest-verify.test.ts.

import { base64Encode, concat, sha256, u32be, utf8 } from "../../src/attest/bytes.ts";
import { AAGUID, type AppAttestEnvironment } from "../../src/attest/verify.ts";

// ---- DER encoding -------------------------------------------------------------------------------

function length(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}
export const tlv = (tag: number, ...contents: Uint8Array[]) => {
  const body = concat(...contents);
  return concat(new Uint8Array([tag]), length(body.length), body);
};
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
export const seq = (...c: Uint8Array[]) => tlv(0x30, ...c);
const set = (...c: Uint8Array[]) => tlv(0x31, ...c);
const oid = (h: string) => tlv(0x06, hexBytes(h));
const octet = (b: Uint8Array) => tlv(0x04, b);
const bool = (v: boolean) => tlv(0x01, new Uint8Array([v ? 0xff : 0x00]));
const bitString = (b: Uint8Array) => tlv(0x03, new Uint8Array([0]), b);
const integer = (b: Uint8Array) => tlv(0x02, (b[0]! & 0x80) ? concat(new Uint8Array([0]), b) : b);
const utcTime = (d: Date) => tlv(0x17, utf8(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"));
const name = (cn: string) => seq(set(seq(oid("550403"), tlv(0x0c, utf8(cn)))));

function derSignature(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const trim = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    return b.subarray(i);
  };
  return seq(integer(trim(raw.subarray(0, half))), integer(trim(raw.subarray(half))));
}

// ---- CBOR encoding ------------------------------------------------------------------------------

type Cbor = number | string | Uint8Array | Cbor[] | Map<number | string, Cbor>;

function head(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 0x100) return new Uint8Array([(major << 5) | 24, n]);
  if (n < 0x10000) return new Uint8Array([(major << 5) | 25, n >> 8, n & 0xff]);
  return concat(new Uint8Array([(major << 5) | 26]), u32be(n));
}
export function cbor(v: Cbor): Uint8Array {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = utf8(v); return concat(head(3, b.length), b); }
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  if (Array.isArray(v)) return concat(head(4, v.length), ...v.map(cbor));
  return concat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
}

// ---- PKI ----------------------------------------------------------------------------------------

const P384 = { name: "ECDSA", namedCurve: "P-384" } as const;
const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIG_SHA256 = "2a8648ce3d040302";
const SIG_SHA384 = "2a8648ce3d040303";

interface Signer { keys: CryptoKeyPair; name: Uint8Array; hash: "SHA-256" | "SHA-384"; sigOid: string }

async function certificate(opts: {
  subject: Uint8Array; publicKey: CryptoKey; issuer: Signer; ca: boolean;
  notBefore: Date; notAfter: Date; extra?: Uint8Array[];
}): Promise<Uint8Array> {
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", opts.publicKey));
  const algorithm = seq(oid(opts.issuer.sigOid));
  const extensions = [
    seq(oid("551d13"), bool(true), octet(opts.ca ? seq(bool(true)) : seq())),
    seq(oid("551d0f"), bool(true), octet(tlv(0x03, new Uint8Array([opts.ca ? 1 : 7]), new Uint8Array([opts.ca ? 0x06 : 0x80])))),
    ...(opts.extra ?? []),
  ];
  const tbs = seq(
    tlv(0xa0, integer(new Uint8Array([2]))),
    integer(crypto.getRandomValues(new Uint8Array(8))),
    algorithm,
    opts.issuer.name,
    seq(utcTime(opts.notBefore), utcTime(opts.notAfter)),
    opts.subject,
    spki,
    tlv(0xa3, seq(...extensions)),
  );
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: opts.issuer.hash }, opts.issuer.keys.privateKey, tbs));
  return seq(tbs, algorithm, bitString(derSignature(raw)));
}

export interface TestPki {
  root: Uint8Array;
  intermediateCert: Uint8Array;
  intermediate: Signer;
}

export async function testPki(now = new Date()): Promise<TestPki> {
  const rootKeys = await crypto.subtle.generateKey(P384, true, ["sign", "verify"]) as CryptoKeyPair;
  const rootSigner: Signer = { keys: rootKeys, name: name("Test App Attestation Root CA"), hash: "SHA-384", sigOid: SIG_SHA384 };
  const day = 86_400_000;
  const root = await certificate({
    subject: rootSigner.name, publicKey: rootKeys.publicKey, issuer: rootSigner, ca: true,
    notBefore: new Date(now.getTime() - 365 * day), notAfter: new Date(now.getTime() + 365 * day),
  });
  const intermediateKeys = await crypto.subtle.generateKey(P384, true, ["sign", "verify"]) as CryptoKeyPair;
  const intermediate: Signer = { keys: intermediateKeys, name: name("Test App Attestation CA 1"), hash: "SHA-256", sigOid: SIG_SHA256 };
  const intermediateCert = await certificate({
    subject: intermediate.name, publicKey: intermediateKeys.publicKey, issuer: rootSigner, ca: true,
    notBefore: new Date(now.getTime() - 30 * day), notAfter: new Date(now.getTime() + 365 * day),
  });
  return { root, intermediateCert, intermediate };
}

// ---- The device ---------------------------------------------------------------------------------

export interface TestDevice {
  keys: CryptoKeyPair;
  publicKey: Uint8Array;
  keyId: Uint8Array;
  keyIdBase64: string;
  counter: number;
}

export async function testDevice(): Promise<TestDevice> {
  const keys = await crypto.subtle.generateKey(P256, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const keyId = await sha256(publicKey);
  return { keys, publicKey, keyId, keyIdBase64: base64Encode(keyId), counter: 0 };
}

export interface AttestOptions {
  appId: string;
  environment?: AppAttestEnvironment;
  /** Override what goes into the credential certificate's nonce. */
  nonceOverride?: Uint8Array;
  counter?: number;
  credentialId?: Uint8Array;
  /** Replace the embedded COSE key's x coordinate. */
  coseX?: Uint8Array;
  extensions?: Map<string, Cbor>;
  /** Sign the credential certificate with some other PKI. */
  pki: TestPki;
  now?: Date;
  leafNotAfter?: Date;
}

/** DCAppAttestService.attestKey(keyId, clientDataHash) → attestation object. */
export async function attest(device: TestDevice, clientDataHash: Uint8Array, opts: AttestOptions): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const x = device.publicKey.subarray(1, 33);
  const y = device.publicKey.subarray(33);
  const coseKey = cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, opts.coseX ?? x], [-3, y]]));
  const credentialId = opts.credentialId ?? device.keyId;
  const authData = concat(
    await sha256(utf8(opts.appId)),
    new Uint8Array([0x40]),
    u32be(opts.counter ?? 0),
    AAGUID[opts.environment ?? "production"],
    new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]),
    credentialId,
    coseKey,
    ...(opts.extensions ? [cbor(opts.extensions)] : []),
  );
  const nonce = opts.nonceOverride ?? await sha256(concat(authData, clientDataHash));
  const leaf = await certificate({
    subject: name("device"), publicKey: device.keys.publicKey, issuer: opts.pki.intermediate, ca: false,
    notBefore: new Date(now.getTime() - 60_000), notAfter: opts.leafNotAfter ?? new Date(now.getTime() + 3 * 86_400_000),
    extra: [seq(oid("2a864886f763640802"), octet(seq(tlv(0xa1, octet(nonce)))))],
  });
  return cbor(new Map<string, Cbor>([
    ["fmt", "apple-appattest"],
    ["attStmt", new Map<string, Cbor>([["x5c", [leaf, opts.pki.intermediateCert]], ["receipt", utf8("test receipt")]])],
    ["authData", authData],
  ]));
}

/**
 * DCAppAttestService.generateAssertion(keyId, clientDataHash) → assertion. The counter advances by
 * one per call, as on a device, unless an explicit counter is given.
 */
export async function assert(device: TestDevice, clientDataHash: Uint8Array, opts: { appId: string; counter?: number; signWith?: CryptoKey; extensions?: Map<string, Cbor> }): Promise<Uint8Array> {
  const counter = opts.counter ?? ++device.counter;
  const authData = concat(await sha256(utf8(opts.appId)), new Uint8Array([0x00]), u32be(counter), ...(opts.extensions ? [cbor(opts.extensions)] : []));
  const nonce = await sha256(concat(authData, clientDataHash));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, opts.signWith ?? device.keys.privateKey, nonce));
  return cbor(new Map<string, Cbor>([["signature", derSignature(raw)], ["authenticatorData", authData]]));
}
