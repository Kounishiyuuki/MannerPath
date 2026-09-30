// communityReported -> communityVerified (ADR-0012, migration 0023).
//
// The one place outside the resolver that writes a canonical spot column from community evidence, and deliberately
// narrow: it changes only a spot's evidence tier columns (evidence_quality, evidence_quality_version,
// community_confirmations, last_reviewed_on) — never a coordinate, name, type, access, hours or lifecycle — and only
// together with the immutable community_evidence_upgrades row the 0023 triggers verify (an applied `exists` effect,
// independent submitters, consent, unredacted evidence). The spots trigger refuses any other change to those columns.
// Everything a report says about the place still reaches canonical data only through a resolved release.

import { type Db, isoSeconds } from "../db.ts";
import { CommunityReconciliationError } from "./community-reconciliation.ts";

export const COMMUNITY_VERIFICATION_VERSION = "community-verification.v1";

/**
 * An applied `exists` effect whose reports come
 * from a submitter other than the spot's original reporter corroborates the spot. Independence is compared while
 * every key involved still exists (a redacted report can no longer prove it); the keys are compared and counted in
 * SQL and never leave the database. The tier, the confirmation count and the review day change together with the
 * immutable upgrade row, in one batch; the next publish republishes the spot's tile.
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
  const spot = await db.prepare("SELECT evidence_quality FROM spots WHERE spot_id = ? AND merged_into IS NULL AND lifecycle = 'active'")
    .bind(spotId).first<{ evidence_quality: string }>();
  if (spot?.evidence_quality !== "communityReported") throw new CommunityReconciliationError(`community: ${spotId} is not a live communityReported spot`);

  const keys = await db.prepare(
    `SELECT count(*) AS reports, count(r.submitter_hash) AS present, count(DISTINCT r.submitter_hash) AS distinct_all,
            (SELECT count(DISTINCT r2.submitter_hash) FROM community_spot_evidence_reports x JOIN reports r2 ON r2.report_id = x.report_id
             WHERE x.spot_id = ?) AS distinct_original
     FROM (SELECT report_id FROM community_spot_evidence_reports WHERE spot_id = ?
           UNION SELECT report_id FROM community_effect_evidence WHERE application_id = ?) ids
     JOIN reports r ON r.report_id = ids.report_id`,
  ).bind(spotId, spotId, effectApplicationId).first<{ reports: number; present: number; distinct_all: number; distinct_original: number }>();
  if (!keys || keys.present !== keys.reports) {
    throw new CommunityReconciliationError(`community: a report behind ${spotId} is redacted; independence can no longer be shown`);
  }
  if (keys.distinct_all <= keys.distinct_original) {
    throw new CommunityReconciliationError(`community: the confirmation of ${spotId} comes from the original submitter; it is not independent evidence`);
  }
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
