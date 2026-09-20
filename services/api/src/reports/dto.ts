// POST /v1/reports request and response, schemaVersion 1 (docs/API.md, ADR-0007).
// The request schema is the payload-minimization boundary: it is strict, so a field nobody
// reviewed is rejected rather than silently ignored, and every optional field is allowed only for
// the report types that need it.

import { z } from "zod";
import { SPOT_ID } from "../spot-id.ts";

export const REPORT_SCHEMA_VERSION = 1;
/**
 * The oldest report request schemaVersion the endpoint accepts. ReportRequestV1 pins the request to
 * a literal, so this is the same value until a second request version exists (docs/API.md).
 */
export const MINIMUM_REPORT_SCHEMA_VERSION = 1;

export const REPORT_TYPES = [
  "exists", "missing", "moved", "hoursChanged",
  "tobaccoTypeChanged", "accessChanged", "prohibited", "other",
] as const;

/** Report types that carry a proposed location; every other type must not send one. */
export const LOCATION_REPORT_TYPES: readonly string[] = ["missing", "moved"];

export const REPORT_NOTE_MAX = 280;
/** Bodies larger than this are rejected before parsing (ADR-0007 §5). */
export const REPORT_BODY_MAX_BYTES = 4096;

export const REPORT_ID = /^rp_[0-9A-HJKMNP-TV-Z]{26}$/;

const proposedLocation = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

export const ReportRequestV1 = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  type: z.enum(REPORT_TYPES),
  spotId: z.string().regex(SPOT_ID).optional(),
  // The map pin being proposed, not the device's position (docs/API.md, ADR-0007 §3).
  proposedLocation: proposedLocation.optional(),
  // Day precision by contract, and a real calendar date: z.iso.date() rejects both a finer
  // timestamp and an impossible day such as 2026-02-31 or 2026-19-39 (leap years included).
  observedOn: z.iso.date().optional(),
  note: z.string().min(1).max(REPORT_NOTE_MAX).optional(),
  // Client-generated per install, used only to derive the hashed abuse key. Never stored as sent.
  installId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  // No `attestation` field in v1: App Attest is deferred until the challenge/request-binding
  // protocol exists, and the strict schema rejects attestation material rather than storing a
  // claim it cannot check (ADR-0007 §6).
}).strict().superRefine((r, ctx) => {
  const needsLocation = LOCATION_REPORT_TYPES.includes(r.type);
  if (r.type === "missing" && r.spotId !== undefined) {
    ctx.addIssue({ code: "custom", path: ["spotId"], message: "a missing report proposes a spot that has no id yet" });
  }
  if (r.type !== "missing" && r.spotId === undefined) {
    ctx.addIssue({ code: "custom", path: ["spotId"], message: "required for this report type" });
  }
  if (needsLocation && r.proposedLocation === undefined) {
    ctx.addIssue({ code: "custom", path: ["proposedLocation"], message: "required for this report type" });
  }
  if (!needsLocation && r.proposedLocation !== undefined) {
    ctx.addIssue({ code: "custom", path: ["proposedLocation"], message: "not accepted for this report type" });
  }
});

export const ReportAcceptedV1 = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  reportId: z.string().regex(REPORT_ID),
  // Always pending: acceptance is a later human decision, never a response to a submission.
  state: z.literal("pending"),
  receivedAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/),
}).strict();

export type ReportRequestV1 = z.infer<typeof ReportRequestV1>;
export type ReportAcceptedV1 = z.infer<typeof ReportAcceptedV1>;

/**
 * Issue paths and codes only. A validation message must never echo a submitted value, because an
 * error string is a log line waiting to happen (ADR-0007 §7).
 */
export function validationDetail(error: z.ZodError): string {
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "(body)" : issue.path.join(".");
    seen.add(`${path}: ${issue.code}`);
  }
  return [...seen].sort().join("; ");
}

/** ~1 m, the precision canonical spot data already carries (ADR-0007 §3). */
export function quantizeCoordinate(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
