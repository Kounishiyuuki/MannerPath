// The new operator facts and their independently evaluated address anchors must not promote held leads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluateCandidates } from "../scripts/address-anchor-candidates.ts";
import { abrJsonRun, addressAnchorDatasetRelease, evaluateAddressAnchor } from "../src/pipeline/address-anchor.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { importProductionBaselineSources, PRODUCTION_BASELINE_SOURCE_IDS } from "./support/reviewed-fixtures.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const DIR = new URL("../../data-pipeline/research/official-source-intake/kanazawa-2026-11-07/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, DIR));
const json = (file: string) => JSON.parse(read(file).toString());
const RELEASE = "abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d";
interface Facility {
  id: string;
  municipality: string;
  classification: string;
  blockers: string[];
  paper: boolean | null;
  heated: boolean | null;
  smokingHours: unknown;
  generalNonCustomerAccess: boolean | null;
  primaryUrls: string[];
}

test("regional survey separates first-party equipment, hosted rights holds and unconfirmed operation", () => {
  const survey = json("survey.json");
  const facilities = survey.facilities as Facility[];
  const count = (classification: string) => facilities.filter(f => f.classification === classification).length;
  assert.equal(new Set(facilities.map(f => f.id)).size, facilities.length);
  assert.equal(count("reviewedAdapterCandidate"), 2);
  assert.equal(count("rightsAndPositionReviewPending"), 9);
  assert.equal(count("hostedInformationRightsPending"), 3);
  assert.equal(count("currentExistencePending"), 2);
  assert.equal(count("excluded"), 2);
  assert.equal(facilities.length, 18);
  const direct = facilities.filter(f => ["reviewedAdapterCandidate", "rightsAndPositionReviewPending"].includes(f.classification));
  assert.equal(direct.length, survey.counts.directOperatorConfirmedFacilities);
  assert.equal(direct.filter(f => f.municipality === "金沢市").length, survey.counts.kanazawaCityDirectOperatorConfirmedFacilities);
  assert.equal(direct.filter(f => f.municipality === "野々市市").length, survey.counts.nonoichiDirectOperatorConfirmedFacilities);
  assert.equal(survey.counts.directOperatorConfirmedFacilities, 11);
  assert.equal(survey.counts.kanazawaCityDirectOperatorConfirmedFacilities, 4);
  assert.equal(survey.counts.nonoichiDirectOperatorConfirmedFacilities, 7);
  assert.equal(survey.counts.reviewedAdapterCandidates, count("reviewedAdapterCandidate"));
  assert.equal(survey.counts.rightsAndPositionReviewPending, count("rightsAndPositionReviewPending"));
  assert.equal(survey.counts.hostedInformationRightsPending, count("hostedInformationRightsPending"));
  assert.equal(survey.counts.currentExistencePending, count("currentExistencePending"));
  assert.equal(survey.counts.excluded, count("excluded"));
  assert.equal(survey.counts.productionAdded, 0);
  assert.deepEqual(facilities.filter(f => f.classification === "reviewedAdapterCandidate").map(f => f.id).sort(), ["artvillage", "nomura"]);
  for (const facility of facilities) {
    // Host hours, venue presence and tobacco sales never supply these unknown smoking-use facts.
    assert.equal(facility.paper, null);
    assert.equal(facility.heated, null);
    assert.equal(facility.smokingHours, null);
    assert.equal(facility.generalNonCustomerAccess, null);
    assert.ok(facility.primaryUrls.length > 0);
    assert.equal(facility.primaryUrls.some(url => /google\.[^/]+\/maps|clubjt|p-world|openstreetmap/i.test(url)), false);
    if (facility.classification === "reviewedAdapterCandidate") assert.deepEqual(facility.blockers, []);
    else assert.ok(facility.blockers.length > 0);
  }
  assert.equal(facilities.find(f => f.id === "hoshino")?.municipality, "野々市市", "a Kanazawa trade name is not municipal evidence");
  assert.equal(facilities.find(f => f.id === "kenroku-parking")?.classification, "currentExistencePending");
  assert.equal(facilities.find(f => f.id === "gokuraku")?.classification, "currentExistencePending");
});

test("new addresses reuse the byte-identical registered dataset without accepting the hotel's parcel point", () => {
  assert.deepEqual(addressAnchorDatasetRelease(RELEASE), { releaseId: RELEASE, fileCount: 15, lgCodes: ["172014", "172120"] });
  assert.equal(createHash("sha256").update(read("abr-manifest.sha256")).digest("hex"), RELEASE.split(":sha256:")[1]);
  assert.equal(read("abr-manifest.sha256").toString().trim().split("\n").length, 15);
  const raw = json("abrg-output.json");
  const run = json("geocoder-run.json");
  assert.match(run.originalOutputSha256, /^[0-9a-f]{64}$/);
  assert.match(run.redaction, /Rejected parcel coordinates and parcel identifiers omitted/);
  assert.match(run.redaction, /Accepted residential_detail records unchanged/);
  const rejected = raw.find((record: { result: { coordinate_level: string } }) => record.result.coordinate_level === "parcel");
  assert.ok(rejected);
  assert.equal(Object.keys(rejected.result).some(key => /^(lat|lon|prc_id|prc_num\d*)$/.test(key)), false,
    "rejected parcel coordinates and identifiers must not be redistributed in the research fixture");
  // Compared with the original local run before redaction: both accepted records are unchanged in full.
  const residential = raw.filter((record: { result: { coordinate_level: string } }) => record.result.coordinate_level === "residential_detail");
  assert.equal(residential.length, 2);
  assert.equal(createHash("sha256").update(JSON.stringify(residential)).digest("hex"),
    "7ae6107cee561c40ecd2f5f2b36e35890cd59b2fb63b73a63cf3d3746f94d93f");
  const results = evaluateCandidates(json("address-candidates.json"), raw, RELEASE);
  // anchor-evaluation.json is the committed gate-v2 record: gate v3 adds only requiredAttribution to the two anchors
  // and names the hotel's parcel blocker parcelTermsUnreviewed instead of precisionTooLow.
  const v2 = json("anchor-evaluation.json").results;
  assert.deepEqual(results.filter(r => r.status === "anchor").map(({ requiredAttribution: _, ...rest }: any) => rest), v2.filter((r: any) => r.status === "anchor"));
  assert.deepEqual(v2.find((r: any) => r.id === "international-hotel").reasons, ["noCoordinate", "precisionTooLow"]);
  const eligible = results.filter(result => result.status === "anchor");
  assert.deepEqual(eligible.map(result => result.id).sort(), ["artvillage", "nomura"]);
  for (const result of eligible) {
    assert.equal(result.status, "anchor");
    assert.equal(result.coordinateLevel, "residential_detail");
  }
  const hotel = results.find(result => result.id === "international-hotel");
  assert.ok(hotel && hotel.status === "reviewPending");
  assert.deepEqual(hotel.reasons, ["noCoordinate", "parcelTermsUnreviewed"]);
  // Even once the parcel terms are reviewed, the redacted record has no coordinate to adopt: a re-run is needed.
  const reviewed = { termsUrl: "https://example.invalid/terms", reviewedBy: "TEST ONLY", reviewedOn: "2026-11-08", attributionText: "TEST ONLY" };
  const input = json("address-candidates.json").find((c: any) => c.id === "international-hotel");
  const hotelRun = abrJsonRun(raw.find((x: any) => x.query.input === input.officialAddress), "2.3.1", RELEASE);
  const again = evaluateAddressAnchor({ officialAddress: input.officialAddress, expectedPrefecture: "石川県", expectedMunicipality: "金沢市", geocode: hotelRun }, { parcelTerms: reviewed });
  assert.deepEqual(again.status === "reviewPending" && again.reasons, ["noCoordinate"]);
  assert.equal("latitude" in hotel, false, "raw parcel coordinates are research evidence, never an accepted facility anchor");
});

test("two eligible Kanazawa facility anchors do not duplicate the local six-source 513-place baseline", async () => {
  const db = new SqliteD1();
  try {
    assert.equal(PRODUCTION_BASELINE_SOURCE_IDS.length, 6);
    await importProductionBaselineSources(db, "2026-11-07T00:00:00Z");
    const baseline = db.raw.prepare("SELECT spot_id, latitude, longitude FROM spots ORDER BY spot_id").all() as {
      spot_id: string; latitude: number; longitude: number;
    }[];
    // The six-source fixture includes two nonpublished raw rows beyond the 513 published places.
    assert.equal(baseline.length, 515);
    await publishTiles(db, { now: "2026-11-07T00:00:00Z" });
    const published = (await readPublishedTiles(db)).flatMap(tile => tile.spots);
    assert.equal(published.length, 513);
    const before = baseline;
    const anchors = evaluateCandidates(json("address-candidates.json"), json("abrg-output.json"), RELEASE)
      .filter(result => result.status === "anchor");
    assert.equal(anchors.length, 2);
    for (const anchor of anchors) {
      assert.equal(anchor.status, "anchor");
      assert.equal(baseline.some(spot => haversineMeters(anchor, spot) <= 25), false,
        `${anchor.id} must not reuse an existing place inside the established 25 m duplicate radius`);
    }
    assert.ok(haversineMeters(anchors[0]!, anchors[1]!) > 25);
    assert.deepEqual(db.raw.prepare("SELECT spot_id, latitude, longitude FROM spots ORDER BY spot_id").all(), before);
  } finally { db.raw.close(); }
});
