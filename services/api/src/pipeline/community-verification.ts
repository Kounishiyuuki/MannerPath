// communityReported -> communityVerified (ADR-0012, migration 0023).
//
// The one place outside the resolver that writes a canonical spot column from community evidence, and deliberately
// narrow: it changes only a spot's evidence tier columns (evidence_quality, evidence_quality_version,
// community_confirmations, last_reviewed_on) — never a coordinate, name, type, access, hours or lifecycle — and only
// together with the immutable community_evidence_upgrades row the 0023/0025 triggers verify (an applied `exists` effect,
// attested independent submitters over the spot's own evidence, consent). The spots trigger refuses any other change
// to those columns.
// Everything a report says about the place still reaches canonical data only through a resolved release.

import { type Db, isoSeconds } from "../db.ts";
import { CommunityReconciliationError } from "./community-reconciliation.ts";

export const COMMUNITY_VERIFICATION_VERSION = "community-verification.v1";

/**
 * An applied `exists` effect whose reports come from a submitter other than the spot's original reporter corroborates
 * the spot. Independence is judged in REPORTS_DB, where the submitter keys exist, while every key involved still
 * exists, and is attested in the effect's artifact over the spot's own evidence reports (ADR-0014 §11). Here the
 * attestation is bound to this spot: the base report IDs must be exactly the spot's evidence, and the base count the
 * spot's own. The tier, the confirmation count and the review day change together with the immutable upgrade row.
 */
export async function upgradeCommunityEvidence(
  db: Db, effectApplicationId: string, opts: { decidedBy: string; now: Date },
): Promise<{ spotId: string; confirmations: number }> {
  const effect = await db.prepare(
    "SELECT subject_spot_id, report_type, state FROM community_effect_applications WHERE application_id = ?",
  ).bind(effectApplicationId).first<{ subject_spot_id: string; report_type: string; state: string }>();
  if (!effect) throw new CommunityReconciliationError(`community: effect application ${effectApplicationId} does not exist`);
  if (effect.report_type !== "exists" || effect.state !== "applied") {
    throw new CommunityReconciliationError(`community: ${effectApplicationId} is a ${effect.state} ${effect.report_type} effect, not an applied exists confirmation`);
  }
  const spotId = effect.subject_spot_id;
  const spot = await db.prepare("SELECT evidence_quality, community_confirmations FROM spots WHERE spot_id = ? AND merged_into IS NULL AND lifecycle = 'active'")
    .bind(spotId).first<{ evidence_quality: string; community_confirmations: number | null }>();
  if (spot?.evidence_quality !== "communityReported") throw new CommunityReconciliationError(`community: ${spotId} is not a live communityReported spot`);

  const attested = await db.prepare(
    "SELECT base_report_ids, base_independent_submitters, confirmations_after FROM community_artifact_ledger WHERE review_id = ?",
  ).bind(effectApplicationId).first<{ base_report_ids: string | null; base_independent_submitters: number | null; confirmations_after: number | null }>();
  if (!attested || attested.base_report_ids === null || attested.confirmations_after === null) {
    throw new CommunityReconciliationError(`community: ${effectApplicationId} carries no attested independence over ${spotId}'s evidence; it is not independent evidence`);
  }
  const { results } = await db.prepare("SELECT report_id FROM community_spot_evidence_reports WHERE spot_id = ? ORDER BY report_id")
    .bind(spotId).all<{ report_id: string }>();
  const own = results.map((r) => r.report_id);
  const base = JSON.parse(attested.base_report_ids) as string[];
  if (own.length !== base.length || own.some((id, i) => id !== base[i]) || attested.base_independent_submitters !== spot.community_confirmations) {
    throw new CommunityReconciliationError(`community: the confirmation of ${spotId} was attested against other evidence; re-review`);
  }
  const keys = { distinct_all: attested.confirmations_after };
  const now = isoSeconds(opts.now);
  await db.batch([
    db.prepare(
      `INSERT INTO community_evidence_upgrades (spot_id, effect_application_id, upgrade_version, confirmations_after, decided_by, applied_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(spotId, effectApplicationId, COMMUNITY_VERIFICATION_VERSION, keys.distinct_all, opts.decidedBy, now),
    db.prepare(
      `UPDATE spots SET evidence_quality = 'communityVerified', evidence_quality_version = 'evidence-quality.v3',
         community_confirmations = ?, last_reviewed_on = ?, updated_at = ? WHERE spot_id = ?`,
    ).bind(keys.distinct_all, now.slice(0, 10), now, spotId),
  ]);
  return { spotId, confirmations: keys.distinct_all };
}
