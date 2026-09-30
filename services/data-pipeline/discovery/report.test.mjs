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

test('manual deep review uses the latest attestation per known group, with last input winning ties', () => {
  const manifest = {prefectures: ['東京都'], targets: [
    {id: 'covered', name: '台東区', prefecture: '東京都', kind: 'municipality', roles: ['tokyoWard'], reviewedSourceIds: ['reviewed-source']},
    {id: 'candidate', name: '候補', prefecture: '東京都', kind: 'operator', roles: []},
    {id: 'blocked', name: '保留', prefecture: '東京都', kind: 'operator', roles: []},
    {id: 'approved', name: '承認', prefecture: '東京都', kind: 'operator', roles: []},
  ]};
  const scan = {status: 'candidate', completedAt: '2026-09-30', resourceUrls: ['raw'], blockerCodes: ['licenseUnknown']};
  const state = {targets: Object.fromEntries(manifest.targets.map(t => [t.id, structuredClone(scan)])), resources: {raw: {status: 'candidate'}}};
  const originalState = structuredClone(state);
  const reviews = [
    {targetId: 'candidate', deepReviewedAt: '2026-10-01T02:00:00Z', verdict: 'blocked'},
    {targetId: 'candidate', deepReviewedAt: '2026-10-01T01:00:00Z', verdict: 'approved'},
    {targetId: 'candidate', deepReviewedAt: '2026-10-01T02:00:00Z', verdict: 'candidate'},
    {targetId: 'covered', deepReviewedAt: '2026-10-01T02:00:00Z', verdict: 'blocked'},
    {targetId: 'blocked', deepReviewedAt: '2026-10-01T02:00:00Z', verdict: 'blocked'},
    {targetId: 'approved', deepReviewedAt: '2026-10-01T02:00:00Z', verdict: 'approved', implementedSourceId: 'manual-source'},
    {targetId: 'unknown', rawUrl: 'raw', deepReviewedAt: '2026-10-01T02:00:00Z', verdict: 'blocked'},
    {targetId: 'candidate', rawUrl: 'raw', deepReviewedAt: 'invalid', verdict: 'blocked'},
    {targetId: 'candidate', rawUrl: 'raw', deepReviewedAt: null, verdict: 'blocked'},
    {rawUrl: 'legacy', verdict: 'blocked'},
  ];
  const report = buildReport(manifest, state, reviews);
  assert.equal(report.targets[0].coverage, 'covered');
  assert.equal(report.targets[1].deepReview, reviews[2]);
  assert.equal(report.targets[1].coverage, 'candidate');
  assert.equal(report.targets[2].coverage, 'blocked');
  assert.equal(report.targets[3].coverage, 'candidate');
  assert.deepEqual(report.targets[3].reviewedSourceIds, []);
  assert.equal(report.approvalAutomated, false);
  assert.equal(report.summary.deepReviewedGroups, 4);
  assert.equal(report.summary.deepBlockedGroups, 2);
  assert.equal(report.summary.deepCandidateGroups, 1);
  assert.equal(report.summary.deepApprovedGroups, 1);
  assert.equal(report.summary.deepImplementedGroups, 1);
  assert.equal(report.summary.individuallyReviewedCandidates, 1);
  assert.equal(report.summary.rejectedKeywordCandidates, 1);
  assert.equal(report.summary.newApproved, 0);
  assert.equal(report.summary.newImplemented, 0);
  assert.equal(report.summary.coveredPrefectures, 1);
  assert.equal(report.summary.blockedGroups, 0);
  assert.deepEqual(state, originalState);
  assert.equal(report.targets[2].discoveryStatus, 'candidate');
  assert.deepEqual(report.targets[2].blockerCodes, ['licenseUnknown']);
});

test('invalid and unknown deep attestations do not count as keyword reviews or reject candidates', () => {
  const manifest = {prefectures: [], targets: [{id: 'known', name: 'Known', kind: 'operator', roles: []}]};
  const state = {targets: {known: {status: 'candidate', resourceUrls: ['raw']}}, resources: {raw: {status: 'candidate'}}};
  const report = buildReport(manifest, state, [
    {targetId: 'unknown', deepReviewedAt: '2026-10-01', rawUrl: 'raw', verdict: 'blocked'},
    {targetId: 'known', deepReviewedAt: 'invalid', rawUrl: 'raw', verdict: 'blocked'},
  ]);
  assert.equal(report.targets[0].deepReview, null);
  assert.equal(report.targets[0].coverage, 'candidate');
  assert.equal(report.summary.deepReviewedGroups, 0);
  assert.equal(report.summary.individuallyReviewedCandidates, 0);
  assert.equal(report.summary.rejectedKeywordCandidates, 0);
});

test('pending group attestations cannot inflate completed or legacy keyword metrics', () => {
  const manifest = {prefectures: [], targets: [{id: 'known', name: 'Known', kind: 'operator', roles: []}]};
  const state = {targets: {known: {status: 'candidate', resourceUrls: ['raw']}}, resources: {raw: {status: 'candidate'}}};
  const report = buildReport(manifest, state, [
    {targetId: 'known', deepReviewed: false, followupAttemptedAt: '2026-10-01', rawUrl: 'raw', verdict: 'blocked'},
    {targetId: 'known', deepReviewed: false, deepReviewedAt: '2026-10-02', rawUrl: 'raw', verdict: 'approved', implementedSourceId: 'fake'},
    {targetId: 'known', followupAttemptedAt: '2026-10-01', rawUrl: 'raw', verdict: 'blocked'},
    {deepReviewed: false, rawUrl: 'raw', verdict: 'blocked'},
  ]);
  assert.equal(report.targets[0].deepReview, null);
  assert.equal(report.targets[0].coverage, 'candidate');
  for (const metric of ['deepReviewedGroups', 'deepBlockedGroups', 'deepApprovedGroups', 'deepImplementedGroups',
    'individuallyReviewedCandidates', 'rejectedKeywordCandidates', 'newApproved', 'newImplemented']) {
    assert.equal(report.summary[metric], 0, metric);
  }
});
