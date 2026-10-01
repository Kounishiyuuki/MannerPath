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
import { type AttestationBindings, attestationConfig } from "../reports/attestation.ts";
import { REPORT_BODY_MAX_BYTES, REPORT_NOTE_MAX, REPORT_SUBMISSION_MAX_BYTES, reportSchemaRange } from "../reports/dto.ts";
import { CURRENT_REPORT_TERMS, TERMS_VERSION } from "../reports/terms.ts";
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
    // Whether POST /v1/reports accepts submissions on this deployment. It is false exactly when the
    // attestation configuration is unrecognised or incomplete, because the endpoint then fails
    // closed with 503 (ADR-0007 §6) — a client reads this to hide the report entry point instead of
    // walking the user into a guaranteed failure.
    available: z.boolean(),
    // Which report protocol this deployment speaks, so a client never infers it from failures:
    // "none" — schema 1, no attestation; "appAttest" — schema 2, App Attest key + one-time
    // challenge + request-bound assertion (docs/API.md). Not a feature flag: it is the same
    // derivation the report handler uses.
    attestation: z.enum(["none", "appAttest"]),
    // The report JSON limit: the v1 body, or the decoded v2 payload.
    maxBodyBytes: z.number().int().min(1),
    // The whole v2 envelope limit (base64 payload + assertion).
    maxSubmissionBytes: z.number().int().min(1),
    noteMaxLength: z.number().int().min(1),
    // The report terms version a client must show and a report must accept (Issue #124). A client whose
    // bundled terms document has another version cannot collect valid consent and must ask for an update.
    termsVersion: z.string().regex(TERMS_VERSION),
    // Whether a `missing` report may carry the ADR-0012 `claim` object. The report schema is strict, so a client
    // sends it only where this is true; a deployment before migration 0023 omits the field (read it as false).
    newSpotClaims: z.boolean(),
    // ADR-0013: whether POST /v1/reports accepts the existing-spot finding types (`notFound`, `removed`,
    // `typeChanged`) and correction claims. A client sends them only when this is true.
    existingSpotFindings: z.boolean(),
  }).strict(),
}).strict().refine(
  (c) => CONFIG_RESOURCES.every((r) => c.minimumSupportedSchemaVersions[r] <= c.schemaVersions[r]),
  "a resource's minimum supported schema version cannot exceed the version it serves",
);

export type ConfigBodyV1 = z.infer<typeof ConfigBodyV1>;

/**
 * Builds the body from the canonical constants and the attestation bindings. Only derived values
 * are exposed — availability, protocol and schema range — never a configured value (the App ID
 * and environment in particular stay server-side).
 */
export function configBody(env: AttestationBindings, opts: { reportStore?: boolean } = {}): ConfigBodyV1 {
  const attestation = attestationConfig(env);
  const report = reportSchemaRange(attestation);
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    apiVersion: "v1",
    dataTileZoom: DATA_TILE_ZOOM,
    schemaVersions: {
      tile: TILE_SCHEMA_VERSION,
      spotDetail: SPOT_DETAIL_SCHEMA_VERSION,
      report: report.current,
    },
    minimumSupportedSchemaVersions: {
      tile: MINIMUM_TILE_SCHEMA_VERSION,
      spotDetail: MINIMUM_SPOT_DETAIL_SCHEMA_VERSION,
      report: report.minimum,
    },
    reports: {
      // A deployment without its durable report store (REPORTS_DB, ADR-0014) takes no report at all.
      available: attestation.kind !== "unsupported" && opts.reportStore !== false,
      attestation: attestation.kind === "disabled" ? "none" : "appAttest",
      maxBodyBytes: REPORT_BODY_MAX_BYTES,
      maxSubmissionBytes: attestation.kind === "disabled" ? REPORT_BODY_MAX_BYTES : REPORT_SUBMISSION_MAX_BYTES,
      noteMaxLength: REPORT_NOTE_MAX,
      termsVersion: CURRENT_REPORT_TERMS.version,
      newSpotClaims: true,
      existingSpotFindings: true,
    },
  };
}
