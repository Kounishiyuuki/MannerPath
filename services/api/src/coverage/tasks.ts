// Coverage tasks (coverage-tasks.v1, ADR-0013): what the system would like someone nearby to check. A task is public,
// read-only and assigned to nobody; it names a spot ID or an approximate area and a kind, nothing else — never a
// reporter, a report, a date or a count of reports.
//
// Spot tasks follow from a published spot's own public fields, so every client can derive them from the tiles it
// already holds without telling the server where it is (apps/apple `CoverageTasks.swift` implements the same rules;
// both are checked against contracts/coverage/coverage-tasks.v1.json). Gap tasks follow from the seed-area list and
// the published corpus. `needsRecheck` follows from moderated reports and is therefore user-derived: it is produced
// only when the caller states that community rights are granted (Issue #124), and never by the public endpoint today.

import { CoverageSpatialIndex } from "./spatial-index.ts";
import { spotFreshness } from "../quality/freshness.ts";
import type { TileSpotV1 } from "../tiles/dto.ts";
import { SEED_AREAS, SEED_RADIUS_METRES, type SeedArea } from "./seed-areas.ts";

export const COVERAGE_TASKS_VERSION = "coverage-tasks.v1";

export const SPOT_TASK_KINDS = ["needsConfirmation", "needsLocationCheck", "needsTypeCheck", "needsAccessCheck"] as const;
export type SpotTaskKind = (typeof SPOT_TASK_KINDS)[number];
export type TaskKind = SpotTaskKind | "needsRecheck" | "coverageGap";

/** Rules, in this order; a spot may carry several. */
export function spotTaskKinds(
  spot: Pick<TileSpotV1, "spotType" | "accessType" | "lastVerifiedAt" | "verification">, now: string,
): SpotTaskKind[] {
  const kinds: SpotTaskKind[] = [];
  // Optional at runtime for a spot cached before ADR-0012 (the Swift twin decodes those): nothing is then inferred.
  const v = spot.verification as TileSpotV1["verification"] | undefined;
  const freshness = spotFreshness({ lastVerifiedAt: spot.lastVerifiedAt, verification: { ...v!, lastReviewedMonth: v?.lastReviewedMonth ?? null } }, now);
  // A single report, or evidence old enough to be stale: someone on site saying "still here" is the most useful thing.
  if (v?.existence === "communityReported" || freshness === "stale") kinds.push("needsConfirmation");
  // A pin only one person placed, or a location that is not the publisher's own point.
  if (v?.locationPrecision === "unknown" || v?.locationPrecision === "reviewedDerived"
    || (v?.locationPrecision === "communityPinned" && (v.confirmations ?? 0) < 2)) kinds.push("needsLocationCheck");
  if (spot.spotType === "unknown") kinds.push("needsTypeCheck");
  if (spot.accessType === "unknown") kinds.push("needsAccessCheck");
  return kinds;
}

export interface SpotTask {
  kind: SpotTaskKind | "needsRecheck";
  spotId: string;
}

export interface GapTask {
  kind: "coverageGap";
  seedAreaId: string;
  name: string;
  prefecture: string;
  priority: 1 | 2 | 3;
  /** Approximate centre and radius of the area whose information is thin. Not a place, not a claim. */
  area: { latitude: number; longitude: number; radiusMeters: number };
}

export function spotTasks(spots: readonly TileSpotV1[], now: string): SpotTask[] {
  return spots.flatMap((spot) => spotTaskKinds(spot, now).map((kind) => ({ kind, spotId: spot.id })));
}

/** Recheck tasks come from moderated reports: only with granted community rights (Issue #124). */
export function recheckTasks(states: readonly { spotId: string; state: string }[], opts: { communityRightsGranted: boolean }): SpotTask[] {
  if (!opts.communityRightsGranted) return [];
  return states.filter((s) => s.state === "needsRecheck" || s.state === "reviewCandidate").map((s) => ({ kind: "needsRecheck", spotId: s.spotId }));
}

/**
 * A seed area with no visible spot within its radius. "Information around here is thin" — not "there is a smoking
 * place here". Ordered by priority tier, then by ID.
 */
export function gapTasks(
  visible: readonly { latitude: number; longitude: number }[], opts: { seedAreas?: readonly SeedArea[]; radiusMeters?: number } = {},
): GapTask[] {
  const radius = opts.radiusMeters ?? SEED_RADIUS_METRES;
  const index = new CoverageSpatialIndex(visible);
  return (opts.seedAreas ?? SEED_AREAS)
    .filter((seed) => index.within(seed, radius).length === 0)
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))
    .map((seed) => ({
      kind: "coverageGap", seedAreaId: seed.id, name: seed.name, prefecture: seed.prefecture, priority: seed.priority,
      area: { latitude: seed.latitude, longitude: seed.longitude, radiusMeters: radius },
    }));
}
