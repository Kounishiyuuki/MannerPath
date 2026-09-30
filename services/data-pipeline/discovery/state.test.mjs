import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadState, saveState} from './state.mjs';
import {resourceStatus, targetStatus} from './evaluator.mjs';

test('checkpoint resume rejects corruption and automatic approval states', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'discovery-state-'));
  const path = join(dir, 'state.json');
  try {
    assert.deepEqual(await loadState(path), {version: 1, targets: {}, resources: {}});
    await saveState(path, {version: 1, targets: {target: {status: 'candidate'}}, resources: {raw: {status: 'priorInspected'}}});
    assert.equal((await loadState(path)).targets.target.status, 'candidate');
    for (const text of ['{', '{"version":2,"targets":{},"resources":{}}', '{"version":1,"targets":{"x":{"status":"approved"}},"resources":{}}']) {
      await writeFile(path, text);
      await assert.rejects(loadState(path));
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('evaluator fails malformed content closed and keeps keyword candidates unapproved', () => {
  assert.equal(resourceStatus({matchingRowCount: 2, rawRowCount: 10, blockerCodes: ['incompatibleFormat']}), 'blocked');
  assert.equal(resourceStatus({matchingRowCount: 2, rawRowCount: 10, blockerCodes: ['licenseUnknown']}), 'candidate');
  assert.equal(resourceStatus({matchingRowCount: 0, rawRowCount: 10}), 'rawScanned');
  assert.equal(targetStatus([], ['rateLimited']), 'blocked');
  assert.equal(targetStatus([], []), 'metadataScanned');
});
