import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {FetchCache} from './fetch-cache.mjs';
const directory=dirname(fileURLToPath(import.meta.url));

/**
 * Report-only endpoint health for manifest catalog/home URLs. It never edits the manifest:
 * a repair is a reviewed manifest change to a publisher-official URL, never a search-result mirror.
 * Only same-host permanent redirects that resolve are offered as suggestions.
 */
export async function probeEndpoints(manifest,fetcher){
 const endpoints=[];for(const target of manifest.targets){for(const catalog of target.catalogs||[])endpoints.push({targetId:target.id,kind:'catalog:'+catalog.type,url:catalog.url});if(target.homepageUrl)endpoints.push({targetId:target.id,kind:'homepage',url:target.homepageUrl});}
 const results=[];
 for(const endpoint of endpoints){
  const r=await fetcher.get(endpoint.url,{followRedirects:false});const status=r?.status??null;let finding,suggestedUrl,redirectUrl;
  if(status>=200&&status<300)finding='ok';
  else if([404,410].includes(status))finding='notFound';
  else if([403,429].includes(status))finding='hostStopped';
  else if([301,302,303,307,308].includes(status)&&r.redirectUrl){redirectUrl=new URL(r.redirectUrl,endpoint.url).href;const permanent=[301,308].includes(status);
   if(new URL(redirectUrl).host!==new URL(endpoint.url).host)finding='crossHostRedirect';
   else if(!permanent)finding='temporaryRedirect';
   else{const destination=await fetcher.get(redirectUrl,{followRedirects:false});finding='permanentRedirect';if(destination?.status>=200&&destination.status<300)suggestedUrl=redirectUrl;}}
  else finding='unreachable';
  results.push({...endpoint,status,finding,...(redirectUrl?{redirectUrl}:{}),...(suggestedUrl?{suggestedUrl}:{}),...(r?.error?{error:r.error}:{})});
 }
 return results;
}

async function main(){const args=process.argv.slice(2);const option=(name,fallback)=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:fallback;};
 const manifest=JSON.parse(await readFile(option('manifest',resolve(directory,'manifest.json')),'utf8'));
 const fetcher=new FetchCache({directory:option('cache',resolve(directory,'.local/cache')),delayMs:Number(option('delay','500')),timeoutMs:Number(option('timeout','15000')),retries:0});
 const results=await probeEndpoints(manifest,fetcher);const out=option('out',resolve(directory,'.local/endpoint-probe.json'));await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(results,null,2)+'\n');
 const counts={};for(const r of results)counts[r.finding]=(counts[r.finding]||0)+1;console.log(JSON.stringify(counts));
 for(const r of results.filter(r=>r.finding!=='ok'))console.log([r.targetId,r.kind,r.finding,r.status,r.url,r.redirectUrl||''].join('\t'));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
