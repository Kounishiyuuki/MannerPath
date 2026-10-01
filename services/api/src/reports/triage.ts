// Moderation triage for a growing community queue (ADR-0013). Read-only: it filters, flags and orders reports for a
// human; it decides nothing. There is no bulk accept — every decision stays one recordModerationDecision call.
//
// Rows carry IDs, categories, states and flags only. No note, pin, free-text claim, date or submitter key leaves
// this module, so a triage listing is safe to paste into a ticket.

import { type Db, isoSeconds } from "../db.ts";
import { pageLimit } from "./moderation.ts";
import { DUPLICATE_RADIUS_METRES, duplicateCandidates, spotEvidenceStates } from "../pipeline/community-evidence.ts";

export const TRIAGE_CATEGORIES = [
  "newSpot", "stillExists", "missing", "moved", "typeChange", "accessChange", "hoursChange", "tobaccoChange", "prohibited", "other",
] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];
/** `correction` is a filter alias for every field correction. */
export const CORRECTION_CATEGORIES: readonly TriageCategory[] = ["typeChange", "accessChange", "hoursChange", "tobaccoChange"];

export const TRIAGE_FLAGS = ["duplicateCandidate", "highReportCount", "conflicting", "old"] as const;
export type TriageFlag = (typeof TRIAGE_FLAGS)[number];
/** Three or more open reports about one spot. */
export const HIGH_REPORT_COUNT = 3;
/** A pending report older than this, or this close to its 90-day minimization, is flagged `old`. */
export const OLD_AFTER_DAYS = 14;

export function triageCategory(reportType: string, finding: string | null): TriageCategory {
  switch (reportType) {
    case "missing": return "newSpot";
    case "exists": return "stillExists";
    case "moved": return "moved";
    case "accessChanged": return "accessChange";
    case "hoursChanged": return "hoursChange";
    case "tobaccoTypeChanged": return "tobaccoChange";
    case "prohibited": return "prohibited";
    default:
      return finding === "notFound" || finding === "removed" ? "missing" : finding === "wrongType" ? "typeChange" : "other";
  }
}

export interface TriageRow {
  reportId: string;
  category: TriageCategory;
  spotId: string | null;
  state: string;
  reconciliationState: string;
  consented: boolean;
  flags: TriageFlag[];
  priority: "P0" | "P1" | "P2" | "P3";
}

export interface TriageOptions {
  now: Date;
  /** Moderation state to list; default `pending`. */
  state?: string;
  /** Categories to keep; `correction` expands to every field correction. Empty: all. */
  categories?: readonly (TriageCategory | "correction")[];
  /** Only rows carrying this flag. */
  flag?: TriageFlag;
  limit?: number;
  cursor?: string;
  /** Internal snapshot fence; report inserts do not invalidate traversal. */
  snapshotMaxRowid?: number;
}

/** Priority buckets, then oldest first. At 14 days every pending item enters P0 to prevent starvation.
 * Flags describe the selected page; they never reorder it or affect its immutable cursor keys. */
export async function triageQueue(db: Db, dataDb: Db, opts: TriageOptions): Promise<TriageRow[]> {
  const now = isoSeconds(opts.now);
  const revision = (await db.prepare("SELECT revision FROM moderation_queue_revision WHERE singleton = 1").first<{ revision: number }>())!.revision;
  const scope = JSON.stringify([opts.state ?? "pending", [...(opts.categories ?? [])].sort()]);
  const limit = pageLimit(opts.limit);
  let cursor: { priority: number; receivedAt: string; reportId: string; snapshot: string; revision: number; scope: string; maxRowid: number } | null = null;
  if (opts.cursor) {
    try {
      const c = JSON.parse(atob(opts.cursor));
      if (c.v !== 1 || !Number.isInteger(c.priority) || c.priority < 0 || c.priority > 3
        || typeof c.receivedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.receivedAt) || !/^rp_[0-9A-HJKMNP-TV-Z]{26}$/.test(c.reportId)
        || typeof c.snapshot !== "string" || !Number.isFinite(Date.parse(c.snapshot)) || !Number.isSafeInteger(c.revision) || typeof c.scope !== "string" || !Number.isSafeInteger(c.maxRowid) || c.maxRowid < 0) throw new Error();
      cursor = c;
    } catch { throw new Error("invalid triage cursor"); }
  }
  if (cursor && (cursor.revision !== revision || cursor.scope !== scope)) throw new Error("triage cursor is stale or belongs to another filter; restart the queue");
  const maxRowid = cursor?.maxRowid ?? opts.snapshotMaxRowid ?? (await db.prepare("SELECT coalesce(max(rowid), 0) AS n FROM reports").first<{ n: number }>())!.n;
  const snapshot = cursor?.snapshot ?? now;
  const ageBefore = isoSeconds(new Date(new Date(snapshot).getTime() - OLD_AFTER_DAYS * 86_400_000));
  const wanted = new Set((opts.categories ?? []).flatMap((c) => (c === "correction" ? CORRECTION_CATEGORIES : [c])));
  const oldBefore = isoSeconds(new Date(opts.now.getTime() - OLD_AFTER_DAYS * 86_400_000));
  const minimizeSoon = isoSeconds(new Date(opts.now.getTime() + OLD_AFTER_DAYS * 86_400_000));
  const { results } = await db.prepare(
    `WITH queue AS (
       SELECT r.report_id, r.report_type, r.finding, r.subject_spot_id, r.received_at, r.minimize_after, r.accepted_terms_version,
              m.state, m.reconciliation_state,
              CASE WHEN r.received_at < ? OR r.report_type = 'moved'
                     OR (r.report_type = 'other' AND r.finding IN ('notFound', 'removed'))
                     OR EXISTS (SELECT 1 FROM reports n JOIN report_moderation nm ON nm.report_id = n.report_id
                          WHERE n.subject_spot_id = r.subject_spot_id AND nm.state = 'accepted'
                            AND nm.reconciliation_state <> 'discarded' AND n.redacted_at IS NULL AND n.minimize_after > ?
                            AND n.report_type = 'other' AND n.finding IN ('notFound', 'removed')
                            AND n.submitter_hash <> r.submitter_hash AND r.report_type = 'exists') THEN 0
                   WHEN r.report_type = 'exists' THEN 1 WHEN r.report_type = 'missing' THEN 2 ELSE 3 END AS priority,
              CASE r.report_type WHEN 'missing' THEN 'newSpot' WHEN 'exists' THEN 'stillExists' WHEN 'moved' THEN 'moved'
                   WHEN 'accessChanged' THEN 'accessChange' WHEN 'hoursChanged' THEN 'hoursChange'
                   WHEN 'tobaccoTypeChanged' THEN 'tobaccoChange' WHEN 'prohibited' THEN 'prohibited'
                   ELSE CASE WHEN r.finding IN ('notFound','removed') THEN 'missing'
                             WHEN r.finding = 'wrongType' THEN 'typeChange' ELSE 'other' END END AS category
       FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
       WHERE m.state = ? AND r.received_at <= ? AND r.rowid <= ?
     ) SELECT * FROM queue WHERE (? = '[]' OR category IN (SELECT value FROM json_each(?)))
       AND (priority > ? OR (priority = ? AND (received_at > ? OR (received_at = ? AND report_id > ?))))
     ORDER BY priority, received_at, report_id LIMIT ?`,
  ).bind(ageBefore, snapshot, opts.state ?? "pending", snapshot, maxRowid, JSON.stringify([...wanted]), JSON.stringify([...wanted]),
    cursor?.priority ?? -1, cursor?.priority ?? -1, cursor?.receivedAt ?? "", cursor?.receivedAt ?? "", cursor?.reportId ?? "", limit)
    .all<{ report_id: string; report_type: string; finding: string | null; subject_spot_id: string | null;
    received_at: string; minimize_after: string; accepted_terms_version: string | null; state: string; reconciliation_state: string; priority: number }>();
  const spotIds = [...new Set(results.map((r) => r.subject_spot_id).filter((id): id is string => id !== null))];

  const openPerSpot = new Map<string, number>();
  const { results: open } = await db.prepare(
    `SELECT r.subject_spot_id AS spot_id, count(*) AS n FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.subject_spot_id IS NOT NULL AND m.state IN ('pending', 'accepted', 'needsInfo') AND m.reconciliation_state IN ('notQueued', 'queued')
       AND r.subject_spot_id IN (SELECT value FROM json_each(?))
     GROUP BY r.subject_spot_id`,
  ).bind(JSON.stringify(spotIds)).all<{ spot_id: string; n: number }>();
  for (const o of open) openPerSpot.set(o.spot_id, o.n);
  const duplicates = new Set((await duplicateCandidates(db, dataDb, { now: opts.now, radiusMetres: DUPLICATE_RADIUS_METRES, reportIds: results.map((r) => r.report_id), limit })).map((d) => d.reportId));
  const conflicting = new Set((await spotEvidenceStates(db, dataDb, { now: opts.now, spotIds })).filter((s) => s.conflicting).map((s) => s.spotId));

  const rows: (TriageRow & { receivedAt: string })[] = [];
  for (const r of results) {
    const category = triageCategory(r.report_type, r.finding);
    if (wanted.size > 0 && !wanted.has(category)) continue;
    const flags: TriageFlag[] = [];
    if (duplicates.has(r.report_id)) flags.push("duplicateCandidate");
    if (r.subject_spot_id !== null && (openPerSpot.get(r.subject_spot_id) ?? 0) >= HIGH_REPORT_COUNT) flags.push("highReportCount");
    if (r.subject_spot_id !== null && conflicting.has(r.subject_spot_id)) flags.push("conflicting");
    if (r.received_at < oldBefore || (r.minimize_after > now && r.minimize_after < minimizeSoon)) flags.push("old");
    if (opts.flag !== undefined && !flags.includes(opts.flag)) continue;
    rows.push({
      reportId: r.report_id, category, spotId: r.subject_spot_id, state: r.state, reconciliationState: r.reconciliation_state,
      consented: r.accepted_terms_version !== null, flags, priority: `P${r.priority}` as TriageRow["priority"], receivedAt: r.received_at,
    });
  }
  const endRevision = (await db.prepare("SELECT revision FROM moderation_queue_revision WHERE singleton = 1").first<{ revision: number }>())!.revision;
  if (endRevision !== revision) throw new Error("triage queue changed while reading; restart the queue");
  return rows.map(({ receivedAt: _r, ...row }) => row);

}

export interface TriageSummary {
  byCategory: Record<string, Record<string, number>>;
  pending: number;
  accepted: number;
  rejected: number;
  applied: number;
  /**
   * Accepted reports that could not be published today whatever the reviewer did: the community source is not
   * approved, or the report has no consent, or its consented terms version is not granted (Issue #124).
   */
  rightsBlocked: number;
}

/** Counts stay in REPORTS_DB; source and reviewed terms rights stay in DATA_DB. No cross-store join. */
export async function triageSummary(db: Db, dataDb: Db): Promise<TriageSummary> {
  const { results: reports } = await db.prepare(
    `SELECT r.report_type, r.finding, m.state, m.reconciliation_state, r.accepted_terms_version, count(*) AS n
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     GROUP BY r.report_type, r.finding, m.state, m.reconciliation_state, r.accepted_terms_version`,
  ).all<{ report_type: string; finding: string | null; state: string; reconciliation_state: string; accepted_terms_version: string | null; n: number }>();
  const rightsOf = new Map<string | null, string | null>();
  for (const version of new Set(reports.map((r) => r.accepted_terms_version))) {
    const t = version === null ? null : await dataDb.prepare("SELECT publication_rights FROM report_terms_versions WHERE terms_version = ?")
      .bind(version).first<{ publication_rights: string }>();
    rightsOf.set(version, t?.publication_rights ?? null);
  }
  const results = reports.map((r) => ({ ...r, rights: rightsOf.get(r.accepted_terms_version) ?? null }));
  const source = await dataDb.prepare("SELECT publication_status FROM sources WHERE kind = 'userReport' LIMIT 1").first<{ publication_status: string }>();
  const sourceApproved = source?.publication_status === "approved";
  const byCategory: Record<string, Record<string, number>> = {};
  let rightsBlocked = 0;
  for (const r of results) {
    const c = triageCategory(r.report_type, r.finding);
    byCategory[c] ??= {};
    byCategory[c][r.state] = (byCategory[c][r.state] ?? 0) + r.n;
    if (r.state === "accepted" && (!sourceApproved || r.rights !== "granted")) rightsBlocked += r.n;
  }
  return {
    byCategory: Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => (a < b ? -1 : 1))),
    pending: results.filter((r) => r.state === "pending").reduce((n, r) => n + r.n, 0),
    accepted: results.filter((r) => r.state === "accepted").reduce((n, r) => n + r.n, 0),
    rejected: results.filter((r) => r.state === "rejected").reduce((n, r) => n + r.n, 0),
    applied: results.filter((r) => r.reconciliation_state === "applied").reduce((n, r) => n + r.n, 0),
    rightsBlocked,
  };
}

export async function triageQueuePage(db: Db, dataDb: Db, opts: TriageOptions) {
  if (opts.flag) throw new Error("flag filtering is available on the bounded triage page only; omit --flag for cursor traversal");
  const startRevision = (await db.prepare("SELECT revision FROM moderation_queue_revision WHERE singleton = 1").first<{ revision: number }>())!.revision;
  const limit = pageLimit(opts.limit, 200, 999);
  const maxRowid = opts.cursor ? JSON.parse(atob(opts.cursor)).maxRowid : (await db.prepare("SELECT coalesce(max(rowid), 0) AS n FROM reports").first<{ n: number }>())!.n;
  const items = await triageQueue(db, dataDb, { ...opts, snapshotMaxRowid: maxRowid, limit: limit + 1 });
  const hasMore = items.length > limit;
  const page = items.slice(0, limit);
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last) {
    const row = await db.prepare("SELECT received_at FROM reports WHERE report_id = ?").bind(last.reportId).first<{ received_at: string }>();
    const snapshot = opts.cursor ? JSON.parse(atob(opts.cursor)).snapshot : isoSeconds(opts.now);
    const revision = (await db.prepare("SELECT revision FROM moderation_queue_revision WHERE singleton = 1").first<{ revision: number }>())!.revision;
    nextCursor = btoa(JSON.stringify({ v: 1, revision, maxRowid, scope: JSON.stringify([opts.state ?? "pending", [...(opts.categories ?? [])].sort()]), priority: Number(last.priority.slice(1)), receivedAt: row!.received_at, reportId: last.reportId, snapshot }));
  }
  const endRevision = (await db.prepare("SELECT revision FROM moderation_queue_revision WHERE singleton = 1").first<{ revision: number }>())!.revision;
  if (startRevision !== endRevision) throw new Error("triage queue changed while reading; restart the queue");
  return { items: page, nextCursor };
}
