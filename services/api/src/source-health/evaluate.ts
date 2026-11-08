// Operational triage of advisory health results. Severity only decides workflow colour; it never
// changes registry, publication status, baselines or rights decisions.
import type { HealthResult, HealthSignals } from "./check.ts";
import type { RightsContract } from "./rights.ts";

// Human-maintained review metadata, separate from the production registry. Dates are operational
// reminders (JST calendar days), not legal deadlines or rights expiry.
// A known advisory downgrades exactly one *availability* blocker (`signal`, e.g. "transport:timeout",
// "http:503", "rightsPage:transport:timeout") to advisory while today < expiresAt. It cannot cover rights,
// schema, parser, MIME or relocation signals, and after expiry the blocker returns automatically.
export interface KnownAdvisory { signal: string; reason: string; recordedAt: string; expiresAt: string }
export interface SourceReview {
  sourceId: string; rightsReviewedAt: string; rightsEvidence: string; sourceObservedAt: string | null;
  editionLabel: string | null; editionObservedAt: string; reviewDueAt: string; reviewerNote: string;
  knownAdvisories: KnownAdvisory[]; rights: RightsContract[];
}
export type Severity = "ok" | "advisory" | "blocking";
export interface EvaluatedResult extends HealthResult {
  severity: Severity; blocking: string[]; advisory: string[];
  review: { rightsReviewedAt: string; sourceObservedAt: string | null; observationDateUnknown: boolean; editionLabel: string | null;
    editionObservedAt: string; reviewDueAt: string; humanReviewDue: boolean; reviewerNote: string };
}
export interface HealthReport {
  version: 2; evaluatedOn: string; exitCode: 0 | 1;
  summary: { blocking: string[]; advisory: string[]; ok: string[] }; results: EvaluatedResult[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AVAILABILITY = /^(rightsPage:)?(transport:(tls|timeout|network)|http:5\d\d|rateLimited|unexpectedAccessBlocked)(\([A-Z][A-Z0-9_]*\))?$/;
const MAX_ADVISORY_DAYS = 92;
const SHA256 = /^[0-9a-f]{64}$/;
export function jstDate(now: Date): string { return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10); }

export function validateReviews(reviews: SourceReview[], sourceIds: string[]): void {
  const ids = reviews.map(review => review.sourceId);
  if (new Set(ids).size !== ids.length || ids.length !== sourceIds.length || sourceIds.some(id => !ids.includes(id)))
    throw new Error("Review metadata must list every reviewed health source exactly once");
  for (const review of reviews) {
    const dates = [review.rightsReviewedAt, review.editionObservedAt, review.reviewDueAt,
      ...review.knownAdvisories.flatMap(item => [item.recordedAt, item.expiresAt]), ...review.rights.flatMap(item => [item.reviewedAt, item.reviewDueAt])];
    if (review.sourceObservedAt !== null) dates.push(review.sourceObservedAt);
    if (dates.some(date => typeof date !== "string" || !DATE.test(date) || Number.isNaN(Date.parse(date)))) throw new Error(`Invalid review date for ${review.sourceId}`);
    for (const item of review.knownAdvisories) {
      if (!AVAILABILITY.test(item.signal) || !item.reason) throw new Error(`Known advisory for ${review.sourceId} may only cover an availability signal`);
      const days = (Date.parse(item.expiresAt) - Date.parse(item.recordedAt)) / 86_400_000;
      if (days <= 0 || days > MAX_ADVISORY_DAYS) throw new Error(`Known advisory for ${review.sourceId} needs an expiry within ${MAX_ADVISORY_DAYS} days`);
    }
    // Every source carries a reviewed, scoped rights contract; a baseline is only ever written by a human.
    if (!review.rights.length || review.rights.some(item => !item.url.startsWith("https://") || !SHA256.test(item.reviewedFingerprint)
      || (item.scope.kind === "htmlText" ? !item.scope.ranges.length || item.scope.ranges.some(range => !range.start || !range.end) : !item.scope.fields.length)))
      throw new Error(`Invalid rights contract for ${review.sourceId}`);
  }
}

const covers = (item: KnownAdvisory, reason: string) => reason === item.signal || reason.startsWith(`${item.signal}(`);

export function evaluateResult(result: HealthResult, review: SourceReview, today: string): EvaluatedResult {
  const s = result.signals, raw: string[] = [], advisory: string[] = [];
  if (s.parserCompatible === false) raw.push("parserIncompatible");
  else if (s.schemaCompatible === false) raw.push("schemaIncompatible");
  if (s.crossOriginRelocation) raw.push("crossOriginRelocation");
  else if (result.status === "rightsReviewRequired") raw.push("rightsMetadataMissing");
  if (s.resourceMissing) raw.push("resourceMissing");
  if (s.mimeUnexpected) raw.push("unexpectedMime");
  if (s.accessBlocked) raw.push("unexpectedAccessBlocked");
  if (s.rateLimited) raw.push("rateLimited");
  // Unknown availability failures (timeout, DNS, refused, 5xx, any unclassified status) are blocking:
  // a continuous outage must turn the run red. Only an explicit, expiring known advisory downgrades one.
  if (s.transportFailure) raw.push(`transport:${s.transportFailure}${s.transportCode ? `(${s.transportCode})` : ""}`);
  else if ((s.serverError || s.unexpectedHttpStatus) && result.httpStatus !== null) raw.push(`http:${result.httpStatus}`);
  if (s.rightsChanged) raw.push("rightsChanged");
  if (s.rightsScopeMissing) raw.push("rightsScopeMissing");
  for (const item of result.rights ?? []) {
    if (item.outcome === "unavailable") raw.push(`rightsPage:${item.reason ?? "unclassified"}`);
    if (item.outcome === "notChecked" && !advisory.includes("rightsNotChecked")) advisory.push("rightsNotChecked");
  }
  // Any status not explained above is surfaced, never silently treated as healthy.
  if (!["healthy", "moved", "contentChanged"].includes(result.status) && !raw.length) raw.push("unclassified");
  const active = review.knownAdvisories.filter(item => today < item.expiresAt);
  const blocking: string[] = [];
  for (const reason of raw) {
    if (active.some(item => covers(item, reason))) advisory.push(`known:${reason}`);
    else { blocking.push(reason); if (review.knownAdvisories.some(item => covers(item, reason)) && !blocking.includes("knownAdvisoryExpired")) blocking.push("knownAdvisoryExpired"); }
  }
  if (s.moved && !s.crossOriginRelocation) advisory.push("moved");
  if (s.contentChanged && s.parserCompatible && s.schemaCompatible) advisory.push(s.packagingChanged ? "packagingChanged" : "contentChanged");
  if (result.pageFactNotChecked) advisory.push("pageFactNotChecked");
  if (review.rights.some(item => today >= item.reviewDueAt)) advisory.push("rightsReviewDue");
  const reviewDue = review.reviewDueAt;
  const humanReviewDue = today >= reviewDue;
  if (humanReviewDue) advisory.push("humanReviewDue");
  if (review.sourceObservedAt === null) advisory.push("observationDateUnknown");
  return { ...result, severity: blocking.length ? "blocking" : advisory.some(item => item !== "observationDateUnknown") ? "advisory" : "ok",
    blocking, advisory,
    review: { rightsReviewedAt: review.rightsReviewedAt, sourceObservedAt: review.sourceObservedAt, observationDateUnknown: review.sourceObservedAt === null,
      editionLabel: review.editionLabel, editionObservedAt: review.editionObservedAt, reviewDueAt: reviewDue, humanReviewDue, reviewerNote: review.reviewerNote } };
}

export function buildReport(results: HealthResult[], reviews: SourceReview[], today: string): HealthReport {
  const evaluated = results.map(result => {
    const review = reviews.find(item => item.sourceId === result.sourceId);
    if (!review) throw new Error("Review metadata missing for a reviewed health source");
    return evaluateResult(result, review, today);
  });
  const ids = (severity: Severity) => evaluated.filter(item => item.severity === severity).map(item => item.sourceId);
  const summary = { blocking: ids("blocking"), advisory: ids("advisory"), ok: ids("ok") };
  return { version: 2, evaluatedOn: today, exitCode: summary.blocking.length ? 1 : 0, summary, results: evaluated };
}

const SIGNAL_NAMES = ["moved", "crossOriginRelocation", "accessBlocked", "resourceMissing", "serverError", "rateLimited", "unexpectedHttpStatus", "mimeUnexpected", "contentChanged", "packagingChanged", "rightsReviewRequired", "rightsChanged", "rightsScopeMissing"] as const;
export function activeSignals(signals: HealthSignals): string[] {
  const active: string[] = SIGNAL_NAMES.filter(name => signals[name]);
  if (signals.transportFailure) active.push(`transport:${signals.transportFailure}${signals.transportCode ? `(${signals.transportCode})` : ""}`);
  if (signals.schemaCompatible !== null) active.push(`schema:${signals.schemaCompatible ? "ok" : "incompatible"}`);
  if (signals.parserCompatible !== null) active.push(`parser:${signals.parserCompatible ? "ok" : "incompatible"}`);
  return active;
}

// URLs come only from the configured targets/contracts, never redirects or response metadata.
export interface SummarySource { sourceId: string; dataUrl: string; rightsUrls: readonly string[] }
const cell = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("|", "&#124;").replaceAll("`", "&#96;").replace(/[\r\n]/g, " ");
function summaryUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "URL omitted";
    url.search = ""; url.hash = "";
    return cell(url.href);
  } catch { return "URL omitted"; }
}
function nextChecks(item: EvaluatedResult): string[] {
  const reasons = [...item.blocking, ...item.advisory];
  const has = (pattern: RegExp) => reasons.some(reason => pattern.test(reason));
  const checks: string[] = [];
  if (has(/rightsChanged|rightsScopeMissing|rightsMetadataMissing/))
    checks.push("規約・参照範囲を公式ページで比較。住所/設備の範囲変更も含むため、法的変更と即断しない。権利承認・baseline更新は人のレビュー後。");
  if (has(/transport:|http:|resourceMissing|AccessBlocked|rateLimited|rightsPage:/))
    checks.push("取得/接続状況を再確認。取得失敗は施設閉鎖ではない。アクセス制限を回避しない。");
  if (has(/parserIncompatible|schemaIncompatible|unexpectedMime|crossOriginRelocation|contentChanged|packagingChanged|^moved$/))
    checks.push("公式本文・形式・移動先を確認しfixtureとの意味差分をレビュー。文言変更だけでfixtureを更新しない。");
  if (has(/humanReviewDue|rightsReviewDue/))
    checks.push("期限対象の出典/権利/版を人が再確認。期限到来は公開失効ではなく、日付だけ延長しない。");
  if (has(/^known:|knownAdvisoryExpired/))
    checks.push("既知advisoryの対象・有効期限をJSONで確認。期限切れを自動延長しない。");
  if (has(/rightsNotChecked|pageFactNotChecked/))
    checks.push("offlineでは公式ページ/規約が未確認。fixture再生成功を現行情報の確認としない。");
  if (!checks.length) checks.push(item.severity === "ok" ? "定期確認を継続。現地稼働の証明ではない。" : "JSONの検知理由と運用手順を確認。未分類を正常扱いしない。");
  return checks;
}

// Presentation only: preserve evaluator decisions, JSON schema/order and the read-only boundary.
export function renderSummary(report: HealthReport, sources: readonly SummarySource[] = []): string {
  const lines = [`## Source health ${cell(report.evaluatedOn)} (JST)`, "",
    `Result: **${report.exitCode ? "BLOCKING" : report.summary.advisory.length ? "ADVISORY ONLY" : "OK"}** — blocking ${report.summary.blocking.length}, advisory ${report.summary.advisory.length}, ok ${report.summary.ok.length}`, "",
    "### 運営者の確認順（公開判断ではありません）", "",
    "既存の重大度順です。緑のrunにも要確認があります。設定済みURLのみ表示し、query/fragmentは省略します。", "",
    "| 優先度 | Source ID | 検知理由 | 対象URL | 確認すること |", "| --- | --- | --- | --- | --- |"];
  const rank = { blocking: 0, advisory: 1, ok: 2 };
  for (const item of [...report.results].sort((a, b) => rank[a.severity] - rank[b.severity] || a.sourceId.localeCompare(b.sourceId))) {
    const context = sources.find(source => source.sourceId === item.sourceId);
    const reasons = [...item.blocking, ...item.advisory];
    const needsRights = reasons.some(reason => /rights|humanReviewDue/.test(reason));
    const urls = context ? [context.dataUrl, ...(needsRights ? context.rightsUrls : [])] : [];
    lines.push(`| ${item.severity === "blocking" ? "1 要確認" : item.severity === "advisory" ? "2 要レビュー" : "3 正常"} | ${cell(item.sourceId)} | ${cell(reasons.join(", ") || "healthy")} | ${[...new Set(urls.map(summaryUrl))].join("<br>") || "設定済みURLはJSON/設定を参照"} | ${nextChecks(item).map(cell).join("<br>")} |`);
  }
  lines.push("", "### 詳細（既存シグナル）", "",
    "| Source | Primary | Severity | Signals | Rights | Reasons | Review due |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of report.results) lines.push(`| ${cell(item.sourceId)} | ${cell(item.status)} | ${item.severity.toUpperCase()} | ${cell(activeSignals(item.signals).join(", "))} | ${cell((item.rights ?? []).map(r => r.outcome).join(", ") || "-")} | ${cell([...item.blocking, ...item.advisory].join(", ") || "-")} | ${cell(item.review.reviewDueAt)}${item.review.humanReviewDue ? " (DUE)" : ""} |`);
  lines.push("", "Advisory only: no source approval, baseline update, ingestion, spot deletion, D1 operation, publication change or deployment occurs.",
    "Content change ≠ bad source; content change ≠ rights change; unavailable ≠ removed; rights page unavailable ≠ rights changed; TLS failure ≠ rights failure; review due ≠ publication revoked.",
    "Rights baselines are updated only by a human editing review-metadata.json after reading the scoped notice.");
  return lines.join("\n") + "\n";
}
