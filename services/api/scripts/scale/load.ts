import { createHash } from "node:crypto";
import { ReportRequestV1 } from "../../src/reports/dto.ts";
import { createReport } from "../../src/reports/create.ts";
import { CURRENT_REPORT_TERMS } from "../../src/reports/terms.ts";
import { recordModerationDecision, setReconciliationState } from "../../src/reports/moderation.ts";
import { applyCommunityApplication } from "../../src/pipeline/community-reconciliation.ts";
import { applyCommunityEffect } from "../../src/pipeline/community-effects.ts";
import { upgradeCommunityEvidence } from "../../src/pipeline/community-verification.ts";
import { proposeNewSpotReview, proposeEffectReview, exportReview } from "../../src/reports/review.ts";
import { importCommunityArtifact } from "../../src/pipeline/community-artifact.ts";
import { type Profile, syntheticSpots, syntheticId } from "./corpus.ts";
import type { Db } from "../../src/db.ts";
export const BENCHMARK_NOW = "2026-10-01T03:00:00Z";
export const PRIVATE_SENTINEL = "SYNTHETIC_PRIVATE_TEXT_MUST_NOT_EXPORT";
/** Uses real intake, moderation, reconciliation and upgrade guards; approval is deliberately NOT changed here. */
export async function loadCommunityCorpus(db: Db, reportsDb: Db, profile: Profile, progress?: (n: number) => void) {
  let reports = 0;
  // Real official pins create a bounded subset of deliberate cross-source proximity candidates.
  const official = (await db.prepare("SELECT latitude, longitude FROM spots ORDER BY spot_id LIMIT 513").all<{latitude:number;longitude:number}>()).results;
  for (const spec of syntheticSpots(profile)) {
    const old = spec.scenario === "stale";
    const now = new Date(old ? "2025-09-01T03:00:00Z" : BENCHMARK_NOW);
    const at = spec.ordinal % 50 === 0 && official.length ? official[Math.floor(spec.ordinal / 50) % official.length] : spec;
    const location = { latitude: at.latitude, longitude: at.longitude };
    const initial = ["communityVerified", "stale", "accessRefinement", "typeRefinement"].includes(spec.scenario) ? 2 : 1;
    const claim = { spotType: "ashtray" as const, accessType: spec.scenario === "accessRefinement" ? "customerOnly" as const : "public" as const,
      hostType: ["convenienceStore", "tobaccoShop", "restaurantOrCafe", "station", "airport", "commercialBuilding", "municipality", "other"][spec.ordinal % 8] as "convenienceStore",
      environment: "outdoor" as const };
    for (let j = 0; j < 5; j++) {
      let type: "missing" | "exists" | "removed" | "notFound" | "moved" | "accessChanged" | "typeChanged" = j < initial ? "missing" : "exists";
      if (j >= initial) {
        if (spec.scenario === "needsRecheck" && j === 4) type = "notFound";
        if (spec.scenario === "absence") type = "removed";
        if (spec.scenario === "conflicting") type = j % 2 ? "exists" : "removed";
        if (["correction", "relocation"].includes(spec.scenario)) type = "moved";
        if (spec.scenario === "duplicate") type = "missing";
        if (spec.scenario === "accessRefinement") type = "accessChanged";
        if (spec.scenario === "typeRefinement") type = "typeChanged";
      }
      const reportNow = new Date(now.getTime() + j * 1000);
      const request = { schemaVersion: 1 as const, type, installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f",
        ...(type === "missing" ? {} : { spotId: spec.spotId }),
        ...(["missing", "moved"].includes(type) ? { proposedLocation: type === "moved" ? { latitude: location.latitude + .001, longitude: location.longitude } : location } : {}),
        note: PRIVATE_SENTINEL, ...(type === "missing" ? { claim } : type === "accessChanged" ? { claim: { accessType: "customerOnly" as const } } : type === "typeChanged" ? { claim: { spotType: "ashtray" as const } } : {}), acceptedTermsVersion: CURRENT_REPORT_TERMS.version };
      await createReport(reportsDb, ReportRequestV1.parse(request), { now: reportNow, attestationStatus: "notProvided", newReportId: () => spec.reportIds[j],
        // Repeated pin spam: later confirmations deliberately share a submitter. Initial two remain independent.
        submitterHash: createHash("sha256").update(`synthetic:${spec.ordinal}:${["absence", "relocation", "conflicting"].includes(spec.scenario) ? j : j < 2 ? j : 1}`).digest("hex") });
      reports++;
      if (j < initial || type !== "missing") {
        await recordModerationDecision(reportsDb, spec.reportIds[j], { state: "accepted", decidedBy: "synthetic-reviewer", reason: "confirmed", now: reportNow });
        await setReconciliationState(reportsDb, spec.reportIds[j], "queued", reportNow);
      }
      if (j === initial - 1) {
        const applicationId = await proposeNewSpotReview(reportsDb, { reportIds: spec.reportIds.slice(0, initial), locationReportId: spec.reportIds[0],
          decidedBy: "synthetic-reviewer", now: reportNow, tier: initial === 1 ? "communityReported" : "communityVerified", newReviewId: () => spec.applicationId });
        const exported = await exportReview(reportsDb, applicationId, { now: reportNow });
        const imported = await importCommunityArtifact(db, exported.artifact.bytes, { now: reportNow });
        if (imported.status !== "imported") throw new Error(JSON.stringify(imported));
        await applyCommunityApplication(db, applicationId, { now: reportNow, newSpotId: () => spec.spotId });
      }
      if (spec.scenario === "visitedConfirmed" && j === 1) {
        const effect = await proposeEffectReview(reportsDb, { reportIds: [spec.reportIds[j]], baseReportIds: [spec.reportIds[0]], decidedBy: "synthetic-reviewer", now: reportNow, newReviewId: () => syntheticId("ce", spec.ordinal) });
        const exported = await exportReview(reportsDb, effect.reviewId, { now: reportNow });
        const imported = await importCommunityArtifact(db, exported.artifact.bytes, { now: reportNow });
        if (imported.status !== "imported") throw new Error(JSON.stringify(imported));
        await applyCommunityEffect(db, effect.reviewId, { now: reportNow });
        await upgradeCommunityEvidence(db, effect.reviewId, { decidedBy: "synthetic-reviewer", now: reportNow });
      }
    }
    if ((spec.ordinal + 1) % 1000 === 0) progress?.(spec.ordinal + 1);
  }
  return { reports };
}
