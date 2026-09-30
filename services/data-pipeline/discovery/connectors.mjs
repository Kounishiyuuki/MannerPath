import {parseDelimited,decodeText} from './scanner.mjs';
const rawExtension=/\.(csv|tsv|json|geojson|kml|kmz|zip|shp|gpkg|xlsx?)(?:$|[?#])/i;
// Municipal CMSs (SHIRASAGI, Joruri, CKAN front ends) label extension-less download links with the format.
const labelFormat=/(?:^|[\s\[(（【])(CSV|TSV|XLSX|XLS|JSON|GeoJSON|KML|KMZ|ZIP|SHP)(?=$|[\s\]):：）】,、])/i;
const anchors=text=>[...text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(([,attrs,label])=>({href:attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1],attrs,label:label.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()})).filter(a=>a.href);
/** HTML is decoded by BOM / <meta charset>; bytes that decode neither way yield no links rather than mojibake. */
export function htmlText(bytes,contentType=''){const head=Buffer.from(bytes.subarray(0,2048)).toString('latin1');const meta=head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];try{return decodeText(bytes,{encoding:/charset=/i.test(contentType)?undefined:meta,contentType}).text;}catch{return '';}}
export function pageResources(text,url){const resources=[];for(const {href,label} of anchors(text)){let resolved;try{resolved=new URL(href.replace(/&amp;/g,'&'),url);}catch{continue;}if(!/^https?:$/.test(resolved.protocol))continue;const byExt=resolved.href.match(rawExtension);const byLabel=!byExt&&label.match(labelFormat);
 // A label-typed link must not be ordinary navigation to another HTML page with a format word in it.
 if(byLabel&&/\.(?:html?|php|aspx?)$|\/$/i.test(resolved.pathname))continue;
 if(byExt||byLabel)resources.push({url:resolved.href,datasetUrl:url,title:label,format:(byExt?.[1]||byLabel[1]).toLowerCase(),discoveredBy:byExt?'hrefExtension':'linkLabel'});}return resources;}
/** Ordinary rel=next / 次へ pagination on the same host only. */
export function nextPage(text,url){for(const {href,attrs,label} of anchors(text)){if(!/rel=["']?next/i.test(attrs)&&!/^(?:次へ|次のページ|次の\d+件|next|»|>)$/i.test(label))continue;try{const next=new URL(href.replace(/&amp;/g,'&'),url);if(next.host===new URL(url).host&&next.href!==url)return next.href;}catch{}}return null;}
export async function discoverResources(target,fetcher,{maxPages=3,maxResources=30,followPattern=/喫煙|灰皿|smoking|open.?data|オープンデータ|dataset/i}={}) {
 const resources=[...(target.rawResources||[])];const fetches=[];const blockers=[];let truncated=false;
 const catalogs=target.catalogs?.length?target.catalogs:target.homepageUrl?[{type:'static',url:target.homepageUrl},...(target.urls||[]).filter(u=>u!==target.homepageUrl).slice(0,maxPages).map(url=>({type:'static',url}))]:[];
 for(const catalog of catalogs){
  if(catalog.type==='ckan'){
   for(const query of ['喫煙 OR 灰皿 OR smoking','施設 OR facility'])for(let page=0;page<maxPages;page++){
    const u=new URL(catalog.url);if(!u.pathname.includes('package_search'))u.pathname=u.pathname.replace(/\/$/,'')+'/api/3/action/package_search';u.searchParams.set('q',query);if(catalog.organization)u.searchParams.set('fq','organization:'+catalog.organization);u.searchParams.set('rows','20');u.searchParams.set('start',String(page*20));
    const r=await fetcher.get(u.href);fetches.push({url:u.href,status:r.status,cacheHit:r.cacheHit});if(!r.bytes){blockers.push(...(r.blockerCodes||[]));break;}try{const data=JSON.parse(r.bytes.toString());if(data.success===false)throw Error('CKAN action failed');const result=data.result;if(!Array.isArray(result?.results))throw Error('Missing CKAN results');for(const d of result.results)for(const v of d.resources||[])resources.push({url:v.url,format:v.format?.toLowerCase(),title:d.title,publisher:d.organization?.title||d.author||null,publisherScope:catalog.organization?'organizationFiltered':'portalWide',datasetUrl:new URL('/dataset/'+d.name,catalog.url).href,license:d.license_url||d.license_id,attribution:d.author||d.organization?.title});if(result.count<=(page+1)*20)break;if(page===maxPages-1)truncated=true;}catch{blockers.push('incompatibleFormat');break;}
   }
  }else if(catalog.type==='arcgis'){
   const u=new URL(catalog.url);u.searchParams.set('f','json');const r=await fetcher.get(u.href);fetches.push({url:u.href,status:r.status});if(!r.bytes){blockers.push(...(r.blockerCodes||[]));continue;}try{const data=JSON.parse(r.bytes.toString());for(const service of data.results||[]){if(service.url&&/FeatureServer|MapServer/.test(service.url)){const nested=await discoverResources({catalogs:[{type:'arcgis',url:service.url}]},fetcher,{maxPages:1,maxResources:maxResources-resources.length,followPattern});resources.push(...nested.resources);fetches.push(...nested.fetches);blockers.push(...nested.blockerCodes);truncated||=nested.truncated;}if(resources.length>=maxResources){truncated=true;break;}}for(const layer of data.layers||[]){if(resources.length>=maxResources){truncated=true;break;}const q=new URL(catalog.url.replace(/\/$/,'')+'/'+layer.id+'/query');q.searchParams.set('where','1=1');q.searchParams.set('outFields','*');q.searchParams.set('f','geojson');q.searchParams.set('resultRecordCount','2000');resources.push({url:q.href,format:'geojson',title:layer.name,datasetUrl:catalog.url,license:data.copyrightText||null});}}catch{blockers.push('incompatibleFormat');}
  }else{
   const r=await fetcher.get(catalog.url);fetches.push({url:catalog.url,status:r.status,cacheHit:r.cacheHit});if(!r.bytes){blockers.push(...(r.blockerCodes||[]));continue;}
   if(rawExtension.test(catalog.url)&&catalog.type!=='csvIndex')resources.push({url:catalog.url,format:catalog.format,datasetUrl:catalog.url});
   else if(['json','csvIndex'].includes(catalog.type)){try{const text=decodeText(r.bytes,{contentType:r.contentType||''}).text;const values=catalog.type==='json'?JSON.parse(text):parseDelimited(text).flatMap(row=>Object.entries(row).filter(([,v])=>/^https?:\/\//.test(v)).map(([,url])=>({url})));for(const item of Array.isArray(values)?values:values.resources||[])if(item.url&&/^https?:/.test(item.url))resources.push(item);}catch{blockers.push('incompatibleFormat');}}
   else{
    let text=htmlText(r.bytes,r.contentType);resources.push(...pageResources(text,catalog.url));
    // Listing pagination through ordinary next links, bounded by maxPages.
    const listings=[text];for(let url=catalog.url,page=1;page<maxPages;page++){const next=nextPage(listings.at(-1),url);if(!next)break;const p=await fetcher.get(next);fetches.push({url:next,status:p.status,cacheHit:p.cacheHit});if(!p.bytes){blockers.push(...(p.blockerCodes||[]));break;}url=next;listings.push(htmlText(p.bytes,p.contentType));resources.push(...pageResources(listings.at(-1),next));if(page===maxPages-1&&nextPage(listings.at(-1),next))truncated=true;}
    // One bounded, same-host dataset-page level. No site-wide crawler.
    const links=listings.flatMap(anchors).filter(({href,label})=>followPattern.test(href+' '+label));let visited=0;const seen=new Set([catalog.url]);
    for(const {href} of links){let next;try{next=new URL(href.replace(/&amp;/g,'&'),catalog.url);}catch{continue;}next.hash='';if(next.host!==new URL(catalog.url).host||rawExtension.test(next.href)||seen.has(next.href))continue;if(visited>=maxPages){truncated=true;break;}seen.add(next.href);visited++;const page=await fetcher.get(next.href);fetches.push({url:next.href,status:page.status,cacheHit:page.cacheHit});if(page.bytes)resources.push(...pageResources(htmlText(page.bytes,page.contentType),next.href));else blockers.push(...(page.blockerCodes||[]));}
   }
  }
 }
 const unique=[...new Map(resources.filter(r=>r.url&&/^https?:/.test(r.url)).map(r=>[r.url,r])).values()];if(unique.length>maxResources)truncated=true;
 const rank=r=>Number(/喫煙|灰皿|smoking/i.test(r.title||''))*4+Number(/施設|facility/i.test(r.title||''))*2+Number(/^xlsx?$/.test(r.format||'')||/\.xlsx?(?:$|[?#])/i.test(r.url));
 return {resources:unique.sort((a,b)=>rank(b)-rank(a)).slice(0,maxResources),fetches,blockerCodes:[...new Set(blockers)],truncated};
}
