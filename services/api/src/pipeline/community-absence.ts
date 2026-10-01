// Negative community evidence (ADR-0013, migration 0024): "I could not find it" / "it has been removed" about a
// published spot. One negative report never removes anything, and stale is never removed (ADR-0012 decision 4):
//
//   normal ── accepted notFound/removed report ──▶ needsRecheck        (a review/recheck signal only)
//          ── ≥ 2 independent negatives, none older than the latest positive ──▶ reviewCandidate
//          ── reviewer proposes + applies an absence review ──▶ (still nothing public)
//          ── holdCommunityAbsence, refused unless community rights hold (#124) ──▶ unpublished
//
//   (REPORTS_DB)              a reviewer's immutable decision over accepted, queued negative reports about one spot
//                             (src/reports/review.ts proposeAbsenceReview), exported as a sanitized artifact and
//                             imported here as a proposed application (ADR-0014).
//   applyCommunityAbsence     records the review candidate. Nothing canonical changes.
//   holdCommunityAbsence      the ONE public-facing step: unpublish the spot. The database refuses it unless two
//                             independent submitters, fresh unredacted evidence and the community rights all hold.
//   liftCommunityAbsence      a reviewed lift (e.g. a later confirmation that it is still there).
//
// Official closure evidence is stronger than any number of reports, and already has its own path: a source release
// that drops the record goes through removal review (ADR-0006/0009). This module never touches a source release.

import { type Db, isoSeconds } from "../db.ts";
import { CommunityEffectError, MIN_HOLD_SUBMITTERS, type RightsBlocker, communityRights, linkedEvidence } from "./community-effects.ts";
import { usable } from "./community-reconciliation.ts";
import { NEGATIVE_FINDINGS } from "../reports/review.ts";

export const COMMUNITY_ABSENCE_VERSION = "community-absence.v1";
export const COMMUNITY_ABSENCE_HOLD_VERSION = "community-absence-hold.v1";
export { NEGATIVE_FINDINGS };

async function readApplication(db: Db, applicationId: string) {
  const row = await db.prepare(
    "SELECT application_id, subject_spot_id, state FROM community_absence_applications WHERE application_id = ?",
  ).bind(applicationId).first<{ application_id: string; subject_spot_id: string; state: "proposed" | "applied" | "withdrawn" }>();
  if (!row) throw new CommunityEffectError(`community absence: application ${applicationId} does not exist`);
  return row;
}


/** Records the review candidate. Nothing canonical or published changes. */
export async function applyCommunityAbsence(db: Db, applicationId: string, opts: { now: Date }): Promise<{ status: "applied" | "alreadyApplied"; spotId: string }> {
  const application = await readApplication(db, applicationId);
  if (application.state === "applied") return { status: "alreadyApplied", spotId: application.subject_spot_id };
  if (application.state === "withdrawn") throw new CommunityEffectError(`community absence: application ${applicationId} was withdrawn`);
  const now = isoSeconds(opts.now);
  const evidence = await linkedEvidence(db, "community_absence_evidence", applicationId);
  if (evidence.length === 0) throw new CommunityEffectError("community absence: at least one report is required");
  for (const r of evidence) {
    if (r.report_type !== "other" || r.subject_spot_id !== application.subject_spot_id) {
      throw new CommunityEffectError(`community absence: report ${r.report_id} is not a notFound/removed finding about ${application.subject_spot_id}`);
    }
    if (!usable(r, now)) throw new CommunityEffectError(`community absence: report ${r.report_id} is past its minimization deadline`);
  }
  await db.prepare(
    "UPDATE community_absence_applications SET state = 'applied', applied_at = ? WHERE application_id = ? AND state = 'proposed'",
  ).bind(now, applicationId).run();
  return { status: "applied", spotId: application.subject_spot_id };
}

export async function withdrawCommunityAbsence(db: Db, applicationId: string, opts: { now: Date }): Promise<void> {
  const application = await readApplication(db, applicationId);
  if (application.state !== "proposed") {
    throw new CommunityEffectError(`community absence: application ${applicationId} is ${application.state}; only a proposed one can be withdrawn`);
  }
  await db.prepare("UPDATE community_absence_applications SET state = 'withdrawn', withdrawn_at = ? WHERE application_id = ?")
    .bind(isoSeconds(opts.now), applicationId).run();
}

export type AbsenceHoldResult =
  | { status: "held"; spotId: string; tileId: string; termsVersion: string }
  | { status: "alreadyHeld"; spotId: string }
  | { status: "blocked"; spotId: string; blockers: RightsBlocker[] };

/**
 * Unpublishes the spot of an applied absence review. Fail-closed: without community rights (Issue #124) or two
 * independent fresh submitters it writes nothing and says why. Run publishTiles afterwards.
 */
export async function holdCommunityAbsence(
  db: Db, applicationId: string, opts: { now: Date; sourceApprovedInCode?: boolean },
): Promise<AbsenceHoldResult> {
  const application = await readApplication(db, applicationId);
  if (application.state !== "applied") throw new CommunityEffectError(`community absence: application ${applicationId} is not applied`);
  const spotId = application.subject_spot_id;
  const existing = await db.prepare("SELECT lifted_at FROM community_absence_holds WHERE application_id = ?")
    .bind(applicationId).first<{ lifted_at: string | null }>();
  if (existing) {
    if (existing.lifted_at === null) return { status: "alreadyHeld", spotId };
    throw new CommunityEffectError(`community absence: application ${applicationId}'s hold was lifted; a lifted hold is not re-applied`);
  }
  const rights = await communityRights(db, "community_absence_evidence", applicationId, {
    now: opts.now, minSubmitters: MIN_HOLD_SUBMITTERS, sourceApprovedInCode: opts.sourceApprovedInCode,
  });
  if (!rights.eligible) return { status: "blocked", spotId, blockers: rights.blockers };
  const spot = await db.prepare("SELECT tile_id FROM spots WHERE spot_id = ?").bind(spotId).first<{ tile_id: string }>();
  if (!spot) throw new CommunityEffectError(`community absence: spot ${spotId} does not exist`);
  const now = isoSeconds(opts.now);
  await db.batch([
    db.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").bind(spotId),
    db.prepare(
      `INSERT INTO community_absence_holds (application_id, spot_id, executor_version, terms_version, held_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(applicationId, spotId, COMMUNITY_ABSENCE_HOLD_VERSION, rights.termsVersion, now),
  ]);
  return { status: "held", spotId, tileId: spot.tile_id, termsVersion: rights.termsVersion! };
}

export async function liftCommunityAbsence(db: Db, applicationId: string, opts: { liftedBy: string; now: Date }): Promise<void> {
  const active = await db.prepare("SELECT 1 AS n FROM community_absence_holds WHERE application_id = ? AND lifted_at IS NULL")
    .bind(applicationId).first();
  if (!active) throw new CommunityEffectError(`community absence: application ${applicationId} has no active hold`);
  await db.prepare("UPDATE community_absence_holds SET lifted_at = ?, lifted_by = ? WHERE application_id = ? AND lifted_at IS NULL")
    .bind(isoSeconds(opts.now), opts.liftedBy, applicationId).run();
}
