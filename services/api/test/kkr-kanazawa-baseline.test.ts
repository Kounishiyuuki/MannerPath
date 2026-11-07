// Local-only additive publication: KKR may add one facility, never rewrite the historical production corpus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../src/db.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import {
  KKR_KANAZAWA_ADAPTER, KKR_KANAZAWA_SOURCE_ID, KKR_KANAZAWA_FIXTURE_RELEASE, KKR_KANAZAWA_FIXTURE_SHA256,
} from "../src/pipeline/kkr-kanazawa-adapter.ts";
import { KASSEN_NOMURA_ADAPTER, KASSEN_NOMURA_FIXTURE_SHA256 } from "../src/pipeline/kassen-nomura-adapter.ts";
import { KANAZAWA_ARTVILLAGE_ADAPTER, KANAZAWA_ARTVILLAGE_FIXTURE_SHA256 } from "../src/pipeline/kanazawa-artvillage-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importProductionBaselineSources, PRODUCTION_BASELINE_SOURCE_IDS, reviewedFixtureBytes } from "./support/reviewed-fixtures.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const NOW = "2026-11-09T00:00:00Z";
const LATER = "2026-11-09T00:05:00Z";

test("one KKR facility preserves all 515 baseline rows and 513 published DTOs with unchanged 81 tile bytes", async () => {
  const db = new SqliteD1();
  try {
    assert.deepEqual([...PRODUCTION_BASELINE_SOURCE_IDS], [
      "taito-public-smoking-areas", "osaka-designated-smoking-areas", "koto-station-smoking-areas",
      "musashino-public-smoking-areas", "minato-designated-smoking-areas", "kyoto-public-smoking-places",
    ], "reviewed-source registration must not silently expand the historical production selection");
    assert.equal((PRODUCTION_BASELINE_SOURCE_IDS as readonly string[]).includes(KKR_KANAZAWA_SOURCE_ID), false);
    await importProductionBaselineSources(db, NOW);
    await publishTiles(db, { now: NOW });
    const oldRows = db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all();
    assert.equal(oldRows.length, 515, "the six-source raw corpus includes two nonpublished rows");
    const oldIds = new Set(oldRows.map(row => row.spot_id));
    const oldTiles = db.raw.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all();
    const oldParts = db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index").all();
    const oldMembership = db.raw.prepare("SELECT * FROM tile_snapshot_spots ORDER BY tile_id, spot_id").all();
    const oldTileIds = new Set(oldTiles.map(row => row.tile_id));
    assert.equal(oldTiles.length, 81);
    const oldPublished = (await readPublishedTiles(db)).flatMap(tile => tile.spots);
    assert.equal(oldPublished.length, 513);

    const bytes = reviewedFixtureBytes("kkr-kanazawa-smoking-places/kkr-kanazawa-page-facts.csv");
    assert.equal(await sha256Hex(bytes), KKR_KANAZAWA_FIXTURE_SHA256);
    const anchors = KKR_KANAZAWA_ADAPTER.reviewedAnchors!(KKR_KANAZAWA_FIXTURE_SHA256);
    assert.equal(anchors.length, 1, "the 1F and 3F smoking places share one facility representative point");
    const anchor = anchors[0]!;
    for (const spot of oldRows) {
      assert.ok(haversineMeters(anchor, { latitude: Number(spot.latitude), longitude: Number(spot.longitude) }) > 25,
        `KKR must not duplicate baseline place ${spot.spot_id}`);
    }
    for (const existing of [
      ...KASSEN_NOMURA_ADAPTER.reviewedAnchors!(KASSEN_NOMURA_FIXTURE_SHA256),
      ...KANAZAWA_ARTVILLAGE_ADAPTER.reviewedAnchors!(KANAZAWA_ARTVILLAGE_FIXTURE_SHA256),
    ]) {
      assert.ok(haversineMeters(anchor, existing) > 25, `KKR must not duplicate previously reviewed ${existing.areaName}`);
    }

    await ensureReviewedSource(db, KKR_KANAZAWA_SOURCE_ID, LATER);
    const { releaseId } = await ingestRelease(db, KKR_KANAZAWA_ADAPTER, bytes, KKR_KANAZAWA_FIXTURE_RELEASE);
    assert.equal(await recordReviewedAnchors(db, KKR_KANAZAWA_ADAPTER, KKR_KANAZAWA_FIXTURE_SHA256, LATER), 1);
    assert.equal((await resolveFirstRelease(db, KKR_KANAZAWA_ADAPTER, releaseId, {
      now: LATER, newSpotId: sequentialSpotIds("Q"),
    })).status, "resolved");
    const afterRows = db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all();
    assert.equal(afterRows.length, 516);
    assert.deepEqual(afterRows.filter(row => oldIds.has(row.spot_id)), oldRows,
      "every baseline canonical column and ID must survive the additive resolution unchanged");

    const report = await publishTiles(db, { now: LATER });
    assert.equal(report.published.length, 1);
    assert.deepEqual([...report.unchanged].sort(), [...oldTileIds].sort());
    assert.equal(oldTileIds.has(report.published[0]!.tileId), false, "KKR is outside every historical baseline tile");
    const tiles = await readPublishedTiles(db);
    const published = tiles.flatMap(tile => tile.spots);
    assert.equal(published.length, 514);
    const byId = new Map(published.map(spot => [spot.id, spot]));
    for (const spot of oldPublished) assert.deepEqual(byId.get(spot.id), spot);
    const added = published.filter(spot => !oldIds.has(spot.id));
    assert.equal(added.length, 1);
    assert.deepEqual(added[0]!.sourceIds, [KKR_KANAZAWA_SOURCE_ID]);
    assert.equal(added[0]!.verification.locationPrecision, "areaApproximate");
    assert.equal(added[0]!.verification.locationArea?.scope, "facility");
    assert.deepEqual(db.raw.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all()
      .filter(row => oldTileIds.has(row.tile_id)), oldTiles, "old manifests, hashes, revisions and timestamps are byte-identical");
    assert.deepEqual(db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index").all()
      .filter(row => oldTileIds.has(row.tile_id)), oldParts, "old part bodies and content hashes are byte-identical");
    assert.deepEqual(db.raw.prepare("SELECT * FROM tile_snapshot_spots ORDER BY tile_id, spot_id").all()
      .filter(row => oldTileIds.has(row.tile_id)), oldMembership);
    assert.deepEqual(db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all()
      .filter(row => oldIds.has(row.spot_id)), oldRows);
    assert.equal(tiles.length, oldTiles.length + 1);
  } finally { db.raw.close(); }
});
