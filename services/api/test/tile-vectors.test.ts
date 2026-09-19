import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DATA_TILE_ZOOM, formatTileId, parseTileId, tileForCoordinate } from "../src/geo/tile.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../../../contracts/tiles/slippy-xyz-vectors.v1.json", import.meta.url), "utf8"),
);

test("vector file is the expected contract version", () => {
  assert.equal(vectors.contract, "mannerpath-slippy-xyz-tile-vectors");
  assert.equal(vectors.version, 1);
  assert.ok(vectors.coordinateToTile.length > 0);
});

test("DATA_TILE_ZOOM matches ADR-0005", () => {
  assert.equal(DATA_TILE_ZOOM, 14);
});

for (const v of vectors.coordinateToTile) {
  test(`coordinate → tile: ${v.name}`, () => {
    const tile = tileForCoordinate(v.lat, v.lon, v.z);
    assert.deepEqual(tile, { z: v.z, x: v.x, y: v.y });
    assert.equal(formatTileId(tile), v.tileId);
  });
}

for (const v of vectors.invalidCoordinates) {
  test(`invalid input is rejected: ${v.name}`, () => {
    assert.throws(() => tileForCoordinate(v.lat, v.lon, v.z), RangeError);
  });
}

for (const v of vectors.tileIds.valid) {
  test(`tile ID parses: ${v.tileId}`, () => {
    assert.deepEqual(parseTileId(v.tileId), { z: v.z, x: v.x, y: v.y });
  });
}

for (const id of vectors.tileIds.invalid) {
  test(`tile ID is rejected: ${JSON.stringify(id)}`, () => {
    assert.equal(parseTileId(id), null);
  });
}
