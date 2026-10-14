import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configBody } from '../src/config/dto.ts';
import { tileForCoordinate, formatTileId } from '../src/geo/tile.ts';
import { TileSpotV1 } from '../src/tiles/dto.ts';
import { collectProductionAudit, validateTiles, run, PRODUCTION_ORIGIN } from '../scripts/release-data-audit.ts';
const tile = formatTileId(tileForCoordinate(35.713, 139.791, 14));
const source = { id: 'synthetic-source', displayName: 'Synthetic official source', licenseName: 'Synthetic test only', licenseUrl: 'https://example.invalid/license', attributionText: 'Synthetic fixture' };
const spot = TileSpotV1.parse({ id: 'sp_00000000000000000000000001', name: 'Synthetic smoking place', latitude: 35.713, longitude: 139.791,
  spotType: 'designatedOutdoorArea', accessType: 'unknown', environment: 'unknown', supportsPaper: 'unknown', supportsHeated: 'unknown',
  openingHours: { status: 'none', raw: null, parsed: null, timeZone: 'Asia/Tokyo' }, lifecycle: 'active', evidenceQuality: 'official', evidenceQualityVersion: 'v1', lastVerifiedAt: null,
  sourceIds: [source.id], spotSubtype: null, hostType: 'municipality', accessDetail: null,
  verification: { version: 'spot-verification.v1', existence: 'official', locationPrecision: 'areaApproximate', confirmations: null, lastReviewedMonth: null, locationArea: { name: 'Synthetic area', kind: 'park' } } });
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function mock(options: { badHash?: boolean; changed?: boolean; missing?: boolean; badSource?: boolean; duplicate?: boolean; reports?: boolean; malformed?: boolean; badEtag?: boolean; oversized?: boolean; badPartIdentity?: boolean; missingSource?: boolean; invalidPrecision?: boolean; badDetail?: boolean } = {}) {
  const part = JSON.stringify({ schemaVersion: 2, tile, part: options.badPartIdentity ? 1 : 0, partCount: 1, spots: options.duplicate ? [spot, spot] : [{ ...spot, sourceIds: options.missingSource ? ['missing-source'] : spot.sourceIds, verification: options.invalidPrecision ? { ...spot.verification, locationArea: undefined } : spot.verification }], sources: [{ ...source, attributionText: options.badSource ? null : source.attributionText }] });
  const count = options.duplicate ? 2 : 1;
  const manifest = { schemaVersion: 2, tile, revision: 1, generatedAt: '2026-10-15T00:00:00Z', partPolicy: 'tile-parts.v1', spotCount: count, parts: [{ index: 0, spotCount: count, sha256: options.badHash ? '0'.repeat(64) : digest(part) }] };
  let manifests = 0;
  const paths: string[] = [];
  const fetcher = (async (input, init) => {
    const url = String(input); assert.ok(url.startsWith(PRODUCTION_ORIGIN + '/v1/')); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    paths.push(url);
    let body: string;
    if (url.endsWith('/readiness')) body = JSON.stringify({ schemaVersion: 1, completed: true, state: 'completed' });
    else if (url.endsWith('/config')) { const config = configBody({ REPORT_ATTESTATION: 'invalid' }); config.reports.available = options.reports ?? false; body = JSON.stringify(config); }
    else if (url.endsWith('/manifest')) { manifests++; body = options.malformed ? '{' : JSON.stringify({ ...manifest, revision: options.changed && manifests > 1 ? 2 : 1 }); }
    else if (url.includes('/parts/')) { if (options.missing) return new Response('{}', { status: 404 }); body = part; }
    else if (url.includes('/spots/')) body = JSON.stringify({ schemaVersion: 1, requestedId: spot.id, mergedInto: null, spot: { ...spot, tile, name: options.badDetail ? 'Different detail' : spot.name }, sources: [source], provenance: [] });
    else throw new Error('Unexpected path');
    const headers = new Headers({ 'content-type': 'application/json' });
    if (url.endsWith('/manifest') || url.includes('/parts/')) headers.set('etag', `W/"2-${options.badEtag ? '0'.repeat(64) : digest(body)}"`);
    if (options.oversized) headers.set('content-length', '999999999');
    return new Response(body, { headers });
  }) as typeof fetch;
  return { fetcher, paths };
}
test('bounded production observer preserves unknowns, provenance and scope; GET only', async () => {
  const m = mock(); const report = await collectProductionAudit([tile], m.fetcher);
  assert.equal(report.counts.spots, 1); assert.equal(report.counts.areaApproximate, 1); assert.equal(report.counts.accessUnknown, 1); assert.equal(report.counts.hoursUnknown, 1); assert.equal(report.counts.verifiedDateUnknown, 1);
  assert.equal(report.sourceCounts[source.id], 1); assert.match(report.scope, /Does not prove absence/); assert.equal(report.screenshotCandidates[0].spotId, spot.id); assert.equal(m.paths.length, 6);
});
for (const [label, options] of Object.entries({ 'hash mismatch': { badHash: true }, 'changed manifest': { changed: true }, 'missing part': { missing: true }, 'source attribution missing': { badSource: true }, 'duplicate IDs': { duplicate: true }, 'reports enabled': { reports: true }, 'malformed JSON': { malformed: true }, 'ETag mismatch': { badEtag: true }, 'oversized response': { oversized: true }, 'part identity mismatch': { badPartIdentity: true }, 'missing spot source': { missingSource: true }, 'approximate area missing': { invalidPrecision: true }, 'detail disagreement': { badDetail: true } })) {
  test(`production audit rejects ${label}`, async () => { await assert.rejects(collectProductionAudit([tile], mock(options).fetcher)); });
}
test('invalid, duplicate and excessive tile lists reject before GET', async () => {
  for (const tiles of [[], [tile, tile], ['14/01/2'], ['13/1/2'], Array(101).fill(tile), ['14/16384/0']]) {
    assert.throws(() => validateTiles(tiles)); await assert.rejects(collectProductionAudit(tiles, (async () => { assert.fail('network forbidden'); }) as typeof fetch));
  }
});
test('CLI output is fresh, no overwrites or symlink following, failures remove partial output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-data-audit-')); const input = join(dir, 'tiles.json'); const output = join(dir, 'report.json');
  try {
    writeFileSync(input, JSON.stringify([tile])); await run(['--tiles', input, '--out', output], mock().fetcher); assert.equal(JSON.parse(readFileSync(output, 'utf8')).counts.spots, 1);
    await assert.rejects(run(['--tiles', input, '--out', output], (async () => { assert.fail('network forbidden'); }) as typeof fetch));
    const symlink = join(dir, 'link'); symlinkSync(output, symlink); await assert.rejects(run(['--tiles', input, '--out', symlink], mock().fetcher));
    const failed = join(dir, 'failed.json'); await assert.rejects(run(['--tiles', input, '--out', failed], mock({ missing: true }).fetcher)); assert.throws(() => readFileSync(failed));
    await assert.rejects(run(['--base-url', 'https://other.invalid'], mock().fetcher));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('more than 20 observed sources rejects before any detail requests', async () => {
  const sources = Array.from({ length: 21 }, (_, i) => ({ ...source, id: `synthetic-source-${i}` }));
  const spots = sources.map((source, i) => ({ ...spot, id: `sp_${String(i + 1).padStart(26, '0')}`, sourceIds: [source.id] }));
  const part = JSON.stringify({ schemaVersion: 2, tile, part: 0, partCount: 1, spots, sources });
  const manifest = JSON.stringify({ schemaVersion: 2, tile, revision: 1, generatedAt: '2026-10-15T00:00:00Z', partPolicy: 'tile-parts.v1', spotCount: 21, parts: [{ index: 0, spotCount: 21, sha256: digest(part) }] });
  const base = mock();
  let detailRequests = 0;
  const fetcher = (async (input, init) => {
    const url = String(input);
    if (url.includes('/spots/')) { detailRequests++; assert.fail('No detail reads after source cap exceeded'); }
    if (url.endsWith('/manifest') || url.includes('/parts/')) {
      const body = url.endsWith('/manifest') ? manifest : part;
      return new Response(body, { headers: { 'content-type': 'application/json', etag: `"2-${digest(body)}"` } });
    }
    return base.fetcher(input, init);
  }) as typeof fetch;
  await assert.rejects(collectProductionAudit([tile], fetcher), /Source detail request budget exceeded/);
  assert.equal(detailRequests, 0);
});
