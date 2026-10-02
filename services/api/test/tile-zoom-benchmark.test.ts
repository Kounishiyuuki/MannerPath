// ADR-0015 benchmark fixture: the #156 synthetic corpus, regrouped at z14/z15/z16 without a database. It pins the
// finding the decision rests on — zoom alone never brings the dense areas under the budget, parts always do —
// and keeps the 50k profile inside every part bound as a regression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import type { TileSourceV1, TileSpotV1 } from "../src/tiles/dto.ts";
import { splitTileParts, TILE_PART_POLICY } from "../src/tiles/parts.ts";
import { formatTileId, tileForCoordinate, DATA_TILE_ZOOM } from "../src/geo/tile.ts";
import { DENSE_AREAS, syntheticSpots, type Profile } from "../scripts/scale/corpus.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";
import { zoomComparison } from "../scripts/scale/zoom.ts";

const SOURCE: TileSourceV1 = { id: "community-reports", displayName: "Community reports", licenseName: "TEST ONLY",
  licenseUrl: "https://example.invalid/terms", attributionText: "TEST ONLY synthetic community attribution" };
const sources = new Map([[SOURCE.id, SOURCE]]);

/** The spot DTO publishTiles emits for a community spot, at its synthetic coordinate. */
function dtos(profile: Profile): TileSpotV1[] {
  return [...syntheticSpots(profile)].map((s): TileSpotV1 => ({
    id: s.spotId, name: null, latitude: s.latitude, longitude: s.longitude,
    spotType: "ashtray", accessType: "unknown", environment: "unknown", supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" }, lifecycle: "active",
    evidenceQuality: "communityReported", evidenceQualityVersion: "evidence-quality.v1", lastVerifiedAt: null,
    sourceIds: [SOURCE.id], spotSubtype: null, hostType: "unknown", accessDetail: null,
    verification: { version: "spot-verification.v1", existence: "communityReported", locationPrecision: "communityPinned", confirmations: 1, lastReviewedMonth: "2026-10" },
  }));
}
const probes = DENSE_AREAS.map((id) => SEED_AREAS.find((s) => s.id === id)!);

test("z14/z15/z16 on the medium profile: zoom never clears the dense areas; parts clear every zoom", async () => {
  const spots = dtos("medium");
  const results = [];
  for (const zoom of [14, 15, 16]) results.push(await zoomComparison(spots, sources, zoom, probes, "2026-10-01T03:00:00Z"));
  for (const r of results) {
    assert.ok(r.spotsPerTile.max > TILE_PART_POLICY.maxSpots, `z${r.zoom}: the densest tile still holds ${r.spotsPerTile.max} spots`);
    assert.ok(r.tilesOver250Spots > 0);
    assert.equal(r.after.partsOverBudget, 0, `z${r.zoom}`);
    assert.ok(r.after.partSpots.max <= TILE_PART_POLICY.maxSpots && r.after.partRawBytes.max <= TILE_PART_POLICY.maxRawBytes);
    assert.ok(r.after.d1RowMaxBytes < r.before.d1RowMaxBytes, `z${r.zoom}: the largest row shrinks`);
    assert.equal(r.after.viewport.probes.length, 6);
  }
  // A finer zoom multiplies the tiles to publish and store.
  assert.ok(results[0].tiles < results[1].tiles && results[1].tiles < results[2].tiles);
});

test("50k regression at DATA_TILE_ZOOM: every part within tile-parts.v1 including real gzip, deterministic", async () => {
  const spots = dtos("large");
  const byTile = new Map<string, TileSpotV1[]>();
  for (const s of spots) {
    const id = formatTileId(tileForCoordinate(s.latitude, s.longitude, DATA_TILE_ZOOM));
    byTile.set(id, [...(byTile.get(id) ?? []), s]);
  }
  let parts = 0, maxParts = 0, maxGzip = 0;
  const hashes: string[] = [];
  for (const [tileId, members] of [...byTile].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const built = await splitTileParts(tileId, members.sort((a, b) => (a.id < b.id ? -1 : 1)), sources);
    parts += built.length; maxParts = Math.max(maxParts, built.length);
    for (const p of built) {
      assert.ok(p.spotCount <= TILE_PART_POLICY.maxSpots && p.rawBytes <= TILE_PART_POLICY.maxRawBytes);
      maxGzip = Math.max(maxGzip, gzipSync(p.bodyJson).length);
      hashes.push(p.sha256);
    }
  }
  assert.ok(maxGzip <= TILE_PART_POLICY.maxGzipBytes, `max part gzip ${maxGzip}`);
  assert.ok(maxParts <= TILE_PART_POLICY.maxParts);
  // The raw corpus's densest tile; #156 published 2,223 of these once its held scenarios were withheld.
  assert.equal(Math.max(...[...byTile.values()].map((t) => t.length)), 2224, "the #156 densest tile is reproduced");
  assert.ok(maxParts > 9, `2,224 spots of ~690 bytes need more than 9 parts under the byte bound (${maxParts})`);
  assert.ok(parts > byTile.size);
  // Same corpus, same parts: re-split one dense tile and compare hashes.
  const [denseId, dense] = [...byTile].sort((a, b) => b[1].length - a[1].length)[0];
  const again = await splitTileParts(denseId, dense, sources);
  assert.deepEqual(again.map((p) => p.sha256), (await splitTileParts(denseId, dense, sources)).map((p) => p.sha256));
});
