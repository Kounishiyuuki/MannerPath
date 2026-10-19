// ADR-0018 municipal page-fact source (豊島区 区指定喫煙所): existence and hours from the ward's current list, each pin the
// ABR representative point of the page's own address (item 5). One spot per address point, never exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ADDRESS_ANCHOR_DATASET_RELEASE } from "../src/pipeline/address-anchor.ts";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import {
  TOSHIMA_ADAPTER, TOSHIMA_FIXTURE_RELEASE, TOSHIMA_FIXTURE_SHA256, TOSHIMA_SOURCE_ID,
} from "../src/pipeline/toshima-adapter.ts";
import { assertRightsBasis, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { checkSourceHealth, type HealthTarget } from "../src/source-health/check.ts";
import { extractRightsScope, rightsFingerprint } from "../src/source-health/rights.ts";
import { repositoryReviewedHealthTargets } from "../scripts/source-health.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-10-19T12:00:00Z";
const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/toshima-smoking-places/toshima-page-facts.csv", import.meta.url)));
const spotsOf = (db: SqliteD1) => v1TileRows(db).flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);

async function published() {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TOSHIMA_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, TOSHIMA_ADAPTER, BYTES, TOSHIMA_FIXTURE_RELEASE);
  assert.equal(await recordReviewedAnchors(db, TOSHIMA_ADAPTER, TOSHIMA_FIXTURE_SHA256, NOW), 4);
  assert.equal((await resolveFirstRelease(db, TOSHIMA_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("T") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  return spotsOf(db);
}

test("the pinned fact sheet is the reviewed one and every anchor is the pinned ABR point of the row's own address", () => {
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), TOSHIMA_FIXTURE_SHA256);
  const { rows } = TOSHIMA_ADAPTER.parse(BYTES);
  assert.equal(rows.length, 4);
  const anchors = TOSHIMA_ADAPTER.reviewedAnchors!(TOSHIMA_FIXTURE_SHA256);
  assert.equal(anchors.length, 4);
  for (const [i, a] of anchors.entries()) {
    const stated = TOSHIMA_ADAPTER.areaPoint!(rows[i])!;
    assert.deepEqual([a.areaName, a.latitude, a.longitude, a.areaScope, a.anchorBasis],
      [stated.areaName, stated.latitude, stated.longitude, stated.scope, stated.basis]);
    assert.deepEqual([a.areaKind, a.originKind, a.anchorBasis!.basis], ["facility", "publisherFacilityPoint", "officialAddressGeocode"]);
    // The gate input is the page's lot completed only with the ward's own name; only accepted ABR levels are anchors.
    assert.ok(a.anchorBasis!.reference.startsWith(`abr-geocoder 2.3.1 ${ADDRESS_ANCHOR_DATASET_RELEASE} residential_detail 入力=東京都豊島区${a.areaName} 出力=`), a.anchorId);
  }
  // Same-anchor rule: one spot per address point, so no two rows share a point.
  assert.equal(new Set(anchors.map((a) => `${a.latitude},${a.longitude}`)).size, 4);
  assert.doesNotThrow(() => assertRightsBasis(TOSHIMA_ADAPTER.registry));
});

test("a changed, extra or missing row is refused", () => {
  const text = new TextDecoder().decode(BYTES);
  const changed = text.replace("西池袋3丁目29番7号,facility", "西池袋3丁目29番8号,facility");
  assert.notEqual(changed, text);
  assert.throws(() => TOSHIMA_ADAPTER.parse(new TextEncoder().encode(changed)), /not a reviewed fact row/);
  const lines = text.trimEnd().split("\n");
  assert.throws(() => TOSHIMA_ADAPTER.parse(new TextEncoder().encode(lines.slice(0, -1).join("\n") + "\n")), /unexpected fact sheet/);
  assert.throws(() => TOSHIMA_ADAPTER.parse(new TextEncoder().encode([...lines, lines[1]].join("\n") + "\n")), /unexpected fact sheet/);
});

test("4 places publish as official, facility-level areaApproximate public places with only the page's stated hours", async () => {
  const spots = await published();
  assert.equal(spots.length, 4);
  for (const s of spots) {
    assert.deepEqual(s.sourceIds, [TOSHIMA_SOURCE_ID]);
    assert.equal(s.verification.locationPrecision, "areaApproximate", "an address point is never the smoking room's own point");
    assert.deepEqual([s.verification.existence, s.verification.locationArea?.kind, s.verification.locationArea?.scope], ["official", "facility", "facility"]);
    assert.equal(s.lastVerifiedAt, "2026-10-19", "checkedAt of the ward's current page (D-C), not a site visit");
    assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType],
      ["unknown", "unknown", "unknown", "unknown", "public"]);
    // Closures and per-floor ranges are prose on the page: hours are never parsed, so openNow is never asserted from them.
    assert.equal(s.openingHours.status, "unparsed");
  }
  const byName = new Map(spots.map((s) => [s.name, s]));
  // Two rooms the ward lists at one address share its single point: one spot, not two stacked pins.
  // Only the 区営 place is hosted by the ward; the 助成金活用 ones are privately run.
  assert.deepEqual(spots.filter((s) => s.hostType === "municipality").map((s) => s.name).sort(),
    ["池袋駅西口東京芸術劇場前喫煙所"]);
  assert.ok(spots.every((s) => s.hostType === "municipality" || s.hostType === "unknown"));
  // Frontages (「…番先」) and the suspended place are never published.
  for (const excluded of ["池袋駅東口喫煙所", "池袋駅北口喫煙所", "サンカクスクエア喫煙所"]) {
    assert.ok(![...byName.keys()].some((n) => n.startsWith(excluded)), excluded);
  }
});

test("current operation (D-C): the whole scoped list is re-checked; a suspension or loss needs re-review", async () => {
  const target = repositoryReviewedHealthTargets().find((t) => t.adapter.registry.sourceId === TOSHIMA_SOURCE_ID)!;
  assert.ok(target.pageFact);
  assert.equal(target.url, TOSHIMA_FIXTURE_RELEASE.sourceUrl);
  const markers = target.pageFact.scope.kind === "htmlText" ? target.pageFact.scope.requiredMarkers ?? [] : [];
  assert.equal(markers.length, 4);
  const html = (note: string) => `<html><body>区指定喫煙所設置場所 ${markers.join(" ")} ${note} お問い合わせ</body></html>`;
  const listed = html("");
  const scoped = extractRightsScope(listed, target.pageFact.scope);
  assert.ok(scoped.ok);
  const reviewed: HealthTarget = { ...target, pageFact: { ...target.pageFact, reviewedFingerprint: await rightsFingerprint(scoped.text) } };
  const fetchHtml = (body: string) => ({ fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }) });
  assert.equal((await checkSourceHealth(reviewed, fetchHtml(listed))).status, "healthy");
  assert.equal((await checkSourceHealth(reviewed, fetchHtml(html("当面の間休止")))).status, "contentChanged");
  assert.equal((await checkSourceHealth(reviewed, fetchHtml("<html><body>ページが見つかりません</body></html>"))).status, "schemaChanged");
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), TOSHIMA_FIXTURE_SHA256, "health never edits the reviewed fact sheet");
});
