// A deliberately small CBOR (RFC 8949) decoder for the two App Attest structures: the attestation
// object and the assertion, plus the COSE key and extension map inside authenticator data.
//
// It accepts only what those structures use — unsigned/negative integers, byte and text strings,
// arrays, maps with integer or text keys, and false/true/null — with definite lengths. Tags,
// floats, indefinite lengths, duplicate map keys and invalid UTF-8 are rejected: a general decoder
// would be more code to trust, not less, and every rejected form is one an attacker cannot use.

export type CborValue = number | Uint8Array | string | CborValue[] | Map<number | string, CborValue> | boolean | null;

export class CborError extends Error {}

const MAX_DEPTH = 8;
const MAX_ITEMS = 1024;

class Reader {
  readonly bytes: Uint8Array;
  offset = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  take(n: number): Uint8Array {
    if (n > this.bytes.length - this.offset) throw new CborError("truncated");
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  argument(info: number): number {
    if (info < 24) return info;
    const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (width === 0) throw new CborError("indefinite or reserved length");
    let value = 0;
    for (const b of this.take(width)) value = value * 256 + b;
    if (!Number.isSafeInteger(value)) throw new CborError("integer too large");
    return value;
  }

  item(depth: number): CborValue {
    if (depth > MAX_DEPTH) throw new CborError("nesting too deep");
    const [initial] = this.take(1);
    const major = initial! >> 5;
    const info = initial! & 0x1f;
    switch (major) {
      case 0:
        return this.argument(info);
      case 1:
        return -1 - this.argument(info);
      case 2:
        return this.take(this.argument(info)).slice();
      case 3:
        try {
          return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(this.take(this.argument(info)));
        } catch {
          throw new CborError("invalid utf-8");
        }
      case 4: {
        const n = this.argument(info);
        if (n > MAX_ITEMS) throw new CborError("array too long");
        const out: CborValue[] = [];
        for (let i = 0; i < n; i++) out.push(this.item(depth + 1));
        return out;
      }
      case 5: {
        const n = this.argument(info);
        if (n > MAX_ITEMS) throw new CborError("map too long");
        const out = new Map<number | string, CborValue>();
        for (let i = 0; i < n; i++) {
          const key = this.item(depth + 1);
          if (typeof key !== "number" && typeof key !== "string") throw new CborError("map key must be an integer or text");
          if (out.has(key)) throw new CborError("duplicate map key");
          out.set(key, this.item(depth + 1));
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new CborError("unsupported simple value or float");
      default:
        throw new CborError("tags are not accepted");
    }
  }
}

/** Decodes one item that must span exactly `bytes`. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const reader = new Reader(bytes);
  const value = reader.item(0);
  if (reader.offset !== bytes.length) throw new CborError("trailing bytes");
  return value;
}

/** Decodes one item at the start of `bytes` and reports where it ended (authenticator data needs this). */
export function decodeCborPrefix(bytes: Uint8Array): { value: CborValue; length: number } {
  const reader = new Reader(bytes);
  const value = reader.item(0);
  return { value, length: reader.offset };
}

export function isMap(value: CborValue): value is Map<number | string, CborValue> {
  return value instanceof Map;
}

/** A map whose key set must be exactly `keys`: an unexpected member is rejected, not ignored. */
export function exactMap(value: CborValue, keys: readonly (number | string)[]): Map<number | string, CborValue> {
  if (!isMap(value)) throw new CborError("expected a map");
  if (value.size !== keys.length || !keys.every((k) => value.has(k))) throw new CborError("unexpected map members");
  return value;
}
