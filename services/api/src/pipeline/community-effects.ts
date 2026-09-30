// Existing-spot report effects (Issue #127, migration 0021; NATIONWIDE_DATA_STRATEGY §8, ADR-0007 amendment
// 2026-09-30): the step between an accepted, queued report about a published spot and the existing review/hold
// machinery. A report never mutates canonical data on its own.
//
//   proposeCommunityEffect   a reviewer's immutable decision: these reports, all of one type about one spot, back
//                            the one effect that type allows. Changes nothing canonical.
//   applyCommunityEffect     records the review candidate: the application and its reports move to `applied` in one
//                            batch whose triggers re-check every premise. Still changes nothing canonical.
//   holdCommunityEffect      the ONE public-facing effect: withholds the spot of an applied publicationHoldReview
//                            (`prohibited`) from every published surface. The database refuses it unless the
//                            community rights hold (Issue #124): source approved, terms granted, consent on every
//                            report, two independent submitters, fresh unredacted evidence.
//   liftCommunityHold        a reviewed lift; publishTiles republishes the spot afterwards.
//   withdrawCommunityEffect  terminal; its reports can never back another application.
//
// Every other effect is a review candidate only: a maintainer acts on it with the source-driven machinery that
// already exists (relocation review, ADR-0009; field attenuation, Issue #42) or with a new source release. No
// coordinate, opening hours, access or tobacco field is ever written from a report, and `exists` never touches
// `lastVerifiedAt` (a report date is personal and minimized after 90 days, Issue #124 item 3).

import { type Db, isoSeconds } from "../db.ts";
import { COMMUNITY_SOURCE_ID } from "./community-adapter.ts";
import { commonTermsVersion } from "./community-reconciliation.ts";
import { reviewedSource } from "./registry.ts";

export const COMMUNITY_EFFECT_VERSION = "community-effects.v1";
export const COMMUNITY_HOLD_EXECUTOR_VERSION = "community-hold.v1";
/** A public-facing effect needs corroboration across independent evidence (strategy §8), as a new spot does. */
export const MIN_HOLD_SUBMITTERS = 2;

/**
 * The only effect each existing-spot report type can lead to. `other` has none: it stays a moderation-queue item
 * a human reads, and no application can be made from it. `missing` is the new-spot path (community-reconciliation).
 */
export const COMMUNITY_EFFECTS = {
  moved: "relocationReview",
  prohibited: "publicationHoldReview",
  hoursChanged: "hoursReview",
  accessChanged: "accessReview",
  tobaccoTypeChanged: "tobaccoTypeReview",
  exists: "existenceVerification",
} as const;
export type EffectReportType = keyof typeof COMMUNITY_EFFECTS;
export type CommunityEffect = (typeof COMMUNITY_EFFECTS)[EffectReportType];

/** Whether an applied effect of this kind can change anything public. Only a hold can, and only through holdCommunityEffect. */
export const PUBLIC_FACING_EFFECTS: readonly CommunityEffect[] = ["publicationHoldReview"];

export class CommunityEffectError extends Error {}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newEffectApplicationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `ce_${out}`;
}

export function effectOf(reportType: string): CommunityEffect | null {
  return Object.hasOwn(COMMUNITY_EFFECTS, reportType) ? COMMUNITY_EFFECTS[reportType as EffectReportType] : null;
}

interface PremiseRow {
  report_id: string;
  report_type: string;
  subject_spot_id: string | null;
  submitter_hash: string | null;
  minimize_after: string;
  redacted_at: string | null;
  accepted_terms_version: string | null;
  state: string | null;
  reconciliation_state: string | null;
  effect_application_id: string | null;
  new_spot_application_id: string | null;
}

async function readPremises(db: Db, reportIds: readonly string[]): Promise<PremiseRow[]> {
  const rows: PremiseRow[] = [];
  for (const id of reportIds) {
    const row = await db.prepare(
      `SELECT r.report_id, r.report_type, r.subject_spot_id, r.submitter_hash, r.minimize_after, r.redacted_at,
              r.accepted_terms_version, m.state, m.reconciliation_state,
              e.application_id AS effect_application_id, n.application_id AS new_spot_application_id
       FROM reports r LEFT JOIN report_moderation m ON m.report_id = r.report_id
       LEFT JOIN community_effect_evidence e ON e.report_id = r.report_id
       LEFT JOIN community_reconciliation_evidence n ON n.report_id = r.report_id
       WHERE r.report_id = ?`,
    ).bind(id).first<PremiseRow>();
    if (!row) throw new CommunityEffectError(`community effect: report ${id} does not exist`);
    rows.push(row);
  }
  return rows;
}

/** Messages name report IDs, types and states only, never content or submitter. */
function assertPremises(rows: readonly PremiseRow[], now: string, applicationId: string | null): { spotId: string; reportType: EffectReportType } {
  if (rows.length === 0) throw new CommunityEffectError("community effect: at least one report is required");
  const types = new Set(rows.map((r) => r.report_type));
  const spots = new Set(rows.map((r) => r.subject_spot_id));
  if (types.size !== 1) throw new CommunityEffectError("community effect: every report must be of the same type");
  if (spots.size !== 1) throw new CommunityEffectError("community effect: every report must name the same spot");
  const [reportType] = types;
  const [spotId] = spots;
  if (effectOf(reportType) === null) {
    throw new CommunityEffectError(`community effect: ${reportType} reports have no automatic effect; they are reviewed in the moderation queue only`);
  }
  for (const r of rows) {
    if (r.redacted_at !== null) throw new CommunityEffectError(`community effect: report ${r.report_id} is redacted`);
    if (r.minimize_after <= now) throw new CommunityEffectError(`community effect: report ${r.report_id} is past its minimization deadline`);
    if (r.state !== "accepted") throw new CommunityEffectError(`community effect: report ${r.report_id} is ${r.state}, not accepted`);
    if (r.reconciliation_state !== "queued") throw new CommunityEffectError(`community effect: report ${r.report_id} is ${r.reconciliation_state}, not queued`);
    if (r.new_spot_application_id !== null) throw new CommunityEffectError(`community effect: report ${r.report_id} backs a new-spot application`);
    if (r.effect_application_id !== applicationId) {
      throw new CommunityEffectError(`community effect: report ${r.report_id} already backs application ${r.effect_application_id}`);
    }
  }
  return { spotId: spotId!, reportType: reportType as EffectReportType };
}

export interface ProposeEffectInput {
  reportIds: readonly string[];
  decidedBy: string;
  now: Date;
  newApplicationId?: () => string;
}

export async function proposeCommunityEffect(db: Db, input: ProposeEffectInput): Promise<{ applicationId: string; effect: CommunityEffect }> {
  const reportIds = [...input.reportIds].sort();
  if (new Set(reportIds).size !== reportIds.length) throw new CommunityEffectError("community effect: a report is named twice");
  const now = isoSeconds(input.now);
  const { spotId, reportType } = assertPremises(await readPremises(db, reportIds), now, null);
  const spot = await db.prepare("SELECT spot_id FROM spots WHERE spot_id = ? AND merged_into IS NULL").bind(spotId).first();
  if (!spot) throw new CommunityEffectError(`community effect: ${spotId} is not a live canonical spot`);
  const effect = COMMUNITY_EFFECTS[reportType];
  const applicationId = (input.newApplicationId ?? newEffectApplicationId)();
  await db.batch([
    db.prepare(
      `INSERT INTO community_effect_applications
         (application_id, subject_spot_id, report_type, effect, effect_version, decided_by, decided_at, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')`,
    ).bind(applicationId, spotId, reportType, effect, COMMUNITY_EFFECT_VERSION, input.decidedBy, now),
    ...reportIds.map((id) => db.prepare(
      "INSERT INTO community_effect_evidence (report_id, application_id) VALUES (?, ?)",
    ).bind(id, applicationId)),
  ]);
  return { applicationId, effect };
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

async function linkedReportIds(db: Db, applicationId: string): Promise<string[]> {
  const { results } = await db.prepare(
    "SELECT report_id FROM community_effect_evidence WHERE application_id = ? ORDER BY report_id",
  ).bind(applicationId).all<{ report_id: string }>();
  return results.map((r) => r.report_id);
}

export type ApplyEffectResult =
  | { status: "applied"; effect: CommunityEffect; spotId: string }
  | { status: "alreadyApplied"; effect: CommunityEffect; spotId: string };

/**
 * Records the review candidate. The premises are checked before anything is written, then again by the 0021
 * triggers inside the one batch. Nothing canonical or published changes, for any effect.
 */
export async function applyCommunityEffect(db: Db, applicationId: string, opts: { now: Date }): Promise<ApplyEffectResult> {
  const application = await readApplication(db, applicationId);
  if (application.state === "applied") return { status: "alreadyApplied", effect: application.effect, spotId: application.subject_spot_id };
  if (application.state === "withdrawn") throw new CommunityEffectError(`community effect: application ${applicationId} was withdrawn`);
  const now = isoSeconds(opts.now);
  const reportIds = await linkedReportIds(db, applicationId);
  assertPremises(await readPremises(db, reportIds), now, applicationId);
  await db.batch([
    db.prepare(
      "UPDATE community_effect_applications SET state = 'applied', applied_at = ? WHERE application_id = ? AND state = 'proposed'",
    ).bind(now, applicationId),
    ...reportIds.map((id) => db.prepare(
      "UPDATE report_moderation SET reconciliation_state = 'applied', updated_at = ? WHERE report_id = ?",
    ).bind(now, id)),
  ]);
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
 * Whether a set of reports may be the basis of a public-facing community change right now. It reads the source
 * row and the terms mirror (the publication authority, ADR-0006) AND the reviewed lists in code, so a hand-edited
 * local row alone cannot make a report publishable. `sourceApprovedInCode` exists only so tests can simulate the
 * future approval; no script passes it.
 */
export async function communityRights(
  db: Db, reportIds: readonly string[], opts: { now: Date; minSubmitters: number; sourceApprovedInCode?: boolean },
): Promise<CommunityRights> {
  const now = isoSeconds(opts.now);
  const blockers: RightsBlocker[] = [];
  const source = await db.prepare("SELECT publication_status FROM sources WHERE source_id = ?")
    .bind(COMMUNITY_SOURCE_ID).first<{ publication_status: string }>();
  const approvedInCode = opts.sourceApprovedInCode ?? reviewedSource(COMMUNITY_SOURCE_ID).publicationStatus === "approved";
  if (source?.publication_status !== "approved" || !approvedInCode) blockers.push("sourceNotApproved");

  const rows: { accepted_terms_version: string | null; submitter_hash: string | null; redacted_at: string | null; minimize_after: string }[] = [];
  for (const id of reportIds) {
    const row = await db.prepare("SELECT accepted_terms_version, submitter_hash, redacted_at, minimize_after FROM reports WHERE report_id = ?")
      .bind(id).first<(typeof rows)[number]>();
    if (row) rows.push(row);
  }
  const termsVersion = rows.length === reportIds.length ? commonTermsVersion(rows) : null;
  if (termsVersion === null) {
    blockers.push("noCommonConsent");
  } else {
    const terms = await db.prepare("SELECT publication_rights FROM report_terms_versions WHERE terms_version = ?")
      .bind(termsVersion).first<{ publication_rights: string }>();
    if (terms?.publication_rights !== "granted") blockers.push("termsNotGranted");
  }
  if (rows.some((r) => r.redacted_at !== null || r.minimize_after <= now)) blockers.push("staleOrRedacted");
  const hashes = rows.map((r) => r.submitter_hash).filter((h): h is string => h !== null);
  // Every report from a distinct submitter, as the 0021 hold trigger requires: a repeat is not independent evidence.
  if (rows.length < opts.minSubmitters || new Set(hashes).size !== rows.length) blockers.push("tooFewIndependentSubmitters");
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
  const rights = await communityRights(db, await linkedReportIds(db, applicationId), {
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
  applicationId: string | null;
  spotId: string;
  reportType: string;
  effect: CommunityEffect | null;
  state: "queued" | "proposed" | "applied" | "withdrawn";
  reportCount: number;
  /** Distinct submitters behind the reports still carrying a submitter key. The keys themselves are never returned. */
  independentSubmitters: number;
  redactedOrStale: number;
  rights: CommunityRights;
  hold: "none" | "active" | "lifted";
}

/**
 * The moderation view of existing-spot reports: queued reports grouped by (spot, type) that no application backs
 * yet, and every effect application. Counts and states only; no note, pin, date or submitter key is returned.
 */
export async function listCommunityEffects(db: Db, opts: { now: Date; sourceApprovedInCode?: boolean }): Promise<EffectQueueRow[]> {
  const now = isoSeconds(opts.now);
  const { results } = await db.prepare(
    `SELECT r.report_id, r.report_type, r.subject_spot_id, r.submitter_hash, r.redacted_at, r.minimize_after,
            coalesce(a.application_id, '') AS application_id, coalesce(a.state, 'queued') AS state
     FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
     LEFT JOIN community_effect_evidence e ON e.report_id = r.report_id
     LEFT JOIN community_effect_applications a ON a.application_id = e.application_id
     WHERE r.report_type <> 'missing' AND m.state = 'accepted'
       AND (a.application_id IS NOT NULL OR m.reconciliation_state = 'queued')
     ORDER BY r.subject_spot_id, r.report_type, r.report_id`,
  ).all<{ report_id: string; report_type: string; subject_spot_id: string; submitter_hash: string | null;
    redacted_at: string | null; minimize_after: string; application_id: string; state: EffectQueueRow["state"] }>();
  const groups = new Map<string, typeof results>();
  for (const r of results) {
    const key = `${r.application_id}\n${r.subject_spot_id}\n${r.report_type}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: EffectQueueRow[] = [];
  for (const members of groups.values()) {
    const first = members[0];
    const applicationId = first.application_id === "" ? null : first.application_id;
    const effect = effectOf(first.report_type);
    const hold = applicationId === null ? null : await db.prepare("SELECT lifted_at FROM community_publication_holds WHERE application_id = ?")
      .bind(applicationId).first<{ lifted_at: string | null }>();
    out.push({
      applicationId,
      spotId: first.subject_spot_id,
      reportType: first.report_type,
      effect,
      state: first.state,
      reportCount: members.length,
      independentSubmitters: new Set(members.map((m) => m.submitter_hash).filter((h) => h !== null)).size,
      redactedOrStale: members.filter((m) => m.redacted_at !== null || m.minimize_after <= now).length,
      rights: await communityRights(db, members.map((m) => m.report_id), {
        now: opts.now, minSubmitters: effect !== null && PUBLIC_FACING_EFFECTS.includes(effect) ? MIN_HOLD_SUBMITTERS : 1,
        sourceApprovedInCode: opts.sourceApprovedInCode,
      }),
      hold: hold === null ? "none" : hold.lifted_at === null ? "active" : "lifted",
    });
  }
  return out;
}
