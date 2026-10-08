// Local discovery only. Provider permissions never grant smoking-place publication rights.
import {ckanResources} from './connectors.mjs';
import {sha256,assertByteLimit} from './fetch-cache.mjs';
import {manualReviewTriage} from './evaluator.mjs';

export const PROVIDER_MAX_BYTES=2*1024*1024;
export const ROLES = Object.freeze({canonical:'CANONICAL_CANDIDATE_PROVIDER',discovery:'DISCOVERY_ONLY_PROVIDER',coordinate:'COORDINATE_HELPER'});
export const PROVIDERS = Object.freeze({
 bodik:{id:'bodik',role:ROLES.canonical,kind:'ckan',catalogs:['https://data.bodik.jp','https://odm.bodik.jp'],docs:'https://odcs.bodik.jp/developers/',terms:{commercial:'resourceSpecific',storage:'resourceSpecific',redistribution:'resourceSpecific',reviewedOn:'2026-10-08'},attribution:'Preserve municipal publisher and exact resource terms; BODIK is the catalog, not the smoking-place authority.'},
 ckan:{id:'ckan',role:ROLES.canonical,kind:'ckan',catalogs:['https://catalog.data.metro.tokyo.lg.jp'],docs:'https://docs.ckan.org/en/latest/api/',terms:{commercial:'resourceSpecific',storage:'resourceSpecific',redistribution:'resourceSpecific',reviewedOn:'2026-10-08'},attribution:'CKAN software permissions do not license catalog contents. Review each publisher/resource.'},
 openpoi:{id:'openpoi',role:ROLES.discovery,kind:'openpoi',docs:'https://docs.openpoiapi.com/',terms:{commercial:'permitted',storage:'permittedWithRecordLicenses',redistribution:'recordSpecific',reviewedOn:'2026-10-08',url:'https://docs.openpoiapi.com/legal.html'},attribution:'OpenPOI API (https://openpoiapi.com/attribution.html); preserve licenses and attributions arrays and upstream notices.'},
 overture:{id:'overture',role:ROLES.discovery,kind:'overture',docs:'https://docs.overturemaps.org/getting-data/',terms:{commercial:'perSourcePermissive',storage:'perSourcePermissive',redistribution:'recordSpecific',reviewedOn:'2026-10-08',url:'https://docs.overturemaps.org/attribution/'},attribution:'Overture Maps Foundation, overturemaps.org; preserve sources[], their license and upstream notices. Places only, not other themes.'},
 'bodik-wapi':{id:'bodik-wapi',role:ROLES.discovery,kind:'wapi',docs:'https://www.bodik.jp/project/bodik-api/bodik-api-manual/',terms:{commercial:'resourceSpecific',storage:'resourceSpecific',redistribution:'resourceSpecific',reviewedOn:'2026-10-08'},attribution:'Standard dataset API: host/public-facility presence is not smoking-place evidence. Follow back to original municipal resource.'},
});
const smoking=/喫煙所|喫煙場所|喫煙場|smoking[ _-]*(?:area|room|place)/iu;
const nonPlace=/禁止|制限区域|調査|統計|利用者数|喫煙率|受動喫煙/iu;
const text=v=>typeof v==='string'&&v.trim()?v:null;
const strings=v=>{if(v===undefined||v===null)return [];if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw Error('Invalid license/attribution array');return [...v];};
const publicReference=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export const datasetMetadata=r=>({datasetId:r.datasetId??null,resourceId:r.resourceId??null,datasetUrl:r.datasetUrl??null,publisherPage:r.publisherPage??null,metadataModified:r.metadataModified??null,resourceModified:r.resourceModified??null});
export const rightsMetadata=r=>({status:'unknown',licenseId:r.licenseId??null,licenseName:r.licenseName??null,licenseUrl:r.licenseUrl??null,resourceLicense:r.resourceLicense??null,licenses:r.licenses??[],commercialReuse:'unknown',redistribution:'unknown'});
export const sourceAttribution=r=>({publisher:r.publisher??null,metadata:r.attribution??null,attributions:r.attributions??[]});

function canonicalResource(r,provider){
 const rawUrl=publicReference(r.url);if(!rawUrl)return null;
 const title=[text(r.title),text(r.resourceTitle)].filter(Boolean).join(' — ');
 const explicitResource=smoking.test(r.resourceTitle??'')&&!nonPlace.test(r.resourceTitle??'');
 if(!explicitResource&&(!smoking.test(r.title??'')||nonPlace.test(title)))return null;
 return {rawUrl,title,format:r.format??null,providerId:provider.id,providerRole:provider.role,
  publisher:r.publisher??null,providerRights:{commercial:provider.terms.commercial,storage:provider.terms.storage,redistribution:provider.terms.redistribution},...datasetMetadata(r),rights: rightsMetadata(r),attribution:sourceAttribution(r),
  licenseMetadata:r.license??null,attributionMetadata:r.attribution??null,
  matchingRowCount:null,coordinateAvailability:'unknown',coordinateColumns:[],
  smokingExistence:'unknown',coordinateAuthority:'unknown',currentOperation:'unknown',
  publicationStatus:'blocked',blockerCodes:['licenseUnknown','currentOperationUnknown','coordinateAuthorityReviewRequired','smokingExistenceReviewRequired'],truncated:false};
}
// Optional SourceItem fields never establish rights. Preserve raw metadata for human review.
function overtureMetadata(raw) {
 const sources=Array.isArray(raw)?raw:[];
 const licenses=sources.map(s=>text(s?.license)).filter(Boolean);
 const attributions=sources.map(s=>text(s?.dataset)).filter(Boolean);
 const known=new Set(['property','dataset','license','record_id','update_time','confidence','provider','resource','version','between']);
 const missing=!Array.isArray(raw)||!sources.length||sources.some(s=>!s||typeof s!=='object'||Array.isArray(s)||!text(s.license)||!text(s.dataset));
 const unknown=sources.some(s=>s&&typeof s==='object'&&Object.keys(s).some(k=>!known.has(k)));
 const licenseUnknown=!sources.length||sources.some(s=>!text(s?.license));
 return {licenses,attributions,blockerCodes:[...(licenseUnknown?['licenseUnknown']:[]),...(missing?['sourceMetadataMissing']:[]),...(unknown?['sourceMetadataUnknown']:[])]};
}
/** Never converts a generic host, category, name, score or API coordinate into accepted evidence. */
export function poiLead(record,provider,index,resourceUrl){
 const p=provider.id==='overture'?record.properties:record;
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid POI record');
 const name=provider.id==='overture'?p.names?.primary:p.name;
 const metadata=provider.id==='overture'?overtureMetadata(p.sources):null;
 const licenses=metadata?.licenses??strings(p.licenses);
 const attributions=metadata?.attributions??strings(p.attributions);
 const hint=smoking.test(name??'')||smoking.test(p.category??p.taxonomy?.primary??'');
 return {id:sha256(JSON.stringify([provider.id,resourceUrl,index,record])).slice(0,24),providerId:provider.id,providerRole:provider.role,
  rights:{status:'unknown',commercialReuse:'unknown',redistribution:'unknown'},resourceUrl,name:text(name),category:text(p.category??p.taxonomy?.primary),source:text(p.source),sources:p.sources??[],licenses,attributions,
  keywordSignal:hint,smokingExistence:'unknown',coordinateAuthority:'unknown',currentOperation:'unknown',publicationStatus:'blocked',
  coordinateSignal:provider.id==='overture'?record.geometry??null:{lat:p.lat??null,lng:p.lng??null,level:p.level??null},
  blockerCodes:['discoveryOnlyProvider','sourceChainReviewRequired','smokingExistenceReviewRequired','coordinateAuthorityReviewRequired',...(metadata?.blockerCodes??(!licenses.length?['licenseUnknown']:[]))]};
}

/** Transport is injected: CLI supplies existing FetchCache with public-URL validation and host stops. */
export async function searchProvider(providerId,{fetcher,catalogs,maxCandidates=20,maxPages=1,query='title:*喫煙*',input,revalidate=false}={}){
 const provider=PROVIDERS[providerId];if(!provider)throw Error('Unknown provider');
 if(!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>20)throw Error('maxCandidates must be 1..20');
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>3)throw Error('maxPages must be 1..3');
 if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('Invalid bounded query');
 if(catalogs&&(provider.kind!=='ckan'||!Array.isArray(catalogs)||catalogs.length<1||catalogs.length>3))throw Error('1..3 CKAN catalogs only');
 const result={provider:{...provider},resources:[],leads:[],fetches:[],blockerCodes:[],truncated:false,scanScope:'Bounded advisory scan; not nationwide completeness.',approvalAutomated:false,productionApproval:false};
 async function getJson(url){
  const r=await fetcher.get(url,{revalidate});result.fetches.push({url,status:r.status,sha256:r.sha256??null,fetchedAt:r.fetchedAt??null,cacheHit:r.cacheHit??false,blockerCodes:r.blockerCodes??[]});
  if(!r.bytes){result.blockerCodes.push(...(r.blockerCodes||['rawUnavailable']));return null;}
  try{assertByteLimit(r.bytes,PROVIDER_MAX_BYTES);return JSON.parse(Buffer.from(r.bytes).toString());}catch(error){result.blockerCodes.push(error.code==='payloadTooLarge'?'payloadTooLarge':'incompatibleFormat');return null;}
 }
 if(provider.kind==='ckan'){
  for(const base of catalogs??provider.catalogs){
   const u=new URL(base);if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw Error('Public unauthenticated CKAN URL required');
   if(!u.pathname.endsWith('/api/3/action/package_search'))u.pathname=u.pathname.replace(/\/$/,'')+'/api/3/action/package_search';
   u.search='';u.hash='';u.searchParams.set('q',query);u.searchParams.set('rows','20');u.searchParams.set('start','0');
   for(let page=0;page<maxPages;page++){
   u.searchParams.set('start',String(page*20));
   const data=await getJson(u.href);if(!data)break;
   if(data.success!==true||!Array.isArray(data.result?.results)||!Number.isInteger(data.result.count)||data.result.count<0){result.blockerCodes.push('incompatibleFormat');continue;}
   const more=data.result.count>(page*20+data.result.results.length);
   if(more&&page===maxPages-1)result.truncated=true;
   if(data.result.results.length>20){result.blockerCodes.push('responseLimitExceeded');result.truncated=true;continue;}
   for(const d of data.result.results){if(!d||typeof d!=='object'||!Array.isArray(d.resources)){result.blockerCodes.push('incompatibleFormat');continue;}
    if(d.resources.length>500){result.blockerCodes.push('responseLimitExceeded');result.truncated=true;continue;}
    for(const r of ckanResources(d,base)){const candidate=canonicalResource(r,provider);if(candidate)result.resources.push(candidate);}
   }
   if(!more||data.result.results.length===0)break;
   }
  }
 }else if(provider.kind==='openpoi'){
  const u=new URL('https://api.openpoiapi.com/v1/search');u.searchParams.set('q','喫煙所');u.searchParams.set('limit',String(maxCandidates));
  const data=await getJson(u.href);if(data){if(!Array.isArray(data.results)||data.results.length>maxCandidates||!Number.isInteger(data.count)||data.count!==data.results.length)result.blockerCodes.push('incompatibleFormat');
   else try{result.leads=data.results.map((r,i)=>poiLead(r,provider,i,u.href));result.truncated=data.count===maxCandidates;}catch{result.leads=[];result.blockerCodes.push('incompatibleFormat');}}
 }else if(provider.kind==='overture'){
  if(input){
   assertByteLimit(Buffer.from(JSON.stringify(input)),PROVIDER_MAX_BYTES);
   if(input.type!=='FeatureCollection'||!Array.isArray(input.features)||input.features.length>1000||!text(input.release)||!publicReference(input.resourceUrl))throw Error('Bounded Overture export requires FeatureCollection (<=1000), release and resourceUrl');
   // Export provenance is advisory. A locally supplied URL never establishes publisher authority.
   result.input={release:input.release,resourceUrl:input.resourceUrl,authority:'unreviewed'};
   const matches=input.features.filter(f=>f.properties?.addresses?.some(a=>a.country==='JP')&&smoking.test(f.properties?.names?.primary??''));
   result.leads=matches.slice(0,maxCandidates).map((r,i)=>poiLead(r,provider,i,input.resourceUrl));result.truncated=matches.length>maxCandidates;
  }else{
   const catalog=await getJson('https://stac.overturemaps.org/catalog.json');
   if(catalog&&catalog.type==='Catalog'&&text(catalog.latest))result.catalog={latest:catalog.latest};else if(catalog)result.blockerCodes.push('incompatibleFormat');
   result.blockerCodes.push('boundedPlacesExportRequired');result.scanScope='STAC metadata only; no Places rows queried. Use a bounded official Places export with release/resource provenance.';
  }
 }else{
  const spec=await getJson('https://wapi.bodik.jp/openapi.json');
  if(spec&&spec.paths&&typeof spec.paths==='object')result.endpointInventory=Object.keys(spec.paths).slice(0,100);else if(spec)result.blockerCodes.push('incompatibleFormat');
  result.blockerCodes.push('originalResourceReviewRequired');result.scanScope='WAPI schema inventory only; no generic public-facility rows fetched or treated as smoking evidence.';
 }
 const byUrl=new Map();
 for(const r of result.resources){
  const observation={...datasetMetadata(r),publisher:r.publisher,rights:r.rights,attribution:r.attribution};
  const prior=byUrl.get(r.rawUrl);
  if(prior){prior.catalogObservations.push(observation);if(JSON.stringify(prior.rights)!==JSON.stringify(r.rights))prior.blockerCodes.push('catalogRightsDisagree');}
  else byUrl.set(r.rawUrl,{...r,catalogObservations:[observation]});
 }
 const unique=[...byUrl.values()];result.truncated||=unique.length>maxCandidates;
 result.resources=unique.slice(0,maxCandidates).map(r=>({...r,truncated:result.truncated}));
 result.manualReviewQueue=result.resources.map(r=>({candidate:r.rawUrl,target:provider.id,...manualReviewTriage(r)}));
 result.targets=[];result.blockerCodes=[...new Set(result.blockerCodes)];return result;
}
