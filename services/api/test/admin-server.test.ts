import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createAdminServer } from '../scripts/admin/server.ts';
import { createAdminDemo } from '../scripts/admin/demo.ts';
import { parseAdminArguments } from '../scripts/report-admin.ts';

const password='fixture-only-'.repeat(3);
async function fixture(t:any,readOnly=false,ageMs=0){
  let now=new Date();const data=await createAdminDemo(new Date(now.getTime()-ageMs));
  const app=createAdminServer({...data,passphrase:password,mode:'DEMO',readOnly,now:()=>now});const origin=await app.listen(0);
  t.after(async()=>{await app.close();await data.dispose();});
  const call=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const login=await call('/session',{token:password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const session=await (await call('/api/session',undefined,{Cookie:cookie})).json() as any;
  const auth={Cookie:cookie,'X-CSRF-Token':session.csrfToken};
  return {...data,app,origin,call,auth,session,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
test('localhost shell, auth, Origin, CSRF, host and no-store fences',async t=>{
  const f=await fixture(t);
  assert.equal((f.app.server.address() as any).address,'127.0.0.1');
  const shell=await f.call('/');assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
  assert.equal((await f.call('/api/reports')).status,401);
  assert.equal((await f.call('/api/reports',undefined,{...f.auth,Origin:'https://attacker.invalid'})).status,403);
  // Undici replaces Host; node:http is required to exercise the actual mismatched-host request.
  const status=await new Promise<number>(resolve=>{const r=request(f.origin+'/api/reports',{headers:{...f.auth,Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode!);});r.end();});
  assert.equal(status,403);
  assert.equal((await f.call('/api/reports',undefined,{...f.auth,'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.call('/api/confirm',{}, {Cookie:f.auth.Cookie})).status,403);
  assert.equal((await f.call('/api/confirm',{}, {...f.auth,'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.call('/api/confirm',{arbitrary:'input'},f.auth)).status,400);
  const reports=await f.call('/api/reports',undefined,f.auth);assert.match(reports.headers.get('cache-control')!,/no-store/);
  assert.equal(reports.headers.get('access-control-allow-origin'),null);
});
test('three dummy reports, same-screen detail, private PNG and expired image refusal',async t=>{
  const f=await fixture(t);const page=await (await f.call('/api/reports',undefined,f.auth)).json() as any;
  assert.equal(page.items.length,3);assert.equal(page.counts.pending,3);assert.equal(page.publicationVerified,false);
  const d=await (await f.call('/api/reports/'+f.ids[0],undefined,f.auth)).json() as any;
  assert.equal(d.report.claim_host_name,'サンプル・駅前の指定喫煙所');assert.ok(d.duplicates.length>=1);
  assert.ok(!JSON.stringify(d).includes('submitter_hash'));assert.ok(!JSON.stringify(d).includes('storage_key'));
  const photo=await f.call('/api/photos/'+d.photos[0].photo_id,undefined,f.auth);assert.equal(photo.status,200);
  assert.equal(photo.headers.get('content-type'),'image/png');assert.match(photo.headers.get('cache-control')!,/no-store/);
  const bytes=new Uint8Array(await photo.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[137,80,78,71]);
  assert.equal((await f.call('/api/photos/'+d.photos[0].photo_id)).status,401);
  f.advance(91*86_400_000);
  // Session expiry is checked before retrieving any private image.
  assert.equal((await f.call('/api/photos/'+d.photos[0].photo_id,undefined,f.auth)).status,401);
});
test('explicit confirmed photo/report decisions, duplicate-click replay, hold/reject and unchanged canonical data',async t=>{
  const f=await fixture(t);const canonicalBefore=f.canonical.raw.prepare('SELECT count(*) n FROM spots').get();
  const detail=async(id:string)=>(await(await f.call('/api/reports/'+id,undefined,f.auth)).json()) as any;
  let d=await detail(f.ids[0]);
  let payload={reportId:f.ids[0],photoId:d.photos[0].photo_id,state:'approved',reason:'usableEvidence',expectedVersion:d.version,operationId:crypto.randomUUID(),privacyChecked:true};
  assert.equal((await f.call('/api/decide',{...payload,confirmationToken:'a'.repeat(64)},f.auth)).status,403);
  const prepared=await(await f.call('/api/confirm',payload,f.auth)).json() as any;
  assert.equal((await f.call('/api/decide',{...payload,state:'rejected',confirmationToken:prepared.confirmationToken},f.auth)).status,403);
  const [a,b]=await Promise.all([f.call('/api/decide',{...payload,confirmationToken:prepared.confirmationToken},f.auth),f.call('/api/decide',{...payload,confirmationToken:prepared.confirmationToken},f.auth)]);
  assert.ok([a.status,b.status].includes(200));assert.ok([200,409].includes(b.status));
  assert.equal((await f.call('/api/decide',{...payload,confirmationToken:prepared.confirmationToken},f.auth)).status,200);
  assert.equal(f.reports.raw.prepare('SELECT count(*) n FROM admin_review_audit').get()?.n,1);
  async function decide(reportId:string,state:string,reason:string){d=await detail(reportId);const p={reportId,state,reason,expectedVersion:d.version,operationId:crypto.randomUUID(),privacyChecked:state==='accepted'};
    const confirm=await(await f.call('/api/confirm',p,f.auth)).json() as any;const response=await f.call('/api/decide',{...p,confirmationToken:confirm.confirmationToken},f.auth);assert.equal(response.status,200);}
  await decide(f.ids[0],'accepted','confirmed');await decide(f.ids[1],'needsInfo','insufficientDetail');await decide(f.ids[2],'rejected','insufficientDetail');
  const list=await(await f.call('/api/reports',undefined,f.auth)).json() as any;
  assert.equal(list.counts.accepted,1);assert.equal(list.counts.needsInfo,1);assert.equal(list.counts.rejected,1);assert.equal(list.counts.awaitingPublication,1);
  assert.deepEqual(f.canonical.raw.prepare('SELECT count(*) n FROM spots').get(),canonicalBefore);
  assert.equal(f.canonical.raw.prepare('SELECT count(*) n FROM tile_snapshots').get()?.n,0);
  assert.equal((await detail(f.ids[0])).history.length,2);
});
test('completed confirmation replay rereads retention and redaction instead of caching private detail',async t=>{
  const f=await fixture(t,false,90*86_400_000-90_000);
  const id=f.ids[0];
  const d=await(await f.call('/api/reports/'+id,undefined,f.auth)).json() as any;
  const payload={reportId:id,state:'needsInfo',reason:'insufficientDetail',expectedVersion:d.version,operationId:crypto.randomUUID(),privacyChecked:false};
  const prepared=await(await f.call('/api/confirm',payload,f.auth)).json() as any;
  const body={...payload,confirmationToken:prepared.confirmationToken};
  const first=await(await f.call('/api/decide',body,f.auth)).json() as any;
  assert.ok(first.detail.report.note);
  f.advance(60_000);
  const replay=await(await f.call('/api/decide',body,f.auth)).json() as any;
  assert.equal(replay.replayed,true);assert.equal(replay.detail.report.note,null);
  assert.equal(replay.detail.report.proposed_latitude,null);assert.ok(replay.detail.photos.every((p:any)=>!p.previewAvailable));
  assert.equal(f.reports.raw.prepare('SELECT count(*) n FROM admin_review_audit').get()?.n,1);
});
test('read-only remote-style session never prepares writes',async t=>{
  const f=await fixture(t,true);assert.equal((await f.call('/api/confirm',{},f.auth)).status,403);
  assert.equal((await f.call('/api/decide',{},f.auth)).status,403);
  assert.equal(f.reports.raw.prepare('SELECT count(*) n FROM admin_review_audit').get()?.n,0);
});
test('launch parser reuses real terminal/CI remote guards and refuses public bind flags',()=>{
  const facts={interactive:false,ci:false};assert.equal(parseAdminArguments(['--demo'],facts).target.kind,'local');
  assert.throws(()=>parseAdminArguments(['--host','0.0.0.0'],facts));
  assert.throws(()=>parseAdminArguments(['--env','production'],facts));
  const remote=['--remote','--env','production','--database-id','11111111-1111-4111-8111-111111111111','--confirm-production','mannerpath-production-reports'];
  assert.throws(()=>parseAdminArguments(remote,facts),/interactive terminal/);
  assert.throws(()=>parseAdminArguments(remote,{interactive:true,ci:true}),/interactive terminal/);
  assert.throws(()=>parseAdminArguments([...remote,'--demo'],{interactive:true,ci:false}),/demoCannot/);
  assert.equal(parseAdminArguments(remote,{interactive:true,ci:false}).enableDecisions,false);
});
