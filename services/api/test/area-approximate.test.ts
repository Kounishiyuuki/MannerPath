// ADR-0017: approximate area locations. Existence evidence + a reviewed area anchor publishes as areaApproximate;
// a host alone, a missing anchor or missing existence evidence never does; a precision upgrade keeps the spot ID and
// never moves the pin outside ADR-0009.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import {
  AREA_ANCHOR_POLICY_VERSION, type AreaApproximateCandidate, type ReviewedAreaAnchor, anchoredObservation,
  applyAreaPrecisionUpgrade, evaluateAreaApproximate, planAreaPrecisionUpgrade, recordAreaAnchor, validateAreaAnchor,
} from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter, SourceObservation } from "../src/pipeline/source-adapter.ts";
import { parseCsv } from "../src/pipeline/csv.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { gzipSync } from "node:zlib";
import { TileSpotV1 } from "../src/tiles/dto.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { anchorProvenanceMissing, publishTiles } from "../src/tiles/publish.ts";
import { NOW, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row | undefined;

const HEADER = ["id", "name", "area", "lat", "lon", "statement"];
// statement: "smoking" = the publisher states a smoking place (inside `area` when lat/lon are empty);
// "" = the row names a place/host only; "closed" = the publisher states it is closed.
const CSV = [
  HEADER.join(","),
  "1,公園内喫煙所,上野恩賜公園,,,smoking",
  "2,駅前喫煙所,,35.71,139.77,smoking",
  "3,上野駅,,35.7138,139.7773,",
  "4,不明公園喫煙所,不明公園,,,smoking",
  "5,閉鎖喫煙所,上野恩賜公園,,,closed",
].join("\n");

const anchorFor = (sourceId: string, overrides: Partial<ReviewedAreaAnchor> = {}): ReviewedAreaAnchor => ({
  anchorId: `aa_${sourceId.replaceAll(/[^a-z0-9]/g, "")}ueno`,
  areaName: "上野恩賜公園", areaKind: "park", latitude: 35.7155, longitude: 139.7733,
  originKind: "publisherAreaPoint", originSourceId: sourceId,
  originReference: "https://example.invalid/city/parks.csv#row=12",
  reuseBasis: "existenceSourceLicense", policyVersion: AREA_ANCHOR_POLICY_VERSION,
  reviewedBy: "maintainer", reviewedOn: "2026-10-02", ...overrides,
});

/** TEST ONLY: a municipal/operator list that states some places only by the area they are inside. */
function testAdapter(sourceId: string, kind: "municipal" | "operator", anchors: ReviewedAreaAnchor[]): SourceAdapter {
  const byArea = new Map(anchors.map((a) => [a.areaName, a]));
  const candidate = (v: readonly string[]): AreaApproximateCandidate => ({
    sourcePublication: "approved",
    existenceEvidence: v[5] === "" ? "hostOnly" : "smokingPlaceStated",
    conflict: v[5] === "closed" ? "closed" : "none",
    exactPoint: v[3] !== "" && v[4] !== "" ? "present" : "absent",
    area: v[2] === "" ? "notNamed" : "named",
    anchor: byArea.has(v[2]) ? "reviewed" : "missing",
  });
  return {
    registry: { sourceId, displayName: `TEST ${sourceId}`, kind, licenseName: "CC BY 4.0", licenseUrl: "https://example.invalid/l", attributionText: `© ${sourceId}`, publicationStatus: "approved" },
    parserVersion: "test-area.parse.v1", resolverVersion: "test-area.resolve.v1", mappingVersion: "test-area.map.v1",
    parse: (bytes) => parseCsv(new TextDecoder().decode(bytes)),
    upstreamRowRef: (v) => v[0],
    assertResolvable: () => {},
    // The gate decides scope: a host-only, closed or un-anchorable row stays raw evidence and creates no spot.
    includesRecord: (v) => evaluateAreaApproximate(candidate(v)).verdict !== "rejected",
    observe(v): SourceObservation {
      const base = {
        name: v[1], supportsPaper: "unknown" as const, supportsHeated: "unknown" as const,
        openingHours: { status: "none" as const, raw: null, parsed: null }, lifecycle: "active" as const,
        provenance: [{ field: "existence", columns: ["name", "statement"], rule: "test.listed.v1" }],
      };
      if (evaluateAreaApproximate(candidate(v)).verdict === "exactPoint") {
        return { ...base, latitude: Number(v[3]), longitude: Number(v[4]), provenance: [...base.provenance, { field: "location", columns: ["lat", "lon"], rule: "test.point.v1" }] };
      }
      return anchoredObservation(base, byArea.get(v[2])!, ["area"]);
    },
    attenuate: () => [],
    attenuationReference: { attestationVersion: "none", referenceKind: "none", referenceUrl: "https://example.invalid", checkedAt: NOW },
    crossReleaseValidated: false,
  };
}

async function addSource(db: SqliteD1, adapter: SourceAdapter) {
  const r = adapter.registry;
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
  ).run(r.sourceId, r.displayName, r.kind, r.licenseName, r.licenseUrl, r.attributionText, NOW, NOW);
}

async function pipeline(kind: "municipal" | "operator" = "municipal", opts: { recordAnchor?: boolean } = {}) {
  const db = new SqliteD1();
  const sourceId = kind === "municipal" ? "test-area-city" : "test-area-operator";
  const anchor = anchorFor(sourceId);
  const adapter = testAdapter(sourceId, kind, [anchor]);
  await addSource(db, adapter);
  if (opts.recordAnchor !== false) await recordAreaAnchor(db, anchor, NOW);
  const { releaseId } = await ingestRelease(db, adapter, new TextEncoder().encode(CSV),
    { sourceUrl: "https://example.invalid/list.csv", observedOn: "2026-09-30", fetchedAt: NOW, httpLastModified: null });
  return { db, adapter, anchor, releaseId, resolve: () => resolveFirstRelease(db, adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds() }) };
}

async function publishedSpots(db: SqliteD1): Promise<TileSpotV1[]> {
  await publishTiles(db, { now: NOW });
  return (await readPublishedTiles(db)).flatMap((t) => t.spots).sort((a, b) => a.name!.localeCompare(b.name!));
}

const byName = (spots: TileSpotV1[], name: string) => spots.find((s) => s.name === name);

test("official evidence + a reviewed area anchor publishes as areaApproximate; exact spots are unchanged", async () => {
  const { db, anchor, resolve } = await pipeline();
  assert.equal((await resolve()).status, "resolved");
  const spots = await publishedSpots(db);
  assert.deepEqual(spots.map((s) => s.name).sort(), ["公園内喫煙所", "駅前喫煙所"]);
  const approx = byName(spots, "公園内喫煙所")!;
  assert.deepEqual([approx.latitude, approx.longitude], [anchor.latitude, anchor.longitude]);
  assert.equal(approx.verification.existence, "official");
  assert.equal(approx.verification.locationPrecision, "areaApproximate");
  assert.deepEqual(approx.verification.locationArea, { name: "上野恩賜公園", kind: "park" });
  const exact = byName(spots, "駅前喫煙所")!;
  assert.equal(exact.verification.locationPrecision, "publisherPoint");
  assert.equal("locationArea" in exact.verification, false, "an exact spot's verification bytes are unchanged");
  // The anchor provenance is recorded and traceable: binding -> anchor -> origin source, reuse basis, review, policy.
  const b = one(db, `SELECT a.* FROM spot_location_anchors b JOIN area_location_anchors a ON a.anchor_id = b.anchor_id WHERE b.spot_id = ?`, approx.id)!;
  assert.deepEqual([b.origin_source_id, b.origin_kind, b.reuse_basis, b.policy_version, b.reviewed_by], ["test-area-city", "publisherAreaPoint", "existenceSourceLicense", AREA_ANCHOR_POLICY_VERSION, "maintainer"]);
  assert.equal(one(db, "SELECT rule FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'", approx.id)!.rule, `area-anchor.v1:${anchor.anchorId}`);
  const quality = await analyzeCorpus(db, { now: NOW, gzip: (b) => gzipSync(b).length, adapters: [] });
  assert.equal(quality.checks.find((c) => c.id === "area-anchor-never-exact")?.status, "pass");
});

test("operator evidence + a reviewed area anchor publishes as areaApproximate", async () => {
  const { db, resolve } = await pipeline("operator");
  await resolve();
  const approx = byName(await publishedSpots(db), "公園内喫煙所")!;
  assert.equal(approx.verification.existence, "operator");
  assert.equal(approx.verification.locationPrecision, "areaApproximate");
});

test("a missing exact coordinate alone does not reject; a missing anchor withholds without discarding evidence", async () => {
  const base: AreaApproximateCandidate = { sourcePublication: "approved", existenceEvidence: "smokingPlaceStated", conflict: "none", exactPoint: "absent", area: "named", anchor: "reviewed" };
  assert.equal(evaluateAreaApproximate(base).verdict, "areaApproximate");
  assert.deepEqual(evaluateAreaApproximate({ ...base, anchor: "missing" }).rejections, ["noReviewedAnchor"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, area: "notNamed" }).rejections, ["areaNotNamed"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, anchor: "forbiddenOrigin" }).rejections, ["forbiddenAnchorOrigin"]);
  const { db, resolve } = await pipeline();
  await resolve();
  const names = (await publishedSpots(db)).map((s) => s.name);
  assert.equal(names.includes("不明公園喫煙所"), false);
  assert.ok(one(db, "SELECT 1 FROM source_records WHERE raw_values_json LIKE '%不明公園喫煙所%'"), "the raw evidence is kept");
});

test("a host-only record and a record without existence evidence are rejected; an anchor never supplies existence", async () => {
  const base: AreaApproximateCandidate = { sourcePublication: "approved", existenceEvidence: "hostOnly", conflict: "none", exactPoint: "present", area: "named", anchor: "reviewed" };
  assert.deepEqual(evaluateAreaApproximate(base).rejections, ["hostOnly"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, existenceEvidence: "none", exactPoint: "absent" }).rejections, ["noExistenceEvidence"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, existenceEvidence: "smokingPlaceStated", sourcePublication: "notApproved" }).rejections, ["sourceNotApproved"]);
  assert.throws(() => anchoredObservation({
    name: "x", supportsPaper: "unknown", supportsHeated: "unknown", openingHours: { status: "none", raw: null, parsed: null },
    lifecycle: "active", provenance: [],
  }, anchorFor("test-area-city"), ["area"]), /existence evidence/);
  const { db, resolve } = await pipeline();
  await resolve();
  assert.equal((await publishedSpots(db)).some((s) => s.name === "上野駅"), false, "a station row is a host, never a spot");
});

test("closed, prohibited or conflicting evidence rejects, whatever the anchor", async () => {
  const base: AreaApproximateCandidate = { sourcePublication: "approved", existenceEvidence: "smokingPlaceStated", conflict: "closed", exactPoint: "absent", area: "named", anchor: "reviewed" };
  assert.deepEqual(evaluateAreaApproximate(base).rejections, ["closedOrProhibited"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, conflict: "prohibited" }).rejections, ["closedOrProhibited"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, conflict: "conflictingPublications" }).rejections, ["conflictingEvidence"]);
  const { db, resolve } = await pipeline();
  await resolve();
  assert.equal((await publishedSpots(db)).some((s) => s.name === "閉鎖喫煙所"), false);
});

test("anchor provenance is required: an unrecorded, forbidden-origin or other-source anchor fails closed", async () => {
  const { db, resolve } = await pipeline("municipal", { recordAnchor: false });
  await assert.rejects(resolve, /area anchor .* is not recorded/);
  assert.equal(one(db, "SELECT count(*) n FROM spots")!.n, 0, "nothing canonical is written");
  for (const origin of ["https://www.google.com/maps/place/x", "https://maps.apple.com/?ll=35,139", "https://www.openstreetmap.org/node/1", "screenshot of a map"]) {
    assert.deepEqual(validateAreaAnchor(anchorFor("test-area-city", { originReference: origin })), ["forbiddenOrigin"]);
    await assert.rejects(() => recordAreaAnchor(db, anchorFor("test-area-city", { anchorId: "aa_x", originReference: origin }), NOW), /forbiddenOrigin/);
    assert.throws(() => db.raw.prepare(`INSERT INTO area_location_anchors (anchor_id, area_name, area_kind, latitude, longitude, origin_kind,
      origin_source_id, origin_reference, reuse_basis, policy_version, reviewed_by, reviewed_on, evidence_sha256, recorded_at)
      VALUES ('aa_raw', 'x', 'park', 35, 139, 'publisherAreaPoint', 'test-area-city', ?, 'existenceSourceLicense', ?, 'm', '2026-10-02', ?, ?)`)
      .run(origin, AREA_ANCHOR_POLICY_VERSION, "a".repeat(64), NOW), /never canonical anchors/);
  }
  assert.deepEqual(validateAreaAnchor(anchorFor("test-area-city", { reuseBasis: "googleTerms" as never })), ["reuseBasisNotReviewed"]);
  assert.deepEqual(validateAreaAnchor(anchorFor("test-area-city", { latitude: 0, longitude: 0 })), ["coordinateInvalid"]);
  // An anchor from another source (policy v1: only the existence source's own publication) is refused at resolve.
  const cross = new SqliteD1();
  const foreign = anchorFor("test-area-operator");
  const crossAdapter = testAdapter("test-area-city", "municipal", [foreign]);
  await addSource(cross, crossAdapter);
  await addSource(cross, testAdapter("test-area-operator", "operator", []));
  await recordAreaAnchor(cross, foreign, NOW);
  const { releaseId } = await ingestRelease(cross, crossAdapter, new TextEncoder().encode(CSV),
    { sourceUrl: "https://example.invalid/list.csv", observedOn: "2026-09-30", fetchedAt: NOW, httpLastModified: null });
  await assert.rejects(() => resolveFirstRelease(cross, crossAdapter, releaseId, { now: NOW }), /is not from source test-area-city/);
  assert.equal(anchorProvenanceMissing({ location_rule: "area-anchor.v1:aa_x", location_precision_override: null } as never), true);
  assert.equal(anchorProvenanceMissing({ location_rule: "test.point.v1", location_precision_override: null } as never), false);
});

test("the tile and spot-detail APIs serialize areaApproximate with its area; the schema forbids a mismatched area", async () => {
  const { db, resolve } = await pipeline();
  await resolve();
  const approx = byName(await publishedSpots(db), "公園内喫煙所")!;
  const res = await app.request(`/v1/spots/${approx.id}`, {}, { DB: db });
  assert.equal(res.status, 200);
  const body = await res.json() as { spot: TileSpotV1 };
  assert.equal(body.spot.verification.locationPrecision, "areaApproximate");
  assert.deepEqual(body.spot.verification.locationArea, { name: "上野恩賜公園", kind: "park" });
  assert.equal(TileSpotV1.safeParse({ ...approx, verification: { ...approx.verification, locationArea: undefined } }).success, false);
  assert.equal(TileSpotV1.safeParse({ ...approx, verification: { ...approx.verification, locationPrecision: "publisherPoint" } }).success, false);
});

test("precision upgrade at the same coordinate keeps the spot ID and changes only the precision", async () => {
  const { db, anchor, resolve } = await pipeline();
  await resolve();
  const before = byName(await publishedSpots(db), "公園内喫煙所")!;
  const plan = planAreaPrecisionUpgrade({ spot: before, newPoint: { latitude: anchor.latitude, longitude: anchor.longitude, precision: "publisherPoint" }, insideArea: true });
  assert.deepEqual(plan, { kind: "precisionOnly", precision: "publisherPoint" });
  await applyAreaPrecisionUpgrade(db, before.id, "publisherPoint", "2026-10-03T00:00:00Z");
  const after = byName(await publishedSpots(db), "公園内喫煙所")!;
  assert.equal(after.id, before.id);
  assert.deepEqual([after.latitude, after.longitude], [before.latitude, before.longitude]);
  assert.equal(after.verification.locationPrecision, "publisherPoint");
  assert.equal("locationArea" in after.verification, false);
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, before.id, "publisherPoint", NOW), /no active area anchor/);
  assert.deepEqual(planAreaPrecisionUpgrade({ spot: before, newPoint: { ...before, precision: "reviewedDerived" }, insideArea: true }),
    { kind: "refused", reason: "reviewedDerivedNotApproved" });
});

test("any coordinate change, even a tiny one inside the same area, requires ADR-0009 review", async () => {
  const { db, resolve } = await pipeline();
  await resolve();
  const spot = byName(await publishedSpots(db), "公園内喫煙所")!;
  const moved = { latitude: spot.latitude + 0.000001, longitude: spot.longitude, precision: "publisherPoint" as const };
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: moved, insideArea: true }), { kind: "relocationReview", adr: "ADR-0009", identityReview: false });
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: moved, insideArea: false }), { kind: "relocationReview", adr: "ADR-0009", identityReview: true });
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: moved, insideArea: "unknown" }), { kind: "relocationReview", adr: "ADR-0009", identityReview: true });
  // No path moves the pin outside review: a direct update, or ending the anchor "for relocation" without a hold.
  assert.throws(() => db.raw.prepare("UPDATE spots SET latitude = ? WHERE spot_id = ?").run(moved.latitude, spot.id), /anchor coordinate|relocation application/);
  assert.throws(() => db.raw.prepare("UPDATE spot_location_anchors SET ended_at = ?, end_reason = 'relocationReview' WHERE spot_id = ?").run(NOW, spot.id), /ADR-0009 relocation review/);
  assert.throws(() => db.raw.prepare("DELETE FROM spot_location_anchors WHERE spot_id = ?").run(spot.id), /never deleted/);
  assert.equal(one(db, "SELECT latitude FROM spots WHERE spot_id = ?", spot.id)!.latitude, spot.latitude);
});

test("promotion carries anchors and bindings, so a bootstrapped database still publishes areaApproximate", async () => {
  const { buildMultiSourcePromotionBundle } = await import("../src/pipeline/promotion.ts");
  const { applyPromotionBundle, migratedSqlite } = await import("./support/sqlite-d1.ts");
  const { db, adapter, resolve } = await pipeline();
  await resolve();
  const before = await publishedSpots(db);
  // TEST ONLY registry: the test source stands in for a reviewed one; production promotion uses REVIEWED_SOURCES.
  const registry = { source: () => adapter.registry, terms: () => { throw new Error("no terms"); } };
  const { sql } = await buildMultiSourcePromotionBundle(db, { registry });
  assert.equal(sql.split("\n").filter((l) => l.startsWith("INSERT INTO area_location_anchors")).length, 1);
  assert.equal(sql.split("\n").filter((l) => l.startsWith("INSERT INTO spot_location_anchors")).length, 1);
  const target = migratedSqlite();
  applyPromotionBundle(target, sql);
  const green = new SqliteD1(target);
  assert.deepEqual((await readPublishedTiles(green)).flatMap((t) => t.spots).sort((a, b) => a.name!.localeCompare(b.name!)), before);
  // A republish in GREEN reads the carried binding: nothing silently becomes exact.
  assert.deepEqual(await publishedSpots(green), before);
});

test("the nationwide replay classifier never rescues past another gate", async () => {
  const { classifyApproximate } = await import("../src/quality/approximate-replay.ts");
  const base = { targetId: "t", jurisdiction: "j", prefecture: null, blockerCodes: [] as string[], explicitExistence: true,
    location: "areaOrHost" as const, reusableAnchor: true, alreadyPublished: false, text: "" };
  assert.equal(classifyApproximate(base).category, "A-rescuedByAreaApproximate");
  assert.equal(classifyApproximate({ ...base, blockerCodes: ["exactResourceRights"] }).category, "C-rightsBlocked");
  assert.equal(classifyApproximate({ ...base, reusableAnchor: false }).category, "D-noReusableAnchor");
  assert.equal(classifyApproximate({ ...base, location: "addressOnly" }).category, "G-geocodingNeeded");
  assert.equal(classifyApproximate({ ...base, explicitExistence: false }).category, "B-existenceInsufficient");
  assert.equal(classifyApproximate({ ...base, explicitExistence: false, blockerCodes: ["noPermittedSmokingPlaceEvidence"] }).category, "F-prohibitionOrConflict");
  assert.equal(classifyApproximate({ ...base, blockerCodes: ["closureOrAvailabilityRequiresReconciliation"] }).category, "F-prohibitionOrConflict");
  // A street-smoking prohibition district is not a ban on permitted places: it stays an existence question.
  assert.equal(classifyApproximate({ ...base, explicitExistence: false, text: "street-smoking prohibited-district policy" }).category, "B-existenceInsufficient");
  assert.equal(classifyApproximate({ ...base, location: "unestablished" }).adr0017RemovesLocationBlocker, false);
});
