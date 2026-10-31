// PoC — photo upload protocol v3 (binary). NOT mounted by createApp; see docs/release/V1_BINARY_PHOTO_D1_POC.md.
//
// v2 carries the image as base64 inside a JSON payload that is itself base64 inside a JSON envelope, so the Worker
// decodes ~1.8× the image twice and regex-matches it. v3 sends the image bytes untouched after a small signed header:
//
//   body          = uint32_be(headerLength) ‖ header ‖ image
//   header        = UTF-8 JSON {schemaVersion:3, payload:<base64>, attestation:{keyId, challenge, assertion}}  (≤ 4 KiB)
//   payload       = UTF-8 JSON {schemaVersion:3, kind:"photo", reportId, idempotencyKey, acceptedTermsVersion,
//                               mediaType:"image/jpeg", byteLength, sha256}                              (≤ 1 KiB)
//   clientData    = frame(PHOTO_DOMAIN) ‖ frame(challenge) ‖ frame(keyId) ‖ frame(payload)
//
// The assertion covers the exact payload bytes (as v2 does), and the payload commits to the image's length and
// SHA-256, so changing one image byte breaks the signature check without the signature ever covering 1 MB of data.
// A separate domain string keeps a v3 photo assertion from ever verifying as a report or a v2 photo, and vice versa.
import { z } from "zod";
import { frame } from "../../attest/binding.ts";
import { concat, u32be, utf8 } from "../../attest/bytes.ts";
import { TERMS_VERSION } from "../../reports/terms.ts";
import { JPEG_MAX_BYTES } from "../../reports/jpeg-structure.ts";

export const PHOTO_DOMAIN = "mannerpath.app-attest.photo.v3";
export const PHOTO_V3_CONTENT_TYPE = "application/vnd.mannerpath.photo.v3";
export const PHOTO_V3_HEADER_MAX_BYTES = 4096;
/** Below D1's 2,000,000-byte row/BLOB limit with margin; all measured client output (≤1.07 MB) fits. */
export const PHOTO_V3_IMAGE_MAX_BYTES = Math.min(JPEG_MAX_BYTES, 1_500_000);
export const PHOTO_V3_BODY_MAX_BYTES = 4 + PHOTO_V3_HEADER_MAX_BYTES + PHOTO_V3_IMAGE_MAX_BYTES;

const base64 = (max: number) => z.string().min(4).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const PhotoHeaderV3 = z.object({
  schemaVersion: z.literal(3),
  payload: base64(1368),
  attestation: z.object({ keyId: base64(44), challenge: base64(44), assertion: base64(2048) }).strict(),
}).strict();

export const PhotoPayloadV3 = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal("photo"),
  reportId: z.string().regex(/^rp_[0-9A-HJKMNP-TV-Z]{26}$/),
  idempotencyKey: z.uuid(),
  acceptedTermsVersion: z.string().regex(TERMS_VERSION),
  mediaType: z.literal("image/jpeg"),
  byteLength: z.number().int().min(4).max(PHOTO_V3_IMAGE_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type PhotoPayloadV3 = z.infer<typeof PhotoPayloadV3>;

export function photoClientData(challenge: Uint8Array, keyId: Uint8Array, payload: Uint8Array): Uint8Array {
  return frame([utf8(PHOTO_DOMAIN), challenge, keyId, payload]);
}

/** What the iPhone client would send (and what the tests send). */
export function encodePhotoBody(header: unknown, image: Uint8Array): Uint8Array {
  const headerBytes = utf8(JSON.stringify(header));
  return concat(u32be(headerBytes.length), headerBytes, image);
}

export type FrameResult = { ok: true; header: Uint8Array; image: Uint8Array } | { ok: false; detail: string };

/** Splits a v3 body. Every bound is checked before anything is decoded. */
export function splitPhotoBody(body: Uint8Array): FrameResult {
  if (body.length < 4) return { ok: false, detail: "frame: truncated" };
  const headerLength = ((body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]) >>> 0;
  if (headerLength < 2 || headerLength > PHOTO_V3_HEADER_MAX_BYTES) return { ok: false, detail: "frame: header_length" };
  if (body.length < 4 + headerLength) return { ok: false, detail: "frame: truncated" };
  const image = body.subarray(4 + headerLength);
  if (image.length === 0 || image.length > PHOTO_V3_IMAGE_MAX_BYTES) return { ok: false, detail: "frame: image_length" };
  return { ok: true, header: body.subarray(4, 4 + headerLength), image };
}
