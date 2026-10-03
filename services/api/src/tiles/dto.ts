// Tile response body, schemaVersion 1 (docs/API.md). The publisher validates every body against
// this schema before storing it, and serialises it with a fixed key order (the object literals in
// publish.ts) and no whitespace, so equal content always yields byte-identical bodies.

import { z } from "zod";

/** The v1 complete-tile body, still served at GET /v1/tiles/{z}/{x}/{y} for a tile of at most one part. */
export const TILE_SCHEMA_VERSION_V1 = 1;
/** schemaVersion 2 (ADR-0015): a tile is a manifest plus bounded, content-addressed parts. */
export const TILE_SCHEMA_VERSION = 2;
/**
 * The oldest tile body schemaVersion this server still serves. Each resource carries its own
 * minimum because they version independently; /v1/config publishes them (docs/API.md).
 */
export const MINIMUM_TILE_SCHEMA_VERSION = 1;

const triState = z.enum(["yes", "no", "unknown"]);

const openingHours = z.object({
  status: z.enum(["none", "parsed", "unparsed"]),
  raw: z.string().nullable(),
  parsed: z.union([
    z.object({ v: z.literal(1), kind: z.literal("allDay") }).strict(),
    z.object({ v: z.literal(1), kind: z.literal("daily"), opens: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/), closes: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/) }).strict(),
  ]).nullable(),
  timeZone: z.string(),
}).strict().refine((h) => (h.status === "parsed") === (h.parsed !== null), "parsed is present exactly when status is parsed");

// ADR-0012: the separate trust axes of a published spot. Additive to schemaVersion 1 — an older client ignores the
// object (docs/API.md "Forward compatibility") and keeps reading evidenceQuality exactly as before.
export const SPOT_VERIFICATION_VERSION = "spot-verification.v1";
export const EXISTENCE_EVIDENCE = ["official", "operator", "communityVerified", "communityReported"] as const;
// ADR-0017 adds areaApproximate: the pin is a reviewed anchor of the area/host the place is stated to be inside.
export const LOCATION_PRECISION = ["publisherPoint", "reviewedDerived", "communityPinned", "areaApproximate", "unknown"] as const;

export const SpotVerificationV1 = z.object({
  version: z.literal(SPOT_VERIFICATION_VERSION),
  // Who stands behind "this place exists and smoking is permitted there".
  existence: z.enum(EXISTENCE_EVIDENCE),
  // How the pin was placed. Independent of existence: an official listing can carry a derived pin.
  locationPrecision: z.enum(LOCATION_PRECISION),
  // Independent community submitters behind the existence evidence; null for official/operator evidence.
  confirmations: z.number().int().min(1).nullable(),
  // The month the evidence was last reviewed (an official release's observation month, or the month a reviewer
  // applied community evidence). Month precision on purpose: a community review day is close to a report day.
  lastReviewedMonth: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/).nullable(),
  // ADR-0017: the area/host an areaApproximate pin represents, as publicly named by the anchor's publisher. Present
  // exactly when locationPrecision is areaApproximate, so every other spot's bytes are unchanged.
  locationArea: z.object({ name: z.string().min(1).max(80), kind: z.enum(["park", "station", "facility", "airport", "commercialBuilding", "other"]) }).strict().optional(),
}).strict().refine((v) => (v.locationPrecision === "areaApproximate") === (v.locationArea !== undefined),
  "locationArea is present exactly when locationPrecision is areaApproximate");

export const TileSpotV1 = z.object({
  id: z.string().regex(/^sp_[0-9A-HJKMNP-TV-Z]{26}$/),
  name: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // The server emits only these; clients must still tolerate values added later (docs/API.md).
  spotType: z.enum(["designatedOutdoorArea", "publicSmokingRoom", "facilitySmokingRoom", "ashtray", "smokingPermittedVenue", "unknown"]),
  accessType: z.enum(["public", "customerOnly", "facilityOnly", "unknown"]),
  environment: z.enum(["indoor", "outdoor", "covered", "unknown"]),
  supportsPaper: triState,
  supportsHeated: triState,
  openingHours,
  lifecycle: z.literal("active"),
  evidenceQuality: z.string(),
  evidenceQualityVersion: z.string(),
  lastVerifiedAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).nullable(),
  sourceIds: z.array(z.string()).min(1),
  // ADR-0012 additions. `spotType`/`accessType` keep their v1 vocabularies; these refine them.
  spotSubtype: z.enum(["smokingCorner", "tobaccoShopSmokingSpace"]).nullable(),
  hostType: z.enum(["municipality", "station", "airport", "commercialBuilding", "convenienceStore", "tobaccoShop", "restaurantOrCafe", "other", "unknown"]),
  accessDetail: z.enum(["ticketedUsersOnly"]).nullable(),
  verification: SpotVerificationV1,
}).strict();

export const TileSourceV1 = z.object({
  id: z.string(),
  displayName: z.string(),
  licenseName: z.string().nullable(),
  licenseUrl: z.string().nullable(),
  attributionText: z.string().nullable(),
}).strict();

export const TileBodyV1 = z.object({
  schemaVersion: z.literal(TILE_SCHEMA_VERSION_V1),
  tile: z.string(),
  revision: z.number().int().min(1),
  generatedAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/),
  spots: z.array(TileSpotV1),
  sources: z.array(TileSourceV1),
}).strict();

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * One bounded slice of a tile (ADR-0015). It carries no revision or timestamp, so its bytes and hash depend only on
 * its content: an unchanged part keeps its hash across republishes, and the manifest pins every part by hash.
 */
export const TilePartBodyV2 = z.object({
  schemaVersion: z.literal(TILE_SCHEMA_VERSION),
  tile: z.string(),
  part: z.number().int().min(0),
  partCount: z.number().int().min(1),
  spots: z.array(TileSpotV1).min(1),
  sources: z.array(TileSourceV1).min(1),
}).strict().refine((p) => p.part < p.partCount, "part must be below partCount");

/** The tile's complete-snapshot index: every part, in order, by hash. Zero parts is an empty tile. */
export const TileManifestV2 = z.object({
  schemaVersion: z.literal(TILE_SCHEMA_VERSION),
  tile: z.string(),
  revision: z.number().int().min(1),
  generatedAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/),
  partPolicy: z.string(),
  spotCount: z.number().int().min(0),
  parts: z.array(z.object({
    index: z.number().int().min(0),
    spotCount: z.number().int().min(1),
    sha256: SHA256,
  }).strict()),
}).strict().refine((m) => m.parts.every((p, i) => p.index === i), "parts are listed in index order")
  .refine((m) => m.parts.reduce((n, p) => n + p.spotCount, 0) === m.spotCount, "spotCount is the sum of the parts");

export type TileSpotV1 = z.infer<typeof TileSpotV1>;
export type TilePartBodyV2 = z.infer<typeof TilePartBodyV2>;
export type TileManifestV2 = z.infer<typeof TileManifestV2>;
export type SpotVerificationV1 = z.infer<typeof SpotVerificationV1>;
export type TileSourceV1 = z.infer<typeof TileSourceV1>;
export type TileBodyV1 = z.infer<typeof TileBodyV1>;

/** Strong ETag over the schema version and the SHA-256 of the exact stored body (ADR-0005). */
export function tileEtag(schemaVersion: number, contentSha256: string): string {
  return `"${schemaVersion}-${contentSha256}"`;
}
