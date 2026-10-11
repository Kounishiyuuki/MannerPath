// ADR-0018: location precision v2 (facility scope, cross-publication reference anchors) and factReference sources,
// through the first real page-fact source (小松空港). One facility-level spot, never exact, never four stacked pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { sha256Hex } from "../src/db.ts";
import { recordAreaAnchor, recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import {
  KOMATSU_AIRPORT_ADAPTER, KOMATSU_AIRPORT_FIXTURE_RELEASE, KOMATSU_AIRPORT_FIXTURE_SHA256, KOMATSU_AIRPORT_SOURCE_ID,
} from "../src/pipeline/komatsu-airport-adapter.ts";
import { assertRightsBasis, ensureReviewedSource, type ReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { checkSourceHealth, type HealthTarget } from "../src/source-health/check.ts";
import { extractRightsScope, rightsFingerprint } from "../src/source-health/rights.ts";
import { TileBodyV1, type TileSpotV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { productionHealthTargets } from "../scripts/source-health.ts";
import { areaPipeline } from "./support/area.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-10-12T00:00:00Z";
const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/komatsu-airport-smoking-places/komatsu-airport-page-facts.csv", import.meta.url)));
const spotsOf = (db: SqliteD1) => v1TileRows(db).flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);

async function pipeline(opts: { anchors?: boolean } = {}) {
  const db = new SqliteD1();
  await ensureReviewedSource(db, KOMATSU_AIRPORT_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, KOMATSU_AIRPORT_ADAPTER, BYTES, KOMATSU_AIRPORT_FIXTURE_RELEASE);
  if (opts.anchors !== false) assert.equal(await recordReviewedAnchors(db, KOMATSU_AIRPORT_ADAPTER, KOMATSU_AIRPORT_FIXTURE_SHA256, NOW), 1);
  const resolve = () => resolveFirstRelease(db, KOMATSU_AIRPORT_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("K") });
  return { db, releaseId, resolve };
}

test("the pinned fact sheet is the reviewed one", () => {
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), KOMATSU_AIRPORT_FIXTURE_SHA256);
  const { rows } = KOMATSU_AIRPORT_ADAPTER.parse(BYTES);
  assert.equal(rows.length, 1);
  // The anchor the adapter registers is exactly the point and scope the sheet's record states.
  const [anchor] = KOMATSU_AIRPORT_ADAPTER.reviewedAnchors!(KOMATSU_AIRPORT_FIXTURE_SHA256);
  const stated = KOMATSU_AIRPORT_ADAPTER.areaPoint!(rows[0])!;
  assert.deepEqual([anchor.areaName, anchor.latitude, anchor.longitude, anchor.areaScope, anchor.anchorBasis],
    [stated.areaName, stated.latitude, stated.longitude, stated.scope, stated.basis]);
  assert.equal(anchor.originKind, "publisherFacilityPoint");
  assert.match(anchor.anchorBasis!.reference, /^国土数値情報 空港データ\(C28\)/);
});

test("four official zones on one facility anchor publish as ONE facility-level areaApproximate spot", async () => {
  const { db, resolve } = await pipeline();
  assert.equal((await resolve()).status, "resolved");
  await publishTiles(db, { now: NOW });
  const spots = spotsOf(db);
  assert.equal(spots.length, 1, "same-anchor rule: no stacked pins");
  const s = spots[0] as TileSpotV1;
  assert.equal(s.name, "小松空港 喫煙場所（ターミナル内外4か所・一部は保安検査後）");
  assert.deepEqual([s.latitude, s.longitude], [36.401889, 136.413528]);
  assert.deepEqual(s.verification, {
    version: "spot-verification.v1", existence: "operator", locationPrecision: "areaApproximate", confirmations: null,
    lastReviewedMonth: "2026-10", locationArea: { name: "小松空港 旅客ターミナル", kind: "airport", scope: "facility" },
  });
  assert.equal(s.evidenceQuality, "operatorListing");
  assert.equal(s.lastVerifiedAt, "2026-10-11", "checkedAt of the publisher's current page (D-C), not a site visit");
  // Unknown stays unknown: no hours (facility hours never transferred), no tobacco support, mixed zones not typed.
  // Access is unknown: two of the four zones are after security, so the facility spot is not `public` as a whole.
  assert.deepEqual(s.openingHours, { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" });
  assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType, s.accessDetail, s.hostType],
    ["unknown", "unknown", "unknown", "unknown", "unknown", null, "airport"]);
  assert.match(s.name, /一部は保安検査後/, "the mixed access stays visible in the name");
  assert.notEqual(s.verification.locationPrecision, "publisherPoint", "a facility anchor is never exact");
  assert.deepEqual(s.sourceIds, [KOMATSU_AIRPORT_SOURCE_ID]);
  // Spot detail and the quality report read the same location state.
  const detail = await (await app.request(`/v1/spots/${s.id}`, {}, { DB: db })).json() as { spot: TileSpotV1 };
  assert.deepEqual(detail.spot.verification, s.verification);
  const quality = await analyzeCorpus(db, { now: NOW });
  for (const id of ["area-anchor-never-exact", "published-sources-carry-license-and-attribution", "registry-row-matches-reviewed-entry"]) {
    assert.equal(quality.checks.find((c) => c.id === id)?.status, "pass", id);
  }
});

test("without its reviewed anchor the spot is never resolved (nothing honest to draw)", async () => {
  const { db, resolve } = await pipeline({ anchors: false });
  await assert.rejects(resolve(), /anchor/);
  assert.equal((db.raw.prepare("SELECT count(*) n FROM spots").get() as { n: number }).n, 0);
});

test("the database binds scope and basis to what the record states; a typed or mismatched value is refused", async () => {
  const { db } = await pipeline({ anchors: false });
  const [anchor] = KOMATSU_AIRPORT_ADAPTER.reviewedAnchors!(KOMATSU_AIRPORT_FIXTURE_SHA256);
  // The adapter-level check: a scope the record does not state.
  await assert.rejects(recordAreaAnchor(db, KOMATSU_AIRPORT_ADAPTER, { ...anchor, areaScope: "namedZone", originKind: "publisherAreaPoint" }, NOW), /does not state/);
  await assert.rejects(recordAreaAnchor(db, KOMATSU_AIRPORT_ADAPTER, { ...anchor, areaScope: "namedZone" }, NOW), /scopeDoesNotMatchOrigin/);
  await assert.rejects(recordAreaAnchor(db, KOMATSU_AIRPORT_ADAPTER, { ...anchor, anchorBasis: { basis: "referenceDatasetPoint", reference: "Google Maps pin" } }, NOW), /forbiddenOrigin/);
  // The schema-level check (direct SQL): record the genuine anchor, then try to insert a copy claiming another scope/basis.
  await recordAreaAnchor(db, KOMATSU_AIRPORT_ADAPTER, anchor, NOW);
  const row = db.raw.prepare("SELECT * FROM area_location_anchors").get() as Record<string, unknown>;
  const insert = (changes: Record<string, unknown>) => {
    const r = { ...row, anchor_id: "aa_tamper", evidence_sha256: "f".repeat(64), ...changes };
    const cols = Object.keys(r);
    db.raw.prepare(`INSERT INTO area_location_anchors (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => r[c] as string));
  };
  assert.throws(() => insert({ area_scope: "namedZone", origin_kind: "publisherAreaPoint" }), /exactly what the cited record states/);
  assert.throws(() => insert({ anchor_basis: "officialAddressGeocode" }), /exactly what the cited record states/);
  assert.throws(() => insert({ anchor_reference: null }), /stated together/);
  assert.throws(() => insert({ anchor_reference: "OpenStreetMap node 1" }), /never anchor references|exactly what/);
});

test("ADR-0017 v1 anchors are unchanged: no scope on the wire, so older clients and bytes stay identical", async () => {
  const { db } = await areaPipeline();
  await publishTiles(db, { now: NOW });
  const anchored = spotsOf(db).filter((s) => s.verification.locationPrecision === "areaApproximate");
  assert.ok(anchored.length > 0);
  for (const s of anchored) assert.deepEqual(Object.keys(s.verification.locationArea!), ["name", "kind"]);
  assert.deepEqual({ ...(db.raw.prepare("SELECT area_scope, anchor_basis, anchor_reference FROM area_location_anchors").get() as object) },
    { area_scope: null, anchor_basis: null, anchor_reference: null });
});

test("rights: factReference is typed, recorded and validated; prohibited or licence-implying entries fail loudly", () => {
  const r = KOMATSU_AIRPORT_ADAPTER.registry;
  assert.equal(r.rightsBasis?.kind, "factReference");
  assert.equal(r.rightsBasis?.prohibitsInformationUse, false);
  assert.deepEqual([r.licenseName, r.licenseUrl, r.kind], [null, null, "operator"]);
  assert.doesNotThrow(() => assertRightsBasis(r));
  const bad = (change: Partial<ReviewedSource> | Record<string, unknown>) => () => assertRightsBasis({ ...r, ...change } as ReviewedSource);
  assert.throws(bad({ licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" }), /no licence/);
  assert.throws(bad({ attributionText: "小松空港" }), /attribution/);
  assert.throws(bad({ kind: "userReport" }), /first-party/);
  assert.throws(bad({ rightsBasis: { ...r.rightsBasis!, prohibitsInformationUse: true } }), /unknown rights basis/);
  assert.throws(bad({ rightsBasis: { ...r.rightsBasis!, termsUrls: [] } }), /HTTPS/);
});

test("current operation (D-C): the page's scoped fact text is re-checked; change or loss needs re-review", async () => {
  const target = productionHealthTargets().find((t) => t.adapter.registry.sourceId === KOMATSU_AIRPORT_SOURCE_ID)!;
  assert.ok(target.pageFact);
  assert.deepEqual(target.mimeTypes, ["text/html"]);
  const html = (answer: string) => `<html><body><img alt=""> 喫煙場所はどこですか。 ${answer} 関連リンク</body></html>`;
  const listed = html("国際線２F出発ロビーに1ヶ所、屋外にも1ヶ所（バス乗り場付近）");
  const scoped = extractRightsScope(listed, target.pageFact!.scope);
  assert.ok(scoped.ok);
  const reviewed: HealthTarget = { ...target, pageFact: { ...target.pageFact!, reviewedFingerprint: await rightsFingerprint(scoped.text) } };
  const fetchHtml = (body: string) => ({ fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }) });
  assert.equal((await checkSourceHealth(reviewed, fetchHtml(listed))).status, "healthy");
  const changed = await checkSourceHealth(reviewed, fetchHtml(html("国際線２F出発ロビーは閉鎖しました（バス乗り場付近）")));
  assert.equal(changed.status, "contentChanged");
  assert.equal(changed.signals.contentChanged, true);
  const gone = await checkSourceHealth(reviewed, fetchHtml("<html><body>ページが見つかりません</body></html>"));
  assert.equal(gone.status, "schemaChanged", "the listed facts are gone: blocking until re-reviewed");
  assert.equal(await sha256Hex(BYTES), KOMATSU_AIRPORT_FIXTURE_SHA256, "health never edits the reviewed fact sheet");
});
