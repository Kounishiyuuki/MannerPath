import type { Db } from "../db.ts";
import { attestationConfig, type AttestationBindings } from "./attestation.ts";
import { CURRENT_REPORT_TERMS } from "./terms.ts";
import { R2EvidencePhotoStorage, type PhotoBucket } from "./r2-photo-storage.ts";

/** Operational attestation, NOT an automatic inspection of Cloudflare account settings. */
export const PHOTO_STORAGE_POLICY = "private-no-copies-permanent-fences.v1";
export const PHOTO_RETENTION_CRON = "*/5 * * * *";
/** Only a later reviewed legal/maintainer change may add an exact photo-processing consent version. */
/** The app mirrors this list (`PhotoEvidencePolicy.reviewedPhotoTerms`); test/photo-activation-readiness.test.ts keeps them equal. */
export const REVIEWED_PHOTO_TERMS: readonly string[] = [];
export interface PhotoBindings extends AttestationBindings {
  REPORTS_DB?: Db;
  PRIVATE_PHOTOS?: PhotoBucket;
  PHOTO_STORAGE_POLICY?: string;
  PHOTO_EVIDENCE?: string;
  REPORT_RETENTION?: string;
  REPORT_RETENTION_CRON?: string;
}

export function configuredPhotoStorage(env: PhotoBindings, clock?: () => Date): R2EvidencePhotoStorage | undefined {
  if (!env.REPORTS_DB || !env.PRIVATE_PHOTOS || typeof env.PRIVATE_PHOTOS.put !== "function"
    || typeof env.PRIVATE_PHOTOS.head !== "function" || env.PHOTO_STORAGE_POLICY !== PHOTO_STORAGE_POLICY) return undefined;
  return new R2EvidencePhotoStorage(env.PRIVATE_PHOTOS, env.REPORTS_DB, clock);
}

/** `reviewed` is a test seam for the approved state; production always uses REVIEWED_PHOTO_TERMS. */
export function photoIntakePolicy(env: PhotoBindings, clock?: () => Date, reviewed: readonly string[] = REVIEWED_PHOTO_TERMS) {
  const storage = configuredPhotoStorage(env, clock);
  const photoTermsCovered = (version: string) => reviewed.includes(version);
  const enabled = env.PHOTO_EVIDENCE === "on" && storage !== undefined
    && attestationConfig(env).kind === "appAttest"
    && env.REPORT_RETENTION === "cleanup" && env.REPORT_RETENTION_CRON === PHOTO_RETENTION_CRON
    && photoTermsCovered(CURRENT_REPORT_TERMS.version);
  return { enabled, storage, photoTermsCovered };
}

export function validRetentionCron(cron: string | undefined): boolean {
  return typeof cron === "string" && cron.split(" ").length === 5
    && cron.split(" ").every((field) => /^[0-9*,/\-]+$/.test(field));
}
