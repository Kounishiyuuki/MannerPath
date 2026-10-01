import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {eligibleReference, buildReferenceQueue, requireExternalPath, runReferenceLeads} from './reference-leads.mjs';
const manifest = {targets: [{id: 'municipal-example', name: '公式調査対象', publisher: '公式発行者', prefecture: '調査県', roles: ['municipality']}]};
const repository = fileURLToPath(new URL('../../../', import.meta.url));
async function temporary(t) {
 const path = await mkdtemp(join(tmpdir(), 'reference-leads-'));
 t.after(() => rm(path, {recursive: true, force: true}));
 return path;
}

test('reference selection accepts only smoking areas or bare dedicated smoking places', () => {
 assert.equal(eligibleReference({amenity: 'smoking_area'}), true);
 assert.equal(eligibleReference({smoking: 'dedicated'}), true);
 for (const smoking of ['yes', 'outside', 'separated', 'isolated', 'no']) assert.equal(eligibleReference({smoking}), false);
 for (const tags of [null, [], {amenity: 'waste_basket', waste: 'cigarettes'}, {shop: 'tobacco'},
  {shop: 'convenience', smoking: 'dedicated'}, {amenity: 'restaurant', smoking: 'dedicated'},
  {office: 'company', smoking: 'dedicated'}, {railway: 'station', smoking: 'dedicated'},
  {aeroway: 'aerodrome', smoking: 'dedicated'}, {ashtray: 'yes'}]) assert.equal(eligibleReference(tags), false);
});

test('queue is official-manifest-only, deduplicated and never preserves reference values', () => {
 const candidates = [{tags: {amenity: 'smoking_area', name: 'REFERENCE_SENTINEL', opening_hours: 'REFERENCE_HOURS'},
  id: 'REFERENCE_ID', coordinate: [123.456789, 23.456789], targetIds: ['municipal-example', 'unrecognized-reference-name'],
  publisher: 'REFERENCE_PUBLISHER'}, {tags: {smoking: 'dedicated'}, targetIds: ['municipal-example']},
  {tags: {smoking: 'yes'}, targetIds: ['other']}];
 const result = buildReferenceQueue(manifest, candidates);
 assert.equal(result.eligibleCount, 2);
 assert.deepEqual(result.queue, [{targetId: 'municipal-example', jurisdiction: '公式調査対象', publisher: '公式発行者', prefecture: '調査県', roles: ['municipality']}]);
 assert.doesNotMatch(JSON.stringify(result.queue), /REFERENCE|123\.456789|23\.456789|amenity|opening_hours|coordinate|tags/);
});

test('repository paths, relative paths and symlinked repository paths are refused', async t => {
 const dir = await temporary(t);
 await symlink(repository, join(dir, 'repository'));
 await assert.rejects(requireExternalPath('local.json'), /absolute external/);
 await assert.rejects(requireExternalPath(resolve(repository, 'new-reference.json')), /outside the repository/);
 await assert.rejects(requireExternalPath(join(dir, 'repository', 'new-folder', 'raw.json')), /outside the repository/);
 assert.equal(await requireExternalPath(join(dir, 'new.json')), join(dir, 'new.json'));
});

test('local mode creates only a sanitized queue and refuses overwriting input or output', async t => {
 const dir = await temporary(t), inputPath = join(dir, 'input.json'), outputPath = join(dir, 'queue.json');
 const bytes = JSON.stringify({candidates: [{tags: {amenity: 'smoking_area', name: 'REFERENCE_SENTINEL'}, targetIds: ['municipal-example'], lat: 23.456789, lon: 123.456789, id: 999999999}]});
 await writeFile(inputPath, bytes);
 assert.deepEqual(await runReferenceLeads({manifest, inputPath, outputPath}), {eligibleCount: 1, leadGroups: 1});
 const output = await readFile(outputPath, 'utf8');
 assert.doesNotMatch(output, /REFERENCE|999999999|123\.456789|23\.456789|amenity|lat|lon|osm/);
 assert.equal(await readFile(inputPath, 'utf8'), bytes);
 await assert.rejects(runReferenceLeads({manifest, inputPath, outputPath}), /EEXIST/);
 await assert.rejects(runReferenceLeads({manifest, inputPath, outputPath: inputPath}), /EEXIST/);
 await assert.rejects(runReferenceLeads({manifest, inputPath: resolve(repository, 'services/data-pipeline/discovery/manifest.json'), outputPath: join(dir, 'never.json')}), /outside the repository/);
});

test('actual CLI fails closed and never enters network discovery or its output paths', async t => {
 const {spawnSync} = await import('node:child_process');
 const {existsSync} = await import('node:fs');
 const dir = await temporary(t), input = join(dir, 'input.json'), preload = join(dir, 'no-network.mjs');
 await writeFile(input, JSON.stringify({candidates: [{tags: {amenity: 'smoking_area'}, targetIds: ['city-nagoya']}]}));
 await writeFile(preload, 'globalThis.fetch = () => { throw Error("NETWORK_FORBIDDEN"); };\n');
 const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
 const state = join(dir, 'state.json'), cache = join(dir, 'cache'), report = join(dir, 'report.json');
 const paths = ['--state', state, '--cache', cache, '--report', report];
 for (const modeArgs of [['--reference-leads'], ['--reference-leads', ''], ['--reference-leads', 'unsupported']]) {
  const result = spawnSync(process.execPath, ['--import', preload, cli, ...paths, ...modeArgs], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Only osm reference leads are supported/);
  for (const path of [state, cache, report]) assert.equal(existsSync(path), false);
 }
 const queue = join(dir, 'queue.json');
 const valid = spawnSync(process.execPath, ['--import', preload, cli, ...paths, '--reference-leads', 'osm',
  '--reference-input', input, '--reference-queue', queue], {encoding: 'utf8'});
 assert.equal(valid.status, 0, valid.stderr);
 for (const path of [state, cache, report]) assert.equal(existsSync(path), false);
 assert.equal(JSON.parse(await readFile(queue, 'utf8')).queue.length, 1);
});

test('file symlinks and malformed input cannot write an output queue', async t => {
 const {existsSync} = await import('node:fs');
 const dir = await temporary(t), input = join(dir, 'input.json'), output = join(dir, 'queue.json');
 const tracked = resolve(repository, 'services/data-pipeline/discovery/manifest.json');
 const original = await readFile(tracked, 'utf8');
 await symlink(tracked, join(dir, 'input-link.json'));
 await symlink(tracked, join(dir, 'output-link.json'));
 await writeFile(input, '{');
 await assert.rejects(runReferenceLeads({manifest, inputPath: join(dir, 'input-link.json'), outputPath: output}), /outside the repository/);
 await assert.rejects(runReferenceLeads({manifest, inputPath: input, outputPath: join(dir, 'output-link.json')}), /outside the repository/);
 for (const content of ['{', '{}', '{"candidates":{}}']) {
  await writeFile(input, content);
  await assert.rejects(runReferenceLeads({manifest, inputPath: input, outputPath: output}));
  assert.equal(existsSync(output), false);
  assert.equal(await readFile(input, 'utf8'), content);
 }
 assert.equal(await readFile(tracked, 'utf8'), original);
});
