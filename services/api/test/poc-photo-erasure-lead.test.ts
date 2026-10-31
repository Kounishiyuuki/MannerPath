// PoC: the −9 day erasure lead for the D1 photo store, including storage failures, a D1 outage and resends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupEvidencePhotos, photoEvidenceStrength, moderateEvidencePhoto } from "../src/reports/photos.ts";
import { D1_PHOTO_ERASURE_LEAD_DAYS, queueDuePhotosForErasure } from "../src/poc/binary-photo/erasure.ts";
import { minimizeAfter } from "../src/reports/create.ts";
import { harness, photo } from "./support/binary-photo-harness.ts";

const DAY = 86_400_000;
const at = (deadline: Date, days: number, minutes = 0) => new Date(deadline.getTime() + days * DAY + minutes * 60_000);

test("photos are fenced at least 7 days before the 90-day deadline despite a day of failures and a D1 outage", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device);
  const sent = await h.send(reportId, await h.body(device, reportId, photo()));
  assert.equal(sent.status, 201);
  await moderateEvidencePhoto(h.reports, sent.json.photoId as string, "approved", { now: h.now, decidedBy: "reviewer", reason: "usableEvidence" });
  const deadline = minimizeAfter(h.now);
  const key = (h.reports.raw.prepare("SELECT storage_key FROM community_evidence_photos").get() as { storage_key: string }).storage_key;

  // One minute before the lead: nothing is queued and the photo still counts.
  assert.equal(await queueDuePhotosForErasure(h.reports, at(deadline, -D1_PHOTO_ERASURE_LEAD_DAYS, -1)), 0);
  assert.equal((await photoEvidenceStrength(h.reports, reportId, at(deadline, -D1_PHOTO_ERASURE_LEAD_DAYS, -1))).approvedPhotos, 1);

  // At the lead it is queued and immediately stops counting as evidence (review/export gates read the queue).
  const start = at(deadline, -D1_PHOTO_ERASURE_LEAD_DAYS);
  assert.equal(await queueDuePhotosForErasure(h.reports, start), 1);
  assert.equal((await photoEvidenceStrength(h.reports, reportId, start)).approvedPhotos, 0);

  // Day 1: PHOTOS_DB refuses every write (storage failure); every 5-minute pass fails loudly and keeps the job.
  const realDelete = h.store.delete.bind(h.store);
  h.store.delete = async () => { throw new Error("D1 unavailable"); };
  for (let minute = 0; minute < 24 * 60; minute += 5 * 48) await assert.rejects(cleanupEvidencePhotos(h.reports, h.store, { now: at(start, 0, minute) }));
  assert.equal(h.reports.raw.prepare("SELECT count(*) n FROM community_photo_deletions").get()!.n, 1);
  assert.ok(Number(h.reports.raw.prepare("SELECT attempts FROM community_photo_deletion_attempts").get()!.attempts) >= 6);
  assert.equal((await h.store.usage()).liveCount, 1);

  // Day 2: REPORTS_DB itself is unavailable (daily limit). Nothing can be read; nothing is lost.
  const realPrepare = h.reports.prepare.bind(h.reports);
  h.reports.prepare = () => { throw new Error("D1_ERROR: daily limit exceeded"); };
  await assert.rejects(cleanupEvidencePhotos(h.reports, h.store, { now: at(start, 1) }));
  h.reports.prepare = realPrepare;

  // Day 3 (= deadline − 7 d at the latest): both recover; the next pass fences the object.
  h.store.delete = realDelete;
  const fencedAt = at(start, 2);
  await cleanupEvidencePhotos(h.reports, h.store, { now: fencedAt });
  assert.ok(fencedAt.getTime() <= deadline.getTime() - 7 * DAY, "fence must precede the deadline by the Time Travel window");
  const row = h.photos.raw.prepare("SELECT state, bytes FROM photo_objects WHERE storage_key = ?").get(key) as Record<string, unknown>;
  assert.deepEqual([row.state, row.bytes], ["deleted", null]);
  assert.equal(h.reports.raw.prepare("SELECT count(*) n FROM community_photo_deletions").get()!.n, 0);
  assert.equal((await h.store.usage()).liveBytes, 0);

  // A resend of the same draft after the fence cannot store the photo again: the report is inside the lead.
  h.setNow(fencedAt);
  const resend = await h.send(reportId, await h.body(device, reportId, photo()));
  assert.equal(resend.status, 410);
  assert.equal((await h.store.usage()).liveCount, 0);
});

test("the lead cannot be configured at or below the Time Travel window", async () => {
  const h = await harness();
  await assert.rejects(queueDuePhotosForErasure(h.reports, h.now, 7), /must exceed Time Travel/);
  await assert.rejects(queueDuePhotosForErasure(h.reports, h.now, 3), /must exceed Time Travel/);
});

test("uploads are refused from the moment a report enters the erasure lead", async () => {
  const h = await harness(), device = await h.enrol(), reportId = await h.newReport(device), deadline = minimizeAfter(h.now);
  h.setNow(at(deadline, -D1_PHOTO_ERASURE_LEAD_DAYS, -1));
  assert.equal((await h.send(reportId, await h.body(device, reportId, photo(64, 48, 1)))).status, 201);
  h.setNow(at(deadline, -D1_PHOTO_ERASURE_LEAD_DAYS));
  const late = await h.send(reportId, await h.body(device, reportId, photo(64, 48, 2)));
  assert.deepEqual([late.status, late.json.error], [410, "reportExpired"]);
});
