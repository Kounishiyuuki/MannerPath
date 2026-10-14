// ADR-0018: new official airport facts use one honest facility anchor, never stacked exact pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { communityAcquisitionMetrics, prefectureOf } from "../src/coverage/metrics.ts";
import { SOURCE_PREFECTURES } from "../src/coverage/prefectures.ts";
import { recordAreaAnchor, recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease, type ReleaseMetadata } from "../src/pipeline/ingest.ts";
import { evidenceHoldSignal } from "../src/pipeline/evidence-hold.ts";
import { TAKAMATSU_AIRPORT_ADAPTER, TAKAMATSU_AIRPORT_FIXTURE_RELEASE, TAKAMATSU_AIRPORT_FIXTURE_SHA256 } from "../src/pipeline/takamatsu-airport-adapter.ts";
import { KOCHI_AIRPORT_ADAPTER, KOCHI_AIRPORT_FIXTURE_RELEASE, KOCHI_AIRPORT_FIXTURE_SHA256 } from "../src/pipeline/kochi-airport-adapter.ts";
import { MATSUYAMA_AIRPORT_ADAPTER, MATSUYAMA_AIRPORT_FIXTURE_RELEASE, MATSUYAMA_AIRPORT_FIXTURE_SHA256 } from "../src/pipeline/matsuyama-airport-adapter.ts";
import { OITA_AIRPORT_ADAPTER, OITA_AIRPORT_FIXTURE_RELEASE, OITA_AIRPORT_FIXTURE_SHA256 } from "../src/pipeline/oita-airport-adapter.ts";
import { YONAGO_AIRPORT_ADAPTER, YONAGO_AIRPORT_FIXTURE_RELEASE, YONAGO_AIRPORT_FIXTURE_SHA256 } from "../src/pipeline/yonago-airport-adapter.ts";
import { MIYAZAKI_AIRPORT_ADAPTER, MIYAZAKI_AIRPORT_FIXTURE_RELEASE, MIYAZAKI_AIRPORT_FIXTURE_SHA256 } from "../src/pipeline/miyazaki-airport-adapter.ts";
import { HIROSHIMA_AIRPORT_ADAPTER, HIROSHIMA_AIRPORT_FIXTURE_RELEASE, HIROSHIMA_AIRPORT_FIXTURE_SHA256 } from "../src/pipeline/hiroshima-airport-adapter.ts";
import { SENDAI_SOURCE_ID } from "../src/pipeline/sendai-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TileBodyV1, type TileSpotV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { checkSourceHealth, type HealthTarget } from "../src/source-health/check.ts";
import { buildReport } from "../src/source-health/evaluate.ts";
import { extractRightsScope, rightsFingerprint } from "../src/source-health/rights.ts";
import { repositoryReviewedHealthTargets, sourceReviews } from "../scripts/source-health.ts";
import { areaPipeline } from "./support/area.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-10-14T01:00:00Z";
const AIRPORTS: { slug: string; adapter: SourceAdapter; meta: ReleaseMetadata; digest: string; prefecture: string }[] = [
  { slug: "takamatsu", adapter: TAKAMATSU_AIRPORT_ADAPTER, meta: TAKAMATSU_AIRPORT_FIXTURE_RELEASE, digest: TAKAMATSU_AIRPORT_FIXTURE_SHA256, prefecture: "37" },
  { slug: "kochi", adapter: KOCHI_AIRPORT_ADAPTER, meta: KOCHI_AIRPORT_FIXTURE_RELEASE, digest: KOCHI_AIRPORT_FIXTURE_SHA256, prefecture: "39" },
  { slug: "matsuyama", adapter: MATSUYAMA_AIRPORT_ADAPTER, meta: MATSUYAMA_AIRPORT_FIXTURE_RELEASE, digest: MATSUYAMA_AIRPORT_FIXTURE_SHA256, prefecture: "38" },
  { slug: "oita", adapter: OITA_AIRPORT_ADAPTER, meta: OITA_AIRPORT_FIXTURE_RELEASE, digest: OITA_AIRPORT_FIXTURE_SHA256, prefecture: "44" },
  { slug: "yonago", adapter: YONAGO_AIRPORT_ADAPTER, meta: YONAGO_AIRPORT_FIXTURE_RELEASE, digest: YONAGO_AIRPORT_FIXTURE_SHA256, prefecture: "31" },
  { slug: "miyazaki", adapter: MIYAZAKI_AIRPORT_ADAPTER, meta: MIYAZAKI_AIRPORT_FIXTURE_RELEASE, digest: MIYAZAKI_AIRPORT_FIXTURE_SHA256, prefecture: "45" },
  { slug: "hiroshima", adapter: HIROSHIMA_AIRPORT_ADAPTER, meta: HIROSHIMA_AIRPORT_FIXTURE_RELEASE, digest: HIROSHIMA_AIRPORT_FIXTURE_SHA256, prefecture: "34" },
];
type Airport = (typeof AIRPORTS)[number];
const bytesFor = (a: Airport) => new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${a.adapter.registry.sourceId}/${a.slug}-airport-page-facts.csv`, import.meta.url)));
const tileBodies = (db: SqliteD1) => v1TileRows(db).map((t) => TileBodyV1.parse(JSON.parse(t.body_json)));
const spotsOf = (db: SqliteD1) => tileBodies(db).flatMap((t) => t.spots);
const countSpots = (db: SqliteD1) => (db.raw.prepare("SELECT count(*) n FROM spots").get() as { n: number }).n;
const csv = (header: readonly string[], rows: readonly (readonly string[])[]) => new TextEncoder().encode([header, ...rows]
  .map((r) => r.map((s) => `"${s.replaceAll('"', '""')}"`).join(",")).join("\n") + "\n");

async function ingestAirport(db: SqliteD1, a: Airport, anchors = true) {
  await ensureReviewedSource(db, a.adapter.registry.sourceId, NOW);
  const result = await ingestRelease(db, a.adapter, bytesFor(a), a.meta);
  if (anchors) assert.equal(await recordReviewedAnchors(db, a.adapter, a.digest, NOW), 1);
  return result;
}
const resolveAirport = (db: SqliteD1, a: Airport, releaseId: number) =>
  resolveFirstRelease(db, a.adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds(String(AIRPORTS.indexOf(a) + 1)) });

for (const a of AIRPORTS) {
  test(`${a.slug}: the reviewed multi-zone facts publish one facility spot and keep unknowns`, async () => {
    const bytes = bytesFor(a);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.digest);
    const { header, rows } = a.adapter.parse(bytes);
    assert.equal(rows.length, 1);
    assert.ok(rows[0][header.indexOf("zones")].split("|").length > 1);
    const [anchor] = a.adapter.reviewedAnchors!(a.digest);
    const db = new SqliteD1();
    const { releaseId } = await ingestAirport(db, a);
    assert.equal((await resolveAirport(db, a, releaseId)).status, "resolved");
    await publishTiles(db, { now: NOW });
    assert.equal(countSpots(db), 1);
    const spots = spotsOf(db);
    assert.equal(spots.length, 1, "one shared facility anchor must not create stacked pins");
    const s = spots[0];
    assert.deepEqual([s.latitude, s.longitude], [anchor.latitude, anchor.longitude]);
    assert.deepEqual(s.verification, {
      version: "spot-verification.v1", existence: "operator", locationPrecision: "areaApproximate", confirmations: null,
      lastReviewedMonth: "2026-10", locationArea: { name: anchor.areaName, kind: "airport", scope: "facility" },
    });
    assert.equal(s.evidenceQuality, "operatorListing");
    assert.equal(s.lastVerifiedAt, a.meta.observedOn);
    assert.deepEqual(s.openingHours, { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" });
    assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType, s.accessDetail, s.hostType],
      ["unknown", "unknown", "unknown", "unknown", "unknown", null, "airport"]);
    if (["hiroshima", "miyazaki"].includes(a.slug)) {
      assert.match(s.name!, /利用条件未確認/);
      assert.doesNotMatch(s.name!, /保安検査後/, "security access must not be inferred from terminal zones");
    } else assert.match(s.name!, /一部は保安検査後/, "mixed access must remain visible");
    assert.deepEqual(s.sourceIds, [a.adapter.registry.sourceId]);
    const response = await app.request(`/v1/spots/${s.id}`, {}, { DB: db });
    assert.equal(response.status, 200);
    const detail = await response.json() as { spot: TileSpotV1 };
    assert.deepEqual(detail.spot.verification, s.verification);
    assert.ok(!JSON.stringify(detail).includes(a.meta.sourceUrl), "spot detail must not publish a restricted evidence deep link");
    assert.ok(!JSON.stringify(tileBodies(db)).includes(a.meta.sourceUrl), "public tiles must not publish a restricted evidence deep link");
    const source = tileBodies(db)[0].sources.find((r) => r.id === a.adapter.registry.sourceId)!;
    assert.deepEqual([source.licenseName, source.licenseUrl], [null, null]);
    assert.equal(source.attributionText, a.adapter.registry.attributionText);
    const pageUrl = new URL(a.meta.sourceUrl);
    assert.ok(source.attributionText!.includes(`${pageUrl.origin}/`));
    assert.ok(!source.attributionText!.includes(a.meta.sourceUrl), "restricted detail links stay in evidence; attribution uses homepage");
  });

  test(`${a.slug}: missing reviewed anchor rejects before creating a canonical spot`, async () => {
    const db = new SqliteD1();
    const { releaseId } = await ingestAirport(db, a, false);
    await assert.rejects(resolveAirport(db, a, releaseId), /anchor/);
    assert.equal(countSpots(db), 0);
  });

  test(`${a.slug}: changed coordinates, zones, checked date, and anchor reference fail closed`, async () => {
    const { header, rows } = a.adapter.parse(bytesFor(a));
    for (const [column, value] of [
      ["anchor_latitude", "35.000000"], ["anchor_longitude", "139.000000"],
      ["zones", "屋外のみ"], ["checked_at", "2026-10-15"], ["anchor_reference", "Google Maps pin"],
      ["area_scope", "namedZone"], ["access_type", "public"],
    ]) {
      const changed = [...rows[0]];
      changed[header.indexOf(column)] = value;
      assert.throws(() => a.adapter.parse(csv(header, [changed])), /reviewed fact/, column);
      assert.throws(() => a.adapter.observe(changed), /reviewed fact/, column);
    }
    const db = new SqliteD1();
    await ingestAirport(db, a, false);
    const [anchor] = a.adapter.reviewedAnchors!(a.digest);
    await assert.rejects(recordAreaAnchor(db, a.adapter, { ...anchor, latitude: anchor.latitude + 0.001 }, NOW), /does not state|coordinates|point/);
    await assert.rejects(recordAreaAnchor(db, a.adapter, { ...anchor, anchorBasis: { basis: "referenceDatasetPoint", reference: "Google Maps pin" } }, NOW), /forbiddenOrigin/);
    assert.equal(countSpots(db), 0);
  });

  test(`${a.slug}: release digest, date, URL, and observation count are pinned`, () => {
    const observations = a.adapter.parse(bytesFor(a)).rows.map((r) => a.adapter.observe(r));
    const release = { contentSha256: a.digest, observedOn: a.meta.observedOn, sourceUrl: a.meta.sourceUrl };
    assert.doesNotThrow(() => a.adapter.assertResolvable(release, observations));
    for (const changed of [{ contentSha256: "0".repeat(64) }, { observedOn: "2026-10-15" }, { sourceUrl: "https://example.invalid/other" }]) {
      assert.throws(() => a.adapter.assertResolvable({ ...release, ...changed }, observations), /reviewed fact/);
    }
    assert.throws(() => a.adapter.assertResolvable(release, []), /reviewed fact/);
    assert.throws(() => a.adapter.assertResolvable(release, [...observations, ...observations]), /reviewed fact/);
    const o = observations[0];
    for (const changed of [
      { ...o, supportsPaper: "yes" as const },
      { ...o, latitude: o.latitude + 0.001 },
      { ...o, classification: { ...o.classification!, accessType: "public" as const } },
      { ...o, openingHours: { status: "unparsed" as const, raw: "24時間", parsed: null } },
      { ...o, locationAnchorId: undefined },
    ]) assert.throws(() => a.adapter.assertResolvable(release, [changed]), /reviewed fact/);
  });

  test(`${a.slug}: re-ingestion is idempotent and does not create duplicate evidence`, async () => {
    const db = new SqliteD1();
    const first = await ingestAirport(db, a);
    const again = await ingestRelease(db, a.adapter, bytesFor(a), a.meta);
    assert.equal(first.created, true);
    assert.deepEqual(again, { releaseId: first.releaseId, created: false });
    assert.equal((db.raw.prepare("SELECT count(*) n FROM source_releases").get() as { n: number }).n, 1);
    assert.equal((db.raw.prepare("SELECT count(*) n FROM source_records").get() as { n: number }).n, 1);
    await resolveAirport(db, a, first.releaseId);
    await publishTiles(db, { now: NOW });
    const before = v1TileRows(db);
    await publishTiles(db, { now: NOW });
    assert.deepEqual(v1TileRows(db), before);
    assert.equal(countSpots(db), 1);
  });

  test(`${a.slug}: scoped page health detects changed facts and missing evidence without editing the sheet`, async () => {
    const targets = repositoryReviewedHealthTargets().filter((t) => t.adapter.registry.sourceId === a.adapter.registry.sourceId);
    assert.equal(targets.length, 1);
    const target = targets[0];
    assert.ok(target.pageFact);
    assert.equal(target.url, a.meta.sourceUrl);
    assert.deepEqual(target.mimeTypes, ["text/html"]);
    const scope = target.pageFact.scope;
    assert.equal(scope.kind, "htmlText");
    if (scope.kind !== "htmlText") throw new Error("expected reviewed HTML fact scope");
    assert.ok(scope.ranges.length > 0);
    assert.ok(scope.requiredMarkers.length > 0);
    assert.match(target.pageFact.reviewedFingerprint, /^[0-9a-f]{64}$/);
    // Synthetic scope tokens exercise health transitions, without storing publisher page prose or claiming a live check.
    const body = `<html><body>${scope.ranges.map((r) => `${r.start} ${scope.requiredMarkers.filter((m) => !r.start.includes(m)).join(" ")} test-baseline ${r.end}`).join(" ")}</body></html>`;
    const extracted = extractRightsScope(body, scope);
    assert.ok(extracted.ok);
    const mock: HealthTarget = { ...target, pageFact: { ...target.pageFact, reviewedFingerprint: await rightsFingerprint(extracted.text) } };
    const fetchBody = (html: string) => ({ fetch: async () => new Response(html, { headers: { "content-type": "text/html" } }) });
    assert.equal((await checkSourceHealth(mock, fetchBody(body))).status, "healthy");
    const changed = await checkSourceHealth(mock, fetchBody(body.replace("test-baseline", "test-changed")));
    assert.equal(changed.status, "contentChanged");
    assert.equal(changed.signals.contentChanged, true);
    // A question and its next section can survive after the actual location answer disappears.
    // Every airport must require a place marker independently of those range boundaries.
    const answerMarker = scope.requiredMarkers.find((m) => scope.ranges.every((r) => !r.start.includes(m) && !r.end.includes(m)));
    assert.ok(answerMarker, "health must require actual location facts, not only section headings");
    if (a.slug === "miyazaki") assert.deepEqual(scope.requiredMarkers, ["1階航空会社カウンター前", "2階待合室内"]);
    const answerGone = body.replaceAll(answerMarker, "test answer removed");
    for (const r of scope.ranges) {
      assert.ok(answerGone.includes(r.start));
      assert.ok(answerGone.includes(r.end));
    }
    const lostAnswer = await checkSourceHealth(mock, fetchBody(answerGone));
    assert.equal(lostAnswer.status, "schemaChanged");
    assert.equal(lostAnswer.pageFactScopeMissing, true);
    const lossReport = buildReport([lostAnswer], sourceReviews(), "2026-10-14");
    assert.equal(evidenceHoldSignal(lossReport, a.adapter.registry.sourceId), "pageFactScopeMissing");
    const missing = await checkSourceHealth(mock, fetchBody("<html><body>test page unavailable</body></html>"));
    assert.equal(missing.status, "schemaChanged");
    assert.equal(missing.pageFactScopeMissing, true);
    assert.equal(createHash("sha256").update(bytesFor(a)).digest("hex"), a.digest);
  });
}

test("airport expansion preserves existing v1 area tile bytes and assigns official coverage by jurisdiction", async () => {
  const { db } = await areaPipeline();
  await publishTiles(db, { now: NOW });
  const before = v1TileRows(db);
  for (const a of AIRPORTS) {
    const { releaseId } = await ingestAirport(db, a);
    await resolveAirport(db, a, releaseId);
  }
  await publishTiles(db, { now: NOW });
  const after = v1TileRows(db);
  for (const old of before) assert.deepEqual(after.find((t) => t.tile_id === old.tile_id), old, old.tile_id);
  const airports = spotsOf(db).filter((s) => AIRPORTS.some((a) => s.sourceIds.includes(a.adapter.registry.sourceId)));
  assert.equal(airports.length, AIRPORTS.length);
  for (const a of AIRPORTS) {
    const s = airports.find((s) => s.sourceIds.includes(a.adapter.registry.sourceId))!;
    assert.deepEqual(prefectureOf(s, []), { code: a.prefecture, method: "sourceJurisdiction" });
  }
  assert.equal(SOURCE_PREFECTURES[SENDAI_SOURCE_ID], "04", "Sendai's reviewed jurisdiction is Miyagi");
  const metrics = await communityAcquisitionMetrics(db, airports, { now: NOW });
  assert.equal(metrics.prefectureCoverage.target, 47);
  assert.equal(metrics.prefectureCoverage.prefectures.length, 47);
  assert.equal(metrics.prefectureCoverage.unassigned, 0);
  assert.equal(metrics.prefectureCoverage.assignedBySeedArea, 0);
  assert.equal(metrics.published.officialVerified, AIRPORTS.length);
});
