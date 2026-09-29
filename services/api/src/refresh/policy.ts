// Reviewed source refresh policy (ADR-0008, "Amendment 2026-09 — source refresh foundation").
// Every number here is a reviewed decision with its reason, not a tuned threshold: v1 has no refresh history
// to calibrate against (one real Taito release exists), so it flags rather than tolerates.

export const SOURCE_REFRESH_POLICY = {
  version: "source-refresh-policy.v1",
  /**
   * Largest body a check reads. A Worker isolate has 128 MB of memory and a check holds the body, its hash
   * input and the parsed rows at once; 16 MiB keeps that well inside the limit. The Taito release is ~7 KB.
   * A larger file is a `failed` (tooLarge) check, not a truncated one.
   */
  maxBytes: 16 * 1024 * 1024,
  /**
   * Record count decrease against the reviewed baseline that is tolerated without review. Zero: with no
   * measured refresh history there is no basis for a tolerated loss, and a changed file is never applied
   * automatically anyway, so flagging every decrease only costs a reviewer's look.
   */
  maxRecordDecrease: 0,
  /**
   * The extent of Japan's territory by its end points (国土地理院「日本の東西南北端点の経度緯度」:
   * 南端 沖ノ鳥島 20°25′N, 北端 択捉島 45°33′N, 西端 与那国島 122°56′E, 東端 南鳥島 153°59′E), rounded
   * outward to whole degrees. Every reviewed source is Japanese, so a coordinate outside this box is a
   * schema or datum problem (swapped columns, projected metres), never a real spot.
   */
  extent: { minLatitude: 20, maxLatitude: 46, minLongitude: 122, maxLongitude: 154 },
} as const;
