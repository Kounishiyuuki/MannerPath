// KKRホテル金沢 through the shared reviewed-facility adapter (fixtures/kkr-hotel-kanazawa-smoking-places/PROVENANCE.md),
// and requiredAttribution: every officialAddressGeocode anchor's published attribution carries the credits its level needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { ABR_ATTRIBUTION, attributionCarriesCredit, requiredAttributionForReference } from "../src/pipeline/address-anchor.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { KKR_KANAZAWA_ADAPTER, KKR_KANAZAWA_FIXTURE_RELEASE, KKR_KANAZAWA_FIXTURE_SHA256 } from "../src/pipeline/kkr-hotel-kanazawa-adapter.ts";
import { assertRightsBasis, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { reviewedFacilityAdapter } from "../src/pipeline/reviewed-facility-adapter.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { checkSourceHealth } from "../src/source-health/check.ts";
import { extractRightsScope, rightsFingerprint } from "../src/source-health/rights.ts";
import { TileBodyV1, type TileSpotV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { productionHealthTargets, repositoryReviewedHealthTargets, sourceReviews } from "../scripts/source-health.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-11-08T06:00:00Z";
const adapter = KKR_KANAZAWA_ADAPTER;
const bytes = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/kkr-hotel-kanazawa-smoking-places/kkr-hotel-kanazawa-page-facts.csv", import.meta.url)));
async function pipeline(anchors = true) {
  const db = new SqliteD1();
  await ensureReviewedSource(db, adapter.registry.sourceId, NOW);
  const { releaseId } = await ingestRelease(db, adapter, bytes, KKR_KANAZAWA_FIXTURE_RELEASE);
  if (anchors) assert.equal(await recordReviewedAnchors(db, adapter, KKR_KANAZAWA_FIXTURE_SHA256, NOW), 1);
  return { db, resolve: () => resolveFirstRelease(db, adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds("K") }) };
}

test("kkr: pinned normalized facts reject coordinate, date, address and basis tampering", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), KKR_KANAZAWA_FIXTURE_SHA256);
  assert.equal(adapter.parse(bytes).rows.length, 1);
  const text = new TextDecoder().decode(bytes);
  for (const [before, after] of [["36.568729789", "35.0"], [",2026-11-08,", ",2026-11-09,"], ["officialAddressGeocode", "referenceDatasetPoint"], ["石川県金沢市大手町", "東京都中央区大手町"]]) {
    assert.throws(() => adapter.parse(new TextEncoder().encode(text.replace(before, after))), /reviewed fact row/);
  }
  assert.doesNotThrow(() => assertRightsBasis(adapter.registry));
  assert.equal(adapter.registry.rightsBasis?.kind, "factReference");
  assert.equal(adapter.registry.rightsBasis?.kind === "factReference" && adapter.registry.rightsBasis.prohibitsInformationUse, false);
  assert.deepEqual([adapter.registry.licenseName, adapter.registry.licenseUrl], [null, null]);
  assert.throws(() => adapter.assertResolvable!({ contentSha256: "f".repeat(64), sourceUrl: KKR_KANAZAWA_FIXTURE_RELEASE.sourceUrl, observedOn: "2026-11-08" }, []), /reviewed fact sheet/);
});

test("kkr: tiles/detail carry ONE approximate facility spot for both rooms, unknown support/access/hours, ABR credited", async () => {
  const { db, resolve } = await pipeline();
  assert.equal((await resolve()).status, "resolved");
  await publishTiles(db, { now: NOW });
  const tiles = v1TileRows(db).map(t => TileBodyV1.parse(JSON.parse(t.body_json)));
  const spots = tiles.flatMap(t => t.spots);
  assert.equal(spots.length, 1, "1F and 3F rooms are one facility spot, never two exact pins");
  const s = spots[0] as TileSpotV1;
  assert.equal(s.name, "KKRホテル金沢 喫煙所（1F・3F）");
  assert.deepEqual([s.latitude, s.longitude], [36.568729789, 136.660338131]);
  assert.equal(s.verification.locationPrecision, "areaApproximate");
  assert.deepEqual(s.verification.locationArea, { name: "KKRホテル金沢", kind: "facility", scope: "facility" });
  assert.equal(s.lastVerifiedAt, "2026-11-08", "official page check, not a site visit");
  assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType, s.accessDetail, s.hostType],
    ["unknown", "unknown", "unknown", "unknown", "unknown", null, "other"]);
  assert.deepEqual(s.openingHours, { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" });
  const published = tiles.flatMap(t => t.sources).find(src => src.id === adapter.registry.sourceId)!;
  assert.ok(published.attributionText.includes(ABR_ATTRIBUTION), "the published tile attribution carries the anchor credit");
  assert.match(published.attributionText, /喫煙場所そのものの位置ではありません/);
  const detail = await (await app.request(`/v1/spots/${s.id}`, {}, { DB: db })).json() as { spot: TileSpotV1; sources: { attributionText: string }[] };
  assert.deepEqual(detail.spot.verification, s.verification);
  assert.ok(detail.sources.every(src => src.attributionText.includes(ABR_ATTRIBUTION)), "and so does the detail response");
  const quality = await analyzeCorpus(db, { now: NOW });
  for (const id of ["area-anchor-never-exact", "published-sources-carry-license-and-attribution", "registry-row-matches-reviewed-entry"]) {
    assert.equal(quality.checks.find(check => check.id === id)?.status, "pass", id);
  }
});

test("kkr: existence cannot resolve without the independently reviewed anchor", async () => {
  const { db, resolve } = await pipeline(false);
  await assert.rejects(resolve(), /anchor/);
  assert.equal((db.raw.prepare("SELECT count(*) n FROM spots").get() as { n: number }).n, 0);
});

test("kkr: page drift, a removed smoking statement or a moved address requires review; rights scopes are both monitored", async () => {
  const target = repositoryReviewedHealthTargets().find(t => t.adapter.registry.sourceId === adapter.registry.sourceId)!;
  assert.ok(target.pageFact);
  assert.equal(productionHealthTargets().some(t => t.adapter.registry.sourceId === adapter.registry.sourceId), false);
  const scope = target.pageFact!.scope;
  if (scope.kind !== "htmlText") throw new Error("htmlText scope expected");
  const html = (answer: string) => `<html><body>${scope.ranges.map(range => `${range.start} ${answer} ${range.end}`).join(" ")}</body></html>`;
  const body = html(scope.requiredMarkers.join(" "));
  const scoped = extractRightsScope(body, scope);
  assert.ok(scoped.ok);
  const reviewed = { ...target, pageFact: { ...target.pageFact!, reviewedFingerprint: await rightsFingerprint(scoped.text) } };
  const response = (text: string) => ({ fetch: async () => new Response(text, { headers: { "content-type": "text/html" } }) });
  assert.equal((await checkSourceHealth(reviewed, response(body))).status, "healthy");
  assert.equal((await checkSourceHealth(reviewed, response(html(scope.requiredMarkers.join(" ") + " 閉鎖")))).status, "contentChanged");
  assert.equal((await checkSourceHealth(reviewed, response(body.replaceAll("石川県金沢市大手町2-32", "移転先未確認")))).status, "schemaChanged");
  const review = sourceReviews().find(r => r.sourceId === adapter.registry.sourceId)!;
  assert.deepEqual(review.rights.map(r => r.url), ["https://kanazawa.kkr.or.jp/facilities/", "https://www.kkr.or.jp/siteriyo.html"]);
});

test("requiredAttribution: every officialAddressGeocode anchor's attribution carries its credits; a missing credit refuses the adapter", () => {
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
  const values = [...KKR_ADAPTER_VALUES()];
  const config = { sourceId: "test-only", slug: "test-only", displayName: "TEST ONLY", pageUrl: values[7], fixtureFile: "x.csv", fixtureSha256: "0".repeat(64),
    release: KKR_KANAZAWA_FIXTURE_RELEASE, values, hostType: "other" as const, environment: "unknown" as const,
    rightsBasis: adapter.registry.rightsBasis!, reviewedBy: "TEST ONLY", reviewedOn: "2026-11-08" };
  assert.throws(() => reviewedFacilityAdapter({ ...config, attributionText: "出典：TEST ONLY" }), /attribution lacks the anchor credit/);
  // A parcel reference cannot publish until the parcel terms review is recorded (PARCEL_TERMS_REVIEW is null).
  const parcel = values.map((v, i) => i === 12 ? v.replace(" residential_detail ", " parcel ") : v);
  assert.throws(() => reviewedFacilityAdapter({ ...config, values: parcel, attributionText: adapter.registry.attributionText }), /parcel terms review/);
});

function KKR_ADAPTER_VALUES(): readonly string[] {
  return adapter.parse(bytes).rows[0];
}
