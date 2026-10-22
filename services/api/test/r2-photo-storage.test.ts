import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'fast-png';
import { reportsD1 } from './support/sqlite-d1.ts';
import { MockPhotoR2, pause } from './support/photo-r2.ts';
import { createReport, minimizeAfter } from '../src/reports/create.ts';
import { CURRENT_REPORT_TERMS } from '../src/reports/terms.ts';
import { attachEvidencePhoto, cleanupEvidencePhotos } from '../src/reports/photos.ts';
import { R2EvidencePhotoStorage, PHOTO_ERASURE_LEAD_MS } from '../src/reports/r2-photo-storage.ts';
import { sanitizeEvidencePhoto } from '../src/reports/photo-sanitizer.ts';
import { applyReportRetention } from '../src/reports/retention.ts';
import { runRetentionMaintenance } from '../src/reports/retention-automation.ts';
import { dispatchScheduled } from '../src/scheduled.ts';
import { PHOTO_RETENTION_CRON, PHOTO_STORAGE_POLICY } from '../src/reports/photo-policy.ts';
import { isoSeconds, type Db, type DbStatement } from '../src/db.ts';

const now = new Date('2026-10-01T00:00:00Z');
async function setup() {
  const db = reportsD1(), r2 = new MockPhotoR2();
  let time = now;
  const storage = new R2EvidencePhotoStorage(r2.bucket, db, () => time);
  const submitterHash = 'a'.repeat(64);
  const report = await createReport(db, { schemaVersion: 1, type: 'exists', spotId: 'sp_01V64NN31G72E5KJJ5W22W1A1J', installId: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version }, { now, attestationStatus: 'verified', submitterHash });
  const bytes = encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([1, 2, 3, 255]), text: { GPS: '35,139', Device: 'PRIVATE_DEVICE', Timestamp: '2026-10-01' } });
  const image = await sanitizeEvidencePhoto(bytes, 'image/png');
  const input = { reportId: report.reportId, submitterHash, idempotencyKey: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version, bytes, mediaType: 'image/png' };
  const opts = { now, enabled: true, photoTermsCovered: () => true };
  return { db, r2, storage, input, image, opts, setTime: (date: Date) => { time = date; }, attach: () => attachEvidencePhoto(db, storage, input, opts) };
}
function keyOf(x: Awaited<ReturnType<typeof setup>>) {
  return x.db.raw.prepare('SELECT storage_key FROM community_evidence_photos').get()!.storage_key as string;
}
function marker(x: Awaited<ReturnType<typeof setup>>, key: string) {
  assert.equal(x.r2.objects.get(key)?.size, 0);
  assert.deepEqual(x.r2.objects.get(key)?.customMetadata, { kind: 'deleted-photo.v1' });
}

test('identical concurrent uploads and retries preserve one private sanitized derivative', async () => {
  const x = await setup();
  const replies = await Promise.all([x.attach(), x.attach()]);
  assert.deepEqual(replies[0], replies[1]);
  assert.deepEqual(await x.attach(), replies[0]);
  assert.equal(x.r2.objects.size, 1);
  const object = x.r2.objects.get(keyOf(x))!;
  assert.deepEqual(object.bytes, x.image.bytes);
  assert.notDeepEqual(object.bytes, x.input.bytes);
  for (const privateText of ['GPS', 'PRIVATE_DEVICE', 'Timestamp']) {
    assert.equal(Buffer.from(object.bytes).includes(Buffer.from(privateText)), false);
  }
  assert.deepEqual(Object.keys(object.customMetadata).sort(), ['deleteAfter', 'height', 'kind', 'sha256', 'width']);
  assert.deepEqual(object.httpMetadata, { contentType: 'image/png', cacheControl: 'private, no-store' });
  assert.equal(replies[0].state, 'pending');
  assert.deepEqual(Object.keys(replies[0]).sort(), ['photoId', 'reportId', 'state']);
});

test('an existing different object is never overwritten and invalid bytes or reservations fail closed', async () => {
  const x = await setup();
  await x.attach();
  const key = keyOf(x), object = x.r2.objects.get(key)!;
  object.customMetadata.sha256 = 'b'.repeat(64);
  await assert.rejects(x.storage.put(key, x.image.bytes, x.image), /photo storage unavailable/);
  assert.equal(x.r2.objects.get(key), object);
  await assert.rejects(x.storage.put(key, new Uint8Array([9]), x.image));
  await assert.rejects(x.storage.put(`private/evidence/${crypto.randomUUID()}.png`, x.image.bytes, x.image));
  await assert.rejects(x.storage.put('public/photo.png', x.image.bytes, x.image));
});

test('delete racing a delayed PUT fences commit and future writes across adapter instances', async () => {
  const x = await setup(), gate = pause();
  x.r2.beforeCommit = async (_key, isMarker) => { if (!isMarker) await gate.wait(); };
  const pending = assert.rejects(x.attach(), /photo storage unavailable/);
  await gate.started;
  const key = keyOf(x);
  await x.storage.delete(key);
  gate.release();
  await pending;
  marker(x, key);
  const restarted = new R2EvidencePhotoStorage(x.r2.bucket, x.db, () => now);
  await assert.rejects(restarted.put(key, x.image.bytes, x.image));
  await restarted.delete(key);
  marker(x, key);
});

test('PUT before DELETE is erased and an uncertain PUT acknowledgement reconciles idempotently', async () => {
  const x = await setup();
  x.r2.failAfterCommit = true;
  await assert.rejects(x.attach(), /^Error: photo storage unavailable$/);
  assert.equal(x.r2.objects.size, 1);
  x.r2.failAfterCommit = false;
  await x.attach();
  const key = keyOf(x);
  await x.storage.delete(key);
  await x.storage.delete(key);
  marker(x, key);
  assert.equal(await x.storage.getMetadata(key), null);
});

test('uncertain deletion keeps durable diagnostic work until a later successful retry', async () => {
  const x = await setup();
  await x.attach();
  const key = keyOf(x);
  x.db.raw.prepare('DELETE FROM reports WHERE report_id=?').run(x.input.reportId);
  x.r2.failAfterCommit = true;
  await assert.rejects(cleanupEvidencePhotos(x.db, x.storage, { now }), /photo deletion incomplete/);
  marker(x, key);
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM community_photo_deletions').get()!.n, 1);
  assert.equal(x.db.raw.prepare('SELECT attempts FROM community_photo_deletion_attempts').get()!.attempts, 1);
  x.r2.failAfterCommit = false;
  assert.equal((await cleanupEvidencePhotos(x.db, x.storage, { now })).deleted, 1);
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM community_photo_deletions').get()!.n, 0);
  await assert.rejects(new R2EvidencePhotoStorage(x.r2.bucket, x.db, () => now).put(key, x.image.bytes, x.image));
});

test('live expiry blocks a PUT that crosses its upload deadline and cleanup fences its orphan', async () => {
  const x = await setup(), gate = pause();
  x.r2.beforeCommit = async (_key, isMarker) => { if (!isMarker) await gate.wait(); };
  const pending = assert.rejects(x.attach(), /photo storage unavailable/);
  await gate.started;
  const key = keyOf(x), expired = new Date(now.getTime() + 16 * 60_000);
  x.setTime(expired);
  gate.release();
  await pending;
  marker(x, key);
  await cleanupEvidencePhotos(x.db, x.storage, { now: expired });
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM community_evidence_photos').get()!.n, 0);
  marker(x, key);
});

test('parent deletion while upload is in flight cannot accept or retain the image', async () => {
  const x = await setup(), gate = pause();
  x.r2.beforeCommit = async (_key, isMarker) => { if (!isMarker) await gate.wait(); };
  const pending = assert.rejects(x.attach(), /photo storage unavailable/);
  await gate.started;
  const key = keyOf(x);
  x.db.raw.prepare('DELETE FROM reports WHERE report_id=?').run(x.input.reportId);
  gate.release();
  await pending;
  marker(x, key);
  assert.equal(await x.storage.getMetadata(key), null);
  await cleanupEvidencePhotos(x.db, x.storage, { now });
  marker(x, key);
});

test('early erasure starts a day before 90-day deadline and parent redaction preserves fences', async () => {
  const x = await setup();
  await x.attach();
  const key = keyOf(x), deadline = minimizeAfter(now);
  const early = new Date(deadline.getTime() - PHOTO_ERASURE_LEAD_MS);
  x.setTime(new Date(early.getTime() - 1000));
  assert.ok(await x.storage.getMetadata(key));
  x.setTime(early);
  assert.equal(await x.storage.getMetadata(key), null);
  await assert.rejects(x.attach());
  await cleanupEvidencePhotos(x.db, x.storage, { now: early });
  marker(x, key);
  x.setTime(deadline);
  await applyReportRetention(x.db, { now: deadline, photoStorage: x.storage });
  assert.ok(x.db.raw.prepare('SELECT redacted_at FROM reports').get()!.redacted_at);
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM community_photo_requests').get()!.n, 0);
  marker(x, key);
});

test('storage unavailable before commit leaves a recoverable timed reservation', async () => {
  const x = await setup();
  x.r2.failBeforeCommit = true;
  await assert.rejects(x.attach());
  assert.equal(x.r2.objects.size, 0);
  assert.equal(x.db.raw.prepare('SELECT lifecycle FROM community_evidence_photos').get()!.lifecycle, 'uploading');
  x.r2.failBeforeCommit = false;
  await x.attach();
  assert.equal(x.db.raw.prepare('SELECT lifecycle FROM community_evidence_photos').get()!.lifecycle, 'ready');
});

const zeroRetention = { dueReports: 0, expiredRateWindows: 0, expiredChallenges: 0, inconsistentReceipts: 0, pendingPhotoCleanup: 0 };

test('worst-case photo retention counts every SQL execution and R2 fence within 50 subrequests', async () => {
  const x = await setup();
  await x.attach();
  const deadline = minimizeAfter(now);
  for (let i = 0; i < 5; i++) {
    const reportId = i === 0 ? x.input.reportId : (await createReport(x.db, {
      schemaVersion: 1, type: 'exists', spotId: 'sp_01V64NN31G72E5KJJ5W22W1A1J', installId: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version,
    }, { now, attestationStatus: 'verified', submitterHash: 'a'.repeat(64) })).reportId;
    if (i > 0) await attachEvidencePhoto(x.db, x.storage, { ...x.input, reportId, idempotencyKey: crypto.randomUUID() }, x.opts);
    x.db.raw.prepare('INSERT INTO report_idempotency VALUES(?,?,?,?,NULL)').run(String(i).padStart(64, '0'), reportId, 'b'.repeat(64), isoSeconds(now));
    x.db.raw.prepare("INSERT INTO report_rate_windows VALUES (?, 'hour', ?, 1, ?)").run(String(i).padStart(64, '0'), isoSeconds(now), isoSeconds(deadline));
    x.db.raw.prepare("INSERT INTO app_attest_challenges VALUES (?, 'registration', NULL, ?, ?, NULL)").run(String(i).padStart(43, 'A') + '=', isoSeconds(now), isoSeconds(deadline));
  }
  let sqlExecutions = 0, r2Writes = 0;
  const originals = new WeakMap<DbStatement, DbStatement>();
  const limits: number[] = [];
  const counted: Db = {
    prepare(sql) {
      const wrap = (statement: DbStatement): DbStatement => {
        const result: DbStatement = {
          bind: (...values) => { if (/LIMIT \?/.test(sql)) limits.push(values.at(-1) as number); return wrap(statement.bind(...values)); },
          first: async <T>() => { sqlExecutions++; return statement.first<T>(); },
          all: async <T>() => { sqlExecutions++; return statement.all<T>(); },
          run: async () => { sqlExecutions++; return statement.run(); },
        };
        originals.set(result, statement);
        return result;
      };
      return wrap(x.db.prepare(sql));
    },
    async batch(statements) {
      sqlExecutions += statements.length;
      return x.db.batch(statements.map(statement => originals.get(statement)!));
    },
  };
  const put = x.r2.bucket.put;
  const bucket = { ...x.r2.bucket, put: ((...args: Parameters<typeof put>) => { r2Writes++; return put(...args); }) as typeof put };
  const storage = new R2EvidencePhotoStorage(bucket, counted, () => deadline);
  const result = await runRetentionMaintenance(counted, { now: deadline, mode: 'cleanup', photoStorage: storage });
  assert.equal(result.outcome, 'complete');
  assert.deepEqual(result.remaining, zeroRetention);
  assert.equal(r2Writes, 5);
  assert.equal(sqlExecutions, 39);
  assert.ok(sqlExecutions + r2Writes <= 50);
  assert.deepEqual(limits, [6, 6, 6, 5, 6]);
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM reports WHERE redacted_at IS NOT NULL').get()!.n, 5);
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM report_idempotency WHERE retired_at IS NOT NULL AND request_sha256 IS NULL').get()!.n, 5);
  for (const table of ['report_rate_windows', 'app_attest_challenges', 'community_evidence_photos', 'community_photo_deletions', 'community_photo_deletion_attempts']) {
    assert.equal(x.db.raw.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0);
  }
});

test('a failed deletion does not block another selected key and diagnostics cascade on recovery', async () => {
  const x = await setup();
  await x.attach();
  await attachEvidencePhoto(x.db, x.storage, { ...x.input, idempotencyKey: crypto.randomUUID(), bytes: encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([9, 2, 3, 255]) }) }, x.opts);
  const keys = x.db.raw.prepare('SELECT storage_key FROM community_evidence_photos ORDER BY storage_key').all().map(row => row.storage_key as string);
  x.db.raw.prepare('DELETE FROM reports WHERE report_id=?').run(x.input.reportId);
  x.r2.beforeCommit = async (key) => { if (key === keys[0]) throw Error('private-key-failure'); };
  const result = await runRetentionMaintenance(x.db, { now, mode: 'cleanup', photoStorage: x.storage });
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.remaining, { ...zeroRetention, pendingPhotoCleanup: 1 });
  marker(x, keys[1]);
  assert.equal(x.db.raw.prepare('SELECT storage_key FROM community_photo_deletions').get()!.storage_key, keys[0]);
  assert.equal(x.db.raw.prepare('SELECT attempts FROM community_photo_deletion_attempts').get()!.attempts, 1);
  x.r2.beforeCommit = undefined;
  assert.equal((await runRetentionMaintenance(x.db, { now, mode: 'cleanup', photoStorage: x.storage })).outcome, 'complete');
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM community_photo_deletion_attempts').get()!.n, 0);
  marker(x, keys[0]);
});

test('scheduled photo maintenance monitors without mutation, fails visibly, recovers, and never touches canonical DB', async () => {
  const x = await setup();
  await x.attach();
  const key = keyOf(x), deadline = minimizeAfter(now);
  const tripwire: Db = { prepare() { assert.fail('canonical DB accessed'); }, async batch() { assert.fail('canonical DB accessed'); } };
  const logs: string[] = [];
  const deps = { now: () => deadline, source: async () => { assert.fail('source scheduler accessed'); }, log: (value: string) => { logs.push(value); } };
  const env = { DB: tripwire, REPORTS_DB: x.db, PRIVATE_PHOTOS: x.r2.bucket, PHOTO_STORAGE_POLICY, REPORT_RETENTION_CRON: PHOTO_RETENTION_CRON, REPORT_RETENTION: 'monitor' };
  const controller = { cron: PHOTO_RETENTION_CRON, scheduledTime: 0, noRetry() {} } as ScheduledController;
  await assert.rejects(dispatchScheduled(controller, env, deps), /incomplete/);
  assert.equal(JSON.parse(logs.at(-1)!).outcome, 'overdue');
  assert.equal(JSON.parse(logs.at(-1)!).batches, 0);
  assert.equal(x.r2.objects.get(key)!.customMetadata.kind, 'sanitized-photo.v1');
  assert.equal(x.db.raw.prepare('SELECT redacted_at FROM reports').get()!.redacted_at, null);
  env.REPORT_RETENTION = 'cleanup';
  x.r2.failBeforeCommit = true;
  await assert.rejects(dispatchScheduled(controller, env, deps), /incomplete/);
  assert.equal(JSON.parse(logs.at(-1)!).outcome, 'failed');
  assert.deepEqual(JSON.parse(logs.at(-1)!).remaining, { ...zeroRetention, pendingPhotoCleanup: 1 });
  x.r2.failBeforeCommit = false;
  await dispatchScheduled(controller, env, deps);
  assert.equal(JSON.parse(logs.at(-1)!).outcome, 'complete');
  assert.deepEqual(JSON.parse(logs.at(-1)!).remaining, zeroRetention);
  marker(x, key);
  assert.equal(x.db.raw.prepare('SELECT count(*) n FROM community_photo_deletion_attempts').get()!.n, 0);
  for (const log of logs) {
    assert.equal(log.includes(key), false);
    assert.equal(log.includes(x.input.reportId), false);
    assert.equal(log.includes('private bucket'), false);
  }
});
