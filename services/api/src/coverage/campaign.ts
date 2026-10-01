// Local campaign planning, not an importer. Inputs are curated geographic units, aggregate MannerPath metrics
// and a projection of review verdicts. No HTML, external POI values, reference pins or canonical writes.
import { z } from "zod";
import { PREFECTURES } from "./prefectures.ts";
import { SEED_AREAS, SEED_RADIUS_METRES, type SeedArea } from "./seed-areas.ts";
import { gapTasks } from "./tasks.ts";

export const CAMPAIGN_VERSION = "community-seed-campaign.v1";
export const REVIEW_FILE = "docs/research/nationwide-discovery/2026-10-01-official-reverse-reviews.json";
export const BASE_REASONS = ["nationalHub", "metropolitanHub", "capitalStation", "capitalDowntown", "largeTransfer", "shinkansenHub", "regionalHub", "tourismHub", "majorStationPresence", "airportTransportHub", "commercialEntertainmentHub"] as const;
const DYNAMIC_REASONS = ["zeroCoverage", "sparseCoverage", "coverageUnknown", "sufficientTrustedCoverage", "moderateCoverage", "explicitOfficialInformation", "officialRightsUnusable", "officialCoordinatesUnusable", "officialResearchPending"] as const;
const REASONS = [...BASE_REASONS, ...DYNAMIC_REASONS] as const;
export const EVIDENCE = ["needsNewSpotDiscovery", "needsExistenceConfirmation", "needsLocationConfirmation", "needsAccessConfirmation", "needsTypeConfirmation"] as const;
const Id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const Prefecture = z.enum(PREFECTURES.map(([code]) => code));
const Count = z.number().int().nonnegative();
export const SeedSchema = z.object({
  seedId: Id, seedAreaId: Id, prefecture: Prefecture,
  municipality: z.string().min(2).max(20).regex(/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ヶケー]+[市区町村]$/u),
  label: z.string().min(2).max(64).refine((v) => !/[<>\n\r=]|https?:|smoking=|amenity=|node\/|way\/|relation\//iu.test(v), "geographic label only"),
  kind: z.enum(["majorStation", "airport", "downtown", "municipality", "officialLead", "coverageGap"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]), reasonCodes: z.array(z.enum(REASONS)),
  currentOfficialCount: Count.nullable(), currentCommunityVerifiedCount: Count.nullable(),
  currentCommunityReportedCount: Count.nullable(), currentAllVisibleCount: Count.nullable(),
  desiredEvidence: z.array(z.enum(EVIDENCE)).min(1),
  researchRefs: z.array(z.object({ file: z.literal(REVIEW_FILE), targetId: Id }).strict()),
  status: z.enum(["active", "sufficientlyCovered", "blocked", "retired"]),
}).strict();
export const ManifestSchema = z.object({ version: z.literal("community-seeds.v1"), meaning: z.literal("Collection areas only; no entry asserts a smoking place exists. Counts are evaluated by community:seed."), seeds: z.array(SeedSchema) }).strict();
export type CampaignSeed = z.infer<typeof SeedSchema>;
export const CountsSchema = z.object({ official: Count, communityVerified: Count, visitedConfirmed: Count, communityReported: Count, allVisible: Count }).strict()
  .refine((c) => c.allVisible === c.official + c.communityVerified + c.communityReported && c.visitedConfirmed <= c.communityVerified, "tiers must sum; visitedConfirmed is a subset of communityVerified");
export type Counts = z.infer<typeof CountsSchema>;
export const CoverageSchema = z.object({
  version: z.literal("community-seed-coverage.v1"), measuredAt: z.string().datetime(),
  provenance: z.enum(["pinnedReviewedFixtures", "publishedCorpusAggregate"]),
  corpusRevision: z.string().regex(/^(pinned-reviewed-fixtures|published-corpus):sha256:[a-f0-9]{64}$/), radiusMeters: z.literal(SEED_RADIUS_METRES),
  national: CountsSchema, unassigned: Count,
  prefectures: z.array(z.object({ code: Prefecture, counts: CountsSchema }).strict()),
  areas: z.array(z.object({ seedAreaId: Id, counts: CountsSchema }).strict()),
}).strict();
export type CampaignCoverage = z.infer<typeof CoverageSchema>;
/** Only this verdict projection is consumed. Third-party text/URL payloads are never passed to the generator. */
export interface CampaignReview { targetId: string; explicitSmokingPlaceInformation: boolean; reviewStatus: string; blockerCodes: string[] }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unique = <T>(items: readonly T[]) => [...new Set(items)];

export function validateCampaign(manifest: unknown, coverage: unknown, reviews: readonly CampaignReview[], areas: readonly SeedArea[] = SEED_AREAS) {
  const m = ManifestSchema.parse(manifest);
  const c = CoverageSchema.parse(coverage);
  const areaMap = new Map(areas.map((s) => [s.id, s]));
  const reviewMap = new Map(reviews.map((r) => [r.targetId, r]));
  const requireUnique = (ids: string[], label: string) => { if (unique(ids).length !== ids.length) throw new Error(`duplicate ${label}`); };
  requireUnique(m.seeds.map((s) => s.seedId), "seed id");
  requireUnique(m.seeds.map((s) => s.seedAreaId), "seed area binding");
  requireUnique(c.areas.map((s) => s.seedAreaId), "coverage area");
  requireUnique(c.prefectures.map((s) => s.code), "coverage prefecture");
  requireUnique(reviews.map((r) => r.targetId), "review id");
  requireUnique(areas.map((s) => s.id), "public geographic area");
  for (const area of areas) {
    if (!Number.isFinite(area.latitude) || !Number.isFinite(area.longitude)
      || area.latitude < 20 || area.latitude > 46 || area.longitude < 122 || area.longitude > 154
      || Math.abs(area.latitude * 100 - Math.round(area.latitude * 100)) > 1e-8
      || Math.abs(area.longitude * 100 - Math.round(area.longitude * 100)) > 1e-8) throw new Error(`geography must be an approximate two-decimal Japanese area: ${area.id}`);
  }
  if (c.prefectures.length !== 47) throw new Error("coverage must explicitly represent all 47 prefectures");
  for (const key of ["official", "communityVerified", "communityReported", "allVisible", "visitedConfirmed"] as const) {
    const assigned = c.prefectures.reduce((n, p) => n + p.counts[key], 0);
    if (assigned > c.national[key] || (key === "allVisible" && assigned + c.unassigned !== c.national.allVisible)) throw new Error(`inconsistent national ${key}`);
  }
  for (const s of m.seeds) {
    const area = areaMap.get(s.seedAreaId);
    if (!area || area.prefecture !== s.prefecture) throw new Error(`missing/mismatched public geography for ${s.seedId}`);
    if (s.label !== area.name) throw new Error(`label differs from public geographic unit: ${s.seedId}`);
    for (const r of s.researchRefs) if (!reviewMap.has(r.targetId)) throw new Error(`unknown review ${r.targetId}`);
  }
  for (const a of c.areas) {
    if (!areaMap.has(a.seedAreaId)) throw new Error(`unknown metric area ${a.seedAreaId}`);
    for (const key of ["official", "communityVerified", "communityReported", "allVisible", "visitedConfirmed"] as const) {
      if (a.counts[key] > c.national[key]) throw new Error(`area exceeds national ${key}: ${a.seedAreaId}`);
    }
  }
  return { manifest: m, coverage: c, reviewMap };
}

/** Versioned decision table: gap first, then public urban/transport roles and independent official lead evidence. */
export function evaluateSeed(seed: CampaignSeed, counts: Counts | undefined, reviews: readonly CampaignReview[]): CampaignSeed {
  const reasons: string[] = seed.reasonCodes.filter((r) => (BASE_REASONS as readonly string[]).includes(r));
  if (reviews.some((r) => r.explicitSmokingPlaceInformation)) reasons.push("explicitOfficialInformation");
  if (reviews.some((r) => r.blockerCodes.some((b) => /rights|licen[sc]e|reuse|redistribut/i.test(b)))) reasons.push("officialRightsUnusable");
  if (reviews.some((r) => r.blockerCodes.some((b) => /coordinate|smokingPoint|geometry/i.test(b)))) reasons.push("officialCoordinatesUnusable");
  if (reviews.some((r) => r.reviewStatus !== "completed")) reasons.push("officialResearchPending");
  let priority: CampaignSeed["priority"] = "P2";
  let status: CampaignSeed["status"] = seed.status === "blocked" || seed.status === "retired" ? seed.status : "active";
  if (!counts) reasons.push("coverageUnknown");
  else if (counts.allVisible >= 5 && counts.official + counts.communityVerified >= 3) {
    priority = "P3";
    reasons.push("sufficientTrustedCoverage");
    if (status === "active") status = "sufficientlyCovered";
  } else if (counts.allVisible >= 3) {
    priority = "P3"; reasons.push("moderateCoverage");
  } else {
    reasons.push(counts.allVisible === 0 ? "zeroCoverage" : "sparseCoverage");
    if (reasons.some((r) => ["nationalHub", "metropolitanHub", "largeTransfer", "shinkansenHub"].includes(r))) priority = "P0";
    else if (reasons.some((r) => ["capitalStation", "capitalDowntown", "airportTransportHub", "explicitOfficialInformation"].includes(r))) priority = "P1";
  }
  if (status === "retired" || status === "blocked") priority = "P3";
  return { ...seed, priority, status, reasonCodes: unique(reasons).sort(compare) as CampaignSeed["reasonCodes"],
    currentOfficialCount: counts?.official ?? null, currentCommunityVerifiedCount: counts?.communityVerified ?? null,
    currentCommunityReportedCount: counts?.communityReported ?? null, currentAllVisibleCount: counts?.allVisible ?? null };
}

/** Existing task vocabulary: every missing-area discovery intent maps to coverageGap, never to a spot or spot task. */
export function campaignTasks(seeds: readonly CampaignSeed[], areas: readonly SeedArea[] = SEED_AREAS) {
  const areaMap = new Map(areas.map((s) => [s.id, s]));
  const chosen = seeds.filter((s) => s.status === "active" && s.currentAllVisibleCount === 0).map((s) => ({
    ...areaMap.get(s.seedAreaId)!, priority: (s.priority === "P0" ? 1 : s.priority === "P1" ? 2 : 3) as 1 | 2 | 3,
  }));
  return gapTasks([], { seedAreas: chosen });
}

export function generateCampaign(manifest: unknown, coverage: unknown, reviews: readonly CampaignReview[], areas: readonly SeedArea[] = SEED_AREAS) {
  const { manifest: m, coverage: c, reviewMap } = validateCampaign(manifest, coverage, reviews, areas);
  const metrics = new Map(c.areas.map((a) => [a.seedAreaId, a.counts]));
  const seeds = m.seeds.map((s) => evaluateSeed(s, metrics.get(s.seedAreaId), s.researchRefs.map((r) => reviewMap.get(r.targetId)!)))
    .sort((a, b) => compare(a.seedId, b.seedId));
  const active = seeds.filter((s) => s.status === "active");
  const byPriority = Object.fromEntries(["P0", "P1", "P2", "P3"].map((p) => [p, seeds.filter((s) => s.priority === p).length]));
  const rank = (s: CampaignSeed) => s.reasonCodes.includes("nationalHub") ? 0 : s.reasonCodes.includes("metropolitanHub") ? 1 : 2;
  const ranked = [...active].sort((a, b) => compare(a.priority, b.priority)
    || (a.currentAllVisibleCount ?? Infinity) - (b.currentAllVisibleCount ?? Infinity) || rank(a) - rank(b)
    || Number(b.reasonCodes.includes("explicitOfficialInformation")) - Number(a.reasonCodes.includes("explicitOfficialInformation")) || compare(a.seedId, b.seedId));
  const linked = unique(seeds.flatMap((s) => s.researchRefs.map((r) => r.targetId))).sort(compare);
  const highValue = reviews.filter((r) => r.explicitSmokingPlaceInformation).map((r) => r.targetId).sort(compare);
  const prefectures = PREFECTURES.map(([code, name]) => {
    const local = seeds.filter((s) => s.prefecture === code);
    return { code, name, ...c.prefectures.find((p) => p.code === code)!.counts,
      seeds: local.length, activeSeeds: local.filter((s) => s.status === "active").length,
      P0Seeds: local.filter((s) => s.priority === "P0" && s.status === "active").length,
      zeroCoverageAreas: local.filter((s) => s.currentAllVisibleCount === 0).length };
  });
  return {
    generator: CAMPAIGN_VERSION, measuredAt: c.measuredAt, corpusRevision: c.corpusRevision, provenance: c.provenance,
    meaning: "Collection areas only, never smoking spots; counts overlap across nearby areas and must not be summed.",
    priorityPolicy: "<3 visible: P0 national/metropolitan/large-transfer/Shinkansen hubs; P1 capital stations/downtown, airports or explicit official leads; otherwise P2. >=3 visible: P3. >=5 visible and >=3 official/verified: sufficientlyCovered. Missing metrics: P2 unknown. Blocked/retired: P3.",
    summary: { totalSeeds: seeds.length, prefecturesRepresented: prefectures.filter((p) => p.seeds > 0).length, targetPrefectures: 47,
      byPriority, activeSeeds: active.length, sufficientlyCovered: seeds.filter((s) => s.status === "sufficientlyCovered").length,
      stationSeeds: seeds.filter((s) => s.kind === "majorStation").length, airportSeeds: seeds.filter((s) => s.kind === "airport").length,
      downtownSeeds: seeds.filter((s) => s.kind === "downtown").length, officialLeadSeeds: seeds.filter((s) => s.kind === "officialLead").length,
      seedsWithOfficialLead: seeds.filter((s) => s.reasonCodes.includes("explicitOfficialInformation")).length,
      highValueGroups: highValue.length, reflectedHighValueGroups: highValue.filter((id) => linked.includes(id)).length,
      unlinkedHighValueGroups: highValue.filter((id) => !linked.includes(id)),
      zeroCoverageAreas: seeds.filter((s) => s.currentAllVisibleCount === 0).length,
      unknownCoverageAreas: seeds.filter((s) => s.currentAllVisibleCount === null).length },
    national: { ...c.national, unassigned: c.unassigned }, prefectures, seeds,
    uncoveredMajorStations: seeds.filter((s) => s.kind === "majorStation" && s.currentAllVisibleCount === 0).map((s) => s.seedId),
    highValueVerificationAreas: ranked.filter((s) => s.reasonCodes.includes("explicitOfficialInformation")).map((s) => s.seedId),
    top20FirstCollectionAreas: ranked.slice(0, 20).map((s) => ({ seedId: s.seedId, label: s.label, prefecture: s.prefecture, priority: s.priority, reasonCodes: s.reasonCodes })),
    taskIntegration: { model: "coverage-tasks.v1", discovery: "coverageGap", evidenceRequests: "campaign-only until a contributor supplies an independently observed exact spot pin", tasks: campaignTasks(seeds, areas) },
  };
}
export type CampaignReport = ReturnType<typeof generateCampaign>;
export function campaignMarkdown(report: CampaignReport): string {
  const lines = ["# Nationwide Community Seed Campaign", "", `Measured: ${report.measuredAt}; corpus: ${report.corpusRevision}`, "", report.meaning, "",
    `Seeds: ${report.summary.totalSeeds}; prefectures: ${report.summary.prefecturesRepresented}/47; P0/P1/P2/P3: ${Object.values(report.summary.byPriority).join(" / ")}.`,
    `Stations: ${report.summary.stationSeeds}; airports: ${report.summary.airportSeeds}; downtown: ${report.summary.downtownSeeds}; official-lead category: ${report.summary.officialLeadSeeds}.`,
    `Official-information groups reflected: ${report.summary.reflectedHighValueGroups}/${report.summary.highValueGroups}; zero-coverage areas: ${report.summary.zeroCoverageAreas}; unknown: ${report.summary.unknownCoverageAreas}.`, "", report.priorityPolicy, "",
    "## Prefecture dashboard", "", "visitedConfirmed is a subset of communityVerified; geographic counts use ADR-0013 assignment, not administrative polygons.", "",
    "| Prefecture | Official | Community verified | Visited confirmed | Community reported | All visible | Active seeds | P0 seeds | Zero areas |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for (const p of report.prefectures) lines.push(`| ${p.name} | ${p.official} | ${p.communityVerified} | ${p.visitedConfirmed} | ${p.communityReported} | ${p.allVisible} | ${p.activeSeeds} | ${p.P0Seeds} | ${p.zeroCoverageAreas} |`);
  lines.push("", "## First 20 collection areas", "", "| Area | Priority | Reasons |", "| --- | --- | --- |");
  for (const s of report.top20FirstCollectionAreas) lines.push(`| ${s.label} (${s.seedId}) | ${s.priority} | ${s.reasonCodes.join(", ")} |`);
  lines.push("", "## Uncovered major stations", "", ...report.uncoveredMajorStations.map((id) => `- ${id}`), "", "## High-value verification areas", "", ...report.highValueVerificationAreas.map((id) => `- ${id}`), "",
    "## Task integration", "", `${report.taskIntegration.tasks.length} zero-coverage seeds map to the existing coverageGap task model. No seed becomes a canonical spot.`, "",
    "Community collection/publication retains Issue #124 consent, moderation and source-rights gates. No official rights approval, OSM integration or release gate is implied.", "");
  return lines.join("\n");
}
