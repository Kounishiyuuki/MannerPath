// Moderation triage for a growing community queue (ADR-0013). Read-only: it filters, flags and orders reports for a
// human; it decides nothing. There is no bulk accept — every decision stays one recordModerationDecision call.
//
// Rows carry IDs, categories, states and flags only. No note, pin, free-text claim, date or submitter key leaves
// this module, so a triage listing is safe to paste into a ticket.

import { type Db, isoSeconds } from "../db.ts";
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
}

/** Flagged rows first (more flags first), then oldest first: a fixed, explainable order, not a score. */
export async function triageQueue(db: Db, opts: TriageOptions): Promise<TriageRow[]> {
  const now = isoSeconds(opts.now);
  const oldBefore = isoSeconds(new Date(opts.now.getTime() - OLD_AFTER_DAYS * 86_400_000));
  const minimizeSoon = isoSeconds(new Date(opts.now.getTime() + OLD_AFTER_DAYS * 86_400_000));
  const { results } = await db.prepare(
    `SELECT r.report_id, r.report_type, r.finding, r.subject_spot_id, r.received_at, r.minimize_after, r.accepted_terms_version,
            m.state, m.reconciliation_state
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE m.state = ?
     ORDER BY r.received_at, r.report_id`,
  ).bind(opts.state ?? "pending").all<{ report_id: string; report_type: string; finding: string | null; subject_spot_id: string | null;
    received_at: string; minimize_after: string; accepted_terms_version: string | null; state: string; reconciliation_state: string }>();

  const openPerSpot = new Map<string, number>();
  const { results: open } = await db.prepare(
    `SELECT r.subject_spot_id AS spot_id, count(*) AS n FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     WHERE r.subject_spot_id IS NOT NULL AND m.state IN ('pending', 'accepted', 'needsInfo') AND m.reconciliation_state IN ('notQueued', 'queued')
     GROUP BY r.subject_spot_id`,
  ).all<{ spot_id: string; n: number }>();
  for (const o of open) openPerSpot.set(o.spot_id, o.n);
  const duplicates = new Set((await duplicateCandidates(db, { now: opts.now, radiusMetres: DUPLICATE_RADIUS_METRES })).map((d) => d.reportId));
  const conflicting = new Set((await spotEvidenceStates(db, { now: opts.now })).filter((s) => s.conflicting).map((s) => s.spotId));

  const wanted = new Set((opts.categories ?? []).flatMap((c) => (c === "correction" ? CORRECTION_CATEGORIES : [c])));
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
      consented: r.accepted_terms_version !== null, flags, receivedAt: r.received_at,
    });
  }
  rows.sort((a, b) => b.flags.length - a.flags.length || (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0)
    || (a.reportId < b.reportId ? -1 : 1));
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  return rows.slice(0, limit).map(({ receivedAt: _r, ...row }) => row);
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

/** Counts only, by category and moderation state. */
export async function triageSummary(db: Db): Promise<TriageSummary> {
  const { results } = await db.prepare(
    `SELECT r.report_type, r.finding, m.state, m.reconciliation_state, r.accepted_terms_version,
            (SELECT t.publication_rights FROM report_terms_versions t WHERE t.terms_version = r.accepted_terms_version) AS rights
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id`,
  ).all<{ report_type: string; finding: string | null; state: string; reconciliation_state: string; accepted_terms_version: string | null; rights: string | null }>();
  const source = await db.prepare("SELECT publication_status FROM sources WHERE kind = 'userReport' LIMIT 1").first<{ publication_status: string }>();
  const sourceApproved = source?.publication_status === "approved";
  const byCategory: Record<string, Record<string, number>> = {};
  let rightsBlocked = 0;
  for (const r of results) {
    const c = triageCategory(r.report_type, r.finding);
    byCategory[c] ??= {};
    byCategory[c][r.state] = (byCategory[c][r.state] ?? 0) + 1;
    if (r.state === "accepted" && (!sourceApproved || r.rights !== "granted")) rightsBlocked++;
  }
  return {
    byCategory: Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => (a < b ? -1 : 1))),
    pending: results.filter((r) => r.state === "pending").length,
    accepted: results.filter((r) => r.state === "accepted").length,
    rejected: results.filter((r) => r.state === "rejected").length,
    applied: results.filter((r) => r.reconciliation_state === "applied").length,
    rightsBlocked,
  };
}
