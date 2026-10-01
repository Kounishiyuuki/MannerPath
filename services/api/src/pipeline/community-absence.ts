// Negative community evidence (ADR-0013, migration 0024): "I could not find it" / "it has been removed" about a
// published spot. One negative report never removes anything, and stale is never removed (ADR-0012 decision 4):
//
//   normal ── accepted notFound/removed report ──▶ needsRecheck        (a review/recheck signal only)
//          ── ≥ 2 independent negatives, none older than the latest positive ──▶ reviewCandidate
//          ── reviewer proposes + applies an absence review ──▶ (still nothing public)
//          ── holdCommunityAbsence, refused unless community rights hold (#124) ──▶ unpublished
//
//   proposeCommunityAbsence   a reviewer's immutable decision: these accepted, queued negative reports about one spot.
//   applyCommunityAbsence     records the review candidate; the reports move to `applied`. Nothing canonical changes.
//   holdCommunityAbsence      the ONE public-facing step: unpublish the spot. The database refuses it unless two
//                             independent submitters, fresh unredacted evidence and the community rights all hold.
//   liftCommunityAbsence      a reviewed lift (e.g. a later confirmation that it is still there).
//
// Official closure evidence is stronger than any number of reports, and already has its own path: a source release
// that drops the record goes through removal review (ADR-0006/0009). This module never touches a source release.

import { type Db, isoSeconds } from "../db.ts";
import { CommunityEffectError, MIN_HOLD_SUBMITTERS, type RightsBlocker, communityRights } from "./community-effects.ts";

export const COMMUNITY_ABSENCE_VERSION = "community-absence.v1";
export const COMMUNITY_ABSENCE_HOLD_VERSION = "community-absence-hold.v1";
export const NEGATIVE_FINDINGS = ["notFound", "removed"] as const;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newAbsenceApplicationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `cn_${out}`;
}

interface PremiseRow {
  report_id: string;
  report_type: string;
  finding: string | null;
  subject_spot_id: string | null;
  redacted_at: string | null;
  minimize_after: string;
  state: string | null;
  reconciliation_state: string | null;
  absence_application_id: string | null;
}

async function readPremises(db: Db, reportIds: readonly string[]): Promise<PremiseRow[]> {
  const rows: PremiseRow[] = [];
  for (const id of reportIds) {
    const row = await db.prepare(
      `SELECT r.report_id, r.report_type, r.finding, r.subject_spot_id, r.redacted_at, r.minimize_after,
              m.state, m.reconciliation_state, e.application_id AS absence_application_id
       FROM reports r LEFT JOIN report_moderation m ON m.report_id = r.report_id
       LEFT JOIN community_absence_evidence e ON e.report_id = r.report_id
       WHERE r.report_id = ?`,
    ).bind(id).first<PremiseRow>();
    if (!row) throw new CommunityEffectError(`community absence: report ${id} does not exist`);
    rows.push(row);
  }
  return rows;
}

/** Messages name report IDs, findings and states only, never content or submitter. */
function assertPremises(rows: readonly PremiseRow[], now: string, applicationId: string | null): string {
  if (rows.length === 0) throw new CommunityEffectError("community absence: at least one report is required");
  const spots = new Set(rows.map((r) => r.subject_spot_id));
  if (spots.size !== 1) throw new CommunityEffectError("community absence: every report must name the same spot");
  for (const r of rows) {
    if (r.report_type !== "other" || !NEGATIVE_FINDINGS.includes(r.finding as (typeof NEGATIVE_FINDINGS)[number])) {
      throw new CommunityEffectError(`community absence: report ${r.report_id} is not a notFound/removed finding`);
    }
    if (r.redacted_at !== null) throw new CommunityEffectError(`community absence: report ${r.report_id} is redacted`);
    if (r.minimize_after <= now) throw new CommunityEffectError(`community absence: report ${r.report_id} is past its minimization deadline`);
    if (r.state !== "accepted") throw new CommunityEffectError(`community absence: report ${r.report_id} is ${r.state}, not accepted`);
    if (r.reconciliation_state !== "queued") throw new CommunityEffectError(`community absence: report ${r.report_id} is ${r.reconciliation_state}, not queued`);
    if (r.absence_application_id !== applicationId) {
      throw new CommunityEffectError(`community absence: report ${r.report_id} already backs application ${r.absence_application_id}`);
    }
  }
  return [...spots][0]!;
}

export async function proposeCommunityAbsence(
  db: Db, input: { reportIds: readonly string[]; decidedBy: string; now: Date; newApplicationId?: () => string },
): Promise<string> {
  const reportIds = [...input.reportIds].sort();
  if (new Set(reportIds).size !== reportIds.length) throw new CommunityEffectError("community absence: a report is named twice");
  const now = isoSeconds(input.now);
  const spotId = assertPremises(await readPremises(db, reportIds), now, null);
  const spot = await db.prepare("SELECT spot_id FROM spots WHERE spot_id = ? AND merged_into IS NULL").bind(spotId).first();
  if (!spot) throw new CommunityEffectError(`community absence: ${spotId} is not a live canonical spot`);
  const applicationId = (input.newApplicationId ?? newAbsenceApplicationId)();
  await db.batch([
    db.prepare(
      `INSERT INTO community_absence_applications (application_id, subject_spot_id, review_version, decided_by, decided_at, state)
       VALUES (?, ?, ?, ?, ?, 'proposed')`,
    ).bind(applicationId, spotId, COMMUNITY_ABSENCE_VERSION, input.decidedBy, now),
    ...reportIds.map((id) => db.prepare(
      "INSERT INTO community_absence_evidence (report_id, application_id) VALUES (?, ?)",
    ).bind(id, applicationId)),
  ]);
  return applicationId;
}

async function readApplication(db: Db, applicationId: string) {
  const row = await db.prepare(
    "SELECT application_id, subject_spot_id, state FROM community_absence_applications WHERE application_id = ?",
  ).bind(applicationId).first<{ application_id: string; subject_spot_id: string; state: "proposed" | "applied" | "withdrawn" }>();
  if (!row) throw new CommunityEffectError(`community absence: application ${applicationId} does not exist`);
  return row;
}

async function linkedReportIds(db: Db, applicationId: string): Promise<string[]> {
  const { results } = await db.prepare(
    "SELECT report_id FROM community_absence_evidence WHERE application_id = ? ORDER BY report_id",
  ).bind(applicationId).all<{ report_id: string }>();
  return results.map((r) => r.report_id);
}

/** Records the review candidate. Nothing canonical or published changes. */
export async function applyCommunityAbsence(db: Db, applicationId: string, opts: { now: Date }): Promise<{ status: "applied" | "alreadyApplied"; spotId: string }> {
  const application = await readApplication(db, applicationId);
  if (application.state === "applied") return { status: "alreadyApplied", spotId: application.subject_spot_id };
  if (application.state === "withdrawn") throw new CommunityEffectError(`community absence: application ${applicationId} was withdrawn`);
  const now = isoSeconds(opts.now);
  const reportIds = await linkedReportIds(db, applicationId);
  assertPremises(await readPremises(db, reportIds), now, applicationId);
  await db.batch([
    db.prepare(
      "UPDATE community_absence_applications SET state = 'applied', applied_at = ? WHERE application_id = ? AND state = 'proposed'",
    ).bind(now, applicationId),
    ...reportIds.map((id) => db.prepare(
      "UPDATE report_moderation SET reconciliation_state = 'applied', updated_at = ? WHERE report_id = ?",
    ).bind(now, id)),
  ]);
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
  const rights = await communityRights(db, await linkedReportIds(db, applicationId), {
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
