// Community publication activation (Issue #124, Issue #150; docs/legal/COMMUNITY_PUBLICATION_DECISION.md).
//
// Two halves:
// 1. The repository as it is: the maintainer decision is `pending`, and everything derived from it — the terms list,
//    the community source entry, docs/SOURCES.md, the app's bundled terms — agrees. The activation command refuses.
// 2. A SIMULATED approval (TEST ONLY): a new terms version that is not the draft, applied exactly the way the
//    activation PR would apply it, run through the whole community lifecycle, promotion, bootstrap and rollback.
//    Nothing here changes the repository decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { isoSeconds } from "../src/db.ts";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { applyCommunityAbsence, holdCommunityAbsence, proposeCommunityAbsence } from "../src/pipeline/community-absence.ts";
import { applyCommunityEffect, proposeCommunityEffect } from "../src/pipeline/community-effects.ts";
import { communityStage, correctionCandidates, spotEvidenceStates } from "../src/pipeline/community-evidence.ts";
import { applyCommunityApplication, proposeCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { upgradeCommunityEvidence } from "../src/pipeline/community-verification.ts";
import { type PromotionRegistry, buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import {
  COMMUNITY_ATTRIBUTION_CANDIDATE, COMMUNITY_PUBLICATION, COMMUNITY_TERMS_CANDIDATE_PATH, type CommunityPublicationDecision,
  MAINTAINER_INPUT_MARKER, decisionProblems, decisionSourceFields, decisionTerms, planActivation,
} from "../src/reports/community-publication.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { CURRENT_REPORT_TERMS, REPORT_TERMS, type ReviewedTerms, reviewedTerms } from "../src/reports/terms.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const repo = (path: string) => new URL(`../../../${path}`, import.meta.url);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const APPLE_TERMS_DIR = "apps/apple/MannerPath/MannerPath/Features/Reports/Terms";

// =============================================================================================================
// 1. The repository decision as it stands.
test("the repository decision is pending, and everything derived from it agrees (Issue #124 stays a maintainer decision)", () => {
  assert.equal(COMMUNITY_PUBLICATION.state, "pending", "only a maintainer approves community publication");
  assert.deepEqual(decisionTerms(COMMUNITY_PUBLICATION), []);
  assert.deepEqual(REPORT_TERMS.map((t) => [t.version, t.publicationRights]), [["report-terms.2026-09-30.draft", "pending"]]);
  for (const t of REPORT_TERMS) {
    if (/\.(draft|candidate)$/.test(t.version)) assert.equal(t.publicationRights, "pending", `${t.version} can never grant rights`);
  }
  assert.deepEqual(
    [COMMUNITY_REGISTRY.publicationStatus, COMMUNITY_REGISTRY.licenseName, COMMUNITY_REGISTRY.licenseUrl, COMMUNITY_REGISTRY.attributionText],
    ["blocked", null, null, null]);
  const sources = readFileSync(repo("docs/SOURCES.md"), "utf8");
  const entry = sources.slice(sources.indexOf("`mannerpath-community-reports`"), sources.indexOf("### 台東区"));
  assert.match(entry, /\| Publication status \| \*\*blocked\*\*/, "docs/SOURCES.md records the same decision");

  // The candidate is not a registered version, still needs maintainer input, and says it is a candidate.
  const candidate = readFileSync(repo(COMMUNITY_TERMS_CANDIDATE_PATH), "utf8");
  assert.ok(candidate.includes(MAINTAINER_INPUT_MARKER) && candidate.includes("CANDIDATE"));
  assert.ok(!REPORT_TERMS.some((t) => t.documentPath === COMMUNITY_TERMS_CANDIDATE_PATH), "the candidate is never shown or consented to");
});

test("the app bundles every registered terms version byte-for-byte, so the full text shown is what consent records", () => {
  for (const t of REPORT_TERMS) {
    const bundled = readFileSync(repo(`${APPLE_TERMS_DIR}/${t.version}.md`));
    assert.equal(sha256(bundled), t.documentSha256, `${APPLE_TERMS_DIR}/${t.version}.md differs from ${t.documentPath}`);
  }
  const swift = readFileSync(repo("apps/apple/MannerPath/MannerPath/Features/Reports/ReportDomain.swift"), "utf8");
  for (const t of REPORT_TERMS) {
    assert.match(swift, new RegExp(`Document\\(version: "${t.version.replaceAll(".", "\\.")}", isDraft: ${t.publicationRights === "pending"}\\)`),
      `ReportTerms.documents lists ${t.version} with the matching draft flag`);
  }
});

// A consistent simulated approval, with its document held in memory (it is not in the repository).
const SIM_VERSION = "report-terms.2026-11-01";
const SIM_DOCUMENT = new TextEncoder().encode(`# MannerPath 利用者報告規約\n\n- 版: \`${SIM_VERSION}\`\n`);
const SIM_APPROVED: CommunityPublicationDecision = {
  state: "approved", termsVersion: SIM_VERSION, documentPath: `docs/legal/report-terms/${SIM_VERSION}.md`,
  documentSha256: sha256(SIM_DOCUMENT), termsUrl: "https://example.invalid/report-terms", approvedBy: "test-maintainer", approvedOn: "2026-11-01",
};
const SIM_SUSPENDED: CommunityPublicationDecision = { ...SIM_APPROVED, state: "suspended", suspendedOn: "2026-11-15" };

test("community:activate applies only a repository-approved decision, for exactly its version, and only when consistent", () => {
  const refused = (d: CommunityPublicationDecision, v: string | undefined, doc: Uint8Array | null = SIM_DOCUMENT) => {
    const plan = planActivation(d, v, doc, sha256);
    assert.equal(plan.ok, false);
    return plan.ok ? [] : plan.problems.join("; ");
  };
  assert.match(String(refused(COMMUNITY_PUBLICATION, CURRENT_REPORT_TERMS.version)), /pending/, "the CLI cannot approve anything");
  assert.match(String(refused(SIM_APPROVED, undefined)), /--terms-version/);
  assert.match(String(refused(SIM_APPROVED, "report-terms.2026-09-30.draft")), /is not the approved version/);
  assert.match(String(refused(SIM_SUSPENDED, SIM_VERSION)), /suspended/);
  assert.match(String(refused({ ...SIM_APPROVED, termsVersion: "report-terms.2026-09-30.draft" }, "report-terms.2026-09-30.draft")), /draft or candidate/);
  assert.match(String(refused(SIM_APPROVED, SIM_VERSION, null)), /does not exist/);
  const placeholder = new TextEncoder().encode(`${new TextDecoder().decode(SIM_DOCUMENT)}〔${MAINTAINER_INPUT_MARKER}: 連絡先〕\n`);
  assert.match(String(refused({ ...SIM_APPROVED, documentSha256: sha256(placeholder) }, SIM_VERSION, placeholder)), /MAINTAINER-INPUT/);
  assert.match(String(refused({ ...SIM_APPROVED, documentSha256: "0".repeat(64) }, SIM_VERSION)), /does not match documentSha256/);
  assert.match(String(refused({ ...SIM_APPROVED, termsUrl: "http://x" }, SIM_VERSION)), /https/);

  const plan = planActivation(SIM_APPROVED, SIM_VERSION, SIM_DOCUMENT, sha256);
  assert.ok(plan.ok);
  assert.deepEqual(plan.terms, { version: SIM_VERSION, documentPath: SIM_APPROVED.documentPath, documentSha256: SIM_APPROVED.documentSha256, publicationRights: "granted" });
  assert.deepEqual(plan.source, { licenseName: `MannerPath 利用者報告規約 (${SIM_VERSION})`, licenseUrl: "https://example.invalid/report-terms",
    attributionText: COMMUNITY_ATTRIBUTION_CANDIDATE, publicationStatus: "approved" });
  assert.deepEqual(decisionProblems(SIM_SUSPENDED, SIM_DOCUMENT, sha256), []);
  assert.equal(decisionTerms(SIM_SUSPENDED)[0].publicationRights, "revoked");
  assert.equal(decisionSourceFields(SIM_SUSPENDED).publicationStatus, "blocked");
});

// =============================================================================================================
// 2. Simulated activation, end to end (TEST ONLY).
const RECEIVED = new Date("2026-11-02T03:00:00Z");
const APPLY = new Date("2026-11-05T03:00:00Z");
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const NOTE = "起動シミュレーション用メモ ACT-5521";
const OBSERVED = "2026-10-29";
const HASHES = ["0123456789abcdef", "fedcba9876543210", "0f1e2d3c4b5a6978", "1111222233334444", "5555666677778888"].map((h) => h.repeat(4));
const HERE = { latitude: 35.69001, longitude: 139.70001 };
const DRAFT = "report-terms.2026-09-30.draft";

const simTerms = (decision: CommunityPublicationDecision) => (v: string): ReviewedTerms =>
  decisionTerms(decision).find((t) => t.version === v) ?? reviewedTerms(v);
/** What `community:activate` (applyReportTermsRegistry + applyReviewedSourceRegistry) writes, under a decision. */
function applyDecisionToRows(db: SqliteD1, decision: CommunityPublicationDecision) {
  const s = decisionSourceFields(decision);
  db.raw.prepare("UPDATE sources SET license_name = ?, license_url = ?, attribution_text = ?, publication_status = ? WHERE source_id = ?")
    .run(s.licenseName, s.licenseUrl, s.attributionText, s.publicationStatus, COMMUNITY_SOURCE_ID);
  for (const t of decisionTerms(decision)) {
    db.raw.prepare("UPDATE report_terms_versions SET publication_rights = ? WHERE terms_version = ?").run(t.publicationRights, t.version);
  }
}
const simRegistry = (decision: CommunityPublicationDecision): PromotionRegistry => ({
  source: (id) => (id === COMMUNITY_SOURCE_ID ? { ...COMMUNITY_REGISTRY, ...decisionSourceFields(decision) } : reviewedSource(id)),
  terms: simTerms(decision),
});

async function report(db: SqliteD1, hash: string, body: Record<string, unknown>, consent: string | null = SIM_VERSION) {
  const request = { schemaVersion: 1, installId: INSTALL, note: NOTE, observedOn: OBSERVED, ...body, ...(consent === null ? {} : { acceptedTermsVersion: consent }) };
  const { reportId } = await createReport(db, request as any, { now: RECEIVED, attestationStatus: "notProvided", submitterHash: hash, reviewedTerms: simTerms(SIM_APPROVED) });
  return reportId;
}
async function accept(db: SqliteD1, ...ids: string[]) {
  for (const id of ids) {
    await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
    await setReconciliationState(db, id, "queued", RECEIVED);
  }
}
async function newSpot(db: SqliteD1, hash: string, at: { latitude: number; longitude: number }, prefix: string, consent: string | null = SIM_VERSION) {
  const id = await report(db, hash, { type: "missing", proposedLocation: at, claim: { spotType: "ashtray", hostType: "convenienceStore" } }, consent);
  await accept(db, id);
  const applicationId = await proposeCommunityApplication(db, { reportIds: [id], locationReportId: id, decidedBy: "reviewer-1", now: APPLY, tier: "communityReported" });
  const { spotId } = await applyCommunityApplication(db, applicationId, { now: APPLY, newSpotId: sequentialSpotIds(prefix) }) as { spotId: string };
  return { spotId, reportId: id };
}
const published = (db: SqliteD1, spotId: string) => one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n === 1;
const tileSpots = (db: SqliteD1) => all(db, "SELECT body_json FROM tile_snapshots").flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
const officialPublished = (db: SqliteD1) => tileSpots(db).filter((s) => !s.sourceIds.includes(COMMUNITY_SOURCE_ID)).map((s) => s.id).sort();

test("simulated activation: new version → consent → moderation → communityReported → publish → confirmation → promotion → bootstrap → rollback", async () => {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  await publishTiles(db, { now: isoSeconds(RECEIVED) });
  const officialBefore = officialPublished(db);
  assert.ok(officialBefore.length > 0);

  // Reports consented to the new version, to the draft, and to nothing.
  const fresh = await newSpot(db, HASHES[0], HERE, "N");
  const draft = await newSpot(db, HASHES[1], { latitude: 35.69501, longitude: 139.70501 }, "D", DRAFT);
  await assert.rejects(newSpot(db, HASHES[2], { latitude: 35.69801, longitude: 139.70801 }, "U", null), /has no terms consent/,
    "a report without consent cannot even back a community application");

  // Before approval (decision pending): nothing community publishes.
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(![fresh, draft].some((s) => published(db, s.spotId)), "pending: no community spot publishes");

  // Activation, as the activation PR + community:activate would apply it.
  applyDecisionToRows(db, SIM_APPROVED);
  assert.deepEqual(all(db, "SELECT terms_version, publication_rights FROM report_terms_versions ORDER BY terms_version").map((r) => ({ ...r })),
    [{ terms_version: DRAFT, publication_rights: "pending" }, { terms_version: SIM_VERSION, publication_rights: "granted" }]);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, fresh.spotId), "consent to the granted version publishes");
  assert.equal(published(db, draft.spotId), false, "no retroactive rights: draft consent never publishes");
  assert.deepEqual(officialPublished(db), officialBefore, "official spots are unaffected");

  // What is published: the reviewed fact, its tier and the attribution; nothing personal.
  const spot = tileSpots(db).find((s) => s.id === fresh.spotId)!;
  assert.equal(spot.verification.existence, "communityReported");
  assert.equal(spot.lastVerifiedAt, null, "lastVerifiedAt stays unknown (Issue #124 item 3)");
  const tileBody = JSON.stringify(all(db, "SELECT body_json FROM tile_snapshots"));
  const tileSource = JSON.parse(all(db, "SELECT body_json FROM tile_snapshots").find((t) => t.body_json.includes(fresh.spotId))!.body_json)
    .sources.find((s: Row) => s.id === COMMUNITY_SOURCE_ID);
  assert.equal(tileSource.attributionText, COMMUNITY_ATTRIBUTION_CANDIDATE);
  const detail = await (await app.request(`/v1/spots/${fresh.spotId}`, {}, { DB: db } as any)).json() as Row;
  assert.equal(detail.sources.find((s: Row) => s.id === COMMUNITY_SOURCE_ID).attributionText, COMMUNITY_ATTRIBUTION_CANDIDATE);
  for (const needle of [NOTE, OBSERVED, INSTALL, ...HASHES, fresh.reportId, "submitter", "installId", "note\""]) {
    assert.ok(!tileBody.includes(needle) && !JSON.stringify(detail).includes(needle), `published data carries ${needle}`);
  }

  // A second, independent confirmation: visitedConfirmed (communityVerified tier).
  const confirm = await report(db, HASHES[3], { type: "exists", spotId: fresh.spotId, note: undefined, observedOn: undefined });
  await accept(db, confirm);
  const effect = await proposeCommunityEffect(db, { reportIds: [confirm], decidedBy: "reviewer-1", now: APPLY });
  await applyCommunityEffect(db, effect.applicationId, { now: APPLY });
  assert.equal((await upgradeCommunityEvidence(db, effect.applicationId, { decidedBy: "reviewer-1", now: APPLY })).confirmations, 2);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const upgraded = tileSpots(db).find((s) => s.id === fresh.spotId)!;
  assert.equal(upgraded.verification.existence, "communityVerified");
  assert.equal(communityStage({ existence: upgraded.verification.existence, confirmations: upgraded.verification.confirmations, upgradedByVisit: true }), "visitedConfirmed");

  // Quality reads the launch volume without failing on it.
  const quality = await analyzeCorpus(db, { now: isoSeconds(APPLY) });
  assert.equal(quality.nationwide.community.publishedSpots, 1);
  const moderation = quality.nationwide.communityAcquisition.moderation;
  assert.deepEqual([moderation.pending, moderation.rejected, moderation.rejectedRate], [0, 0, 0], "community moderation metrics are reported");
  // The only failing check is the one that catches this very simulation: the rows were approved by hand while the
  // repository decision is still pending. A real activation changes both, so it passes; nothing fails on volume.
  assert.deepEqual(quality.checks.filter((c) => c.status !== "pass").map((c) => c.id), ["registry-row-matches-reviewed-entry"]);

  // Promotion v3 + bootstrap on a fresh target, then an identical re-export.
  const bundle = await buildMultiSourcePromotionBundle(db, { registry: simRegistry(SIM_APPROVED) });
  for (const needle of [NOTE, OBSERVED, ...HASHES, "INSERT INTO reports", "submitter"]) assert.ok(!bundle.sql.includes(needle), `bundle carries ${needle}`);
  assert.equal(bundle.manifest.rows.report_terms_versions, 1, "only the granted version travels");
  const target = new SqliteD1(migratedSqlite());
  applyPromotionBundle(target.raw, bundle.sql);
  assert.ok(published(target, fresh.spotId) && !published(target, draft.spotId));
  assert.deepEqual(officialPublished(target), officialBefore);
  assert.equal((await buildMultiSourcePromotionBundle(target, { registry: simRegistry(SIM_APPROVED) })).sql, bundle.sql);

  // Rollback: suspend. Community leaves the tiles; official spots and all evidence stay.
  const evidence = ["reports", "report_moderation", "community_reconciliation_applications", "spots", "source_records"]
    .map((t) => one(db, `SELECT count(*) AS n FROM ${t}`).n);
  applyDecisionToRows(db, SIM_SUSPENDED);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, fresh.spotId), false, "suspended: community spots leave the tiles");
  assert.deepEqual(officialPublished(db), officialBefore, "rollback blocks community only");
  assert.deepEqual(["reports", "report_moderation", "community_reconciliation_applications", "spots", "source_records"]
    .map((t) => one(db, `SELECT count(*) AS n FROM ${t}`).n), evidence, "nothing is deleted");
  // The rollback bundle (a new blue/green database) carries no community source and the same official spots.
  const rollbackBundle = await buildMultiSourcePromotionBundle(db, { registry: simRegistry(SIM_SUSPENDED) });
  assert.ok(!rollbackBundle.manifest.sources.some((s) => s.sourceId === COMMUNITY_SOURCE_ID));
  assert.ok(!rollbackBundle.sql.includes("INSERT INTO report_terms_versions"));
  const rolledBack = new SqliteD1(migratedSqlite());
  applyPromotionBundle(rolledBack.raw, rollbackBundle.sql);
  assert.deepEqual(officialPublished(rolledBack), officialBefore);
  // Re-approval restores publication from the preserved evidence.
  applyDecisionToRows(db, SIM_APPROVED);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, fresh.spotId));
});

test("simulated activation: negatives, correction, relocation candidate and absence hold follow the granted version", async () => {
  const db = new SqliteD1();
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  applyDecisionToRows(db, SIM_APPROVED);
  const { spotId } = await newSpot(db, HASHES[0], HERE, "N");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  applyDecisionToRows(db, SIM_APPROVED);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, spotId));

  // Correction: two independent agreeing pins become a relocation candidate; nothing moves.
  const before = one(db, "SELECT latitude, longitude FROM spots WHERE spot_id = ?", spotId);
  const pin = { latitude: before.latitude + 0.0009, longitude: before.longitude };
  const m1 = await report(db, HASHES[1], { type: "moved", spotId, proposedLocation: pin });
  const m2 = await report(db, HASHES[2], { type: "moved", spotId, proposedLocation: { latitude: pin.latitude + 0.0001, longitude: pin.longitude } });
  await accept(db, m1, m2);
  const [candidate] = await correctionCandidates(db, { now: APPLY });
  assert.deepEqual([candidate.spotId, candidate.status], [spotId, "relocationCandidate"]);
  const relocation = await proposeCommunityEffect(db, { reportIds: [m1, m2], decidedBy: "reviewer-1", now: APPLY });
  assert.equal(relocation.effect, "relocationReview");
  await applyCommunityEffect(db, relocation.applicationId, { now: APPLY });
  assert.deepEqual(one(db, "SELECT latitude, longitude FROM spots WHERE spot_id = ?", spotId), before);

  // A negative from a draft-consented report never counts toward a public hold, even after approval.
  const n1 = await report(db, HASHES[3], { type: "notFound", spotId, note: undefined, observedOn: undefined });
  const nDraft = await report(db, HASHES[4], { type: "removed", spotId, note: undefined, observedOn: undefined }, DRAFT);
  await accept(db, n1, nDraft);
  assert.equal((await spotEvidenceStates(db, { now: APPLY, spotIds: [spotId] }))[0].state, "reviewCandidate");
  const mixed = await proposeCommunityAbsence(db, { reportIds: [n1, nDraft], decidedBy: "reviewer-1", now: APPLY });
  await applyCommunityAbsence(db, mixed, { now: APPLY });
  const refused = await holdCommunityAbsence(db, mixed, { now: APPLY, sourceApprovedInCode: true });
  assert.ok(refused.status === "blocked" && refused.blockers.includes("noCommonConsent"), JSON.stringify(refused));
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, spotId), "an absence candidate alone deletes and hides nothing");
});
