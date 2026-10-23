import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Minimal DOM for exercising the shipped UI's rendering and event handlers, without
// adding a browser dependency. Browser layout and native dialog QA remain separate.
class Node {
  tagName: string; children: Node[]=[]; parentNode?: Node; text='';
  attrs: Record<string,string>={}; dataset: Record<string,string>={};
  listeners: Record<string,Function[]>={}; className=''; id=''; disabled=false;
  hidden=false; checked=false; value=''; type=''; focused=false;
  constructor(tagName:string){this.tagName=tagName;}
  get textContent():string{return this.text+this.children.map(n=>n.textContent).join('');}
  set textContent(value:string){this.text=value;this.children=[];}
  append(...nodes:(Node|string)[]){for(const item of nodes){const n=typeof item==='string'?new Node('#text'):item;if(typeof item==='string')n.text=item;n.parentNode=this;this.children.push(n);if(this.tagName==='select'&&!this.value)this.value=n.value;}}
  replaceChildren(...nodes:Node[]){this.children=[];this.text='';this.append(...nodes);}
  setAttribute(name:string,value:string){this.attrs[name]=value;}
  addEventListener(name:string,fn:Function){(this.listeners[name]??=[]).push(fn);}
  async click(){if(!this.disabled)for(const fn of this.listeners.click??[])await fn();}
  closest(selector:string):Node|undefined{return selector==='.photo'&&this.className==='photo'?this:this.parentNode?.closest(selector);}
  replaceWith(_node?:Node){}
  focus(){this.focused=true;}
  get classList(){return {add:(name:string)=>{this.className+=' '+name;}};}
  querySelectorAll(selector:string):Node[]{return this.children.flatMap(n=>[...(matches(n,selector)?[n]:[]),...n.querySelectorAll(selector)]);}
  querySelector(selector:string){return this.querySelectorAll(selector)[0];}
}
function matches(n:Node,selector:string){
  if(selector==='[data-photo-approve]')return n.dataset.photoApprove!==undefined;
  if(selector==='[data-write]')return n.dataset.write!==undefined;
  if(selector==='[data-report-accept]')return n.dataset.reportAccept!==undefined;
  if(selector.startsWith('.queue-item'))return n.className==='queue-item'&&(!selector.includes('aria-current')||n.attrs['aria-current']==='true');
  return n.tagName===selector;
}
const source=readFileSync(new URL('../scripts/admin/ui.js',import.meta.url),'utf8')
  .replace(/^import .*\n/,'').replace(/start\(\);\s*$/,'');
function harness(photos:object[]=[],readOnly=false){
  const page=new Node('body');
  for(const id of ['detail','queue','message','reload','more','confirm-save','confirm']){const n=new Node('div');n.id=id;page.append(n);}
  // Include all elements for getElementById without broadening CSS emulation.
  const all=(n:Node):Node[]=>n.children.flatMap(c=>[c,...all(c)]);
  const calls:unknown[][]=[];
  const document={createElement:(tag:string)=>new Node(tag),createTextNode:(s:string)=>{const n=new Node('#text');n.text=s;return n;},getElementById:(id:string)=>all(page).find(n=>n.id===id),querySelectorAll:(s:string)=>page.querySelectorAll(s),querySelector:(s:string)=>page.querySelector(s),addEventListener:()=>{}};
  const report={report_id:'report-a',report_type:'missing',state:'pending',claim_host_name:'駅前の施設',claim_access_detail:'店舗利用者は営業時間内に利用できます。',note:'長い日本語の説明です。',received_at:'2026-01-01T00:00:00Z'};
  const context={document,window:{addEventListener:()=>{}},URL,Date,Number,setTimeout,clearTimeout,fetch:async()=>({ok:true,blob:async()=>({type:'image/png'})}),adminErrorMessage:()=>'',calls,fixture:{report,photos,duplicates:[],history:[],version:3},readOnly};
  runInNewContext(source+`\nsession={readOnly};selected='report-a';detail=fixture;originalFetchPhoto=fetchPhoto;fetchPhoto=()=>{};decide=(...args)=>calls.push(args);renderDetail();`,context);
  const root=document.getElementById('detail')!;
  return {root,page,calls,get:(id:string)=>document.getElementById(id)!,run:(js:string)=>runInNewContext(js,context),button:(name:string)=>root.querySelectorAll('button').find(n=>n.textContent===name)!};
}
const photo=(state='pending')=>({photo_id:'photo-a',lifecycle:'ready',moderation_status:state,previewAvailable:true,view_until:new Date(Date.now()+60_000).toISOString()});

test('photo and report decisions belong to separate labelled review steps',async()=>{
  const ui=harness([photo()]);
  const steps=ui.root.querySelectorAll('section').filter(n=>n.attrs['aria-label']);
  assert.deepEqual(steps.map(n=>n.attrs['aria-label']),['STEP 1 写真の確認','STEP 2 喫煙所情報の確認']);
  assert.ok(steps[0].textContent.includes('写真の承認だけでは投稿は承認・公開されません'));
  assert.equal(steps[0].querySelectorAll('button').some(n=>n.textContent==='承認'),false);
  assert.equal(steps[1].querySelectorAll('button').some(n=>n.textContent==='写真を承認'),false);
  assert.ok(steps[1].textContent.includes('店舗利用者は営業時間内に利用できます。'));
  assert.equal(ui.button('写真を承認').disabled,true);
  ui.run('document.querySelector("[data-photo-approve]").dataset.blocked="false";setBusy(false);');
  await ui.button('写真を承認').click();
  assert.equal(ui.calls.length,0);
  assert.match(ui.get('message').textContent,/プライバシー/);
  steps[0].querySelectorAll('input')[0].checked=true;
  await ui.button('写真を承認').click();
  assert.deepEqual(Array.from(ui.calls[0]),['approved','usableEvidence','photo-a',true]);
  assert.equal(ui.button('承認').disabled,true);
  await ui.button('写真を却下').click();
  assert.deepEqual(Array.from(ui.calls[1]),['rejected','usableEvidence','photo-a',true]);
});

test('only a live approved photo enables new-place approval; report actions never inherit photo ID',async()=>{
  for(const photos of [[],[photo()],[{...photo('approved'),view_until:new Date(Date.now()-1).toISOString()}]])assert.equal(harness(photos).button('承認').disabled,true);
  const ui=harness([photo('approved')]);
  assert.equal(ui.button('承認').disabled,false);
  assert.equal(ui.get('approval-photo-hint').hidden,true);
  ui.get('privacy-check').checked=true;
  await ui.button('承認').click();
  assert.deepEqual(Array.from(ui.calls[0]),['accepted','confirmed',undefined,true]);
  await ui.button('保留').click();
  assert.deepEqual(Array.from(ui.calls[1]),['needsInfo','insufficientDetail',undefined,true]);
  await ui.button('却下').click();
  assert.equal(ui.calls[2][0],'rejected');assert.equal(ui.calls[2][2],undefined);
  assert.equal(harness([photo('approved')],true).button('承認').disabled,true);
});

test('detail navigation returns focus to selected queue item and advances with heading focus',async()=>{
  const ui=harness();
  for(const id of ['report-a','report-b']){const row=new Node('button');row.className='queue-item';row.dataset.reportId=id;row.setAttribute('aria-current',String(id==='report-a'));ui.get('queue').append(row);}
  ui.run('renderDetail(); loadDetail=async id=>{selected=id;detail.report.report_id=id;renderDetail();};');
  await ui.button('投稿一覧へ').click();
  assert.equal(ui.get('queue').children[0].focused,true);
  await ui.button('次の投稿へ').click();
  assert.equal(ui.run('selected'),'report-b');
  assert.equal(ui.get('detail-title').focused,true);
  assert.equal(ui.button('次の投稿へ').disabled,true);
  const technical=ui.root.querySelectorAll('details').find(n=>n.textContent.includes('投稿ID・技術情報'))!;
  assert.ok(technical);assert.equal(technical.attrs.open,undefined);
});

test('next navigation follows refreshed queue order and is blocked during saves',async()=>{
  const ui=harness();
  const row=(id:string)=>{const n=new Node('button');n.className='queue-item';n.dataset.reportId=id;return n;};
  ui.get('queue').append(row('report-a'));
  ui.run('renderDetail(); loadDetail=async id=>{selected=id;renderDetail();};');
  assert.equal(ui.button('次の投稿へ').disabled,true);
  ui.get('queue').append(row('report-c'));
  ui.run('refreshNextNavigation();');
  assert.equal(ui.button('次の投稿へ').disabled,false);
  ui.run('setBusy(true);');
  assert.equal(ui.button('次の投稿へ').disabled,true);
  ui.run('setBusy(false);');
  await ui.button('次の投稿へ').click();
  assert.equal(ui.run('selected'),'report-c');
  ui.get('queue').replaceChildren(row('report-d'));
  ui.run('refreshNextNavigation();');
  assert.equal(ui.button('次の投稿へ').disabled,true);
});

 test('photo approval remains blocked before preview load and through busy resets; rejection remains available',async()=>{
  const ui=harness([photo()]);
  ui.root.querySelectorAll('input')[0].checked=true;
  ui.run('setBusy(true);setBusy(false);');
  await ui.button('写真を承認').click();
  assert.equal(ui.calls.length,0);
  assert.equal(ui.button('写真を承認').disabled,true);
  assert.equal(ui.button('写真を却下').disabled,false);
 });

 test('preview load enables approval, while failed requests and decode errors keep it blocked',async()=>{
  for(const result of ['load','error','fetchFailure']){
    const ui=harness([photo()]);
    ui.run('URL={createObjectURL:()=>"blob:synthetic",revokeObjectURL:()=>{}};setTimeout=()=>0;');
    if(result==='fetchFailure')ui.run('fetch=async()=>{throw new Error("unavailable");};');
    // The failed-preview replacement is irrelevant to approval eligibility.
    ui.root.querySelectorAll('img')[0].replaceWith=()=>{};
    await ui.run('originalFetchPhoto("photo-a",document.querySelector("img"),requestEpoch,fixture.photos[0].view_until);');
    for(const fn of ui.root.querySelectorAll('img')[0].listeners[result]??[])fn();
    ui.run('setBusy(true);setBusy(false);');
    assert.equal(ui.button('写真を承認').disabled,result!=='load');
    assert.equal(ui.button('写真を却下').disabled,false);
  }
 });
