// Shared floor for secret peppers, measured like REPORT_SUBMITTER_PEPPER (src/reports/attestation.ts): surrounding
// whitespace trimmed, then UTF-8 BYTES, never characters. Length is only a floor; it cannot prove the value is random.
export const PEPPER_MIN_BYTES = 32;

/** The trimmed pepper when it is at least PEPPER_MIN_BYTES UTF-8 bytes, else null (missing, blank or short). */
export function normalizedPepper(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return new TextEncoder().encode(trimmed).length >= PEPPER_MIN_BYTES ? trimmed : null;
}
