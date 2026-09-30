// The reviewed community source (ADR-0007 §2, NATIONWIDE_DATA_STRATEGY §8, Issue #123): the `userReport`
// SourceAdapter for the sanitized artifact a community reconciliation application writes
// (./community-reconciliation.ts). It is not fetched from anywhere, so it is not in SOURCE_ADAPTERS (the
// scheduled checks and the fixture-driven pipeline iterate that list); it is in REVIEWED_SOURCES, so the
// registry row still comes from this repository and never from the importer.
//
// One release = one applied application = one record. The artifact carries only what the review decided: the
// application ID, the claim, the adopted location, the evidence report IDs, the reconciliation version and (v2)
// the rights basis: the one terms version every evidence report consented to, or '' when they did not all
// consent to the same version. Nothing a reporter wrote, no submitter key and no observation date exists in it
// (ADR-0007 §3, §4). The publication gate reads the rights basis (migration 0021, Issue #124).

import { TERMS_VERSION } from "../reports/terms.ts";
import { parseCsv } from "./csv.ts";
import type { ReviewedSource } from "./registry.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const COMMUNITY_SOURCE_ID = "mannerpath-community-reports";
export const COMMUNITY_PARSER_VERSION = "community-artifact-csv.v2";
export const COMMUNITY_MAPPING_VERSION = "community-mapping.v1";
export const COMMUNITY_RESOLVER_VERSION = "community-resolver.v1";
/** v1 (#126) had no rights basis; its records parse unchanged and never publish (0021 reads index 6). */
export const COMMUNITY_HEADER_V1 = [
  "application_id", "claim_type", "latitude", "longitude", "evidence_report_ids", "reconciliation_version",
] as const;
export const COMMUNITY_HEADER = [...COMMUNITY_HEADER_V1, "terms_version"] as const;

/**
 * Blocked: no terms or consent currently let MannerPath republish user submissions (Issue #124), so there is no
 * license or attribution to review yet. Reconciliation, resolution and cross-source review work; publication and
 * promotion refuse this source until that amendment and a docs/SOURCES.md review change this entry.
 */
export const COMMUNITY_REGISTRY: ReviewedSource = {
  sourceId: COMMUNITY_SOURCE_ID,
  displayName: "MannerPath 利用者報告（審査済み）",
  kind: "userReport",
  licenseName: null,
  licenseUrl: null,
  attributionText: null,
  publicationStatus: "blocked",
};

// Decimal degrees exactly as JavaScript prints a finite number: no exponent, no NaN/Infinity, no padding.
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const REPORT_IDS = /^rp_[0-9A-HJKMNP-TV-Z]{26}( rp_[0-9A-HJKMNP-TV-Z]{26})+$/;

function coordinate(text: string, column: string): number {
  if (!DECIMAL.test(text)) throw new Error(`community: ${column} is not a plain decimal: ${JSON.stringify(text)}`);
  return Number(text);
}

export function observeCommunityRecord(values: readonly string[]): SourceObservation {
  const [applicationId, claimType, latitude, longitude, reportIds, version, terms = ""] = values;
  if (!/^ca_[0-9A-HJKMNP-TV-Z]{26}$/.test(applicationId)) throw new Error("community: malformed application_id");
  if (claimType !== "newSpot") throw new Error(`community: unsupported claim_type ${JSON.stringify(claimType)}`);
  if (!REPORT_IDS.test(reportIds)) throw new Error("community: evidence_report_ids must name at least two reports");
  if (version !== "community-reconciliation.v1") throw new Error(`community: unsupported reconciliation_version ${JSON.stringify(version)}`);
  if (terms !== "" && !TERMS_VERSION.test(terms)) throw new Error(`community: malformed terms_version ${JSON.stringify(terms)}`);
  return {
    // A report proposes a place, not a name; nothing is invented for it.
    name: null,
    latitude: coordinate(latitude, "latitude"),
    longitude: coordinate(longitude, "longitude"),
    supportsPaper: "unknown",
    supportsHeated: "unknown",
    openingHours: { status: "none", raw: null, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: ["application_id", "claim_type", "evidence_report_ids"], rule: "community.reviewedNewSpot.v1" },
      { field: "lifecycle", columns: ["application_id", "claim_type"], rule: "community.reviewedNewSpot.v1" },
      { field: "location", columns: ["latitude", "longitude"], rule: "community.adoptedReportPin.v1" },
    ],
  };
}

export const COMMUNITY_ADAPTER: SourceAdapter = {
  registry: COMMUNITY_REGISTRY,
  parserVersion: COMMUNITY_PARSER_VERSION,
  resolverVersion: COMMUNITY_RESOLVER_VERSION,
  mappingVersion: COMMUNITY_MAPPING_VERSION,
  parse(bytes) {
    const parsed = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    const header = JSON.stringify(parsed.header);
    if (header !== JSON.stringify(COMMUNITY_HEADER) && header !== JSON.stringify(COMMUNITY_HEADER_V1)) {
      throw new Error(`community: unexpected header ${JSON.stringify(parsed.header)}`);
    }
    if (parsed.rows.length !== 1) throw new Error(`community: a release carries exactly one application, got ${parsed.rows.length}`);
    return parsed;
  },
  upstreamRowRef: (values) => values[0],
  assertResolvable() {},
  observe: observeCommunityRecord,
  attenuate: () => [],
  attenuationReference: {
    attestationVersion: "community-no-attenuations.v1", referenceKind: "reviewedApplication",
    referenceUrl: "https://github.com/Kounishiyuuki/MannerPath/issues/123", checkedAt: "2026-09-30",
  },
  // Additive: releases never continue one another, so the cross-release matcher is never used.
  crossReleaseValidated: false,
  completeness: "partial",
};

/** The artifact bytes for one application. Deterministic: same decision, same bytes. */
export function communityArtifact(row: {
  applicationId: string; latitude: number; longitude: number; reportIds: readonly string[]; version: string;
  /** The terms version every evidence report consented to, or null when there is no common consent. */
  termsVersion: string | null;
}): Uint8Array {
  const values = [row.applicationId, "newSpot", String(row.latitude), String(row.longitude),
    [...row.reportIds].sort().join(" "), row.version, row.termsVersion ?? ""];
  return new TextEncoder().encode(`${COMMUNITY_HEADER.join(",")}\n${values.join(",")}\n`);
}
