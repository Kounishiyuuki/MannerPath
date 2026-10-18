// ADR-0018 municipal page-fact source (中央区 区営指定喫煙場所): existence and hours from the ward's current list,
// each pin the park's point in the ward's CC BY park list. One spot per park, never exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import {
  CHUO_PARK_ADAPTER, CHUO_PARK_FIXTURE_RELEASE, CHUO_PARK_FIXTURE_SHA256, CHUO_PARK_SOURCE_ID,
} from "../src/pipeline/chuo-park-adapter.ts";
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

const NOW = "2026-10-18T12:00:00Z";
const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/chuo-park-smoking-places/chuo-park-page-facts.csv", import.meta.url)));
const spotsOf = (db: SqliteD1) => v1TileRows(db).flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);

async function published() {
  const db = new SqliteD1();
  await ensureReviewedSource(db, CHUO_PARK_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, CHUO_PARK_ADAPTER, BYTES, CHUO_PARK_FIXTURE_RELEASE);
  assert.equal(await recordReviewedAnchors(db, CHUO_PARK_ADAPTER, CHUO_PARK_FIXTURE_SHA256, NOW), 14);
  assert.equal((await resolveFirstRelease(db, CHUO_PARK_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("C") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  return spotsOf(db);
}

test("the pinned fact sheet is the reviewed one and every anchor is the park point its row states", () => {
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), CHUO_PARK_FIXTURE_SHA256);
  const { rows } = CHUO_PARK_ADAPTER.parse(BYTES);
  assert.equal(rows.length, 14);
  const anchors = CHUO_PARK_ADAPTER.reviewedAnchors!(CHUO_PARK_FIXTURE_SHA256);
  assert.equal(anchors.length, 14);
  for (const [i, a] of anchors.entries()) {
    const stated = CHUO_PARK_ADAPTER.areaPoint!(rows[i])!;
    assert.deepEqual([a.areaName, a.latitude, a.longitude, a.areaScope, a.anchorBasis],
      [stated.areaName, stated.latitude, stated.longitude, stated.scope, stated.basis]);
    assert.deepEqual([a.areaKind, a.originKind], ["park", "publisherFacilityPoint"]);
    assert.match(a.anchorBasis!.reference, new RegExp(`^中央区オープンデータ 区内の公園一覧 koenichiran\\.csv sha256:[0-9a-f]{64} 名称=${a.areaName}$`));
  }
  // Same-anchor rule: one spot per park point, so no two rows share a point.
  assert.equal(new Set(anchors.map((a) => `${a.latitude},${a.longitude}`)).size, 14);
  assert.doesNotThrow(() => assertRightsBasis(CHUO_PARK_ADAPTER.registry));
});

test("a changed, extra or missing row is refused", () => {
  const text = new TextDecoder().decode(BYTES);
  const changed = text.replace("0:00-24:00,,unknown,public,unknown,municipality,https", "7:00-24:00,,unknown,public,unknown,municipality,https");
  assert.notEqual(changed, text);
  assert.throws(() => CHUO_PARK_ADAPTER.parse(new TextEncoder().encode(changed)), /not a reviewed fact row/);
  const lines = text.trimEnd().split("\n");
  assert.throws(() => CHUO_PARK_ADAPTER.parse(new TextEncoder().encode(lines.slice(0, -1).join("\n") + "\n")), /unexpected fact sheet/);
  assert.throws(() => CHUO_PARK_ADAPTER.parse(new TextEncoder().encode([...lines, lines[1]].join("\n") + "\n")), /unexpected fact sheet/);
});

test("14 parks publish as official, facility-level areaApproximate spots with only the page's stated hours", async () => {
  const spots = await published();
  assert.equal(spots.length, 14);
  for (const s of spots) {
    assert.deepEqual(s.sourceIds, [CHUO_PARK_SOURCE_ID]);
    assert.equal(s.verification.locationPrecision, "areaApproximate", "a park point is never the smoking place's own point");
    assert.deepEqual([s.verification.existence, s.verification.locationArea?.kind, s.verification.locationArea?.scope], ["official", "park", "facility"]);
    assert.equal(s.lastVerifiedAt, "2026-10-18", "checkedAt of the ward's current page (D-C), not a site visit");
    assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType, s.hostType],
      ["unknown", "unknown", "unknown", "unknown", "public", "municipality"]);
  }
  const byName = new Map(spots.map((s) => [s.name, s]));
  assert.deepEqual(byName.get("楓川久安橋公園")!.openingHours, { status: "parsed", raw: "0:00-24:00", parsed: { v: 1, kind: "allDay" }, timeZone: "Asia/Tokyo" });
  // The cleaning qualifier and per-zone differences keep hours unparsed, so openNow is never asserted from them.
  assert.deepEqual(byName.get("数寄屋橋公園")!.openingHours, { status: "unparsed", raw: "7:00-22:30\n清掃作業中は利用不可", parsed: null, timeZone: "Asia/Tokyo" });
  assert.equal(byName.get("石川島公園（中央大橋側・相生橋側の2か所）")!.openingHours.status, "unparsed");
  assert.equal(spots.filter((s) => s.openingHours.status === "parsed").length, 7);
  // Two places listed in one park share its single point: one spot, not two stacked pins.
  assert.ok(byName.has("築地川千代橋公園（東側・西側の2か所）"));
  for (const excluded of ["築地川祝橋公園", "城辺橋際緑地帯", "中央区役所前", "亀島川左岸緑地帯", "箱崎河岸緑道"]) {
    assert.ok(![...byName.keys()].some((n) => n.startsWith(excluded)), excluded);
  }
});

test("current operation (D-C): the scoped ward-run section is re-checked; a suspension or loss needs re-review", async () => {
  const target = repositoryReviewedHealthTargets().find((t) => t.adapter.registry.sourceId === CHUO_PARK_SOURCE_ID)!;
  assert.ok(target.pageFact);
  assert.equal(target.url, CHUO_PARK_FIXTURE_RELEASE.sourceUrl);
  const markers = target.pageFact.scope.kind === "htmlText" ? target.pageFact.scope.requiredMarkers ?? [] : [];
  const html = (note: string) => `<html><body>区営指定喫煙場所 1.楓川久安橋公園 ${markers.join(" ")} ${note} 民間指定喫煙場所 1.八重洲</body></html>`;
  const listed = html("");
  const scoped = extractRightsScope(listed, target.pageFact.scope);
  assert.ok(scoped.ok);
  const reviewed: HealthTarget = { ...target, pageFact: { ...target.pageFact, reviewedFingerprint: await rightsFingerprint(scoped.text) } };
  const fetchHtml = (body: string) => ({ fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }) });
  assert.equal((await checkSourceHealth(reviewed, fetchHtml(listed))).status, "healthy");
  assert.equal((await checkSourceHealth(reviewed, fetchHtml(html("備考 当面の間、喫煙場所を一時休止します。")))).status, "contentChanged");
  assert.equal((await checkSourceHealth(reviewed, fetchHtml("<html><body>ページが見つかりません</body></html>"))).status, "schemaChanged");
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), CHUO_PARK_FIXTURE_SHA256, "health never edits the reviewed fact sheet");
});
