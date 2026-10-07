import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {FetchCache} from './fetch-cache.mjs';
import {PROVIDERS,searchProvider} from './providers.mjs';
export async function main(args=process.argv.slice(2)){
 const options={};const repeated=[];
 for(let i=0;i<args.length;i++){
  const key=args[i];if(!['--provider','--catalog','--out','--cache','--max-candidates','--max-pages','--input','--query','--revalidate'].includes(key))throw Error('Unknown option: '+key);
  if(key==='--revalidate'){options.revalidate=true;continue;}
  const value=args[++i];if(!value||value.startsWith('--'))throw Error('Missing value for '+key);
  if(key==='--catalog')repeated.push(value);else{if(Object.hasOwn(options,key))throw Error('Duplicate option: '+key);options[key]=value;}
 }
 const id=options['--provider'];if(!PROVIDERS[id])throw Error('Choose --provider '+Object.keys(PROVIDERS).join('|'));
 if(!options['--out']||!options['--cache'])throw Error('Explicit --out and --cache required (local only)');
 const output=resolve(options['--out']);if(output===resolve(options['--input']??'.'))throw Error('Output must differ from input');
 // Fail before network if either report already exists. Never overwrite prior evidence.
 for(const path of [output,output+'.md']){try{await stat(path);throw Error('Output already exists: '+path);}catch(e){if(e.code!=='ENOENT')throw e;}}
 let input;if(options['--input']){const path=resolve(options['--input']);if((await stat(path)).size>2*1024*1024)throw Error('Input exceeds 2 MiB');input=JSON.parse(await readFile(path,'utf8'));if(id!=='overture')throw Error('--input supported only for bounded Overture exports');}
 const fetcher=new FetchCache({directory:resolve(options['--cache']),delayMs:1500,timeoutMs:15000,retries:0,maxBytes:2*1024*1024});
 const report=await searchProvider(id,{fetcher,catalogs:repeated.length?repeated:undefined,maxCandidates:options['--max-candidates']===undefined?20:Number(options['--max-candidates']),input,maxPages:options['--max-pages']===undefined?1:Number(options['--max-pages']),query:options['--query'],revalidate:options.revalidate===true});
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const safe=v=>JSON.stringify(v,null,2).replaceAll('`','\\u0060');
 await writeFile(output+'.md','# Provider discovery review packet\n\nProvider rights are separate from record/resource rights, smoking existence and coordinate authority. No automatic approval or publication.\n\n```json\n'+safe(report)+'\n```\n',{flag:'wx'});
 console.log(JSON.stringify({provider:id,resources:report.resources.length,leads:report.leads.length,blockerCodes:report.blockerCodes,truncated:report.truncated,approvalAutomated:false,productionApproval:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
