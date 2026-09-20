// Spot detail response body, schemaVersion 1 (docs/API.md). The spot object repeats the tile DTO's
// spot shape field-for-field (plus its tile ID) so a client decodes the same spot the same way from
// either endpoint, and `sources` uses the tile source shape so attribution is identical offline.

import { z } from "zod";
import { TileSourceV1, TileSpotV1 } from "../tiles/dto.ts";
import { SPOT_ID } from "../spot-id.ts";

export const SPOT_DETAIL_SCHEMA_VERSION = 1;
/** The oldest spot detail schemaVersion this server still serves (docs/API.md). */
export const MINIMUM_SPOT_DETAIL_SCHEMA_VERSION = 1;

export const SpotDetailSpotV1 = TileSpotV1.extend({
  tile: z.string().regex(/^[0-9]+\/[0-9]+\/[0-9]+$/),
}).strict();

// The public provenance vocabulary: the only spot_field_provenance fields this endpoint may emit.
// It is an allowlist, not a mirror of the column's CHECK constraint, so a provenance field added
// later (internal bookkeeping, a future source's attribute) is withheld until it is deliberately
// published here and documented in docs/API.md. The read filters on this list in SQL.
export const PUBLIC_PROVENANCE_FIELDS = [
  "existence", "location", "name", "spotType", "hostType", "accessType", "environment",
  "supportsPaper", "supportsHeated", "openingHours", "feeType", "floor", "entranceNote", "lifecycle",
] as const;

// Public field-level provenance. It names which source and named rule produced a resolved field,
// and when that evidence was observed. Raw source records, source column names, record/release IDs
// and every other internal identifier stay server-side (ADR-0006).
export const SpotProvenanceV1 = z.object({
  field: z.enum(PUBLIC_PROVENANCE_FIELDS),
  sourceId: z.string(),
  rule: z.string(),
  observedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).nullable(),
}).strict();

export const SpotDetailBodyV1 = z.object({
  schemaVersion: z.literal(SPOT_DETAIL_SCHEMA_VERSION),
  // The ID the client asked for. It differs from spot.id exactly when the request followed a merge.
  requestedId: z.string().regex(SPOT_ID),
  // The spot the requested ID was merged into, or null when the requested spot is itself live.
  mergedInto: z.string().regex(SPOT_ID).nullable(),
  spot: SpotDetailSpotV1,
  sources: z.array(TileSourceV1).min(1),
  provenance: z.array(SpotProvenanceV1),
}).strict();

export type SpotDetailSpotV1 = z.infer<typeof SpotDetailSpotV1>;
export type SpotProvenanceV1 = z.infer<typeof SpotProvenanceV1>;
export type SpotDetailBodyV1 = z.infer<typeof SpotDetailBodyV1>;
