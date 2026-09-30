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
export const COMMUNITY_PARSER_VERSION = "community-artifact-csv.v3";
export const COMMUNITY_MAPPING_VERSION = "community-mapping.v2";
export const COMMUNITY_RESOLVER_VERSION = "community-resolver.v1";
/** v1 (#126) had no rights basis; its records parse unchanged and never publish (0021 reads index 6). */
export const COMMUNITY_HEADER_V1 = [
  "application_id", "claim_type", "latitude", "longitude", "evidence_report_ids", "reconciliation_version",
] as const;
export const COMMUNITY_HEADER_V2 = [...COMMUNITY_HEADER_V1, "terms_version"] as const;
/**
 * v3 (ADR-0012): the evidence tier, the independent submitter count, and the classification the reviewed reports
 * agree on. The rights basis stays at index 6, where 0021 reads it. Only structured claims travel; the reports'
 * free text (note, host name, hours note) never does.
 */
export const COMMUNITY_HEADER = [...COMMUNITY_HEADER_V2, "evidence_tier", "independent_confirmations", "spot_type", "spot_subtype",
  "access_type", "access_detail", "host_type", "environment", "supports_paper", "supports_heated"] as const;

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
const ONE_OR_MORE_REPORT_IDS = /^rp_[0-9A-HJKMNP-TV-Z]{26}( rp_[0-9A-HJKMNP-TV-Z]{26})*$/;

export const SPOT_TYPES = ["designatedOutdoorArea", "publicSmokingRoom", "facilitySmokingRoom", "ashtray", "smokingPermittedVenue", "unknown"] as const;
export const SPOT_SUBTYPES = ["smokingCorner", "tobaccoShopSmokingSpace"] as const;
export const ACCESS_TYPES = ["public", "customerOnly", "facilityOnly", "unknown"] as const;
export const ACCESS_DETAILS = ["ticketedUsersOnly"] as const;
export const HOST_TYPES = ["municipality", "station", "airport", "commercialBuilding", "convenienceStore", "tobaccoShop", "restaurantOrCafe", "other", "unknown"] as const;
export const ENVIRONMENTS = ["indoor", "outdoor", "covered", "unknown"] as const;
const TRI = ["yes", "no", "unknown"] as const;

function oneOf<T extends string>(values: readonly T[], text: string, column: string): T {
  if (!(values as readonly string[]).includes(text)) throw new Error(`community: unsupported ${column} ${JSON.stringify(text)}`);
  return text as T;
}

function optionalOneOf<T extends string>(values: readonly T[], text: string, column: string): T | null {
  return text === "" ? null : oneOf(values, text, column);
}

function coordinate(text: string, column: string): number {
  if (!DECIMAL.test(text)) throw new Error(`community: ${column} is not a plain decimal: ${JSON.stringify(text)}`);
  return Number(text);
}

export function observeCommunityRecord(values: readonly string[]): SourceObservation {
  const [applicationId, claimType, latitude, longitude, reportIds, version, terms = ""] = values;
  const tiered = values.length === COMMUNITY_HEADER.length;
  if (!/^ca_[0-9A-HJKMNP-TV-Z]{26}$/.test(applicationId)) throw new Error("community: malformed application_id");
  if (claimType !== "newSpot") throw new Error(`community: unsupported claim_type ${JSON.stringify(claimType)}`);
  if (version !== "community-reconciliation.v1") throw new Error(`community: unsupported reconciliation_version ${JSON.stringify(version)}`);
  if (terms !== "" && !TERMS_VERSION.test(terms)) throw new Error(`community: malformed terms_version ${JSON.stringify(terms)}`);
  if (!tiered) {
    if (!REPORT_IDS.test(reportIds)) throw new Error("community: evidence_report_ids must name at least two reports");
    return untieredObservation(latitude, longitude);
  }
  const [, , , , , , , tier, submitters, spotType, spotSubtype, accessType, accessDetail, hostType, environment, paper, heated] = values;
  if (!ONE_OR_MORE_REPORT_IDS.test(reportIds)) throw new Error("community: malformed evidence_report_ids");
  const evidence = oneOf(["communityReported", "communityVerified"] as const, tier, "evidence_tier");
  const reports = reportIds.split(" ").length;
  const count = /^[1-9][0-9]*$/.test(submitters) ? Number(submitters) : NaN;
  // The tier rule (community-tiers.v1): one report is reported; verified needs two independent submitters.
  if (evidence === "communityReported" ? reports !== 1 || count !== 1 : reports < 2 || count !== reports) {
    throw new Error(`community: ${tier} does not match ${reports} report(s) from ${submitters} submitter(s)`);
  }
  const accessT = oneOf(ACCESS_TYPES, accessType, "access_type");
  const detail = optionalOneOf(ACCESS_DETAILS, accessDetail, "access_detail");
  if (detail !== null && accessT !== "facilityOnly") throw new Error("community: ticketedUsersOnly refines facilityOnly only");
  const base = untieredObservation(latitude, longitude);
  // Provenance names only the fields the reports actually stated; an unknown claim has no evidence.
  const claimed = (field: string, column: string, value: string) =>
    value === "" || value === "unknown" ? [] : [{ field, columns: ["application_id", column], rule: "community.agreedClaim.v1" }];
  return {
    ...base,
    supportsPaper: oneOf(TRI, paper, "supports_paper"),
    supportsHeated: oneOf(TRI, heated, "supports_heated"),
    classification: {
      spotType: oneOf(SPOT_TYPES, spotType, "spot_type"),
      spotSubtype: optionalOneOf(SPOT_SUBTYPES, spotSubtype, "spot_subtype"),
      accessType: accessT,
      accessDetail: detail,
      hostType: optionalOneOf(HOST_TYPES, hostType, "host_type"),
      environment: oneOf(ENVIRONMENTS, environment, "environment"),
    },
    existenceEvidence: evidence,
    communityConfirmations: count,
    provenance: [
      ...base.provenance,
      ...claimed("spotType", "spot_type", spotType),
      ...claimed("accessType", "access_type", accessType),
      ...claimed("hostType", "host_type", hostType),
      ...claimed("environment", "environment", environment),
      ...claimed("supportsPaper", "supports_paper", paper),
      ...claimed("supportsHeated", "supports_heated", heated),
    ],
  };
}

function untieredObservation(latitude: string, longitude: string): SourceObservation {
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
    if (![COMMUNITY_HEADER, COMMUNITY_HEADER_V2, COMMUNITY_HEADER_V1].some((h) => header === JSON.stringify(h))) {
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

/** The structured claims the evidence reports agree on (community-reconciliation.agreedClaims). */
export interface AgreedClaims {
  spotType: (typeof SPOT_TYPES)[number];
  spotSubtype: (typeof SPOT_SUBTYPES)[number] | null;
  accessType: (typeof ACCESS_TYPES)[number];
  accessDetail: (typeof ACCESS_DETAILS)[number] | null;
  hostType: (typeof HOST_TYPES)[number] | null;
  environment: (typeof ENVIRONMENTS)[number];
  supportsPaper: (typeof TRI)[number];
  supportsHeated: (typeof TRI)[number];
}

/** The artifact bytes for one application. Deterministic: same decision, same bytes. */
export function communityArtifact(row: {
  applicationId: string; latitude: number; longitude: number; reportIds: readonly string[]; version: string;
  /** The terms version every evidence report consented to, or null when there is no common consent. */
  termsVersion: string | null;
  tier: "communityReported" | "communityVerified";
  independentSubmitters: number;
  claims: AgreedClaims;
}): Uint8Array {
  const c = row.claims;
  const values = [row.applicationId, "newSpot", String(row.latitude), String(row.longitude),
    [...row.reportIds].sort().join(" "), row.version, row.termsVersion ?? "", row.tier, String(row.independentSubmitters),
    c.spotType, c.spotSubtype ?? "", c.accessType, c.accessDetail ?? "", c.hostType ?? "", c.environment,
    c.supportsPaper, c.supportsHeated];
  return new TextEncoder().encode(`${COMMUNITY_HEADER.join(",")}\n${values.join(",")}\n`);
}
