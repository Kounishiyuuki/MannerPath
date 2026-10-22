import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminDemo } from '../scripts/admin/demo.ts';
import { applyAdminDecision, getAdminReport, type AdminDecision } from '../src/reports/admin-review.ts';
import { createReport } from '../src/reports/create.ts';
import { setReconciliationState } from '../src/reports/moderation.ts';
import { newSpotPhotoGate } from '../src/reports/photos.ts';
import { exportReview, proposeNewSpotReview } from '../src/reports/review.ts';
import { CURRENT_REPORT_TERMS } from '../src/reports/terms.ts';

const NOW = new Date('2026-10-22T12:00:00Z');
type Demo = Awaited<ReturnType<typeof createAdminDemo>>;
async function decide(demo: Demo, reportId: string, extra: Partial<AdminDecision>, at = NOW) {
  return applyAdminDecision(demo.reports, {
    reportId, state: 'accepted', reason: 'confirmed', privacyChecked: true,
    decidedBy: 'integration-reviewer', operationId: crypto.randomUUID(),
    expectedVersion: (await getAdminReport(demo.reports, reportId, at)).version, ...extra,
  }, at);
}
async function approve(demo: Demo, reportId: string, at = NOW) {
  const photo = (await getAdminReport(demo.reports, reportId, at)).photos[0];
  await decide(demo, reportId, {photoId: photo.photo_id, state: 'approved', reason: 'usableEvidence'}, at);
  return photo;
}
function canonicalSnapshot(demo: Demo) {
  return ['spots', 'tile_snapshots', 'tile_snapshot_spots'].map(table =>
    demo.canonical.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
const propose = (demo: Demo, id: string) => proposeNewSpotReview(demo.reports, {
  reportIds: [id], locationReportId: id, tier: 'communityReported', decidedBy: 'integration-reviewer', now: NOW,
});

test('real demo photo approval and report acceptance preserve canonical data and require explicit reconciliation', async () => {
  const demo = await createAdminDemo(NOW);
  try {
    const id = demo.ids[0], before = canonicalSnapshot(demo);
    assert.equal(await newSpotPhotoGate(demo.reports, id, NOW), 'pending');
    await approve(demo, id);
    assert.equal(await newSpotPhotoGate(demo.reports, id, NOW), 'approved');
    await assert.rejects(propose(demo, id), /accepted|queued/);
    await decide(demo, id, {});
    const detail = await getAdminReport(demo.reports, id, NOW);
    assert.equal(detail.report.reconciliation_state, 'notQueued');
    assert.equal(detail.publicationState, 'awaitingPublication');
    assert.equal(detail.publicationVerified, false);
    assert.equal(demo.reports.raw.prepare('SELECT count(*) n FROM report_reviews').get()?.n, 0);
    assert.deepEqual(canonicalSnapshot(demo), before);
    await assert.rejects(propose(demo, id), /queued/);
    await setReconciliationState(demo.reports, id, 'queued', NOW);
    await assert.rejects(proposeNewSpotReview(demo.reports, {
      reportIds: [id], locationReportId: id, decidedBy: 'integration-reviewer', now: NOW,
    }), /needs at least 2/);
    const reviewId = await propose(demo, id);
    assert.ok(reviewId);
    assert.equal(demo.reports.raw.prepare('SELECT count(*) n FROM report_reviews').get()?.n, 1);
    assert.deepEqual(canonicalSnapshot(demo), before);
  } finally { await demo.dispose(); }
});

test('withdrawn demo photo blocks proposal and export including the migration 0009 SQL guard', async () => {
  const demo = await createAdminDemo(NOW);
  try {
    const id = demo.ids[0], photo = await approve(demo, id), before = canonicalSnapshot(demo);
    await decide(demo, id, {});
    await setReconciliationState(demo.reports, id, 'queued', NOW);
    const reviewId = await propose(demo, id);
    demo.reports.raw.prepare("UPDATE community_evidence_photos SET lifecycle='deleting' WHERE photo_id=?").run(photo.photo_id);
    const otherId = demo.ids[1], otherPhoto = await approve(demo, otherId);
    await decide(demo, otherId, {});
    await setReconciliationState(demo.reports, otherId, 'queued', NOW);
    demo.reports.raw.prepare("UPDATE community_evidence_photos SET lifecycle='deleting' WHERE photo_id=?").run(otherPhoto.photo_id);
    await assert.rejects(propose(demo, otherId), /no approved evidence photo/);
    await assert.rejects(exportReview(demo.reports, reviewId, {now: NOW}), /no approved evidence photo/);
    assert.throws(() => demo.reports.raw.prepare("UPDATE report_reviews SET state='exported',artifact_sha256=?,exported_at=? WHERE review_id=?")
      .run('0'.repeat(64), NOW.toISOString().replace('.000Z', 'Z'), reviewId), /a new-spot report has no approved evidence photo/);
    assert.equal(demo.reports.raw.prepare('SELECT state FROM report_reviews WHERE review_id=?').get(reviewId)?.state, 'proposed');
    assert.equal(demo.reports.raw.prepare("SELECT count(*) n FROM report_moderation WHERE reconciliation_state='applied'").get()?.n, 0);
    assert.deepEqual(canonicalSnapshot(demo), before);
  } finally { await demo.dispose(); }
});

test('admin detail distinguishes zero, pending, rejected and expired photos and refuses acceptance without approval', async () => {
  const demo = await createAdminDemo(NOW);
  try {
    const empty = await createReport(demo.reports, {
      schemaVersion: 1, type: 'missing', installId: crypto.randomUUID(),
      acceptedTermsVersion: CURRENT_REPORT_TERMS.version, proposedLocation: {latitude: 35.714, longitude: 139.777},
    }, {now: NOW, attestationStatus: 'verified', submitterHash: 'a'.repeat(64)});
    assert.deepEqual((await getAdminReport(demo.reports, empty.reportId, NOW)).photos, []);
    assert.equal(await newSpotPhotoGate(demo.reports, empty.reportId, NOW), 'none');
    await assert.rejects(decide(demo, empty.reportId, {}), /approvedPhotoRequired/);
    const id = demo.ids[0], pending = (await getAdminReport(demo.reports, id, NOW)).photos[0];
    assert.equal(pending.moderation_status, 'pending');
    assert.equal(pending.previewAvailable, true);
    await assert.rejects(decide(demo, id, {}), /approvedPhotoRequired/);
    await decide(demo, id, {photoId: pending.photo_id, state: 'rejected', reason: 'privacyRisk'});
    const rejected = (await getAdminReport(demo.reports, id, NOW)).photos[0];
    assert.equal(rejected.moderation_status, 'rejected');
    assert.equal(rejected.lifecycle, 'deleting');
    assert.equal(rejected.previewAvailable, false);
    await assert.rejects(decide(demo, id, {}), /approvedPhotoRequired/);
    const expired = await getAdminReport(demo.reports, demo.ids[2], NOW);
    assert.equal(expired.photos[0].previewAvailable, false);
    assert.equal(await newSpotPhotoGate(demo.reports, demo.ids[2], NOW), 'expired');
    await assert.rejects(decide(demo, demo.ids[2], {}), /approvedPhotoRequired/);
  } finally { await demo.dispose(); }
});

for (const offset of [-1000, 0, 1000]) {
  test(`admin photo availability and decisions at early erasure boundary ${offset}ms`, async () => {
    const demo = await createAdminDemo(NOW);
    try {
      const pendingId = demo.ids[0], approvedId = demo.ids[1];
      const approvedPhoto = await approve(demo, approvedId);
      const original = (await getAdminReport(demo.reports, pendingId, NOW)).photos[0];
      const boundary = new Date(Date.parse(original.delete_after) - 24 * 60 * 60_000);
      const at = new Date(boundary.getTime() + offset);
      const acceptanceAt = new Date(Date.parse(approvedPhoto.delete_after) - 24 * 60 * 60_000 + offset);
      const detail = await getAdminReport(demo.reports, pendingId, at);
      assert.equal(detail.photos[0].delete_after, original.delete_after, 'immutable deadline is never rewritten');
      assert.equal(detail.photos[0].view_until, boundary.toISOString().replace('.000Z', 'Z'));
      assert.equal(detail.photos[0].previewAvailable, offset < 0);
      if (offset < 0) {
        await approve(demo, pendingId, at);
        await decide(demo, pendingId, {}, at);
        await decide(demo, approvedId, {}, acceptanceAt);
      } else {
        await assert.rejects(approve(demo, pendingId, at), /photoUnavailable/);
        await assert.rejects(decide(demo, approvedId, {}, acceptanceAt), /approvedPhotoRequired/);
      }
    } finally { await demo.dispose(); }
  });
}
