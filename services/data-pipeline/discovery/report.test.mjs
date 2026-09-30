import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReport, markdownReport} from './report.mjs';

test('coverage follows reviewed publication identity, independent of discovery success', () => {
  const manifest = {prefectures: ['東京都', '北海道'], targets: [
    {id: 'ward', name: '台東区', prefecture: '東京都', kind: 'municipality', roles: ['tokyoWard'], reviewedSourceIds: ['reviewed-source'], seedStatus: 'implemented'},
    {id: 'city', name: '札幌市', prefecture: '北海道', kind: 'municipality', roles: ['prefecturalCapital', 'ordinanceDesignatedCity'], seedStatus: 'unscanned'},
  ]};
  const state = {targets: {ward: {status: 'blocked', completedAt: '2026-09-30', blockerCodes: ['accessBlocked']}, city: {status: 'candidate', completedAt: '2026-09-30'}}, resources: {url: {status: 'candidate', sha256: 'hash'}}};
  const report = buildReport(manifest, state);
  assert.equal(report.targets[0].coverage, 'covered');
  assert.equal(report.targets[1].coverage, 'candidate');
  assert.equal(report.summary.coveredPrefectures, 1);
  assert.equal(report.summary.coveredCapitals, 0);
  assert.equal(report.summary.newApproved, 0);
  assert.equal(report.summary.newImplemented, 0);
  assert.match(markdownReport(report), /partial reviewed publication/);
  const rejected = buildReport(manifest, {...state, targets: {...state.targets, city: {...state.targets.city, resourceUrls: ['url']}}}, [{rawUrl: 'url', verdict: 'blocked'}]);
  assert.equal(rejected.targets[1].coverage, 'blocked');
  assert.equal(rejected.summary.coveredPrefectures, 1);
});

test('historical inspection and duplicate hashes cannot inflate fresh scan metrics', () => {
  const report = buildReport({prefectures: [], targets: []}, {targets: {}, resources: {
    a: {status: 'priorInspected', sha256: 'old', rawRowCount: 10},
    b: {status: 'rawScanned', sha256: 'same', rawRowCount: 3},
    c: {status: 'rawScanned', sha256: 'same', rawRowCount: 3},
    d: {status: 'blocked'},
  }});
  assert.equal(report.summary.rawScannedResources, 2);
  assert.equal(report.summary.uniqueScannedHashes, 1);
  assert.equal(report.summary.priorInspectedResources, 1);
  assert.equal(report.resources[0].rawRowCount, 10);
});
