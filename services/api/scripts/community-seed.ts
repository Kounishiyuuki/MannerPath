// Network-free campaign planning. --fixtures measures a fresh local migrated pinned-fixture corpus.
// Normal input is aggregate coverage only. No production database or canonical writes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { generateCampaign, campaignMarkdown, REVIEW_FILE, CoverageSchema, type CampaignCoverage } from "../src/coverage/campaign.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";

const root = new URL("../../../", import.meta.url);
const defaultDirectory = new URL("services/data-pipeline/research/community-acquisition/", root);
const args = process.argv.slice(2);
const options: Record<string, string> = {};
let fixtures = false;
let writeSeeds = false;
let json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--fixtures") fixtures = true;
  else if (args[i] === "--write-seeds") writeSeeds = true;
  else if (args[i] === "--json") json = true;
  else if (["--coverage", "--stations", "--reviews", "--manifest", "--out", "--now"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) options[args[i].slice(2)] = args[++i];
  else throw new Error(`Unknown/missing argument ${args[i]}; community:seed [--coverage FILE] [--stations FILE] [--reviews FILE] [--manifest FILE] [--out DIRECTORY] [--json] [--fixtures --now ISO] [--write-seeds]`);
}
if (options.now && !fixtures) throw new Error("--now only applies to --fixtures; aggregate snapshots retain their measuredAt");
if (writeSeeds && !options.out) throw new Error("--write-seeds requires --out so the snapshot/report is reviewable");
const read = (p: string | URL) => JSON.parse(readFileSync(p, "utf8"));
const manifestPath = options.manifest ?? new URL("seeds.json", defaultDirectory);
const manifest = read(manifestPath);
const rawReviews = read(options.reviews ?? new URL(REVIEW_FILE, root));
// Exclude all source text, URLs, feature fields, pins and hours from the review projection.
const reviews = rawReviews.map((r: any) => ({ targetId: r.targetId, explicitSmokingPlaceInformation: r.explicitSmokingPlaceInformation === true, reviewStatus: r.reviewStatus, blockerCodes: r.blockerCodes }));
let coverage: CampaignCoverage;
if (fixtures) {
  if (options.coverage || options.stations) throw new Error("--fixtures cannot be mixed with supplied coverage/station metrics");
  const { SqliteD1 } = await import("../test/support/sqlite-d1.ts");
  const { importAllReviewedSources, REVIEWED_FIXTURES, reviewedFixtureBytes } = await import("../test/support/reviewed-fixtures.ts");
  const { publishTiles } = await import("../src/tiles/publish.ts");
  const { communityAcquisitionMetrics } = await import("../src/coverage/metrics.ts");
  const { TileBodyV1 } = await import("../src/tiles/dto.ts");
  const measuredAt = options.now ?? "2026-10-01T00:00:00Z";
  if (Number.isNaN(Date.parse(measuredAt))) throw new Error("invalid --now");
  const db = new SqliteD1();
  try {
    await importAllReviewedSources(db, measuredAt);
    await publishTiles(db, { now: measuredAt });
    const tiles = (await db.prepare("SELECT body_json AS body FROM tile_snapshots ORDER BY tile_id").all<{ body: string }>()).results;
    const spots = [...new Map(tiles.flatMap((t) => TileBodyV1.parse(JSON.parse(t.body)).spots).map((s) => [s.id, s])).values()];
    const metrics = await communityAcquisitionMetrics(db, spots, { now: measuredAt });
    const hash = createHash("sha256");
    for (const [id, fixture] of Object.entries(REVIEWED_FIXTURES).sort(([a], [b]) => a < b ? -1 : 1)) { hash.update(id); hash.update(reviewedFixtureBytes(fixture.file)); }
    coverage = {
      version: "community-seed-coverage.v1", measuredAt, corpusRevision: `pinned-reviewed-fixtures:sha256:${hash.digest("hex")}`,
      provenance: "pinnedReviewedFixtures",
      radiusMeters: 1000,
      national: { official: metrics.published.officialVerified, communityVerified: metrics.published.communityVerified + metrics.published.visitedConfirmed,
        visitedConfirmed: metrics.published.visitedConfirmed, communityReported: metrics.published.reportedSpots, allVisible: metrics.published.allVisible },
      unassigned: metrics.prefectureCoverage.unassigned,
      prefectures: metrics.prefectureCoverage.prefectures.map(({ code, name: _name, ...counts }) => ({ code, counts })),
      areas: metrics.seedAreaCoverage.areas,
    };
  } finally { db.raw.close(); }
} else coverage = read(options.coverage ?? new URL("current-coverage.json", defaultDirectory));
if (options.stations) {
  const { z } = await import("zod");
  const stationSnapshot = z.object({ measuredAt: CoverageSchema.shape.measuredAt, corpusRevision: CoverageSchema.shape.corpusRevision,
    radiusMeters: CoverageSchema.shape.radiusMeters, areas: CoverageSchema.shape.areas }).strict().parse(read(options.stations));
  if (stationSnapshot.measuredAt !== coverage.measuredAt || stationSnapshot.corpusRevision !== coverage.corpusRevision) throw new Error("station metrics must match the coverage snapshot date and corpus revision");
  const stationMetrics = stationSnapshot.areas;
  if (new Set(stationMetrics.map((s: any) => s.seedAreaId)).size !== stationMetrics.length) throw new Error("duplicate station metrics");
  for (const s of stationMetrics) if (!SEED_AREAS.some((a) => a.id === s.seedAreaId && a.kind === "majorStation")) throw new Error(`not a station area: ${s.seedAreaId}`);
  const rows = new Map(coverage.areas.map((a) => [a.seedAreaId, a]));
  for (const s of stationMetrics) rows.set(s.seedAreaId, s);
  coverage = { ...coverage, areas: [...rows.values()].sort((a, b) => a.seedAreaId < b.seedAreaId ? -1 : 1) };
}
const report = generateCampaign(manifest, coverage, reviews);
if (report.summary.prefecturesRepresented !== 47 || report.summary.totalSeeds < 150 || report.summary.unlinkedHighValueGroups.length) throw new Error("Campaign exit gate failed: 47 prefectures, >=150 seeds and all high-value official groups required");
if (options.out) {
  const directory = resolve(options.out);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "campaign.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(resolve(directory, "campaign.md"), campaignMarkdown(report));
  if (fixtures) writeFileSync(resolve(directory, "current-coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
}
if (writeSeeds) writeFileSync(manifestPath, JSON.stringify({ ...manifest, seeds: report.seeds }, null, 2) + "\n");
console.log(json ? JSON.stringify(report, null, 2) : campaignMarkdown(report));
