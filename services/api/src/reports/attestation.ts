// App Attest / DeviceCheck: DEFERRED, and fail-closed until the real protocol exists (ADR-0007 §6).
//
// A correct App Attest assertion check needs three things this slice does not have:
//   1. a one-time, server-issued challenge (issued, stored and consumed exactly once);
//   2. a clientDataHash that binds that challenge to the exact report payload being submitted;
//   3. server-side replay protection, including the per-key assertion counter.
// A client-supplied "challenge" proves none of that: it is replayable and bound to nothing. So v1
// accepts no attestation material at all (the request schema rejects it), stores
// attestation_status = 'notProvided', and refuses to run in any enforcing mode. Shipping a
// half-protocol would be worse than shipping none, because the stored verdict would look like
// evidence of device integrity. Follow-up: Issue #37.

export type AttestationStatus = "notProvided" | "verified" | "unverified";

/**
 * Value of the REPORT_ATTESTATION binding.
 * - unset / "disabled": the documented local and test default; no attestation is collected.
 * - "required": accepted as configuration, but unsupported until the protocol lands, so the
 *   endpoint fails closed with 503 rather than storing unverifiable claims.
 * - anything else: a misconfiguration. It fails closed too, so a typo can never silently disable
 *   attestation the way a permissive parser would.
 */
export type AttestationConfig =
  | { kind: "disabled" }
  | { kind: "unsupported"; detail: string };

export const ATTESTATION_VALUES = ["disabled", "required"] as const;

export function attestationConfig(value: string | undefined): AttestationConfig {
  if (value === undefined || value === "disabled") return { kind: "disabled" };
  if (value === "required") {
    return { kind: "unsupported", detail: "report attestation is required but the App Attest challenge protocol is not implemented" };
  }
  return { kind: "unsupported", detail: `REPORT_ATTESTATION must be one of: ${ATTESTATION_VALUES.join(", ")}` };
}

/** The only status v1 can honestly record. */
export const ATTESTATION_STATUS_V1: AttestationStatus = "notProvided";
