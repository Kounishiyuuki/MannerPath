// Review freshness of a published spot (ADR-0012, freshness.v1). Freshness is a label, never a publication gate:
// old evidence without removal evidence stays visible as `stale` (stale != nonexistent). The Apple client applies the
// same policy to the same wire fields (docs/API.md), so the quality report and the app agree.
//
// The boundaries reuse the one freshness window this repository already measured against — 365 days
// (`publishedWithin365Days`, docs/BETA_DATA_QUALITY.md) — because the reviewed municipal sources republish their
// lists at most yearly. `aging` is the second publication cycle without a re-confirmation; beyond that the evidence
// has missed two cycles and is `stale`. A change to either boundary is a new policy version.

import type { TileSpotV1 } from "../tiles/dto.ts";

export const FRESHNESS_POLICY_VERSION = "freshness.v1";
export const FRESH_WITHIN_DAYS = 365;
export const AGING_WITHIN_DAYS = 730;

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

/**
 * The reference day is the observation date when one exists; otherwise the first day of the reviewed month, which
 * never makes month-precision evidence look fresher than it is. A missing or future date is `unknown`.
 */
export function spotFreshness(spot: Pick<TileSpotV1, "lastVerifiedAt" | "verification">, now: string): Freshness {
  const day = spot.lastVerifiedAt ?? (spot.verification.lastReviewedMonth === null ? null : `${spot.verification.lastReviewedMonth}-01`);
  if (day === null) return "unknown";
  const age = (Date.parse(now) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(age) || age < 0) return "unknown";
  return age <= FRESH_WITHIN_DAYS ? "fresh" : age <= AGING_WITHIN_DAYS ? "aging" : "stale";
}
