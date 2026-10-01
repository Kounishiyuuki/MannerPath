import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const defaultDirectory=dirname(fileURLToPath(import.meta.url));
import {FetchCache,sha256} from './fetch-cache.mjs';
import {inspectPayload} from './scanner.mjs';
import {loadState,saveState} from './state.mjs';
import {resourceStatus,targetStatus} from './evaluator.mjs';
import {buildReport,markdownReport} from './report.mjs';
import {discoverResources} from './connectors.mjs';
const scanFields=['sha256','format','rawRowCount','matchingRowCount','placeKeywordRowCount','matchingValues','categoryInventory','coordinateAvailability','coordinateColumns','geometryTypes','possibleCrs','blockerCodes','encoding','sheets','usedSheets','matchingSheets','archiveMembers','inspectionNote','inspectionNotes','error','truncated'];
const pickScan=r=>Object.fromEntries(scanFields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const gisRows=rows=>Buffer.from(JSON.stringify({type:'FeatureCollection',features:rows.map(row=>row.properties?{type:'Feature',...row}:{type:'Feature',properties:row})}));
/** Format dispatch: text formats, workbooks, KMZ/SHP/GPKG, and plain ZIPs of tabular members. */
export async function inspectBytes(bytes,{url,format,contentType},depth=0){
 let scan=inspectPayload(bytes,{url,format,contentType});
 if(scan.spreadsheet||['xls','xlsx'].includes(scan.format)&&scan.blockerCodes.includes('incompatibleFormat')&&!scan.error){const {inspectSpreadsheet}=await import('./spreadsheet.mjs');return inspectSpreadsheet(bytes);}
 if(!['kmz','zip','shp','gpkg'].includes(scan.format))return scan;
 try{const {inspectGisPayload}=await import('./gis.mjs');const gis=await inspectGisPayload(bytes,scan.format);if(gis.kml)return {...inspectPayload(gis.kml,{format:'kml'}),format:scan.format};if(gis.rows)return {...inspectPayload(gisRows(gis.rows),{format:'geojson'}),format:scan.format,possibleCrs:gis.possibleCrs??null,geometryTypes:gis.geometryTypes||[],inspectionNotes:gis.notes};}
 catch(error){scan.inspectionNote=error.message;if(scan.format!=='zip'||depth>0)return scan;
  // Not a SHP archive: inspect supported tabular/KML members (one level deep, no nested archives).
  try{const {readZipMembers}=await import('./gis.mjs');const members=[...readZipMembers(bytes)].filter(([name])=>/\.(csv|tsv|json|geojson|kml|xlsx?)$/i.test(name));if(!members.length)return scan;
   const parts=[];for(const [name,body] of members)parts.push({member:name,...await inspectBytes(body,{url:'https://local/'+encodeURIComponent(name.split('/').pop()),format:name.split('.').pop().toLowerCase(),contentType:''},depth+1)});
   const ok=parts.filter(p=>p.rawRowCount!=null);
   return {...scan,blockerCodes:ok.length?[...new Set(ok.flatMap(p=>p.blockerCodes))]:['incompatibleFormat'],rawRowCount:ok.length?ok.reduce((n,p)=>n+p.rawRowCount,0):null,matchingRowCount:ok.reduce((n,p)=>n+p.matchingRowCount,0),placeKeywordRowCount:ok.reduce((n,p)=>n+(p.placeKeywordRowCount||0),0),matchingValues:ok.flatMap(p=>p.matchingValues.map(v=>({...v,member:p.member}))).slice(0,100),categoryInventory:Object.assign({},...ok.map(p=>p.categoryInventory)),coordinateAvailability:ok.length&&ok.every(p=>p.coordinateAvailability==='all')?'all':ok.some(p=>['all','partial'].includes(p.coordinateAvailability))?'partial':'missing',archiveMembers:parts.map(p=>({member:p.member,format:p.format,sha256:p.sha256,rawRowCount:p.rawRowCount,matchingRowCount:p.matchingRowCount,blockerCodes:p.blockerCodes,sheets:p.sheets})),inspectionNote:'ZIP of tabular members'};
  }catch(inner){scan.inspectionNote+='; '+inner.message;return scan;}}
 return scan;
}
export async function runDiscovery({manifest,statePath,cacheDirectory,fetcher,limit=Infinity,revalidate=false,rescan=false,pass=null,discoveryOptions={},onTarget=()=>{}}){
 // A named pass (e.g. v2) is a resumable rescan: completed targets of that pass are skipped after an interruption.
 if(pass)rescan=true;
 fetcher??=new FetchCache({directory:cacheDirectory});const state=await loadState(statePath);
 const targets=Array.isArray(manifest)?manifest:manifest.targets;let completed=0;let saveQueue=Promise.resolve();
 const pending=targets.filter(target=>pass?!state.targets[target.id]?.passes?.[pass]:!state.targets[target.id]?.completedAt||revalidate||rescan).slice(0,limit);let cursor=0;
 async function worker(){while(cursor<pending.length){const target=pending[cursor++];

  const discovery=await discoverResources(target,fetcher,discoveryOptions);if(rescan){const old=state.targets[target.id];discovery.truncated||=old?.truncated||false;const seen=new Set(discovery.resources.map(r=>r.url));for(const url of old?.resourceUrls||[])if(!seen.has(url)&&state.resources[url])discovery.resources.push({...state.resources[url],url});}const candidateIds=[];const priorUrls=new Set((target.priorResearch||[]).filter(p=>['rawScanned','implemented'].includes(p.status)).flatMap(p=>p.rawUrls||[]).map(u=>typeof u==='string'?u:u.url));
  for(const resource of discovery.resources){
   if(!revalidate&&priorUrls.has(resource.url)&&(!state.resources[resource.url]||state.resources[resource.url].status==='priorInspected')){state.resources[resource.url]={...resource,...target.priorResearch.filter(p=>['rawScanned','implemented'].includes(p.status)).sort((a,b)=>Number(Boolean(b.sha256))-Number(Boolean(a.sha256))).find(p=>(p.rawUrls||[]).some(u=>(typeof u==='string'?u:u.url)===resource.url)),priorResearch:target.priorResearch,status:'priorInspected',blockerCodes:[...new Set([...(target.priorResearch.filter(p=>['rawScanned','implemented'].includes(p.status)).sort((a,b)=>Number(Boolean(b.sha256))-Number(Boolean(a.sha256))).find(p=>(p.rawUrls||[]).some(u=>(typeof u==='string'?u:u.url)===resource.url))?.blockerCodes||[]),'duplicateKnownResearch'])]};candidateIds.push(resource.url);continue;}
   if(state.resources[resource.url]&&!revalidate&&!rescan){candidateIds.push(resource.url);continue;}
   // Within one pass a resource shared by several targets is inspected once.
   if(pass&&state.resources[resource.url]?.passes?.includes(pass)){candidateIds.push(resource.url);continue;}
   const previous=state.resources[resource.url];
   const fetched=await fetcher.get(resource.url,{revalidate,cachedUrl:previous?.url});let scan;
   if(fetched.bytes){const duplicate=Object.entries(state.resources).find(([url,r])=>url!==resource.url&&r.sha256===fetched.sha256&&r.inspectionSha256===fetched.sha256&&r.status!=='priorInspected');
    // Identical bytes published under several URLs are inspected once; each URL keeps its own fetch metadata.
    scan=duplicate?{...pickScan(duplicate[1]),duplicateOf:duplicate[0]}:await inspectBytes(fetched.bytes,{url:resource.url,format:resource.format,contentType:fetched.contentType});}
   const {bytes,...metadata}=fetched;
   // A rescan never erases what an earlier pass established; changed evidence is kept side by side.
   const history=previous&&previous.status!=='priorInspected'&&(previous.sha256!==fetched.sha256||String(previous.blockerCodes)!==String(scan?.blockerCodes))?[...(previous.history||[]),{scanTimestamp:previous.scanTimestamp,sha256:previous.sha256,status:previous.status,blockerCodes:previous.blockerCodes,fetchStatus:previous.fetchStatus}]:previous?.history;
   state.resources[resource.url]={...resource,...metadata,...scan,...(history?{history}:{}),sha256:fetched.sha256,rawFormat:resource.format||scan?.format,inspectionSha256:scan?.sha256,jurisdiction:target.name,prefecture:target.prefecture,publisher:resource.publisher||target.publisher,publisherScope:resource.publisher?'datasetOwner':'targetUnverified',datasetTitle:resource.title||null,datasetUrl:resource.datasetUrl||null,rawUrl:resource.url,licenseMetadata:resource.license||null,attributionMetadata:resource.attribution||null,fetchStatus:fetched.status,scanTimestamp:new Date().toISOString(),priorResearch:target.priorResearch||[],status:resourceStatus(scan),...(pass?{passes:[...new Set([...(previous?.passes||[]),pass])]}:{})};candidateIds.push(resource.url);
  }
  const results=candidateIds.map(id=>state.resources[id]);const blockers=[...new Set([...discovery.blockerCodes,...results.flatMap(r=>r.blockerCodes||[])])];const status=targetStatus(results,blockers);
  const priorTarget=state.targets[target.id];const passes={...(priorTarget?.passes||{}),...(pass?{[pass]:{scannedAt:new Date().toISOString(),resources:results.length,spreadsheetResources:results.filter(r=>['xls','xlsx'].includes(r.format)).length,labelDiscoveredResources:discovery.resources.filter(r=>r.discoveredBy==='linkLabel').length}}:{})};
  state.targets[target.id]={...(priorTarget?.deepReview ? {deepReview:priorTarget.deepReview} : {}),...(priorTarget?{previousBlockerCodes:[...new Set([...(priorTarget.previousBlockerCodes||[]),...(priorTarget.blockerCodes||[])])]}:{}),...(Object.keys(passes).length?{passes}:{}),status,firstScannedAt:priorTarget?.firstScannedAt||priorTarget?.completedAt||new Date().toISOString(),liveFetches:priorTarget?.liveFetches||priorTarget?.fetches||discovery.fetches,completedAt:new Date().toISOString(),fetches:discovery.fetches,resourceUrls:candidateIds,blockerCodes:blockers,truncated:discovery.truncated||results.some(r=>r.truncated),priorState:target.state||target.seedStatus||null};saveQueue=saveQueue.then(async()=>{await saveState(statePath,state);});await saveQueue;completed++;await onTarget(target,state.targets[target.id]);
 }}
 await Promise.all(Array.from({length:4},()=>worker()));
 return state;
}
export function cacheOnlyFetcher(directory){return {async get(url,{cachedUrl,redirects=0}={}){
 try{const metadata=JSON.parse(await readFile(resolve(directory,sha256(cachedUrl||url)+'.json'),'utf8'));if(metadata.redirectUrl&&redirects<5){try{return await this.get(new URL(metadata.redirectUrl,cachedUrl||url).href,{redirects:redirects+1});}catch{ return {...metadata,cacheOnly:true};}}if(!metadata.sha256)return {...metadata,cacheOnly:true};const bytes=await readFile(resolve(directory,metadata.sha256+'.bin'));if(sha256(bytes)!==metadata.sha256)throw Error('Cache hash mismatch');return {...metadata,bytes,cacheHit:true};}
 catch(error){let stopped;try{stopped=JSON.parse(await readFile(resolve(directory,'stopped-hosts.json'),'utf8'));}catch(stopError){if(stopError.code!=='ENOENT')throw stopError;}const status=stopped?.[new URL(url).hostname];if(status===403||status===429)return {url,status,blockerCodes:[status===403?'accessBlocked':'rateLimited'],cacheOnly:true,hostStopped:true};return {url,status:null,blockerCodes:['rawUnavailable'],cacheOnly:true,error:'No verified cached payload: '+error.message};}
 }};}

async function main(){const args=process.argv.slice(2);const option=(name,fallback)=>{const index=args.indexOf('--'+name);return index>=0?args[index+1]:fallback;};if(args.includes('--reference-leads')){if(option('reference-leads')!=='osm')throw Error('Only osm reference leads are supported');const {runReferenceLeads}=await import('./reference-leads.mjs');const manifest=JSON.parse(await readFile(option('manifest',resolve(defaultDirectory,'manifest.json')),'utf8'));const result=await runReferenceLeads({manifest,inputPath:option('reference-input',null),outputPath:option('reference-queue',null)});console.log(JSON.stringify(result));console.log('Reference-only: no discovery state, approval, ingest or publication.');return;}const manifestPath=option('manifest',resolve(defaultDirectory,'manifest.json'));const statePath=option('state',resolve(defaultDirectory,'.local/state.json'));const report=option('report',resolve(defaultDirectory,'.local/candidates.json'));const manifest=JSON.parse(await readFile(manifestPath,'utf8'));const cacheDirectory=option('cache',resolve(defaultDirectory,'.local/cache'));const fetcher=args.includes('--cache-only')?cacheOnlyFetcher(cacheDirectory):new FetchCache({directory:cacheDirectory,delayMs:Number(option('delay','500')),timeoutMs:Number(option('timeout','15000')),retries:Number(option('retries','1'))});const state=await runDiscovery({manifest,statePath,fetcher,limit:Number(option('limit','Infinity')),revalidate:args.includes('--revalidate'),rescan:args.includes('--rescan'),pass:option('pass',null),discoveryOptions:{maxPages:Number(option('max-pages','3')),maxResources:Number(option('max-resources','30'))},onTarget:(target,result)=>console.log(target.id+': '+result.status+' ('+result.resourceUrls.length+' resources)')});await mkdir(dirname(report),{recursive:true});const reviewsPath=option('reviews',null);const reviewInput=reviewsPath?JSON.parse(await readFile(reviewsPath,'utf8')):[];const result=buildReport(manifest,state,Array.isArray(reviewInput)?reviewInput:reviewInput.reviews||[]);await writeFile(report,JSON.stringify(result,null,2)+'\n');await writeFile(report.replace(/\.json$/i,'')+'.md',markdownReport(result));console.log('Discovery never approves or publishes sources.');}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
