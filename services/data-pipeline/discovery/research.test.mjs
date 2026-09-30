import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runDiscovery } from './cli.mjs';
import { FetchCache } from './fetch-cache.mjs';
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const manifest = await json('./manifest.json');
const seed = await json('./research-seed.json');
async function options(t, targets, fetchImpl) {
  const dir = await mkdtemp(join(tmpdir(), 'research-discovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { manifest: { targets }, statePath: join(dir, 'state.json'), fetcher: new FetchCache({ directory: join(dir, 'cache'), delayMs: 0, validateUrl: async () => {}, fetchImpl }) };
}
test('nationwide manifest tracks all required jurisdiction roles without duplicate targets', () => {
  const targets = manifest.targets;
  assert.equal(new Set(targets.map(t => t.id)).size, targets.length);
  assert.equal(new Set(manifest.prefectures).size, 47);
  for (const [role, count] of [['prefecture', 47], ['prefecturalCapital', 47], ['ordinanceDesignatedCity', 20], ['tokyoWard', 23]]) {
    const selected = targets.filter(t => t.roles.includes(role));
    assert.equal(selected.length, count, role);
    if (role === 'prefecture' || role === 'prefecturalCapital') assert.deepEqual(new Set(selected.map(t => t.prefecture)), new Set(manifest.prefectures));
  }
  for (const role of ['railway', 'subway', 'airport', 'airportTerminal', 'stationFacility']) assert.ok(targets.some(t => t.roles.includes(role)), role);
  assert.ok(targets.length >= 100);
  for (const target of targets) for (const url of target.rawResources.map(r => r.url)) assert.ok(['http:', 'https:'].includes(new URL(url).protocol));
});
test('reviewed source seeds and required historical decisions survive manifest generation', () => {
  assert.deepEqual(manifest.targets.filter(t => t.seedStatus === 'implemented').map(t => t.name).sort(), ['台東区', '大阪市', '江東区', '武蔵野市', '港区', '京都市'].sort());
  for (const reference of ['PR #106', 'PR #112', 'PR #115', 'PR #119', 'PR #121', 'PR #125', 'PR #129', 'Issue #118', 'PR #122', 'docs/SOURCES.md']) assert.ok(manifest.researchReferences.includes(reference), reference);
  assert.ok(manifest.targets.some(t => t.priorResearch.some(p => p.reference.startsWith('docs/research/'))));
});
test('historical seed imports the exact 52 audited URLs and hashes, preserving inspection counts', async () => {
  const audit = await json('../../../docs/research/2026-09-30-east-north-operator-mega-batch.raw-audit.json');
  assert.equal(seed.resources.length, 52);
  const imported = new Map(seed.resources.flatMap(r => r.rawUrls.map(url => [url, r])));
  assert.equal(imported.size, 52);
  for (const payload of audit.payloads) {
    const entry = imported.get(payload.rawUrl);
    assert.ok(entry, payload.rawUrl);
    assert.equal(entry.sha256, payload.sha256);
    if (payload.dataRows !== undefined) assert.equal(entry.rawRowCount, payload.dataRows);
    else if (payload.parsedRowsIncludingHeader !== undefined) assert.equal(entry.rawRowCount, payload.parsedRowsIncludingHeader - 1);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(manifest.targets.some(t => t.id === entry.targetId && t.priorResearch.some(p => p.sha256 === entry.sha256)));
  }
});
test('actual confirmed historical raw is not fetched; metadata-only reference still gets inspected', async t => {
  const historical = seed.resources.find(r => manifest.targets.some(target => target.id === r.targetId));
  const knownUrl = historical.rawUrls[0], freshUrl = 'https://fresh.test/new.csv';
  const original = manifest.targets.find(target => target.id === historical.targetId);
  const calls = [];
  const config = await options(t, [{ id: original.id, name: original.name, rawResources: [{ url: knownUrl }, { url: freshUrl }], priorResearch: [historical, { reference: '#121', status: 'metadataScanned', rawUrls: [freshUrl] }] }], async url => {
    calls.push(url); return new Response('name,lat,lng\n喫煙所,35,139');
  });
  const state = await runDiscovery(config);
  assert.deepEqual(calls, [freshUrl]);
  assert.equal(state.resources[knownUrl].sha256, historical.sha256);
  assert.equal(state.resources[knownUrl].rawRowCount, historical.rawRowCount);
  assert.equal(state.resources[freshUrl].matchingRowCount, 1);
  assert.equal(state.resources[freshUrl].status, 'candidate');
  await runDiscovery(config);
  assert.deepEqual(calls, [freshUrl]);
});
test('complete coordinate and license metadata cannot automatically approve discovered smoking rows', async t => {
  const config = await options(t, [{ id: 'new', name: 'New', rawResources: [{ url: 'https://new.test/data.geojson', format: 'geojson', license: 'CC BY 4.0', attribution: 'Publisher' }] }], async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: '指定喫煙所' }, geometry: { type: 'Point', coordinates: [139, 35] } }] })));
  const state = await runDiscovery(config);
  assert.equal(state.targets.new.status, 'candidate');
  assert.equal(state.resources['https://new.test/data.geojson'].status, 'candidate');
  assert.ok(!Object.values(state.targets).some(t => ['approved', 'implemented'].includes(t.status)));
});
test('GIS inspection preserves raw download hash and format rather than derived JSON identifiers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'research-gpkg-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'data.gpkg'), db = new DatabaseSync(path);
  db.exec("CREATE TABLE gpkg_contents(table_name,data_type); CREATE TABLE gpkg_geometry_columns(table_name,column_name,geometry_type_name,srs_id); CREATE TABLE gpkg_spatial_ref_sys(srs_id,organization,organization_coordsys_id,definition); CREATE TABLE points(category TEXT, geom BLOB); INSERT INTO gpkg_contents VALUES('points','features'); INSERT INTO gpkg_geometry_columns VALUES('points','geom','POINT',4326); INSERT INTO gpkg_spatial_ref_sys VALUES(4326,'EPSG',4326,'publisher WKT'); INSERT INTO points VALUES('smoking room',X'00');");
  db.close();
  const raw = await readFile(path), sha = createHash('sha256').update(raw).digest('hex');
  const url = 'https://gis.test/data.gpkg';
  const config = await options(t, [{ id: 'gis', name: 'GIS', rawResources: [{ url }] }], async () => new Response(raw));
  const state = await runDiscovery(config);
  assert.equal(state.resources[url].sha256, sha);
  assert.equal(state.resources[url].format, 'gpkg');
  assert.equal(state.resources[url].matchingRowCount, 1);
  assert.ok(state.resources[url].blockerCodes.includes('coordinatesMissing'));
});
