// Report attestation policy (ADR-0007 §6). The protocol itself lives in src/attest/; this module
// only decides, from deployment configuration, which report protocol a deployment speaks.
//
// Parsing is exhaustive and fails closed: "required" is enforcing only when the App ID, the App
// Attest environment and the accepted bundle versions are also configured and well-formed, and
// every other value — a typo, "true", whitespace — is a misconfiguration that accepts nothing. No
// value ever silently turns attestation, or any part of it, off.

import type { AppAttestEnvironment } from "../attest/verify.ts";

export type AttestationStatus = "notProvided" | "verified" | "unverified";

/**
 * - disabled: unset or "disabled" — the documented local/test default. Report schema 1, no
 *   attestation material, every report stored `notProvided`.
 * - appAttest: "required" with a valid App ID, environment and bundle-version allowlist. Report
 *   schema 2 only; a report is stored only after its assertion verified, as `verified`.
 * - unsupported: anything else. Every report and App Attest endpoint answers 503.
 */
export type AttestationConfig =
  | { kind: "disabled" }
  | { kind: "appAttest"; appId: string; environment: AppAttestEnvironment; bundleVersions: readonly string[] }
  | { kind: "unsupported"; detail: string };

export const ATTESTATION_VALUES = ["disabled", "required"] as const;

export interface AttestationBindings {
  REPORT_ATTESTATION?: string;
  /** `<App ID prefix (usually the Team ID)>.<bundle identifier>`. Deployment configuration, never committed. */
  REPORT_APP_ATTEST_APP_ID?: string;
  /** `development` or `production`: which aaguid this deployment accepts. */
  REPORT_APP_ATTEST_ENVIRONMENT?: string;
  /** Comma-separated exact CFBundleVersion values accepted in `apple_bundle_version_01`, e.g. `41,42`. */
  REPORT_APP_ATTEST_BUNDLE_VERSIONS?: string;
}

/**
 * A CFBundleVersion as Apple defines it: one to three period-separated non-negative integers.
 * Entries are compared as exact strings, never numerically, because that is what the device reports.
 */
const BUNDLE_VERSION = /^[0-9]+(?:\.[0-9]+){0,2}$/;

/**
 * Parses REPORT_APP_ATTEST_BUNDLE_VERSIONS: a comma-separated, non-empty list with no whitespace,
 * no empty and no duplicate entries. Anything else is null — an unusable allowlist must disable
 * reporting, never bundle-version validation.
 */
export function parseBundleVersions(value: string | undefined): readonly string[] | null {
  if (value === undefined || value.length === 0) return null;
  const entries = value.split(",");
  if (!entries.every((v) => BUNDLE_VERSION.test(v)) || new Set(entries).size !== entries.length) return null;
  return entries;
}

/** A 10-character App ID prefix (usually the Team ID), a period, and a reverse-DNS bundle identifier. */
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
  const bundleVersions = parseBundleVersions(env.REPORT_APP_ATTEST_BUNDLE_VERSIONS);
  if (bundleVersions === null) {
    return { kind: "unsupported", detail: "report attestation is required but REPORT_APP_ATTEST_BUNDLE_VERSIONS is missing or malformed" };
  }
  return { kind: "appAttest", appId, environment, bundleVersions };
}

/** The only status a schema-1 (unattested) report can honestly record. */
export const ATTESTATION_STATUS_V1: AttestationStatus = "notProvided";
