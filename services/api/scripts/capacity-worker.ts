// Starts the actual Worker in a fresh local Wrangler state directory, seeds only that
// state with a benchmark DB, and runs the read-only latency harness. No remote bindings.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempOutput } from './capacity-matrix.ts';
import { DatabaseSync } from 'node:sqlite';
import { CAPACITY_SOURCE } from './capacity-source.ts';

export async function runLocalWorker(input:{db:string;output:string;port?:number;warmup?:number;repeats?:number}) {
  tempOutput(input.db);
  const check=new DatabaseSync(input.db,{readOnly:true});
  try {
    const sources=check.prepare('SELECT source_id FROM sources').all();
    assert.deepEqual(sources.map(r=>r.source_id),[CAPACITY_SOURCE], 'only the synthetic capacity DB is accepted');
  } finally { check.close(); }
  const out=tempOutput(input.output),port=input.port??8805;
  assert.ok(Number.isSafeInteger(port)&&port>=1024&&port<=65535);
  assert.ok(!existsSync(out),'choose a fresh Worker output directory');mkdirSync(out,{recursive:true});
  const config=join(out,'wrangler.json'),state=join(out,'state');
  writeFileSync(config,JSON.stringify({name:'mannerpath-capacity-local-only',main:fileURLToPath(new URL('../src/index.ts',import.meta.url)),
    compatibility_date:'2026-09-01',vars:{REPORT_ATTESTATION:'disabled'},triggers:{crons:[]},
    d1_databases:[{binding:'DB',database_name:'synthetic-capacity-local-only',database_id:'00000000-0000-0000-0000-000000000000'}]},null,2));
  process.env.WRANGLER_REGISTRY_PATH=join(out,'registry');
  process.env.WRANGLER_LOG_PATH=join(out,'logs');
  process.env.WRANGLER_SEND_METRICS='false';
  const {getPlatformProxy}=await import('wrangler');
  const proxy=await getPlatformProxy<{DB:{prepare(sql:string):{first():Promise<unknown>}}}>({configPath:config,envFiles:[],persist:{path:join(state,'v3')},remoteBindings:false});
  try{await proxy.env.DB.prepare('SELECT 1').first();}finally{await proxy.dispose();}
  const d1dir=join(state,'v3','d1','miniflare-D1DatabaseObject');const files=readdirSync(d1dir).filter(f=>f.endsWith('.sqlite') && f!=='metadata.sqlite');
  assert.equal(files.length,1,'isolated state must contain exactly one local D1');
  for(const suffix of ['-wal','-shm']) rmSync(join(d1dir,files[0])+suffix,{force:true});
  copyFileSync(input.db,join(d1dir,files[0]));
  const log=openSync(join(out,'worker.log'),'wx');
  const worker=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),
    'dev','--local','--config',config,'--port',String(port),'--ip','127.0.0.1','--persist-to',state,'--log-level','error'],
    {stdio:['ignore',log,log],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  closeSync(log);
  const closed=new Promise<void>((ok,no)=>{worker.on('error',no);worker.on('exit',()=>ok());});
  try {
    let ready=false;
    for(let i=0;i<80;i++){
      if(worker.exitCode!==null)throw Error(`local Worker exited ${worker.exitCode}`);
      try{const r=await fetch(`http://127.0.0.1:${port}/v1/config`,{redirect:'error',signal:AbortSignal.timeout(1000)});await r.arrayBuffer();if(r.status===200){ready=true;break;}}catch{}
      await new Promise(ok=>setTimeout(ok,250));
    }
    assert.ok(ready,'local Worker did not start; inspect worker.log');
    const {main:runLatency}=await import('./capacity-latency.ts');
    await runLatency(['--base-url',`http://127.0.0.1:${port}`,'--db',input.db,'--warmup',String(input.warmup??50),
      '--repeats',String(input.repeats??500),'--out',join(out,'latency.json')]);
  }finally{worker.kill('SIGTERM');await closed;}
  return join(out,'latency.json');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const argv=process.argv.slice(2);const args:Record<string,string>={};
  for(let i=0;i<argv.length;i+=2){assert.ok(['--db','--output','--port','--warmup','--repeats'].includes(argv[i])&&argv[i+1]&&!args[argv[i]],'invalid or duplicate option');args[argv[i]]=argv[i+1];}
  assert.ok(args['--db']&&args['--output'],'--db and --output required');
  await runLocalWorker({db:resolve(args['--db']),output:args['--output'],port:args['--port']?Number(args['--port']):undefined,
    warmup:args['--warmup']?Number(args['--warmup']):undefined,repeats:args['--repeats']?Number(args['--repeats']):undefined});
}
