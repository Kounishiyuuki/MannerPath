// App Attest attestation and assertion verification, following Apple's "Validating apps that
// connect to your server" (DeviceCheck documentation) step by step. Each step is numbered as in
// that article so a reviewer can hold the two side by side.
//
// These functions are pure: they take the client data hash the protocol layer computed
// (src/attest/binding.ts) and return a verdict. They never touch storage, so an input that fails
// here cannot have changed any state. They never log.

import { bytesEqual, concat, sha256, utf8 } from "./bytes.ts";
import { type CborValue, decodeCbor, decodeCborPrefix, exactMap, isMap } from "./cbor.ts";
import { type Certificate, type Curve, OID, TAG, children, ecdsaDerToRaw, parseCertificate, parseDer } from "./der.ts";

export type AppAttestEnvironment = "development" | "production";

/** authenticatorData aaguid values (step 8). */
export const AAGUID: Record<AppAttestEnvironment, Uint8Array> = {
  development: utf8("appattestdevelop"),
  production: concat(utf8("appattest"), new Uint8Array(7)),
};

/**
 * Launch validation categories (`apple_validation_category_01`) this service accepts, per
 * environment: TestFlight (2) and App Store (4) builds use the production environment; a build
 * signed with a development identity (3) uses the development one. Everything else — invalid (0),
 * OS executables (1), enterprise/ad hoc (5), Developer ID (6), restricted (7–9), unmatched (10) — is
 * not a distribution of this iOS app. Applied only when the device reports the extension; see
 * ADR-0007 §6.
 */
export const ACCEPTED_VALIDATION_CATEGORIES: Record<AppAttestEnvironment, readonly number[]> = {
  development: [3],
  production: [2, 4],
};

export type AttestationFailure =
  | "malformed" | "untrustedChain" | "nonceMismatch" | "keyIdMismatch" | "appIdMismatch"
  | "environmentMismatch" | "counterNotZero" | "validationCategory";

export type AssertionFailure = "malformed" | "signature" | "appIdMismatch" | "counterNotIncreasing" | "validationCategory";

export interface AttestationInput {
  attestationObject: Uint8Array;
  /** The raw 32-byte key identifier (the base64-decoded DCAppAttestService keyId). */
  keyId: Uint8Array;
  clientDataHash: Uint8Array;
  /** `<App ID prefix>.<CFBundleIdentifier>`. */
  appId: string;
  environment: AppAttestEnvironment;
  now: Date;
  /** DER of the trust anchor. Production passes the pinned Apple root (src/attest/apple-root.ts). */
  trustAnchor: Uint8Array;
  acceptedValidationCategories?: readonly number[];
}

export type AttestationResult =
  | { ok: true; publicKey: Uint8Array; validationCategory: number | null }
  | { ok: false; reason: AttestationFailure };

export interface AssertionInput {
  assertion: Uint8Array;
  clientDataHash: Uint8Array;
  /** The X9.62 uncompressed P-256 point stored at registration. */
  publicKey: Uint8Array;
  appId: string;
  environment: AppAttestEnvironment;
  /** The last accepted counter for this key (0 right after registration). */
  previousCounter: number;
  acceptedValidationCategories?: readonly number[];
}

export type AssertionResult = { ok: true; counter: number } | { ok: false; reason: AssertionFailure };

class Rejection extends Error {
  readonly reason: AttestationFailure | AssertionFailure;
  constructor(reason: AttestationFailure | AssertionFailure) {
    super(reason);
    this.reason = reason;
  }
}

function reject(reason: AttestationFailure | AssertionFailure): never {
  throw new Rejection(reason);
}

function bytesOf(value: CborValue | undefined): Uint8Array {
  if (!(value instanceof Uint8Array)) reject("malformed");
  return value;
}

async function ecdsaVerify(spki: Uint8Array, curve: Curve, hash: "SHA-256" | "SHA-384", derSignature: Uint8Array, data: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: curve }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash }, key, ecdsaDerToRaw(derSignature, curve), data);
}

const within = (cert: Certificate, now: Date) => cert.notBefore <= now && now <= cert.notAfter;

/**
 * Step 1: x5c is [credCert, intermediate]; intermediate chains to the pinned root. Checked:
 * signatures, validity windows at `now`, issuer/subject name linkage, CA flags and key usage.
 */
async function verifyChain(x5c: CborValue | undefined, trustAnchor: Uint8Array, now: Date): Promise<Certificate> {
  if (!Array.isArray(x5c) || x5c.length !== 2) reject("malformed");
  const [leaf, intermediate] = x5c.map((c) => parseCertificate(bytesOf(c)));
  const root = parseCertificate(trustAnchor);
  if (!leaf || !intermediate) reject("malformed");

  const linked = bytesEqual(leaf.issuer, intermediate.subject) && bytesEqual(intermediate.issuer, root.subject);
  const flags = intermediate.isCa && !leaf.isCa && root.isCa
    && intermediate.keyUsage !== null && (intermediate.keyUsage & 0x04) !== 0; // keyCertSign
  if (!linked || !flags || ![leaf, intermediate, root].every((c) => within(c, now))) reject("untrustedChain");
  if (!(await ecdsaVerify(root.spki, root.curve, intermediate.signatureHash, intermediate.signature, intermediate.tbs))) reject("untrustedChain");
  if (!(await ecdsaVerify(intermediate.spki, intermediate.curve, leaf.signatureHash, leaf.signature, leaf.tbs))) reject("untrustedChain");
  return leaf;
}

/** Step 4: the nonce extension is SEQUENCE { [1] EXPLICIT OCTET STRING(32) }, nothing else. */
function certificateNonce(leaf: Certificate): Uint8Array {
  const ext = leaf.extensions.get(OID.appAttestNonce);
  if (ext === undefined) reject("nonceMismatch");
  const seq = children(parseDer(ext, TAG.SEQUENCE));
  if (seq.length !== 1 || seq[0]!.tag !== 0xa1) reject("malformed");
  const inner = parseDer(seq[0]!.value, TAG.OCTET_STRING);
  if (inner.value.length !== 32) reject("malformed");
  return inner.value;
}

interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  /** Present on attestation authenticator data only. */
  attested?: { aaguid: Uint8Array; credentialId: Uint8Array; coseKey: CborValue };
  extensions: CborValue | null;
}

/**
 * WebAuthn authenticator data. Apple's own sample places the extensions map after the credential
 * key without setting the ED flag, so trailing bytes — not the flag — decide whether an extensions
 * map is present; when present it must be one CBOR map that ends exactly at the end.
 */
function parseAuthenticatorData(data: Uint8Array, withCredential: boolean): AuthenticatorData {
  if (data.length < 37) reject("malformed");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: AuthenticatorData = {
    rpIdHash: data.subarray(0, 32),
    flags: data[32]!,
    counter: view.getUint32(33),
    extensions: null,
  };
  let offset = 37;
  if (withCredential) {
    if ((out.flags & 0x40) === 0 || data.length < offset + 18) reject("malformed"); // AT flag
    const aaguid = data.subarray(offset, offset + 16);
    const idLength = view.getUint16(offset + 16);
    offset += 18;
    if (data.length < offset + idLength) reject("malformed");
    const credentialId = data.subarray(offset, offset + idLength);
    offset += idLength;
    const cose = decodeCborPrefix(data.subarray(offset));
    offset += cose.length;
    out.attested = { aaguid, credentialId, coseKey: cose.value };
  }
  if (offset < data.length) {
    const extensions = decodeCbor(data.subarray(offset));
    if (!isMap(extensions)) reject("malformed");
    out.extensions = extensions;
  }
  return out;
}

/** COSE_Key (RFC 8152) for an EC2 P-256 ES256 key → the X9.62 uncompressed point. */
function coseKeyPoint(value: CborValue): Uint8Array {
  const key = exactMap(value, [1, 3, -1, -2, -3]);
  const x = bytesOf(key.get(-2));
  const y = bytesOf(key.get(-3));
  if (key.get(1) !== 2 || key.get(3) !== -7 || key.get(-1) !== 1 || x.length !== 32 || y.length !== 32) reject("malformed");
  return concat(new Uint8Array([0x04]), x, y);
}

/**
 * Steps 10–11 (attestation) and 7–8 (assertion). Absent extensions are accepted — devices that
 * predate them do not send any — but a present category must be one we accept, and a present
 * bundle version must be a non-empty string.
 */
function validationCategory(extensions: CborValue | null, accepted: readonly number[]): number | null {
  if (extensions === null || !isMap(extensions)) return null;
  const version = extensions.get("apple_bundle_version_01");
  if (version !== undefined && (typeof version !== "string" || version.length === 0)) reject("malformed");
  const raw = extensions.get("apple_validation_category_01");
  if (raw === undefined) return null;
  let category: number;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 0xffff_ffff) category = raw;
  else if (raw instanceof Uint8Array && raw.length === 4) category = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
  else reject("malformed");
  if (!accepted.includes(category)) reject("validationCategory");
  return category;
}

export async function verifyAttestation(input: AttestationInput): Promise<AttestationResult> {
  try {
    if (input.keyId.length !== 32 || input.clientDataHash.length === 0) reject("malformed");
    const object = exactMap(decodeCbor(input.attestationObject), ["fmt", "attStmt", "authData"]);
    if (object.get("fmt") !== "apple-appattest") reject("malformed");
    const statement = exactMap(object.get("attStmt")!, ["x5c", "receipt"]);
    bytesOf(statement.get("receipt")); // shape only: the receipt is not stored (ADR-0007 §6)
    const authData = bytesOf(object.get("authData"));

    // 1. Certificate chain to the App Attest root.
    const leaf = await verifyChain(statement.get("x5c"), input.trustAnchor, input.now);
    if (leaf.curve !== "P-256") reject("malformed");

    // 2–4. nonce = SHA256(authData ‖ clientDataHash) must equal the credCert nonce extension.
    const nonce = await sha256(concat(authData, input.clientDataHash));
    if (!bytesEqual(certificateNonce(leaf), nonce)) reject("nonceMismatch");

    // 5. SHA256(credCert public key, X9.62 uncompressed) is the key identifier.
    if (!bytesEqual(await sha256(leaf.publicKey), input.keyId)) reject("keyIdMismatch");

    const parsed = parseAuthenticatorData(authData, true);
    // 6. RP ID hash is SHA256 of the App ID.
    if (!bytesEqual(parsed.rpIdHash, await sha256(utf8(input.appId)))) reject("appIdMismatch");
    // 7. A fresh key has signed nothing yet.
    if (parsed.counter !== 0) reject("counterNotZero");
    // 8. aaguid names the environment this deployment accepts.
    if (!bytesEqual(parsed.attested!.aaguid, AAGUID[input.environment])) reject("environmentMismatch");
    // 9. credentialId is the key identifier, and the embedded COSE key is the credCert key.
    if (!bytesEqual(parsed.attested!.credentialId, input.keyId)) reject("keyIdMismatch");
    if (!bytesEqual(coseKeyPoint(parsed.attested!.coseKey), leaf.publicKey)) reject("keyIdMismatch");
    // 10–11. Launch validation category and bundle version, when reported.
    const category = validationCategory(parsed.extensions, input.acceptedValidationCategories ?? ACCEPTED_VALIDATION_CATEGORIES[input.environment]);

    return { ok: true, publicKey: leaf.publicKey, validationCategory: category };
  } catch (e) {
    return { ok: false, reason: failureOf(e) };
  }
}

export async function verifyAssertion(input: AssertionInput): Promise<AssertionResult> {
  try {
    const object = exactMap(decodeCbor(input.assertion), ["signature", "authenticatorData"]);
    const signature = bytesOf(object.get("signature"));
    const authData = bytesOf(object.get("authenticatorData"));
    if (input.publicKey.length !== 65 || input.publicKey[0] !== 0x04) reject("malformed");

    // 1–3. nonce = SHA256(authenticatorData ‖ clientDataHash); the signature is ECDSA P-256/SHA-256
    // over the nonce.
    const nonce = await sha256(concat(authData, input.clientDataHash));
    const spki = concat(P256_SPKI_PREFIX, input.publicKey);
    if (!(await ecdsaVerify(spki, "P-256", "SHA-256", signature, nonce))) reject("signature");

    const parsed = parseAuthenticatorData(authData, false);
    // 4. RP ID hash.
    if (!bytesEqual(parsed.rpIdHash, await sha256(utf8(input.appId)))) reject("appIdMismatch");
    // 5. Strictly increasing counter. The store re-checks this atomically (src/attest/store.ts).
    if (parsed.counter <= input.previousCounter) reject("counterNotIncreasing");
    // 6 (challenge) is the caller's: it is inside clientDataHash, which it derived from a challenge
    // it consumed. 7–8. Launch validation category and bundle version, when reported.
    validationCategory(parsed.extensions, input.acceptedValidationCategories ?? ACCEPTED_VALIDATION_CATEGORIES[input.environment]);

    return { ok: true, counter: parsed.counter };
  } catch (e) {
    return { ok: false, reason: failureOf(e) as AssertionFailure };
  }
}

/** SubjectPublicKeyInfo header for an uncompressed P-256 point (id-ecPublicKey, prime256v1). */
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

/**
 * Any exception other than a deliberate rejection — a CBOR/DER parse error, a WebCrypto import
 * failure on a hostile key encoding — came from the client's bytes, so it is a malformed input and
 * never a reason to accept.
 */
function failureOf(e: unknown): AttestationFailure {
  return e instanceof Rejection ? (e.reason as AttestationFailure) : "malformed";
}
