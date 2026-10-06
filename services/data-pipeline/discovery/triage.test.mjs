import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualReviewTriage} from './evaluator.mjs';
import {buildReport, markdownReport} from './report.mjs';

const resource = {rawUrl: 'https://municipal.example/raw.csv', status: 'candidate', matchingRowCount: 2};
const review = {approvalGate: {exactDataset: resource.rawUrl, exactApplicableLicense: true,
  redistributionAllowed: true, derivationAllowed: true,
  publisherCoordinates: true, currentOperationEvidence: true}};
const licensed = {...resource, licenseMetadata: 'Publisher terms', attributionMetadata: 'Publisher attribution'};

test('ordinary pages remain rights and coordinates unknown for Fuchu, Urayasu and Ebina examples', () => {
  for (const jurisdiction of ['府中市', '浦安市', '海老名市']) {
    const result = manualReviewTriage({...resource, jurisdiction, licenseMetadata: 'CC BY catalog elsewhere'});
    assert.equal(result.classification, 'RIGHTS_AND_COORDINATES_UNKNOWN');
    assert.equal(result.priority, 'P2');
    assert.equal(result.rights, 'unknown');
    assert.equal(result.coordinates, 'unknown');
  }
});

test('explicit scoped rights with missing coordinates is P1', () => {
  assert.equal(manualReviewTriage(licensed, {review}).classification, 'COORDINATES_UNKNOWN');
  assert.equal(manualReviewTriage(licensed, {review}).priority, 'P1');
});

test('available coordinates do not establish rights or publisher smoking Point evidence', () => {
  const result = manualReviewTriage({...resource, coordinateAvailability: 'all', geometryTypes: ['Point']});
  assert.equal(result.classification, 'RIGHTS_UNKNOWN');
  assert.equal(result.priority, 'P1');
  assert.equal(result.smokingEvidence, 'keyword-signal');
  assert.equal(manualReviewTriage({...resource, coordinateAvailability: 'partial'}).coordinates, 'unknown');
  assert.equal(manualReviewTriage({...resource, coordinateAvailability: 'all', blockerCodes: ['coordinatesMissing']}).coordinates, 'unknown');
});

test('Narashino external referral, access and format blockers are low priority', () => {
  for (const [extra, classification] of [
    [{externalReferenceOnly: true}, 'EXTERNAL_REFERENCE_ONLY'],
    [{blockerCodes: ['externalReferenceOnly']}, 'EXTERNAL_REFERENCE_ONLY'],
    [{fetchStatus: 403}, 'ACCESS_BLOCKED'],
    [{blockerCodes: ['accessBlocked']}, 'ACCESS_BLOCKED'],
    [{blockerCodes: ['incompatibleFormat']}, 'FORMAT_BLOCKED'],
    [{matchingRowCount: 0}, 'NO_SMOKING_POINT_EVIDENCE'],
    [{blockerCodes: ['polygonOnly']}, 'NO_SMOKING_POINT_EVIDENCE'],
  ]) {
    const result = manualReviewTriage({...licensed, coordinateAvailability: 'all', ...extra}, {review});
    assert.equal(result.classification, classification);
    assert.equal(result.priority, 'P3');
  }
});

test('reviewed target identity never approves new resources under that municipality', () => {
  const context = {reviewedSourceIds: ['existing-source']};
  assert.equal(manualReviewTriage({}, {...context, targetOnly: true}).classification, 'ALREADY_IMPLEMENTED');
  assert.equal(manualReviewTriage(resource, context).classification, 'RIGHTS_AND_COORDINATES_UNKNOWN');
});

test('fully promising scoped signals order review without automatic approval or input mutation', () => {
  const input = {...licensed, coordinateAvailability: 'all'};
  const original = structuredClone(input);
  const result = manualReviewTriage(input, {review});
  assert.equal(result.classification, 'READY_FOR_RIGHTS_REVIEW');
  assert.equal(result.priority, 'P0');
  assert.equal(result.approvalAutomated, false);
  assert.equal(result.status, undefined);
  assert.deepEqual(input, original);
  assert.equal(manualReviewTriage({...input, truncated: true}, {review}).priority, 'P1');
  assert.equal(manualReviewTriage(input, {review: {...review, verdict: 'blocked'}}).priority, 'P3');
});

test('textual, false, missing and wrong-resource gate values cannot confirm rights', () => {
  for (const exactApplicableLicense of [undefined, null, false, 'CC BY 4.0', 'unreviewed', 'true']) {
    const result = manualReviewTriage(licensed, {review: {approvalGate: {...review.approvalGate, exactApplicableLicense}}});
    assert.equal(result.rights, 'unknown');
    assert.equal(result.approvalAutomated, false);
  }
  assert.equal(manualReviewTriage(licensed, {review: {approvalGate: {...review.approvalGate, exactDataset: 'other'}}}).rights, 'unknown');
  assert.equal(manualReviewTriage({...licensed, attributionMetadata: null}, {review}).rights, 'unknown');
  assert.equal(manualReviewTriage({...licensed, blockerCodes: ['licenseUnknown']}, {review}).rights, 'unknown');
  assert.equal(manualReviewTriage(licensed, {review: {approvalGate: {...review.approvalGate, redistributionAllowed: false}}}).rights, 'unknown');
  for (const field of ['redistributionAllowed', 'derivationAllowed']) {
    for (const value of [undefined, null, false, 'true', 'unreviewed']) {
      assert.equal(manualReviewTriage(licensed, {review: {approvalGate: {...review.approvalGate, [field]: value}}}).rights, 'unknown');
    }
  }
  assert.equal(manualReviewTriage(licensed, {review: {approvalGate: {
    exactDataset: 'Deep review complete', exactApplicableLicense: 'CC BY 4.0',
    redistributionAllowed: 'allowed', derivationAllowed: 'allowed', publisherCoordinates: 'available',
    currentOperationEvidence: 'reviewed',
  }}}).rights, 'unknown');
  assert.equal(manualReviewTriage({}).classification, 'MANUAL_REVIEW_REQUIRED');
});

test('cache-only report queue preserves coverage and covers linked, orphan and missing resources', () => {
  const manifest = {prefectures: [], targets: [
    {id: 'city', name: 'City', roles: [], reviewedSourceIds: ['existing']},
    {id: 'missing', name: 'Missing', roles: []},
  ]};
  const state = {targets: {city: {status: 'candidate', resourceUrls: [resource.rawUrl, 'missing-url']}},
    resources: {[resource.rawUrl]: {...licensed, coordinateAvailability: 'all'}, orphan: {externalReferenceOnly: true}}};
  const original = structuredClone(state);
  const report = buildReport(manifest, state);
  assert.equal(report.targets[0].coverage, 'covered');
  assert.equal(report.summary.newApproved, 0);
  assert.equal(report.summary.newImplemented, 0);
  assert.equal(report.manualReviewQueue.length, 5);
  assert.ok(report.manualReviewQueue.every(item => item.approvalAutomated === false));
  assert.equal(report.manualReviewQueue.find(item => item.candidate === 'orphan').classification, 'EXTERNAL_REFERENCE_ONLY');
  assert.match(markdownReport(report), /## Manual review queue/);
  assert.match(markdownReport(report), /never publication or implementation approval/);
  assert.deepEqual(state, original);
  const rejected = buildReport(manifest, state, [{rawUrl: resource.rawUrl, verdict: 'blocked'}]);
  assert.equal(rejected.manualReviewQueue.find(item => item.candidate === resource.rawUrl).priority, 'P3');
});

test('report scopes dated review gates to the exact resource and never changes coverage', () => {
  const manifest = {prefectures: [], targets: [{id: 'city', name: 'City', roles: []}]};
  const otherUrl = 'https://municipal.example/other.csv';
  const state = {targets: {city: {status: 'candidate', resourceUrls: [resource.rawUrl, otherUrl]}},
    resources: {[resource.rawUrl]: {...licensed, coordinateAvailability: 'all'},
      [otherUrl]: {...licensed, coordinateAvailability: 'all'}}};
  const dated = {...review, targetId: 'city', deepReviewedAt: '2026-10-06T00:00:00Z', verdict: 'candidate'};
  const report = buildReport(manifest, state, [dated]);
  assert.equal(report.manualReviewQueue.find(item => item.candidate === resource.rawUrl).priority, 'P0');
  assert.equal(report.manualReviewQueue.find(item => item.candidate === otherUrl).rights, 'unknown');
  assert.equal(report.targets[0].coverage, 'candidate');
  assert.equal(report.summary.newApproved, 0);
  assert.equal(buildReport(manifest, state, [{...dated, deepReviewedAt: 'invalid'}])
    .manualReviewQueue.find(item => item.candidate === resource.rawUrl).rights, 'unknown');
  const truncated = structuredClone(state);
  truncated.targets.city.truncated = true;
  assert.equal(buildReport(manifest, truncated, [dated]).manualReviewQueue
    .find(item => item.candidate === resource.rawUrl).priority, 'P1');
  for (const statusCode of [401, 403, 429]) {
    const inaccessible = structuredClone(state);
    inaccessible.resources[resource.rawUrl].statusCode = statusCode;
    const item = buildReport(manifest, inaccessible, [dated]).manualReviewQueue
      .find(item => item.candidate === resource.rawUrl);
    assert.equal(item.classification, 'ACCESS_BLOCKED');
    assert.equal(item.priority, 'P3');
  }
});
