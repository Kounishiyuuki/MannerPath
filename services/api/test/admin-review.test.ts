import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportsD1,withoutTrigger} from './support/sqlite-d1.ts';
import type {Db} from '../src/db.ts';
import {createReport} from '../src/reports/create.ts';
import {CURRENT_REPORT_TERMS} from '../src/reports/terms.ts';
import {getAdminReport,listAdminReports,applyAdminDecision,AdminReviewError,type AdminDecision} from '../src/reports/admin-review.ts';
const now=new Date('2026-10-22T00:00:00Z');
async function fixture(){
 const db=reportsD1();
 const r=await createReport(db,{schemaVersion:1,type:'missing',installId:'8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f',proposedLocation:{latitude:35.7,longitude:139.7},note:'private report description',acceptedTermsVersion:CURRENT_REPORT_TERMS.version},{now,attestationStatus:'verified',submitterHash:'a'.repeat(64)});
 const photoId='ph_'+'b'.repeat(64);
 await db.prepare(`INSERT INTO community_evidence_photos(photo_id,report_id,storage_key,content_sha256,media_type,byte_length,width,height,lifecycle,created_at,upload_expires_at,delete_after)
 SELECT ?,report_id,'private-object-key',?,'image/png',20,1,1,'ready',received_at,'2026-10-22T00:15:00Z',minimize_after FROM reports WHERE report_id=?`).bind(photoId,'b'.repeat(64),r.reportId).run();
 return {db,reportId:r.reportId,photoId};
}
async function decision(x:Awaited<ReturnType<typeof fixture>>,extra:Partial<AdminDecision>={}){
 return {reportId:x.reportId,state:'needsInfo',reason:'insufficientDetail',expectedVersion:(await getAdminReport(x.db,x.reportId,now)).version,operationId:crypto.randomUUID(),privacyChecked:false,decidedBy:'operator',...extra};
}
test('list/detail never expose submitter hashes or storage keys; retention hides raw fields and previews',async()=>{
 const x=await fixture();const list=await listAdminReports(x.db,{},now);assert.equal(list.items.length,1);assert.equal(list.counts.pending,1);
 const detail=await getAdminReport(x.db,x.reportId,now);assert.equal(detail.photos[0].previewAvailable,true);
 assert.doesNotMatch(JSON.stringify([list,detail]),/private-object-key|submitter_hash|content_sha256/);
 const expired=await getAdminReport(x.db,x.reportId,new Date('2027-10-22T00:00:00Z'));assert.equal(expired.report.note,null);assert.equal(expired.report.proposed_latitude,null);assert.equal(expired.photos[0].previewAvailable,false);
});
test('report/photo decisions are audited, idempotent, stale-safe and never publish',async()=>{
 const x=await fixture();const original=await decision(x);const first=await applyAdminDecision(x.db,original,now);assert.equal(first.detail.report.state,'needsInfo');
 assert.equal((await applyAdminDecision(x.db,original,now)).replayed,true);
 await assert.rejects(applyAdminDecision(x.db,{...original,operationId:crypto.randomUUID()},now),(e:unknown)=>e instanceof AdminReviewError&&e.status===409);
 await assert.rejects(applyAdminDecision(x.db,{...original,state:'rejected'},now),(e:unknown)=>e instanceof AdminReviewError&&e.code==='operationConflict');
 const photo=await decision(x,{photoId:x.photoId,state:'approved',reason:'usableEvidence',privacyChecked:true});await applyAdminDecision(x.db,photo,now);
 await applyAdminDecision(x.db,await decision(x,{state:'accepted',reason:'confirmed',privacyChecked:true}),now);
 const detail=await getAdminReport(x.db,x.reportId,now);assert.equal(detail.history.length,3);assert.equal(detail.publicationState,'awaitingPublication');assert.equal(detail.publicationVerified,false);assert.equal(detail.report.reconciliation_state,'notQueued');
 const counts=(await listAdminReports(x.db,{},now)).counts;assert.equal(counts.awaitingPublication,1);assert.equal(counts.published,0);
 assert.equal(x.db.raw.prepare("SELECT count(*) n FROM sqlite_master WHERE name='spots'").get()?.n,0);
 assert.doesNotMatch(JSON.stringify(x.db.raw.prepare('SELECT * FROM admin_review_audit').all()),/private report description|private-object-key/);
 assert.throws(()=>x.db.raw.exec("UPDATE admin_review_audit SET state='rejected'"),/immutable/);
 assert.throws(()=>x.db.raw.exec('DELETE FROM admin_review_audit'),/immutable/);
 assert.throws(()=>x.db.raw.exec("INSERT OR REPLACE INTO admin_review_audit SELECT * FROM admin_review_audit LIMIT 1"),/immutable/);
});
test('missing place acceptance requires explicit privacy check and approved unexpired photo',async()=>{
 const x=await fixture();await assert.rejects(applyAdminDecision(x.db,await decision(x,{state:'accepted',reason:'confirmed'}),now),/privacyCheckRequired/);
 await assert.rejects(applyAdminDecision(x.db,await decision(x,{state:'accepted',reason:'confirmed',privacyChecked:true}),now),/approvedPhotoRequired/);
 await applyAdminDecision(x.db,await decision(x,{photoId:x.photoId,state:'rejected',reason:'privacyRisk'}),now);
 assert.equal((await getAdminReport(x.db,x.reportId,now)).photos[0].previewAvailable,false);assert.equal(x.db.raw.prepare('SELECT count(*) n FROM community_photo_deletions').get()?.n,1);
 await assert.rejects(applyAdminDecision(x.db,await decision(x,{state:'accepted',reason:'confirmed',privacyChecked:true}),now),/approvedPhotoRequired/);
});
test('same-revision concurrent actions yield one audit; rejected and hold reload',async()=>{
 const x=await fixture();const input=await decision(x);const result=await Promise.allSettled([applyAdminDecision(x.db,input,now),applyAdminDecision(x.db,{...input,operationId:crypto.randomUUID(),state:'rejected',reason:'outOfScope'},now)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await getAdminReport(x.db,x.reportId,now)).history.length,1);
 await applyAdminDecision(x.db,await decision(x,{state:'rejected',reason:'outOfScope'}),now);assert.equal((await getAdminReport(x.db,x.reportId,now)).report.state,'rejected');
});
test('legacy CLI changes invalidate versions; deletion tombstones fence approval and previews',async()=>{
 const x=await fixture();const original=await decision(x);
 await x.db.prepare("UPDATE report_moderation SET state='needsInfo',decided_at=?,decided_by='legacy-cli',decision_reason='insufficientDetail' WHERE report_id=?").bind(now.toISOString().replace('.000Z','Z'),x.reportId).run();
 await assert.rejects(applyAdminDecision(x.db,original,now),/staleDecision/);
 await x.db.prepare("INSERT INTO community_photo_deletions VALUES('private-object-key',?)").bind(now.toISOString()).run();
 assert.equal((await getAdminReport(x.db,x.reportId,now)).photos[0].previewAvailable,false);
 await assert.rejects(applyAdminDecision(x.db,await decision(x,{photoId:x.photoId,state:'approved',reason:'usableEvidence',privacyChecked:true}),now),/photoUnavailable/);
});
test('newest-first keyset pages and counts across three dummy reports',async()=>{
 const x=await fixture();
 for(let i=1;i<=2;i++)await createReport(x.db,{schemaVersion:1,type:'exists',spotId:'sp_01V64NN31G72E5KJJ5W22W1A1J',installId:'8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f',acceptedTermsVersion:CURRENT_REPORT_TERMS.version},{now:new Date(now.getTime()+i*1000),attestationStatus:'verified',submitterHash:'a'.repeat(64)});
 const a=await listAdminReports(x.db,{limit:2},now);assert.equal(a.items.length,2);assert.equal(a.counts.pending,3);assert.ok(a.items[0].received_at>a.items[1].received_at);assert.ok(a.nextCursor);
 const b=await listAdminReports(x.db,{limit:2,cursor:a.nextCursor!},now);assert.equal(b.items.length,1);assert.equal(b.items[0].report_id,x.reportId);assert.equal(b.nextCursor,null);
 assert.equal((await listAdminReports(x.db,{status:'published'},now)).items.length,0);
});
test('concurrent reused operation UUID with different decisions cannot overwrite winning audit',async()=>{
 const x=await fixture();const input=await decision(x);let arrived=0;let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 // Both requests have observed no prior audit and the same report version before either batch.
 const db:Db={prepare:x.db.prepare.bind(x.db),batch:async statements=>{if(++arrived===2)release();await gate;return x.db.batch(statements);}};
 const results=await Promise.allSettled([applyAdminDecision(db,input,now),applyAdminDecision(db,{...input,state:'rejected',reason:'outOfScope'},now)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const detail=await getAdminReport(x.db,x.reportId,now);assert.equal(detail.history.length,1);assert.equal(detail.report.state,detail.history[0].state);
 // Which request reaches its batch first depends on async hashing under load; the winner is whichever one fulfilled.
 assert.equal(detail.history[0].state,results[0].status==='fulfilled'?'needsInfo':'rejected');
});
test('discarded and artifact-exported reports are not counted as waiting or publicly published',async()=>{
 const x=await fixture();
 // Set up existing pipeline states; this test does not exercise or bypass the production exporter.
 await x.db.prepare("UPDATE report_moderation SET state='accepted',decided_at=?,decided_by='operator',decision_reason='confirmed' WHERE report_id=?").bind('2026-10-22T00:00:00Z',x.reportId).run();
 await x.db.prepare("UPDATE report_moderation SET reconciliation_state='discarded' WHERE report_id=?").bind(x.reportId).run();
 assert.equal((await getAdminReport(x.db,x.reportId,now)).publicationState,'discarded');
 assert.equal((await listAdminReports(x.db,{status:'awaitingPublication'},now)).items.length,0);
 assert.equal((await listAdminReports(x.db,{},now)).counts.awaitingPublication,0);
 withoutTrigger(x.db.raw,'report_moderation_reconciliation_transitions',()=>x.db.raw.prepare("UPDATE report_moderation SET reconciliation_state='applied' WHERE report_id=?").run(x.reportId));
 const detail=await getAdminReport(x.db,x.reportId,now);assert.equal(detail.publicationState,'artifactExported');assert.equal(detail.publicationVerified,false);
 const list=await listAdminReports(x.db,{},now);assert.equal(list.counts.exportedUnverified,1);assert.equal(list.counts.awaitingPublication,0);assert.equal(list.counts.published,0);
 assert.equal((await listAdminReports(x.db,{status:'accepted'},now)).items.length,1);
 assert.equal((await listAdminReports(x.db,{status:'awaitingPublication'},now)).items.length,0);
});
