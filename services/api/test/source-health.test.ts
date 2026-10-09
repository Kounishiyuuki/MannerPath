import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSourceHealth } from "../src/source-health/check.ts";
import { productionHealthTargets, archiveMember } from "../scripts/source-health.ts";
const targets = productionHealthTargets();
const target = targets.find(t => t.adapter.registry.sourceId === "taito-public-smoking-areas")!;
const fixture = readFileSync(new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url));
const response = (body: BodyInit = fixture, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/csv", ...headers } });
test("six production targets and reviewed Kyoto retrieval", () => {
  assert.equal(targets.length, 6); for (const item of targets) { assert.equal(new URL(item.url).protocol, "https:"); assert.ok(item.baselineHeader.length); } assert.equal(targets.find(t => t.adapter.registry.sourceId.startsWith("kyoto"))!.request!.method, "POST");
});
test("200 exact release is healthy with coordinate and parser probes", async () => {
  const result = await checkSourceHealth(target, { fetch: async () => response() });
  assert.equal(result.status, "healthy"); assert.equal(result.payloadSha256, target.baselineSha256);
  assert.equal(result.schemaCompatible, true); assert.equal(result.parserCompatible, true);
  assert.ok(result.rowCount! > 0); assert.ok(result.coordinateColumns!.length > 0);
});
for (const status of [301,302]) test(`${status} same-origin movement is advisory`, async () => {
  let calls = 0;
  const result = await checkSourceHealth(target, { fetch: async () => ++calls === 1 ? response("", status, { location: "/moved.csv" }) : response() });
  assert.equal(result.status, "moved"); assert.equal(result.redirects.length, 1); assert.equal(calls, 2);
});
test("cross-origin movement stops before destination fetch", async () => {
  let calls = 0;
  const result = await checkSourceHealth(target, { fetch: async () => { calls++; return response("",302,{location:"https://example.org/data.csv"}); } });
  assert.equal(result.status,"rightsReviewRequired"); assert.equal(calls,1);
});
for (const status of [403,404,503]) test(`${status} does not imply removal or expired rights`, async () => {
  const result = await checkSourceHealth(target, { fetch: async () => response("",status) });
  assert.equal(result.status,status === 403 ? "accessBlocked" : "unavailable"); assert.equal(result.schemaCompatible,null);
});
test("timeout covers fetch and body even if client ignores abort", async () => {
  assert.equal((await checkSourceHealth(target, { timeoutMs: 5, fetch: () => new Promise(() => {}) })).status,"unavailable");
  const body = new ReadableStream({ start() {} });
  assert.equal((await checkSourceHealth(target, { timeoutMs: 5, fetch: async () => response(body) })).status,"unavailable");
});
test("declared and streaming oversized responses stop", async () => {
  for (const headers of [{"content-length":"999999"},{}]) {
    const result = await checkSourceHealth(target,{maxBytes:5,fetch:async()=>response(fixture,200,headers)});
    assert.equal(result.status,"unavailable"); assert.match(result.notes.join(" "),/size limit/); assert.equal(result.sha256,undefined);
  }
});
test("wrong MIME never invokes parser", async () => {
  const result = await checkSourceHealth(target,{fetch:async()=>response("<html></html>",200,{"content-type":"text/html"})});
  assert.equal(result.status,"unknown"); assert.equal(result.parserCompatible,null);
});
test("schema drift and hash changes are distinct", async () => {
  const drift = await checkSourceHealth(target,{fetch:async()=>response("changed,header\n1,2")});
  assert.equal(drift.status,"schemaChanged"); assert.equal(drift.parserCompatible,false);
  const changed = await checkSourceHealth({...target,baselineSha256:"0".repeat(64)},{fetch:async()=>response()});
  assert.equal(changed.status,"contentChanged"); assert.equal(changed.parserCompatible,true);
});
test("redirect loop is bounded",async()=>{
  let calls=0; const result=await checkSourceHealth(target,{maxRedirects:1,fetch:async()=>{calls++; return response("",302,{location:"/loop.csv"});}});
  assert.equal(result.status,"unavailable"); assert.equal(calls,2);
});
test("untrusted archives reject without filesystem writes",()=>{ assert.throws(()=>archiveMember(new Uint8Array([1,2,3]),"doc.kml")); });
test("all six reviewed fixture payloads pass independent parser/observation probes", async () => {
  const filenames: Record<string,string> = {
    "taito-public-smoking-areas":"20260818_koshukitsuenjo.csv", "osaka-designated-smoking-areas":"opendata_1012.csv",
    "koto-station-smoking-areas":"131083_237_public_smoking_area_station.csv", "musashino-public-smoking-areas":"doc.kml",
    "minato-designated-smoking-areas":"minatokushisetsujoho_fukugo.csv", "kyoto-public-smoking-places":"20260903_shisetsu.csv",
  };
  for (const item of targets) {
    const fixture = readFileSync(new URL(`../../data-pipeline/fixtures/${item.adapter.registry.sourceId}/${filenames[item.adapter.registry.sourceId]}`,import.meta.url));
    const result = await checkSourceHealth({...item,prepare:undefined,baselineResourceSha256:undefined,mimeTypes:["text/csv"]},{fetch:async()=>response(fixture)});
    assert.equal(result.status,"healthy",item.adapter.registry.sourceId); assert.ok(result.observedRowCount! > 0);
  }
});
test("missing reviewed rights fail closed without HTTP",async()=>{
  const result=await checkSourceHealth({...target,adapter:{...target.adapter,registry:{...target.adapter.registry,licenseUrl:null}}},{fetch:async()=>{throw new Error("must not fetch");}});
  assert.equal(result.status,"rightsReviewRequired"); assert.equal(result.httpStatus,null);
});
test("redirect headers never leak into final response metadata",async()=>{
  let calls=0;
  const result=await checkSourceHealth(target,{fetch:async()=>++calls===1?response("",302,{location:"/new.csv",etag:"old", "last-modified":"yesterday","content-length":"99999999"}):response()});
  assert.equal(result.status,"moved"); assert.equal(result.etag,undefined); assert.equal(result.lastModified,undefined); assert.equal(result.contentLength,undefined);
});
// Minimal ZIP builder for bounded extraction tests; no live/archive fixture dependency.
import { crc32, deflateRawSync } from "node:zlib";
function zip(entries: {name:string;bytes:Buffer;method?:number;expanded?:number}[]) {
  const locals:Buffer[]=[]; const centrals:Buffer[]=[]; let offset=0;
  for (const entry of entries) {
    const name=Buffer.from(entry.name), method=entry.method??0;
    const data=method===8?deflateRawSync(entry.bytes):entry.bytes;
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method,8); local.writeUInt32LE(crc32(entry.bytes),14);
    local.writeUInt32LE(data.length,18); local.writeUInt32LE(entry.expanded??entry.bytes.length,22); local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method,10); central.writeUInt32LE(crc32(entry.bytes),16);
    central.writeUInt32LE(data.length,20); central.writeUInt32LE(entry.expanded??entry.bytes.length,24); central.writeUInt16LE(name.length,28); central.writeUInt32LE(offset,42);
    const block=Buffer.concat([local,name,data]); locals.push(block); centrals.push(Buffer.concat([central,name])); offset+=block.length;
  }
  const directory=Buffer.concat(centrals); const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16); return Buffer.concat([...locals,directory,end]);
}
test("nested stored and deflated ZIP members extract with CRC verification",()=>{
  for(const method of [0,8]) {
    const payload=Buffer.from("<kml>fixture</kml>"); const inner=zip([{name:"doc.kml",bytes:payload,method}]); const outer=zip([{name:"KML/layer.kmz",bytes:inner,method}]);
    assert.deepEqual(Buffer.from(archiveMember(archiveMember(outer,".kmz"),"doc.kml")),payload);
  }
});
test("archive corruption, duplicate members, expanded cap and header mismatch fail closed",()=>{
  const payload=Buffer.from("payload"); const corrupt=zip([{name:"doc.kml",bytes:payload}]); corrupt[37]^=1;
  assert.throws(()=>archiveMember(corrupt,"doc.kml"));
  assert.throws(()=>archiveMember(zip([{name:"doc.kml",bytes:payload},{name:"doc.kml",bytes:payload}]),"doc.kml"));
  assert.throws(()=>archiveMember(zip([{name:"doc.kml",bytes:payload,expanded:5_000_001}]),"doc.kml"));
  const mismatch=zip([{name:"doc.kml",bytes:payload}]); mismatch.writeUInt16LE(8,8);
  assert.throws(()=>archiveMember(mismatch,"doc.kml"));
});
test("transport cause exposes only bounded symbolic code",async()=>{
  const result=await checkSourceHealth(target,{fetch:async()=>{throw new Error("fetch failed",{cause:{code:"ERR_SSL_DH_KEY_TOO_SMALL",message:"private detail"}});}});
  assert.deepEqual(result.notes,["fetch failed","Transport error code: ERR_SSL_DH_KEY_TOO_SMALL"]);
  const privateCause=await checkSourceHealth(target,{fetch:async()=>{throw new Error("fetch failed",{cause:{code:"private URL https://example.org/secret"}});}});
  assert.deepEqual(privateCause.notes,["fetch failed"]);
});
test("changed archive packaging is detected even with byte-identical extracted payload",async()=>{
  const result=await checkSourceHealth({...target,prepare:()=>fixture,baselineResourceSha256:"0".repeat(64)}, {fetch:async()=>response("different archive wrapper")});
  assert.equal(result.status,"contentChanged"); assert.equal(result.payloadSha256,target.baselineSha256);
  assert.match(result.notes.join(" "),/packaging review/);
});
test("duplicate archive entry is rejected before its expansion",()=>{
  const archive=zip([{name:"doc.kml",bytes:Buffer.from("first")},{name:"doc.kml",bytes:Buffer.alloc(1),expanded:5_000_001}]);
  assert.throws(()=>archiveMember(archive,"doc.kml"),/duplicate archive member/);
});
