// Derived coordinates from official addresses (ADR-0011, Proposed; migration 0022). The publication policy is NOT
// approved: every test that reaches "would publish" injects an approved policy and a pinned dataset explicitly and
// says so. Nothing here approves a source, a geocoder dataset or the policy for real.
//
// Geocoder outputs below are copied from a real local run of @digital-go-jp/abr-geocoder@2.3.1 over the Chiyoda
// (131016) ABR download on 2026-10-01 (`abrg in.txt out.json -f json`, run twice, byte-identical).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  DERIVED_COORDINATE_PUBLICATION_POLICY, type DerivedCoordinateInput, type DerivedReview, type GeocodeRun, PROPOSED_EVIDENCE_QUALITY,
  REVIEWED_GEOCODERS, type ReviewedGeocoder, derivedCoordinateEvidenceSha256, derivedPublicationDecision, evaluateDerivedCoordinate,
  planPublisherCoordinateReplacement, precisionOf, recordDerivedGeocode, recordDerivedReview, sharedDerivedCoordinates,
} from "../src/pipeline/derived-coordinate.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const DATASET = "ab".repeat(32);
// TEST ONLY: the repository pins no dataset release; these tests pin a stand-in digest to exercise the gate.
const PINNED: ReviewedGeocoder[] = REVIEWED_GEOCODERS.map((g) => ({ ...g, datasetReleases: [DATASET] }));
const APPROVED_POLICY = { status: "approved" } as const; // TEST ONLY simulation of a future maintainer approval.

const KIOICHO: GeocodeRun = {
  geocoderId: "abr-geocoder", geocoderVersion: "2.3.1", options: { target: "all", fuzzy: null }, datasetReleaseId: DATASET,
  input: "東京都千代田区紀尾井町1-3", output: "東京都千代田区紀尾井町1-3", others: [], score: 1,
  matchLevel: "residential_detail", coordinateLevel: "residential_detail", latitude: 35.679107172, longitude: 139.736394597,
  srid: "EPSG:6668", lgCode: "131016", pref: "東京都", city: "千代田区", ward: null, candidateCount: 1,
};

function candidate(overrides: { source?: Partial<DerivedCoordinateInput["source"]>; record?: Partial<DerivedCoordinateInput["record"]>; geocode?: Partial<GeocodeRun> | null } = {}): DerivedCoordinateInput {
  return {
    source: { sourceId: "test-official", publicationStatus: "approved", existenceEvidence: "officialSmokingPlace", currentOperation: "confirmed", addressReuse: "reviewed", ...overrides.source },
    record: { recordId: 1, addressColumn: "所在地", officialAddress: "東京都千代田区紀尾井町1-3", addressSuppliedBy: "publisher", inputRule: "verbatim", expectedPrefecture: "東京都", expectedMunicipality: "千代田区", ...overrides.record },
    geocode: overrides.geocode === null ? null : { ...KIOICHO, ...overrides.geocode },
  };
}
const evaluate = (c: DerivedCoordinateInput) => evaluateDerivedCoordinate(c, PINNED);
const CHECKS = { officialAddress: true, normalizedAddress: true, returnedLocation: true, precision: true, regionSanity: true, currentListing: true };
const review = (evidenceSha256: string, over: Partial<DerivedReview> = {}): DerivedReview =>
  ({ evidenceSha256, decision: "approve", reviewer: "maintainer", checks: CHECKS, siteEvidence: null, reviewedAt: "2026-10-01T00:00:00Z", ...over });

test("exact official address at residential-detail precision is a candidate, clearly marked as derived", () => {
  const e = evaluate(candidate());
  assert.equal(e.verdict, "candidate");
  assert.deepEqual(e.rejections, []);
  assert.equal(e.precision, "residentialDetail");
  assert.equal(e.coordinateOrigin, "derivedGeocode");
  assert.equal(e.publishable, false);
  assert.deepEqual(e.coordinate, { latitude: 35.679107172, longitude: 139.736394597 });
  assert.match(e.dataLicenses[0], /公共データ利用規約/);
  assert.notEqual(PROPOSED_EVIDENCE_QUALITY, "officialListing");
});

test("the geocoder never creates existence: host, non-smoking and unconfirmed rows are rejected", () => {
  assert.ok(evaluate(candidate({ source: { existenceEvidence: "hostFacility" } })).rejections.includes("notOfficialSmokingPlace"));
  assert.ok(evaluate(candidate({ source: { existenceEvidence: "none" } })).rejections.includes("notOfficialSmokingPlace"));
  for (const op of ["unknown", "suspended", "closed"] as const) {
    assert.ok(evaluate(candidate({ source: { currentOperation: op } })).rejections.includes("currentOperationNotConfirmed"));
  }
  assert.ok(evaluate(candidate({ record: { addressSuppliedBy: "other" } })).rejections.includes("addressNotPublisherSupplied"));
  assert.ok(evaluate(candidate({ source: { addressReuse: "unknown" } })).rejections.includes("addressReuseNotReviewed"));
});

test("unapproved source rejected", () => {
  const e = evaluate(candidate({ source: { publicationStatus: "blocked" } }));
  assert.equal(e.verdict, "rejected");
  assert.ok(e.rejections.includes("sourceNotApproved"));
  assert.equal(e.coordinate, null);
});

test("unreviewed geocoder, stale version, unpinned dataset and fuzzy matching are rejected", () => {
  assert.ok(evaluate(candidate({ geocode: { geocoderId: "some-web-geocoder" } })).rejections.includes("geocoderNotReviewed"));
  assert.ok(evaluate(candidate({ geocode: { geocoderVersion: "2.2.1" } })).rejections.includes("geocoderVersionNotReviewed"));
  assert.ok(evaluate(candidate({ geocode: { datasetReleaseId: "cd".repeat(32) } })).rejections.includes("datasetReleaseNotPinned"));
  assert.ok(evaluate(candidate({ geocode: { options: { target: "all", fuzzy: "?" } } })).rejections.includes("fuzzyMatching"));
  // The committed registry pins no dataset: a real run fails closed until a maintainer pins one.
  assert.ok(evaluateDerivedCoordinate(candidate()).rejections.includes("datasetReleaseNotPinned"));
});

test("ambiguous, unmatched or meaning-changing addresses fail closed (real abrg outputs)", () => {
  assert.ok(evaluate(candidate({ geocode: { candidateCount: 2 } })).rejections.includes("multipleCandidates"));
  assert.ok(evaluate(candidate({ geocode: { candidateCount: 0 } })).rejections.includes("noExactMatch"));
  // 東京都千代田区紀尾井町99-99: the house number does not exist; abrg falls back to the 町字 point.
  const missing = evaluate(candidate({ geocode: { input: "東京都千代田区紀尾井町99-99", others: ["99-99"], matchLevel: "machiaza", coordinateLevel: "machiaza", latitude: 35.681411, longitude: 139.73495 } }));
  assert.equal(missing.verdict, "rejected");
  assert.ok(missing.rejections.includes("unmatchedRemainder") && missing.rejections.includes("precisionTooLow"));
  // 千代田区有楽町2-9 without prefecture: abrg printed 東京都千代田区千代田区有楽町2-9 at score 0.59.
  const misparsed = evaluate(candidate({ geocode: { output: "東京都千代田区千代田区有楽町2-9", others: ["区有楽町2-9"], score: 0.59, matchLevel: "machiaza", coordinateLevel: "machiaza" } }));
  assert.ok(misparsed.rejections.includes("normalizationChangedMeaning"));
  // A trailing building name is left in `others`: not silently dropped.
  assert.ok(evaluate(candidate({ geocode: { others: ["JR秋葉原駅"], score: 0.88 } })).rejections.includes("unmatchedRemainder"));
  assert.ok(evaluate(candidate({ record: { inputRule: "stripBuildingName" } })).rejections.includes("inputRuleNotReviewed"));
});

test("missing house number and town-level results are rejected; the coordinate level, not the match level, decides", () => {
  // 東京都千代田区丸の内: matched a 町字 but the only coordinate is the city representative point.
  const town = evaluate(candidate({ geocode: { others: [], matchLevel: "machiaza", coordinateLevel: "city", latitude: 35.694003, longitude: 139.753634 } }));
  assert.ok(town.rejections.includes("precisionTooLow") && town.rejections.includes("coordinateCoarserThanMatch"));
  for (const level of ["error", "unknown", "prefecture", "city", "machiaza", "machiaza_detail"] as const) assert.equal(precisionOf(level), "insufficient");
  const coarse = evaluate(candidate({ geocode: { matchLevel: "residential_detail", coordinateLevel: "residential_block" } }));
  assert.ok(coarse.rejections.includes("coordinateCoarserThanMatch"));
});

test("block and parcel precision need human review with site evidence; parcel carries the MoJ license too", async () => {
  const block = evaluate(candidate({ geocode: { matchLevel: "residential_block", coordinateLevel: "residential_block" } }));
  assert.equal(block.verdict, "reviewRequired");
  const parcel = evaluate(candidate({ geocode: { matchLevel: "parcel", coordinateLevel: "parcel" } }));
  assert.equal(parcel.verdict, "reviewRequired");
  assert.ok(parcel.dataLicenses.some((l) => l.includes("登記所備付地図")));
  const sha = await derivedCoordinateEvidenceSha256(candidate({ geocode: { matchLevel: "parcel", coordinateLevel: "parcel" } }));
  assert.deepEqual(derivedPublicationDecision(parcel, sha, [review(sha)], APPROVED_POLICY).blockers, ["siteEvidenceMissing"]);
  assert.equal(derivedPublicationDecision(parcel, sha, [review(sha, { siteEvidence: "official map PDF p.2 marks the booth" })], APPROVED_POLICY).publish, true);
});

test("jurisdiction mismatch and out-of-country coordinates are rejected", () => {
  assert.ok(evaluate(candidate({ record: { expectedMunicipality: "中央区" } })).rejections.includes("jurisdictionMismatch"));
  assert.ok(evaluate(candidate({ record: { expectedPrefecture: "神奈川県" } })).rejections.includes("jurisdictionMismatch"));
  assert.ok(evaluate(candidate({ geocode: { latitude: 0, longitude: 0 } })).rejections.includes("coordinateInvalid"));
  assert.ok(evaluate(candidate({ geocode: { latitude: null, longitude: null } })).rejections.includes("noCoordinate"));
  // A designated city's ward matches either the city or city+ward as published.
  const sapporo = candidate({ record: { expectedPrefecture: "北海道", expectedMunicipality: "札幌市中央区" }, geocode: { pref: "北海道", city: "札幌市", ward: "中央区", latitude: 43.06, longitude: 141.35 } });
  assert.ok(!evaluate(sapporo).rejections.includes("jurisdictionMismatch"));
});

test("geocoder disagreement fails closed; duplicate points across places surface as a review group", () => {
  const c = { ...candidate(), secondOpinions: [{ ...KIOICHO, latitude: 35.6792 }] };
  assert.ok(evaluate(c).rejections.includes("geocoderDisagreement"));
  assert.deepEqual(evaluate({ ...candidate(), secondOpinions: [{ ...KIOICHO }] }).rejections, []);
  const a = evaluate(candidate());
  assert.deepEqual(sharedDerivedCoordinates([{ key: "a", evaluation: a }, { key: "b", evaluation: a }, { key: "c", evaluation: evaluate(candidate({ source: { publicationStatus: "blocked" } })) }]), [["a", "b"]]);
});

test("deterministic rerun: the same run digests identically, any changed output or version is different evidence", async () => {
  const one = await derivedCoordinateEvidenceSha256(candidate());
  assert.equal(await derivedCoordinateEvidenceSha256(candidate()), one);
  assert.notEqual(await derivedCoordinateEvidenceSha256(candidate({ geocode: { latitude: 35.6791072 } })), one);
  assert.notEqual(await derivedCoordinateEvidenceSha256(candidate({ geocode: { datasetReleaseId: "cd".repeat(32) } })), one);
});

test("no auto publication: policy, gate and an explicit, current, complete reviewer decision are all required", async () => {
  const e = evaluate(candidate());
  const sha = await derivedCoordinateEvidenceSha256(candidate());
  assert.equal(DERIVED_COORDINATE_PUBLICATION_POLICY.status, "proposed");
  assert.deepEqual(derivedPublicationDecision(e, sha, [review(sha)]).blockers, ["policyNotApproved"]);
  assert.deepEqual(derivedPublicationDecision(e, sha, [], APPROVED_POLICY).blockers, ["notReviewed"]);
  assert.deepEqual(derivedPublicationDecision(e, sha, [review(sha, { checks: { ...CHECKS, currentListing: false } })], APPROVED_POLICY).blockers, ["reviewIncomplete"]);
  assert.equal(derivedPublicationDecision(e, sha, [review(sha)], APPROVED_POLICY).publish, true);
  // Append-only log: a later reject wins; a review of other evidence (a geocoder update) is stale.
  const later = review(sha, { decision: "reject", reviewedAt: "2026-10-02T00:00:00Z" });
  assert.deepEqual(derivedPublicationDecision(e, sha, [review(sha), later], APPROVED_POLICY).blockers, ["reviewRejected"]);
  const rerun = await derivedCoordinateEvidenceSha256(candidate({ geocode: { latitude: 35.6791 } }));
  assert.deepEqual(derivedPublicationDecision(e, rerun, [review(sha)], APPROVED_POLICY).blockers, ["reviewStale"]);
  const rejected = evaluate(candidate({ source: { publicationStatus: "blocked" } }));
  assert.ok(derivedPublicationDecision(rejected, sha, [review(sha)], APPROVED_POLICY).blockers.includes("gateRejected"));
});

test("a later publisher coordinate replaces a derived one only as a reviewed relocation, keeping identity", () => {
  const plan = planPublisherCoordinateReplacement({ origin: "derivedGeocode", latitude: 35.679107172, longitude: 139.736394597 }, { latitude: 35.67915, longitude: 139.73642 });
  assert.equal(plan.action, "relocationReview");
  assert.equal(plan.fromOrigin, "derivedGeocode");
  assert.equal(plan.toOrigin, "publisher");
  assert.ok(plan.displayDistanceMeters > 0 && plan.displayDistanceMeters < 10);
  // Even an identical point changes the evidence type, so it is reviewed too; publisher→same publisher is a no-op.
  assert.equal(planPublisherCoordinateReplacement({ origin: "derivedGeocode", latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 }).action, "relocationReview");
  assert.equal(planPublisherCoordinateReplacement({ origin: "publisher", latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 }).action, "none");
});

test("no Google/MapKit/OSM geocoding: the module and its registry name none of them", () => {
  const src = readFileSync(new URL("../src/pipeline/derived-coordinate.ts", import.meta.url), "utf8");
  for (const forbidden of [/googleapis|maps\.google/i, /MKLocalSearch|CLGeocoder|MKGeocod/, /nominatim|overpass/i, /fetch\(/]) assert.doesNotMatch(src, forbidden);
  assert.deepEqual(REVIEWED_GEOCODERS.map((g) => g.geocoderId), ["abr-geocoder"]);
  assert.deepEqual(REVIEWED_GEOCODERS[0].datasetReleases, []);
  // No other source file consumes derived coordinates, so nothing resolves or publishes them.
  const users = readdirSync(new URL("../src/", import.meta.url), { recursive: true }).map(String)
    .filter((f) => f.endsWith(".ts") && !f.endsWith("derived-coordinate.ts"))
    .filter((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8").includes("derived-coordinate"));
  assert.deepEqual(users, []);
});

test("migration 0022: evidence and reviews are append-only, bound to digests, and never touch published spots or tiles", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  const snapshot = () => db.raw.prepare("SELECT * FROM tile_snapshot_spots ORDER BY spot_id").all();
  const tilesBefore = snapshot();
  const spotsBefore = db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all();
  const recordId = (db.raw.prepare("SELECT min(record_id) AS r FROM source_records").get() as { r: number }).r;
  const input = candidate({ record: { recordId } });
  const { geocodeId, evidenceSha256 } = await recordDerivedGeocode(db, input, evaluate(input), NOW);
  const row = db.raw.prepare("SELECT * FROM derived_coordinate_geocodes WHERE geocode_id = ?").get(geocodeId) as Record<string, unknown>;
  assert.equal(row.official_address, "東京都千代田区紀尾井町1-3");
  assert.equal(row.precision, "residentialDetail");
  assert.equal(row.coordinate_level, "residential_detail");
  assert.equal(row.dataset_release_id, DATASET);
  assert.throws(() => db.raw.prepare("UPDATE derived_coordinate_geocodes SET latitude = 1 WHERE geocode_id = ?").run(geocodeId), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM derived_coordinate_geocodes").run(), /immutable/);
  await assert.rejects(recordDerivedGeocode(db, input, evaluate(input), NOW), /UNIQUE/);
  // An unreviewed geocoder has no known data license and is refused before insert.
  const web = candidate({ record: { recordId }, geocode: { geocoderId: "some-web-geocoder" } });
  await assert.rejects(recordDerivedGeocode(db, web, evaluateDerivedCoordinate(web, PINNED), NOW), /not reviewed/);

  await assert.rejects(recordDerivedReview(db, geocodeId, review("00".repeat(32))), /different evidence/);
  await assert.rejects(recordDerivedReview(db, geocodeId, review(evidenceSha256, { checks: { ...CHECKS, regionSanity: false } })), /every review check/);
  await recordDerivedReview(db, geocodeId, review(evidenceSha256));
  await recordDerivedReview(db, geocodeId, review(evidenceSha256, { decision: "reject", reviewedAt: "2026-10-02T00:00:00Z" }));
  assert.throws(() => db.raw.prepare("UPDATE derived_coordinate_reviews SET decision = 'approve'").run(), /append-only/);
  assert.throws(() => db.raw.prepare("DELETE FROM derived_coordinate_reviews").run(), /append-only/);

  const blockInput = candidate({ record: { recordId, addressColumn: "設置位置" }, geocode: { matchLevel: "residential_block", coordinateLevel: "residential_block" } });
  const block = await recordDerivedGeocode(db, blockInput, evaluate(blockInput), NOW);
  await assert.rejects(recordDerivedReview(db, block.geocodeId, review(block.evidenceSha256)), /site evidence/);
  const townInput = candidate({ record: { recordId, addressColumn: "名称" }, geocode: { matchLevel: "machiaza", coordinateLevel: "machiaza" } });
  const town = await recordDerivedGeocode(db, townInput, evaluate(townInput), NOW);
  await assert.rejects(recordDerivedReview(db, town.geocodeId, review(town.evidenceSha256, { siteEvidence: "x" })), /insufficient-precision/);

  // Promotion/provenance preservation: an approved review changed no spot, provenance row or tile.
  const republish = await publishTiles(db, { now: NOW });
  assert.deepEqual(republish.published, []);
  assert.deepEqual(snapshot(), tilesBefore);
  assert.deepEqual(db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all(), spotsBefore);
  assert.equal((db.raw.prepare("SELECT count(*) AS n FROM spot_field_provenance WHERE rule LIKE '%derived%' OR rule LIKE '%geocod%'").get() as { n: number }).n, 0);
});

test("replay of committed address-only candidates: none passes the gate today, and none even in the simulated best case", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/derived-coordinate-replay.ts", "--json"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const report = JSON.parse(out);
  assert.equal(report.total.candidates, 26);
  assert.deepEqual(report.gate.currentPassing, []);
  assert.deepEqual(report.gate.bestCaseCandidate, []);
  assert.deepEqual(report.gate.bestCaseRejections["sapporo-odori-park"], ["currentOperationNotConfirmed"]);
  assert.deepEqual(report.gate.bestCaseRejections["shizuoka-station-plazas"], ["noGeocodeResult"]);
});
