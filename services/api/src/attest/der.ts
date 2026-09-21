// Minimal DER reader and X.509 subset for the App Attest certificate chain (Apple root →
// "Apple App Attestation CA 1" → per-key credential certificate).
//
// It parses only the fields verification needs and keeps the exact encoded bytes of the parts that
// are signed or compared (tbsCertificate, issuer, subject, subjectPublicKeyInfo), so nothing is
// ever re-encoded before a signature check. DER is enforced where it matters for that: definite,
// minimal lengths and no trailing bytes.

import { bytesEqual, hex } from "./bytes.ts";

export class DerError extends Error {}

export interface Tlv {
  tag: number;
  /** The whole element, header included. */
  raw: Uint8Array;
  /** The contents only. */
  value: Uint8Array;
}

function readTlv(bytes: Uint8Array, offset: number): Tlv {
  if (offset + 2 > bytes.length) throw new DerError("truncated header");
  const tag = bytes[offset]!;
  if ((tag & 0x1f) === 0x1f) throw new DerError("high tag numbers are not used here");
  let length = bytes[offset + 1]!;
  let header = 2;
  if (length & 0x80) {
    const width = length & 0x7f;
    if (width === 0 || width > 3) throw new DerError("indefinite or oversized length");
    if (offset + 2 + width > bytes.length) throw new DerError("truncated length");
    length = 0;
    for (let i = 0; i < width; i++) length = length * 256 + bytes[offset + 2 + i]!;
    if (length < 0x80 || (width > 1 && bytes[offset + 2] === 0)) throw new DerError("non-minimal length");
    header += width;
  }
  const end = offset + header + length;
  if (end > bytes.length) throw new DerError("truncated value");
  return { tag, raw: bytes.subarray(offset, end), value: bytes.subarray(offset + header, end) };
}

/** Exactly one element spanning `bytes`. */
export function parseDer(bytes: Uint8Array, expectedTag?: number): Tlv {
  const tlv = readTlv(bytes, 0);
  if (tlv.raw.length !== bytes.length) throw new DerError("trailing bytes");
  if (expectedTag !== undefined && tlv.tag !== expectedTag) throw new DerError(`expected tag 0x${expectedTag.toString(16)}`);
  return tlv;
}

/** The elements inside a constructed value. */
export function children(tlv: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let offset = 0;
  while (offset < tlv.value.length) {
    const child = readTlv(tlv.value, offset);
    out.push(child);
    offset += child.raw.length;
  }
  return out;
}

export const TAG = { BOOLEAN: 0x01, INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, OID: 0x06, UTC_TIME: 0x17, GENERALIZED_TIME: 0x18, SEQUENCE: 0x30 } as const;

/** OIDs compared as the hex of their DER contents, never as dotted strings parsed from input. */
export const OID = {
  ecPublicKey: "2a8648ce3d0201", // 1.2.840.10045.2.1
  prime256v1: "2a8648ce3d030107", // 1.2.840.10045.3.1.7 (P-256)
  secp384r1: "2b81040022", // 1.3.132.0.34 (P-384)
  ecdsaWithSha256: "2a8648ce3d040302", // 1.2.840.10045.4.3.2
  ecdsaWithSha384: "2a8648ce3d040303", // 1.2.840.10045.4.3.3
  basicConstraints: "551d13", // 2.5.29.19
  keyUsage: "551d0f", // 2.5.29.15
  appAttestNonce: "2a864886f763640802", // 1.2.840.113635.100.8.2
} as const;

export type Curve = "P-256" | "P-384";
export type Hash = "SHA-256" | "SHA-384";

export interface Certificate {
  tbs: Uint8Array;
  signatureHash: Hash;
  /** DER Ecdsa-Sig-Value. */
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  spki: Uint8Array;
  curve: Curve;
  /** The X9.62 uncompressed point from the subjectPublicKeyInfo. */
  publicKey: Uint8Array;
  isCa: boolean;
  /** keyUsage bits as the first content byte of the BIT STRING (bit 0 = 0x80), or null if absent. */
  keyUsage: number | null;
  /** Extension contents (the OCTET STRING payload), keyed by OID hex. */
  extensions: Map<string, Uint8Array>;
}

function time(tlv: Tlv): Date {
  const text = new TextDecoder().decode(tlv.value);
  const m = tlv.tag === TAG.UTC_TIME
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
    : tlv.tag === TAG.GENERALIZED_TIME ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text) : null;
  if (m === null) throw new DerError("unsupported time encoding");
  let year = Number(m[1]);
  // RFC 5280 §4.1.2.5.1: a two-digit year 50–99 is 19xx, 00–49 is 20xx.
  if (tlv.tag === TAG.UTC_TIME) year += year >= 50 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  if (Number.isNaN(date.getTime())) throw new DerError("invalid time");
  return date;
}

function signatureHash(algorithm: Tlv): Hash {
  const [oid, ...rest] = children(algorithm);
  // ecdsa-with-SHA* AlgorithmIdentifiers carry no parameters (RFC 5758 §3.2).
  if (oid?.tag !== TAG.OID || rest.length !== 0) throw new DerError("unexpected signature algorithm shape");
  const id = hex(oid.value);
  if (id === OID.ecdsaWithSha256) return "SHA-256";
  if (id === OID.ecdsaWithSha384) return "SHA-384";
  throw new DerError("unsupported signature algorithm");
}

function publicKeyInfo(spki: Tlv): { curve: Curve; publicKey: Uint8Array } {
  const [algorithm, key] = children(spki);
  if (algorithm?.tag !== TAG.SEQUENCE || key?.tag !== TAG.BIT_STRING) throw new DerError("unexpected subjectPublicKeyInfo");
  const [type, params, ...rest] = children(algorithm);
  if (type?.tag !== TAG.OID || hex(type.value) !== OID.ecPublicKey || params?.tag !== TAG.OID || rest.length !== 0) {
    throw new DerError("only EC public keys are accepted");
  }
  const curveOid = hex(params.value);
  const curve: Curve | null = curveOid === OID.prime256v1 ? "P-256" : curveOid === OID.secp384r1 ? "P-384" : null;
  if (curve === null) throw new DerError("unsupported curve");
  if (key.value[0] !== 0) throw new DerError("public key bit string has unused bits");
  const point = key.value.subarray(1);
  const size = curve === "P-256" ? 32 : 48;
  if (point.length !== 1 + 2 * size || point[0] !== 0x04) throw new DerError("public key must be an uncompressed point");
  return { curve, publicKey: point.slice() };
}

export function parseCertificate(der: Uint8Array): Certificate {
  const cert = parseDer(der, TAG.SEQUENCE);
  const [tbs, outerAlgorithm, signature, ...rest] = children(cert);
  if (tbs?.tag !== TAG.SEQUENCE || outerAlgorithm?.tag !== TAG.SEQUENCE || signature?.tag !== TAG.BIT_STRING || rest.length !== 0) {
    throw new DerError("unexpected certificate shape");
  }
  const fields = children(tbs);
  let i = 0;
  if (fields[i]?.tag !== 0xa0) throw new DerError("only v3 certificates are accepted");
  i++;
  if (fields[i++]?.tag !== TAG.INTEGER) throw new DerError("missing serial number");
  const innerAlgorithm = fields[i++];
  if (innerAlgorithm?.tag !== TAG.SEQUENCE || !bytesEqual(innerAlgorithm.raw, outerAlgorithm.raw)) {
    throw new DerError("signature algorithm mismatch"); // RFC 5280 §4.1.1.2
  }
  const issuer = fields[i++];
  const validity = fields[i++];
  const subject = fields[i++];
  const spki = fields[i++];
  if (issuer?.tag !== TAG.SEQUENCE || validity?.tag !== TAG.SEQUENCE || subject?.tag !== TAG.SEQUENCE || spki?.tag !== TAG.SEQUENCE) {
    throw new DerError("unexpected tbsCertificate shape");
  }
  const [notBefore, notAfter, ...extraValidity] = children(validity);
  if (notBefore === undefined || notAfter === undefined || extraValidity.length !== 0) throw new DerError("unexpected validity");

  const extensions = new Map<string, Uint8Array>();
  let isCa = false;
  let keyUsage: number | null = null;
  for (const field of fields.slice(i)) {
    if (field.tag === 0x81 || field.tag === 0x82) continue; // issuer/subject unique IDs: unused, harmless
    if (field.tag !== 0xa3) throw new DerError("unexpected tbsCertificate member");
    const list = parseDer(field.value, TAG.SEQUENCE);
    for (const ext of children(list)) {
      const parts = children(ext);
      const oid = parts[0];
      const critical = parts.length === 3 && parts[1]?.tag === TAG.BOOLEAN && parts[1].value[0] === 0xff;
      const body = parts[parts.length - 1];
      if (oid?.tag !== TAG.OID || body?.tag !== TAG.OCTET_STRING || parts.length < 2 || parts.length > 3) {
        throw new DerError("unexpected extension shape");
      }
      const id = hex(oid.value);
      if (extensions.has(id)) throw new DerError("duplicate extension");
      extensions.set(id, body.value);
      if (id === OID.basicConstraints) {
        const bc = children(parseDer(body.value, TAG.SEQUENCE));
        isCa = bc[0]?.tag === TAG.BOOLEAN && bc[0].value[0] === 0xff;
      } else if (id === OID.keyUsage) {
        const bits = parseDer(body.value, TAG.BIT_STRING);
        keyUsage = bits.value[1] ?? 0;
      } else if (critical) {
        // RFC 5280 §4.2: a certificate with an unrecognised critical extension must be rejected.
        throw new DerError("unrecognised critical extension");
      }
    }
  }

  if (signature.value[0] !== 0) throw new DerError("signature bit string has unused bits");
  return {
    tbs: tbs.raw,
    signatureHash: signatureHash(outerAlgorithm),
    signature: signature.value.subarray(1),
    issuer: issuer.raw,
    subject: subject.raw,
    notBefore: time(notBefore),
    notAfter: time(notAfter),
    spki: spki.raw,
    ...publicKeyInfo(spki),
    isCa,
    keyUsage,
    extensions,
  };
}

/** DER Ecdsa-Sig-Value → the fixed-width r‖s form WebCrypto verifies. */
export function ecdsaDerToRaw(der: Uint8Array, curve: Curve): Uint8Array {
  const size = curve === "P-256" ? 32 : 48;
  const parts = children(parseDer(der, TAG.SEQUENCE));
  if (parts.length !== 2 || parts.some((p) => p.tag !== TAG.INTEGER)) throw new DerError("unexpected ECDSA signature shape");
  const out = new Uint8Array(size * 2);
  parts.forEach((p, n) => {
    let v = p.value;
    if (v.length === 0 || (v[0]! & 0x80) !== 0) throw new DerError("ECDSA signature integer must be positive");
    if (v.length > 1 && v[0] === 0 && (v[1]! & 0x80) === 0) throw new DerError("non-minimal ECDSA integer");
    if (v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new DerError("ECDSA integer too large for curve");
    out.set(v, n * size + (size - v.length));
  });
  return out;
}

export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
