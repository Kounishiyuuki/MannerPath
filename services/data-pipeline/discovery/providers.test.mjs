import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {searchProvider,PROVIDERS,ROLES,PROVIDER_MAX_BYTES} from './providers.mjs';
import {main} from './providers-cli.mjs';
const fixture=async name=>JSON.parse(await readFile(new URL(`./fixtures/providers/${name}.json`,import.meta.url),'utf8'));
const transport=data=>({get:async()=>({status:200,bytes:Buffer.from(JSON.stringify(data)),fetchedAt:'2026-10-08T00:00:00Z',sha256:'synthetic',cacheHit:false})});
function inert(report){assert.equal(report.approvalAutomated,false);assert.equal(report.productionApproval,false);for(const row of [...report.resources,...report.leads]){assert.equal(row.publicationStatus,'blocked');assert.equal(row.smokingExistence,'unknown');assert.equal(row.coordinateAuthority,'unknown');assert.equal(row.currentOperation,'unknown');}}

test('CKAN exact metadata is preserved without promoting provider or resource terms to reviewed rights',async()=>{
 const report=await searchProvider('ckan',{fetcher:transport(await fixture('ckan'))});inert(report);
 assert.equal(report.resources.length,1);assert.equal(report.leads.length,0);
 const r=report.resources[0];assert.equal(r.publisher,'Example municipality');assert.equal(r.datasetId,'smoking');assert.equal(r.resourceId,'csv');
 assert.equal(r.rights.licenseId,'cc-by');assert.equal(r.rights.licenseName,'Creative Commons Attribution');assert.equal(r.rights.licenseUrl,'https://creativecommons.org/licenses/by/4.0/');assert.equal(r.rights.resourceLicense,'https://publisher.example/resource-terms');
 assert.equal(r.rights.status,'unknown');assert.equal(r.rights.commercialReuse,'unknown');assert.equal(r.rights.redistribution,'unknown');
 assert.equal(r.metadataModified,'2026-10-01T00:00:00');assert.equal(r.resourceModified,'2026-09-30T00:00:00');assert.equal(r.attribution.metadata,'Example attribution');
 assert.equal(r.coordinateAvailability,'unknown');assert.deepEqual(r.coordinateColumns,[]);assert.equal(report.manualReviewQueue[0].approvalAutomated,false);
});

test('OpenPOI preserves all upstream terms but neither explicit smoking names nor generic hosts become canonical resources',async()=>{
 const report=await searchProvider('openpoi',{fetcher:transport(await fixture('openpoi'))});inert(report);
 assert.equal(PROVIDERS.openpoi.terms.commercial,'permitted');assert.equal(report.resources.length,0);assert.deepEqual(report.manualReviewQueue,[]);assert.deepEqual(report.targets,[]);
 assert.deepEqual(report.leads[0].licenses,['CC BY 4.0','ODbL 1.0']);assert.deepEqual(report.leads[0].attributions,['Example municipality','Example contributors']);assert.equal(report.leads[0].keywordSignal,true);assert.equal(report.leads[1].keywordSignal,false);assert.ok(report.leads[1].blockerCodes.includes('licenseUnknown'));
 for(const lead of report.leads)assert.equal(lead.providerRole,ROLES.discovery);
});

test('bounded Overture JP export retains every source license and source chain without coordinate authority inference',async()=>{
 const input=await fixture('overture');const before=structuredClone(input);
 const report=await searchProvider('overture',{input,fetcher:{get:()=>{throw Error('unexpected network');}}});inert(report);
 assert.deepEqual(input,before);assert.equal(report.resources.length,0);assert.equal(report.leads.length,1);assert.deepEqual(report.leads[0].sources,input.features[0].properties.sources);assert.deepEqual(report.leads[0].licenses,['CC-0','CDLA-Permissive-2.0']);assert.equal(report.input.authority,'unreviewed');
});

test('unknown catalog terms and address-only metadata never imply licensed coordinates',async()=>{
 const data=await fixture('ckan');const d=data.result.results[0];delete d.license_id;delete d.license_title;delete d.license_url;delete d.resources[0].license_url;d.address='Example address';d.latitude=35;d.longitude=139;
 const report=await searchProvider('bodik',{catalogs:['https://catalog.example'],fetcher:transport(data)});inert(report);assert.equal(report.resources[0].rights.licenseUrl,null);assert.equal(report.resources[0].rights.status,'unknown');assert.equal(report.resources[0].coordinateAvailability,'unknown');
});

test('canonical candidates cap at twenty and propagate truncation, without mutating metadata',async()=>{
 const data=await fixture('ckan');data.result.results=data.result.results.slice(0,1);data.result.count=100;data.result.results[0].resources=Array.from({length:25},(_,i)=>({url:`https://publisher.example/${i}.csv`}));
 const report=await searchProvider('ckan',{fetcher:transport(data)});inert(report);assert.equal(report.resources.length,20);assert.equal(report.truncated,true);assert.ok(report.resources.every(r=>r.truncated));
});

test('403, 429, outage and malformed responses cannot create approvals or canonical records',async()=>{
 for(const response of [{status:403,blockerCodes:['accessBlocked']},{status:429,blockerCodes:['rateLimited']},{status:0,blockerCodes:['networkFailure']},{status:200,bytes:Buffer.from('{')},{status:200,bytes:Buffer.from(JSON.stringify({success:false}))}]){
  for(const id of ['ckan','openpoi']){const report=await searchProvider(id,{fetcher:{get:async()=>response}});inert(report);assert.equal(report.resources.length,0);assert.equal(report.leads.length,0);assert.ok(report.blockerCodes.length);}
 }
});

test('malformed POI records do not leak partial leads',async()=>{
 const report=await searchProvider('openpoi',{fetcher:transport({count:2,results:[{name:'喫煙所'},null]})});inert(report);assert.deepEqual(report.leads,[]);assert.ok(report.blockerCodes.includes('incompatibleFormat'));
});

test('CLI rejects unsafe configuration before transport and preserves existing output evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'provider-tests-'));try{
 const common=['--provider','ckan','--out',join(dir,'report.json'),'--cache',join(dir,'cache')];
 for(const extra of [['--remote'],['--max-candidates','21'],['--catalog','https://user:password@catalog.example'],['--catalog','file:///tmp/catalog'],['--provider','bodik']])await assert.rejects(main([...common,...extra]));
 await writeFile(join(dir,'input.json'),'{}');await assert.rejects(main([...common,'--input',join(dir,'input.json')]),/only for bounded Overture/);
 await writeFile(join(dir,'report.json.md'),'prior review');await assert.rejects(main(common),/Output already exists/);assert.equal(await readFile(join(dir,'report.json.md'),'utf8'),'prior review');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Overture catalog metadata and WAPI endpoint inventory are advisory, not canonical datasets',async()=>{
 const overture=await searchProvider('overture',{fetcher:transport({type:'Catalog',latest:'2026-09-23.0'})});inert(overture);assert.deepEqual(overture.resources,[]);assert.deepEqual(overture.leads,[]);assert.ok(overture.blockerCodes.includes('boundedPlacesExportRequired'));
 const wapi=await searchProvider('bodik-wapi',{fetcher:transport({paths:{'/public-facility':{},'/parks':{}}})});inert(wapi);assert.deepEqual(wapi.resources,[]);assert.ok(wapi.blockerCodes.includes('originalResourceReviewRequired'));
});

test('invalid or oversized provider payloads fail closed without silently accepting unbounded input',async()=>{
 await assert.rejects(searchProvider('ckan',{maxCandidates:0}),/1..20/);await assert.rejects(searchProvider('ckan',{catalogs:Array(4).fill('https://catalog.example')}),/1..3/);
 const input=await fixture('overture');for(const bad of [{...input,release:null},{...input,resourceUrl:'file:///tmp/places'},{...input,features:Array(1001).fill(input.features[0])}])await assert.rejects(searchProvider('overture',{input:bad}),/Bounded Overture/);
 const data=await fixture('ckan');data.result.results=Array(21).fill(data.result.results[0]);const report=await searchProvider('ckan',{fetcher:transport(data)});inert(report);assert.deepEqual(report.resources,[]);assert.equal(report.truncated,true);assert.ok(report.blockerCodes.includes('responseLimitExceeded'));
});

test('CKAN pagination makes at most three offset requests and discloses incomplete scan',async()=>{
 const data=await fixture('ckan');data.result.count=100;const calls=[];
 const report=await searchProvider('ckan',{maxPages:3,fetcher:{get:async url=>{calls.push(url);return {status:200,bytes:Buffer.from(JSON.stringify(data))};}}});
 inert(report);assert.deepEqual(calls.map(url=>new URL(url).searchParams.get('start')),['0','20','40']);assert.ok(calls.every(url=>new URL(url).searchParams.get('rows')==='20'));assert.equal(report.truncated,true);assert.equal(report.resources.length,1);
 await assert.rejects(searchProvider('ckan',{maxPages:4}),/1..3/);
});

test('duplicate exact resource URLs retain conflicting rights observations instead of overwriting terms',async()=>{
 const data=await fixture('ckan');const second=structuredClone(data.result.results[0]);second.id='second-catalog';second.license_url='https://publisher.example/restrictive-terms';second.license_title='Restricted';data.result.results.push(second);data.result.count=data.result.results.length;
 const report=await searchProvider('ckan',{fetcher:transport(data)});inert(report);assert.equal(report.resources.length,1);const r=report.resources[0];assert.equal(r.catalogObservations.length,2);assert.equal(r.catalogObservations[1].rights.licenseUrl,'https://publisher.example/restrictive-terms');assert.ok(r.blockerCodes.includes('catalogRightsDisagree'));assert.equal(r.rights.status,'unknown');
});

test('mixed prohibited-area dataset preserves an explicitly smoking-place resource as an unreviewed candidate',async()=>{
 const data=await fixture('ckan');data.result.results=data.result.results.slice(0,1);data.result.count=1;
 data.result.results[0].title='喫煙所・喫煙禁止区域';data.result.results[0].resources[0].name='公衆喫煙所';
 data.result.results[0].resources.push({name:'喫煙禁止区域',url:'https://publisher.example/prohibited.geojson'});
 const report=await searchProvider('ckan',{fetcher:transport(data)});inert(report);assert.equal(report.resources.length,1);assert.equal(report.resources[0].smokingExistence,'unknown');
});

test('captured response subsets replay offline with raw licenses, dates and attribution intact',async()=>{
 const c=await fixture('bodik-captured');const catalog=await searchProvider('bodik',{catalogs:['https://odm.bodik.jp'],fetcher:transport(c.response)});inert(catalog);assert.equal(catalog.resources.length,1);assert.equal(catalog.resources[0].datasetId,c.response.result.results[0].id);assert.equal(catalog.resources[0].rights.licenseId,c.response.result.results[0].license_id);
 const o=await fixture('openpoi-captured');const poi=await searchProvider('openpoi',{fetcher:transport(o.response)});inert(poi);assert.equal(poi.resources.length,0);assert.deepEqual(poi.leads[0].licenses,o.response.results[0].licenses);assert.deepEqual(poi.leads[0].attributions,o.response.results[0].attributions);
});

test('malformed license arrays cannot silently discard upstream obligations',async()=>{
 for(const field of ['licenses','attributions']){
  const data=await fixture('openpoi');data.results[0][field]=['CDLA-Permissive-2.0',{license:'restricted'}];
  const report=await searchProvider('openpoi',{fetcher:transport(data)});inert(report);assert.deepEqual(report.leads,[]);assert.ok(report.blockerCodes.includes('incompatibleFormat'));
 }
});


test('injected provider transports enforce the byte cap before JSON parsing, including padded valid JSON',async()=>{
 for(const id of ['ckan','openpoi','overture','bodik-wapi']){
  const report=await searchProvider(id,{fetcher:{get:async()=>({status:200,bytes:Buffer.alloc(PROVIDER_MAX_BYTES+1,32)})}});
  inert(report);assert.deepEqual(report.resources,[]);assert.deepEqual(report.leads,[]);assert.ok(report.blockerCodes.includes('payloadTooLarge'));assert.ok(!report.blockerCodes.includes('incompatibleFormat'));
 }
 const data=await fixture('ckan');const json=JSON.stringify(data);
 for(const extra of [0,1]){
  const bytes=Buffer.concat([Buffer.from(json),Buffer.alloc(PROVIDER_MAX_BYTES+extra-Buffer.byteLength(json),32)]);
  const report=await searchProvider('ckan',{fetcher:{get:async()=>({status:200,bytes})}});inert(report);
  assert.equal(report.resources.length,extra===0?1:0);assert.equal(report.blockerCodes.includes('payloadTooLarge'),extra===1);
 }
});

test('Overture optional source metadata remains raw and unknown without stopping other records',async()=>{
 const original=(await fixture('overture')).features[0];
 const variants=[{dataset:'Publisher'}, {dataset:'Publisher',license:null}, {license:'CC-0'}, {license:'CC-0',dataset:null}, {dataset:'',license:''}, {dataset:17,license:{future:'terms'}}, {dataset:'Publisher',license:'CC-0',futureMetadata:{terms:'unknown'}}];
 const input=await fixture('overture');input.features=variants.map((source,i)=>({...structuredClone(original),properties:{...structuredClone(original.properties),names:{primary:`喫煙所 ${i}`},sources:[{dataset:'Known upstream',license:'CC-0'},source]}}));input.features.push(structuredClone(original));
 const before=structuredClone(input);const report=await searchProvider('overture',{input});inert(report);
 assert.deepEqual(input,before);assert.equal(report.leads.length,variants.length+1);assert.deepEqual(report.blockerCodes,[]);
 for(const [i,source] of variants.entries()){
  const lead=report.leads[i];assert.deepEqual(lead.sources,input.features[i].properties.sources);assert.equal(lead.rights.status,'unknown');
  const missingLicense=typeof source.license!=='string'||!source.license.trim();const missingDataset=typeof source.dataset!=='string'||!source.dataset.trim();
  assert.equal(lead.blockerCodes.includes('licenseUnknown'),missingLicense);assert.equal(lead.blockerCodes.includes('sourceMetadataMissing'),missingLicense||missingDataset);
  assert.equal(lead.blockerCodes.includes('sourceMetadataUnknown'),Object.hasOwn(source,'futureMetadata'));
  assert.ok(lead.licenses.every(x=>typeof x==='string'&&x.trim()));assert.ok(lead.attributions.every(x=>typeof x==='string'&&x.trim()));
  assert.deepEqual(lead.licenses,missingLicense?['CC-0']:['CC-0',source.license]);
 }
 assert.deepEqual(report.leads.at(-1).licenses,['CC-0','CDLA-Permissive-2.0']);assert.equal(report.leads.at(-1).rights.status,'unknown');
});

test('CLI rejects oversized or truncated local Overture exports and accepts exactly the byte limit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'provider-byte-tests-'));try{
  const inputPath=join(dir,'input.json');const output=join(dir,'report.json');const args=['--provider','overture','--input',inputPath,'--out',output,'--cache',join(dir,'cache')];
  const json=JSON.stringify(await fixture('overture'));
  await writeFile(inputPath,Buffer.concat([Buffer.from(json),Buffer.alloc(PROVIDER_MAX_BYTES+1-Buffer.byteLength(json),32)]));
  await assert.rejects(main(args),error=>error.code==='payloadTooLarge');await assert.rejects(readFile(output),{code:'ENOENT'});
  await writeFile(inputPath,json.slice(0,-1));await assert.rejects(main(args),SyntaxError);await assert.rejects(readFile(output),{code:'ENOENT'});
  await writeFile(inputPath,Buffer.concat([Buffer.from(json),Buffer.alloc(PROVIDER_MAX_BYTES-Buffer.byteLength(json),32)]));await main(args);
  const report=JSON.parse(await readFile(output,'utf8'));inert(report);assert.equal(report.leads.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('direct Overture fixture input obeys the byte cap without truncating source metadata',async()=>{
 const input=await fixture('overture');input.features[0].properties.sources[0].futureMetadata='';
 const baseBytes=Buffer.byteLength(JSON.stringify(input));
 input.features[0].properties.sources[0].futureMetadata='x'.repeat(PROVIDER_MAX_BYTES-baseBytes);
 const report=await searchProvider('overture',{input});inert(report);assert.equal(report.leads.length,1);assert.ok(report.leads[0].blockerCodes.includes('sourceMetadataUnknown'));
 input.features[0].properties.sources[0].futureMetadata+='x';
 await assert.rejects(searchProvider('overture',{input}),error=>error.code==='payloadTooLarge');
});
