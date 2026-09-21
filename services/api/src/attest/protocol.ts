// The App Attest protocol steps behind the HTTP routes (docs/API.md "App Attest", ADR-0007 §6).
// The routes in src/app.ts only parse, size-check and map these results to responses.
//
// Ordering is part of the security boundary:
//   1. the challenge is consumed first, before any verification, so every request that names a
//      challenge burns it — a failed, replayed or raced request can never retry with it;
//   2. cryptographic verification is pure and writes nothing;
//   3. state changes happen only after verification: a key is inserted only when every
//      attestation check passed, and the counter advance commits in one batch with the report.

import { z } from "zod";
import type { Db } from "../db.ts";
import { base64Decode } from "./bytes.ts";
import { clientDataHash, registrationClientData, reportClientData } from "./binding.ts";
import { type ChallengePurpose, consumeChallenge, readKey, registerKey } from "./store.ts";
import { type AppAttestEnvironment, type AssertionFailure, type AttestationFailure, verifyAssertion, verifyAttestation } from "./verify.ts";

export const KEY_REGISTRATION_SCHEMA_VERSION = 1;
export const CHALLENGE_SCHEMA_VERSION = 1;
/** An attestation object is ~5.5 KB (two certificates and a receipt); base64 and JSON on top. */
export const KEY_REGISTRATION_MAX_BYTES = 16_384;

const base64 = (maxLength: number) => z.string().min(4).max(maxLength).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const ChallengeRequestV1 = z.discriminatedUnion("purpose", [
  z.object({ schemaVersion: z.literal(CHALLENGE_SCHEMA_VERSION), purpose: z.literal("registration") }).strict(),
  z.object({ schemaVersion: z.literal(CHALLENGE_SCHEMA_VERSION), purpose: z.literal("report"), keyId: base64(44) }).strict(),
]);

export const KeyRegistrationRequestV1 = z.object({
  schemaVersion: z.literal(KEY_REGISTRATION_SCHEMA_VERSION),
  keyId: base64(44),
  challenge: base64(44),
  attestationObject: base64(KEY_REGISTRATION_MAX_BYTES),
}).strict();

export type KeyRegistrationRequestV1 = z.infer<typeof KeyRegistrationRequestV1>;

/**
 * Why a submission was definitively refused. Each tells the client what to do next, and none is
 * ambiguous: nothing was stored and no counter moved (docs/API.md).
 */
export type RejectionReason =
  | "challengeInvalid" // unknown, expired, consumed, wrong purpose or key — fetch a new challenge
  | "keyNotRegistered" // the server has no such key — generate and register a new key
  | "attestationInvalid" // registration failed verification — generate a new key
  | "assertionInvalid" // the assertion failed verification — this key is unusable; register a new one
  | "counterNotIncreasing"; // a newer assertion from this key already won — fetch a new challenge

export type Rejected = { ok: false; reason: RejectionReason; detail: string };

export interface AppAttestContext {
  db: Db;
  appId: string;
  environment: AppAttestEnvironment;
  /** The deployment's accepted CFBundleVersion values, for both attestation and assertion. */
  bundleVersions: readonly string[];
  trustAnchor: Uint8Array;
  now: Date;
}

/** Decodes a 32-byte base64 value (key ID or challenge); null when it is anything else. */
export function decode32(text: string): Uint8Array | null {
  const bytes = base64Decode(text);
  return bytes !== null && bytes.length === 32 ? bytes : null;
}

async function consume(ctx: AppAttestContext, challenge: string, purpose: ChallengePurpose, keyId: string | null): Promise<Rejected | null> {
  const consumed = await consumeChallenge(ctx.db, challenge, { purpose, keyId }, ctx.now);
  return consumed.ok ? null : { ok: false, reason: "challengeInvalid", detail: `challenge ${consumed.reason}` };
}

export async function registerAppAttestKey(
  ctx: AppAttestContext,
  request: KeyRegistrationRequestV1,
): Promise<{ ok: true } | { ok: false; reason: "alreadyRegistered" } | Rejected | { ok: false; reason: "malformed"; detail: string }> {
  const keyId = decode32(request.keyId);
  const challenge = decode32(request.challenge);
  const attestationObject = base64Decode(request.attestationObject);
  if (keyId === null || challenge === null || attestationObject === null) {
    return { ok: false, reason: "malformed", detail: "keyId and challenge must be 32 bytes and every field canonical base64" };
  }

  const burned = await consume(ctx, request.challenge, "registration", null);
  if (burned !== null) return burned;
  if ((await readKey(ctx.db, request.keyId)) !== null) return { ok: false, reason: "alreadyRegistered" };

  const verdict = await verifyAttestation({
    attestationObject,
    keyId,
    clientDataHash: await clientDataHash(registrationClientData(challenge, keyId)),
    appId: ctx.appId,
    environment: ctx.environment,
    now: ctx.now,
    trustAnchor: ctx.trustAnchor,
    acceptedBundleVersions: ctx.bundleVersions,
  });
  if (!verdict.ok) return { ok: false, reason: "attestationInvalid", detail: verdict.reason satisfies AttestationFailure };

  const inserted = await registerKey(ctx.db, { keyId: request.keyId, publicKey: verdict.publicKey, environment: ctx.environment }, ctx.now);
  return inserted ? { ok: true } : { ok: false, reason: "alreadyRegistered" };
}

/**
 * Verifies a v2 submission's assertion over the exact payload bytes. On success it returns the
 * counter the caller must commit together with the report (src/attest/store.ts
 * advanceCounterStatement); nothing has been written except the consumed challenge.
 */
export async function verifyReportAssertion(
  ctx: AppAttestContext,
  attestation: { keyId: string; challenge: string; assertion: string },
  payload: Uint8Array,
): Promise<{ ok: true; counter: number } | Rejected> {
  const keyId = decode32(attestation.keyId)!;
  const challenge = decode32(attestation.challenge)!;
  const assertion = base64Decode(attestation.assertion);

  const key = await readKey(ctx.db, attestation.keyId);
  if (key === null) return { ok: false, reason: "keyNotRegistered", detail: "no registered App Attest key with this keyId" };
  if (assertion === null) return { ok: false, reason: "assertionInvalid", detail: "malformed" };
  if (key.environment !== ctx.environment) return { ok: false, reason: "assertionInvalid", detail: "environmentMismatch" };

  const verdict = await verifyAssertion({
    assertion,
    clientDataHash: await clientDataHash(reportClientData(challenge, keyId, payload)),
    publicKey: key.publicKey,
    appId: ctx.appId,
    environment: ctx.environment,
    previousCounter: key.signCount,
    acceptedBundleVersions: ctx.bundleVersions,
  });
  if (!verdict.ok) {
    const reason: RejectionReason = verdict.reason === "counterNotIncreasing" ? "counterNotIncreasing" : "assertionInvalid";
    return { ok: false, reason, detail: verdict.reason satisfies AssertionFailure };
  }
  return { ok: true, counter: verdict.counter };
}

/** Burns the report challenge named by a submission. Called before the payload is even decoded. */
export function consumeReportChallenge(ctx: AppAttestContext, challenge: string, keyId: string): Promise<Rejected | null> {
  return consume(ctx, challenge, "report", keyId);
}
