// The shared reviewed-facility adapter (TEST ONLY rows) and requiredAttribution: every officialAddressGeocode source's
// attribution carries the credits its anchor level needs, and a parcel point waits for its terms review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ABR_ATTRIBUTION, attributionCarriesCredit, requiredAttributionForReference } from "../src/pipeline/address-anchor.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { FACILITY_FACT_HEADER, reviewedFacilityAdapter, type ReviewedFacilitySource } from "../src/pipeline/reviewed-facility-adapter.ts";

const REF = "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=TEST ONLY 出力=TEST ONLY";
const URL_ = "https://example.invalid/test-only";
const values = ["t1", "TEST ONLY 喫煙所", "TEST ONLY 施設", "facility", "TEST ONLY", "石川県金沢市TEST ONLY", "other", URL_, "2026-11-08", "36.5", "136.6", "officialAddressGeocode", REF];
const config: ReviewedFacilitySource = {
  sourceId: "test-only-facility", slug: "test-only", displayName: "TEST ONLY", pageUrl: URL_, fixtureFile: "test-only.csv", fixtureSha256: "0".repeat(64),
  release: { sourceUrl: URL_, observedOn: "2026-11-08", fetchedAt: "2026-11-08T00:00:00Z", httpLastModified: null }, values,
  hostType: "other", environment: "unknown", attributionText: `出典：TEST ONLY。位置の目安：${ABR_ATTRIBUTION}。ピンは施設の代表点で喫煙場所そのものの位置ではありません。`,
  rightsBasis: { kind: "factReference", pageUrls: [URL_], termsUrls: [URL_], termsReading: "TEST ONLY", prohibitsInformationUse: false, reviewedBy: "TEST ONLY", reviewedOn: "2026-11-08" },
  reviewedBy: "TEST ONLY", reviewedOn: "2026-11-08",
};
const csv = (rows: readonly (readonly string[])[]) => new TextEncoder().encode([FACILITY_FACT_HEADER.join(","), ...rows.map(r => r.join(","))].join("\n") + "\n");

test("shared adapter: one approximate facility observation, unknowns kept, only the reviewed row parses", () => {
  const a = reviewedFacilityAdapter(config);
  assert.equal(a.registry.kind, "operator");
  assert.equal(a.parse(csv([values])).rows.length, 1);
  assert.throws(() => a.parse(csv([values.map((v, i) => i === 9 ? "35.0" : v)])), /reviewed fact row/);
  assert.throws(() => a.parse(csv([values, values])), /unexpected fact sheet/);
  const o = a.observe(values, { recordId: 1 } as never);
  assert.deepEqual([o.supportsPaper, o.supportsHeated, o.openingHours.status, o.classification?.accessType, o.classification?.environment], ["unknown", "unknown", "none", "unknown", "unknown"]);
  const [anchor] = a.reviewedAnchors!("0".repeat(64));
  assert.deepEqual([anchor.areaScope, anchor.anchorBasis?.basis], ["facility", "officialAddressGeocode"]);
  assert.throws(() => reviewedFacilityAdapter({ ...config, values: values.map((v, i) => i === 3 ? "namedZone" : v) }), /not a facility fact row/);
});

test("requiredAttribution: a missing credit refuses the adapter; a parcel point refuses while its terms are unreviewed", () => {
  assert.throws(() => reviewedFacilityAdapter({ ...config, attributionText: "出典：TEST ONLY" }), /attribution lacks the anchor credit/);
  const parcel = values.map((v, i) => i === 12 ? v.replace(" residential_detail ", " parcel ") : v);
  assert.throws(() => reviewedFacilityAdapter({ ...config, values: parcel }), /parcel terms review/);
});

test("requiredAttribution: every reviewed officialAddressGeocode source already carries its credits", () => {
  let checked = 0;
  for (const a of SOURCE_ADAPTERS) {
    for (const anchor of a.reviewedAnchors?.("0".repeat(64)) ?? []) {
      if (anchor.anchorBasis?.basis !== "officialAddressGeocode") continue;
      for (const credit of requiredAttributionForReference(anchor.anchorBasis.reference)) {
        assert.ok(attributionCarriesCredit(a.registry.attributionText, credit), `${a.registry.sourceId} lacks ${credit}`);
      }
      checked++;
    }
  }
  assert.ok(checked >= 3, "at least the three Kanazawa facility anchors are checked");
});
