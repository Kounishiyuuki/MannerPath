// Community acquisition metrics (ADR-0013) for the quality report: how much the community channel adds, where, and
// what is waiting for a person to check. Counts only. Official coverage is always reported on its own line and is
// never inflated by community counts; `allVisible` is the user-facing KPI next to it.

import { CoverageSpatialIndex } from "./spatial-index.ts";
import { type Db, isoSeconds } from "../db.ts";
import { haversineMeters } from "../geo/distance.ts";
import { communityStage, spotEvidenceStates } from "../pipeline/community-evidence.ts";
import { spotFreshness } from "../quality/freshness.ts";
import type { TileSpotV1 } from "../tiles/dto.ts";
import { PREFECTURES, SEED_ASSIGNMENT_METRES, SOURCE_PREFECTURES } from "./prefectures.ts";
import { SEED_AREAS, SEED_RADIUS_METRES, type SeedArea } from "./seed-areas.ts";
import { COVERAGE_TASKS_VERSION, gapTasks, spotTaskKinds } from "./tasks.ts";

export const ACQUISITION_METRICS_VERSION = "community-acquisition-metrics.v2";

type PublishedSpot = TileSpotV1;
type Tier = "official" | "communityVerified" | "communityReported";

/** Per-area station/campaign metrics. Overlapping areas are not a partition and must never be summed. */
export function seedAreaMetrics(spots: readonly PublishedSpot[], visitedSpotIds: ReadonlySet<string> = new Set(), seeds: readonly SeedArea[] = SEED_AREAS) {
  const index = new CoverageSpatialIndex(spots);
  return seeds.map((seed) => {
    const nearby = index.within(seed, SEED_RADIUS_METRES);
    return { seedAreaId: seed.id, counts: {
      official: nearby.filter((s) => tierOf(s) === "official").length,
      communityVerified: nearby.filter((s) => tierOf(s) === "communityVerified").length,
      visitedConfirmed: nearby.filter((s) => communityStage({ existence: s.verification?.existence ?? "", confirmations: s.verification?.confirmations ?? null, upgradedByVisit: visitedSpotIds.has(s.id) }) === "visitedConfirmed").length,
      communityReported: nearby.filter((s) => tierOf(s) === "communityReported").length,
      allVisible: nearby.length,
    } };
  }).sort((a, b) => a.seedAreaId < b.seedAreaId ? -1 : a.seedAreaId > b.seedAreaId ? 1 : 0);
}

function tierOf(spot: PublishedSpot): Tier {
  const e = spot.verification?.existence;
  return e === "communityVerified" ? "communityVerified" : e === "communityReported" ? "communityReported" : "official";
}

/** The prefecture a published spot is counted in, and how that was decided (prefectures.ts). */
const seedIndexes = new WeakMap<readonly SeedArea[], CoverageSpatialIndex<SeedArea>>();
const seedRanks = new WeakMap<readonly SeedArea[], Map<SeedArea, number>>();
export function prefectureOf(spot: PublishedSpot, seeds: readonly SeedArea[] = SEED_AREAS): { code: string; method: "sourceJurisdiction" | "seedArea" } | null {
  for (const id of spot.sourceIds) {
    const code = SOURCE_PREFECTURES[id];
    if (code !== undefined) return { code, method: "sourceJurisdiction" };
  }
  let best: { code: string; d: number } | null = null;
  let index = seedIndexes.get(seeds);
  if (!index) { index = new CoverageSpatialIndex(seeds); seedIndexes.set(seeds,index); seedRanks.set(seeds,new Map(seeds.map((seed,i)=>[seed,i]))); }
  const ranks = seedRanks.get(seeds)!;
  for (const seed of index.within(spot, SEED_ASSIGNMENT_METRES).sort((a,b)=>ranks.get(a)!-ranks.get(b)!)) {
    const d = haversineMeters(seed, spot);
    if (d <= SEED_ASSIGNMENT_METRES && (best === null || d < best.d)) best = { code: seed.prefecture, d };
  }
  return best === null ? null : { code: best.code, method: "seedArea" };
}

/**
 * `db` is the canonical DATA_DB. Report-derived measures (confirmations, corrections, moderation load) come from the
 * durable REPORTS_DB (ADR-0014) and only when it is passed: a canonical-only analysis reports them as null rather than
 * reading the inert legacy report tables of the canonical database.
 */
export async function communityAcquisitionMetrics(db: Db, spots: readonly PublishedSpot[], opts: { now: string; reportsDb?: Db }) {
  const now = new Date(opts.now);
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 19) + "Z";
  const upgraded = new Set((await db.prepare("SELECT spot_id FROM community_evidence_upgrades").all<{ spot_id: string }>()).results.map((r) => r.spot_id));
  const stage = (s: PublishedSpot) => communityStage({
    existence: s.verification?.existence ?? "", confirmations: s.verification?.confirmations ?? null, upgradedByVisit: upgraded.has(s.id),
  });
  const reportsDb = opts.reportsDb;
  const confirmations = async (since: string) => reportsDb === undefined ? null : (await reportsDb.prepare(
    `SELECT count(*) AS n FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.report_type = 'exists' AND m.state = 'accepted' AND r.received_at >= ?`,
  ).bind(since).first<{ n: number }>())?.n ?? 0;
  const canonicalByStage = (await db.prepare(
    `SELECT s.evidence_quality AS k, count(*) AS n FROM spots s
     WHERE s.merged_into IS NULL AND s.lifecycle = 'active' AND s.evidence_quality IN ('communityReported', 'communityVerified')
     GROUP BY k`,
  ).all<{ k: string; n: number }>()).results;

  const needsConfirmation = spots.filter((s) => spotTaskKinds(s, opts.now).includes("needsConfirmation")).length;
  const gaps = gapTasks(spots);

  // 47 prefectures, each tier on its own column.
  const perPrefecture = new Map(PREFECTURES.map(([code, name]) => [code as string, { code, name, official: 0, communityVerified: 0, visitedConfirmed: 0, communityReported: 0, allVisible: 0 }]));
  let unassigned = 0;
  let assignedBySeedArea = 0;
  for (const s of spots) {
    const p = prefectureOf(s);
    if (p === null) { unassigned++; continue; }
    if (p.method === "seedArea") assignedBySeedArea++;
    const row = perPrefecture.get(p.code)!;
    row[tierOf(s)]++;
    if (stage(s) === "visitedConfirmed") row.visitedConfirmed++;
    row.allVisible++;
  }
  const prefectures = [...perPrefecture.values()];

  // Seed stations: covered when a visible spot lies within the seed radius. Official-only and all-visible apart.
  const stations = SEED_AREAS.filter((a) => a.kind === "majorStation");
  const spatial = new CoverageSpatialIndex(spots);
  const covered = (pred: (s: PublishedSpot) => boolean) =>
    stations.filter((st) => spatial.within(st, SEED_RADIUS_METRES).some(pred)).length;
  const officialCovered = covered((s) => tierOf(s) === "official");
  const allCovered = covered(() => true);

  return {
    version: ACQUISITION_METRICS_VERSION,
    taskRules: COVERAGE_TASKS_VERSION,
    published: {
      officialVerified: spots.filter((s) => tierOf(s) === "official").length,
      reportedSpots: spots.filter((s) => stage(s) === "reported").length,
      visitedConfirmed: spots.filter((s) => stage(s) === "visitedConfirmed").length,
      communityVerified: spots.filter((s) => stage(s) === "communityVerified").length,
      allVisible: spots.length,
    },
    /** Community spots that exist canonically, published or held back (e.g. by Issue #124's rights gate). */
    canonicalCommunity: Object.fromEntries(canonicalByStage.map((r) => [r.k, r.n])),
    spotsNeedingConfirmation: needsConfirmation,
    staleSpots: spots.filter((s) => spotFreshness(s, opts.now) === "stale").length,
    locationCorrectionsPending: reportsDb === undefined ? null : (await reportsDb.prepare(
      `SELECT count(DISTINCT r.subject_spot_id) AS n FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
       WHERE r.report_type = 'moved' AND m.state = 'accepted' AND m.reconciliation_state <> 'discarded'
         AND r.redacted_at IS NULL AND r.proposed_latitude IS NOT NULL AND r.minimize_after > ?`,
    ).bind(isoSeconds(now)).first<{ n: number }>())!.n,
    coverageGaps: { total: gaps.length, byPriority: { 1: gaps.filter((g) => g.priority === 1).length, 2: gaps.filter((g) => g.priority === 2).length, 3: gaps.filter((g) => g.priority === 3).length } },
    confirmations: reportsDb === undefined ? null : { last7Days: await confirmations(days(7)), last30Days: await confirmations(days(30)) },
    moderation: reportsDb === undefined ? null : await moderationMetrics(reportsDb, db, now),
    prefectureCoverage: {
      assignment: "official spots by source jurisdiction; community spots only within a seed area (approximate), else unassigned",
      prefecturesWithUsableSpots: prefectures.filter((p) => p.allVisible > 0).length,
      prefecturesWithOfficialSpots: prefectures.filter((p) => p.official > 0).length,
      target: 47,
      unassigned,
      assignedBySeedArea,
      prefectures,
    },
    seedStationCoverage: {
      note: "hand-entered seed stations (seed-areas.v1), not the licensed top-50/top-300 reference; stationCoverage stays notComputableYet",
      radiusMeters: SEED_RADIUS_METRES,
      stations: stations.length,
      officialOnly: { covered: officialCovered, rate: stations.length === 0 ? null : Math.round((officialCovered / stations.length) * 1000) / 1000 },
      allVisible: { covered: allCovered, rate: stations.length === 0 ? null : Math.round((allCovered / stations.length) * 1000) / 1000 },
    },
    seedAreaCoverage: { radiusMeters: SEED_RADIUS_METRES, overlapping: true, areas: seedAreaMetrics(spots, upgraded) },
  };
}

/**
 * v2 (Issue #150): the moderation load a community launch creates, for the daily runbook (docs/OPERATIONS.md).
 * Informational only: a large or growing queue is a staffing signal, never a quality failure.
 */
async function moderationMetrics(db: Db, dataDb: Db, now: Date) {
  const decided = (await db.prepare(
    `SELECT m.state AS state, m.decision_reason AS reason, count(*) AS n FROM report_moderation m GROUP BY m.state, m.decision_reason`,
  ).all<{ state: string; reason: string | null; n: number }>()).results;
  const sum = (pred: (r: { state: string; reason: string | null }) => boolean) => decided.filter(pred).reduce((a, r) => a + r.n, 0);
  const pending = sum((r) => r.state === "pending");
  const rejected = sum((r) => r.state === "rejected");
  const decidedCount = sum((r) => r.state !== "pending");
  const ratio = (n: number) => (decidedCount === 0 ? null : Math.round((n / decidedCount) * 1000) / 1000);
  const oldest = await db.prepare(
    "SELECT min(r.received_at) AS at FROM reports r JOIN report_moderation m ON m.report_id = r.report_id WHERE m.state = 'pending'",
  ).first<{ at: string | null }>();
  const states = await spotEvidenceStates(db, dataDb, { now });
  return {
    pending,
    oldestPendingHours: oldest?.at == null ? null : Math.floor((now.getTime() - Date.parse(oldest.at)) / 3_600_000),
    accepted: sum((r) => r.state === "accepted"),
    rejected,
    rejectedRate: ratio(rejected),
    duplicateRate: ratio(sum((r) => r.reason === "duplicateOfExistingReport")),
    abuseRejections: sum((r) => r.reason === "abuse"),
    spotsNeedingRecheck: states.filter((s) => s.state === "needsRecheck").length,
    absenceReviewCandidates: states.filter((s) => s.state === "reviewCandidate").length,
    heldSpots: states.filter((s) => s.state === "held").length,
    conflictingSpots: states.filter((s) => s.conflicting).length,
    // Spatial candidates require explicit bounded review, rather than a misleading page-length national total.
    duplicateCandidates: null,
    duplicateCandidatesStatus: "notComputedUseBoundedDuplicateQueue",
  };
}
