import {parseDelimited} from './scanner.mjs';
const rawExtension=/\.(csv|tsv|json|geojson|kml|kmz|zip|shp|gpkg)(?:$|[?#])/i;
export function pageResources(text,url){const resources=[];for(const [,link,label] of text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{const resolved=new URL(link.replace(/&amp;/g,'&'),url).href;if(rawExtension.test(resolved))resources.push({url:resolved,datasetUrl:url,title:label.replace(/<[^>]*>/g,'').trim()});}catch{}}return resources;}
export async function discoverResources(target,fetcher,{maxPages=3,maxResources=30}={}) {
 const resources=[...(target.rawResources||[])];const fetches=[];const blockers=[];let truncated=false;
 const catalogs=target.catalogs?.length?target.catalogs:target.homepageUrl?[{type:'static',url:target.homepageUrl},...(target.urls||[]).filter(u=>u!==target.homepageUrl).slice(0,maxPages).map(url=>({type:'static',url}))]:[];
 for(const catalog of catalogs){
  if(catalog.type==='ckan'){
   for(const query of ['喫煙 OR 灰皿 OR smoking','施設 OR facility'])for(let page=0;page<maxPages;page++){
    const u=new URL(catalog.url);if(!u.pathname.includes('package_search'))u.pathname=u.pathname.replace(/\/$/,'')+'/api/3/action/package_search';u.searchParams.set('q',query);if(catalog.organization)u.searchParams.set('fq','organization:'+catalog.organization);u.searchParams.set('rows','20');u.searchParams.set('start',String(page*20));
    const r=await fetcher.get(u.href);fetches.push({url:u.href,status:r.status,cacheHit:r.cacheHit});if(!r.bytes){blockers.push(...(r.blockerCodes||[]));break;}try{const data=JSON.parse(r.bytes.toString());if(data.success===false)throw Error('CKAN action failed');const result=data.result;if(!Array.isArray(result?.results))throw Error('Missing CKAN results');for(const d of result.results)for(const v of d.resources||[])resources.push({url:v.url,format:v.format?.toLowerCase(),title:d.title,publisher:d.organization?.title||d.author||null,publisherScope:catalog.organization?'organizationFiltered':'portalWide',datasetUrl:new URL('/dataset/'+d.name,catalog.url).href,license:d.license_url||d.license_id,attribution:d.author||d.organization?.title});if(result.count<=(page+1)*20)break;if(page===maxPages-1)truncated=true;}catch{blockers.push('incompatibleFormat');break;}
   }
  }else if(catalog.type==='arcgis'){
   const u=new URL(catalog.url);u.searchParams.set('f','json');const r=await fetcher.get(u.href);fetches.push({url:u.href,status:r.status});if(!r.bytes){blockers.push(...(r.blockerCodes||[]));continue;}try{const data=JSON.parse(r.bytes.toString());for(const service of data.results||[]){if(service.url&&/FeatureServer|MapServer/.test(service.url)){const nested=await discoverResources({catalogs:[{type:'arcgis',url:service.url}]},fetcher,{maxPages:1,maxResources:maxResources-resources.length});resources.push(...nested.resources);fetches.push(...nested.fetches);blockers.push(...nested.blockerCodes);truncated||=nested.truncated;}if(resources.length>=maxResources){truncated=true;break;}}for(const layer of data.layers||[]){if(resources.length>=maxResources){truncated=true;break;}const q=new URL(catalog.url.replace(/\/$/,'')+'/'+layer.id+'/query');q.searchParams.set('where','1=1');q.searchParams.set('outFields','*');q.searchParams.set('f','geojson');q.searchParams.set('resultRecordCount','2000');resources.push({url:q.href,format:'geojson',title:layer.name,datasetUrl:catalog.url,license:data.copyrightText||null});}}catch{blockers.push('incompatibleFormat');}
  }else{
   const r=await fetcher.get(catalog.url);fetches.push({url:catalog.url,status:r.status,cacheHit:r.cacheHit});if(!r.bytes){blockers.push(...(r.blockerCodes||[]));continue;}
   if(rawExtension.test(catalog.url)&&catalog.type!=='csvIndex')resources.push({url:catalog.url,format:catalog.format,datasetUrl:catalog.url});
   else if(['json','csvIndex'].includes(catalog.type)){try{const text=r.bytes.toString();const values=catalog.type==='json'?JSON.parse(text):parseDelimited(text).flatMap(row=>Object.entries(row).filter(([,v])=>/^https?:\/\//.test(v)).map(([,url])=>({url})));for(const item of Array.isArray(values)?values:values.resources||[])if(item.url&&/^https?:/.test(item.url))resources.push(item);}catch{blockers.push('incompatibleFormat');}}
   else{
    const text=r.bytes.toString();resources.push(...pageResources(text,catalog.url));
    // One bounded, same-host dataset-page level. No site-wide crawler.
    const links=[...text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].filter(([,href,label])=>/喫煙|灰皿|smoking|open.?data|オープンデータ|dataset/i.test(href+' '+label));let visited=0;
    for(const [,href] of links){if(visited>=maxPages){truncated=true;break;}let next;try{next=new URL(href.replace(/&amp;/g,'&'),catalog.url);}catch{continue;}if(next.host!==new URL(catalog.url).host||rawExtension.test(next.href)||next.href===catalog.url)continue;visited++;const page=await fetcher.get(next.href);fetches.push({url:next.href,status:page.status});if(page.bytes)resources.push(...pageResources(page.bytes.toString(),next.href));else blockers.push(...(page.blockerCodes||[]));}
   }
  }
 }
 const unique=[...new Map(resources.filter(r=>r.url&&/^https?:/.test(r.url)).map(r=>[r.url,r])).values()];if(unique.length>maxResources)truncated=true;
 return {resources:unique.sort((a,b)=>Number(/喫煙|灰皿|smoking/i.test(b.title||''))-Number(/喫煙|灰皿|smoking/i.test(a.title||''))).slice(0,maxResources),fetches,blockerCodes:[...new Set(blockers)],truncated};
}
