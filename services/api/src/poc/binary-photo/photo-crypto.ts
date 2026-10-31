// PoC — crypto-erasure for photos at rest (docs/release/V1_PHOTO_ERASURE_ANALYSIS.md). NOT used by any route.
//
// SQL deletion in D1 is not physical erasure (Time Travel, SQLite free pages, provider copies). So every byte Cloudflare
// stores is ciphertext under a key Cloudflare never holds, and the key is destroyed on the operator side.
//
// Keys are per DEADLINE DAY, not per creation period. A photo stored at t is sealed to the key of day
// k = floor((t + 90 d) / 1 d); that key is destroyed at the start of day k, i.e. in (t + 89 d, t + 90 d]. Photos sharing
// a key share a deadline day, so destroying one never cuts another photo's review short by more than a day. (The first
// PoC used 14-day creation epochs: within 90 days for every photo, but photos stored late in an epoch lost up to 14 days
// of review, and one key's destruction cut many reviews short.)
//
// Operator side: one 32-byte seed for the oldest live day; day keys are derived forward (seed_{k+1} = HMAC(seed_k,
// "advance")), so advancing the stored seed past day k makes every key ≤ k underivable — destruction is overwriting one
// value, and a stolen current seed reveals no past day. Worker side: only public keys (X25519) published ahead.
// Envelope: "MPE2" ‖ day(uint32) ‖ ephemeral X25519 public key(32) ‖ iv(12) ‖ ciphertext+tag; AAD binds storage key + day.

const MAGIC = new Uint8Array([0x4d, 0x50, 0x45, 0x32]);
const HEADER = 4 + 4 + 32 + 12;
const DAY_MS = 86_400_000;
export const RETENTION_DAYS = 90;
const X25519 = { name: "X25519" } as const;
// PKCS#8 prefix for a raw X25519 private key (RFC 8410).
const PKCS8_X25519 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

// WebCrypto names the peer key `public`; @cloudflare/workers-types declares `$public`. Both are passed so the same
// code runs in Node and workerd (verified in local workerd via /probe/seal).
const peer = (key: CryptoKey) => ({ name: "X25519", public: key, $public: key }) as unknown as SubtleCryptoDeriveKeyAlgorithm;
const context = (storageKey: string, day: number) => new TextEncoder().encode(`mannerpath.photo.v2\n${day}\n${storageKey}`);

async function aesKey(shared: ArrayBuffer, info: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The deadline day whose key seals a photo stored at `storedAt`, and when that key must be destroyed. */
export const keyDayFor = (storedAt: Date) => Math.floor((storedAt.getTime() + RETENTION_DAYS * DAY_MS) / DAY_MS);
export const keyDestroyAt = (day: number) => new Date(day * DAY_MS);

/** Worker side: needs only the day's raw 32-byte X25519 public key. */
export async function sealPhoto(plain: Uint8Array, storageKey: string, day: number, dayPublicKeyRaw: Uint8Array): Promise<Uint8Array> {
  if (!Number.isInteger(day) || day < 0 || day > 0xffffffff) throw new Error("sealPhoto: day out of range");
  const recipient = await crypto.subtle.importKey("raw", dayPublicKeyRaw, X25519, false, []);
  const ephemeral = await crypto.subtle.generateKey(X25519, true, ["deriveBits"]) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits(peer(recipient), ephemeral.privateKey, 256);
  const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey) as ArrayBuffer);
  const iv = crypto.getRandomValues(new Uint8Array(12)), aad = context(storageKey, day);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await aesKey(shared, aad), plain));
  const out = new Uint8Array(HEADER + sealed.length);
  out.set(MAGIC, 0); new DataView(out.buffer).setUint32(4, day); out.set(ephemeralRaw, 8); out.set(iv, 40); out.set(sealed, HEADER);
  return out;
}

export function sealedDay(sealed: Uint8Array): number {
  if (sealed.length < HEADER + 16 || !MAGIC.every((b, i) => sealed[i] === b)) throw new Error("photo envelope: malformed");
  return new DataView(sealed.buffer, sealed.byteOffset).getUint32(4);
}

/** Operator side: decrypts with the day's private key. Throws on a wrong key, another storage key/day, or tampering. */
export async function openPhoto(sealed: Uint8Array, storageKey: string, dayPrivateKey: CryptoKey): Promise<Uint8Array> {
  const day = sealedDay(sealed);
  const ephemeral = await crypto.subtle.importKey("raw", sealed.subarray(8, 40), X25519, false, []);
  const shared = await crypto.subtle.deriveBits(peer(ephemeral), dayPrivateKey, 256);
  const aad = context(storageKey, day);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(40, HEADER), additionalData: aad }, await aesKey(shared, aad), sealed.subarray(HEADER)));
}

// ---- Operator-side key chain (local Admin / key ceremony; never in the Worker) --------------------------------------

async function hmac(key: Uint8Array, label: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(label)));
}

/**
 * The operator's only stored secret: the seed of the oldest day whose key still exists. `advanceTo` returns a NEW chain
 * and zeroes the old seed bytes (best effort in JS); persisting the returned seed over the old one is the destruction.
 */
export class DayKeyChain {
  readonly day: number;
  private readonly seed: Uint8Array;
  private destroyed = false;
  private constructor(day: number, seed: Uint8Array) { this.day = day; this.seed = seed; }

  static fromSeed(day: number, seed: Uint8Array): DayKeyChain {
    if (seed.length !== 32) throw new Error("DayKeyChain: seed must be 32 bytes");
    return new DayKeyChain(day, seed.slice());
  }
  static generate(day: number): DayKeyChain { return new DayKeyChain(day, crypto.getRandomValues(new Uint8Array(32))); }

  /** Seed bytes to persist (replacing the previous value). */
  exportSeed(): Uint8Array { this.alive(); return this.seed.slice(); }

  private alive() { if (this.destroyed) throw new Error("DayKeyChain: this chain was advanced; its seed is destroyed"); }

  private async seedFor(day: number): Promise<Uint8Array> {
    this.alive();
    if (day < this.day) throw new Error(`day ${day} is destroyed (chain starts at ${this.day})`);
    let s: Uint8Array = this.seed.slice();
    for (let d = this.day; d < day; d++) { const next = await hmac(s, "mannerpath.photo-key.advance"); s.fill(0); s = next; }
    return s;
  }

  async privateKey(day: number): Promise<CryptoKey> {
    const s = await this.seedFor(day);
    const scalar = await hmac(s, "mannerpath.photo-key.x25519"); s.fill(0);
    const pkcs8 = new Uint8Array(PKCS8_X25519.length + 32); pkcs8.set(PKCS8_X25519); pkcs8.set(scalar, PKCS8_X25519.length); scalar.fill(0);
    try { return await crypto.subtle.importKey("pkcs8", pkcs8, X25519, false, ["deriveBits"]); } finally { pkcs8.fill(0); }
  }

  /** Public key for publishing ahead (needs an extractable copy only long enough to read `x`). */
  async publicKeyRaw(day: number): Promise<Uint8Array> {
    const s = await this.seedFor(day);
    const scalar = await hmac(s, "mannerpath.photo-key.x25519"); s.fill(0);
    const pkcs8 = new Uint8Array(PKCS8_X25519.length + 32); pkcs8.set(PKCS8_X25519); pkcs8.set(scalar, PKCS8_X25519.length); scalar.fill(0);
    try {
      const key = await crypto.subtle.importKey("pkcs8", pkcs8, X25519, true, ["deriveBits"]);
      const jwk = await crypto.subtle.exportKey("jwk", key) as JsonWebKey;
      return Uint8Array.from(atob(jwk.x!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    } finally { pkcs8.fill(0); }
  }

  /** Destroys every day before `day`: returns the advanced chain and zeroes this chain's seed. */
  async advanceTo(day: number): Promise<DayKeyChain> {
    const next = new DayKeyChain(day, await this.seedFor(day));
    this.seed.fill(0);
    this.destroyed = true;
    return next;
  }
}
