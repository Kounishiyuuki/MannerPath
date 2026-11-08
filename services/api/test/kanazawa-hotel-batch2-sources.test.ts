// Kanazawa hotel batch 2 through the shared reviewed-facility adapter: pinned facts, the address gate,
// ingest → anchor → resolve → tile/detail, and their place in the registered source list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { abrJsonRun, evaluateAddressAnchor } from "../src/pipeline/address-anchor.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { DORMY_INN_KANAZAWA_ADAPTER, DORMY_INN_KANAZAWA_FIXTURE_RELEASE, DORMY_INN_KANAZAWA_FIXTURE_SHA256 } from "../src/pipeline/dormy-inn-kanazawa-adapter.ts";
import { ingestRelease, type ReleaseMetadata } from "../src/pipeline/ingest.ts";
import { KKR_KANAZAWA_ADAPTER } from "../src/pipeline/kkr-kanazawa-adapter.ts";
import { assertRightsBasis, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { SMILE_HOTEL_KANAZAWA_NISHIGUCHI_ADAPTER, SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_RELEASE, SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_SHA256 } from "../src/pipeline/smile-hotel-kanazawa-nishiguchi-adapter.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TileBodyV1, type TileSpotV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-11-08T11:30:00Z"; // After the actual fetches (11:20Z), not a simulated future date.
const RELEASE_ID = "abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d";

interface Case { slug: string; adapter: SourceAdapter; release: ReleaseMetadata; hash: string; name: string; area: string; address: string; point: [number, number] }
const CASES: Case[] = [
  { slug: "dormy-inn-kanazawa", adapter: DORMY_INN_KANAZAWA_ADAPTER, release: DORMY_INN_KANAZAWA_FIXTURE_RELEASE, hash: DORMY_INN_KANAZAWA_FIXTURE_SHA256,
    name: "天然温泉 加賀の湧泉 ドーミーイン金沢 喫煙ブース（1F）", area: "天然温泉 加賀の湧泉 ドーミーイン金沢", address: "石川県金沢市堀川新町2-25", point: [36.579348656, 136.650432875] },
  { slug: "smile-hotel-kanazawa-nishiguchi", adapter: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_ADAPTER, release: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_RELEASE, hash: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_SHA256,
    name: "スマイルホテル金沢西口駅前 喫煙スペース", area: "スマイルホテル金沢西口駅前", address: "石川県金沢市広岡3丁目2番37号", point: [36.580760028, 136.644971769] },
];
const fixture = (slug: string, file: string) => new URL(`../../data-pipeline/fixtures/${slug}-smoking-places/${file}`, import.meta.url);

async function reviewedDb(c: Case) {
  const db = new SqliteD1();
  await ensureReviewedSource(db, c.adapter.registry.sourceId, NOW);
  return db;
}

for (const c of CASES) {
  const bytes = new Uint8Array(readFileSync(fixture(c.slug, `${c.slug}-page-facts.csv`)));

  test(`${c.slug}: pinned normalized facts reject coordinate, date, address and basis tampering`, () => {
    assert.equal(createHash("sha256").update(bytes).digest("hex"), c.hash);
    assert.equal(c.adapter.parse(bytes).rows.length, 1);
    const text = new TextDecoder().decode(bytes);
    for (const [before, after] of [[String(c.point[0]), "35.0"], [c.release.observedOn, "2026-11-09"], ["officialAddressGeocode", "referenceDatasetPoint"], ["石川県金沢市", "東京都中央区"]]) {
      assert.throws(() => c.adapter.parse(new TextEncoder().encode(text.replace(before, after))), /reviewed fact row/);
    }
    assert.doesNotThrow(() => assertRightsBasis(c.adapter.registry));
    assert.equal(c.adapter.registry.rightsBasis?.kind, "factReference");
    assert.equal(c.adapter.registry.rightsBasis?.prohibitsInformationUse, false);
    assert.deepEqual([c.adapter.registry.licenseName, c.adapter.registry.licenseUrl], [null, null]);
    assert.match(c.adapter.registry.attributionText, /アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）/);
    assert.match(c.adapter.registry.attributionText, /喫煙場所そのものの位置ではありません/);
    assert.throws(() => c.adapter.assertResolvable!({ contentSha256: "f".repeat(64), sourceUrl: c.release.sourceUrl, observedOn: c.release.observedOn }, []), /reviewed fact sheet/);
  });

  test(`${c.slug}: the pin is what the unchanged address gate accepts from the recorded geocoder output`, () => {
    const [abr] = JSON.parse(readFileSync(fixture(c.slug, "abrg-output.json"), "utf8")) as unknown[];
    const run = abrJsonRun(abr, "2.3.1", RELEASE_ID);
    const result = evaluateAddressAnchor({ officialAddress: c.address, expectedPrefecture: "石川県", expectedMunicipality: "金沢市", geocode: run });
    assert.equal(result.status, "anchor");
    if (result.status !== "anchor") return;
    assert.equal(result.coordinateLevel, "residential_detail");
    assert.deepEqual([result.latitude, result.longitude], c.point);
    const text = new TextDecoder().decode(bytes);
    assert.ok(text.includes(result.reference), "the fact row carries the gate's own reference");
  });

  test(`${c.slug}: tiles/detail carry ONE approximate facility spot with unknown support, access and hours`, async () => {
    const db = await reviewedDb(c);
    const { releaseId } = await ingestRelease(db, c.adapter, bytes, c.release);
    assert.equal(await recordReviewedAnchors(db, c.adapter, c.hash, NOW), 1);
    assert.equal((await resolveFirstRelease(db, c.adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds("N") })).status, "resolved");
    await publishTiles(db, { now: NOW });
    const spots = v1TileRows(db).flatMap(t => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
    assert.equal(spots.length, 1);
    const s = spots[0] as TileSpotV1;
    assert.equal(s.name, c.name);
    assert.deepEqual([s.latitude, s.longitude], c.point);
    assert.equal(s.verification.locationPrecision, "areaApproximate");
    assert.deepEqual(s.verification.locationArea, { name: c.area, kind: "facility", scope: "facility" });
    assert.equal(s.lastVerifiedAt, c.release.observedOn, "official page check, not a site visit");
    assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType, s.accessDetail, s.hostType],
      ["unknown", "unknown", "unknown", "unknown", "unknown", null, "other"]);
    assert.deepEqual(s.openingHours, { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" });
    const detail = await (await app.request(`/v1/spots/${s.id}`, {}, { DB: db })).json() as { spot: TileSpotV1 };
    assert.deepEqual(detail.spot.verification, s.verification);
  });

  test(`${c.slug}: existence cannot resolve without the reviewed anchor`, async () => {
    const db = await reviewedDb(c);
    const { releaseId } = await ingestRelease(db, c.adapter, bytes, c.release);
    await assert.rejects(resolveFirstRelease(db, c.adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds("N") }), /anchor/);
    assert.equal((db.raw.prepare("SELECT count(*) n FROM spots").get() as { n: number }).n, 0);
  });
}

test("batch-2 pins are distinct facilities: neither shares or stacks on the other or on KKR", () => {
  const metres = (a: readonly number[], b: readonly number[]) => {
    const r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r), y = (b[0] - a[0]) * r;
    return Math.hypot(x, y) * 6_371_000;
  };
  const kkr = KKR_KANAZAWA_ADAPTER.areaPoint!(KKR_KANAZAWA_ADAPTER.parse(new Uint8Array(readFileSync(new URL(
    "../../data-pipeline/fixtures/kkr-kanazawa-smoking-places/kkr-kanazawa-page-facts.csv", import.meta.url)))).rows[0]);
  const points = [...CASES.map(c => c.point), [kkr.latitude, kkr.longitude]];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    assert.ok(metres(points[i], points[j]) > 100, `pins ${i} and ${j} are ${metres(points[i], points[j]).toFixed(0)} m apart`);
  }
});

test("registered once each, right after the first Kanazawa hotel batch", () => {
  const ids = SOURCE_ADAPTERS.map(a => a.registry.sourceId);
  for (const c of CASES) assert.equal(ids.filter(id => id === c.adapter.registry.sourceId).length, 1, c.slug);
  assert.deepEqual(ids.slice(ids.indexOf("hotel-vista-kanazawa-smoking-places") + 1), CASES.map(c => c.adapter.registry.sourceId));
});
