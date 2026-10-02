// Community publication readiness (Issue #124 technical half, Issue #127; migration 0021, ADR-0007 amendment
// 2026-09-30, ADR-0014). Report terms consent, the rights gate on community publication, promotion v3 for the additive
// community source, and existing-spot report effects. Reports live in the durable REPORTS_DB; the canonical DATA_DB
// sees only imported, sanitized review artifacts.
//
// The community source is BLOCKED and the report terms are a DRAFT. Every test below that needs a published community
// spot or a public-facing effect simulates the future approval explicitly — the local rows by hand and the reviewed
// lists through the injection points only tests use — and says so. Nothing here approves anything for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { type Db, isoSeconds } from "../src/db.ts";
import { COMMUNITY_REGISTRY, COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import {
  COMMUNITY_EFFECTS, CommunityEffectError, applyCommunityEffect, communityRights, holdCommunityEffect, liftCommunityHold,
  listCommunityEffects, withdrawCommunityEffect,
} from "../src/pipeline/community-effects.ts";
import { applyCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { importCommunityArtifact } from "../src/pipeline/community-artifact.ts";
import { exportReview, listExistingSpotQueue, proposeEffectReview } from "../src/reports/review.ts";
import { generateCrossSourceCandidates } from "../src/pipeline/cross-source.ts";
import { type PromotionRegistry, buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource, reviewedSource } from "../src/pipeline/registry.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { createReport, minimizeAfter } from "../src/reports/create.ts";
import { moderationPipelineSummary, recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import { CURRENT_REPORT_TERMS, REPORT_TERMS, applyReportTermsRegistry, reviewedTerms } from "../src/reports/terms.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite, reportsD1 } from "./support/sqlite-d1.ts";
import { type Stores, proposeEffect, proposeNewSpot, stores } from "./support/community.ts";
import { v1TileRows } from "./support/tiles.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const count = (db: SqliteD1, table: string) => one(db, `SELECT count(*) AS n FROM ${table}`).n as number;

const RECEIVED = new Date("2026-09-21T03:00:00Z");
const APPLY = new Date("2026-09-25T03:00:00Z");
const NOTE = "公開準備テスト用メモ QKV-2291";
const OBSERVED = "2026-07-07";
const INSTALL = "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f";
const TERMS = CURRENT_REPORT_TERMS.version;
const HASHES = ["0123456789abcdef", "fedcba9876543210", "0f1e2d3c4b5a6978", "1111222233334444"].map((h) => h.repeat(4));
const SIM_ATTRIBUTION = "TEST ONLY simulated community attribution";

// ---- simulation of the future approval (TEST ONLY) -----------------------------------------------------------
const approveSourceRow = (db: SqliteD1) => db.raw.prepare(
  "UPDATE sources SET publication_status = 'approved', attribution_text = ? WHERE source_id = ?",
).run(SIM_ATTRIBUTION, COMMUNITY_SOURCE_ID);
const setTermsRights = (db: SqliteD1, rights: "pending" | "granted" | "revoked") => db.raw.prepare(
  "UPDATE report_terms_versions SET publication_rights = ? WHERE terms_version = ?",
).run(rights, TERMS);
const SIMULATED_REGISTRY: PromotionRegistry = {
  source: (id) => id === COMMUNITY_SOURCE_ID
    ? { ...COMMUNITY_REGISTRY, publicationStatus: "approved", attributionText: SIM_ATTRIBUTION }
    : reviewedSource(id),
  terms: (v) => ({ ...reviewedTerms(v), publicationRights: "granted" }),
};

// ---- reports ----------------------------------------------------------------------------------------------
async function newSpotReport(db: SqliteD1, hash: string, at: { latitude: number; longitude: number }, consent: string | null = TERMS, now = RECEIVED) {
  const request = { schemaVersion: 1, type: "missing", proposedLocation: at, installId: INSTALL, note: NOTE, observedOn: OBSERVED,
    ...(consent === null ? {} : { acceptedTermsVersion: consent }) };
  const { reportId } = await createReport(db, request as any, { now, attestationStatus: "notProvided", submitterHash: hash });
  return reportId;
}

async function spotReport(db: SqliteD1, hash: string, spotId: string, type: string, consent: string | null = TERMS) {
  const request = { schemaVersion: 1, type, spotId, installId: INSTALL, note: NOTE, observedOn: OBSERVED,
    ...(type === "moved" ? { proposedLocation: { latitude: 35.7, longitude: 139.7 } } : {}),
    ...(consent === null ? {} : { acceptedTermsVersion: consent }) };
  const { reportId } = await createReport(db, request as any, { now: RECEIVED, attestationStatus: "notProvided", submitterHash: hash });
  return reportId;
}

async function acceptAndQueue(db: SqliteD1, ...ids: string[]) {
  for (const id of ids) {
    await recordModerationDecision(db, id, { state: "accepted", decidedBy: "reviewer-1", reason: "confirmed", now: RECEIVED });
    await setReconciliationState(db, id, "queued", RECEIVED);
  }
}

/** Two independent consented reports -> reviewed decision (REPORTS_DB) -> imported artifact -> applied community spot (DATA_DB). */
async function communitySpot(s: Stores, at: { latitude: number; longitude: number }, hashes: [string, string], prefix: string, consent: [string | null, string | null] = [TERMS, TERMS]) {
  const a = await newSpotReport(s.reports, hashes[0], at, consent[0]);
  const b = await newSpotReport(s.reports, hashes[1], at, consent[1]);
  await acceptAndQueue(s.reports, a, b);
  const applicationId = await proposeNewSpot(s, { reportIds: [a, b], locationReportId: a, decidedBy: "reviewer-1", now: APPLY });
  const result = await applyCommunityApplication(s.data, applicationId, { now: APPLY, newSpotId: sequentialSpotIds(prefix) }) as { releaseId: number; spotId: string };
  return { ...result, reportIds: [a, b], applicationId };
}

const published = (db: SqliteD1, spotId: string) => one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n === 1;
const publishedMunicipalSpot = (db: SqliteD1) => one(db, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 1").spot_id as string;

// =============================================================================================================
// 1. Terms and consent
test("terms registry: the draft document is pinned by hash, is the current version, and grants no rights", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  for (const terms of REPORT_TERMS) {
    const bytes = readFileSync(new URL(`../../../${terms.documentPath}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), terms.documentSha256, `${terms.documentPath} changed without a new terms version`);
  }
  assert.equal(CURRENT_REPORT_TERMS.publicationRights, "pending", "the draft must not grant publication rights (Issue #124)");
  assert.match(readFileSync(new URL(`../../../${CURRENT_REPORT_TERMS.documentPath}`, import.meta.url), "utf8"),
    /DRAFT — requires legal\/maintainer approval before production/);
  assert.equal(COMMUNITY_REGISTRY.publicationStatus, "blocked", "the community source stays blocked (Issue #124)");

  const config = await (await app.request("/v1/config", {}, {} as any)).json() as Row;
  assert.equal(config.reports.termsVersion, TERMS);
});

test("an old report has no consent; a new consented report is distinguishable; an outdated version is refused", async () => {
  const db = reportsD1();
  const data = new SqliteD1();
  const post = (body: unknown) => app.request("/v1/reports", { method: "POST", body: JSON.stringify(body) }, { DB: data, REPORTS_DB: db } as any);
  const base = { schemaVersion: 1, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: INSTALL };

  const legacy = await post(base);
  assert.equal(legacy.status, 201);
  const consented = await post({ ...base, acceptedTermsVersion: TERMS });
  assert.equal(consented.status, 201);
  const rows = all(db, "SELECT report_id, accepted_terms_version FROM reports ORDER BY received_at, report_id");
  const byId = new Map(rows.map((r) => [r.report_id, r.accepted_terms_version]));
  assert.equal(byId.get(((await legacy.json()) as Row).reportId), null, "a report without consent stores no version");
  assert.equal(byId.get(((await consented.json()) as Row).reportId), TERMS);
  // Consent is recorded in the report store against the document; rights are never written there (ADR-0014).
  assert.deepEqual(one(db, "SELECT terms_version, document_sha256 FROM report_terms_documents"),
    { terms_version: TERMS, document_sha256: CURRENT_REPORT_TERMS.documentSha256 });
  assert.equal(all(db, "SELECT name FROM pragma_table_info('report_terms_documents')").some((c) => c.name === "publication_rights"), false);
  assert.equal(count(data, "report_terms_versions"), 0, "a report writes nothing canonical, not even the terms mirror");

  const outdated = await post({ ...base, acceptedTermsVersion: "report-terms.1999-01-01" });
  assert.equal(outdated.status, 409);
  assert.equal(((await outdated.json()) as Row).error, "termsVersionOutdated");
  const malformed = await post({ ...base, acceptedTermsVersion: "Report Terms!" });
  assert.equal(malformed.status, 400);
  assert.equal(count(db, "reports"), 2, "a refused consent stores nothing");
});

test("no retroactive rights: consent is immutable, survives redaction, and a legacy report never gains it", async () => {
  const { s, db, spotId } = await effectsWorld();
  const legacy = await spotReport(s.reports, HASHES[0], spotId, "prohibited", null);
  const consented = await spotReport(s.reports, HASHES[1], spotId, "prohibited");
  assert.throws(() => s.reports.raw.prepare("UPDATE reports SET accepted_terms_version = ? WHERE report_id = ?").run(TERMS, legacy), /immutable proposals/);
  assert.throws(() => s.reports.raw.prepare("UPDATE reports SET accepted_terms_version = NULL, note = NULL, redacted_at = 'x' WHERE report_id = ?").run(consented), /immutable proposals/);

  await acceptAndQueue(s.reports, legacy, consented);
  const { applicationId } = await proposeEffect(s, { reportIds: [legacy, consented], decidedBy: "r", now: APPLY });
  assert.equal(one(db, "SELECT terms_version FROM community_artifact_ledger WHERE review_id = ?", applicationId).terms_version, null);
  approveSourceRow(db);
  setTermsRights(db, "granted");
  const mixed = await communityRights(db, "community_effect_evidence", applicationId, { now: APPLY, minSubmitters: 2, sourceApprovedInCode: true });
  assert.deepEqual(mixed, { eligible: false, termsVersion: null, blockers: ["noCommonConsent"] }, "granting the terms does not reach a report stored without consent");

  await applyReportRetention(s.reports, { now: new Date(minimizeAfter(RECEIVED).getTime() + 1000) });
  assert.equal(one(s.reports, "SELECT accepted_terms_version, note FROM reports WHERE report_id = ?", consented).accepted_terms_version, TERMS);
  assert.equal(one(s.reports, "SELECT note FROM reports WHERE report_id = ?", consented).note, null);
});

// =============================================================================================================
// 2. The rights gate on community publication
test("blocked source never publishes, even with consent and granted terms; the database refuses it too", async () => {
  const s = stores();
  const db = s.data;
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  const { spotId } = await communitySpot(s, { latitude: 35.71201, longitude: 139.77701 }, [HASHES[0], HASHES[1]], "C");
  setTermsRights(db, "granted");
  const report = await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(report.excluded.some((e) => e.sourceId === COMMUNITY_SOURCE_ID && e.publicationStatus === "blocked"));
  assert.equal(published(db, spotId), false);
  const tileId = one(db, "SELECT tile_id FROM spots WHERE spot_id = ?", spotId).tile_id;
  db.raw.prepare("INSERT OR IGNORE INTO tile_snapshots (tile_id, z, x, y, revision, schema_version, content_sha256, spot_count, body_json, published_at) VALUES (?, 15, 0, 0, 1, 1, ?, 0, '{}', 'x')")
    .run(tileId, "0".repeat(64));
  assert.throws(() => db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(spotId, tileId), /not publishable|community spot/);
  const quality = await analyzeCorpus(db, { now: isoSeconds(APPLY) });
  assert.deepEqual(quality.nationwide.community, { canonicalSpots: 1, withGrantedRights: 1, publishedSpots: 0, activePublicationHolds: 0 },
    "a blocked community spot counts 0 in published coverage");
  assert.ok(!quality.sources.publishedSourceIds.includes(COMMUNITY_SOURCE_ID));
});

test("approved simulation publishes; revoking the terms or the source removes it at the next publish", async () => {
  const s = stores();
  const db = s.data;
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  await publishTiles(db, { now: isoSeconds(RECEIVED) });
  const taito = one(db, `SELECT s.spot_id, s.latitude, s.longitude FROM tile_snapshot_spots t JOIN spots s ON s.spot_id = t.spot_id
    JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence' JOIN source_records r ON r.record_id = p.record_id
    JOIN source_releases rel ON rel.release_id = r.release_id WHERE rel.source_id = 'taito-public-smoking-areas' ORDER BY s.spot_id LIMIT 1`);
  const near = { latitude: Math.round((taito.latitude + 0.0002) * 1e5) / 1e5, longitude: taito.longitude };
  const { spotId } = await communitySpot(s, near, [HASHES[0], HASHES[1]], "C");
  approveSourceRow(db);
  setTermsRights(db, "granted");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), true);
  const detail = await (await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).json() as Row;
  assert.equal(detail.spot.evidenceQuality, "communityVerified", "labelled as reviewed community evidence, never as official");
  const quality = await analyzeCorpus(db, { now: isoSeconds(APPLY) });
  assert.deepEqual(quality.nationwide.community, { canonicalSpots: 1, withGrantedRights: 1, publishedSpots: 1, activePublicationHolds: 0 });
  assert.ok(quality.sources.publishedSourceIds.includes(COMMUNITY_SOURCE_ID));

  // Community + municipal: a cross-source candidate, never an automatic merge.
  await generateCrossSourceCandidates(db, { now: isoSeconds(APPLY) });
  assert.ok(one(db, "SELECT count(*) AS n FROM cross_source_candidates WHERE ? IN (spot_a_id, spot_b_id) AND ? IN (spot_a_id, spot_b_id)", spotId, taito.spot_id).n === 1);
  assert.equal(count(db, "cross_source_merge_applications"), 0);

  setTermsRights(db, "revoked");
  const revoked = await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), false, "revoked terms unpublish");
  assert.ok(revoked.excluded.some((e) => e.publicationStatus === "rightsNotGranted"));
  assert.equal((await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).status, 404);
  setTermsRights(db, "granted");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), true);
  db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(COMMUNITY_SOURCE_ID);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), false, "source rights revoked -> publication blocked");
  // The upgrade path puts the terms row back to the reviewed (pending) state.
  setTermsRights(db, "granted");
  await applyReportTermsRegistry(db, isoSeconds(APPLY));
  assert.equal(one(db, "SELECT publication_rights FROM report_terms_versions").publication_rights, "pending");
});

test("a community spot whose reports lack a common consent never publishes, even fully approved", async () => {
  const s = stores();
  const db = s.data;
  const legacyPair = await communitySpot(s, { latitude: 35.6, longitude: 139.6 }, [HASHES[0], HASHES[1]], "L", [null, null]);
  const mixedPair = await communitySpot(s, { latitude: 35.61, longitude: 139.61 }, [HASHES[2], HASHES[3]], "M", [TERMS, null]);
  for (const { releaseId } of [legacyPair, mixedPair]) {
    assert.equal(JSON.parse(one(db, "SELECT raw_values_json FROM source_records WHERE release_id = ?", releaseId).raw_values_json)[6], "");
  }
  approveSourceRow(db);
  setTermsRights(db, "granted");
  const report = await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(count(db, "tile_snapshot_spots"), 0);
  assert.ok(report.excluded.some((e) => e.sourceId === COMMUNITY_SOURCE_ID && e.publicationStatus === "rightsNotGranted" && e.spotCount === 2));
});

// =============================================================================================================
// 3. Promotion v3 with the additive community source
test("promotion v3 carries several additive community releases to a fresh database; nothing personal travels", async () => {
  const s = stores();
  const db = s.data;
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  await publishTiles(db, { now: isoSeconds(RECEIVED) });
  const municipalOnly = await buildMultiSourcePromotionBundle(db);

  const first = await communitySpot(s, { latitude: 35.71201, longitude: 139.77701 }, [HASHES[0], HASHES[1]], "C");
  const second = await communitySpot(s, { latitude: 34.70001, longitude: 135.50001 }, [HASHES[2], HASHES[3]], "D");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal((await buildMultiSourcePromotionBundle(db)).sql, municipalOnly.sql, "blocked: existing municipal promotion bytes are unchanged");
  await assert.rejects(buildMultiSourcePromotionBundle(db, { releaseIds: [first.releaseId] }), /is blocked|not approved in REVIEWED_SOURCES/);

  approveSourceRow(db);
  setTermsRights(db, "granted");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.ok(published(db, first.spotId) && published(db, second.spotId));
  // The reviewed lists in code still say blocked/pending: without the simulated registry the export refuses the published spots.
  await assert.rejects(buildMultiSourcePromotionBundle(db), /draw existence evidence from another release/);

  let statements = 0;
  const boundedDb: Db = {
    prepare(sql) {
      statements++;
      assert.ok((sql.match(/\?/g) ?? []).length <= 2, "release sets must not grow SQL bind counts");
      return db.prepare(sql);
    },
    batch: (queries) => db.batch(queries),
  };
  const bundle = await buildMultiSourcePromotionBundle(boundedDb, { registry: SIMULATED_REGISTRY });
  assert.ok(statements <= 25, `promotion must read tables as sets, got ${statements} statements`);
  const community = bundle.manifest.sources.find((s) => s.sourceId === COMMUNITY_SOURCE_ID)!;
  assert.deepEqual(community.additiveReleases!.map((r) => r.releaseId), [first.releaseId, second.releaseId].sort((a, b) => a - b));
  assert.equal(community.releaseId, Math.min(first.releaseId, second.releaseId), "the anchor is the lowest release");
  assert.equal(community.rows.source_releases, 2);
  assert.equal(bundle.manifest.rows.report_terms_versions, 1);
  for (const needle of [NOTE, OBSERVED, ...HASHES, "INSERT INTO reports", "INSERT INTO report_moderation", "community_reconciliation", "community_effect", "submitter",
    "community_artifact_ledger", "community_evidence_reports", "app_attest", "report_review"]) {
    assert.ok(!bundle.sql.includes(needle), `bundle carries ${needle}`);
  }

  const target = migratedSqlite();
  applyPromotionBundle(target, bundle.sql);
  const t = new SqliteD1(target);
  assert.equal(count(t, "promotion_multi_bootstrap_completions"), 1);
  assert.ok(published(t, first.spotId) && published(t, second.spotId), "community spots publish on the target");
  assert.deepEqual(all(t, "SELECT release_id, is_current, status FROM source_releases WHERE source_id = ? ORDER BY release_id", COMMUNITY_SOURCE_ID).map((r) => ({ ...r })),
    [first.releaseId, second.releaseId].sort((a, b) => a - b).map((id) => ({ release_id: id, is_current: 0, status: "applied" })));
  for (const table of ["reports", "report_moderation", "community_reconciliation_applications", "community_reconciliation_evidence", "community_effect_applications",
    "community_artifact_ledger", "community_evidence_reports"]) {
    assert.equal(count(t, table), 0, `${table} travelled`);
  }
  for (const tile of v1TileRows(t)) {
    for (const id of [...first.reportIds, ...second.reportIds, first.applicationId]) assert.ok(!tile.body_json.includes(id), "a tile names a report");
  }
  const onTarget = await (await app.request(`/v1/spots/${first.spotId}`, {}, { DB: t })).json() as Row;
  assert.equal(onTarget.spot.evidenceQuality, "communityVerified");

  // Fresh bootstrap: the bootstrapped database re-exports the identical bundle.
  assert.equal((await buildMultiSourcePromotionBundle(t, { registry: SIMULATED_REGISTRY })).sql, bundle.sql);
});

test("promotion v3 target refuses an additive bundle whose community release is dropped or whose terms row is missing", async () => {
  const s = stores();
  const db = s.data;
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  const first = await communitySpot(s, { latitude: 35.71201, longitude: 139.77701 }, [HASHES[0], HASHES[1]], "C");
  await communitySpot(s, { latitude: 34.70001, longitude: 135.50001 }, [HASHES[2], HASHES[3]], "D");
  approveSourceRow(db);
  setTermsRights(db, "granted");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  const { sql } = await buildMultiSourcePromotionBundle(db, { registry: SIMULATED_REGISTRY });

  const withoutRelease = sql.split("\n").filter((l) => !(l.startsWith("INSERT INTO promotion_multi_bootstrap_additive_releases") && l.includes(`(${first.releaseId},`))).join("\n");
  assert.throws(() => applyPromotionBundle(migratedSqlite(), withoutRelease), /declared release|declared, complete sources|anchor/);
  const withoutTerms = sql.split("\n").filter((l) => !l.startsWith("INSERT INTO report_terms_versions")).join("\n");
  assert.throws(() => applyPromotionBundle(migratedSqlite(), withoutTerms), /granted terms version/);
  const asCurrent = sql.replace(new RegExp(`(INSERT INTO source_releases \\(.*\\) VALUES \\(${first.releaseId}, .*'applied'), 0,`), "$1, 1,");
  assert.notEqual(asCurrent, sql);
  assert.throws(() => applyPromotionBundle(migratedSqlite(), asCurrent), /declared release/);
});

// =============================================================================================================
// 4. Existing-spot report effects (Issue #127)
async function effectsWorld() {
  const s = stores();
  const db = s.data;
  await importAllReviewedSources(db, isoSeconds(RECEIVED));
  await publishTiles(db, { now: isoSeconds(RECEIVED) });
  await ensureReviewedSource(db, COMMUNITY_SOURCE_ID, isoSeconds(RECEIVED));
  await applyReportTermsRegistry(db, isoSeconds(RECEIVED));
  return { s, db, spotId: publishedMunicipalSpot(db) };
}

const canonicalSnapshot = (db: SqliteD1) => JSON.stringify([
  all(db, "SELECT * FROM spots ORDER BY spot_id"), all(db, "SELECT * FROM spot_field_provenance ORDER BY spot_id, field"),
  all(db, "SELECT * FROM spot_field_attenuations ORDER BY spot_id, field"), all(db, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id"),
]);

test("every existing-spot report type maps to exactly one reviewed effect; apply records a candidate and mutates nothing", async () => {
  const { s, db, spotId } = await effectsWorld();
  const before = canonicalSnapshot(db);
  for (const [type, effect] of Object.entries(COMMUNITY_EFFECTS)) {
    const id = await spotReport(s.reports, HASHES[0], spotId, type);
    await acceptAndQueue(s.reports, id);
    const proposed = await proposeEffect(s, { reportIds: [id], decidedBy: "reviewer-1", now: APPLY });
    assert.equal(proposed.effect, effect, type);
    assert.match(proposed.applicationId, /^ce_[0-9A-HJKMNP-TV-Z]{26}$/);
    const applied = await applyCommunityEffect(db, proposed.applicationId, { now: APPLY });
    assert.deepEqual(applied, { status: "applied", effect, spotId });
    assert.deepEqual(await applyCommunityEffect(db, proposed.applicationId, { now: APPLY }), { status: "alreadyApplied", effect, spotId }, "repeated apply is idempotent");
    assert.equal(one(s.reports, "SELECT reconciliation_state FROM report_moderation WHERE report_id = ?", id).reconciliation_state, "applied");
  }
  assert.deepEqual(Object.fromEntries(Object.entries(COMMUNITY_EFFECTS)), {
    moved: "relocationReview", prohibited: "publicationHoldReview", hoursChanged: "hoursReview",
    accessChanged: "accessReview", tobaccoTypeChanged: "tobaccoTypeReview", exists: "existenceVerification",
  });
  assert.equal(canonicalSnapshot(db), before, "no effect application changes a canonical or published row");
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(canonicalSnapshot(db), before, "and the next publish is unchanged");
});

test("`other` cannot mutate anything: no application can be made from it, and the database refuses one", async () => {
  const { s, db, spotId } = await effectsWorld();
  const other = await spotReport(s.reports, HASHES[0], spotId, "other");
  await acceptAndQueue(s.reports, other);
  await assert.rejects(proposeEffectReview(s.reports, { reportIds: [other], decidedBy: "r", now: APPLY }), /no automatic effect/);
  assert.throws(() => db.raw.prepare(`INSERT INTO community_effect_applications (application_id, subject_spot_id, report_type, effect, effect_version, decided_by, decided_at, state)
    VALUES (?, ?, 'other', 'publicationHoldReview', 'community-effects.v1', 'r', 'x', 'proposed')`).run("ce_" + "0".repeat(26), spotId), /CHECK|only by importing/);
  // REPORTS_DB refuses an `other` effect review at the schema level too.
  assert.throws(() => s.reports.raw.prepare(`INSERT INTO report_reviews (review_id, review_kind, review_key, decision_version, rule_version, subject_spot_id, report_type, decided_by, decided_at, state)
    VALUES (?, 'effect', 'k', 1, 'community-effects.v1', ?, 'other', 'r', 'x', 'proposed')`).run("ce_" + "0".repeat(26), spotId), /CHECK/);
  assert.throws(() => db.raw.prepare(`INSERT INTO community_effect_applications (application_id, subject_spot_id, report_type, effect, effect_version, decided_by, decided_at, state)
    VALUES (?, ?, 'hoursChanged', 'publicationHoldReview', 'community-effects.v1', 'r', 'x', 'proposed')`).run("ce_" + "0".repeat(26), spotId), /CHECK|only by importing/,
    "a type cannot be given another type's effect");
  // Mixed types, mixed spots, unqueued and new-spot reports are refused.
  const hours = await spotReport(s.reports, HASHES[1], spotId, "hoursChanged");
  const elsewhere = await spotReport(s.reports, HASHES[2], "sp_01V64NN31G72E5KJJ5W22W1A1J", "hoursChanged");
  const unqueued = await spotReport(s.reports, HASHES[3], spotId, "hoursChanged");
  await acceptAndQueue(s.reports, hours, elsewhere);
  await assert.rejects(proposeEffectReview(s.reports, { reportIds: [hours, other], decidedBy: "r", now: APPLY }), /same type/);
  await assert.rejects(proposeEffectReview(s.reports, { reportIds: [hours, elsewhere], decidedBy: "r", now: APPLY }), /same spot/);
  await assert.rejects(proposeEffectReview(s.reports, { reportIds: [hours, unqueued], decidedBy: "r", now: APPLY }), /is pending, not accepted/);
  // The report store cannot know whether a spot is live: the opaque reference is checked by the canonical import,
  // which refuses it and writes nothing (ADR-0014 §4).
  const { reviewId } = await proposeEffectReview(s.reports, { reportIds: [elsewhere], decidedBy: "r", now: APPLY });
  const { artifact } = await exportReview(s.reports, reviewId, { now: APPLY });
  assert.deepEqual(((await importCommunityArtifact(db, artifact.bytes, { now: APPLY })) as Row).reason, "spotNotLive");
  assert.equal(count(db, "community_effect_applications"), 0);
  assert.equal(count(db, "community_artifact_ledger"), 0);
});

test("moved creates a relocation review candidate and prohibited a hold candidate; neither holds or moves anything by itself", async () => {
  const { s, db, spotId } = await effectsWorld();
  const before = canonicalSnapshot(db);
  const moved = await spotReport(s.reports, HASHES[0], spotId, "moved");
  const p1 = await spotReport(s.reports, HASHES[1], spotId, "prohibited");
  const p2 = await spotReport(s.reports, HASHES[2], spotId, "prohibited");
  await acceptAndQueue(s.reports, moved, p1, p2);
  const relocation = await proposeEffect(s, { reportIds: [moved], decidedBy: "r", now: APPLY });
  assert.equal(relocation.effect, "relocationReview");
  await applyCommunityEffect(db, relocation.applicationId, { now: APPLY });
  await assert.rejects(holdCommunityEffect(db, relocation.applicationId, { now: APPLY }), /not an applied publicationHoldReview/);

  const hold = await proposeEffect(s, { reportIds: [p1, p2], decidedBy: "r", now: APPLY });
  assert.equal(hold.effect, "publicationHoldReview");
  await assert.rejects(holdCommunityEffect(db, hold.applicationId, { now: APPLY }), /not an applied publicationHoldReview/, "proposed is not applied");
  await applyCommunityEffect(db, hold.applicationId, { now: APPLY });

  // Blocked (Issue #124): fail closed, nothing written, and the database refuses the same hold.
  const blocked = await holdCommunityEffect(db, hold.applicationId, { now: APPLY });
  assert.deepEqual(blocked, { status: "blocked", spotId, blockers: ["sourceNotApproved", "termsNotGranted"] });
  assert.equal(canonicalSnapshot(db), before);
  db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(spotId);
  assert.throws(() => db.raw.prepare("INSERT INTO community_publication_holds (application_id, spot_id, executor_version, terms_version, held_at) VALUES (?, ?, 'community-hold.v1', ?, ?)")
    .run(hold.applicationId, spotId, TERMS, isoSeconds(APPLY)), /community publication rights do not hold/);
});

test("approved simulation: a prohibited hold withholds the spot, is idempotent, and a reviewed lift republishes it", async () => {
  const { s, db, spotId } = await effectsWorld();
  const p1 = await spotReport(s.reports, HASHES[1], spotId, "prohibited");
  const p2 = await spotReport(s.reports, HASHES[2], spotId, "prohibited");
  await acceptAndQueue(s.reports, p1, p2);
  const { applicationId } = await proposeEffect(s, { reportIds: [p1, p2], decidedBy: "r", now: APPLY });
  await applyCommunityEffect(db, applicationId, { now: APPLY });
  approveSourceRow(db);
  setTermsRights(db, "granted");
  assert.deepEqual((await holdCommunityEffect(db, applicationId, { now: APPLY })).status, "blocked", "the reviewed registry in code still says blocked");

  const held = await holdCommunityEffect(db, applicationId, { now: APPLY, sourceApprovedInCode: true });
  assert.equal(held.status, "held");
  assert.equal(published(db, spotId), false);
  assert.deepEqual(await holdCommunityEffect(db, applicationId, { now: APPLY, sourceApprovedInCode: true }), { status: "alreadyHeld", spotId });
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), false, "publish keeps a held spot out");
  assert.equal((await app.request(`/v1/spots/${spotId}`, {}, { DB: db })).status, 404);
  assert.ok(!v1TileRows(db).some((t) => t.body_json.includes(spotId)));
  assert.equal(one(db, "SELECT lifecycle, publication_hold FROM spots WHERE spot_id = ?", spotId).lifecycle, "active", "no canonical column changes");
  assert.deepEqual((await analyzeCorpus(db, { now: isoSeconds(APPLY) })).nationwide.community.activePublicationHolds, 1);

  const tileId = one(db, "SELECT tile_id FROM spots WHERE spot_id = ?", spotId).tile_id;
  assert.throws(() => db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(spotId, tileId), /held by a reviewed community report effect/);
  assert.throws(() => db.raw.prepare("DELETE FROM community_publication_holds").run(), /never deleted/);

  await liftCommunityHold(db, applicationId, { liftedBy: "reviewer-2", now: APPLY });
  await assert.rejects(liftCommunityHold(db, applicationId, { liftedBy: "reviewer-2", now: APPLY }), /no active hold/);
  await assert.rejects(holdCommunityEffect(db, applicationId, { now: APPLY, sourceApprovedInCode: true }), /lifted hold is not re-applied/);
  await publishTiles(db, { now: isoSeconds(APPLY) });
  assert.equal(published(db, spotId), true);
});

test("stale, redacted, legacy or single-submitter evidence fails closed for a hold", async () => {
  const { s, db, spotId } = await effectsWorld();
  approveSourceRow(db);
  setTermsRights(db, "granted");
  const make = async (hashes: string[], consent: string | null = TERMS) => {
    const ids = [];
    for (const h of hashes) ids.push(await spotReport(s.reports, h, spotId, "prohibited", consent));
    await acceptAndQueue(s.reports, ...ids);
    const { applicationId } = await proposeEffect(s, { reportIds: ids, decidedBy: "r", now: APPLY });
    await applyCommunityEffect(db, applicationId, { now: APPLY });
    return applicationId;
  };
  const single = await make([HASHES[0]]);
  assert.deepEqual((await holdCommunityEffect(db, single, { now: APPLY, sourceApprovedInCode: true })) as Row,
    { status: "blocked", spotId, blockers: ["tooFewIndependentSubmitters"] });
  const legacy = await make([HASHES[1], HASHES[2]], null);
  assert.deepEqual(((await holdCommunityEffect(db, legacy, { now: APPLY, sourceApprovedInCode: true })) as Row).blockers, ["noCommonConsent"]);
  const fresh = await make([HASHES[3], "5".repeat(64)]);
  const late = new Date(minimizeAfter(RECEIVED).getTime() + 1000);
  assert.deepEqual(((await holdCommunityEffect(db, fresh, { now: late, sourceApprovedInCode: true })) as Row).blockers, ["staleOrRedacted"]);
  // Minimization in REPORTS_DB does not reach back into the imported, sanitized evidence: freshness is its usable day.
  const evidence = JSON.stringify(all(db, "SELECT * FROM community_evidence_reports ORDER BY report_id"));
  await applyReportRetention(s.reports, { now: late });
  assert.equal(JSON.stringify(all(db, "SELECT * FROM community_evidence_reports ORDER BY report_id")), evidence);
  assert.equal(count(db, "community_publication_holds"), 0);
  assert.equal(published(db, spotId), true);

  // Apply itself also fails closed on a stale or redacted report, and the database re-checks inside the batch.
  const r1 = await spotReport(s.reports, "6".repeat(64), spotId, "hoursChanged");
  await acceptAndQueue(s.reports, r1);
  const { applicationId } = await proposeEffect(s, { reportIds: [r1], decidedBy: "r", now: APPLY });
  await assert.rejects(applyCommunityEffect(db, applicationId, { now: late }), /past its minimization deadline|redacted/);
  assert.throws(() => db.raw.prepare("UPDATE community_effect_applications SET state = 'applied', applied_at = ? WHERE application_id = ?")
    .run(isoSeconds(late), applicationId), /no longer accepted, queued and unredacted/);
  await withdrawCommunityEffect(db, applicationId, { now: APPLY });
  await assert.rejects(applyCommunityEffect(db, applicationId, { now: APPLY }), /was withdrawn/);
  await assert.rejects(proposeEffectReview(s.reports, { reportIds: [r1], decidedBy: "r", now: APPLY }), /is applied, not queued/);
  assert.ok(new CommunityEffectError("x") instanceof Error);
});

test("the effects queue shows counts, submitters, rights, staleness and target effect, never personal content", async () => {
  const { s, db, spotId } = await effectsWorld();
  const a = await spotReport(s.reports, HASHES[0], spotId, "prohibited");
  const b = await spotReport(s.reports, HASHES[1], spotId, "prohibited");
  const c = await spotReport(s.reports, HASHES[1], spotId, "prohibited");
  await acceptAndQueue(s.reports, a, b, c);
  // REPORTS_DB: what a reviewer could decide next.
  const queue = await listExistingSpotQueue(s.reports, { now: APPLY });
  assert.deepEqual(queue, [{ spotId, reportType: "prohibited", finding: null, cursor: `${spotId}/prohibited/`, effect: "publicationHoldReview", reportCount: 3,
    independentSubmitters: 2, redactedOrStale: 0, commonTermsVersion: TERMS }], "two reports of one submitter count once");
  assert.doesNotMatch(JSON.stringify(queue), new RegExp(`${NOTE}|${OBSERVED}|${HASHES[0]}|${HASHES[1]}`));
  const { applicationId } = await proposeEffect(s, { reportIds: [a, b], decidedBy: "r", now: APPLY });
  assert.deepEqual((await listExistingSpotQueue(s.reports, { now: APPLY })).map((r) => r.reportCount), [1]);
  // DATA_DB: the imported application, its attested independence and the rights blockers.
  const rows = await listCommunityEffects(db, { now: APPLY });
  assert.deepEqual({ ...rows[0], rights: undefined }, {
    applicationId, spotId, reportType: "prohibited", effect: "publicationHoldReview", state: "proposed",
    reportCount: 2, independentSubmitters: 2, redactedOrStale: 0, rights: undefined, hold: "none",
  });
  assert.deepEqual(rows[0].rights.blockers, ["sourceNotApproved", "termsNotGranted"]);
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(`${NOTE}|${OBSERVED}|${HASHES[0]}|${HASHES[1]}`));
  const summary = await moderationPipelineSummary(s.reports, db);
  assert.deepEqual(summary, { reports: { "accepted/applied": 2, "accepted/queued": 1 }, reviews: { "effect/exported": 1 }, importedArtifacts: 1,
    newSpotApplications: {}, effectApplications: { "publicationHoldReview/proposed": 1 }, activeCommunityHolds: 0, absenceApplications: {}, activeAbsenceHolds: 0 });
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(`${NOTE}|${HASHES[0]}|rp_`));
});
