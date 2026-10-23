import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'fast-png';
import { reportsD1 } from './support/sqlite-d1.ts';
import { createReport, minimizeAfter } from '../src/reports/create.ts';
import { CURRENT_REPORT_TERMS } from '../src/reports/terms.ts';
import { attachEvidencePhoto, moderateEvidencePhoto } from '../src/reports/photos.ts';
import { MemoryEvidencePhotoStorage, PHOTO_ERASURE_LEAD_MS } from '../src/reports/photo-storage.ts';
import { MAX_PRIVATE_PHOTO_BYTES, PrivatePhotoViewError, R2PrivatePhotoReader, readPrivateEvidencePhoto, type PrivatePhotoReader } from '../src/reports/private-photo-view.ts';

const now = new Date('2026-10-01T00:00:00Z');
const unavailable = (error: unknown) => error instanceof PrivatePhotoViewError && error.status === 404;
async function setup() {
  const db = reportsD1(), storage = new MemoryEvidencePhotoStorage();
  const report = await createReport(db, { schemaVersion: 1, type: 'exists', spotId: 'sp_01V64NN31G72E5KJJ5W22W1A1J', installId: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version }, { now, attestationStatus: 'verified', submitterHash: 'a'.repeat(64) });
  const photo = await attachEvidencePhoto(db, storage, { reportId: report.reportId, submitterHash: 'a'.repeat(64), idempotencyKey: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version, bytes: encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([1, 2, 3, 255]) }), mediaType: 'image/png' }, { now, enabled: true, photoTermsCovered: () => true });
  const [key, object] = [...storage.objects][0];
  const reader: PrivatePhotoReader = { read: async () => object.bytes.slice() };
  return { db, storage, report, photo, key, object, reader };
}
test('private pending and approved sanitized PNG can be read without changing any state', async () => {
  const x = await setup();
  const result = await readPrivateEvidencePhoto(x.db, x.reader, x.photo.photoId, () => now);
  assert.equal(result.mediaType, 'image/png');
  assert.deepEqual(result.bytes, x.object.bytes);
  await moderateEvidencePhoto(x.db, x.photo.photoId, 'approved', { now, decidedBy: 'operator', reason: 'usableEvidence' });
  assert.deepEqual((await readPrivateEvidencePhoto(x.db, x.reader, x.photo.photoId, () => now)).bytes, result.bytes);
  assert.equal(x.db.raw.prepare("SELECT count(*) n FROM sqlite_master WHERE name='spots'").get()?.n, 0);
});
test('missing, expired, uploading, rejected and deletion-queued photos fail before storage access', async () => {
  for (const state of ['missing', 'expired', 'uploading', 'rejected', 'queued']) {
    const x = await setup();
    if (state === 'uploading') {
      x.db.raw.exec('DROP TRIGGER community_photos_lifecycle');
      x.db.raw.prepare("UPDATE community_evidence_photos SET lifecycle='uploading'").run();
    }
    if (state === 'rejected') await moderateEvidencePhoto(x.db, x.photo.photoId, 'rejected', { now, decidedBy: 'operator', reason: 'privacyRisk' });
    if (state === 'queued') x.db.raw.prepare('INSERT INTO community_photo_deletions VALUES(?,?)').run(x.key, now.toISOString());
    let reads = 0;
    await assert.rejects(readPrivateEvidencePhoto(x.db, { read: async () => { reads++; return x.object.bytes; } }, state === 'missing' ? 'unknown' : x.photo.photoId, () => state === 'expired' ? minimizeAfter(now) : now), unavailable);
    assert.equal(reads, 0);
  }
});
test('expiry, parent redaction/deletion and deletion fence during fetch fail closed', async () => {
  for (const race of ['expiry', 'redaction', 'deletion', 'fence']) {
    const x = await setup(); let time = now;
    const reader: PrivatePhotoReader = { read: async () => {
      if (race === 'expiry') time = minimizeAfter(now);
      if (race === 'redaction') x.db.raw.prepare('UPDATE reports SET redacted_at=?,submitter_hash=NULL,note=NULL,observed_on=NULL,proposed_latitude=NULL,proposed_longitude=NULL WHERE report_id=?').run(now.toISOString(), x.report.reportId);
      if (race === 'deletion') x.db.raw.prepare('DELETE FROM reports WHERE report_id=?').run(x.report.reportId);
      if (race === 'fence') x.db.raw.prepare('INSERT INTO community_photo_deletions VALUES(?,?)').run(x.key, now.toISOString());
      return x.object.bytes;
    } };
    await assert.rejects(readPrivateEvidencePhoto(x.db, reader, x.photo.photoId, () => time), unavailable);
  }
});
test('missing objects, corrupt bytes, wrong length and storage failures are typed and sanitized', async () => {
  const x = await setup();
  for (const bytes of [null, new Uint8Array(x.object.bytes.length), x.object.bytes.slice(0, -1), new Uint8Array(MAX_PRIVATE_PHOTO_BYTES + 1)]) {
    await assert.rejects(readPrivateEvidencePhoto(x.db, { read: async () => bytes }, x.photo.photoId, () => now), (error: unknown) => error instanceof PrivatePhotoViewError && ['photoObjectMissing', 'photoInvalidBody'].includes(error.code));
  }
  const tampered = x.object.bytes.slice(); tampered[20] ^= 1;
  await assert.rejects(readPrivateEvidencePhoto(x.db, { read: async () => tampered }, x.photo.photoId, () => now), (error: unknown) => error instanceof PrivatePhotoViewError && error.code === 'photoInvalidBody');
  await assert.rejects(readPrivateEvidencePhoto(x.db, { read: async () => { throw Error('private key or payload'); } }, x.photo.photoId, () => now), (error: unknown) => error instanceof PrivatePhotoViewError && !error.message.includes('private key'));
});
test('private viewing stops exactly 24 hours before retention, including a boundary crossed during reading', async () => {
  const x=await setup();
  const boundary=minimizeAfter(now).getTime()-PHOTO_ERASURE_LEAD_MS;
  assert.ok((await readPrivateEvidencePhoto(x.db,x.reader,x.photo.photoId,()=>new Date(boundary-1000))).bytes.length);
  for(const offset of [0,1000]){
    let reads=0;
    await assert.rejects(readPrivateEvidencePhoto(x.db,{read:async()=>{reads++;return x.object.bytes;}},x.photo.photoId,()=>new Date(boundary+offset)),unavailable);
    assert.equal(reads,0,'cleanup need not have run for erasure to fence viewing');
  }
  let time=new Date(boundary-1000);
  await assert.rejects(readPrivateEvidencePhoto(x.db,{read:async()=>{time=new Date(boundary);return x.object.bytes;}},x.photo.photoId,()=>time),unavailable);
});
test('read-only R2 reader bounds declared and streamed sizes and cancels oversized bodies', async () => {
  let cancelled = false;
  const oversized = new R2PrivatePhotoReader({ get: async () => ({ size: 20, body: new ReadableStream({ cancel() { cancelled = true; } }) }) });
  await assert.rejects(oversized.read('opaque-key', 10), PrivatePhotoViewError);
  assert.equal(cancelled, true);
  cancelled = false;
  const streamed = new R2PrivatePhotoReader({ get: async () => ({ size: 4, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } }) }) });
  await assert.rejects(streamed.read('opaque-key', 4), PrivatePhotoViewError);
  assert.equal(cancelled, true);
  const good = new R2PrivatePhotoReader({ get: async () => ({ size: 4, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close(); } }) }) });
  assert.deepEqual(await good.read('opaque-key', 4), new Uint8Array([1, 2, 3, 4]));
  assert.equal(await new R2PrivatePhotoReader({ get: async () => null }).read('missing', 4), null);
});
