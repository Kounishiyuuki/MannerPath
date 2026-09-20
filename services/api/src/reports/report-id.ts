// Report IDs: "rp_" + 26 Crockford base32 characters encoding 128 bits from a CSPRNG, the same
// opaque shape as spot IDs (src/spot-id.ts) in a separate namespace. Nothing about the report,
// its submitter or its subject goes into the ID.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReportId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `rp_${out}`;
}
