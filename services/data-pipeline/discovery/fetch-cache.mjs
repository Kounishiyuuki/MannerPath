import {createReadStream} from 'node:fs';
import {mkdir, readFile, writeFile,rename} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// One byte boundary for network streams, cached bodies, files and injected transport bytes.
export function assertByteLimit(bytes,maxBytes) {
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid byte limit');
 if(!(bytes instanceof Uint8Array))throw Error('Expected byte payload');
 if(bytes.byteLength>maxBytes){const error=Error('Payload exceeds configured byte limit');error.code='payloadTooLarge';throw error;}
 return bytes;
}
async function readBoundedBytes(stream,maxBytes) {
 const chunks=[];let size=0;
 for await(const chunk of stream){assertByteLimit(chunk,maxBytes);size+=chunk.byteLength;
  if(size>maxBytes){const error=Error('Payload exceeds configured byte limit');error.code='payloadTooLarge';throw error;}
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
}
export async function readBoundedFile(path,maxBytes) {
 const stream=createReadStream(path,{highWaterMark:Math.min(maxBytes+1,64*1024)});
 try{return await readBoundedBytes(stream,maxBytes);}finally{stream.destroy();}
}
export async function validatePublicUrl(url){
 const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('Only unauthenticated public HTTP(S) URLs allowed');
 const host=parsed.hostname.replace(/^\[|\]$/g,'');if(host==='localhost'||host.endsWith('.localhost'))throw Error('Private destination forbidden');
 const addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true});
 for(const {address} of addresses){const v=address.toLowerCase();if(isIP(v)===4){const [a,b]=v.split('.').map(Number);if(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a>=224||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19))throw Error('Non-public destination forbidden');}else if(v==='::'||v==='::1'||/^f[cd]/.test(v)||/^fe[89ab]/.test(v)||v.startsWith('::ffff:'))throw Error('Non-public destination forbidden');}
}
export class FetchCache {
  constructor({directory, fetchImpl=fetch, validateUrl=validatePublicUrl, delayMs=500, timeoutMs=15000, retries=1, maxBytes=20*1024*1024, sleep=ms=>new Promise(r=>setTimeout(r,ms)), now=Date.now}={}) {
    Object.assign(this,{directory,fetchImpl,validateUrl,delayMs,timeoutMs,retries,maxBytes,sleep,now}); this.queues=new Map(); this.stopped=new Map(); this.last=new Map(); this.stopWrite=Promise.resolve();
  }
  async get(url,{revalidate=false,redirects=0,followRedirects=true}={}) {
    let parsed;try{parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw Error('Unsupported URL protocol');}catch(error){return {url,status:null,blockerCodes:['accessBlocked'],error:error.message};}
    const host=parsed.hostname; const previous=this.queues.get(host)||Promise.resolve();
    const work=previous.catch(()=>{}).then(()=>this.fetchOne(url,host,revalidate)); this.queues.set(host,work.catch(()=>{})); const result=await work; if(result.redirectUrl&&followRedirects&&redirects<5){let destination;try{destination=new URL(result.redirectUrl,url).href;}catch(error){return {...result,blockerCodes:['rawUnavailable'],error:'Malformed redirect: '+error.message};}return this.get(destination,{revalidate,redirects:redirects+1});} return result;
  }
  async recordFailure(url,result){await writeFile(join(this.directory,sha256(url)+'.json'),JSON.stringify({...result,recordedAt:new Date(this.now()).toISOString()},null,2)+'\n');return result;}
  async fetchOne(url,host,revalidate) {
    await mkdir(this.directory,{recursive:true}); this.stopInitialization??=(async()=>{try{const stored=JSON.parse(await readFile(join(this.directory,'stopped-hosts.json'),'utf8'));if(!stored||typeof stored!=='object'||Array.isArray(stored)||Object.values(stored).some(status=>status!==403&&status!==429))throw Error('Invalid persisted host-stop state');for(const [h,status] of Object.entries(stored))this.stopped.set(h,status);}catch(error){if(error.code!=='ENOENT')throw error;}})();await this.stopInitialization; const key=sha256(url); let entry;
    try {entry=JSON.parse(await readFile(join(this.directory,key+'.json'),'utf8'));} catch {}
    if(entry?.sha256&&!revalidate) {try {const bytes=await readBoundedFile(join(this.directory,entry.sha256+'.bin'),this.maxBytes); if(sha256(bytes)===entry.sha256)return {...entry,bytes,cacheHit:true};}catch(error){if(error.code==='payloadTooLarge')return this.recordFailure(url,{url,status:entry.status,blockerCodes:['payloadTooLarge'],error:error.message,maxBytes:this.maxBytes});}}
    if(this.stopped.has(host)) return this.recordFailure(url,{url,status:this.stopped.get(host),blockerCodes:[this.stopped.get(host)===429?'rateLimited':'accessBlocked'],hostStopped:true});
    try{await this.validateUrl(url);}catch(error){return {url,status:null,blockerCodes:['accessBlocked'],error:error.message};}
    for(let attempt=0;attempt<=this.retries;attempt++) {
      const wait=Math.max(0,this.delayMs-(this.now()-(this.last.get(host)??-Infinity))); if(wait)await this.sleep(wait);
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try {
        const headers={}; if(entry?.etag)headers['If-None-Match']=entry.etag; if(entry?.lastModified)headers['If-Modified-Since']=entry.lastModified;
        // Redirects are never followed automatically: each destination must enter its own host queue.
        const response=await this.fetchImpl(url,{headers,signal:controller.signal,redirect:'manual'}); this.last.set(host,this.now());
        if([301,302,303,307,308].includes(response.status)) return this.recordFailure(url,{url,status:response.status,redirectUrl:response.headers.get('location'),blockerCodes:['rawUnavailable']});
        if(response.status===403||response.status===429) {this.stopped.set(host,response.status); this.stopWrite=this.stopWrite.then(async()=>{const path=join(this.directory,'stopped-hosts.json');await writeFile(path+'.tmp',JSON.stringify(Object.fromEntries(this.stopped)));await rename(path+'.tmp',path);});await this.stopWrite; return this.recordFailure(url,{url,status:response.status,blockerCodes:[response.status===429?'rateLimited':'accessBlocked']});}
        if(response.status===304&&entry?.sha256) {const bytes=await readBoundedFile(join(this.directory,entry.sha256+'.bin'),this.maxBytes);if(sha256(bytes)!==entry.sha256)throw Error('Cache hash mismatch'); return {...entry,bytes,cacheHit:true,revalidated:true};}
        if(!response.ok) {if(response.status>=500&&attempt<this.retries)continue;return this.recordFailure(url,{url,status:response.status,blockerCodes:['rawUnavailable']});}
        let bytes;try{bytes=await readBoundedBytes(response.body||[],this.maxBytes);}catch(error){if(error.code!=='payloadTooLarge')throw error;controller.abort();return this.recordFailure(url,{url,status:response.status,blockerCodes:['payloadTooLarge'],error:error.message,maxBytes:this.maxBytes,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),contentLength:response.headers.get('content-length')});}
        const result={url,status:response.status,sha256:sha256(bytes),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),contentType:response.headers.get('content-type'),fetchedAt:new Date(this.now()).toISOString()};
        await writeFile(join(this.directory,result.sha256+'.bin'),bytes);await writeFile(join(this.directory,key+'.json'),JSON.stringify(result,null,2)+'\n');return {...result,bytes,cacheHit:false};
      } catch(error) {if(error.code==='payloadTooLarge')return this.recordFailure(url,{url,status:entry?.status??null,blockerCodes:['payloadTooLarge'],error:error.message,maxBytes:this.maxBytes});this.last.set(host,this.now());if(attempt===this.retries)return this.recordFailure(url,{url,status:null,blockerCodes:['rawUnavailable'],error:error.message});} finally {clearTimeout(timer);}
    }
  }
}
