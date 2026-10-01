import { PREFECTURES } from "./prefectures.ts";
import { SEED_AREAS, type SeedArea } from "./seed-areas.ts";
import { seedAreaMetrics, prefectureOf } from "./metrics.ts";
import type { TileSpotV1 } from "../tiles/dto.ts";
export const SEED_PROGRESS_RULES = "community-seed-progress.v1";
export const CAMPAIGN_PHASES = [
  { phase: 1, name: "pilot", additionalSpots: 100, cumulativeTarget: 100 },
  { phase: 2, name: "expand", additionalSpots: 600, cumulativeTarget: 700 },
  { phase: 3, name: "national-floor", additionalSpots: 235, cumulativeTarget: 935 },
  { phase: 4, name: "airport-access", additionalSpots: 65, cumulativeTarget: 1000 },
] as const;
// Kind-specific capacity targets are collection planning rules, never evidence quality thresholds.
export function seedProgress(kind: SeedArea["kind"], counts: { allVisible: number; official: number; communityVerified: number }) {
  const target = kind === "majorStation" ? 5 : kind === "airport" ? 3 : kind === "downtown" || kind === "nightlife" ? 8 : 3;
  const trusted = kind === "downtown" || kind === "nightlife" ? 4 : kind === "majorStation" ? 3 : 2;
  return counts.allVisible >= target && counts.official + counts.communityVerified >= trusted ? "sufficientlyCovered"
    : counts.allVisible > 0 ? "progressing" : "active";
}
export function campaignProgress(spots: readonly TileSpotV1[], visited: ReadonlySet<string> = new Set()) {
  const areaCounts = new Map(seedAreaMetrics(spots, visited).map((r) => [r.seedAreaId, r.counts]));
  const seeds = SEED_AREAS.map((s) => ({ seedAreaId: s.id, prefecture: s.prefecture, kind: s.kind,
    status: seedProgress(s.kind, areaCounts.get(s.id)!), counts: areaCounts.get(s.id)! }));
  const prefectures = PREFECTURES.map(([code,name]) => ({ code,name, official: 0, reported: 0, visitedConfirmed: 0, verified: 0,
    allVisible: 0, activeSeeds: seeds.filter((s) => s.prefecture === code && s.status !== "sufficientlyCovered").length,
    zeroCoverage: seeds.filter((s) => s.prefecture === code && s.counts.allVisible === 0).length,
    sufficientlyCovered: seeds.filter((s) => s.prefecture === code && s.status === "sufficientlyCovered").length }));
  const rows = new Map(prefectures.map((p) => [p.code as string,p]));
  for (const s of spots) {
    const p = prefectureOf(s); if (!p) continue; const row = rows.get(p.code)!; row.allVisible++;
    if (s.verification.existence === "communityReported") row.reported++;
    else if (s.verification.existence === "communityVerified") { row.verified++; if (visited.has(s.id)) row.visitedConfirmed++; }
    else row.official++;
  }
  const collected = spots.filter((s) => s.verification.existence === "communityReported" || s.verification.existence === "communityVerified").length;
  const verified = spots.filter((s) => s.verification.existence === "communityVerified").length;
  const coverage = (kind: SeedArea["kind"]) => ({ total: seeds.filter((s) => s.kind === kind).length,
    covered: seeds.filter((s) => s.kind === kind && s.counts.allVisible > 0).length });
  return { version: "community-campaign-progress.v1", rules: SEED_PROGRESS_RULES, collected, verified,
    remainingSeeds: seeds.filter((s) => s.status !== "sufficientlyCovered").length, zeroCoverage: seeds.filter((s) => !s.counts.allVisible).length,
    prefecturesCovered: prefectures.filter((p) => p.allVisible > 0).length, stationCoverage: coverage("majorStation"), airportCoverage: coverage("airport"),
    phases: CAMPAIGN_PHASES.map((p) => ({ ...p, collected: Math.min(p.additionalSpots, Math.max(0,collected-(p.cumulativeTarget-p.additionalSpots))),
      remaining: Math.max(0,p.cumulativeTarget-collected) })), prefectures, seeds };
}
export function campaignProgressMarkdown(report: ReturnType<typeof campaignProgress>) {
  return ["# First 1,000 campaign progress", "", `Rules: ${report.rules}. Aggregate collection progress; no publication activation.`, "",
    `Collected: ${report.collected}; verified: ${report.verified}; remaining seeds: ${report.remainingSeeds}; zero coverage: ${report.zeroCoverage}; prefectures: ${report.prefecturesCovered}/47.`,
    `Stations: ${report.stationCoverage.covered}/${report.stationCoverage.total}; airports: ${report.airportCoverage.covered}/${report.airportCoverage.total}.`, "",
    "| Phase | Target | Collected | Remaining to cumulative target |", "| --- | ---: | ---: | ---: |",
    ...report.phases.map((p) => `| ${p.name} | ${p.additionalSpots} | ${p.collected} | ${p.remaining} |`), "",
    "| Prefecture | Official | Reported | Visited | Verified | Visible | Active seeds | Zero | Sufficient |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.prefectures.map((p) => `| ${p.name} | ${p.official} | ${p.reported} | ${p.visitedConfirmed} | ${p.verified} | ${p.allVisible} | ${p.activeSeeds} | ${p.zeroCoverage} | ${p.sufficientlyCovered} |`), ""].join("\n");
}
