// Canonical spot IDs (ADR-0006 amendment, Issue #12): "sp_" + 26 Crockford base32 characters
// encoding 128 bits from a CSPRNG. Nothing about the spot (source, row, coordinates, tile, time)
// goes into the ID, so it stays valid when any of those change. Stability comes from storing the
// ID once and reaching it again through spot_source_entities, never from recomputing it.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SPOT_ID = /^sp_[0-9A-HJKMNP-TV-Z]{26}$/;

export function newSpotId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `sp_${out}`;
}
