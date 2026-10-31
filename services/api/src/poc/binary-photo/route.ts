// PoC — the v3 binary photo route. NOT mounted by createApp: tests and scripts/photo-cpu-poc.ts mount it on their own
// Hono app. Order mirrors the v2 route (src/app.ts `photo`): bounded read → envelope → burn the challenge → verify the
// assertion over the small payload → terms → image digest and length → JPEG structure → attach. Nothing is decoded as
// an image here; the operator's local Admin re-encodes before display (display.ts).
import { APPLE_APP_ATTEST_ROOT_DER } from "../../attest/apple-root.ts";
import { base64Decode, sha256 } from "../../attest/bytes.ts";
import { type AppAttestContext, type Rejected, consumeReportChallenge, decode32 } from "../../attest/protocol.ts";
import { advanceCounterStatement, isCounterRace, isKeyRevoked, readKey } from "../../attest/store.ts";
import { verifyAssertion } from "../../attest/verify.ts";
import { type Db, sha256Hex } from "../../db.ts";
import { type AttestationBindings, attestationConfig } from "../../reports/attestation.ts";
import { attestedSubmitter, submitterHash } from "../../reports/create.ts";
import { JpegStructureError, validateJpegStructure } from "../../reports/jpeg-structure.ts";
import { PhotoAttachmentError } from "../../reports/photos.ts";
import { CURRENT_REPORT_TERMS } from "../../reports/terms.ts";
import { attachValidatedJpeg } from "./attach.ts";
import { type D1PhotoStore, PhotoStoreError } from "./d1-photo-store.ts";
import { PHOTO_V3_BODY_MAX_BYTES, PHOTO_V3_CONTENT_TYPE, PhotoHeaderV3, PhotoPayloadV3, photoClientData, splitPhotoBody } from "./protocol.ts";

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const problem = (status: number, error: string, detail: string, extra: Record<string, string> = {}) => json(status, { error, ...extra, detail });
const rejected = (r: Rejected) => problem(403, "attestationRejected", r.detail, { reason: r.reason });

export interface BinaryPhotoOptions {
  now: () => Date;
  store: D1PhotoStore;
  photoTermsCovered: (version: string) => boolean;
  trustAnchor?: Uint8Array;
}

export type BinaryPhotoEnv = AttestationBindings;

export async function handleBinaryPhoto(req: Request, reportId: string, env: BinaryPhotoEnv, reports: Db, opts: BinaryPhotoOptions): Promise<Response> {
  const policy = attestationConfig(env);
  if (policy.kind !== "appAttest") return problem(503, "attestationUnavailable", "App Attest is not enabled on this deployment");
  if (req.headers.get("Content-Type") !== PHOTO_V3_CONTENT_TYPE) return problem(415, "unsupportedMediaType", `Content-Type must be ${PHOTO_V3_CONTENT_TYPE}`);
  const declared = Number(req.headers.get("Content-Length") ?? NaN);
  if (Number.isFinite(declared) && declared > PHOTO_V3_BODY_MAX_BYTES) return problem(413, "photoTooLarge", "attachment submission exceeds its byte limit");

  const body = await readBounded(req, PHOTO_V3_BODY_MAX_BYTES);
  if (!body) return problem(413, "photoTooLarge", "attachment submission exceeds its byte limit");
  const parts = splitPhotoBody(body);
  if (!parts.ok) return problem(400, "invalidPhoto", parts.detail);
  let headerJson: unknown;
  try { headerJson = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(parts.header)); }
  catch { return problem(400, "invalidPhoto", "header: invalid_json"); }
  const header = PhotoHeaderV3.safeParse(headerJson);
  if (!header.success) return problem(400, "invalidPhoto", "header: invalid");
  const material = header.data.attestation;
  const keyId = decode32(material.keyId), challenge = decode32(material.challenge);
  if (keyId === null || challenge === null) return problem(400, "invalidPhoto", "attestation: invalid_base64");

  const now = opts.now();
  const ctx: AppAttestContext = { db: reports, appId: policy.appId, environment: policy.environment, bundleVersions: policy.bundleVersions,
    trustAnchor: opts.trustAnchor ?? APPLE_APP_ATTEST_ROOT_DER, now };
  // Burned before anything else is decoded, exactly like v2: a captured body can be submitted at most once.
  const burned = await consumeReportChallenge(ctx, material.challenge, material.keyId);
  if (burned !== null) return rejected(burned);

  const payload = base64Decode(header.data.payload);
  if (payload === null) return problem(400, "invalidPhoto", "payload: invalid_base64");
  let payloadJson: unknown;
  try { payloadJson = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload)); }
  catch { return problem(400, "invalidPhoto", "payload: invalid_json"); }
  const input = PhotoPayloadV3.safeParse(payloadJson);
  if (!input.success) return problem(400, "invalidPhoto", "payload: invalid");
  if (input.data.reportId !== reportId) return problem(400, "invalidPhoto", "reportId: path_mismatch");

  const key = await readKey(reports, material.keyId);
  if (key === null) return rejected({ ok: false, reason: "keyNotRegistered", detail: "no registered App Attest key with this keyId" });
  if (key.revoked) return rejected({ ok: false, reason: "keyRevoked", detail: "this App Attest key has been revoked" });
  const assertion = base64Decode(material.assertion);
  if (assertion === null) return rejected({ ok: false, reason: "assertionInvalid", detail: "malformed" });
  if (key.environment !== ctx.environment) return rejected({ ok: false, reason: "assertionInvalid", detail: "environmentMismatch" });
  const verdict = await verifyAssertion({ assertion, clientDataHash: await sha256(photoClientData(challenge, keyId, payload)),
    publicKey: key.publicKey, appId: ctx.appId, environment: ctx.environment, previousCounter: key.signCount, acceptedBundleVersions: ctx.bundleVersions });
  if (!verdict.ok) return rejected({ ok: false, reason: verdict.reason === "counterNotIncreasing" ? "counterNotIncreasing" : "assertionInvalid", detail: verdict.reason });

  if (input.data.acceptedTermsVersion !== CURRENT_REPORT_TERMS.version) return problem(409, "termsVersionOutdated", "current terms consent is required");
  // The signature covers the payload; the payload commits to these. Any changed image byte fails here.
  if (parts.image.length !== input.data.byteLength) return problem(400, "invalidPhoto", "image: length_mismatch");
  const contentSha256 = await sha256Hex(parts.image);
  if (contentSha256 !== input.data.sha256) return problem(400, "invalidPhoto", "image: digest_mismatch");
  let size: { width: number; height: number };
  try { size = validateJpegStructure(parts.image); }
  catch (error) {
    if (error instanceof JpegStructureError) return problem(error.code === "tooLarge" ? 413 : error.code === "notJpeg" ? 415 : 422, "invalidPhoto", `image: ${error.code}`);
    throw error;
  }

  const hash = await submitterHash(attestedSubmitter(material.keyId), policy.submitterPepper);
  try {
    const accepted = await attachValidatedJpeg(reports, opts.store, {
      reportId, submitterHash: hash, idempotencyKey: input.data.idempotencyKey, acceptedTermsVersion: input.data.acceptedTermsVersion,
      image: { bytes: parts.image, contentSha256, ...size },
    }, { now, photoTermsCovered: opts.photoTermsCovered, guards: [advanceCounterStatement(reports, material.keyId, verdict.counter)] });
    return json(201, { schemaVersion: 3, ...accepted });
  } catch (error) {
    if (isCounterRace(error)) return rejected({ ok: false, reason: "counterNotIncreasing", detail: "counterNotIncreasing" });
    if (isKeyRevoked(error)) return rejected({ ok: false, reason: "keyRevoked", detail: "this App Attest key has been revoked" });
    if (error instanceof PhotoAttachmentError) return json(error.status, { error: error.code });
    if (error instanceof PhotoStoreError && error.code === "budgetReached") return problem(503, "photoIntakePaused", "photo storage is at its budget; retry later");
    throw error;
  }
}

/** Reads at most `max` bytes; null when the body is larger. A hostile chunked body cannot allocate more. */
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
