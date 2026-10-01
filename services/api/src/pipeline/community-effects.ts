// Existing-spot report effects (Issue #127, migrations 0021, 0025; NATIONWIDE_DATA_STRATEGY §8, ADR-0007 amendment
// 2026-09-30, ADR-0014): the step between a reviewed decision about a published spot and the existing review/hold
// machinery. A report never mutates canonical data on its own.
//
// The decision is made in the durable REPORTS_DB (src/reports/review.ts proposeEffectReview) and arrives here only as a
// sanitized artifact, imported as a proposed application (src/pipeline/community-artifact.ts). Here:
//
//   applyCommunityEffect     records the review candidate: the application moves to `applied` in one batch whose
//                            triggers re-check every premise against the imported evidence. Changes nothing canonical.
//   holdCommunityEffect      the ONE public-facing effect: withholds the spot of an applied publicationHoldReview
//                            (`prohibited`) from every published surface. The database refuses it unless the
//                            community rights hold (Issue #124): source approved, terms granted, consent on every
//                            report, two attested independent submitters, fresh evidence.
//   liftCommunityHold        a reviewed lift; publishTiles republishes the spot afterwards.
//   withdrawCommunityEffect  terminal; its evidence can never back another application.
//
// Every other effect is a review candidate only: a maintainer acts on it with the source-driven machinery that
// already exists (relocation review, ADR-0009; field attenuation, Issue #42) or with a new source release. No
// coordinate, opening hours, access or tobacco field is ever written from a report, and `exists` never touches
// `lastVerifiedAt` (a report date is personal and minimized after 90 days, Issue #124 item 3).

import { type Db, isoSeconds } from "../db.ts";
import { COMMUNITY_SOURCE_ID } from "./community-adapter.ts";
import { attestedIndependence, commonTermsVersion, usable } from "./community-reconciliation.ts";
import { COMMUNITY_EFFECTS, type EffectReportType } from "../reports/review.ts";
import { reviewedSource } from "./registry.ts";

export const COMMUNITY_EFFECT_VERSION = "community-effects.v1";
export const COMMUNITY_HOLD_EXECUTOR_VERSION = "community-hold.v1";
/** A public-facing effect needs corroboration across independent evidence (strategy §8), as a new spot does. */
export const MIN_HOLD_SUBMITTERS = 2;

export { COMMUNITY_EFFECTS, type EffectReportType };
export type CommunityEffect = (typeof COMMUNITY_EFFECTS)[EffectReportType];

/** Whether an applied effect of this kind can change anything public. Only a hold can, and only through holdCommunityEffect. */
export const PUBLIC_FACING_EFFECTS: readonly CommunityEffect[] = ["publicationHoldReview"];

export class CommunityEffectError extends Error {}

export function effectOf(reportType: string): CommunityEffect | null {
  return Object.hasOwn(COMMUNITY_EFFECTS, reportType) ? COMMUNITY_EFFECTS[reportType as EffectReportType] : null;
}

interface ApplicationRow {
  application_id: string;
  subject_spot_id: string;
  report_type: EffectReportType;
  effect: CommunityEffect;
  state: "proposed" | "applied" | "withdrawn";
}

async function readApplication(db: Db, applicationId: string): Promise<ApplicationRow> {
  const row = await db.prepare(
    "SELECT application_id, subject_spot_id, report_type, effect, state FROM community_effect_applications WHERE application_id = ?",
  ).bind(applicationId).first<ApplicationRow>();
  if (!row) throw new CommunityEffectError(`community effect: application ${applicationId} does not exist`);
  return row;
}

interface EvidenceRow {
  report_id: string;
  report_type: string;
  subject_spot_id: string | null;
  accepted_terms_version: string | null;
  usable_until: string;
}

/** The sanitized evidence an imported application links to (migration 0025). */
export async function linkedEvidence(db: Db, evidenceTable: string, applicationId: string): Promise<EvidenceRow[]> {
  const { results } = await db.prepare(
    `SELECT r.report_id, r.report_type, r.subject_spot_id, r.accepted_terms_version, r.usable_until
     FROM ${evidenceTable} e JOIN community_evidence_reports r ON r.report_id = e.report_id
     WHERE e.application_id = ? ORDER BY r.report_id`,
  ).bind(applicationId).all<EvidenceRow>();
  return results;
}

/** Messages name report IDs, types and states only. */
function assertPremises(rows: readonly EvidenceRow[], application: ApplicationRow, now: string): void {
  if (rows.length === 0) throw new CommunityEffectError("community effect: at least one report is required");
  for (const r of rows) {
    if (r.report_type !== application.report_type || r.subject_spot_id !== application.subject_spot_id) {
      throw new CommunityEffectError(`community effect: report ${r.report_id} is not a ${application.report_type} report about ${application.subject_spot_id}`);
    }
    if (!usable(r, now)) throw new CommunityEffectError(`community effect: report ${r.report_id} is past its minimization deadline`);
  }
}

export type ApplyEffectResult =
  | { status: "applied"; effect: CommunityEffect; spotId: string }
  | { status: "alreadyApplied"; effect: CommunityEffect; spotId: string };

/**
 * Records the review candidate. The premises are checked before anything is written, then again by the 0021/0025
 * triggers inside the statement. Nothing canonical or published changes, for any effect.
 */
export async function applyCommunityEffect(db: Db, applicationId: string, opts: { now: Date }): Promise<ApplyEffectResult> {
  const application = await readApplication(db, applicationId);
  if (application.state === "applied") return { status: "alreadyApplied", effect: application.effect, spotId: application.subject_spot_id };
  if (application.state === "withdrawn") throw new CommunityEffectError(`community effect: application ${applicationId} was withdrawn`);
  const now = isoSeconds(opts.now);
  assertPremises(await linkedEvidence(db, "community_effect_evidence", applicationId), application, now);
  await db.prepare(
    "UPDATE community_effect_applications SET state = 'applied', applied_at = ? WHERE application_id = ? AND state = 'proposed'",
  ).bind(now, applicationId).run();
  return { status: "applied", effect: application.effect, spotId: application.subject_spot_id };
}

export async function withdrawCommunityEffect(db: Db, applicationId: string, opts: { now: Date }): Promise<void> {
  const application = await readApplication(db, applicationId);
  if (application.state !== "proposed") {
    throw new CommunityEffectError(`community effect: application ${applicationId} is ${application.state}; only a proposed one can be withdrawn`);
  }
  await db.prepare(
    "UPDATE community_effect_applications SET state = 'withdrawn', withdrawn_at = ? WHERE application_id = ?",
  ).bind(isoSeconds(opts.now), applicationId).run();
}

export type RightsBlocker =
  | "sourceNotApproved" | "termsNotGranted" | "noCommonConsent" | "tooFewIndependentSubmitters" | "staleOrRedacted";

export interface CommunityRights {
  eligible: boolean;
  termsVersion: string | null;
  blockers: RightsBlocker[];
}

/**
 * Whether an imported application's evidence may be the basis of a public-facing community change right now. It
 * reads the source row and the terms mirror (the publication authority, ADR-0006) AND the reviewed lists in code, so
 * a hand-edited local row alone cannot make a report publishable; independence is the attested count from the
 * application's artifact (REPORTS_DB judged it; no submitter key exists here). `sourceApprovedInCode` exists only so
 * tests can simulate the future approval; no script passes it.
 */
export async function communityRights(
  db: Db, evidenceTable: string, applicationId: string, opts: { now: Date; minSubmitters: number; sourceApprovedInCode?: boolean },
): Promise<CommunityRights> {
  const now = isoSeconds(opts.now);
  const blockers: RightsBlocker[] = [];
  const source = await db.prepare("SELECT publication_status FROM sources WHERE source_id = ?")
    .bind(COMMUNITY_SOURCE_ID).first<{ publication_status: string }>();
  const approvedInCode = opts.sourceApprovedInCode ?? reviewedSource(COMMUNITY_SOURCE_ID).publicationStatus === "approved";
  if (source?.publication_status !== "approved" || !approvedInCode) blockers.push("sourceNotApproved");

  const rows = await linkedEvidence(db, evidenceTable, applicationId);
  const termsVersion = rows.length > 0 ? commonTermsVersion(rows) : null;
  if (termsVersion === null) {
    blockers.push("noCommonConsent");
  } else {
    const terms = await db.prepare("SELECT publication_rights FROM report_terms_versions WHERE terms_version = ?")
      .bind(termsVersion).first<{ publication_rights: string }>();
    if (terms?.publication_rights !== "granted") blockers.push("termsNotGranted");
  }
  if (rows.some((r) => !usable(r, now))) blockers.push("staleOrRedacted");
  const attested = await attestedIndependence(db, applicationId);
  // Every report from a distinct submitter, as the hold triggers require: a repeat is not independent evidence.
  if (rows.length < opts.minSubmitters || attested.submitters !== rows.length || attested.evidence !== rows.length) {
    blockers.push("tooFewIndependentSubmitters");
  }
  return { eligible: blockers.length === 0, termsVersion, blockers };
}

export type HoldResult =
  | { status: "held"; spotId: string; tileId: string; termsVersion: string }
  | { status: "alreadyHeld"; spotId: string }
  | { status: "blocked"; spotId: string; blockers: RightsBlocker[] };

/**
 * Withholds the spot of an applied publicationHoldReview. Fail-closed: without community rights it writes nothing
 * and says why. Otherwise one batch unpublishes the spot and inserts the hold row, whose triggers re-check the
 * application, the unpublication, the evidence and the rights inside the statement. Run publishTiles afterwards.
 */
export async function holdCommunityEffect(
  db: Db, applicationId: string, opts: { now: Date; sourceApprovedInCode?: boolean },
): Promise<HoldResult> {
  const application = await readApplication(db, applicationId);
  if (application.state !== "applied" || application.effect !== "publicationHoldReview") {
    throw new CommunityEffectError(`community effect: application ${applicationId} is not an applied publicationHoldReview`);
  }
  const spotId = application.subject_spot_id;
  const existing = await db.prepare("SELECT lifted_at FROM community_publication_holds WHERE application_id = ?")
    .bind(applicationId).first<{ lifted_at: string | null }>();
  if (existing) {
    if (existing.lifted_at === null) return { status: "alreadyHeld", spotId };
    throw new CommunityEffectError(`community effect: application ${applicationId}'s hold was lifted; a lifted hold is not re-applied`);
  }
  const rights = await communityRights(db, "community_effect_evidence", applicationId, {
    now: opts.now, minSubmitters: MIN_HOLD_SUBMITTERS, sourceApprovedInCode: opts.sourceApprovedInCode,
  });
  if (!rights.eligible) return { status: "blocked", spotId, blockers: rights.blockers };
  const spot = await db.prepare("SELECT tile_id FROM spots WHERE spot_id = ?").bind(spotId).first<{ tile_id: string }>();
  if (!spot) throw new CommunityEffectError(`community effect: spot ${spotId} does not exist`);

  const now = isoSeconds(opts.now);
  await db.batch([
    db.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").bind(spotId),
    db.prepare(
      `INSERT INTO community_publication_holds (application_id, spot_id, executor_version, terms_version, held_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(applicationId, spotId, COMMUNITY_HOLD_EXECUTOR_VERSION, rights.termsVersion, now),
  ]);
  return { status: "held", spotId, tileId: spot.tile_id, termsVersion: rights.termsVersion! };
}

export async function liftCommunityHold(db: Db, applicationId: string, opts: { liftedBy: string; now: Date }): Promise<void> {
  const active = await db.prepare("SELECT 1 AS n FROM community_publication_holds WHERE application_id = ? AND lifted_at IS NULL")
    .bind(applicationId).first();
  if (!active) throw new CommunityEffectError(`community effect: application ${applicationId} has no active hold`);
  await db.prepare(
    "UPDATE community_publication_holds SET lifted_at = ?, lifted_by = ? WHERE application_id = ? AND lifted_at IS NULL",
  ).bind(isoSeconds(opts.now), opts.liftedBy, applicationId).run();
}

export interface EffectQueueRow {
  applicationId: string;
  spotId: string;
  reportType: string;
  effect: CommunityEffect | null;
  state: "proposed" | "applied" | "withdrawn";
  reportCount: number;
  /** The attested count of distinct submitters behind the evidence (judged in REPORTS_DB). */
  independentSubmitters: number;
  redactedOrStale: number;
  rights: CommunityRights;
  hold: "none" | "active" | "lifted";
}

/**
 * The canonical view of imported existing-spot effect applications. Counts and states only; no pin, date or
 * submitter key exists here. Queued reports that no review backs yet are a REPORTS_DB view (src/reports/review.ts).
 */
export async function listCommunityEffects(db: Db, opts: { now: Date; sourceApprovedInCode?: boolean }): Promise<EffectQueueRow[]> {
  const now = isoSeconds(opts.now);
  const { results } = await db.prepare(
    `SELECT application_id, subject_spot_id, report_type, state FROM community_effect_applications ORDER BY subject_spot_id, report_type, application_id`,
  ).all<{ application_id: string; subject_spot_id: string; report_type: string; state: EffectQueueRow["state"] }>();
  const out: EffectQueueRow[] = [];
  for (const a of results) {
    const effect = effectOf(a.report_type);
    const evidence = await linkedEvidence(db, "community_effect_evidence", a.application_id);
    const hold = await db.prepare("SELECT lifted_at FROM community_publication_holds WHERE application_id = ?")
      .bind(a.application_id).first<{ lifted_at: string | null }>();
    out.push({
      applicationId: a.application_id,
      spotId: a.subject_spot_id,
      reportType: a.report_type,
      effect,
      state: a.state,
      reportCount: evidence.length,
      independentSubmitters: (await attestedIndependence(db, a.application_id)).submitters,
      redactedOrStale: evidence.filter((r) => !usable(r, now)).length,
      rights: await communityRights(db, "community_effect_evidence", a.application_id, {
        now: opts.now, minSubmitters: effect !== null && PUBLIC_FACING_EFFECTS.includes(effect) ? MIN_HOLD_SUBMITTERS : 1,
        sourceApprovedInCode: opts.sourceApprovedInCode,
      }),
      hold: hold === null ? "none" : hold.lifted_at === null ? "active" : "lifted",
    });
  }
  return out;
}
