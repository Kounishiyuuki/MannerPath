// Report idempotency (docs/API.md "POST /reports", migration 0004). The client generates one 256-bit random key per
// report draft and sends it, signed, inside the v3 payload. A retry of the same draft carries the same key with a
// fresh challenge and assertion; the server answers with the report the first attempt created instead of a second one.
//
// What is stored is a digest of the key alone. It is global on purpose: a 256-bit random key does not collide, and
// scoping it by App Attest key, submitter hash or installId would tie it to a device and would change when the
// pepper or the App Attest key changes, turning a retry into a duplicate.

import { type Db, type DbStatement, sha256Hex } from "../db.ts";
import { type ReportPayloadV3, quantizeCoordinate } from "./dto.ts";

export const IDEMPOTENCY_DOMAIN = "mannerpath.report-idempotency.v1\n";
export const REQUEST_DOMAIN = "mannerpath.report-request.v1\n";

/** The stored identifier of a client idempotency key: the raw key never reaches the database. */
export function idempotencyDigest(idempotencyKey: string): Promise<string> {
  return sha256Hex(IDEMPOTENCY_DOMAIN + idempotencyKey);
}

/**
 * Deterministic JSON: object keys sorted by code unit at every level, no whitespace, JSON.stringify's own string and
 * number encoding. Only the shapes a validated report can contain are accepted.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
}

/**
 * The report's meaning as the server stores it: every validated field except the idempotency key, with the same
 * normalization the write applies (the proposed pin quantized, the installId lower-cased as the abuse key reads it).
 * Challenge, assertion, envelope and arrival time are not part of the payload, so they never reach this hash.
 */
export function normalizedReport(report: ReportPayloadV3): Record<string, unknown> {
  const { idempotencyKey: _key, ...fields } = report;
  return {
    ...fields,
    installId: fields.installId.toLowerCase(),
    proposedLocation: fields.proposedLocation === undefined ? undefined : {
      latitude: quantizeCoordinate(fields.proposedLocation.latitude),
      longitude: quantizeCoordinate(fields.proposedLocation.longitude),
    },
  };
}

export function requestSha256(report: ReportPayloadV3): Promise<string> {
  return sha256Hex(REQUEST_DOMAIN + canonicalJson(normalizedReport(report)));
}

export interface Receipt {
  reportId: string;
  requestSha256: string | null;
  createdAt: string;
}

export async function readReceipt(db: Db, digest: string): Promise<Receipt | null> {
  const row = await db.prepare(
    "SELECT report_id, request_sha256, created_at FROM report_idempotency WHERE idempotency_digest = ?",
  ).bind(digest).first<{ report_id: string; request_sha256: string | null; created_at: string }>();
  return row === null ? null : { reportId: row.report_id, requestSha256: row.request_sha256, createdAt: row.created_at };
}

/** What a known key means for this request: the same report again, a different report, or a retired receipt. */
export function receiptOutcome(receipt: Receipt, sha256: string): "replay" | "conflict" | "retired" {
  if (receipt.requestSha256 === null) return "retired";
  return receipt.requestSha256 === sha256 ? "replay" : "conflict";
}

/** The receipt insert, batched after the report it names. A second receipt for the digest aborts the batch. */
export function receiptStatement(db: Db, digest: string, reportId: string, sha256: string, createdAt: string): DbStatement {
  return db.prepare(
    "INSERT INTO report_idempotency (idempotency_digest, report_id, request_sha256, created_at) VALUES (?, ?, ?, ?)",
  ).bind(digest, reportId, sha256, createdAt);
}

/** Retention: forget the request hash with the report's personal content; the receipt itself stays. */
export function retireReceiptStatement(db: Db, reportId: string, at: string): DbStatement {
  return db.prepare(
    "UPDATE report_idempotency SET request_sha256 = NULL, retired_at = ? WHERE report_id = ? AND retired_at IS NULL",
  ).bind(at, reportId);
}

/** A batch that lost the receipt race to a concurrent request for the same key. */
export function isReceiptConflict(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed: report_idempotency\.idempotency_digest/.test(e.message);
}
