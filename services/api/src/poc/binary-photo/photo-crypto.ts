// PoC — crypto-erasure for photos at rest (docs/release/V1_PHOTO_ERASURE_ANALYSIS.md). NOT used by any route.
//
// SQL deletion in D1 cannot erase physically: Time Travel keeps 7 days of restorable history, SQLite keeps freed pages
// until reuse (PRAGMA secure_delete is refused), and provider copies are undocumented. So the bytes Cloudflare holds
// are made ciphertext that Cloudflare can never decrypt:
//
//   the Worker knows only the epoch PUBLIC key (not a secret);
//   per photo: ephemeral P-256 key pair → ECDH with the epoch public key → HKDF-SHA-256 → AES-256-GCM;
//   the epoch PRIVATE key exists only with the operator (local Admin decrypts for review);
//   destroying an epoch's private key makes every copy of that epoch's photos — live rows, free pages, Time Travel,
//   provider backups — undecryptable at once. No rollback can bring it back: Cloudflare never had it.
//
// Envelope: "MPE1" ‖ epoch(uint16) ‖ ephemeralPublicKey(65, uncompressed) ‖ iv(12) ‖ ciphertext+tag.
// AAD binds the storage key and epoch, so a ciphertext cannot be swapped to another photo or epoch.

const MAGIC = new Uint8Array([0x4d, 0x50, 0x45, 0x31]);
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const HEADER = 4 + 2 + 65 + 12;

async function aesKey(shared: ArrayBuffer, info: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// WebCrypto names the peer key `public`; @cloudflare/workers-types declares it as `$public`. Both are passed so the
// same code runs in Node and workerd; the local workerd rehearsal (V1_FREE_TIER_PROBE_RUNBOOK.md F11) exercises it.
const ecdh = (peer: CryptoKey) => ({ name: "ECDH", public: peer, $public: peer }) as unknown as SubtleCryptoDeriveKeyAlgorithm;
const context = (storageKey: string, epoch: number) => new TextEncoder().encode(`mannerpath.photo.v1\n${epoch}\n${storageKey}`);

/** Worker side: needs only the epoch's raw (uncompressed, 65-byte) public key. */
export async function sealPhoto(plain: Uint8Array, storageKey: string, epoch: number, epochPublicKeyRaw: Uint8Array): Promise<Uint8Array> {
  if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffff) throw new Error("sealPhoto: epoch out of range");
  const recipient = await crypto.subtle.importKey("raw", epochPublicKeyRaw, P256, false, []);
  const ephemeral = await crypto.subtle.generateKey(P256, true, ["deriveBits"]) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits(ecdh(recipient), ephemeral.privateKey, 256);
  const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey) as ArrayBuffer);
  const iv = crypto.getRandomValues(new Uint8Array(12)), aad = context(storageKey, epoch);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await aesKey(shared, aad), plain));
  const out = new Uint8Array(HEADER + sealed.length);
  out.set(MAGIC, 0); out[4] = epoch >> 8; out[5] = epoch & 255; out.set(ephemeralRaw, 6); out.set(iv, 71); out.set(sealed, HEADER);
  return out;
}

export function sealedEpoch(sealed: Uint8Array): number {
  if (sealed.length < HEADER + 16 || !MAGIC.every((b, i) => sealed[i] === b)) throw new Error("photo envelope: malformed");
  return (sealed[4] << 8) | sealed[5];
}

/** Operator side (local Admin): needs the epoch PRIVATE key. Throws when the key is wrong or the envelope was altered. */
export async function openPhoto(sealed: Uint8Array, storageKey: string, epochPrivateKey: CryptoKey): Promise<Uint8Array> {
  const epoch = sealedEpoch(sealed);
  const ephemeral = await crypto.subtle.importKey("raw", sealed.subarray(6, 71), P256, false, []);
  const shared = await crypto.subtle.deriveBits(ecdh(ephemeral), epochPrivateKey, 256);
  const aad = context(storageKey, epoch);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(71, HEADER), additionalData: aad }, await aesKey(shared, aad), sealed.subarray(HEADER)));
}

/**
 * Epochs of EPOCH_DAYS starting at the Unix epoch. A photo of epoch E must be deleted (and E's private key destroyed)
 * by epochStart(E) + 90 days, so every photo is unrecoverable within 90 days of being stored.
 */
export const EPOCH_DAYS = 14;
export const epochOf = (at: Date) => Math.floor(at.getTime() / (EPOCH_DAYS * 86_400_000));
export const epochStart = (epoch: number) => new Date(epoch * EPOCH_DAYS * 86_400_000);
export const keyDestroyBy = (epoch: number) => new Date(epochStart(epoch).getTime() + 90 * 86_400_000);
