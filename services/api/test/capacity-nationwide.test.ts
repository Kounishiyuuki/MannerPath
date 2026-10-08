// Safety and request-model regressions, not evidence that a nationwide capacity run succeeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { matrixOptions, tempOutput, capacityRefusal } from '../scripts/capacity-matrix.ts';
import { D1_CAPACITY_POLICY } from '../scripts/promotion-v4-format.ts';
import { syntheticSpots, syntheticId, corpusDigest, PROFILES, DISTRIBUTIONS, type Profile } from '../scripts/scale/corpus.ts';
import { CAPACITY_ADAPTER, CAPACITY_SOURCE, CAPACITY_REGISTRY } from '../scripts/capacity-source.ts';
import { reviewedSource } from '../src/pipeline/registry.ts';
import { tileForCoordinate, formatTileId, DATA_TILE_ZOOM } from '../src/geo/tile.ts';
import { TileBudgetExceeded, splitTileParts, manifestBody } from '../src/tiles/parts.ts';
import { zoomComparison } from '../scripts/scale/zoom.ts';
import type { TileSpotV1, TileSourceV1 } from '../src/tiles/dto.ts';

const output = join(tmpdir(), 'capacity-options-test');
const args = ['--output', output];
test('matrix rejects invalid, duplicate, missing and remote options before work', () => {
  assert.deepEqual(matrixOptions(args).sizes, ['1k', '10k', '50k', '100k']);
  for (const tail of [
    ['--sizes', '0'], ['--sizes', '1k,1k'], ['--sizes', '1k,'], ['--sizes', 'toString'],
    ['--chunk-bytes', 'NaN'], ['--chunk-bytes', '1.5'], ['--chunk-bytes', String(D1_CAPACITY_POLICY.statementBytes - 1)],
    ['--chunk-bytes', String(D1_CAPACITY_POLICY.importBytes)], ['--chunk-bytes', 'Infinity'],
    ['--remote', 'true'], ['--environment', 'production'], ['--distribution', 'unknown'],
    ['--phase', 'finalize'], ['--sizes'], ['--sizes', '--remote'], ['--output', output],
    ['--phase', 'ingest'],
  ]) assert.throws(() => matrixOptions([...args, ...tail]), tail.join(' '));
  assert.throws(() => matrixOptions([]), /output/);
  assert.equal(matrixOptions([...args, '--sizes', '1k', '--phase', 'ingest', '--chunk-bytes', String(D1_CAPACITY_POLICY.statementBytes)]).chunkBytes, D1_CAPACITY_POLICY.statementBytes);
});

test('temporary outputs reject repository paths, roots and symlinks escaping temp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capacity-output-test-'));
  try {
    assert.equal(tempOutput(join(dir, 'new', 'nested')), join(dir, 'new', 'nested'));
    assert.throws(() => tempOutput(process.cwd()), /temporary/);
    assert.throws(() => tempOutput('/private/tmp'), /temporary/);
    symlinkSync(process.cwd(), join(dir, 'escape'));
    assert.throws(() => tempOutput(join(dir, 'escape', 'new')), /temporary/);
    symlinkSync(dir, join(dir, 'safe'));
    assert.equal(tempOutput(join(dir, 'safe', 'new')), resolve(dir, 'safe', 'new'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only explicit publication budget refusals become measured capacity refusals', () => {
  assert.equal(capacityRefusal(new TileBudgetExceeded('too dense')), true);
  for (const reason of ['tile declarations exceed manifest capacity', 'source declarations exceed manifest capacity', 'manifest exceeds capacity', 'release declarations exceed bounded manifest budget', 'source declarations exceed bounded manifest budget']) assert.equal(capacityRefusal(new Error(`promotion v4 export refused: ${reason}`)), true);
  for (const error of [new Error('SQLITE_BUSY'), new Error('unexpected integrity failure'), new Error('bounded manifest budget'), 'TileBudgetExceeded', null]) assert.equal(capacityRefusal(error), false);
});

test('all distributions produce deterministic unique profile-sized corpora', () => {
  for (const distribution of DISTRIBUTIONS) {
    for (const profile of Object.keys(PROFILES) as Profile[]) {
      const ids = new Set<string>();
      let count = 0;
      for (const spot of syntheticSpots(profile, undefined, distribution)) { ids.add(spot.spotId); count++; }
      assert.equal(count, PROFILES[profile]);
      assert.equal(ids.size, count);
    }
    assert.equal(corpusDigest('small', undefined, distribution), corpusDigest('small', undefined, distribution));
  }
  // Pre-distribution small profile digest: preserve the existing community scale benchmark fixture.
  assert.equal(corpusDigest('small'), '5da700632a7029544600da5837c364eb881de21f9993c9338a949cdd729d8094');
});

test('extreme stays in one z14 tile; sparse spans nationwide bounding coordinates', () => {
  const extreme = new Set<string>();
  for (const s of syntheticSpots('stress', undefined, 'extreme')) extreme.add(formatTileId(tileForCoordinate(s.latitude, s.longitude, DATA_TILE_ZOOM)));
  assert.equal(extreme.size, 1);
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const s of syntheticSpots('small', undefined, 'sparse')) {
    assert.ok(s.latitude >= 24 && s.latitude <= 45.5 && s.longitude >= 123 && s.longitude <= 146);
    minLat = Math.min(minLat, s.latitude); maxLat = Math.max(maxLat, s.latitude);
    minLon = Math.min(minLon, s.longitude); maxLon = Math.max(maxLon, s.longitude);
  }
  assert.ok(minLat < 24.1 && maxLat > 45.4 && minLon < 123.1 && maxLon > 145.9);
});

test('synthetic adapter is blocked and never resolves through the reviewed production registry', () => {
  assert.equal(CAPACITY_ADAPTER.registry.publicationStatus, 'blocked');
  assert.throws(() => reviewedSource(CAPACITY_SOURCE));
  assert.equal(CAPACITY_REGISTRY.source(CAPACITY_SOURCE).publicationStatus, 'approved');
  assert.throws(() => CAPACITY_REGISTRY.source('some-real-source'));
  const observed = CAPACITY_ADAPTER.observe(['0', 'SYNTHETIC smoking-place', '35.68', '139.76']);
  assert.ok(observed.provenance.some(p => p.field === 'existence'));
  assert.ok(observed.provenance.some(p => p.field === 'location' && p.columns.includes('latitude') && p.columns.includes('longitude')));
});

const source: TileSourceV1 = { id: 'test-only', displayName: 'TEST ONLY', licenseName: 'TEST', licenseUrl: 'https://example.invalid', attributionText: 'TEST ONLY' };
const sources = new Map([[source.id, source]]);
function dto(id: string): TileSpotV1 {
  return { id, name: null, latitude: 35.6896, longitude: 139.7006, spotType: 'ashtray', accessType: 'unknown', environment: 'unknown', supportsPaper: 'unknown', supportsHeated: 'unknown', openingHours: { status: 'none', raw: null, parsed: null, timeZone: 'Asia/Tokyo' }, lifecycle: 'active', evidenceQuality: 'communityReported', evidenceQualityVersion: 'evidence-quality.v1', lastVerifiedAt: null, sourceIds: [source.id], spotSubtype: null, hostType: 'unknown', accessDetail: null, verification: { version: 'spot-verification.v1', existence: 'communityReported', locationPrecision: 'communityPinned', confirmations: 1, lastReviewedMonth: '2026-10' } };
}

test('cold multipart viewport counts initial 409, manifest, every part and absent 404 requests', async () => {
  const spots = Array.from({ length: 300 }, (_, i) => dto(syntheticId('sp', i)));
  const probe = { id: 'dense', latitude: spots[0].latitude, longitude: spots[0].longitude };
  const absent = { id: 'absent', latitude: 43, longitude: 141 };
  const tile = formatTileId(tileForCoordinate(probe.latitude, probe.longitude, DATA_TILE_ZOOM));
  const now = '2026-10-08T00:00:00Z';
  const parts = await splitTileParts(tile, spots, sources);
  assert.ok(parts.length > 1);
  const payloadBytes = gzipSync(JSON.stringify(manifestBody(tile, 1, now, parts))).length + parts.reduce((n, p) => n + gzipSync(p.bodyJson).length, 0);
  const result = await zoomComparison(spots, sources, DATA_TILE_ZOOM, [probe, absent], now);
  for (const [viewport, neighbours] of [[result.after.viewport, 9], [result.after.viewport5x5, 25]] as const) {
    assert.equal(viewport.probes[0].requests, neighbours - 1 + 2 + parts.length);
    assert.equal(viewport.probes[0].gzipBytes, payloadBytes, 'payload estimate excludes 409/404 bodies and headers');
    assert.equal(viewport.probes[1].requests, neighbours);
    assert.equal(viewport.probes[1].gzipBytes, 0);
  }
});

test("maximum byte accounting accepts more values than the JS argument stack", async () => {
  const { maximumBytes } = await import("../scripts/scale/zoom.ts");
  assert.equal(maximumBytes(Array.from({ length: 200_000 }, (_, i) => i)), 199_999);
  assert.equal(maximumBytes([]), 0);
});
