// App Attest / DeviceCheck boundary (ADR-0007 §6). This repository ships the interface, the policy
// and the fail-closed behaviour -- not an Apple client. No Apple key, team ID or bundle secret
// belongs here or in wrangler.jsonc; a deployment injects a verifier and sets the policy binding.

export type AttestationStatus = "notProvided" | "verified" | "unverified";

/** Policy from the REPORT_ATTESTATION binding. Unset means disabled (local and test). */
export type AttestationPolicy = "disabled" | "required";

export interface AttestationInput {
  keyId: string;
  assertion: string;
  challenge: string;
}

/**
 * Injected by the deployment. Only the verdict crosses this boundary: the implementation keeps the
 * Apple credentials, and the caller never persists or logs anything from `input`.
 */
export interface AttestationVerifier {
  verify(input: AttestationInput): Promise<boolean>;
}

export function attestationPolicy(value: string | undefined): AttestationPolicy {
  return value === "required" ? "required" : "disabled";
}

export type AttestationOutcome =
  | { ok: true; status: AttestationStatus }
  /** `unavailable`: policy requires attestation but no verifier is wired in -- fail closed. */
  | { ok: false; reason: "unavailable" | "missing" | "rejected" };

export async function checkAttestation(
  policy: AttestationPolicy,
  verifier: AttestationVerifier | undefined,
  input: AttestationInput | undefined,
): Promise<AttestationOutcome> {
  if (policy === "required") {
    // Never degrade to accepting unverified reports because the verifier is missing.
    if (verifier === undefined) return { ok: false, reason: "unavailable" };
    if (input === undefined) return { ok: false, reason: "missing" };
    return (await verifier.verify(input)) ? { ok: true, status: "verified" } : { ok: false, reason: "rejected" };
  }
  if (input === undefined) return { ok: true, status: "notProvided" };
  // Under `disabled` an attestation is accepted by the schema but not checked, so it is recorded
  // as unverified and the material itself is dropped here.
  if (verifier === undefined) return { ok: true, status: "unverified" };
  return { ok: true, status: (await verifier.verify(input)) ? "verified" : "unverified" };
}
