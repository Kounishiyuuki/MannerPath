// Report idempotency (docs/API.md "POST /reports", migration 0004). The client generates one 256-bit random key per
// report draft and sends it, signed, inside the v3 payload. A retry of the same draft carries the same key with a
// fresh challenge and assertion; the server answers with the report the first attempt created instead of a second one.
//
// What is stored is a digest of the key bound to its owner: the App Attest key whose verified assertion carried it.
// Holding an idempotency key is not ownership. Another App Attest key presenting the same idempotency key (copied,
// guessed, chosen by an attacker or shared between devices) derives a different digest, finds no receipt and is
// treated as its own new draft, so it learns nothing about the owner's report, not even that a receipt exists. The
// owner is the App Attest keyId, not the peppered submitter hash, so a pepper rotation keeps every retry a retry. A
// new App Attest key (re-registration, another device) is a new owner: no receipt carries over (docs/API.md).

import { type Db, type DbStatement, sha256Hex } from "../db.ts";
import { type ReportPayloadV3, quantizeCoordinate } from "./dto.ts";

export const IDEMPOTENCY_DOMAIN = "mannerpath.report-idempotency.v2\n";
export const REQUEST_DOMAIN = "mannerpath.report-request.v1\n";

/**
 * The stored identifier of one owner's idempotency key: the raw key never reaches the database. keyId is canonical
 * 44-character base64 (no newline) and the key 64 lowercase hex, so the framing is unambiguous.
 */
export function idempotencyDigest(keyId: string, idempotencyKey: string): Promise<string> {
  return sha256Hex(`${IDEMPOTENCY_DOMAIN}${keyId}\n${idempotencyKey}`);
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
 * Canonicalization "report-request.v1" (docs/API.md "Request hash"): the report's meaning as the server stores it.
 * - Every validated field is included (schemaVersion, type, spotId, proposedLocation, observedOn, note,
 *   acceptedTermsVersion as the consent, claim) except two: the idempotency key, which names the draft, and
 *   installId, which an attested report never stores (its submitter is the App Attest key).
 * - proposedLocation is quantized exactly as the write stores it, so two pins the store cannot tell apart hash alike.
 * - Strings are hashed as sent, code point for code point: no Unicode normalization, because none is stored.
 * - Numbers use JSON.stringify's shortest round-trip form, so -0 and 0 are one value.
 * Changing any rule here changes stored receipts' meaning: it needs a new REQUEST_DOMAIN, never an edit.
 * Challenge, assertion, envelope and arrival time are not part of the payload, so they never reach this hash.
 */
export function normalizedReport(report: ReportPayloadV3): Record<string, unknown> {
  const { idempotencyKey: _key, installId: _install, ...fields } = report;
  return {
    ...fields,
    proposedLocation: fields.proposedLocation === undefined ? undefined : {
      latitude: quantizeCoordinate(fields.proposedLocation.latitude),
      longitude: quantizeCoordinate(fields.proposedLocation.longitude),
    },
  };
}

export function requestSha256(report: ReportPayloadV3): Promise<string> {
  return sha256Hex(REQUEST_DOMAIN + canonicalJson(normalizedReport(report)));
}

/**
 * A payload whose bytes and parsed value could mean two things: a repeated object member (JSON.parse keeps the last,
 * another parser may keep the first) or a lone UTF-16 surrogate escape, which no UTF-8 store can hold. Both are
 * refused before the hash, so one signed payload has exactly one meaning. `text` must already be valid JSON.
 */
export function ambiguousPayload(text: string): "duplicate_key" | "ill_formed_unicode" | null {
  if (illFormed(JSON.parse(text))) return "ill_formed_unicode";
  const objects: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const members = objects.at(-1);
      if (expectKey && members) {
        const key = JSON.parse(text.slice(i, end + 1)) as string;
        if (members.has(key)) return "duplicate_key";
        members.add(key);
      }
      expectKey = false;
      i = end;
    } else if (c === "{") { objects.push(new Set()); expectKey = true; }
    else if (c === "[") objects.push(null);
    else if (c === "}" || c === "]") objects.pop();
    else if (c === ",") expectKey = objects.at(-1) instanceof Set;
  }
  return null;
}

const illFormed = (value: unknown): boolean => typeof value === "string"
  ? /\p{Cs}/u.test(value)
  : typeof value === "object" && value !== null && Object.entries(value).some(([k, v]) => illFormed(k) || illFormed(v));

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
