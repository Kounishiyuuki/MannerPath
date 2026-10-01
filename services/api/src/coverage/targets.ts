// Community acquisition targets (ADR-0013): the research replay's route-C targets (official data cannot carry the
// smoking place: a host facility only, no smoking category, no coordinate) turned into a collection plan, joined to
// the seed areas. Pure and read-only; a target is a reason to ask people to look, never evidence that a place exists.

import { PREFECTURES } from "./prefectures.ts";
import { SEED_AREAS, type SeedArea } from "./seed-areas.ts";

export const ACQUISITION_TARGETS_VERSION = "community-acquisition-targets.v1";

/** What a person on site can supply that the official data lacks, per replay blocker. */
const ASK_FOR: Record<string, string> = {
  hostPointOnly: "pinSmokingPointAtKnownHost",
  noSmokingPoint: "reportSmokingPoint",
  noSmokingEvidence: "reportSmokingPoint",
  coordinatesMissing: "pinListedPlace",
  polygonOnly: "pinListedPlace",
};

/** Always collected: the place classes official open data never carries (ADR-0012 context). */
export const ALWAYS_COLLECT = ["convenienceStoreAshtray", "cafeOrRestaurantSmokingPermitted", "smallOutdoorAshtray", "tobaccoShopSmokingSpace"] as const;

export interface ReplayTarget {
  key: string;
  jurisdiction: string;
  kind: string;
  blockers: string[];
  route: string;
}

export interface AcquisitionTarget {
  key: string;
  jurisdiction: string;
  kind: string;
  prefecture: string | null;
  blockers: string[];
  askFor: string[];
  seedAreaIds: string[];
  /** The best (lowest) seed tier among the linked seed areas; null when no seed area is linked yet. */
  priority: 1 | 2 | 3 | null;
}

const stem = (name: string) => name.replace(/(都|道|府|県|市|区|町|村)$/u, "");

/** Seed areas a target's jurisdiction names: a prefecture's seeds, or seeds whose name carries the municipality's stem. */
export function linkedSeeds(target: Pick<ReplayTarget, "jurisdiction" | "kind">, seeds: readonly SeedArea[] = SEED_AREAS): SeedArea[] {
  const prefecture = PREFECTURES.find(([, name]) => name === target.jurisdiction);
  if (prefecture) return seeds.filter((s) => s.prefecture === prefecture[0]);
  const s = stem(target.jurisdiction);
  return s.length < 2 ? [] : seeds.filter((seed) => seed.name.includes(s));
}

export function acquisitionTargets(replay: readonly ReplayTarget[], seeds: readonly SeedArea[] = SEED_AREAS): AcquisitionTarget[] {
  return replay.filter((t) => t.route === "C-communityAcquisition").map((t) => {
    const linked = linkedSeeds(t, seeds);
    const prefectureByName = PREFECTURES.find(([, name]) => name === t.jurisdiction)?.[0] ?? null;
    return {
      key: t.key,
      jurisdiction: t.jurisdiction,
      kind: t.kind,
      prefecture: prefectureByName ?? (linked.length > 0 ? linked[0].prefecture : null),
      blockers: t.blockers,
      askFor: [...new Set(t.blockers.map((b) => ASK_FOR[b]).filter((a): a is string => a !== undefined))].sort(),
      seedAreaIds: linked.map((s) => s.id),
      priority: linked.length === 0 ? null : (Math.min(...linked.map((s) => s.priority)) as 1 | 2 | 3),
    };
  }).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (a.key < b.key ? -1 : 1));
}

/** Every seed area by campaign tier, with how many research targets point at it. */
export function seedPriority(targets: readonly AcquisitionTarget[], seeds: readonly SeedArea[] = SEED_AREAS) {
  return [...seeds].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1)).map((s) => ({
    id: s.id, name: s.name, prefecture: s.prefecture, kind: s.kind, priority: s.priority,
    researchTargets: targets.filter((t) => t.seedAreaIds.includes(s.id)).map((t) => t.key),
  }));
}
