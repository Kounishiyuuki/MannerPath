// PoC A1 — two-request photo upload (docs/release/V1_KV_PHOTO_A1_POC.md). NOT mounted by createApp.
//
// ① POST /v4/reports/{reportId}/photo-intents, small JSON: the App Attest assertion (own domain, so a v3 photo or report
//    assertion cannot be replayed here) over {reportId, idempotencyKey, terms, mediaType, byteLength, sha256}. Same
//    order and checks as the v3 route minus the image; the counter advance and the intent row commit in one batch.
//    Returns a random 32-byte ticket; D1 stores only its SHA-256.
// ② PUT /v4/photo-uploads/{ticket}, the raw JPEG: bounded read, length + SHA-256 must equal what ① attested, and the
//    full JPEG structure check (forbidden segments included); the ticket is claimed first with one conditional
//    UPDATE … RETURNING (parallel uses: one wins) and released on a mismatch, then attachKvJpeg (attach.ts with fewer
//    round trips) + KvPhotoStore. Retryable failures release the claim; success consumes it for good.
import { APPLE_APP_ATTEST_ROOT_DER } from "../../attest/apple-root.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../../attest/bytes.ts";
import { type AppAttestContext, type Rejected, consumeReportChallenge, decode32 } from "../../attest/protocol.ts";
import { advanceCounterStatement, isCounterRace, isKeyRevoked, readKey } from "../../attest/store.ts";
import { verifyAssertion } from "../../attest/verify.ts";
import { type Db, isoSeconds, sha256Hex } from "../../db.ts";
import { type AttestationBindings, attestationConfig } from "../../reports/attestation.ts";
import { attestedSubmitter, submitterHash } from "../../reports/create.ts";
import { JpegStructureError, validateJpegStructure } from "../../reports/jpeg-structure.ts";
import { PhotoAttachmentError } from "../../reports/photos.ts";
import { CURRENT_REPORT_TERMS, TERMS_VERSION } from "../../reports/terms.ts";
import { PhotoStoreError } from "../binary-photo/d1-photo-store.ts";
import { D1_PHOTO_ERASURE_LEAD_DAYS } from "../binary-photo/erasure.ts";
import { frame } from "../../attest/binding.ts";
import { PHOTO_V3_IMAGE_MAX_BYTES } from "../binary-photo/protocol.ts";
import { attachKvJpeg } from "./attach-kv.ts";
import { type KvPhotoStore, KvPhotoStoreError } from "./kv-photo-store.ts";
import { z } from "zod";

export const PHOTO_INTENT_DOMAIN = "mannerpath.app-attest.photo-intent.v4";
export const TICKET_TTL_MS = 5 * 60_000;

/** REPORTS_DB (same database as the challenge and the key counter, so ① commits atomically). */
export const PHOTO_INTENTS_SCHEMA = `
CREATE TABLE photo_upload_intents (
  ticket_sha256          TEXT PRIMARY KEY CHECK (length(ticket_sha256) = 64 AND ticket_sha256 NOT GLOB '*[^0-9a-f]*'),
  report_id              TEXT NOT NULL,
  key_id                 TEXT NOT NULL,
  idempotency_key        TEXT NOT NULL,
  accepted_terms_version TEXT NOT NULL,
  content_sha256         TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  byte_length            INTEGER NOT NULL CHECK (byte_length BETWEEN 4 AND ${PHOTO_V3_IMAGE_MAX_BYTES}),
  created_at             TEXT NOT NULL,
  expires_at             TEXT NOT NULL CHECK (expires_at > created_at),
  state                  TEXT NOT NULL CHECK (state IN ('issued', 'claimed', 'consumed')),
  claim_token            TEXT,
  CHECK ((state = 'claimed') = (claim_token IS NOT NULL))
);
CREATE INDEX photo_upload_intents_expiry ON photo_upload_intents (expires_at);
CREATE TRIGGER photo_upload_intents_born_issued BEFORE INSERT ON photo_upload_intents WHEN NEW.state <> 'issued'
BEGIN SELECT RAISE(ABORT, 'intent: must be issued'); END;
-- What ① attested never changes; consumed is final; the only moves are issued→claimed, claimed→issued, claimed→consumed.
CREATE TRIGGER photo_upload_intents_fixed BEFORE UPDATE ON photo_upload_intents
WHEN NEW.ticket_sha256 IS NOT OLD.ticket_sha256 OR NEW.report_id IS NOT OLD.report_id OR NEW.key_id IS NOT OLD.key_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.accepted_terms_version IS NOT OLD.accepted_terms_version
  OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.byte_length IS NOT OLD.byte_length
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'intent: attested fields are immutable'); END;
CREATE TRIGGER photo_upload_intents_transitions BEFORE UPDATE OF state ON photo_upload_intents
WHEN NOT ((OLD.state = 'issued' AND NEW.state = 'claimed') OR (OLD.state = 'claimed' AND NEW.state IN ('issued', 'consumed')))
BEGIN SELECT RAISE(ABORT, 'intent: invalid transition'); END;
`;

/**
 * Run on REPORTS_DB right after any Time Travel restore, before traffic: a restore can bring back issued, unexpired
 * tickets (≤ 5 min) for uploads that already happened or were erased later. claimed + a fixed token = dead for good.
 */
export const VOID_ISSUED_TICKETS_AFTER_RESTORE = "UPDATE photo_upload_intents SET state = 'claimed', claim_token = 'void-after-restore' WHERE state = 'issued';";

const base64 = (max: number) => z.string().min(4).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const PhotoIntentRequest = z.object({
  schemaVersion: z.literal(4),
  payload: base64(1368),
  attestation: z.object({ keyId: base64(44), challenge: base64(44), assertion: base64(2048) }).strict(),
}).strict();
export const PhotoIntentPayload = z.object({
  schemaVersion: z.literal(4),
  kind: z.literal("photoIntent"),
  reportId: z.string().regex(/^rp_[0-9A-HJKMNP-TV-Z]{26}$/),
  idempotencyKey: z.uuid(),
  acceptedTermsVersion: z.string().regex(TERMS_VERSION),
  mediaType: z.literal("image/jpeg"),
  byteLength: z.number().int().min(4).max(PHOTO_V3_IMAGE_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export function photoIntentClientData(challenge: Uint8Array, keyId: Uint8Array, payload: Uint8Array): Uint8Array {
  return frame([utf8(PHOTO_INTENT_DOMAIN), challenge, keyId, payload]);
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const problem = (status: number, error: string, detail: string, extra: Record<string, string> = {}) => json(status, { error, ...extra, detail });
const rejected = (r: Rejected) => problem(403, "attestationRejected", r.detail, { reason: r.reason });
const decodeText = (bytes: Uint8Array) => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)) as unknown; } catch { return undefined; } };

export interface TwoStepOptions {
  now: () => Date;
  store: KvPhotoStore;
  photoTermsCovered: (version: string) => boolean;
  trustAnchor?: Uint8Array;
}

/** ① Verifies the attested photo commitment and issues a single-use upload ticket. No image bytes. */
export async function handlePhotoIntent(req: Request, reportId: string, env: AttestationBindings, reports: Db, opts: TwoStepOptions): Promise<Response> {
  const policy = attestationConfig(env);
  if (policy.kind !== "appAttest") return problem(503, "attestationUnavailable", "App Attest is not enabled on this deployment");
  if (req.headers.get("Content-Type") !== "application/json") return problem(415, "unsupportedMediaType", "Content-Type must be application/json");
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > 4096) return problem(413, "intentTooLarge", "photo intent exceeds its byte limit");
  const request = PhotoIntentRequest.safeParse(decodeText(raw));
  if (!request.success) return problem(400, "invalidIntent", "request: invalid");
  const material = request.data.attestation;
  const keyId = decode32(material.keyId), challenge = decode32(material.challenge);
  if (keyId === null || challenge === null) return problem(400, "invalidIntent", "attestation: invalid_base64");

  const now = opts.now();
  const ctx: AppAttestContext = { db: reports, appId: policy.appId, environment: policy.environment, bundleVersions: policy.bundleVersions,
    trustAnchor: opts.trustAnchor ?? APPLE_APP_ATTEST_ROOT_DER, now };
  const burned = await consumeReportChallenge(ctx, material.challenge, material.keyId);
  if (burned !== null) return rejected(burned);

  const payload = base64Decode(request.data.payload);
  if (payload === null) return problem(400, "invalidIntent", "payload: invalid_base64");
  const input = PhotoIntentPayload.safeParse(decodeText(payload));
  if (!input.success) return problem(400, "invalidIntent", "payload: invalid");
  if (input.data.reportId !== reportId) return problem(400, "invalidIntent", "reportId: path_mismatch");

  const key = await readKey(reports, material.keyId);
  if (key === null) return rejected({ ok: false, reason: "keyNotRegistered", detail: "no registered App Attest key with this keyId" });
  if (key.revoked) return rejected({ ok: false, reason: "keyRevoked", detail: "this App Attest key has been revoked" });
  const assertion = base64Decode(material.assertion);
  if (assertion === null) return rejected({ ok: false, reason: "assertionInvalid", detail: "malformed" });
  if (key.environment !== ctx.environment) return rejected({ ok: false, reason: "assertionInvalid", detail: "environmentMismatch" });
  const verdict = await verifyAssertion({ assertion, clientDataHash: await sha256(photoIntentClientData(challenge, keyId, payload)),
    publicKey: key.publicKey, appId: ctx.appId, environment: ctx.environment, previousCounter: key.signCount, acceptedBundleVersions: ctx.bundleVersions });
  if (!verdict.ok) return rejected({ ok: false, reason: verdict.reason === "counterNotIncreasing" ? "counterNotIncreasing" : "assertionInvalid", detail: verdict.reason });
  if (input.data.acceptedTermsVersion !== CURRENT_REPORT_TERMS.version) return problem(409, "termsVersionOutdated", "current terms consent is required");
  if (!opts.photoTermsCovered(input.data.acceptedTermsVersion)) return json(403, { error: "photoConsentRequired" });

  // Early refusal for reports that cannot take a photo; ② re-checks all of it inside attach.
  const report = await reports.prepare("SELECT submitter_hash, minimize_after, redacted_at FROM reports WHERE report_id = ?").bind(reportId)
    .first<{ submitter_hash: string | null; minimize_after: string; redacted_at: string | null }>();
  if (!report) return json(404, { error: "reportNotFound" });
  if (report.submitter_hash !== await submitterHash(attestedSubmitter(material.keyId), policy.submitterPepper)) return json(403, { error: "photoUnauthorized" });
  if (report.redacted_at !== null || Date.parse(report.minimize_after) - D1_PHOTO_ERASURE_LEAD_DAYS * 86_400_000 <= now.getTime()) return json(410, { error: "reportExpired" });

  const ticket = crypto.getRandomValues(new Uint8Array(32));
  const expiresAt = isoSeconds(new Date(now.getTime() + TICKET_TTL_MS));
  try {
    await reports.batch([
      advanceCounterStatement(reports, material.keyId, verdict.counter),
      reports.prepare(`INSERT INTO photo_upload_intents (ticket_sha256, report_id, key_id, idempotency_key, accepted_terms_version,
          content_sha256, byte_length, created_at, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`)
        .bind(await sha256Hex(ticket), reportId, material.keyId, input.data.idempotencyKey, input.data.acceptedTermsVersion,
          input.data.sha256, input.data.byteLength, isoSeconds(now), expiresAt),
    ]);
  } catch (error) {
    if (isCounterRace(error)) return rejected({ ok: false, reason: "counterNotIncreasing", detail: "counterNotIncreasing" });
    if (isKeyRevoked(error)) return rejected({ ok: false, reason: "keyRevoked", detail: "this App Attest key has been revoked" });
    throw error;
  }
  return json(201, { schemaVersion: 4, ticket: base64Url(ticket), expiresAt });
}

interface IntentRow { report_id: string; key_id: string; idempotency_key: string; accepted_terms_version: string; content_sha256: string; byte_length: number }

/**
 * ② Stores the bytes ① committed to. The ticket is the only credential; it is single-use and bound to SHA-256 + length.
 * The claim comes first and is ONE conditional `UPDATE … RETURNING` (lookup + claim + the attested fields, parallel uses:
 * one wins), so an unknown, used or expired ticket costs one round trip and no body read; only a refused claim reads
 * the row again, to say why. The body is then read up to the attested length and must match it, its SHA-256 and the
 * JPEG structure check; a mismatch releases the claim, leaving the ticket as it was.
 */
export async function handlePhotoUpload(req: Request, ticketText: string, env: AttestationBindings, reports: Db, opts: TwoStepOptions): Promise<Response> {
  const policy = attestationConfig(env);
  if (policy.kind !== "appAttest") return problem(503, "attestationUnavailable", "App Attest is not enabled on this deployment");
  if (req.headers.get("Content-Type") !== "image/jpeg") return problem(415, "unsupportedMediaType", "Content-Type must be image/jpeg");
  const ticket = fromBase64Url(ticketText);
  if (!ticket || ticket.length !== 32) return json(404, { error: "ticketUnknown" });
  const ticketSha = await sha256Hex(ticket);
  const now = opts.now();
  const claim = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const intent = await reports.prepare(`UPDATE photo_upload_intents SET state = 'claimed', claim_token = ?
      WHERE ticket_sha256 = ? AND state = 'issued' AND expires_at > ?
      RETURNING report_id, key_id, idempotency_key, accepted_terms_version, content_sha256, byte_length`)
    .bind(claim, ticketSha, isoSeconds(now)).first<IntentRow>();
  if (!intent) {
    const row = await reports.prepare("SELECT state, expires_at FROM photo_upload_intents WHERE ticket_sha256 = ?").bind(ticketSha).first<{ state: string; expires_at: string }>();
    if (!row) return json(404, { error: "ticketUnknown" });
    if (row.state === "consumed") return json(409, { error: "ticketUsed" });
    if (row.expires_at <= isoSeconds(now)) return json(410, { error: "ticketExpired" });
    return json(409, { error: "ticketInUse" });
  }
  const release = () => reports.prepare("UPDATE photo_upload_intents SET state = 'issued', claim_token = NULL WHERE ticket_sha256 = ? AND state = 'claimed' AND claim_token = ?")
    .bind(ticketSha, claim).run();
  const refuse = async (response: Response) => { await release(); return response; };

  const declared = Number(req.headers.get("Content-Length") ?? NaN);
  if (Number.isFinite(declared) && declared !== intent.byte_length) return refuse(problem(400, "invalidPhoto", "image: length_mismatch"));
  const image = await readBounded(req, intent.byte_length);
  if (!image || image.length !== intent.byte_length) return refuse(problem(400, "invalidPhoto", "image: length_mismatch"));
  const contentSha256 = await sha256Hex(image);
  if (contentSha256 !== intent.content_sha256) return refuse(problem(400, "invalidPhoto", "image: digest_mismatch"));
  let size: { width: number; height: number };
  try { size = validateJpegStructure(image); }
  catch (error) {
    if (error instanceof JpegStructureError) return refuse(problem(error.code === "tooLarge" ? 413 : error.code === "notJpeg" ? 415 : 422, "invalidPhoto", `image: ${error.code}`));
    throw error;
  }

  try {
    const accepted = await attachKvJpeg(reports, opts.store, {
      reportId: intent.report_id, submitterHash: await submitterHash(attestedSubmitter(intent.key_id), policy.submitterPepper),
      idempotencyKey: intent.idempotency_key, acceptedTermsVersion: intent.accepted_terms_version,
      image: { bytes: image, contentSha256, ...size },
    }, { now, photoTermsCovered: opts.photoTermsCovered,
      // Commits with the `ready` update: the ticket is consumed exactly when the photo became ready.
      onReady: () => [reports.prepare("UPDATE photo_upload_intents SET state = 'consumed', claim_token = NULL WHERE ticket_sha256 = ? AND claim_token = ?").bind(ticketSha, claim)] });
    return json(201, { schemaVersion: 4, ...accepted });
  } catch (error) {
    // Final refusals keep the ticket claimed (dead); a store or KV failure releases it so the same ticket can retry.
    if (error instanceof PhotoAttachmentError) return json(error.status, { error: error.code });
    if (error instanceof PhotoStoreError && error.code !== "budgetReached") return json(410, { error: "photoExpired" });
    await release();
    if ((error instanceof PhotoStoreError && error.code === "budgetReached") || error instanceof KvPhotoStoreError)
      return problem(503, "photoIntakePaused", "photo storage is at its budget; retry later");
    return problem(503, "photoStoreUnavailable", "photo storage failed; retry with the same ticket");
  }
}

const base64Url = (bytes: Uint8Array) => base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  return base64Decode(text.replace(/-/g, "+").replace(/_/g, "/") + "=");
}

async function readBounded(req: Request, max: number): Promise<Uint8Array | null> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > max) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
