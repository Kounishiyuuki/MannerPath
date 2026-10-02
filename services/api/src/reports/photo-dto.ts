import { z } from "zod";
import { TERMS_VERSION } from "./terms.ts";

// JSON/base64 preserves the existing exact-byte App Attest envelope. No second signing protocol.
export const PHOTO_RAW_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_PAYLOAD_MAX_BYTES = Math.ceil(PHOTO_RAW_MAX_BYTES / 3) * 4 + 1024;
export const PHOTO_SUBMISSION_MAX_BYTES = Math.ceil(PHOTO_PAYLOAD_MAX_BYTES / 3) * 4 + 4096;
const base64 = (max: number) => z.string().min(4).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const PhotoPayloadV2 = z.object({
  schemaVersion: z.literal(2),
  reportId: z.string().regex(/^rp_[0-9A-HJKMNP-TV-Z]{26}$/),
  idempotencyKey: z.uuid(),
  acceptedTermsVersion: z.string().regex(TERMS_VERSION),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  image: base64(Math.ceil(PHOTO_RAW_MAX_BYTES / 3) * 4),
}).strict();

export const PhotoSubmissionV2 = z.object({
  schemaVersion: z.literal(2),
  payload: base64(Math.ceil(PHOTO_PAYLOAD_MAX_BYTES / 3) * 4),
  attestation: z.object({
    keyId: base64(44), challenge: base64(44), assertion: base64(2048),
  }).strict(),
}).strict();
