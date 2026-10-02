import { createHash } from "node:crypto";
import type { MultiSourcePromotionManifest, MultiSourcePromotionSource } from "../src/pipeline/promotion.ts";

/** Official limits checked 2026-10-02; operational budgets are intentionally stricter.
 * https://developers.cloudflare.com/d1/platform/limits/
 * https://developers.cloudflare.com/d1/worker-api/d1-database/
 */
export const D1_CAPACITY_POLICY = Object.freeze({
  version: "d1-capacity.v1", statementLimitBytes: 100_000, statementBytes: 90_000, rowBytes: 2_000_000,
  importBytes: 5_000_000_000, boundParameters: 100, queryDurationMs: 30_000,
  maxManifestBytes: 16_777_216,
});
export interface V4File {
  file: string; sha256: string; bytes: number; statements: number;
}
export interface V4Chunk extends V4File {
  ordinal: number; rows: Record<string, number>;
}
export interface PromotionV4Manifest {
  bundleVersion: "promotion-bundle.v4";
  capacityPolicy: string;
  chunkTargetBytes: number;
  sources: MultiSourcePromotionSource[];
  rows: Record<string, number>;
  tiles: MultiSourcePromotionManifest["tiles"];
  chunks: V4Chunk[];
  finalize: V4File;
  wholeBundleSha256: string;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function canonicalManifestDigest(manifest: Omit<PromotionV4Manifest, "wholeBundleSha256"> | PromotionV4Manifest): string {
  const { wholeBundleSha256: _ignored, ...unsigned } = manifest as PromotionV4Manifest;
  return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
