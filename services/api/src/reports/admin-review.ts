// Local operator tooling only; never wired into the public Worker.
import { type Db, isoSeconds, sha256Hex } from '../db.ts';
import { DECISION_REASONS, type ModerationState, type ModerationQueueRow, decodeReportCursor, encodeReportCursor, pageLimit } from './moderation.ts';
import { PHOTO_DECISION_REASONS } from './photos.ts';
import { PHOTO_ERASURE_LEAD_MS } from './photo-storage.ts';

export class AdminReviewError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(code); this.code=code; this.status=status; }
}
export interface AdminPhoto {
  photo_id: string; lifecycle: string; moderation_status: string;
  created_at: string; upload_expires_at: string; delete_after: string; view_until: string;
  width: number; height: number; byte_length: number; decision_reason: string | null;
  previewAvailable: boolean;
}
/** An operator's independent check of a new place (REPORTS_DB 0011): bounded metadata, never free text. */
export interface AdminEvidenceCheck {
  operation_id: string; basis: 'officialSource' | 'siteVisit'; source_url: string | null; checked_on: string;
  recorded_by: string; recorded_at: string;
}
export interface AdminHistory {
  operation_id: string; report_id: string; photo_id: string | null; state: string; reason: string;
  decided_by: string; decided_at: string; privacy_checked: number;
}
export type AdminReport = ModerationQueueRow & { minimize_after: string };
export interface AdminReportDetail {
  report: AdminReport; photos: AdminPhoto[]; history: AdminHistory[]; evidenceChecks: AdminEvidenceCheck[]; version: string;
  publicationState: 'awaitingPublication' | 'artifactExported' | 'discarded' | 'notApproved'; publicationVerified: false;
}
export interface AdminDecision {
  reportId: string; photoId?: string; state: string; reason: string; expectedVersion: string;
  operationId: string; privacyChecked: boolean; decidedBy: string;
}
// Version covers legacy CLI changes, attachments, retention and admin audit revisions, including
// same-second edits. It contains only bounded metadata, never photo keys or reporter content.
const VERSION = `json_array(m.state,m.reconciliation_state,m.decided_at,m.decided_by,m.decision_reason,m.updated_at,
 r.redacted_at,r.minimize_after,
 (SELECT coalesce(group_concat(v,'|'),'') FROM (SELECT json_array(photo_id,lifecycle,moderation_status,decided_at,decision_reason,delete_after) v FROM community_evidence_photos WHERE report_id=r.report_id ORDER BY photo_id)),
 (SELECT count(*) FROM admin_review_audit WHERE report_id=r.report_id),
 (SELECT count(*) FROM new_spot_evidence_checks WHERE report_id=r.report_id))`;
const COLUMNS = `r.report_id,r.report_type,r.subject_spot_id,r.proposed_latitude,r.proposed_longitude,r.observed_on,
 r.note,r.attestation_status,r.received_at,r.redacted_at,r.minimize_after,m.state,m.reconciliation_state,r.accepted_terms_version,
 r.claim_spot_type,r.claim_spot_subtype,r.claim_access_type,r.claim_access_detail,r.claim_host_type,r.claim_environment,
 r.claim_supports_paper,r.claim_supports_heated,r.claim_host_name,r.claim_hours_note,r.finding`;
const FROM = 'FROM reports r JOIN report_moderation m ON m.report_id=r.report_id';
function safeReport(row: AdminReport, at: string): AdminReport {
  if (!row.redacted_at && row.minimize_after > at) return row;
  return { ...row, proposed_latitude:null, proposed_longitude:null, observed_on:null, note:null,
    claim_spot_type:null,claim_spot_subtype:null,claim_access_type:null,claim_access_detail:null,claim_host_type:null,
    claim_environment:null,claim_supports_paper:null,claim_supports_heated:null,claim_host_name:null,claim_hours_note:null,finding:null };
}
export async function getAdminReport(db: Db, reportId: string, now: Date): Promise<AdminReportDetail> {
  const at = isoSeconds(now), eraseBy = isoSeconds(new Date(now.getTime()+PHOTO_ERASURE_LEAD_MS));
  const row = await db.prepare(`SELECT ${COLUMNS}, ${VERSION} version ${FROM} WHERE r.report_id=?`).bind(reportId).first<AdminReport & {version:string}>();
  if (!row) throw new AdminReviewError('reportNotFound',404);
  const {version,...report} = row;
  const photos = await db.prepare(`SELECT photo_id,lifecycle,moderation_status,created_at,upload_expires_at,delete_after,width,height,byte_length,decision_reason,
    CASE WHEN lifecycle='ready' AND moderation_status<>'rejected' AND delete_after>? AND NOT EXISTS(SELECT 1 FROM community_photo_deletions d WHERE d.storage_key=p.storage_key) THEN 1 ELSE 0 END available
    FROM community_evidence_photos p WHERE report_id=? ORDER BY created_at,photo_id`).bind(eraseBy,reportId).all<Omit<AdminPhoto,'previewAvailable'|'view_until'> & {available:number}>();
  const history = await db.prepare(`SELECT operation_id,report_id,photo_id,state,reason,decided_by,decided_at,privacy_checked FROM admin_review_audit WHERE report_id=? ORDER BY decided_at,operation_id`).bind(reportId).all<AdminHistory>();
  const checks = await db.prepare(`SELECT operation_id,basis,source_url,checked_on,recorded_by,recorded_at FROM new_spot_evidence_checks WHERE report_id=? ORDER BY recorded_at,operation_id`).bind(reportId).all<AdminEvidenceCheck>();
  return {report:safeReport(report,at),version,evidenceChecks:checks.results,photos:photos.results.map(({available,...p})=>({...p,view_until:isoSeconds(new Date(Date.parse(p.delete_after)-PHOTO_ERASURE_LEAD_MS)),previewAvailable:!!available && !row.redacted_at && row.minimize_after===p.delete_after && row.minimize_after>eraseBy})),history:history.results,
    publicationState:row.state!=='accepted'?'notApproved':row.reconciliation_state==='applied'?'artifactExported':row.reconciliation_state==='discarded'?'discarded':'awaitingPublication',publicationVerified:false};
}
export async function listAdminReports(db: Db, opts: {status?: ModerationState | 'awaitingPublication' | 'published'; cursor?:string;limit?:number} = {}, now = new Date()) {
  let limit: number; let cursor: ReturnType<typeof decodeReportCursor>;
  try {limit=pageLimit(opts.limit,50,100);cursor=decodeReportCursor(opts.cursor);} catch {throw new AdminReviewError('invalidPage',400);}
  if(opts.status && !['pending','accepted','needsInfo','rejected','duplicate','awaitingPublication','published'].includes(opts.status)) throw new AdminReviewError('invalidStatus',400);
  const status=opts.status==='awaitingPublication'?'accepted':opts.status;
  const rows=await db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE (? IS NULL OR m.state=?) AND (?=0 OR m.reconciliation_state IN ('notQueued','queued')) AND (? IS NULL OR r.received_at<? OR (r.received_at=? AND r.report_id<?)) ORDER BY r.received_at DESC,r.report_id DESC LIMIT ?`)
    .bind(status??null,status??null,opts.status==='awaitingPublication'?1:0,cursor?.receivedAt??null,cursor?.receivedAt??null,cursor?.receivedAt??null,cursor?.reportId??null,limit+1).all<AdminReport>();
  const tally=await db.prepare('SELECT state,reconciliation_state,count(*) n FROM report_moderation GROUP BY state,reconciliation_state').all<{state:ModerationState;reconciliation_state:string;n:number}>();
  const counts={pending:0,accepted:0,needsInfo:0,rejected:0,duplicate:0,awaitingPublication:0,exportedUnverified:0,published:0};
  for(const row of tally.results){counts[row.state]+=row.n;if(row.state==='accepted'){
    if(['notQueued','queued'].includes(row.reconciliation_state))counts.awaitingPublication+=row.n;
    if(row.reconciliation_state==='applied')counts.exportedUnverified+=row.n;
  }}
  const items=rows.results.slice(0,limit).map(r=>safeReport(r,isoSeconds(now)));const last=items.at(-1);
  return {items,counts,nextCursor:rows.results.length>limit && last?encodeReportCursor({receivedAt:last.received_at,reportId:last.report_id}):null,publicationVerified:false as const};
}
export async function applyAdminDecision(db: Db, input: AdminDecision, now: Date): Promise<{detail:AdminReportDetail;replayed:boolean}> {
  if(!/^rp_[0-9A-HJKMNP-TV-Z]{26}$/.test(input.reportId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId)
    || !/^[a-zA-Z0-9._-]{1,64}$/.test(input.decidedBy) || typeof input.expectedVersion!=='string' || input.expectedVersion.length>8192 || typeof input.privacyChecked!=='boolean') throw new AdminReviewError('invalidDecision',400);
  const photo= input.photoId!==undefined;
  if(photo ? (!/^ph_[0-9a-f]{64}$/.test(input.photoId!) || !['approved','rejected'].includes(input.state) || !(PHOTO_DECISION_REASONS as readonly string[]).includes(input.reason))
    : (!['accepted','needsInfo','rejected','duplicate'].includes(input.state) || !(DECISION_REASONS as readonly string[]).includes(input.reason))) throw new AdminReviewError('invalidDecision',400);
  const hash=await sha256Hex(JSON.stringify([input.reportId,input.photoId??null,input.state,input.reason,input.expectedVersion,input.privacyChecked,input.decidedBy]));
  const prior=await db.prepare('SELECT request_hash FROM admin_review_audit WHERE operation_id=?').bind(input.operationId).first<{request_hash:string}>();
  if(prior){if(prior.request_hash!==hash)throw new AdminReviewError('operationConflict',409);return {detail:await getAdminReport(db,input.reportId,now),replayed:true};}
  const current=await getAdminReport(db,input.reportId,now);const at=isoSeconds(now),eraseBy=isoSeconds(new Date(now.getTime()+PHOTO_ERASURE_LEAD_MS));
  if(current.version!==input.expectedVersion)throw new AdminReviewError('staleDecision',409);
  if(current.report.redacted_at || current.report.minimize_after<=at)throw new AdminReviewError('reportExpired',410);
  if((photo && input.state==='approved' || !photo && input.state==='accepted') && !input.privacyChecked)throw new AdminReviewError('privacyCheckRequired',400);
  const p=current.photos.find(p=>p.photo_id===input.photoId);
  if(photo && (!p || !p.previewAvailable || p.moderation_status!=='pending'))throw new AdminReviewError('photoUnavailable',409);
  // v1.0 takes new places without photos, but never on the reporter's words alone: accepting one needs a viewable
  // approved photo (v1.1) or an operator's recorded independent check (recordIndependentEvidence).
  if(!photo && input.state==='accepted' && current.report.report_type==='missing' && !current.photos.some(p=>p.previewAvailable&&p.moderation_status==='approved') && !current.evidenceChecks.length)throw new AdminReviewError('independentEvidenceRequired',409);
  if(!photo && current.report.reconciliation_state!=='notQueued')throw new AdminReviewError('reconciliationLocked',409);
  // The legacy recordModerationDecision overwrites unconditionally. These same-table updates are
  // guarded with an audit insertion in one D1 transaction to preserve CAS and immutable history.
  const guardPhoto = photo ? `AND EXISTS(SELECT 1 FROM community_evidence_photos p WHERE p.report_id=r.report_id AND p.photo_id=? AND p.lifecycle='ready' AND p.moderation_status='pending' AND p.delete_after=r.minimize_after AND p.delete_after>? AND NOT EXISTS(SELECT 1 FROM community_photo_deletions d WHERE d.storage_key=p.storage_key))` : '';
  const guardAccept = !photo && input.state==='accepted' && current.report.report_type==='missing' ? `AND (EXISTS(SELECT 1 FROM community_evidence_photos p WHERE p.report_id=r.report_id AND p.lifecycle='ready' AND p.moderation_status='approved' AND p.delete_after=r.minimize_after AND p.delete_after>? AND NOT EXISTS(SELECT 1 FROM community_photo_deletions d WHERE d.storage_key=p.storage_key))
    OR EXISTS(SELECT 1 FROM new_spot_evidence_checks c WHERE c.report_id=r.report_id))` : '';
  const insert=db.prepare(`INSERT INTO admin_review_audit(operation_id,report_id,photo_id,state,reason,decided_by,decided_at,privacy_checked,request_hash)
    SELECT ?,?,?,?,?,?,?,?,? ${FROM} WHERE r.report_id=? AND ${VERSION}=? AND r.redacted_at IS NULL AND r.minimize_after>? ${guardPhoto} ${guardAccept}`)
    .bind(input.operationId,input.reportId,input.photoId??null,input.state,input.reason,input.decidedBy,at,input.privacyChecked?1:0,hash,input.reportId,input.expectedVersion,at,...(photo?[input.photoId,eraseBy]:[]),...(guardAccept?[eraseBy]:[]));
  const auditGuard='EXISTS(SELECT 1 FROM admin_review_audit WHERE operation_id=? AND request_hash=? AND report_id=? AND photo_id IS ? AND state=? AND reason=? AND decided_by=? AND decided_at=? AND privacy_checked=?)';
  const auditBindings=[input.operationId,hash,input.reportId,input.photoId??null,input.state,input.reason,input.decidedBy,at,input.privacyChecked?1:0];
  const update=photo ? db.prepare(`UPDATE community_evidence_photos SET moderation_status=?,decided_at=?,decided_by=?,decision_reason=?,lifecycle=? WHERE photo_id=? AND ${auditGuard}`)
    .bind(input.state,at,input.decidedBy,input.reason,input.state==='rejected'?'deleting':'ready',input.photoId,...auditBindings)
    : db.prepare(`UPDATE report_moderation SET state=?,decided_at=?,decided_by=?,decision_reason=?,updated_at=? WHERE report_id=? AND ${auditGuard}`)
      .bind(input.state,at,input.decidedBy,input.reason,at,input.reportId,...auditBindings);
  try{await db.batch([insert,update]);}catch{
    // Concurrent delivery of the same confirmation is a replay, not another decision.
    const raced=await db.prepare('SELECT request_hash FROM admin_review_audit WHERE operation_id=?').bind(input.operationId).first<{request_hash:string}>();
    if(raced?.request_hash===hash)return {detail:await getAdminReport(db,input.reportId,now),replayed:true};
    throw new AdminReviewError('decisionConflict',409);
  }
  const committed=await db.prepare('SELECT request_hash FROM admin_review_audit WHERE operation_id=?').bind(input.operationId).first<{request_hash:string}>();
  if(!committed)throw new AdminReviewError('staleDecision',409);
  if(committed.request_hash!==hash)throw new AdminReviewError('operationConflict',409);
  return {detail:await getAdminReport(db,input.reportId,now),replayed:false};
}

export interface EvidenceCheckInput {
  reportId: string; basis: string; sourceUrl?: string; checkedOn: string; expectedVersion: string;
  operationId: string; decidedBy: string;
}
const EVIDENCE_URL_MAX = 300;
function calendarDate(value: string): boolean {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === value;
}
/** An https page an operator read, without credentials or fragment; the database checks the same bounds (0011). */
export function evidenceSourceUrl(value: string): boolean {
  if (value.length < 12 || value.length > EVIDENCE_URL_MAX || !/^[!-~]+$/.test(value) || value.includes('#')) return false;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') && u.href === value; }
  catch { return false; }
}
/**
 * Records that an operator checked a new place independently of its reporter: an official source page they read, or
 * a visit in person. It approves nothing; it only makes the report eligible for acceptance. Same CAS and
 * idempotent-replay rules as applyAdminDecision; the premises (open `missing` report, check date between arrival
 * and now in Japan time) are also enforced by REPORTS_DB 0011.
 */
export async function recordIndependentEvidence(db: Db, input: EvidenceCheckInput, now: Date): Promise<{detail:AdminReportDetail;replayed:boolean}> {
  if(!/^rp_[0-9A-HJKMNP-TV-Z]{26}$/.test(input.reportId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId)
    || !/^[a-zA-Z0-9._-]{1,64}$/.test(input.decidedBy) || typeof input.expectedVersion!=='string' || input.expectedVersion.length>8192
    || !['officialSource','siteVisit'].includes(input.basis) || !/^\d{4}-\d{2}-\d{2}$/.test(input.checkedOn)
    || !calendarDate(input.checkedOn)
    || (input.basis==='officialSource' ? typeof input.sourceUrl!=='string' || !evidenceSourceUrl(input.sourceUrl) : input.sourceUrl!==undefined)) throw new AdminReviewError('invalidEvidence',400);
  const sourceUrl = input.sourceUrl ?? null;
  const hash=await sha256Hex(JSON.stringify(['evidence',input.reportId,input.basis,sourceUrl,input.checkedOn,input.expectedVersion,input.decidedBy]));
  const prior=await db.prepare('SELECT request_hash FROM new_spot_evidence_checks WHERE operation_id=?').bind(input.operationId).first<{request_hash:string}>();
  if(prior){if(prior.request_hash!==hash)throw new AdminReviewError('operationConflict',409);return {detail:await getAdminReport(db,input.reportId,now),replayed:true};}
  const current=await getAdminReport(db,input.reportId,now);const at=isoSeconds(now);
  if(current.version!==input.expectedVersion)throw new AdminReviewError('staleDecision',409);
  if(current.report.redacted_at || current.report.minimize_after<=at)throw new AdminReviewError('reportExpired',410);
  if(current.report.report_type!=='missing' || !['pending','needsInfo'].includes(current.report.state) || current.report.reconciliation_state!=='notQueued')throw new AdminReviewError('evidenceNotApplicable',409);
  const today=isoSeconds(new Date(now.getTime()+9*3_600_000)).slice(0,10), received=isoSeconds(new Date(Date.parse(current.report.received_at)+9*3_600_000)).slice(0,10);
  if(input.checkedOn<received || input.checkedOn>today)throw new AdminReviewError('evidenceDateOutOfRange',400);
  try{
    await db.prepare(`INSERT INTO new_spot_evidence_checks(operation_id,report_id,basis,source_url,checked_on,recorded_by,recorded_at,request_hash)
      SELECT ?,?,?,?,?,?,?,? ${FROM} WHERE r.report_id=? AND ${VERSION}=?`)
      .bind(input.operationId,input.reportId,input.basis,sourceUrl,input.checkedOn,input.decidedBy,at,hash,input.reportId,input.expectedVersion).run();
  }catch{
    const raced=await db.prepare('SELECT request_hash FROM new_spot_evidence_checks WHERE operation_id=?').bind(input.operationId).first<{request_hash:string}>();
    if(raced?.request_hash===hash)return {detail:await getAdminReport(db,input.reportId,now),replayed:true};
    throw new AdminReviewError('decisionConflict',409);
  }
  const committed=await db.prepare('SELECT request_hash FROM new_spot_evidence_checks WHERE operation_id=?').bind(input.operationId).first<{request_hash:string}>();
  if(!committed)throw new AdminReviewError('staleDecision',409);
  if(committed.request_hash!==hash)throw new AdminReviewError('operationConflict',409);
  return {detail:await getAdminReport(db,input.reportId,now),replayed:false};
}
