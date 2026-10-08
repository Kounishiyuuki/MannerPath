// One-command reproduction. Pipeline phases and HTTP timing never overlap.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matrixOptions, runMatrix } from './capacity-matrix.ts';
import { runLocalWorker } from './capacity-worker.ts';
const o=matrixOptions(process.argv.slice(2));
assert.ok(!o.phase && !existsSync(o.output),'fresh --output directory required; no --phase');
// --distribution selects one distribution; omit it for the requested complete matrix.
const distributions=process.argv.includes('--distribution')?[o.distribution]:['sparse','concentrated','extreme'] as const;
for(const distribution of distributions)await runMatrix({...o,distribution});
for(const distribution of distributions)for(const size of o.sizes){
  const dir=join(o.output,`${size}-${distribution}`),p=JSON.parse(readFileSync(join(dir,'publish.json'),'utf8'));
  if(p.refused)continue;
  const promotion=JSON.parse(readFileSync(join(dir,'promotion.json'),'utf8'));
  await runLocalWorker({db:join(dir,promotion.complete?'target.sqlite':'source.sqlite'),output:join(o.output,`worker-${size}-${distribution}`)});
}
if(distributions.length===3 && o.sizes.length===4){
  await new Promise<void>((ok,no)=>{const c=spawn(process.execPath,['--experimental-strip-types','--experimental-sqlite','--no-warnings',
    fileURLToPath(new URL('./capacity-summary.ts',import.meta.url)),'--input',o.output,'--out',join(o.output,'summary.json')],{stdio:'inherit'});
    c.on('error',no);c.on('exit',code=>code===0?ok():no(Error(`summary exited ${code}`)));});
}
console.log(`capacity results: ${resolve(o.output)}`);
