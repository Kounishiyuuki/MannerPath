// App Attest key revocation (migration 0005, docs/OPERATIONS.md "Revoke an App Attest key"). Maintainer-only: the
// CLI (scripts/report-queue.ts) is the only caller; no HTTP route reaches this module. A revocation is permanent and
// append-only, and changes nothing but its own row: reports, moderation and idempotency receipts stay as they are.

import { type Db, isoSeconds } from "../db.ts";
import { decode32 } from "./protocol.ts";

/** Closed codes, never free text: the audit row can hold no personal data, secret or IP address. */
export const REVOCATION_REASONS = ["compromised", "abuse", "maintainerRequest"] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export interface Revocation { keyId: string; reason: RevocationReason; revokedAt: string }

/**
 * Revokes one registered key. One statement: the key must exist, and a second revocation of the same key is a no-op
 * that keeps the first row (its reason and time are the audit record).
 */
export async function revokeKey(db: Db, keyId: string, reason: RevocationReason, now: Date): Promise<"revoked" | "alreadyRevoked" | "unknownKey"> {
  if (decode32(keyId) === null) throw new Error("revoke-key: keyId must be canonical base64 of 32 bytes");
  if (!REVOCATION_REASONS.includes(reason)) throw new Error(`revoke-key: reason must be one of ${REVOCATION_REASONS.join(", ")}`);
  const row = await db.prepare(
    `INSERT INTO app_attest_key_revocations (key_id, reason, revoked_at)
     SELECT key_id, ?, ? FROM app_attest_keys WHERE key_id = ?
     ON CONFLICT DO NOTHING
     RETURNING key_id`,
  ).bind(reason, isoSeconds(now), keyId).first();
  if (row !== null) return "revoked";
  const known = await db.prepare("SELECT 1 AS present FROM app_attest_keys WHERE key_id = ?").bind(keyId).first();
  return known === null ? "unknownKey" : "alreadyRevoked";
}

export async function listRevocations(db: Db): Promise<Revocation[]> {
  const { results } = await db.prepare(
    "SELECT key_id, reason, revoked_at FROM app_attest_key_revocations ORDER BY revoked_at, key_id",
  ).all<{ key_id: string; reason: RevocationReason; revoked_at: string }>();
  return results.map((r) => ({ keyId: r.key_id, reason: r.reason, revokedAt: r.revoked_at }));
}
