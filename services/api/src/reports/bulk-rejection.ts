// Maintainer CLI only: a bounded, reviewed plan and one D1 batch. No public/admin HTTP route.
import { z } from "zod";
import { type Db, isoSeconds, sha256Hex } from "../db.ts";
import { attestedSubmitter, submitterHash } from "./create.ts";
import { DECISION_REASONS } from "./moderation.ts";

export const BULK_REJECTION_MAX = 40;
export const BULK_REJECTION_REASONS = ["abuse", "outOfScope", "contradictedBySource", "insufficientDetail"] as const;
export class BulkRejectionError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "BulkRejectionError"; }
}
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/).refine((s) => {
  const n = Date.parse(s); return Number.isFinite(n) && isoSeconds(new Date(n)) === s;
});
const reportId = z.string().regex(/^rp_[0-9A-HJKMNP-TV-Z]{26}$/);
const states = z.enum(["pending", "needsInfo", "accepted"]);
const selectorSchema = z.object({
  reportIds: z.array(reportId).min(1).max(BULK_REJECTION_MAX).optional(),
  from: timestamp.optional(), before: timestamp.optional(), keyRequired: z.boolean().optional(),
  states: z.array(states).min(1).max(3).optional(),
}).strict().superRefine((s, c) => {
  if (!s.reportIds && !s.from && !s.before && !s.keyRequired) c.addIssue({ code: "custom", message: "selector required" });
  if (s.reportIds && new Set(s.reportIds).size !== s.reportIds.length) c.addIssue({ code: "custom", message: "duplicate IDs" });
  if (s.states && new Set(s.states).size !== s.states.length) c.addIssue({ code: "custom", message: "duplicate states" });
  if ((s.from === undefined) !== (s.before === undefined)) c.addIssue({ code: "custom", message: "bounded period required" });
  if (s.from && s.before && (Date.parse(s.before) <= Date.parse(s.from) || Date.parse(s.before) - Date.parse(s.from) > 86_400_000)) c.addIssue({ code: "custom", message: "period exceeds one day" });
});
export type BulkSelector = z.infer<typeof selectorSchema>;
export type KeySelection = { keyId: string; pepper: string };
const targetSchema = z.object({
  reportId, receivedAt: timestamp, state: states, updatedAt: timestamp,
  decidedAt: timestamp.nullable(), decidedBy: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable(), decisionReason: z.enum(DECISION_REASONS).nullable(),
}).strict();
const planCoreSchema = z.object({
  version: z.literal(1), createdAt: timestamp, expiresAt: timestamp,
  storeId: z.string().regex(/^[0-9a-f]{32}$/), queueRevision: z.number().int().nonnegative(),
  maxCount: z.number().int().min(1).max(BULK_REJECTION_MAX),
  reason: z.enum(BULK_REJECTION_REASONS), decidedBy: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  selector: selectorSchema, targets: z.array(targetSchema).min(1).max(BULK_REJECTION_MAX),
}).strict();
const planSchema = planCoreSchema.extend({ digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type BulkRejectionPlan = z.infer<typeof planSchema>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function digest(core: z.infer<typeof planCoreSchema>) { return sha256Hex(`mannerpath.bulk-report-rejection.v1\n${canonical(core)}`); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value); if (!p.success) throw new BulkRejectionError("invalidPlan"); return p.data;
}
async function keyHash(selector: BulkSelector, key?: KeySelection): Promise<string | undefined> {
  if (!selector.keyRequired) { if (key) throw new BulkRejectionError("invalidSelector"); return undefined; }
  if (!key || typeof key.keyId !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(key.keyId)
    || typeof key.pepper !== "string" || new TextEncoder().encode(key.pepper.trim()).length < 32) throw new BulkRejectionError("invalidKeySelection");
  try { if (btoa(atob(key.keyId)) !== key.keyId || atob(key.keyId).length !== 32) throw new Error(); }
  catch { throw new BulkRejectionError("invalidKeySelection"); }
  // Exactly the existing report hash, including the original (untrimmed) pepper.
  return submitterHash(attestedSubmitter(key.keyId), key.pepper);
}
function selection(selector: BulkSelector, hash?: string) {
  const where = ["m.reconciliation_state = 'notQueued'"]; const bindings: unknown[] = [];
  const ss = selector.states ?? ["pending"];
  where.push(`m.state IN (${ss.map(() => "?").join(",")})`); bindings.push(...ss);
  if (selector.reportIds) { where.push(`r.report_id IN (${selector.reportIds.map(() => "?").join(",")})`); bindings.push(...selector.reportIds); }
  if (selector.from && selector.before) { where.push("r.received_at >= ? AND r.received_at < ?"); bindings.push(selector.from, selector.before); }
  if (selector.keyRequired) { where.push("r.submitter_hash = ? AND r.attestation_status = 'verified'"); bindings.push(hash); }
  return { where: where.join(" AND "), bindings };
}
async function identity(db: Db) {
  try {
    const row = await db.prepare("SELECT s.store_id AS storeId, q.revision AS queueRevision FROM report_bulk_store_identity s CROSS JOIN moderation_queue_revision q WHERE s.singleton = 1 AND q.singleton = 1 AND EXISTS (SELECT 1 FROM report_store_meta WHERE key = 'store' AND value = 'mannerpath-reports') AND EXISTS (SELECT 1 FROM report_store_meta WHERE key = 'schema' AND value = 'reports-store.v1')").first<{ storeId: string; queueRevision: number }>();
    if (!row) throw new BulkRejectionError("unsupportedStore"); return row;
  } catch { throw new BulkRejectionError("unsupportedStore"); }
}
async function selectTargets(db: Db, selector: BulkSelector, maxCount: number, hash?: string) {
  const query = selection(selector, hash);
  const rows = await db.prepare(`SELECT r.report_id AS reportId, r.received_at AS receivedAt,
    m.state, m.updated_at AS updatedAt, m.decided_at AS decidedAt, m.decided_by AS decidedBy,
    m.decision_reason AS decisionReason FROM reports r JOIN report_moderation m ON r.report_id = m.report_id
    WHERE ${query.where} ORDER BY r.received_at, r.report_id LIMIT ?`).bind(...query.bindings, maxCount + 1).all<z.infer<typeof targetSchema>>();
  if (rows.results.length > maxCount) throw new BulkRejectionError("tooManyReports");
  if (!rows.results.length) throw new BulkRejectionError("emptySelection");
  if (selector.reportIds && rows.results.length !== selector.reportIds.length) throw new BulkRejectionError("ineligibleSelection");
  return rows.results;
}
export async function planBulkReportRejection(db: Db, opts: {
  selector: BulkSelector; reason: BulkRejectionPlan["reason"]; decidedBy: string;
  maxCount?: number; now: Date; key?: KeySelection;
}): Promise<BulkRejectionPlan> {
  const reason = parse(z.enum(BULK_REJECTION_REASONS), opts.reason);
  const decidedBy = parse(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), opts.decidedBy);
  const selector = parse(selectorSchema, opts.selector);
  const maxCount = parse(z.number().int().min(1).max(BULK_REJECTION_MAX), opts.maxCount ?? BULK_REJECTION_MAX);
  const hash = await keyHash(selector, opts.key);
  const before = await identity(db);
  const targets = await selectTargets(db, selector, maxCount, hash);
  const after = await identity(db);
  if (canonical(before) !== canonical(after)) throw new BulkRejectionError("stalePlan");
  const core = parse(planCoreSchema, {
    version: 1, createdAt: isoSeconds(opts.now), expiresAt: isoSeconds(new Date(opts.now.getTime() + 900_000)),
    ...before, maxCount, reason, decidedBy, selector, targets,
  });
  return { ...core, digest: await digest(core) };
}
export async function applyBulkReportRejection(db: Db, input: BulkRejectionPlan, opts: {
  confirmation: string; now: Date; key?: KeySelection;
}): Promise<{ status: "applied" | "alreadyApplied"; count: number; digest: string }> {
  const plan = parse(planSchema, input); const { digest: supplied, ...core } = plan;
  if (await digest(core) !== supplied || opts.confirmation !== supplied
    || plan.targets.length > plan.maxCount || new Set(plan.targets.map((r) => r.reportId)).size !== plan.targets.length
    || Date.parse(plan.expiresAt) - Date.parse(plan.createdAt) !== 900_000) throw new BulkRejectionError("invalidPlan");
  const current = await identity(db);
  if (current.storeId !== plan.storeId) throw new BulkRejectionError("wrongStore");
  const previous = await db.prepare(`SELECT o.target_count AS count FROM report_bulk_rejections o
    JOIN report_bulk_rejection_completions c ON c.operation_id = o.operation_id
    WHERE o.operation_id = ? AND o.target_count = ? AND (SELECT count(*) FROM report_bulk_rejection_targets t WHERE t.operation_id = o.operation_id) = o.target_count`).bind(supplied, plan.targets.length).first<{ count: number }>();
  if (previous) return { status: "alreadyApplied", count: previous.count, digest: supplied };
  if (opts.now.getTime() < Date.parse(plan.createdAt) || opts.now.getTime() >= Date.parse(plan.expiresAt)) throw new BulkRejectionError("expiredPlan");
  if (current.queueRevision !== plan.queueRevision) throw new BulkRejectionError("stalePlan");
  const hash = await keyHash(plan.selector, opts.key);
  const actual = await selectTargets(db, plan.selector, plan.maxCount, hash);
  if (canonical(actual) !== canonical(plan.targets)) throw new BulkRejectionError("stalePlan");
  const query = selection(plan.selector, hash); const at = isoSeconds(opts.now);
  const header = db.prepare(`INSERT INTO report_bulk_rejections (operation_id, reason, decided_by, decided_at, target_count, selector_kind)
    SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM report_bulk_store_identity WHERE store_id = ?)
    AND EXISTS (SELECT 1 FROM moderation_queue_revision WHERE singleton = 1 AND revision = ?)
    AND (SELECT count(*) FROM reports r JOIN report_moderation m ON r.report_id = m.report_id WHERE ${query.where}) = ?`)
    .bind(supplied, plan.reason, plan.decidedBy, at, plan.targets.length,
      plan.selector.keyRequired ? "key" : plan.selector.reportIds ? "reportIds" : "period", plan.storeId, plan.queueRevision, ...query.bindings, plan.targets.length);
  const targets = plan.targets.map((t) => db.prepare(`INSERT INTO report_bulk_rejection_targets
    (operation_id, report_id, received_at, previous_state, previous_updated_at, previous_decided_at, previous_decided_by, previous_decision_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(supplied, t.reportId, t.receivedAt, t.state, t.updatedAt, t.decidedAt, t.decidedBy, t.decisionReason));
  const completion = db.prepare("INSERT INTO report_bulk_rejection_completions (operation_id, completed_at) VALUES (?, ?)").bind(supplied, at);
  try { await db.batch([header, ...targets, completion]); }
  catch {
    // The atomic batch may have committed despite a lost response, or another caller won the
    // same operation. Prove completion; never infer success from a header or partial audit.
    try {
      const completed = await db.prepare(`SELECT o.target_count AS count FROM report_bulk_rejections o
        JOIN report_bulk_rejection_completions c ON c.operation_id = o.operation_id
        WHERE o.operation_id = ? AND o.target_count = ?
          AND (SELECT count(*) FROM report_bulk_rejection_targets t WHERE t.operation_id = o.operation_id) = o.target_count`)
        .bind(supplied, plan.targets.length).first<{ count: number }>();
      if (completed) return { status: "alreadyApplied", count: completed.count, digest: supplied };
    } catch { /* No authoritative completion proof: retry this exact plan. */ }
    throw new BulkRejectionError("applyUnconfirmed");
  }
  return { status: "applied", count: plan.targets.length, digest: supplied };
}
