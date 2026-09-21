// D1 state for App Attest (migration 0007): challenges, registered keys and the assertion counter.
//
// Concurrency model. D1 executes one statement — and one batch — at a time against a database, so
// each statement below is atomic, and the guarantees come from making every check-and-set a single
// statement or a single batch rather than a read followed by a write:
//   - issuance: INSERT … SELECT … WHERE (outstanding count) < cap — one statement;
//   - consumption: UPDATE … WHERE consumed_at IS NULL RETURNING — exactly one caller gets the row;
//   - registration: INSERT … ON CONFLICT DO NOTHING RETURNING — exactly one caller registers a key;
//   - counter: the app_attest_keys trigger aborts any non-increasing update, and the report write
//     batches that update with the report insert, so the loser of a race stores nothing.

import { type Db, isoSeconds } from "../db.ts";
import { base64Encode, fromHex, hex } from "./bytes.ts";
import type { AppAttestEnvironment } from "./verify.ts";

export type ChallengePurpose = "registration" | "report";

/** Short on purpose: a challenge is fetched immediately before the call that uses it. */
export const CHALLENGE_TTL_SECONDS = 300;
/** Outstanding (unconsumed, unexpired) registration challenges across the deployment. */
export const MAX_OUTSTANDING_REGISTRATION_CHALLENGES = 1000;
/** Outstanding report challenges per registered key. */
export const MAX_OUTSTANDING_REPORT_CHALLENGES_PER_KEY = 3;

export const COUNTER_RACE_MESSAGE = "app_attest_keys: sign_count must strictly increase";

export interface IssuedChallenge {
  challenge: string;
  purpose: ChallengePurpose;
  expiresAt: string;
}

export function newChallenge(): string {
  return base64Encode(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Issues a challenge, or returns null when the outstanding cap is reached. The count and the
 * insert are one statement, so concurrent issuance cannot overshoot the cap.
 */
export async function issueChallenge(
  db: Db,
  request: { purpose: "registration" } | { purpose: "report"; keyId: string },
  now: Date,
  challenge: string = newChallenge(),
): Promise<IssuedChallenge | null> {
  const issuedAt = isoSeconds(now);
  const expiresAt = isoSeconds(new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000));
  const keyId = request.purpose === "report" ? request.keyId : null;
  const cap = request.purpose === "report" ? MAX_OUTSTANDING_REPORT_CHALLENGES_PER_KEY : MAX_OUTSTANDING_REGISTRATION_CHALLENGES;
  const row = await db.prepare(
    `INSERT INTO app_attest_challenges (challenge, purpose, key_id, issued_at, expires_at, consumed_at)
     SELECT ?, ?, ?, ?, ?, NULL
      WHERE (SELECT count(*) FROM app_attest_challenges
              WHERE purpose = ? AND key_id IS ? AND consumed_at IS NULL AND expires_at > ?) < ?
     RETURNING challenge`,
  ).bind(challenge, request.purpose, keyId, issuedAt, expiresAt, request.purpose, keyId, issuedAt, cap).first<{ challenge: string }>();
  return row === null ? null : { challenge: row.challenge, purpose: request.purpose, expiresAt };
}

export type ConsumedChallenge =
  | { ok: true }
  | { ok: false; reason: "unknown" | "alreadyConsumed" | "expired" | "wrongPurpose" | "wrongKey" };

/**
 * Consumes a challenge before anything is verified with it. Whatever happens next — a bad
 * signature, a lost counter race, a rate limit — the challenge stays consumed, so it can never be
 * retried. Exactly one concurrent caller can win the UPDATE.
 */
export async function consumeChallenge(
  db: Db,
  challenge: string,
  expected: { purpose: ChallengePurpose; keyId: string | null },
  now: Date,
): Promise<ConsumedChallenge> {
  const at = isoSeconds(now);
  const row = await db.prepare(
    `UPDATE app_attest_challenges SET consumed_at = ?
      WHERE challenge = ? AND consumed_at IS NULL
      RETURNING purpose, key_id, expires_at`,
  ).bind(at, challenge).first<{ purpose: ChallengePurpose; key_id: string | null; expires_at: string }>();
  if (row === null) {
    const exists = await db.prepare("SELECT 1 AS present FROM app_attest_challenges WHERE challenge = ?").bind(challenge).first();
    return { ok: false, reason: exists === null ? "unknown" : "alreadyConsumed" };
  }
  if (row.expires_at <= at) return { ok: false, reason: "expired" };
  if (row.purpose !== expected.purpose) return { ok: false, reason: "wrongPurpose" };
  if (row.key_id !== expected.keyId) return { ok: false, reason: "wrongKey" };
  return { ok: true };
}

export interface RegisteredKey {
  keyId: string;
  publicKey: Uint8Array;
  environment: AppAttestEnvironment;
  signCount: number;
}

export async function readKey(db: Db, keyId: string): Promise<RegisteredKey | null> {
  const row = await db.prepare(
    "SELECT key_id, public_key, environment, sign_count FROM app_attest_keys WHERE key_id = ?",
  ).bind(keyId).first<{ key_id: string; public_key: string; environment: AppAttestEnvironment; sign_count: number }>();
  if (row === null) return null;
  return { keyId: row.key_id, publicKey: fromHex(row.public_key), environment: row.environment, signCount: row.sign_count };
}

/** Returns false when the key (or its public key) is already registered. */
export async function registerKey(
  db: Db,
  key: { keyId: string; publicKey: Uint8Array; environment: AppAttestEnvironment },
  now: Date,
): Promise<boolean> {
  const row = await db.prepare(
    `INSERT INTO app_attest_keys (key_id, public_key, environment, sign_count, registered_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT DO NOTHING
     RETURNING key_id`,
  ).bind(key.keyId, hex(key.publicKey), key.environment, isoSeconds(now)).first();
  return row !== null;
}

/**
 * The counter advance, as a statement to batch with the report insert. It is unconditional on
 * purpose: a WHERE sign_count < ? guard would turn a lost race into a silent no-op beside a stored
 * report, whereas the trigger turns it into an abort of the whole batch.
 */
export function advanceCounterStatement(db: Db, keyId: string, counter: number) {
  return db.prepare("UPDATE app_attest_keys SET sign_count = ? WHERE key_id = ?").bind(counter, keyId);
}

export function isCounterRace(e: unknown): boolean {
  return e instanceof Error && e.message.includes(COUNTER_RACE_MESSAGE);
}

/** Retention (ADR-0007 §4): an expired challenge is useless either way, consumed or not. */
export function purgeExpiredChallengesStatement(db: Db, now: Date) {
  return db.prepare("DELETE FROM app_attest_challenges WHERE expires_at <= ?").bind(isoSeconds(now));
}
