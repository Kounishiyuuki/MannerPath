// Compact aggregate evidence only; SQLite, corpus bytes, SQL and raw latency samples stay in temp.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, totalmem, cpus } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { tempOutput, SIZES, promotionMetadata } from './capacity-matrix.ts';
const args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],'--input');assert.equal(args[2],'--out');
const input=tempOutput(args[1]),output=tempOutput(args[3]);
const cells=[];
for(const distribution of ['sparse','concentrated','extreme'])for(const size of Object.keys(SIZES)){
  const dir=join(input,`${size}-${distribution}`);assert.ok(existsSync(dir),`missing ${size}/${distribution}`);
  const phases:Record<string,any>={};
  for(const p of ['ingest','publish','tiles','promotion']){
    const file=join(dir,`${p}.json`);if(!existsSync(file)){assert.ok(phases.publish?.refused||phases.promotion?.refused,`missing phase ${p}`);break;}
    const r=JSON.parse(readFileSync(file,'utf8'));assert.equal(r.size,size);assert.equal(r.distribution,distribution);assert.ok(r.complete||r.refused,`incomplete phase ${p}`);phases[p]=r;
  }
  if(phases.promotion){const db=new DatabaseSync(join(dir,'source.sqlite'),{readOnly:true});try{phases.promotion.promotionMetadata=promotionMetadata(db);}finally{db.close();}}
  const workerFile=join(input,`worker-${size}-${distribution}`,'latency.json');
  const api=existsSync(workerFile)?JSON.parse(readFileSync(workerFile,'utf8')):null;
  assert.ok(api||phases.publish.refused,`missing API ${size}/${distribution}`);
  if(api){
    assert.equal(api.expectedReadiness.completed,phases.promotion?.complete===true,'latency DB readiness disagrees with promotion evidence');
    assert.equal(api.environment.warmup,50,'report requires 50 warmup samples');
    assert.equal(api.environment.repeats,500,'report requires 500 measured samples');
    for(const probe of api.probes)assert.equal(probe.latencyMs.n,500,'incomplete latency probe');
    delete api.environment.db;delete api.environment.baseUrl;
  }
  cells.push({size,distribution,phases,api,apiDatabase:api?(api.expectedReadiness.completed?'finalized target':'published source; promotion refused'):null});
}
writeFileSync(output,JSON.stringify({version:'nationwide-capacity-validation.v1',date:'2026-10-08',syntheticOnly:true,
  runtime:process.version,host:{os:platform(),arch:arch(),memoryBytes:totalmem(),cpuCount:cpus().length},corpus:'synthetic-capacity.v1; 8 provenance fields per spot; unknown hours and type support',
  environment:'macOS, disk-backed node:sqlite for pipeline; actual local wrangler workerd for HTTP; no remote DB, production mutation or Apple changes',
  methodology:{isolatedPhaseProcesses:true,latencyWarmup:50,latencyRepeats:500,quantiles:'nearest rank',
    viewport:'cold current-client v1→409→manifest→parts; 404 costs a request; gzip payload bytes exclude problem bodies/headers/config',
    sparse:'uniform archipelago bounding rectangle 24–45.5N,123–146E, including water; synthetic spatial stress, not land coverage or actual smoking-place distribution',
    concentrated:'equal Tokyo/Osaka, 0.12-degree rectangles',extreme:'all spots inside one z14 tile, 0.006-degree jitter'},
  cells},null,2)+'\n');
console.log(output);
