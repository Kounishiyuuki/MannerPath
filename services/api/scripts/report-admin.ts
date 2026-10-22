import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { moderationTarget } from '../src/reports/moderation-target.ts';
import { createAdminServer } from './admin/server.ts';

/** Parsing remains pure and testable. No flag silently enables remote access or writes. */
export function parseAdminArguments(argv:readonly string[],facts:{interactive:boolean;ci:boolean}){
  const rest:string[]=[];let demo=false,enableDecisions=false,port=4318,actor='operator';let photoBucket:string|undefined;
  for(let i=0;i<argv.length;i++){
    const a=argv[i];if(a==='--demo')demo=true;else if(a==='--enable-decisions')enableDecisions=true;
    else if(a==='--port'||a==='--actor'||a==='--private-photo-bucket'){
      const v=argv[++i];if(!v||v.startsWith('--'))throw new Error('flagValueRequired');
      if(a==='--port'){port=Number(v);if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('invalidPort');}
      else if(a==='--actor'){if(!/^[a-zA-Z0-9._-]{1,64}$/.test(v))throw new Error('invalidActor');actor=v;}
      else{if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v))throw new Error('invalidPrivateBucketName');photoBucket=v;}
    }else rest.push(a);
  }
  const target=moderationTarget(rest,facts);if(!target.ok)throw new Error(target.error);
  if(target.rest.length)throw new Error('unexpectedArgument');
  if(demo&&(target.target.kind==='remote'||photoBucket))throw new Error('demoCannotConnectRemotely');
  if(photoBucket&&target.target.kind!=='remote')throw new Error('privateBucketRequiresExplicitRemote');
  return {target:target.target,demo,enableDecisions,port,actor,photoBucket};
}
async function passphrase(){
  const supplied=process.env.MANNERPATH_ADMIN_TOKEN;delete process.env.MANNERPATH_ADMIN_TOKEN;
  if(supplied){if(supplied.length<24||supplied.length>256)throw new Error('passphraseLength');return supplied;}
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('interactivePassphraseRequired');
  process.stdout.write('管理パスフレーズを設定（24〜256文字・画面には表示しません）: ');
  const mute=new Writable({write(_chunk,_encoding,done){done();}});
  const rl=createInterface({input:process.stdin,output:mute,terminal:true});
  try{const value=await rl.question('');process.stdout.write('\n');if(value.length<24||value.length>256)throw new Error('passphraseLength');return value;}finally{rl.close();}
}
export async function runAdmin(argv=process.argv.slice(2)){
  const args=parseAdminArguments(argv,{interactive:process.stdin.isTTY===true&&process.stdout.isTTY===true,ci:!!process.env.CI});
  const password=await passphrase();
  // Dynamic imports ensure demo mode cannot initialize Wrangler or connect to any remote binding.
  const connection=args.demo?await (await import('./admin/demo.ts')).createAdminDemo()
    :await (await import('./admin/connection.ts')).connectAdminStore(args.target,args.photoBucket);
  const readOnly=!args.demo&&(!args.enableDecisions||!connection.reader);
  const app=createAdminServer({reports:connection.reports,canonical:connection.canonical,reader:connection.reader,passphrase:password,
    mode:args.demo?'DEMO（架空データ・終了時に消去）':args.target.kind==='remote'?`REMOTE ${args.target.environment}`:'LOCAL',actor:args.actor,readOnly});
  try{
    const url=await app.listen(args.port);
    console.log(`MannerPath Admin: ${url} / ${args.demo?'DEMO':args.target.kind.toUpperCase()} / ${readOnly?'read-only':'decisions enabled'}`);
    let closing=false;
    const close=async()=>{if(closing)return;closing=true;await app.close();await connection.dispose();};
    process.once('SIGINT',()=>{void close().then(()=>process.exit(0));});process.once('SIGTERM',()=>{void close().then(()=>process.exit(0));});
    return {app,close};
  }catch{await connection.dispose();throw new Error('adminStartFailed');}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  runAdmin().catch(()=>{console.error('Adminを起動できません。接続フラグ・TTY・パスフレーズ・ローカルmigrationを確認してください。詳細や認証情報はログに出しません。');process.exitCode=1;});
}
