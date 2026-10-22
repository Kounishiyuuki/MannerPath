import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Db } from '../../src/db.ts';
import { getAdminReport, listAdminReports, applyAdminDecision, AdminReviewError } from '../../src/reports/admin-review.ts';
import { readPrivateEvidencePhoto, PrivatePhotoViewError, type PrivatePhotoReader } from '../../src/reports/private-photo-view.ts';
import { duplicateCandidates } from '../../src/pipeline/community-evidence.ts';

const decisionSchema=z.object({reportId:z.string().regex(/^rp_[0-9A-HJKMNP-TV-Z]{26}$/),photoId:z.string().regex(/^ph_[0-9a-f]{64}$/).optional(),
  state:z.enum(['accepted','needsInfo','rejected','duplicate','approved']),reason:z.string().min(1).max(64),
  expectedVersion:z.string().min(1).max(8192),operationId:z.uuid(),privacyChecked:z.boolean()}).strict();
const loginSchema=z.object({token:z.string().min(24).max(256)}).strict();
const nonce=()=>randomBytes(32).toString('hex');
const hash=(value:string)=>createHash('sha256').update(value).digest();
type Prepared={digest:string;expires:number;used:boolean;completed?:boolean};
type Session={csrf:string;expires:number;confirmations:Map<string,Prepared>};
export interface AdminServerOptions {
  reports:Db; canonical?:Db|null; reader:PrivatePhotoReader|null; passphrase:string;
  mode:string; actor?:string; readOnly?:boolean; now?:()=>Date;
}

/** This HTTP surface is never imported by the public Worker. It has exactly one IPv4 loopback listener. */
export function createAdminServer(options:AdminServerOptions) {
  if(options.passphrase.length<24||options.passphrase.length>256)throw new Error('passphraseLength');
  const credential=hash(options.passphrase);options.passphrase='';
  const actor=options.actor??'operator';if(!/^[a-zA-Z0-9._-]{1,64}$/.test(actor))throw new Error('invalidActor');
  const sessions=new Map<string,Session>();const inFlight=new Set<string>();
  let origin='';let attempts=0;let attemptWindow=0;
  const clock=options.now??(()=>new Date());
  const assets=new Map<string,{type:string;body:Buffer}>([
    ['/',{type:'text/html; charset=utf-8',body:readFileSync(new URL('./ui.html',import.meta.url))}],
    ['/ui.css',{type:'text/css; charset=utf-8',body:readFileSync(new URL('./ui.css',import.meta.url))}],
    ['/ui.js',{type:'text/javascript; charset=utf-8',body:readFileSync(new URL('./ui.js',import.meta.url))}],
  ]);
  function respond(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
  function refuse(res:ServerResponse,status:number,error:string){respond(res,status,{error});}
  async function json(req:IncomingMessage):Promise<unknown>{
    if(req.headers['content-type']!=='application/json')throw new AdminReviewError('jsonRequired',415);
    const pieces:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>16_384)throw new AdminReviewError('requestTooLarge',413);pieces.push(chunk);}
    try{return JSON.parse(Buffer.concat(pieces).toString('utf8'));}catch{throw new AdminReviewError('invalidJson',400);}
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store, private, max-age=0');res.setHeader('Pragma','no-cache');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Permissions-Policy','geolocation=(), camera=(), microphone=()');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-src https://www.openstreetmap.org; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try{
      if(!origin||req.headers.host!==origin.slice(7)||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return refuse(res,403,'localOnly');
      if(req.headers.origin!==undefined&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return refuse(res,403,'originDenied');
      if(!req.url?.startsWith('/')||req.url.startsWith('//'))return refuse(res,400,'invalidPath');
      const url=new URL(req.url,origin);const path=url.pathname;
      if(req.method==='GET'&&assets.has(path)){const a=assets.get(path)!;res.writeHead(200,{'Content-Type':a.type});res.end(a.body);return;}
      if(req.method!=='GET'&&req.method!=='POST')return refuse(res,405,'methodDenied');
      if(req.method==='POST'&&req.headers.origin!==origin)return refuse(res,403,'originRequired');
      const now=clock();const ms=now.getTime();
      for(const [key,value]of sessions)if(value.expires<=ms)sessions.delete(key);
      if(path==='/session'&&req.method==='POST'){
        if(ms-attemptWindow>60_000){attempts=0;attemptWindow=ms;}if(attempts>=5)return refuse(res,429,'loginRateLimited');
        const parsed=loginSchema.safeParse(await json(req));if(!parsed.success){attempts++;return refuse(res,401,'unauthorized');}
        const candidate=hash(parsed.data.token);parsed.data.token='';
        if(!timingSafeEqual(candidate,credential)){attempts++;return refuse(res,401,'unauthorized');}
        attempts=0;if(sessions.size>=8)sessions.delete(sessions.keys().next().value!);
        const id=nonce();sessions.set(id,{csrf:nonce(),expires:ms+8*60*60_000,confirmations:new Map()});
        res.setHeader('Set-Cookie',`mp_admin=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        return respond(res,200,{ok:true});
      }
      const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('mp_admin='))?.slice(9);
      const session=cookie?sessions.get(cookie):undefined;if(!session)return refuse(res,401,'unauthorized');
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)return refuse(res,403,'csrfDenied');
      if(path==='/api/session'&&req.method==='GET')return respond(res,200,{csrfToken:session.csrf,mode:options.mode,actor,readOnly:!!options.readOnly,
        photoAccess:!!options.reader,expiresAt:new Date(session.expires).toISOString(),publicationNotice:'承認と一般公開は別の操作です。公開済みはこの接続では未照合です。写真・位置・説明は非公開の審査資料です。'});
      if(path==='/api/reports'&&req.method==='GET')return respond(res,200,await listAdminReports(options.reports,{status:url.searchParams.get('status')??undefined,cursor:url.searchParams.get('cursor')??undefined},now));
      const reportMatch=/^\/api\/reports\/(rp_[0-9A-HJKMNP-TV-Z]{26})$/.exec(path);
      if(reportMatch&&req.method==='GET'){
        const detail=await getAdminReport(options.reports,reportMatch[1],now);const duplicates:unknown[]=[];let duplicatesChecked=false;
        if(options.canonical){try{
          for(const row of await duplicateCandidates(options.reports,options.canonical,{reportIds:[reportMatch[1]],now})){
            for(const s of row.nearbySpots){const spot=await options.canonical.prepare('SELECT spot_id,name,latitude,longitude FROM spots WHERE spot_id=?').bind(s.spotId).first();if(spot)duplicates.push({...spot,distanceMeters:s.distanceMetres});}
            for(const r of row.nearbyReports){const other=await getAdminReport(options.reports,r.reportId,now);duplicates.push({report_id:r.reportId,name:other.report.claim_host_name,latitude:other.report.proposed_latitude,longitude:other.report.proposed_longitude,distanceMeters:r.distanceMetres});}
          }
          duplicatesChecked=true;
        }catch{duplicates.length=0;}}
        return respond(res,200,{...detail,duplicates,duplicatesChecked});
      }
      const photoMatch=/^\/api\/photos\/(ph_[0-9a-f]{64})$/.exec(path);
      if(photoMatch&&req.method==='GET'){
        if(!options.reader)return refuse(res,503,'privatePhotoConnectionRequired');
        const photo=await readPrivateEvidencePhoto(options.reports,options.reader,photoMatch[1],clock);
        res.writeHead(200,{'Content-Type':photo.mediaType,'Content-Length':photo.bytes.length});res.end(photo.bytes);return;
      }
      if((path==='/api/confirm'||path==='/api/decide')&&req.method==='POST'){
        if(options.readOnly)return refuse(res,403,'readOnly');
        const schema=path==='/api/decide'?decisionSchema.extend({confirmationToken:z.string().regex(/^[0-9a-f]{64}$/)}):decisionSchema;
        const parsed=schema.safeParse(await json(req));if(!parsed.success)return refuse(res,400,'invalidDecision');
        const {confirmationToken,...payload}=parsed.data as z.infer<typeof decisionSchema>&{confirmationToken?:string};
        const digest=hash(JSON.stringify(payload)).toString('hex');
        for(const [key,value]of session.confirmations)if(value.expires<=ms)session.confirmations.delete(key);
        if(path==='/api/confirm'){
          if(session.confirmations.size>=32)return refuse(res,429,'confirmationLimit');
          const detail=await getAdminReport(options.reports,payload.reportId,now);if(detail.version!==payload.expectedVersion)return refuse(res,409,'staleDecision');
          const token=nonce();session.confirmations.set(token,{digest,expires:ms+120_000,used:false});
          return respond(res,200,{confirmationToken:token,summary:`${payload.photoId?'写真':'投稿'} ${payload.reportId}\n状態：${payload.state}\n理由：${payload.reason}\n公開データは変更しません。`});
        }
        const confirmation=session.confirmations.get(confirmationToken!);
        if(!confirmation||confirmation.digest!==digest)return refuse(res,403,'confirmationRequired');
        if(confirmation.completed)return respond(res,200,{detail:await getAdminReport(options.reports,payload.reportId,clock()),replayed:true,publicationChanged:false});
        if(confirmation.used||inFlight.has(payload.reportId))return refuse(res,409,'operationInProgress');
        confirmation.used=true;inFlight.add(payload.reportId);
        try{const result=await applyAdminDecision(options.reports,{...payload,decidedBy:actor},clock());confirmation.completed=true;return respond(res,200,{...result,publicationChanged:false});}
        finally{inFlight.delete(payload.reportId);}
      }
      return refuse(res,404,'notFound');
    }catch(error){
      // Never log bodies, report IDs, photo keys, passphrases, cookies, DB errors or object bytes.
      if(error instanceof AdminReviewError||error instanceof PrivatePhotoViewError)return refuse(res,error.status,error.code);
      return refuse(res,503,'operationUnavailable');
    }
  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;server.maxHeadersCount=40;
  return {server,listen:async(port=4318)=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});const address=server.address();if(!address||typeof address==='string')throw new Error('listenerUnavailable');origin=`http://127.0.0.1:${address.port}`;return origin;},close:async()=>{sessions.clear();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
