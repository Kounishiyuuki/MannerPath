// Local-only, reproducible synthetic capacity matrix. Each phase runs in a fresh process,
// so OS peak RSS belongs to that phase, not to preceding sizes. Large outputs stay in temp.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { formatTileId, tileForCoordinate } from '../src/geo/tile.ts';
import { SqliteD1 } from '../test/support/sqlite-d1.ts';
import { ingestRelease } from '../src/pipeline/ingest.ts';
import { resolveFirstRelease } from '../src/pipeline/resolve.ts';
import { publishTiles, spotDto, sourceDto, type CandidateRow } from '../src/tiles/publish.ts';
import { LOCATION_STATE_COLUMNS, LOCATION_STATE_JOINS } from '../src/tiles/location-state.ts';
import { manifestBody, splitTileParts, TILE_PART_POLICY, TILE_MANIFEST_MAX_BYTES, TileBudgetExceeded } from '../src/tiles/parts.ts';
import { promotionReadiness } from '../src/pipeline/promotion-readiness.ts';
import { exportPromotionV4 } from './promotion-v4-export.ts';
import { applyPromotionV4, applyV4Chunk, finalizePromotionV4 } from './promotion-v4-apply.ts';
import { verifyPromotionV4, sqlStatements } from './promotion-v4-verify.ts';
import { prepareV4ImportPlan, verifyV4ImportPlan } from './promotion-v4-import-plan.ts';
import { D1_CAPACITY_POLICY } from './promotion-v4-format.ts';
import { zoomComparison } from './scale/zoom.ts';
import { PROFILES, DISTRIBUTIONS, syntheticId, type Profile, type Distribution } from './scale/corpus.ts';
import { CAPACITY_ADAPTER, CAPACITY_REGISTRY, CAPACITY_SOURCE, CAPACITY_NOW, capacityBytes } from './capacity-source.ts';

export const SIZES: Record<string, Profile> = { '1k':'small', '10k':'medium', '50k':'large', '100k':'stress' };
interface Options { sizes: string[]; distribution: Distribution; output: string; phase?: string; chunkBytes: number }
export function tempOutput(path: string): string {
  const dest = resolve(path);
  const roots = ['/tmp', '/private/tmp', tmpdir()].filter(existsSync).map(p => realpathSync(p));
  let ancestor = dest;
  while (!existsSync(ancestor)) { const parent = dirname(ancestor); assert.notEqual(parent, ancestor); ancestor = parent; }
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, dest));
  assert.ok(roots.some(root => { const rel = relative(root, canonical); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }), 'output must be a child of a real temporary directory (symlinks checked)');
  return dest;
}
export function matrixOptions(argv: string[]): Options {
  const o: Options = { sizes:['1k','10k','50k','100k'], distribution:'sparse', output:'', chunkBytes:1048576 };
  const seen = new Set<string>();
  for (let i=0;i<argv.length;i+=2) {
    const flag=argv[i], value=argv[i+1]; assert.ok(value && !value.startsWith('--') && !seen.has(flag), `bad argument ${flag}`); seen.add(flag);
    if(flag==='--sizes') { o.sizes=value.split(','); assert.ok(o.sizes.length && new Set(o.sizes).size===o.sizes.length && o.sizes.every(s=>Object.hasOwn(SIZES,s)), 'sizes must be unique 1k,10k,50k,100k'); }
    else if(flag==='--distribution') { assert.ok(DISTRIBUTIONS.includes(value as Distribution)); o.distribution=value as Distribution; }
    else if(flag==='--output') o.output=tempOutput(value);
    else if(flag==='--phase') { assert.ok(['ingest','publish','promotion','tiles'].includes(value)); o.phase=value; }
    else if(flag==='--chunk-bytes') { o.chunkBytes=Number(value); assert.ok(Number.isSafeInteger(o.chunkBytes) && o.chunkBytes>=D1_CAPACITY_POLICY.statementBytes && o.chunkBytes<D1_CAPACITY_POLICY.importBytes); }
    else throw Error(`unknown argument ${flag}`);
  }
  assert.ok(o.output, '--output <new temp-directory> is required');
  if(o.phase) assert.equal(o.sizes.length,1,'one cell per phase');
  return o;
}
export function capacityRefusal(error: unknown): boolean {
  return error instanceof TileBudgetExceeded || (error instanceof Error && /^promotion v4 export refused: ((tile declarations|source declarations) exceed manifest capacity|manifest exceeds capacity|(release declarations|source declarations) exceed bounded manifest budget)$/.test(error.message));
}
function openDb(path: string, fresh=false) {
  if(fresh) assert.ok(!existsSync(path), `refusing existing DB ${path}`);
  const d=new DatabaseSync(path); d.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE');
  if(fresh) for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) d.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
  return d;
}
const scalar=(d:DatabaseSync,sql:string)=>Number((d.prepare(sql).get() as {n:number}).n);
function storage(d:DatabaseSync) {
  const rows=Object.fromEntries(['spots','source_records','source_observations','source_entities','spot_field_provenance','tile_snapshots','tile_snapshot_parts','tile_snapshot_spots'].map(t=>[t,scalar(d,`SELECT count(*) n FROM ${t}`)]));
  const indexes=d.prepare("SELECT m.name, coalesce(sum(s.pgsize),0) bytes FROM sqlite_master m LEFT JOIN dbstat s ON s.name=m.name WHERE m.type='index' GROUP BY m.name ORDER BY m.name").all() as {name:string;bytes:number}[];
  return { totalBytes:scalar(d,'SELECT page_count * page_size n FROM pragma_page_count(),pragma_page_size()'), rows,
    indexBytes:indexes.reduce((n,i)=>n+i.bytes,0), indexes };
}
export function promotionMetadata(d:DatabaseSync) {
  let compactBytes=0,firstRefusedTileOrdinal:number|null=null,tiles=0;
  for(const t of d.prepare('SELECT tile_id,revision,spot_count,content_sha256,schema_version,body_json FROM tile_snapshots ORDER BY tile_id').iterate()){
    const head=JSON.parse(String(t.body_json));
    const declaration={tileId:t.tile_id,revision:t.revision,spotCount:t.spot_count,contentSha256:t.content_sha256,schemaVersion:t.schema_version,
      parts:head.parts.map((p:{index:number;spotCount:number;sha256:string})=>({partIndex:p.index,spotCount:p.spotCount,contentSha256:p.sha256}))};
    compactBytes+=Buffer.byteLength(JSON.stringify(declaration));tiles++;
    if(firstRefusedTileOrdinal===null&&compactBytes>D1_CAPACITY_POLICY.maxManifestBytes/2)firstRefusedTileOrdinal=tiles;
  }
  return {tiles,compactTileDeclarationBytes:compactBytes,compactBudgetBytes:D1_CAPACITY_POLICY.maxManifestBytes/2,firstRefusedTileOrdinal,
    basis:'exact exporter declaration encoding summed from published heads, not a second successful export'};
}
function candidates(d:DatabaseSync):CandidateRow[] {
  return d.prepare(`SELECT s.*, src.source_id, src.kind source_kind, src.display_name, src.license_name, src.license_url, src.attribution_text, src.publication_status, ${LOCATION_STATE_COLUMNS}
    FROM spots s JOIN spot_field_provenance p ON p.spot_id=s.spot_id AND p.field='existence'
    JOIN source_records r ON r.record_id=p.record_id JOIN source_releases rel ON rel.release_id=r.release_id
    JOIN sources src ON src.source_id=rel.source_id ${LOCATION_STATE_JOINS} ORDER BY s.spot_id`).all() as unknown as CandidateRow[];
}
async function boundary(d:DatabaseSync,addressableParts?:number) {
  const rows=candidates(d), spots=rows.map(spotDto), sources=new Map(rows.map(r=>[r.source_id,sourceDto(r)]));
  const tile=rows[0].tile_id; assert.ok(rows.every(r=>r.tile_id===tile));
  async function fits(n:number) { try { const parts=await splitTileParts(tile,spots.slice(0,n),sources); const manifest=JSON.stringify(manifestBody(tile,1,CAPACITY_NOW,parts));
    assert.ok(Buffer.byteLength(manifest)<=TILE_MANIFEST_MAX_BYTES); assert.ok(parts.every(p=>gzipSync(p.bodyJson).length<=TILE_PART_POLICY.maxGzipBytes));
    if(addressableParts!==undefined && parts.length>addressableParts)return {ok:false,parts:parts.length,reason:`${parts.length} parts exceed observed HTTP addressability ${addressableParts}`};
    return {ok:true,parts:parts.length,manifestBytes:Buffer.byteLength(manifest),maxRaw:Math.max(...parts.map(p=>p.rawBytes)),maxGzip:Math.max(...parts.map(p=>gzipSync(p.bodyJson).length))};
  } catch(e) { if(e instanceof TileBudgetExceeded) return {ok:false,reason:e.message}; throw e; } }
  let lo=1,hi=spots.length; assert.ok((await fits(lo)).ok); if((await fits(hi)).ok) return {allFit:true,count:hi};
  while(hi-lo>1) {const mid=Math.floor((lo+hi)/2);if((await fits(mid)).ok)lo=mid;else hi=mid;}
  return { tile, lastAccepted:lo, firstRefused:hi, accepted:await fits(lo), refused:await fits(hi),
    basis:'actual canonical DTOs via spotDto; sorted prefix of this corpus; real splitter, manifest and gzip checks; DTO-specific, not a universal spot count' };
}
async function refusedZooms(d:DatabaseSync) {
  const rows=candidates(d),spots=rows.map(spotDto),sources=new Map(rows.map(r=>[r.source_id,sourceDto(r)]));
  const out=[];
  for(const z of [15,16]) {
    const grouped=new Map<string,typeof spots>();
    for(const s of spots){const id=formatTileId(tileForCoordinate(s.latitude,s.longitude,z));const g=grouped.get(id)??[];g.push(s);grouped.set(id,g);}
    let refusedTiles=0,maxParts=0,maxSpots=0;
    for(const [tile,g] of grouped){maxSpots=Math.max(maxSpots,g.length);try{const parts=await splitTileParts(tile,g,sources);maxParts=Math.max(maxParts,parts.length);}catch(e){if(!(e instanceof TileBudgetExceeded))throw e;refusedTiles++;}}
    out.push({zoom:z,tiles:grouped.size,maxSpots,refusedTiles,maxPartsOfAcceptedTiles:maxParts});
  }
  return out;
}
async function phase(o:Options) {
  const size=o.sizes[0], dir=join(o.output,`${size}-${o.distribution}`);mkdirSync(dir,{recursive:true});
  const dbpath=join(dir,'source.sqlite'), db=openDb(dbpath,o.phase==='ingest'), adapter=new SqliteD1(db);
  const timing:Record<string,number>={};const started=performance.now();
  async function time<T>(name:string,op:()=>Promise<T>|T):Promise<T>{ const start=performance.now();try{return await op();}finally{timing[name]=Math.round((performance.now()-start)*100)/100;process.stderr.write(`${size}/${o.distribution} ${name} ${timing[name]}ms\n`);} }
  const result:Record<string,unknown>={phase:o.phase,size,distribution:o.distribution,spots:PROFILES[SIZES[size]],runtime:process.version,simulationOnly:true};
  try {
    if(o.phase!=='ingest') assert.deepEqual(db.prepare('SELECT source_id FROM sources').all().map(r=>r.source_id),[CAPACITY_SOURCE],'refusing non-synthetic source DB');
    if(o.phase==='ingest') {
      const bytes=await time('generate',()=>capacityBytes(SIZES[size],o.distribution));result.inputBytes=bytes.length;result.corpusSha256=createHash('sha256').update(bytes).digest('hex');
      const r=CAPACITY_ADAPTER.registry;
      db.prepare('INSERT INTO sources (source_id,display_name,kind,license_name,license_url,attribution_text,publication_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(r.sourceId,r.displayName,r.kind,r.licenseName,r.licenseUrl,r.attributionText,'blocked',CAPACITY_NOW,CAPACITY_NOW);
      const release=await time('ingest',()=>ingestRelease(adapter,CAPACITY_ADAPTER,bytes,{sourceUrl:'https://example.invalid/synthetic-capacity',observedOn:'2026-10-08',fetchedAt:CAPACITY_NOW,httpLastModified:null}));
      let ordinal=0;const resolved=await time('resolve',()=>resolveFirstRelease(adapter,CAPACITY_ADAPTER,release.releaseId,{now:CAPACITY_NOW,newSpotId:()=>syntheticId('sp',ordinal++)}));assert.equal(resolved.status,'resolved');assert.equal(ordinal,PROFILES[SIZES[size]]);
      await time('blockedPublish',()=>publishTiles(adapter,{now:CAPACITY_NOW}));assert.equal(scalar(db,'SELECT count(*) n FROM tile_snapshot_spots'),0);
    } else if(o.phase==='publish') {
      result.candidateTiles=scalar(db,'SELECT count(DISTINCT tile_id) n FROM spots');
      db.prepare("UPDATE sources SET publication_status='approved' WHERE source_id=?").run(CAPACITY_SOURCE);
      await time('publish',()=>publishTiles(adapter,{now:CAPACITY_NOW}));assert.equal(scalar(db,'SELECT count(*) n FROM tile_snapshot_spots'),PROFILES[SIZES[size]]);
    } else if(o.phase==='tiles') {
      const rows=candidates(db),spots=rows.map(spotDto),sources=new Map(rows.map(r=>[r.source_id,sourceDto(r)]));
      const probes=[{id:'tokyo',latitude:35.681,longitude:139.767},{id:'osaka',latitude:34.702,longitude:135.496},
        {id:'sparse-origin',latitude:spots[0].latitude,longitude:spots[0].longitude}];
      // Regrouping at z15 is a measurement only; stored canonical z14 never changes.
      result.zooms=await time('tileMetrics',async()=>{ const out=[];for(const z of [14,15]) out.push(await zoomComparison(spots,sources,z,probes,CAPACITY_NOW));return out; });
      result.refusedTileCount=0;
      // Actual Worker evidence shows the current route only accepts indexes 0..99.
      // Diagnose that separate HTTP boundary without changing the production policy.
      if(o.distribution==='extreme')result.httpAddressabilityBoundary=await time('httpBoundary',()=>boundary(db,100));
    } else if(o.phase==='promotion') {
      result.promotionMetadata=promotionMetadata(db);
      const bundle=join(dir,'bundle');const m=await time('generation',()=>exportPromotionV4(db,bundle,{chunkBytes:o.chunkBytes,registry:CAPACITY_REGISTRY}));
      result.artifactBytes=m.chunks.reduce((n,c)=>n+c.bytes,m.finalize.bytes)+statSync(join(bundle,'manifest.json')).size;
      result.manifestBytes=statSync(join(bundle,'manifest.json')).size;result.chunks=m.chunks.length;result.digest=m.wholeBundleSha256;
      await time('verify',()=>verifyPromotionV4(bundle,m.wholeBundleSha256));
      let maxStatementBytes=0;
      await time('statementAudit',async()=>{for(const f of [...m.chunks,m.finalize])for await(const sql of sqlStatements(join(bundle,f.file)))maxStatementBytes=Math.max(maxStatementBytes,Buffer.byteLength(sql));});
      result.maxStatementBytes=maxStatementBytes;
      const planDir=join(dir,'import-plan');const plan=await time('importPlanGeneration',()=>prepareV4ImportPlan(bundle,m.wholeBundleSha256,planDir));
      await time('importPlanVerify',()=>verifyV4ImportPlan(planDir,plan.wholePlanSha256,m.wholeBundleSha256));
      result.importPlanBytes=plan.files.reduce((n,f)=>n+f.bytes,plan.sourceManifestFile.bytes)+statSync(join(planDir,'plan-manifest.json')).size;
      const target=openDb(join(dir,'target.sqlite'),true);
      try {
        await time('initialize',()=>applyPromotionV4(target,bundle,m.wholeBundleSha256,{stopAfter:0}));
        const chunkMs:number[]=[];await time('import',async()=>{for(const c of m.chunks){const start=performance.now();assert.equal(await applyV4Chunk(target,bundle,m.wholeBundleSha256,c.ordinal),'applied');chunkMs.push(performance.now()-start);}});
        result.maxChunkMs=Math.max(...chunkMs);await time('finalize',()=>finalizePromotionV4(target,bundle,m.wholeBundleSha256));
        result.readiness=await promotionReadiness(new SqliteD1(target));assert.deepEqual(result.readiness,{schemaVersion:1,state:'completed',completed:true});
        assert.equal(scalar(target,'SELECT count(*) n FROM tile_snapshot_spots'),PROFILES[SIZES[size]]);
        const heads=(d:DatabaseSync)=>d.prepare('SELECT tile_id,content_sha256,spot_count FROM tile_snapshots ORDER BY tile_id').all();assert.deepEqual(heads(target),heads(db));
        result.targetStorage=storage(target);target.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      }finally{target.close();}
    }
    result.complete=true;
  }catch(e){
    if(!capacityRefusal(e)) throw e;
    result.peakRssBeforeRefusalDiagnosticsBytes=process.resourceUsage().maxRSS*1024;
    result.complete=false;result.refused=true;result.reason=(e as Error).message;
    if(e instanceof TileBudgetExceeded){result.refusedTileCount=1;result.requiredPartsOnRefusedTile=Number(e.message.match(/need (\d+) parts/)?.[1])||null;if(o.distribution==='extreme'){result.boundary=await time('boundary',()=>boundary(db));result.alternateZooms=await time('alternateZooms',()=>refusedZooms(db));}}
  }finally {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');result.storage=storage(db);result.timingsMs=timing;result.wallMs=Math.round(performance.now()-started);result.peakRssBytes=process.resourceUsage().maxRSS*1024;
    db.close();writeFileSync(join(dir,`${o.phase}.json`),JSON.stringify(result,null,2)+'\n');
  }
}
async function child(o:Options,size:string,p:string) {
  await new Promise<void>((ok,no)=>{const c=spawn(process.execPath,['--experimental-strip-types','--experimental-sqlite','--no-warnings',fileURLToPath(import.meta.url),'--sizes',size,'--distribution',o.distribution,'--output',o.output,'--chunk-bytes',String(o.chunkBytes),'--phase',p],{stdio:'inherit'});c.on('error',no);c.on('exit',code=>code===0?ok():no(Error(`${size}/${o.distribution}/${p} exited ${code}`)));});
}
export async function runMatrix(o:Options) {
  mkdirSync(o.output,{recursive:true});const cells:Record<string,unknown>[]=[];
  for(const size of o.sizes){
    const dir=join(o.output,`${size}-${o.distribution}`);const phases:Record<string,unknown>={};
    for(const p of ['ingest','publish','tiles','promotion']){
      await child(o,size,p);const r=JSON.parse(readFileSync(join(dir,`${p}.json`),'utf8'));phases[p]=r;if(r.refused)break;
    }
    cells.push({size,distribution:o.distribution,phases});writeFileSync(join(o.output,`matrix-${o.distribution}.json`),JSON.stringify({version:'capacity-matrix.v2',syntheticOnly:true,cells},null,2)+'\n');
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  assert.ok(Number(process.versions.node.split('.')[0])>=24,'capacity benchmark requires Node >=24');
  const o=matrixOptions(process.argv.slice(2));if(o.phase)await phase(o);else await runMatrix(o);
}
