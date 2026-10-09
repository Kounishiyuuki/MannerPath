// Operational triage of advisory health results. Severity only decides workflow colour; it never
// changes registry, publication status, baselines or rights decisions.
import type { HealthResult, HealthSignals } from "./check.ts";

// Human-maintained review metadata, separate from the production registry. Dates are operational
// reminders (JST calendar days), not legal deadlines or rights expiry.
export interface KnownAdvisory {
  kind: "transport" | "accessBlocked"; code?: string; note: string; reviewDueAt: string;
}
export interface SourceReview {
  sourceId: string; rightsReviewedAt: string; rightsEvidence: string; sourceObservedAt: string | null;
  editionLabel: string | null; editionObservedAt: string; reviewDueAt: string; reviewerNote: string;
  knownAdvisories: KnownAdvisory[];
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
export function jstDate(now: Date): string { return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10); }

export function validateReviews(reviews: SourceReview[], sourceIds: string[]): void {
  const ids = reviews.map(review => review.sourceId);
  if (new Set(ids).size !== ids.length || ids.length !== sourceIds.length || sourceIds.some(id => !ids.includes(id)))
    throw new Error("Review metadata must list every reviewed health source exactly once");
  for (const review of reviews) {
    const dates = [review.rightsReviewedAt, review.editionObservedAt, review.reviewDueAt, ...review.knownAdvisories.map(item => item.reviewDueAt)];
    if (review.sourceObservedAt !== null) dates.push(review.sourceObservedAt);
    if (dates.some(date => !DATE.test(date) || Number.isNaN(Date.parse(date)))) throw new Error(`Invalid review date for ${review.sourceId}`);
  }
}

function knownAdvisory(review: SourceReview, signals: HealthSignals): KnownAdvisory | undefined {
  return review.knownAdvisories.find(item => item.kind === "transport"
    ? signals.transportFailure === "tls" && item.code === signals.transportCode
    : item.kind === "accessBlocked" && signals.accessBlocked);
}

export function evaluateResult(result: HealthResult, review: SourceReview, today: string): EvaluatedResult {
  const s = result.signals, blocking: string[] = [], advisory: string[] = [];
  const known = knownAdvisory(review, s);
  if (s.parserCompatible === false) blocking.push("parserIncompatible");
  else if (s.schemaCompatible === false) blocking.push("schemaIncompatible");
  if (s.rightsReviewRequired) blocking.push(s.crossOriginRelocation ? "crossOriginRelocation" : "rightsMetadataMissing");
  if (s.resourceMissing) blocking.push("resourceMissing");
  if (s.mimeUnexpected) blocking.push("unexpectedMime");
  if (s.accessBlocked) (known ? advisory : blocking).push(known ? "knownAccessRestriction" : "unexpectedAccessBlocked");
  if (s.transportFailure) {
    if (known) advisory.push("knownTransportLimitation");
    else if (s.transportFailure === "timeout" || s.transportFailure === "network") advisory.push(`transient:${s.transportFailure}`);
    else blocking.push(`transport:${s.transportFailure}`);
  }
  if (s.serverError) advisory.push("serverError");
  if (result.httpStatus !== null && result.httpStatus >= 400 && !s.accessBlocked && !s.resourceMissing && !s.serverError) blocking.push(`http:${result.httpStatus}`);
  if (s.moved && !s.crossOriginRelocation) advisory.push("moved");
  if (s.contentChanged && s.parserCompatible && s.schemaCompatible) advisory.push(s.packagingChanged ? "packagingChanged" : "contentChanged");
  // Any status not explained above is surfaced, never silently treated as healthy.
  if (result.status === "unknown" && !blocking.length) blocking.push("unclassified");
  const reviewDue = [review.reviewDueAt, ...(known ? [known.reviewDueAt] : [])].sort()[0];
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

const SIGNAL_NAMES = ["moved", "crossOriginRelocation", "accessBlocked", "resourceMissing", "serverError", "mimeUnexpected", "contentChanged", "packagingChanged", "rightsReviewRequired"] as const;
export function activeSignals(signals: HealthSignals): string[] {
  const active: string[] = SIGNAL_NAMES.filter(name => signals[name]);
  if (signals.transportFailure) active.push(`transport:${signals.transportFailure}${signals.transportCode ? `(${signals.transportCode})` : ""}`);
  if (signals.schemaCompatible !== null) active.push(`schema:${signals.schemaCompatible ? "ok" : "incompatible"}`);
  if (signals.parserCompatible !== null) active.push(`parser:${signals.parserCompatible ? "ok" : "incompatible"}`);
  return active;
}

// Markdown for humans and GitHub step summaries. Only symbolic values; no response bodies.
export function renderSummary(report: HealthReport): string {
  const lines = [`## Source health ${report.evaluatedOn} (JST)`, "",
    `Result: **${report.exitCode ? "BLOCKING" : report.summary.advisory.length ? "ADVISORY ONLY" : "OK"}** — blocking ${report.summary.blocking.length}, advisory ${report.summary.advisory.length}, ok ${report.summary.ok.length}`, "",
    "| Source | Primary | Severity | Signals | Reasons | Review due |", "| --- | --- | --- | --- | --- | --- |"];
  for (const item of report.results) lines.push(`| ${item.sourceId} | ${item.status} | ${item.severity.toUpperCase()} | ${activeSignals(item.signals).join(", ")} | ${[...item.blocking, ...item.advisory].join(", ") || "-"} | ${item.review.reviewDueAt}${item.review.humanReviewDue ? " (DUE)" : ""} |`);
  lines.push("", "Advisory only: no source approval, baseline update, ingestion, spot deletion, D1 operation, publication change or deployment occurs.",
    "Content change ≠ bad source; unavailable ≠ removed; TLS failure ≠ rights failure; review due ≠ publication revoked.");
  return lines.join("\n") + "\n";
}
