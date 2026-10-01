// The two databases of the community flow (ADR-0014): the durable REPORTS_DB, where reports are moderated and
// reviewed, and the canonical DATA_DB, which only ever sees the sanitized artifact of an exported review. These
// helpers run the real modules end to end: propose (REPORTS_DB) -> export -> import (DATA_DB). Nothing is shortcut.
import assert from "node:assert/strict";
import { type ImportResult, importCommunityArtifact, spotEvidenceReportIds } from "../../src/pipeline/community-artifact.ts";
import {
  type EffectReviewInput, type NewSpotReviewInput, exportReview, proposeAbsenceReview, proposeEffectReview, proposeNewSpotReview,
} from "../../src/reports/review.ts";
import type { SealedArtifact } from "../../src/reports/evidence-artifact.ts";
import type { ReviewedTerms } from "../../src/reports/terms.ts";
import { SqliteD1, reportsD1 } from "./sqlite-d1.ts";

export interface Stores {
  reports: SqliteD1;
  data: SqliteD1;
  /** TEST ONLY: resolves a simulated terms version on import, as createReport's injection point does on intake. */
  reviewedTerms?: (version: string) => ReviewedTerms | undefined;
}

export function stores(data: SqliteD1 = new SqliteD1()): Stores {
  return { reports: reportsD1(), data };
}

/** Exports a proposed review from REPORTS_DB and imports its artifact into DATA_DB; the import must succeed. */
export async function exportAndImport(s: Stores, reviewId: string, now: Date): Promise<SealedArtifact> {
  const { artifact } = await exportReview(s.reports, reviewId, { now });
  const imported: ImportResult = await importCommunityArtifact(s.data, artifact.bytes, { now, reviewedTerms: s.reviewedTerms });
  assert.equal(imported.status, "imported", JSON.stringify(imported));
  return artifact;
}

/** A reviewed new-spot decision, exported and imported: the DATA_DB application ID (= the review ID). */
export async function proposeNewSpot(s: Stores, input: NewSpotReviewInput): Promise<string> {
  const id = await proposeNewSpotReview(s.reports, input);
  await exportAndImport(s, id, input.now);
  return id;
}

export async function proposeEffect(s: Stores, input: EffectReviewInput): Promise<{ applicationId: string; effect: string }> {
  const { reviewId, effect } = await proposeEffectReview(s.reports, input);
  await exportAndImport(s, reviewId, input.now);
  return { applicationId: reviewId, effect };
}

export async function proposeAbsence(s: Stores, input: { reportIds: readonly string[]; decidedBy: string; now: Date }): Promise<string> {
  const id = await proposeAbsenceReview(s.reports, input);
  await exportAndImport(s, id, input.now);
  return id;
}

/**
 * The report store paired with a canonical test database, created on first use. Lets a test that holds only its
 * canonical database reach "its" REPORTS_DB, the way an operator's tool holds both bindings.
 */
const PAIRED = new WeakMap<SqliteD1, SqliteD1>();
export function reportsOf(data: SqliteD1): SqliteD1 {
  let reports = PAIRED.get(data);
  if (reports === undefined) {
    reports = reportsD1();
    PAIRED.set(data, reports);
  }
  return reports;
}
export const storesOf = (data: SqliteD1): Stores => ({ data, reports: reportsOf(data) });

/**
 * An `exists` confirmation as the operator tool proposes it: when the spot is communityReported, its own evidence
 * report IDs are read from DATA_DB and passed as the base, so REPORTS_DB can attest independence over both.
 */
export async function proposeConfirmation(s: Stores, input: EffectReviewInput & { spotId: string }): Promise<{ applicationId: string; effect: string }> {
  const quality = s.data.raw.prepare("SELECT evidence_quality FROM spots WHERE spot_id = ?").get(input.spotId) as { evidence_quality?: string } | undefined;
  const base = quality?.evidence_quality === "communityReported" ? await spotEvidenceReportIds(s.data, input.spotId) : undefined;
  return proposeEffect(s, { ...input, ...(base === undefined || base.length === 0 ? {} : { baseReportIds: base }) });
}
