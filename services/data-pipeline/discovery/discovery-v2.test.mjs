import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {FetchCache} from './fetch-cache.mjs';
import {inspectPayload,decodeText} from './scanner.mjs';
import {inspectSpreadsheet,spreadsheetFormat} from './spreadsheet.mjs';
import {runDiscovery,inspectBytes} from './cli.mjs';
import {discoverResources,pageResources,nextPage} from './connectors.mjs';
import {buildReport} from './report.mjs';
import {probeEndpoints} from './probe-endpoints.mjs';
const XLSX=createRequire(new URL('../../api/package.json',import.meta.url))('xlsx');
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'discovery-v2-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const reply=(body,headers={})=>new Response(body,{headers});
function workbook(sheets,bookType='xlsx'){const wb=XLSX.utils.book_new();for(const [name,rows] of Object.entries(sheets))XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);return Buffer.from(XLSX.write(wb,{type:'buffer',bookType}));}
const facilities=[['公共施設一覧（令和8年4月1日現在）'],['名称','種別','緯度','経度','備考'],['市役所','庁舎','35.1','139.1','敷地内禁煙'],['駅前公衆喫煙所','喫煙所','35.2','139.2',''],['市民会館','文化施設','35.3','139.3','喫煙可の客席なし']];
const crc=(()=>{const t=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});return b=>{let n=0xffffffff;for(const x of b)n=(n>>>8)^t[(n^x)&255];return (n^0xffffffff)>>>0;};})();
function zip(members){const locals=[],centrals=[];let offset=0;for(const [name,body] of Object.entries(members)){const data=Buffer.from(body),packed=deflateRawSync(data),n=Buffer.from(name);const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);l.writeUInt32LE(crc(data),14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc(data),16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);locals.push(l,n,packed);centrals.push(c,n);offset+=30+n.length+packed.length;}
 const dir=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(centrals.length/2,8);end.writeUInt16LE(centrals.length/2,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,dir,end]);}

test('XLSX: sheet list, title-row header detection, rows, coordinate columns and place keywords',()=>{
 const bytes=workbook({施設:facilities,空:[],備考:[['メモ'],['喫煙可']]});
 assert.equal(spreadsheetFormat(bytes),'xlsx');
 const r=inspectSpreadsheet(bytes);
 assert.equal(r.format,'xlsx');assert.deepEqual(r.sheets.map(s=>s.name),['施設','空','備考']);assert.deepEqual(r.usedSheets,['施設','備考']);
 assert.equal(r.sheets[0].headerRowIndex,1);assert.deepEqual(r.sheets[0].headers,['名称','種別','緯度','経度','備考']);assert.deepEqual(r.sheets[0].coordinateColumns,['緯度','経度']);
 assert.equal(r.rawRowCount,4);assert.equal(r.matchingRowCount,3);assert.equal(r.placeKeywordRowCount,1);assert.deepEqual(r.matchingSheets,['施設','備考']);
 assert.ok(r.categoryInventory['種別'].values.includes('喫煙所'));assert.equal(r.coordinateAvailability,'partial');
 assert.ok(r.blockerCodes.includes('licenseUnknown')&&!r.blockerCodes.includes('coordinatesMissing'));
});
test('XLS (BIFF8) workbook is inspected with the same row analysis',()=>{
 const bytes=workbook({一覧:facilities},'biff8');assert.equal(spreadsheetFormat(bytes),'xls');
 const r=inspectSpreadsheet(bytes);assert.equal(r.format,'xls');assert.equal(r.rawRowCount,3);assert.equal(r.placeKeywordRowCount,1);
});
test('false-positive smoking text is a keyword hit but never a place hit',()=>{
 const r=inspectSpreadsheet(workbook({s:[['名称','備考'],['ホテルA','喫煙可'],['公園B','全面禁煙（喫煙はご遠慮ください）']]}));
 assert.equal(r.matchingRowCount,2);assert.equal(r.placeKeywordRowCount,0);assert.ok(r.blockerCodes.includes('coordinatesMissing'));
});
test('empty, malformed and oversized workbooks fail closed with structured blockers',()=>{
 const empty=inspectSpreadsheet(workbook({Sheet1:[]}));assert.equal(empty.rawRowCount,0);assert.ok(empty.blockerCodes.includes('noSmokingEvidence'));
 const truncated=workbook({a:facilities}).subarray(0,300);const malformed=inspectSpreadsheet(Buffer.concat([truncated,Buffer.from('xl/workbook.xml')]));assert.ok(malformed.blockerCodes.includes('incompatibleFormat'));assert.match(malformed.error,/parse failed/);
 assert.deepEqual(inspectSpreadsheet(Buffer.from('name,lat\n')).blockerCodes,['incompatibleFormat']);
 const big=inspectSpreadsheet(workbook({a:facilities}),{limits:{maxBytes:10,maxCells:1e6,maxSheets:64,headerScanRows:15}});assert.deepEqual(big.blockerCodes,['payloadTooLarge']);
 const cells=inspectSpreadsheet(workbook({a:facilities}),{limits:{maxBytes:1e7,maxCells:5,maxSheets:64,headerScanRows:15}});assert.deepEqual(cells.blockerCodes,['payloadTooLarge']);
});
test('generic scanner sniffs workbooks before ZIP/GIS handling and routes them to the workbook inspector',async()=>{
 const bytes=workbook({a:facilities});const quick=inspectPayload(bytes,{url:'https://a.test/download?id=1',format:'zip'});assert.equal(quick.format,'xlsx');assert.equal(quick.spreadsheet,true);
 const full=await inspectBytes(bytes,{url:'https://a.test/download?id=1',format:'zip'});assert.equal(full.format,'xlsx');assert.equal(full.rawRowCount,3);
});
test('plain ZIP of CSV and XLSX members is inspected member by member',async()=>{
 const archive=zip({'data/施設.csv':Buffer.from('名称,緯度,経度\n喫煙所,35,139\n'),'b.xlsx':workbook({a:facilities}),'readme.txt':'x'});
 const r=await inspectBytes(archive,{url:'https://a.test/a.zip',format:'zip'});
 assert.equal(r.format,'zip');assert.equal(r.rawRowCount,4);assert.equal(r.archiveMembers.length,2);assert.deepEqual(r.archiveMembers.map(m=>m.format).sort(),['csv','xlsx']);assert.equal(r.matchingRowCount,3);
});
test('Shift_JIS/CP932, UTF-8 BOM, UTF-16 BOM and declared charset decode deterministically',()=>{
 const sjis=Buffer.from('96bc8fcc2c94f58d6c0d0a8b69898c8f8a2c8740','hex');// 名称,備考\r\n喫煙所,① (CP932 extension)
 const a=inspectPayload(sjis,{format:'csv'});assert.equal(a.encoding,'shift_jis');assert.equal(a.matchingRowCount,1);assert.equal(a.matchingValues[0].value,'喫煙所');
 const bom=inspectPayload(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('名称\n灰皿\n')]),{format:'csv'});assert.equal(bom.encoding,'utf-8-bom');assert.equal(bom.matchingRowCount,1);
 const le=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('名称\n灰皿\n','utf16le')]);assert.equal(decodeText(le).text,'名称\n灰皿\n');
 assert.throws(()=>decodeText(Buffer.from([0x82,0xff]),{contentType:'text/csv; charset=Shift_JIS'}));assert.equal(decodeText(Buffer.from('8b69','hex'),{contentType:'text/csv; charset=Shift_JIS'}).text,'喫');
 const bad=inspectPayload(Buffer.from([0x81,0x39,0xff]),{format:'csv'});assert.deepEqual(bad.blockerCodes,['incompatibleFormat']);
});
test('coordinate columns with suffixes are recognised; plane X/Y columns are reported but not treated as WGS84',()=>{
 const r=inspectPayload(Buffer.from('名称,緯度（世界測地系）,経度（世界測地系）\n喫煙所,35.1,139.2\n'),{format:'csv'});assert.equal(r.coordinateAvailability,'all');
 const x=inspectSpreadsheet(workbook({a:[['名称','X座標','Y座標'],['喫煙所','-12345.6','3456.7']]}));assert.deepEqual(x.coordinateColumns,['a!X座標','a!Y座標']);assert.equal(x.coordinateAvailability,'missing');
});
test('static HTML enumerates extension and label-typed download links, never navigation pages',()=>{
 const html='<a href="/fs/1/_/list.xlsx">公共施設一覧</a><a href="/fs/2/_/old.xls">旧</a><a href="/download?id=9"><span>CSV</span>(3KB)</a><a href="/about/csv.html">CSVとは</a><a href="/list/">JSON</a><a href="mailto:a@b">CSV</a><a href="data.geojson">地図</a>';
 const r=pageResources(html,'https://c.test/dataset/1.html');
 assert.deepEqual(r.map(x=>[x.url,x.format,x.discoveredBy]),[['https://c.test/fs/1/_/list.xlsx','xlsx','hrefExtension'],['https://c.test/fs/2/_/old.xls','xls','hrefExtension'],['https://c.test/download?id=9','csv','linkLabel'],['https://c.test/dataset/data.geojson','geojson','hrefExtension']]);
});
test('portal pagination follows ordinary next links on the same host, bounded and marked truncated',async()=>{
 const pages={'https://p.test/dataset/':'<a href="?page=2" rel="next">次へ</a><a href="/r/1.xlsx">一</a>','https://p.test/dataset/?page=2':'<a href="?page=3">次へ</a><a href="/r/2.csv">二</a>','https://p.test/dataset/?page=3':'<a href="https://evil.test/?page=4">次へ</a><a href="/r/3.csv">三</a>'};
 const fetched=[];const fetcher={get:async url=>{fetched.push(url);return pages[url]?{status:200,bytes:Buffer.from(pages[url])}:{status:404,blockerCodes:['rawUnavailable']};}};
 const all=await discoverResources({catalogs:[{type:'static',url:'https://p.test/dataset/'}]},fetcher,{maxPages:5});assert.equal(all.resources.length,3);assert.equal(all.truncated,false);assert.ok(!fetched.some(u=>u.includes('evil')));
 const bounded=await discoverResources({catalogs:[{type:'static',url:'https://p.test/dataset/'}]},fetcher,{maxPages:2});assert.equal(bounded.resources.length,2);assert.equal(bounded.truncated,true);
});
test('Shift_JIS HTML dataset page keeps Japanese link labels via meta charset',async()=>{
 const html=Buffer.concat([Buffer.from('<meta charset="Shift_JIS"><a href="/a.csv">'),Buffer.from('8b69898c8f8a','hex'),Buffer.from('</a>')]);
 const r=await discoverResources({catalogs:[{type:'static',url:'https://s.test/'}]},{get:async()=>({status:200,bytes:html})});assert.equal(r.resources[0].title,'喫煙所');
});
test('oversized download is a structured payloadTooLarge blocker with fetch metadata',async t=>{
 const fetcher=new FetchCache({directory:await temporary(t),delayMs:0,maxBytes:8,validateUrl:async()=>{},fetchImpl:async()=>reply('0123456789abcdef',{etag:'"e"','last-modified':'yesterday'})});
 const r=await fetcher.get('https://a.test/big.xlsx');assert.deepEqual(r.blockerCodes,['payloadTooLarge']);assert.equal(r.etag,'"e"');assert.equal(r.bytes,undefined);
});
test('v2 pass: workbook is cached, identical bytes under two URLs inspected once, resume skips completed targets, prior blockers kept',async t=>{
 const dir=await temporary(t),statePath=join(dir,'state.json');const bytes=workbook({a:facilities});let calls=0;
 const fetcher=new FetchCache({directory:join(dir,'cache'),delayMs:0,validateUrl:async()=>{},fetchImpl:async url=>{calls++;if(url.endsWith('/'))return reply('<a href="/a.xlsx">一覧</a><a href="/b.xlsx">同一</a>');return reply(bytes,{etag:'"w"','last-modified':'lm'});}});
 await writeFile(statePath,JSON.stringify({version:1,targets:{a:{status:'blocked',completedAt:'2026-09-30',blockerCodes:['rawUnavailable'],deepReview:{status:'blocked'}}},resources:{}}));
 const manifest={targets:[{id:'a',name:'A',homepageUrl:'https://a.test/'},{id:'b',name:'B',homepageUrl:'https://b.test/'}]};
 // Interrupted run: only one target completes.
 await runDiscovery({manifest,statePath,fetcher,pass:'v2',limit:1});
 let state=JSON.parse(await readFile(statePath,'utf8'));assert.ok(state.targets.a.passes.v2);assert.equal(state.targets.b,undefined);
 assert.deepEqual(state.targets.a.previousBlockerCodes,['rawUnavailable']);assert.deepEqual(state.targets.a.deepReview,{status:'blocked'});
 const a=state.resources['https://a.test/a.xlsx'],b=state.resources['https://a.test/b.xlsx'];assert.equal(a.format,'xlsx');assert.equal(a.etag,'"w"');assert.equal(a.lastModified,'lm');assert.equal(a.sha256,b.sha256);assert.equal(b.duplicateOf,'https://a.test/a.xlsx');assert.equal(a.status,'candidate');
 const before=calls;await runDiscovery({manifest,statePath,fetcher,pass:'v2'});state=JSON.parse(await readFile(statePath,'utf8'));
 assert.ok(state.targets.b.passes.v2);assert.equal(calls-before,3);// b's page and its two workbooks; target a is not revisited
 const again=calls;await runDiscovery({manifest,statePath,fetcher,pass:'v2'});assert.equal(calls,again);
 const report=buildReport({prefectures:[],targets:manifest.targets.map(x=>({...x,roles:[]}))},state);assert.equal(report.passSummary.v2.targetsCompleted,2);assert.equal(report.passSummary.v2.xlsxResources,4);assert.equal(report.passSummary.v2.duplicateHashResources,3);assert.equal(report.passSummary.v2.placeKeywordHitResources,4);
});
test('403/429 on one host during a v2 pass stops that host only',async t=>{
 const dir=await temporary(t);let bad=0;const fetcher=new FetchCache({directory:join(dir,'cache'),delayMs:0,validateUrl:async()=>{},fetchImpl:async url=>{if(url.includes('blocked.test')){bad++;return new Response(null,{status:429});}return reply(url.endsWith('.csv')?'name\nx\n':'<a href="/ok.csv">x</a>');}});
 const state=await runDiscovery({manifest:{targets:[{id:'x',name:'X',catalogs:[{type:'static',url:'https://blocked.test/'},{type:'static',url:'https://blocked.test/other'}]},{id:'y',name:'Y',homepageUrl:'https://fine.test/'}]},statePath:join(dir,'s.json'),fetcher,pass:'v2'});
 assert.equal(bad,1);assert.ok(state.targets.x.blockerCodes.includes('rateLimited'));assert.equal(state.targets.y.status,'rawScanned');
});
test('endpoint probe reports 404 and permanent redirects without rewriting the manifest to another publisher',async()=>{
 const responses={'https://gone.test/www/':{status:404},'https://moved.test/old':{status:301,redirectUrl:'https://moved.test/new'},'https://moved.test/new':{status:200,bytes:Buffer.from('ok')},'https://away.test/':{status:308,redirectUrl:'https://mirror.example/'},'https://ok.test/':{status:200,bytes:Buffer.from('ok')}};
 const fetcher={get:async(url,{followRedirects}={})=>{assert.equal(followRedirects,false);return responses[url];}};
 const manifest={targets:[{id:'a',homepageUrl:'https://ok.test/',catalogs:[{type:'static',url:'https://gone.test/www/'},{type:'ckan',url:'https://moved.test/old'},{type:'static',url:'https://away.test/'}]}]};
 const r=await probeEndpoints(manifest,fetcher);
 assert.deepEqual(r.map(x=>[x.url,x.finding,x.suggestedUrl??null]),[['https://gone.test/www/','notFound',null],['https://moved.test/old','permanentRedirect','https://moved.test/new'],['https://away.test/','crossHostRedirect',null],['https://ok.test/','ok',null]]);
 assert.equal(manifest.targets[0].catalogs[0].url,'https://gone.test/www/');
});
