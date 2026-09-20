// GET /v1/config response body, schemaVersion 1 (docs/API.md). This is a compatibility contract,
// not a settings channel: it carries only values a client cannot hard-code safely, and every one of
// them is read from the canonical constant that the serving code itself uses, so the document can
// never drift from behaviour. Nothing here is secret, and nothing here is per-user — the body is
// identical for every caller of a given deployment.

import { z } from "zod";
import { DATA_TILE_ZOOM } from "../geo/tile.ts";
import { attestationConfig } from "../reports/attestation.ts";
import { REPORT_BODY_MAX_BYTES, REPORT_NOTE_MAX, REPORT_SCHEMA_VERSION } from "../reports/dto.ts";
import { SPOT_DETAIL_SCHEMA_VERSION } from "../spots/dto.ts";
import { TILE_SCHEMA_VERSION } from "../tiles/dto.ts";

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * The oldest DTO schemaVersion this deployment still serves. A client whose highest supported
 * schema version is below this must ask the user to update rather than decode responses it cannot
 * interpret. Raising it is a breaking change and needs a new ADR/API revision.
 */
export const MINIMUM_SUPPORTED_SCHEMA_VERSION = 1;

export const ConfigBodyV1 = z.object({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  apiVersion: z.literal("v1"),
  minimumSupportedSchemaVersion: z.number().int().min(1),
  dataTileZoom: z.number().int().min(0),
  schemaVersions: z.object({
    tile: z.number().int().min(1),
    spotDetail: z.number().int().min(1),
    report: z.number().int().min(1),
  }).strict(),
  reports: z.object({
    // Whether POST /v1/reports accepts submissions on this deployment. It is false whenever the
    // attestation policy is enforcing or unrecognised, because the endpoint then fails closed with
    // 503 (ADR-0007 §6, Issue #37) — a client reads this to hide the report entry point instead of
    // walking the user into a guaranteed failure.
    available: z.boolean(),
    maxBodyBytes: z.number().int().min(1),
    noteMaxLength: z.number().int().min(1),
  }).strict(),
}).strict();

export type ConfigBodyV1 = z.infer<typeof ConfigBodyV1>;

/**
 * Builds the body from the canonical constants. `reportAttestation` is the raw REPORT_ATTESTATION
 * binding; only the derived availability boolean is exposed, never the configured value itself.
 */
export function configBody(reportAttestation: string | undefined): ConfigBodyV1 {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    apiVersion: "v1",
    minimumSupportedSchemaVersion: MINIMUM_SUPPORTED_SCHEMA_VERSION,
    dataTileZoom: DATA_TILE_ZOOM,
    schemaVersions: {
      tile: TILE_SCHEMA_VERSION,
      spotDetail: SPOT_DETAIL_SCHEMA_VERSION,
      report: REPORT_SCHEMA_VERSION,
    },
    reports: {
      available: attestationConfig(reportAttestation).kind === "disabled",
      maxBodyBytes: REPORT_BODY_MAX_BYTES,
      noteMaxLength: REPORT_NOTE_MAX,
    },
  };
}
