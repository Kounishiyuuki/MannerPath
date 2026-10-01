import { test } from "node:test";
import assert from "node:assert/strict";
import { nearbyCrossSourcePairs, nearestSphericalDistances } from "../src/geo/spherical-index.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { distanceMetres, normalizeText, recallPairs, type RecallSpot } from "../src/pipeline/cross-source.ts";

test("spatial cross-source recall equals exhaustive v1 at seam, poles and dense clusters", () => {
  const spots: RecallSpot[] = Array.from({ length: 150 }, (_, i) => ({
    spotId: String(i).padStart(4, "0"), sourceId: `source-${i % 3}`, name: `name ${i % 4}`, location: null,
    latitude: 35.68 + (i % 10) * 0.0005, longitude: 139.7 + Math.floor(i / 10) * 0.0005,
  }));
  spots.push(...[[0, 179.9999], [0, -179.9999], [89.9999, 80], [89.9999, -80], [-89.9999, 50], [-89.9999, -50]]
    .map(([latitude, longitude], i) => ({ spotId: `edge-${i}`, sourceId: `edge-${i}`, name: "same", location: null, latitude, longitude })));
  const expected = [];
  const sorted = [...spots].sort((a, b) => a.spotId < b.spotId ? -1 : 1);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const a = sorted[i], b = sorted[j], d = distanceMetres(a, b);
    if (a.sourceId !== b.sourceId && (d <= 100 || d <= 500 && normalizeText(a.name) === normalizeText(b.name))) expected.push([a.spotId, b.spotId]);
  }
  assert.deepEqual(recallPairs(spots.reverse()).map((p) => [p.a.spotId, p.b.spotId]), expected);
});

test("nearest spherical search remains exact against exhaustive haversine", () => {
  const spots = Array.from({ length: 180 }, (_, i) => ({ latitude: (i * 7919 % 18000) / 100 - 90, longitude: (i * 3571 % 36000) / 100 - 180 }));
  spots.push({ ...spots[0] }, { latitude: 0, longitude: 179.9999 }, { latitude: 0, longitude: -179.9999 });
  const actual = nearestSphericalDistances(spots);
  for (let i = 0; i < spots.length; i++) {
    const expected = Math.min(...spots.filter((_, j) => j !== i).map((b) => haversineMeters(spots[i], b)));
    assert.ok(Math.abs(actual[i] - expected) < 0.00001, `${i}: ${actual[i]} != ${expected}`);
  }
});

test("nationwide sparse lookup visits no distant pairs or same-source dense pairs", () => {
  const sparse = Array.from({ length: 10000 }, (_, i) => ({ latitude: 30 + Math.floor(i / 100) * 0.01, longitude: 130 + (i % 100) * 0.01, sourceId: `s${i % 2}` }));
  assert.ok([...nearbyCrossSourcePairs(sparse, 500)].length < sparse.length, "bounded spatial prefilter, rather than 50 million nationwide pairs");
  const dense = Array.from({ length: 10000 }, () => ({ latitude: 35.6, longitude: 139.7, sourceId: "single-source" }));
  assert.equal([...nearbyCrossSourcePairs(dense, 500)].length, 0);
});
