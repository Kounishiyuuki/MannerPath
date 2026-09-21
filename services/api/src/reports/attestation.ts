// Report attestation policy (ADR-0007 §6). The protocol itself lives in src/attest/; this module
// only decides, from deployment configuration, which report protocol a deployment speaks.
//
// Parsing is exhaustive and fails closed: "required" is enforcing only when the App ID and the
// App Attest environment are also configured and well-formed, and every other value — a typo,
// "true", whitespace — is a misconfiguration that accepts nothing. No value ever silently turns
// attestation off.

import type { AppAttestEnvironment } from "../attest/verify.ts";

export type AttestationStatus = "notProvided" | "verified" | "unverified";

/**
 * - disabled: unset or "disabled" — the documented local/test default. Report schema 1, no
 *   attestation material, every report stored `notProvided`.
 * - appAttest: "required" with a valid App ID and environment. Report schema 2 only; a report is
 *   stored only after its assertion verified, as `verified`.
 * - unsupported: anything else. Every report and App Attest endpoint answers 503.
 */
export type AttestationConfig =
  | { kind: "disabled" }
  | { kind: "appAttest"; appId: string; environment: AppAttestEnvironment }
  | { kind: "unsupported"; detail: string };

export const ATTESTATION_VALUES = ["disabled", "required"] as const;

export interface AttestationBindings {
  REPORT_ATTESTATION?: string;
  /** `<App ID prefix (Team ID)>.<bundle identifier>`. Deployment configuration, never committed. */
  REPORT_APP_ATTEST_APP_ID?: string;
  /** `development` or `production`: which aaguid this deployment accepts. */
  REPORT_APP_ATTEST_ENVIRONMENT?: string;
}

/** A 10-character App ID prefix, a period, and a reverse-DNS bundle identifier. */
const APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function attestationConfig(env: AttestationBindings): AttestationConfig {
  const value = env.REPORT_ATTESTATION;
  if (value === undefined || value === "disabled") return { kind: "disabled" };
  if (value !== "required") {
    return { kind: "unsupported", detail: `REPORT_ATTESTATION must be one of: ${ATTESTATION_VALUES.join(", ")}` };
  }
  const appId = env.REPORT_APP_ATTEST_APP_ID;
  const environment = env.REPORT_APP_ATTEST_ENVIRONMENT;
  if (appId === undefined || !APP_ID.test(appId)) {
    return { kind: "unsupported", detail: "report attestation is required but REPORT_APP_ATTEST_APP_ID is missing or malformed" };
  }
  if (environment !== "development" && environment !== "production") {
    return { kind: "unsupported", detail: "report attestation is required but REPORT_APP_ATTEST_ENVIRONMENT must be development or production" };
  }
  return { kind: "appAttest", appId, environment };
}

/** The only status a schema-1 (unattested) report can honestly record. */
export const ATTESTATION_STATUS_V1: AttestationStatus = "notProvided";
