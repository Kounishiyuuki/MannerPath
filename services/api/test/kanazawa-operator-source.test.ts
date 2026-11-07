import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { KASSEN_NOMURA_ADAPTER, KASSEN_NOMURA_FIXTURE_RELEASE, KASSEN_NOMURA_FIXTURE_SHA256 } from "../src/pipeline/kassen-nomura-adapter.ts";
import { KANAZAWA_ARTVILLAGE_ADAPTER, KANAZAWA_ARTVILLAGE_FIXTURE_RELEASE, KANAZAWA_ARTVILLAGE_FIXTURE_SHA256 } from "../src/pipeline/kanazawa-artvillage-adapter.ts";
import { assertRightsBasis, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { checkSourceHealth } from "../src/source-health/check.ts";
import { extractRightsScope, rightsFingerprint } from "../src/source-health/rights.ts";
import { TileBodyV1, type TileSpotV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { productionHealthTargets, repositoryReviewedHealthTargets, sourceReviews } from "../scripts/source-health.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-11-07T14:00:00Z";
const CASES = [
  { adapter: KASSEN_NOMURA_ADAPTER, release: KASSEN_NOMURA_FIXTURE_RELEASE, hash: KASSEN_NOMURA_FIXTURE_SHA256,
    slug: "kassen-nomura", area: "割鮮のむら", point: [36.539788283, 136.649160875], host: "restaurantOrCafe", name: "割鮮のむら 店外喫煙スペース" },
  { adapter: KANAZAWA_ARTVILLAGE_ADAPTER, release: KANAZAWA_ARTVILLAGE_FIXTURE_RELEASE, hash: KANAZAWA_ARTVILLAGE_FIXTURE_SHA256,
    slug: "kanazawa-artvillage", area: "金沢市民芸術村", point: [36.569565872, 136.641441103], host: "other", name: "金沢市民芸術村 大和町広場 園路喫煙場所" },
];
for (const c of CASES) {
  const bytes = new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${c.slug}-smoking-places/${c.slug}-page-facts.csv`, import.meta.url)));
  async function pipeline(anchors = true) {
    const db = new SqliteD1();
    await ensureReviewedSource(db, c.adapter.registry.sourceId, NOW);
    const { releaseId } = await ingestRelease(db, c.adapter, bytes, c.release);
    if (anchors) assert.equal(await recordReviewedAnchors(db, c.adapter, c.hash, NOW), 1);
    return { db, resolve: () => resolveFirstRelease(db, c.adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds("N") }) };
  }
  test(`${c.slug}: pinned normalized facts reject coordinate, date, address and basis tampering`, () => {
    assert.equal(createHash("sha256").update(bytes).digest("hex"), c.hash);
    assert.equal(c.adapter.parse(bytes).rows.length, 1);
    const text = new TextDecoder().decode(bytes);
    for (const [before, after] of [[String(c.point[0]), "35.0"], ["2026-11-07", "2026-11-08"], ["officialAddressGeocode", "referenceDatasetPoint"], ["石川県金沢市", "東京都中央区"]]) {
      assert.throws(() => c.adapter.parse(new TextEncoder().encode(text.replace(before, after))), /reviewed fact row/);
    }
    assert.doesNotThrow(() => assertRightsBasis(c.adapter.registry));
    assert.equal(c.adapter.registry.rightsBasis?.kind, "factReference");
    assert.deepEqual([c.adapter.registry.licenseName, c.adapter.registry.licenseUrl], [null, null]);
    assert.throws(() => c.adapter.assertResolvable!({ contentSha256: "f".repeat(64), sourceUrl: c.release.sourceUrl, observedOn: c.release.observedOn }, []), /reviewed fact sheet/);
  });
  test(`${c.slug}: tiles/detail carry ONE approximate facility spot, unknown support/access/hours`, async () => {
    const { db, resolve } = await pipeline();
    assert.equal((await resolve()).status, "resolved");
    await publishTiles(db, { now: NOW });
    const spots = v1TileRows(db).flatMap(t => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
    assert.equal(spots.length, 1);
    const s = spots[0] as TileSpotV1;
    assert.equal(s.name, c.name);
    assert.deepEqual([s.latitude, s.longitude], c.point);
    assert.equal(s.verification.locationPrecision, "areaApproximate");
    assert.deepEqual(s.verification.locationArea, { name: c.area, kind: "facility", scope: "facility" });
    assert.equal(s.lastVerifiedAt, "2026-11-07", "official page check, not a site visit");
    assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType, s.accessDetail, s.hostType],
      ["unknown", "unknown", "unknown", "unknown", "unknown", null, c.host]);
    assert.deepEqual(s.openingHours, { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" });
    assert.deepEqual(s.sourceIds, [c.adapter.registry.sourceId]);
    const detail = await (await app.request(`/v1/spots/${s.id}`, {}, { DB: db })).json() as { spot: TileSpotV1 };
    assert.deepEqual(detail.spot.verification, s.verification);
    const quality = await analyzeCorpus(db, { now: NOW });
    for (const id of ["area-anchor-never-exact", "published-sources-carry-license-and-attribution", "registry-row-matches-reviewed-entry"]) {
      assert.equal(quality.checks.find(check => check.id === id)?.status, "pass", id);
    }
  });
  test(`${c.slug}: existence cannot resolve without independently reviewed anchor`, async () => {
    const { db, resolve } = await pipeline(false);
    await assert.rejects(resolve(), /anchor/);
    assert.equal((db.raw.prepare("SELECT count(*) n FROM spots").get() as { n: number }).n, 0);
  });
  test(`${c.slug}: page drift requires review; production monitoring inventory stays separate`, async () => {
    const target = repositoryReviewedHealthTargets().find(t => t.adapter.registry.sourceId === c.adapter.registry.sourceId)!;
    assert.ok(target.pageFact);
    assert.equal(productionHealthTargets().some(t => t.adapter.registry.sourceId === c.adapter.registry.sourceId), false);
    const scope = target.pageFact!.scope;
    assert.equal(scope.kind, "htmlText");
    if (scope.kind !== "htmlText") return;
    const html = (answer: string) => `<html><body>${scope.ranges.map(range => `${range.start} ${answer} ${range.end}`).join(" ")}</body></html>`;
    const body = html(scope.requiredMarkers.join(" "));
    const scoped = extractRightsScope(body, scope);
    assert.ok(scoped.ok);
    const reviewed = { ...target, pageFact: { ...target.pageFact!, reviewedFingerprint: await rightsFingerprint(scoped.text) } };
    const response = (text: string) => ({ fetch: async () => new Response(text, { headers: { "content-type": "text/html" } }) });
    assert.equal((await checkSourceHealth(reviewed, response(body))).status, "healthy");
    assert.equal((await checkSourceHealth(reviewed, response(html(scope.requiredMarkers.join(" ") + " 閉鎖")))).status, "contentChanged");
    assert.equal((await checkSourceHealth(reviewed, response("<html>削除</html>"))).status, "schemaChanged");
    const address = scope.requiredMarkers.find(marker => marker.startsWith("石川県金沢市"))!;
    assert.ok(address, "the current official facility address is monitored separately from the smoking fact");
    assert.equal((await checkSourceHealth(reviewed, response(body.replaceAll(address, "移転先未確認")))).status, "schemaChanged");
    const review = sourceReviews().find(r => r.sourceId === c.adapter.registry.sourceId)!;
    assert.equal(review.sourceObservedAt, null);
    assert.equal(review.rights.length, 1);
  });
}
