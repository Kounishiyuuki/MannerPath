import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FetchCache,sha256,assertByteLimit,readBoundedFile} from './fetch-cache.mjs';

const limit=2*1024*1024;
const url='https://catalog.example/dataset';
const cache=(directory,fetchImpl)=>new FetchCache({directory,fetchImpl,maxBytes:limit,validateUrl:async()=>{},delayMs:0,retries:0});
async function seed(directory,bytes){
 const entry={url,status:200,sha256:sha256(bytes),etag:'"fixture"'};
 await writeFile(join(directory,entry.sha256+'.bin'),bytes);await writeFile(join(directory,sha256(url)+'.json'),JSON.stringify(entry));
 return entry;
}
function rejected(result){assert.ok(result.blockerCodes.includes('payloadTooLarge'));assert.equal(result.bytes,undefined);assert.equal(result.sha256,undefined);}

test('bounded byte and file helpers accept exactly 2 MiB and reject 2 MiB plus one byte',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bounded-file-tests-'));try{
  for(const extra of [0,1]){
   const bytes=Buffer.alloc(limit+extra,32);const path=join(dir,`${extra}.json`);await writeFile(path,bytes);
   if(extra){assert.throws(()=>assertByteLimit(bytes,limit),error=>error.code==='payloadTooLarge');await assert.rejects(readBoundedFile(path,limit),error=>error.code==='payloadTooLarge');}
   else {assert.doesNotThrow(()=>assertByteLimit(bytes,limit));assert.deepEqual(await readBoundedFile(path,limit),bytes);}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('network bodies are never truncated into accepted cache entries at the byte cap',async()=>{
 for(const extra of [0,1]){
  const dir=await mkdtemp(join(tmpdir(),'network-cap-tests-'));try{
   const bytes=Buffer.alloc(limit+extra,32);const result=await cache(dir,async()=>new Response(bytes)).get(url);
   if(extra){rejected(result);assert.ok(!(await readdir(dir)).some(name=>name.endsWith('.bin')));}
   else {assert.equal(result.bytes.length,limit);assert.deepEqual(result.bytes,bytes);assert.equal(result.cacheHit,false);}
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('cache hits and 304 revalidation cannot bypass the same 2 MiB cap',async()=>{
 for(const revalidate of [false,true])for(const extra of [0,1]){
  const dir=await mkdtemp(join(tmpdir(),'cache-cap-tests-'));try{
   const bytes=Buffer.alloc(limit+extra,32);await seed(dir,bytes);let calls=0;
   const fetcher=cache(dir,async()=>{calls++;return new Response(null,{status:304});});const result=await fetcher.get(url,{revalidate});
   if(extra)rejected(result);else {assert.deepEqual(result.bytes,bytes);assert.equal(result.cacheHit,true);if(revalidate)assert.equal(result.revalidated,true);}
   assert.equal(calls,revalidate?1:0);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('redirect destinations apply the cap to both fetched and previously cached bodies',async()=>{
 for(const fromCache of [false,true]){
  const dir=await mkdtemp(join(tmpdir(),'redirect-cap-tests-'));try{
   const bytes=Buffer.alloc(limit+1,32);await seed(dir,bytes);const start='https://entry.example/catalog';const calls=[];
   const result=await cache(dir,async target=>{calls.push(target);if(target===start)return new Response(null,{status:302,headers:{location:url}});return new Response(bytes);}).get(start,{revalidate:!fromCache});
   rejected(result);assert.equal(result.url,url);assert.deepEqual(calls,fromCache?[start]:[start,url]);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
