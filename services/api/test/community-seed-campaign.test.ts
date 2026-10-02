import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { app } from "../src/app.ts";
import { ManifestSchema, CoverageSchema, CountsSchema, validateCampaign, generateCampaign, evaluateSeed, campaignTasks, campaignMarkdown, REVIEW_FILE, type CampaignReview } from "../src/coverage/campaign.ts";
import { GapTaskV1, CoverageTasksBodyV1 } from "../src/coverage/dto.ts";
import { PREFECTURES } from "../src/coverage/prefectures.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";
import { seedAreaMetrics, communityAcquisitionMetrics } from "../src/coverage/metrics.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const directory = new URL("../../data-pipeline/research/community-acquisition/", import.meta.url);
const read = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
const manifest = ManifestSchema.parse(read(new URL("seeds.json", directory)));
const coverage = CoverageSchema.parse(read(new URL("current-coverage.json", directory)));
const reviews: CampaignReview[] = read(new URL(`../../../${REVIEW_FILE}`, import.meta.url)).map((r: CampaignReview) => ({
  targetId: r.targetId, explicitSmokingPlaceInformation: r.explicitSmokingPlaceInformation === true,
  reviewStatus: r.reviewStatus, blockerCodes: r.blockerCodes,
}));
const zero = { official: 0, communityVerified: 0, visitedConfirmed: 0, communityReported: 0, allVisible: 0 };
const station = manifest.seeds.find((s) => s.kind === "majorStation" && s.reasonCodes.includes("nationalHub"))!;

test("national manifest has meaningful station, airport and downtown coverage, and reflects all 52 official-information groups", () => {
  const report = generateCampaign(manifest, coverage, reviews);
  assert.ok(report.summary.totalSeeds >= 150);
  assert.equal(report.summary.prefecturesRepresented, 47);
  assert.deepEqual([...new Set(manifest.seeds.map((s) => s.prefecture))].sort(), PREFECTURES.map(([code]) => code));
  assert.equal(new Set(manifest.seeds.map((s) => s.seedId)).size, manifest.seeds.length);
  assert.equal(report.summary.highValueGroups, 52);
  assert.equal(report.summary.reflectedHighValueGroups, 52);
  assert.deepEqual(report.summary.unlinkedHighValueGroups, []);
  for (const kind of ["majorStation", "airport", "downtown", "officialLead"]) assert.ok(manifest.seeds.some((s) => s.kind === kind), kind);
  for (const s of manifest.seeds.filter((s) => s.kind === "airport")) {
    for (const evidence of ["needsExistenceConfirmation", "needsLocationConfirmation", "needsAccessConfirmation"]) assert.ok(s.desiredEvidence.includes(evidence as any), s.seedId);
  }
  assert.equal(report.prefectures.length, 47);
  for (const p of report.prefectures) assert.equal(p.allVisible, p.official + p.communityVerified + p.communityReported);
});

test("schema rejects reference pins, OSM feature values and copied source payloads rather than silently stripping them", () => {
  for (const extra of [
    { latitude: 35.123456, longitude: 139.123456 }, { coordinates: [139.123456, 35.123456] },
    { osmId: "node/123" }, { tags: { amenity: "smoking_area" } }, { hours: "24/7" },
    { officialHtml: "<p>source text</p>" }, { sourceText: "copied official prose" }, { sourceName: "external POI" },
  ]) assert.equal(ManifestSchema.safeParse({ ...manifest, seeds: [{ ...station, ...extra }] }).success, false);
  for (const label of ["node/123", "amenity=smoking_area", "https://example.invalid/place", "<p>smoking room</p>"]) {
    assert.equal(ManifestSchema.safeParse({ ...manifest, seeds: [{ ...station, label }] }).success, false, label);
  }
  assert.equal(ManifestSchema.safeParse({ ...manifest, seeds: [{ ...station, researchRefs: [{ file: REVIEW_FILE, targetId: reviews[0].targetId, rawText: "copied prose" }] }] }).success, false);
  assert.equal(CoverageSchema.safeParse({ ...coverage, areas: [{ ...coverage.areas[0], latitude: 35.123456 }] }).success, false);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /"(?:latitude|longitude|coordinates|osmId|featureId|tags|hours|rawText|officialHtml)"|node\/\d|way\/\d|relation\/\d/);
});

test("deterministic report and Markdown are independent of manifest, metric and review ordering", () => {
  const first = generateCampaign(manifest, coverage, reviews);
  const second = generateCampaign({ ...manifest, seeds: [...manifest.seeds].reverse() }, {
    ...coverage, areas: [...coverage.areas].reverse(), prefectures: [...coverage.prefectures].reverse(),
  }, [...reviews].reverse(), [...SEED_AREAS].reverse());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(campaignMarkdown(first), campaignMarkdown(second));
});

test("public seed geometry is approximate and cannot be replaced by an exact reference pin or mismatched label", () => {
  for (const area of SEED_AREAS) {
    for (const value of [area.latitude, area.longitude]) assert.ok(Math.abs(value * 100 - Math.round(value * 100)) <= 1e-8, area.id);
  }
  for (const poison of [{ latitude: 35.123456 }, { longitude: 139.123456 }, { latitude: NaN }, { latitude: 50 }]) {
    const areas = SEED_AREAS.map((s) => s.id === station.seedAreaId ? { ...s, ...poison } : s);
    assert.throws(() => validateCampaign(manifest, coverage, reviews, areas), /approximate two-decimal Japanese area/);
  }
  assert.throws(() => validateCampaign({ ...manifest, seeds: manifest.seeds.map((s) => s.seedId === station.seedId ? { ...s, label: "別の駅周辺" } : s) }, coverage, reviews), /label differs from public geographic unit/);
});

test("committed campaign artifacts match the current manifest, coverage and generator byte for byte", () => {
  const report = generateCampaign(manifest, coverage, reviews);
  assert.equal(readFileSync(new URL("campaign.json", directory), "utf8"), JSON.stringify(report, null, 2) + "\n");
  assert.equal(readFileSync(new URL("campaign.md", directory), "utf8"), campaignMarkdown(report));
});

test("zero/sparse coverage raises priority; trusted coverage pauses acquisition and a later gap reactivates it", () => {
  const low = evaluateSeed(station, zero, []);
  assert.equal(low.priority, "P0");
  assert.ok(low.reasonCodes.includes("zeroCoverage"));
  assert.equal(evaluateSeed(station, { ...zero, communityReported: 1, allVisible: 1 }, []).priority, "P0");
  const enough = evaluateSeed(low, { ...zero, official: 3, communityReported: 2, allVisible: 5 }, []);
  assert.equal(enough.priority, "P3");
  assert.equal(enough.status, "sufficientlyCovered");
  assert.deepEqual(campaignTasks([enough]), []);
  const again = evaluateSeed(enough, zero, []);
  assert.equal(again.status, "active");
  assert.equal(again.priority, "P0");
  assert.equal(campaignTasks([again]).length, 1);
  const reportedOnly = evaluateSeed(station, { ...zero, communityReported: 5, allVisible: 5 }, []);
  assert.equal(reportedOnly.status, "active", "unconfirmed reports do not establish sufficient trusted coverage");
});

test("unknown metrics stay unknown; blocked and retired seeds cannot generate tasks", () => {
  const unknown = evaluateSeed(station, undefined, []);
  assert.equal(unknown.currentAllVisibleCount, null);
  assert.equal(unknown.currentOfficialCount, null);
  assert.equal(unknown.priority, "P2");
  assert.ok(unknown.reasonCodes.includes("coverageUnknown"));
  assert.deepEqual(campaignTasks([unknown]), []);
  for (const status of ["blocked", "retired"] as const) {
    const seed = evaluateSeed({ ...station, status }, zero, []);
    assert.equal(seed.status, status);
    assert.equal(seed.priority, "P3");
    assert.deepEqual(campaignTasks([seed]), []);
  }
});

test("rights-blocked official smoking information remains a collection lead without approving a source or creating a spot", () => {
  const seed = evaluateSeed({ ...station, reasonCodes: ["regionalHub"] }, zero, [{
    targetId: "rights-blocked", explicitSmokingPlaceInformation: true, reviewStatus: "completed",
    blockerCodes: ["scopedExactLicense", "smokingPlaceCoordinates"],
  }]);
  assert.equal(seed.priority, "P1");
  assert.ok(seed.reasonCodes.includes("explicitOfficialInformation"));
  assert.ok(seed.reasonCodes.includes("officialRightsUnusable"));
  assert.ok(seed.reasonCodes.includes("officialCoordinatesUnusable"));
  const [task] = campaignTasks([seed]);
  assert.ok(GapTaskV1.safeParse(task).success);
  assert.equal(task.kind, "coverageGap");
  assert.equal("spotId" in task, false);
});

test("invalid or duplicated aggregate inputs cannot silently distort coverage", () => {
  assert.equal(CountsSchema.safeParse({ ...zero, allVisible: 1 }).success, false);
  assert.equal(CountsSchema.safeParse({ ...zero, visitedConfirmed: 1 }).success, false);
  assert.throws(() => generateCampaign({ ...manifest, seeds: [...manifest.seeds, manifest.seeds[0]] }, coverage, reviews), /duplicate seed id/);
  assert.throws(() => generateCampaign(manifest, { ...coverage, areas: [...coverage.areas, coverage.areas[0]] }, reviews), /duplicate coverage area/);
  assert.throws(() => generateCampaign(manifest, { ...coverage, prefectures: coverage.prefectures.slice(1) }, reviews), /47 prefectures/);
  assert.throws(() => generateCampaign(manifest, { ...coverage, national: zero }, reviews), /inconsistent national/);
  assert.throws(() => generateCampaign(manifest, coverage, [...reviews, reviews[0]]), /duplicate review id/);
  assert.throws(() => generateCampaign({ ...manifest, seeds: [{ ...station, researchRefs: [{ file: REVIEW_FILE, targetId: "unknown-review" }] }] }, coverage, reviews), /unknown review/);
  assert.throws(() => generateCampaign({ ...manifest, seeds: [{ ...station, seedAreaId: "unknown-area" }] }, coverage, reviews), /missing\/mismatched public geography/);
  assert.throws(() => generateCampaign(manifest, { ...coverage, areas: [{ seedAreaId: station.seedAreaId, counts: { ...zero, official: coverage.national.official + 1, allVisible: coverage.national.official + 1 } }] }, reviews), /area exceeds national/);
  assert.equal(CoverageSchema.safeParse({ ...coverage, provenance: "<p>copied source prose</p>" }).success, false);
  assert.equal(CoverageSchema.safeParse({ ...coverage, corpusRevision: "untraceable" }).success, false);
});

test("per-area metrics separate community tiers and count visited confirmations as a verified subset", async () => {
  const db = new SqliteD1();
  try {
    await importAllReviewedSources(db, coverage.measuredAt);
    await publishTiles(db, { now: coverage.measuredAt });
    const tile = TileBodyV1.parse(JSON.parse(v1TileRows(db)[0].body_json));
    const seed = SEED_AREAS.find((a) => a.id === station.seedAreaId)!;
    const template = { ...tile.spots[0], latitude: seed.latitude, longitude: seed.longitude };
    const spots = [
      { ...template, id: "official", verification: { ...template.verification, existence: "official" as const } },
      { ...template, id: "reported", verification: { ...template.verification, existence: "communityReported" as const, confirmations: 1 } },
      { ...template, id: "visited", verification: { ...template.verification, existence: "communityVerified" as const, confirmations: 2 } },
      { ...template, id: "verified", verification: { ...template.verification, existence: "communityVerified" as const, confirmations: 3 } },
    ];
    assert.deepEqual(seedAreaMetrics(spots, new Set(["visited"]), [seed])[0].counts,
      { official: 1, communityVerified: 2, visitedConfirmed: 1, communityReported: 1, allVisible: 4 });
  } finally { db.raw.close(); }
});

test("campaign generation and the real task endpoint never mutate canonical records or published tiles", async () => {
  const db = new SqliteD1();
  try {
    await importAllReviewedSources(db, coverage.measuredAt);
    await publishTiles(db, { now: coverage.measuredAt });
    const dump = () => ["spots", "sources", "tile_snapshots", "tile_snapshot_spots"].map((table) =>
      JSON.stringify(db.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
    const before = dump();
    const tiles = v1TileRows(db);
    const spots = [...new Map(tiles.flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots).map((s) => [s.id, s])).values()];
    const measured = await communityAcquisitionMetrics(db, spots, { now: coverage.measuredAt });
    assert.deepEqual(measured.seedAreaCoverage.areas, coverage.areas);
    assert.equal(spots.length, coverage.national.allVisible);
    const report = generateCampaign(manifest, coverage, reviews);
    assert.ok(report.taskIntegration.tasks.length > 0);
    for (const task of report.taskIntegration.tasks) assert.ok(GapTaskV1.safeParse(task).success);
    const response = await app.request("/v1/coverage/tasks", {}, { DB: db } as any);
    assert.equal(response.status, 200);
    const publicTasks = CoverageTasksBodyV1.parse(await response.json());
    for (const task of report.taskIntegration.tasks) assert.ok(publicTasks.tasks.some((t) => t.seedAreaId === task.seedAreaId));
    assert.deepEqual(dump(), before);
  } finally { db.raw.close(); }
});

test("CLI produces reproducible JSON and Markdown without modifying its manifest", () => {
  const out = mkdtempSync(join(tmpdir(), "community-seed-test-"));
  const script = new URL("../scripts/community-seed.ts", import.meta.url);
  const before = readFileSync(new URL("seeds.json", directory), "utf8");
  try {
    const run = () => execFileSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", script.pathname, "--out", out, "--json"], { encoding: "utf8" });
    const stdout = run();
    const json = readFileSync(join(out, "campaign.json"), "utf8");
    const markdown = readFileSync(join(out, "campaign.md"), "utf8");
    assert.equal(stdout, json);
    assert.equal(markdown, campaignMarkdown(generateCampaign(manifest, coverage, reviews)));
    assert.equal(run(), stdout);
    assert.equal(readFileSync(join(out, "campaign.json"), "utf8"), json);
    assert.equal(readFileSync(new URL("seeds.json", directory), "utf8"), before);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("CLI station metrics must match the corpus and date, use a station area and preserve a deterministic merge", () => {
  const out = mkdtempSync(join(tmpdir(), "community-station-test-"));
  const file = join(out, "stations.json");
  const script = new URL("../scripts/community-seed.ts", import.meta.url);
  const row = coverage.areas.find((a) => a.seedAreaId === station.seedAreaId)!;
  const snapshot = { measuredAt: coverage.measuredAt, corpusRevision: coverage.corpusRevision, radiusMeters: coverage.radiusMeters, areas: [row] };
  const run = (input: unknown) => {
    writeFileSync(file, JSON.stringify(input));
    return spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", script.pathname, "--stations", file, "--json"], { encoding: "utf8" });
  };
  try {
    const valid = run(snapshot);
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), generateCampaign(manifest, coverage, reviews));
    for (const input of [
      [row], { ...snapshot, measuredAt: "2026-09-30T00:00:00Z" },
      { ...snapshot, corpusRevision: `published-corpus:sha256:${"0".repeat(64)}` },
      { ...snapshot, radiusMeters: 2000 }, { ...snapshot, areas: [row, row] },
      { ...snapshot, areas: [coverage.areas.find((a) => SEED_AREAS.some((s) => s.id === a.seedAreaId && s.kind === "airport"))!] },
    ]) assert.notEqual(run(input).status, 0, JSON.stringify(input));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("CLI projects raw reviews so third-party prose, HTML and OSM feature payloads never enter campaign output", () => {
  const out = mkdtempSync(join(tmpdir(), "community-review-test-"));
  const script = new URL("../scripts/community-seed.ts", import.meta.url);
  const file = join(out, "poisoned-reviews.json");
  const marker = "SOURCE-POISON-74938";
  try {
    const raw = read(new URL(`../../../${REVIEW_FILE}`, import.meta.url));
    writeFileSync(file, JSON.stringify(raw.map((r: Record<string, unknown>) => ({ ...r,
      sourceText: marker, officialHtml: `<p>${marker}</p>`, osmId: "node/987654321",
      coordinates: [139.123456, 35.123456], latitude: 35.123456, longitude: 139.123456,
      tags: { amenity: "smoking_area", name: marker }, hours: "poison hours", name: marker,
    }))));
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", script.pathname, "--reviews", file, "--out", out, "--json"], { encoding: "utf8" });
    assert.equal(stdout, JSON.stringify(generateCampaign(manifest, coverage, reviews), null, 2) + "\n");
    assert.equal(readFileSync(join(out, "campaign.md"), "utf8"), campaignMarkdown(generateCampaign(manifest, coverage, reviews)));
    assert.equal(stdout.includes(marker), false);
    assert.equal(stdout.includes("987654321"), false);
    assert.equal(stdout.includes("35.123456"), false);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("CLI fresh fixture snapshot reproduces the committed coverage and campaign artifacts", () => {
  const out = mkdtempSync(join(tmpdir(), "community-fixture-test-"));
  const script = new URL("../scripts/community-seed.ts", import.meta.url);
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", script.pathname, "--fixtures", "--now", coverage.measuredAt, "--out", out, "--json"], { encoding: "utf8" });
    for (const filename of ["current-coverage.json", "campaign.json", "campaign.md"]) {
      assert.equal(readFileSync(join(out, filename), "utf8"), readFileSync(new URL(filename, directory), "utf8"), filename);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});
