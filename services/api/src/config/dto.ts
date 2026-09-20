// GET /v1/config response body, schemaVersion 1 (docs/API.md). This is a compatibility contract,
// not a settings channel: it carries only values a client cannot hard-code safely, and every one of
// them is read from the canonical constant that the serving code itself uses, so the document can
// never drift from behaviour. Nothing here is secret, and nothing here is per-user — the body is
// identical for every caller of a given deployment.
//
// Compatibility is expressed per resource, never globally: the tile, spot detail and report bodies
// version independently, so one number could only be a lie about two of them. Each resource
// publishes the closed range [minimumSupportedSchemaVersions, schemaVersions] that this deployment
// serves or accepts.

import { z } from "zod";
import { DATA_TILE_ZOOM } from "../geo/tile.ts";
import { attestationConfig } from "../reports/attestation.ts";
import { MINIMUM_REPORT_SCHEMA_VERSION, REPORT_BODY_MAX_BYTES, REPORT_NOTE_MAX, REPORT_SCHEMA_VERSION } from "../reports/dto.ts";
import { MINIMUM_SPOT_DETAIL_SCHEMA_VERSION, SPOT_DETAIL_SCHEMA_VERSION } from "../spots/dto.ts";
import { MINIMUM_TILE_SCHEMA_VERSION, TILE_SCHEMA_VERSION } from "../tiles/dto.ts";

export const CONFIG_SCHEMA_VERSION = 1;

/** The resources whose schema versions this deployment publishes. */
export const CONFIG_RESOURCES = ["tile", "spotDetail", "report"] as const;

const schemaVersionsByResource = z.object({
  tile: z.number().int().min(1),
  spotDetail: z.number().int().min(1),
  report: z.number().int().min(1),
}).strict();

export const ConfigBodyV1 = z.object({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  apiVersion: z.literal("v1"),
  dataTileZoom: z.number().int().min(0),
  // The newest schemaVersion each resource's body carries (a request body, for `report`).
  schemaVersions: schemaVersionsByResource,
  // The oldest schemaVersion each resource still supports. A client whose decoder for a resource is
  // older than that resource's minimum must ask the user to update — for that resource only.
  minimumSupportedSchemaVersions: schemaVersionsByResource,
  reports: z.object({
    // Whether POST /v1/reports accepts submissions on this deployment. It is false whenever the
    // attestation policy is enforcing or unrecognised, because the endpoint then fails closed with
    // 503 (ADR-0007 §6, Issue #37) — a client reads this to hide the report entry point instead of
    // walking the user into a guaranteed failure.
    available: z.boolean(),
    maxBodyBytes: z.number().int().min(1),
    noteMaxLength: z.number().int().min(1),
  }).strict(),
}).strict().refine(
  (c) => CONFIG_RESOURCES.every((r) => c.minimumSupportedSchemaVersions[r] <= c.schemaVersions[r]),
  "a resource's minimum supported schema version cannot exceed the version it serves",
);

export type ConfigBodyV1 = z.infer<typeof ConfigBodyV1>;

/**
 * Builds the body from the canonical constants. `reportAttestation` is the raw REPORT_ATTESTATION
 * binding; only the derived availability boolean is exposed, never the configured value itself.
 */
export function configBody(reportAttestation: string | undefined): ConfigBodyV1 {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    apiVersion: "v1",
    dataTileZoom: DATA_TILE_ZOOM,
    schemaVersions: {
      tile: TILE_SCHEMA_VERSION,
      spotDetail: SPOT_DETAIL_SCHEMA_VERSION,
      report: REPORT_SCHEMA_VERSION,
    },
    minimumSupportedSchemaVersions: {
      tile: MINIMUM_TILE_SCHEMA_VERSION,
      spotDetail: MINIMUM_SPOT_DETAIL_SCHEMA_VERSION,
      report: MINIMUM_REPORT_SCHEMA_VERSION,
    },
    reports: {
      available: attestationConfig(reportAttestation).kind === "disabled",
      maxBodyBytes: REPORT_BODY_MAX_BYTES,
      noteMaxLength: REPORT_NOTE_MAX,
    },
  };
}
