// ADR-0018 §5: the reviewed source-evidence hold (migration 0033). Source health stays advisory and never writes data;
// a maintainer reads its report and, only when the report shows that a factReference page lost the reviewed fact range
// (or the page itself is gone), records a hold here. The spot leaves publication fail closed; a later explicit clear
// brings it back. contentChanged is never a hold reason: a reworded page is re-reviewed, not withdrawn.
import { type Db, isoSeconds } from "../db.ts";
import type { HealthReport } from "../source-health/evaluate.ts";
import type { ReviewedSource } from "./registry.ts";

export const SOURCE_EVIDENCE_HOLD_EXECUTOR_VERSION = "source-evidence-hold.v1";
export type EvidenceHoldSignal = "pageFactScopeMissing" | "resourceMissing";
export type EvidenceHoldClearBasis = "factsReReviewed" | "healthFalsePositive";

export class EvidenceHoldError extends Error {}

export interface EvidenceHoldResult {
  sourceId: string;
  signal: EvidenceHoldSignal;
  held: string[];
  alreadyHeld: string[];
}

/** The hold signal the report shows for this source, or why it shows none. Pure; reads only the report. */
export function evidenceHoldSignal(report: HealthReport, sourceId: string): EvidenceHoldSignal {
  const results = report.results.filter((r) => r.sourceId === sourceId);
  if (results.length !== 1) throw new EvidenceHoldError(`evidence hold: the report has ${results.length} results for ${sourceId}, not 1`);
  const [result] = results;
  if (result.pageFactNotChecked) throw new EvidenceHoldError(`evidence hold: ${sourceId}'s page was not checked (offline report); run a live check`);
  if (result.severity !== "blocking") {
    throw new EvidenceHoldError(`evidence hold: ${sourceId} is ${result.severity} (${result.status}), not blocking; a changed page is re-reviewed, never held`);
  }
  if (result.pageFactScopeMissing) return "pageFactScopeMissing";
  if (result.signals.resourceMissing) return "resourceMissing";
  throw new EvidenceHoldError(`evidence hold: ${sourceId} is blocking (${result.status}) but shows neither a missing fact range nor a missing page`);
}

/**
 * Holds every active, unmerged spot whose existence evidence comes from `source`. One batch per spot unpublishes it
 * and inserts the hold row, whose trigger re-checks the premises inside the statement. Run publishTiles afterwards so
 * the tile bodies drop the spot too.
 */
export async function holdSourceEvidence(
  db: Db, source: ReviewedSource, report: HealthReport,
  opts: { reportSha256: string; heldBy: string; now: Date },
): Promise<EvidenceHoldResult> {
  if (source.rightsBasis?.kind !== "factReference") {
    throw new EvidenceHoldError(`evidence hold: ${source.sourceId} is not a factReference source; a dataset source withdraws by release`);
  }
  if (!/^[0-9a-f]{64}$/.test(opts.reportSha256)) throw new EvidenceHoldError("evidence hold: the report SHA-256 is not 64 lowercase hex digits");
  const signal = evidenceHoldSignal(report, source.sourceId);
  const { results } = await db.prepare(
    `SELECT DISTINCT s.spot_id FROM spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ? AND s.lifecycle = 'active' AND s.merged_into IS NULL ORDER BY s.spot_id`,
  ).bind(source.sourceId).all<{ spot_id: string }>();
  if (results.length === 0) throw new EvidenceHoldError(`evidence hold: ${source.sourceId} has no active spot`);

  const now = isoSeconds(opts.now);
  const out: EvidenceHoldResult = { sourceId: source.sourceId, signal, held: [], alreadyHeld: [] };
  for (const { spot_id: spotId } of results) {
    const active = await db.prepare("SELECT 1 AS n FROM spot_evidence_holds WHERE spot_id = ? AND cleared_at IS NULL").bind(spotId).first();
    if (active) { out.alreadyHeld.push(spotId); continue; }
    await db.batch([
      db.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").bind(spotId),
      db.prepare(
        `INSERT INTO spot_evidence_holds (source_id, spot_id, reason, health_signal, health_report_sha256, health_evaluated_on,
           executor_version, held_by, held_at) VALUES (?, ?, 'sourceEvidenceMissing', ?, ?, ?, ?, ?, ?)`,
      ).bind(source.sourceId, spotId, signal, opts.reportSha256, report.evaluatedOn, SOURCE_EVIDENCE_HOLD_EXECUTOR_VERSION, opts.heldBy, now),
    ]);
    out.held.push(spotId);
  }
  return out;
}

/** Clears every active hold of `sourceId` as one reviewed action. Republish afterwards to show the spots again. */
export async function clearSourceEvidenceHolds(
  db: Db, sourceId: string, opts: { clearedBy: string; basis: EvidenceHoldClearBasis; now: Date },
): Promise<string[]> {
  const { results } = await db.prepare("SELECT spot_id FROM spot_evidence_holds WHERE source_id = ? AND cleared_at IS NULL ORDER BY spot_id")
    .bind(sourceId).all<{ spot_id: string }>();
  if (results.length === 0) throw new EvidenceHoldError(`evidence hold: ${sourceId} has no active hold`);
  await db.prepare("UPDATE spot_evidence_holds SET cleared_at = ?, cleared_by = ?, clear_basis = ? WHERE source_id = ? AND cleared_at IS NULL")
    .bind(isoSeconds(opts.now), opts.clearedBy, opts.basis, sourceId).run();
  return results.map((r) => r.spot_id);
}
