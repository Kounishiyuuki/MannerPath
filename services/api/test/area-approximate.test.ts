// ADR-0017: approximate area locations. Existence evidence + a reviewed anchor of the SAME publication publishes as
// areaApproximate; a host alone, a missing or foreign anchor, or missing existence evidence never does. Leaving
// areaApproximate needs exact-point evidence and a reviewed identity, and a moved point goes through ADR-0009. Every
// table is append-only (REPLACE included), and the public reads share one bidirectional location invariant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import {
  AREA_ANCHOR_POLICY_VERSION, type AreaApproximateCandidate, anchoredObservation, applyAreaPrecisionUpgrade, evaluateAreaApproximate,
  planAreaPrecisionUpgrade, recordAreaAnchor, validateAreaAnchor,
} from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { applyReviewedRelocation } from "../src/pipeline/relocation-application.ts";
import { holdRelocationCandidate } from "../src/pipeline/relocation-hold.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { TileSpotV1 } from "../src/tiles/dto.ts";
import { locationState } from "../src/tiles/location-state.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { gzipSync } from "node:zlib";
import { NOW } from "./support/fixture.ts";
import { SqliteD1, withoutTrigger } from "./support/sqlite-d1.ts";
import {
  MOVED, PARK, RELEASE_A, addSource, anchorDef, areaAdapter, areaPipeline, csv, decideIdentity, meta, nextRelease, releaseSha,
  spotByName,
} from "./support/area.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row | undefined;
const count = (db: SqliteD1, table: string) => (one(db, `SELECT count(*) n FROM ${table}`)!.n as number);

async function published(db: SqliteD1): Promise<TileSpotV1[]> {
  await publishTiles(db, { now: "2026-10-20T00:00:00Z" });
  // Code-point order by id: locale-independent (a locale-aware compare orders Japanese names differently under ja_JP).
  return (await readPublishedTiles(db)).flatMap((t) => t.spots).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
const byName = (spots: TileSpotV1[], name: string) => spots.find((s) => s.name === name);
const detail = async (db: SqliteD1, id: string) => app.request(`/v1/spots/${id}`, {}, { DB: db });

// ---------------------------------------------------------------------------------------------------------------
// Publication

test("official evidence + an anchor of the same publication publishes as areaApproximate; exact spots are unchanged", async () => {
  const { db } = await areaPipeline();
  const spots = await published(db);
  assert.deepEqual(new Set(spots.map((s) => s.name)), new Set(["公園内喫煙所", "駅前喫煙所"]));
  const approx = byName(spots, "公園内喫煙所")!;
  assert.deepEqual([approx.latitude, approx.longitude], [PARK.latitude, PARK.longitude]);
  assert.equal(approx.verification.existence, "official");
  assert.equal(approx.verification.locationPrecision, "areaApproximate");
  assert.deepEqual(approx.verification.locationArea, { name: PARK.areaName, kind: "park" });
  const exact = byName(spots, "駅前喫煙所")!;
  assert.equal(exact.verification.locationPrecision, "publisherPoint");
  assert.equal("locationArea" in exact.verification, false, "an exact spot's bytes are unchanged");
  // Provenance is traceable: binding -> anchor -> its publication (release digest, row values), review and policy.
  const a = one(db, `SELECT a.*, b.record_release_content_sha256 FROM spot_location_anchors b JOIN area_location_anchors a USING (anchor_id) WHERE b.spot_id = ?`, approx.id)!;
  assert.equal(a.origin_release_content_sha256, await releaseSha(RELEASE_A));
  assert.equal(a.record_release_content_sha256, a.origin_release_content_sha256, "binding and anchor are one publication");
  assert.deepEqual(JSON.parse(a.origin_record_values_json), ["P1", PARK.areaName, "", String(PARK.latitude), String(PARK.longitude), "area"]);
  assert.deepEqual([a.reuse_basis, a.policy_version, a.reviewed_by], ["sameReviewedPublication", AREA_ANCHOR_POLICY_VERSION, "maintainer"]);
  const res = await detail(db, approx.id);
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { spot: TileSpotV1 }).spot.verification, approx.verification);
  const quality = await analyzeCorpus(db, { now: NOW, gzip: (b) => gzipSync(b).length, adapters: [] });
  assert.equal(quality.checks.find((c) => c.id === "area-anchor-never-exact")?.status, "pass");
});

test("operator evidence + an anchor of the same publication publishes as areaApproximate", async () => {
  const { db } = await areaPipeline({ kind: "operator" });
  const approx = byName(await published(db), "公園内喫煙所")!;
  assert.equal(approx.verification.existence, "operator");
  assert.equal(approx.verification.locationPrecision, "areaApproximate");
});

test("a missing exact point alone does not reject; a missing anchor withholds without discarding evidence", async () => {
  const base: AreaApproximateCandidate = { sourcePublication: "approved", existenceEvidence: "smokingPlaceStated", conflict: "none", exactPoint: "absent", area: "named", anchor: "reviewed" };
  assert.equal(evaluateAreaApproximate(base).verdict, "areaApproximate");
  assert.deepEqual(evaluateAreaApproximate({ ...base, anchor: "missing" }).rejections, ["noReviewedAnchor"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, area: "notNamed" }).rejections, ["areaNotNamed"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, anchor: "forbiddenOrigin" }).rejections, ["forbiddenAnchorOrigin"]);
  const { db } = await areaPipeline();
  assert.equal((await published(db)).some((s) => s.name === "不明公園喫煙所"), false);
  assert.ok(one(db, "SELECT 1 FROM source_records WHERE raw_values_json LIKE '%不明公園喫煙所%'"), "the raw evidence is kept");
});

test("host-only, no-existence, closed, prohibited and conflicting records are rejected; an anchor never supplies existence", async () => {
  const base: AreaApproximateCandidate = { sourcePublication: "approved", existenceEvidence: "hostOnly", conflict: "none", exactPoint: "present", area: "named", anchor: "reviewed" };
  assert.deepEqual(evaluateAreaApproximate(base).rejections, ["hostOnly"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, existenceEvidence: "none", exactPoint: "absent" }).rejections, ["noExistenceEvidence"]);
  assert.deepEqual(evaluateAreaApproximate({ ...base, existenceEvidence: "smokingPlaceStated", sourcePublication: "notApproved" }).rejections, ["sourceNotApproved"]);
  const ok = { ...base, existenceEvidence: "smokingPlaceStated" as const, exactPoint: "absent" as const };
  assert.deepEqual(evaluateAreaApproximate({ ...ok, conflict: "closed" }).rejections, ["closedOrProhibited"]);
  assert.deepEqual(evaluateAreaApproximate({ ...ok, conflict: "prohibited" }).rejections, ["closedOrProhibited"]);
  assert.deepEqual(evaluateAreaApproximate({ ...ok, conflict: "conflictingPublications" }).rejections, ["conflictingEvidence"]);
  assert.throws(() => anchoredObservation({
    name: "x", supportsPaper: "unknown", supportsHeated: "unknown", openingHours: { status: "none", raw: null, parsed: null },
    lifecycle: "active", provenance: [],
  }, PARK, ["area"]), /existence evidence/);
  const { db } = await areaPipeline();
  const names = (await published(db)).map((s) => s.name);
  for (const n of ["上野駅", "閉鎖喫煙所", PARK.areaName]) assert.equal(names.includes(n), false, `${n} is not a spot`);
});

// ---------------------------------------------------------------------------------------------------------------
// P1-3: the anchor is bound to the existence evidence's own publication

test("an anchor must be stated by its publication: unrecorded, typed, foreign-source or other-release anchors fail closed", async () => {
  const unrecorded = await areaPipeline({ recordAnchor: false });
  await assert.rejects(unrecorded.resolve, /area anchor aa_ueno is not recorded/);
  assert.equal(count(unrecorded.db, "spots"), 0, "nothing canonical is written");

  // A coordinate the publication does not state (a typed or guessed pin) is refused.
  const typed = await areaPipeline({ recordAnchor: false, resolve: false });
  await assert.rejects(() => recordAreaAnchor(typed.db, typed.adapter, { ...typed.anchor, latitude: 35.7 }, NOW), /does not state this area point/);
  await assert.rejects(() => recordAreaAnchor(typed.db, typed.adapter, { ...typed.anchor, originUpstreamRowRef: "1" }, NOW), /does not state this area point/);
  await assert.rejects(() => recordAreaAnchor(typed.db, typed.adapter, { ...typed.anchor, originReleaseContentSha256: "0".repeat(64) }, NOW), /is not in this database/);

  // parks.csv (another dataset = another source) supplying the anchor for list.csv's existence: refused in code and DB.
  const parks = areaAdapter("test-area-parks");
  addSource(typed.db, parks);
  await ingestRelease(typed.db, parks, csv(["park"]), meta("2026-09-29"));
  const parksAnchor = anchorDef("test-area-parks", await releaseSha(["park"]), { anchorId: "aa_parks" });
  await recordAreaAnchor(typed.db, parks, parksAnchor, NOW);
  const listUsingParks = areaAdapter("test-area-city", "municipal", [{ ...PARK, anchorId: "aa_parks" }]);
  const { releaseId } = await ingestRelease(typed.db, listUsingParks, csv(["anchored"]), meta("2026-10-01"));
  await assert.rejects(() => resolveFirstRelease(typed.db, listUsingParks, releaseId, { now: NOW }), /is not from source test-area-city/);
  await assert.rejects(() => recordAreaAnchor(typed.db, listUsingParks, { ...parksAnchor, anchorId: "aa_x" }, NOW), /adapter is test-area-city/);

  // Same source, another release (another file): the anchor of release A cannot pin a NEW spot of release B.
  const { db, adapter } = await areaPipeline();
  await assert.rejects(() => nextRelease(db, adapter, ["anchored", "exact", "newInPark"], "2026-10-10"), /another publication than record/);
  assert.equal(count(db, "spot_location_anchors"), 1, "no binding across publications");
  // DB, independently of the code check: a binding across publications is refused.
  const spot = spotByName(db, "公園内喫煙所");
  assert.throws(() => db.raw.prepare(`INSERT INTO spot_location_anchors (spot_id, anchor_id, record_id, record_release_content_sha256, resolver_version, bound_at)
    VALUES (?, 'aa_ueno', 1, ?, 'x', ?)`).run(spot.spot_id, "f".repeat(64), NOW), /immutable|same release/);
  // Defence in depth: map vendors and OSM are refused by reference as well.
  for (const origin of ["https://www.google.com/maps/place/x", "https://maps.apple.com/?ll=35,139", "https://www.openstreetmap.org/node/1", "screenshot of a map"]) {
    assert.deepEqual(validateAreaAnchor(anchorDef("test-area-city", "a".repeat(64), { originReference: origin })), ["forbiddenOrigin"]);
  }
  assert.deepEqual(validateAreaAnchor(anchorDef("test-area-city", "a".repeat(64), { reuseBasis: "existenceSourceLicense" as never })), ["reuseBasisNotReviewed"]);
});

test("an anchor cannot be recorded from an unapproved source or for a record outside its cited publication", async () => {
  const { db, sourceId } = await areaPipeline();
  const row = one(db, "SELECT * FROM area_location_anchors")!;
  const insert = (o: Row) => db.raw.prepare(`INSERT INTO area_location_anchors (${Object.keys(o).join(", ")}) VALUES (${Object.keys(o).map(() => "?").join(", ")})`).run(...Object.values(o));
  const fresh = { ...row, anchor_id: "aa_two", evidence_sha256: "b".repeat(64) };
  assert.throws(() => insert({ ...fresh, origin_record_values_json: '["P1","偽の公園","","35","139","area"]' }), /its own reviewed publication/);
  assert.throws(() => insert({ ...fresh, origin_release_content_sha256: "c".repeat(64) }), /its own reviewed publication/);
  assert.throws(() => insert({ ...fresh, origin_record_id: 2 }), /its own reviewed publication/);
  db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(sourceId);
  assert.throws(() => insert(fresh), /approved \(rights-reviewed\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// P1-1: append-only, REPLACE included (recursive_triggers OFF: REPLACE's implicit DELETE fires no DELETE trigger)

test("INSERT OR REPLACE cannot rewrite an anchor, a binding or an upgrade, with recursive triggers off", async () => {
  const { db } = await areaPipeline();
  db.raw.exec("PRAGMA recursive_triggers = OFF");
  const spot = spotByName(db, "公園内喫煙所");
  const anchor = one(db, "SELECT * FROM area_location_anchors")!;
  const binding = one(db, "SELECT * FROM spot_location_anchors")!;
  const replace = (table: string, o: Row) => db.raw.prepare(`INSERT OR REPLACE INTO ${table} (${Object.keys(o).join(", ")}) VALUES (${Object.keys(o).map(() => "?").join(", ")})`).run(...Object.values(o));
  assert.throws(() => replace("area_location_anchors", { ...anchor, latitude: 35.7 }), /immutable/, "same primary key");
  assert.throws(() => replace("area_location_anchors", { ...anchor, anchor_id: "aa_other" }), /immutable/, "same unique evidence digest");
  assert.throws(() => replace("spot_location_anchors", { ...binding, bound_at: "2026-10-30T00:00:00Z" }), /immutable/, "active binding");
  assert.throws(() => replace("spot_location_anchors", { ...binding, anchor_id: anchor.anchor_id, record_id: 999 }), /immutable|same release/);
  assert.throws(() => db.raw.prepare("REPLACE INTO spot_location_anchors SELECT * FROM spot_location_anchors").run(), /immutable/);
  assert.throws(() => db.raw.prepare("UPDATE spot_location_anchors SET bound_at = 'x'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM spot_location_anchors").run(), /immutable/);
  assert.throws(() => db.raw.prepare("UPDATE area_location_anchors SET latitude = 35").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM area_location_anchors").run(), /immutable/);
  // Coordinate mismatch by REPLACE of the spot's pin: refused by the anchored-pin guard and ADR-0009's.
  assert.throws(() => db.raw.prepare("UPDATE spots SET latitude = ? WHERE spot_id = ?").run(35.7, spot.spot_id), /area-anchored spot|reviewed relocation application/);
  assert.deepEqual(one(db, "SELECT * FROM area_location_anchors"), anchor);
  assert.deepEqual(one(db, "SELECT * FROM spot_location_anchors"), binding);
});

// ---------------------------------------------------------------------------------------------------------------
// P1-4: one bidirectional invariant for tile and detail

test("tampered location state is never published or served (tile and detail share one invariant)", async () => {
  const scenarios: [string, (db: SqliteD1, spotId: string) => void][] = [
    ["location provenance deleted", (db, id) => db.raw.prepare("DELETE FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'").run(id)],
    ["provenance names another anchor", (db, id) => withoutTrigger(db.raw, "spot_field_provenance_area_anchor_update",
      () => db.raw.prepare("UPDATE spot_field_provenance SET rule = 'area-anchor.v1:aa_other' WHERE spot_id = ? AND field = 'location'").run(id))],
    ["non-anchor rule with an active binding", (db, id) => withoutTrigger(db.raw, "spot_field_provenance_area_anchor_update",
      () => db.raw.prepare("UPDATE spot_field_provenance SET rule = 'test.point.v1' WHERE spot_id = ? AND field = 'location'").run(id))],
    ["coordinate is not the anchor", (db, id) => withoutTrigger(db.raw, "spots_anchored_coordinate_fixed", () => withoutTrigger(db.raw,
      "spots_coordinate_requires_relocation_application", () => withoutTrigger(db.raw, "spots_published_stay_publishable",
        () => db.raw.prepare("UPDATE spots SET latitude = 35.71551 WHERE spot_id = ?").run(id))))],
    ["binding outside the anchor's publication", (db, id) => {
      const b = one(db, "SELECT * FROM spot_location_anchors WHERE spot_id = ?", id)!;
      withoutTrigger(db.raw, "spot_location_anchors_no_delete", () => db.raw.prepare("DELETE FROM spot_location_anchors WHERE spot_id = ?").run(id));
      withoutTrigger(db.raw, "spot_location_anchors_same_publication", () => db.raw.prepare(
        "INSERT INTO spot_location_anchors (spot_id, anchor_id, record_id, record_release_content_sha256, resolver_version, bound_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, b.anchor_id, b.record_id, "e".repeat(64), b.resolver_version, b.bound_at));
    }],
    ["binding removed (anchor rule without binding)", (db, id) => withoutTrigger(db.raw, "spot_location_anchors_no_delete",
      () => db.raw.prepare("DELETE FROM spot_location_anchors WHERE spot_id = ?").run(id))],
  ];
  for (const [name, tamper] of scenarios) {
    const { db } = await areaPipeline();
    const id = spotByName(db, "公園内喫煙所").spot_id as string;
    await published(db);
    db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(id);
    tamper(db, id);
    const spots = await published(db);
    assert.equal(spots.some((s) => s.id === id), false, `${name}: not published`);
    assert.equal(spots.some((s) => s.name === "駅前喫煙所"), true, `${name}: the rest still publishes`);
    db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) SELECT spot_id, tile_id FROM spots WHERE spot_id = ?").run(id);
    assert.equal((await detail(db, id)).status, 404, `${name}: not served`);
  }
  // The decision itself, both directions.
  const base = { latitude: 1, longitude: 2, location_rule: "area-anchor.v1:aa_x", location_source_id: "s", lb_anchor_id: "aa_x", lb_release_sha256: "r",
    la_anchor_id: "aa_x", la_source_id: "s", la_latitude: 1, la_longitude: 2, la_area_name: "公園", la_area_kind: "park", la_release_sha256: "r" };
  assert.equal(locationState(base).kind, "areaApproximate");
  assert.equal(locationState({ ...base, lu_anchor_id: "aa_x", lu_precision: "publisherPoint", lu_source_id: "s", lu_rule: "test.point.v1", lu_latitude: 1, lu_longitude: 2 }).kind, "invalid", "an upgrade without its exact evidence");
  assert.equal(locationState({ ...base, location_rule: "test.point.v1", lu_anchor_id: "aa_x", lu_precision: "publisherPoint", lu_source_id: "s", lu_rule: "test.point.v1", lu_latitude: 1, lu_longitude: 2 }).kind, "upgraded");
  assert.equal(locationState({ ...base, lb_anchor_id: null, la_anchor_id: null }).kind, "invalid", "an anchor rule without a binding");
  assert.equal(locationState({ ...base, la_source_id: "other" }).kind, "invalid", "location evidence from another source");
});

// ---------------------------------------------------------------------------------------------------------------
// P1-2 / Q1: leaving areaApproximate needs exact-point evidence, a reviewed identity, and the upgrade row decides

test("same-coordinate upgrade: exact-point evidence + reviewed identity; spot ID kept; final state comes from the upgrade", async () => {
  const { db, adapter } = await areaPipeline();
  const before = byName(await published(db), "公園内喫煙所")!;
  // No evidence at all: a raw upgrade naming the anchored observation itself (an anchor "relabelled exact") is refused.
  const anchoredObs = one(db, "SELECT * FROM source_observations WHERE claims_json LIKE '%aa_ueno%'")!;
  const shaA = await releaseSha(RELEASE_A);
  assert.throws(() => db.raw.prepare(`INSERT INTO area_precision_upgrades (spot_id, anchor_id, upgrade_kind, target_precision, area_premise,
    evidence_source_id, evidence_release_id, evidence_release_content_sha256, evidence_record_id, evidence_observation_id, evidence_mapping_version,
    evidence_location_rule, evidence_location_columns_json, old_latitude, old_longitude, new_latitude, new_longitude, identity_review_item_id,
    identity_review_decision_id, reviewed_by, policy_version, executor_version, applied_at)
    VALUES (?, 'aa_ueno', 'sameCoordinate', 'publisherPoint', 'insideArea', 'test-area-city', 1, ?, ?, ?, 'test-area.map.v1', 'test.point.v1', '["lat","lon"]',
      ?, ?, ?, ?, 1, 1, 'r', 'area-precision-upgrade.v1', 'area-precision-upgrade-application.v1', ?)`)
    .run(before.id, shaA, anchoredObs.record_id, anchoredObs.observation_id, PARK.latitude, PARK.longitude, PARK.latitude, PARK.longitude, NOW),
    /area_precision_upgrades: (no exact-point observation|not the current|the exact evidence is not|the evidence release is not pending)/);

  const b = await nextRelease(db, adapter, ["exactAtAnchor", "exact"], "2026-10-10");
  assert.equal(b.first.status, "needsReview");
  const itemId = (b.first as { reviewItemIds: number[] }).reviewItemIds[0];
  const evidence = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '1'", b.releaseId)!.record_id as number;
  const input = { spotId: before.id, evidenceRecordId: evidence, identityReviewItemId: itemId, targetPrecision: "publisherPoint" as const,
    areaPremise: "insideArea" as const, reviewedBy: "reviewer", now: "2026-10-12T00:00:00Z" };
  // Identity not decided yet: refused by the DB premise.
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, input), /reviewed entity|identity decision/);
  await decideIdentity(db, itemId, before.id);
  // v1 fails closed on a community pin, a reviewedDerived target and an outside/unknown area premise (Q2).
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, { ...input, targetPrecision: "communityPinned" }), /communityPinNotSupportedV1/);
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, { ...input, targetPrecision: "reviewedDerived" }), /reviewedDerivedNotApproved/);
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, { ...input, areaPremise: "outsideArea" }), /outsideAreaNotSupportedV1/);
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, { ...input, areaPremise: "unknown" }), /outsideAreaNotSupportedV1/);
  // Resolving before the upgrade is refused: a match may not change values on its own.
  await assert.rejects(() => b.resolve(), /changed values/);
  assert.deepEqual(await applyAreaPrecisionUpgrade(db, adapter, input), { status: "applied", spotId: before.id, kind: "sameCoordinate" });
  assert.deepEqual(await applyAreaPrecisionUpgrade(db, adapter, input), { status: "alreadyApplied", spotId: before.id });
  // Between the upgrade and the release, the anchor provenance no longer matches the authority: not published.
  assert.equal((await published(db)).some((s) => s.id === before.id), false);
  assert.equal((await b.resolve("2026-10-13T00:00:00Z")).status, "resolved");
  const after = byName(await published(db), "公園内喫煙所")!;
  assert.equal(after.id, before.id, "stable spot ID");
  assert.deepEqual([after.latitude, after.longitude], [before.latitude, before.longitude]);
  assert.equal(after.verification.locationPrecision, "publisherPoint");
  assert.equal("locationArea" in after.verification, false);
  const loc = one(db, "SELECT * FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'", before.id)!;
  assert.deepEqual([loc.record_id, loc.rule], [evidence, "test.point.v1"]);
  assert.equal(count(db, "spot_location_anchors"), 1, "the anchor history stays");
  assert.throws(() => db.raw.prepare("DELETE FROM area_precision_upgrades").run(), /immutable/);
});

test("moved upgrade: exact evidence + ADR-0009 relocation in one batch; no shortcut moves an anchored pin", async () => {
  const { db, adapter } = await areaPipeline();
  const spot = byName(await published(db), "公園内喫煙所")!;
  const b = await nextRelease(db, adapter, ["exactMoved", "exact"], "2026-10-10");
  const identityItem = (b.first as { reviewItemIds: number[] }).reviewItemIds[0];
  await decideIdentity(db, identityItem, spot.id);
  const second = await b.resolve();
  assert.equal(second.status, "needsReview", "the moved point is a relocation candidate");
  const item = one(db, "SELECT * FROM review_items WHERE kind = 'relocationCandidate'")!;
  assert.deepEqual(JSON.parse(item.details_json).otherChangedFields.sort(), ["locationAnchorId", "provenance"]);
  const evidence = item.record_id as number;
  const input = { spotId: spot.id, evidenceRecordId: evidence, identityReviewItemId: identityItem, relocationReviewItemId: item.review_item_id as number,
    targetPrecision: "publisherPoint" as const, areaPremise: "insideArea" as const, reviewedBy: "reviewer", now: "2026-10-12T00:00:00Z" };
  // Not held / not confirmed yet: refused.
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, input));
  assert.equal((await holdRelocationCandidate(db, adapter, item.review_item_id, { now: "2026-10-11T02:00:00Z" })).status, "held");
  await recordReviewDecision(db, { reviewItemId: item.review_item_id, decision: "relocationConfirmed", decidedBy: "reviewer", decidedAt: "2026-10-11T03:00:00Z" });
  // The plain ADR-0009 path refuses the location-evidence delta; with the delta but without an upgrade the anchored pin
  // cannot move. Nothing is written by either.
  await assert.rejects(() => applyReviewedRelocation(db, adapter, item.review_item_id, { now: NOW }), /other observed fields changed/);
  // With the delta flag but without the recorded delta and upgrade, ADR-0009's own premise refuses the move.
  await assert.rejects(() => applyReviewedRelocation(db, adapter, item.review_item_id, { now: NOW, areaAnchorDelta: true }),
    /not the current, latest relocationConfirmed|area-anchored spot moves only/);
  assert.equal(count(db, "review_relocation_applications"), 0);
  // The point did not stay: a same-coordinate claim is refused; the relocation item is required.
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, { ...input, relocationReviewItemId: undefined }), /relocation item is required/);
  assert.deepEqual(await applyAreaPrecisionUpgrade(db, adapter, input), { status: "applied", spotId: spot.id, kind: "relocated" });
  assert.equal(count(db, "review_relocation_applications"), 1);
  assert.deepEqual([spotByName(db, "公園内喫煙所").latitude, spotByName(db, "公園内喫煙所").longitude], [MOVED.latitude, MOVED.longitude]);
  assert.equal((await b.resolve("2026-10-13T00:00:00Z")).status, "resolved");
  const after = byName(await published(db), "公園内喫煙所")!;
  assert.equal(after.id, spot.id, "stable spot ID");
  assert.deepEqual([after.latitude, after.longitude, after.verification.locationPrecision], [MOVED.latitude, MOVED.longitude, "publisherPoint"]);
  assert.equal(one(db, "SELECT rule FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'", spot.id)!.rule, "test.point.v1");
  const upgrade = one(db, "SELECT * FROM area_precision_upgrades")!;
  assert.deepEqual([upgrade.upgrade_kind, upgrade.relocation_review_item_id, upgrade.evidence_record_id, upgrade.old_latitude, upgrade.new_latitude],
    ["relocated", item.review_item_id, evidence, PARK.latitude, MOVED.latitude]);
  assert.equal(count(db, "spot_location_anchors"), 1, "old anchor history stays");
});

test("stale or competing review premises are refused; a historical or foreign hold never ends an anchor", async () => {
  const { db, adapter } = await areaPipeline();
  const spot = byName(await published(db), "公園内喫煙所")!;
  const b = await nextRelease(db, adapter, ["exactMoved", "exact"], "2026-10-10");
  const identityItem = (b.first as { reviewItemIds: number[] }).reviewItemIds[0];
  await decideIdentity(db, identityItem, spot.id);
  await b.resolve();
  const item = one(db, "SELECT * FROM review_items WHERE kind = 'relocationCandidate'")!;
  await holdRelocationCandidate(db, adapter, item.review_item_id, { now: "2026-10-11T02:00:00Z" });
  await recordReviewDecision(db, { reviewItemId: item.review_item_id, decision: "relocationConfirmed", decidedBy: "reviewer", decidedAt: "2026-10-11T03:00:00Z" });
  // A newer identity decision makes the relocation decision stale (ADR-0009 decision order).
  await decideIdentity(db, identityItem, spot.id, "2026-10-11T04:00:00Z");
  const input = { spotId: spot.id, evidenceRecordId: item.record_id as number, identityReviewItemId: identityItem, relocationReviewItemId: item.review_item_id as number,
    targetPrecision: "publisherPoint" as const, areaPremise: "insideArea" as const, reviewedBy: "reviewer", now: "2026-10-12T00:00:00Z" };
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, input));
  assert.equal(count(db, "area_precision_upgrades"), 0);
  // An upgrade citing another (or no current) relocation item is refused by the schema premise.
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, { ...input, relocationReviewItemId: identityItem }));
  assert.equal(count(db, "area_precision_upgrades"), 0);
  // There is no way to end a binding by hold: bindings have no end column, and no row can be changed.
  assert.throws(() => db.raw.prepare("UPDATE spot_location_anchors SET bound_at = bound_at").run(), /immutable/);
});

test("planner: same coordinate vs ADR-0009 move; v1 refuses community pins, reviewedDerived and outside-area points", () => {
  const spot = { latitude: PARK.latitude, longitude: PARK.longitude };
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: { ...spot, precision: "publisherPoint" }, insideArea: true }), { kind: "sameCoordinate", precision: "publisherPoint" });
  const moved = { latitude: spot.latitude + 0.000001, longitude: spot.longitude, precision: "publisherPoint" as const };
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: moved, insideArea: true }), { kind: "relocated", precision: "publisherPoint", adr: "ADR-0009" });
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: moved, insideArea: false }), { kind: "refused", reason: "outsideAreaNotSupportedV1" });
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: moved, insideArea: "unknown" }), { kind: "refused", reason: "outsideAreaNotSupportedV1" });
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: { ...moved, precision: "communityPinned" }, insideArea: true }), { kind: "refused", reason: "communityPinNotSupportedV1" });
  assert.deepEqual(planAreaPrecisionUpgrade({ spot, newPoint: { ...moved, precision: "reviewedDerived" }, insideArea: true }), { kind: "refused", reason: "reviewedDerivedNotApproved" });
});

test("API: areaApproximate serializes with its area; the schema forbids a mismatched area", async () => {
  const { db } = await areaPipeline();
  const approx = byName(await published(db), "公園内喫煙所")!;
  assert.equal(TileSpotV1.safeParse({ ...approx, verification: { ...approx.verification, locationArea: undefined } }).success, false);
  assert.equal(TileSpotV1.safeParse({ ...approx, verification: { ...approx.verification, locationPrecision: "publisherPoint" } }).success, false);
});

// ---------------------------------------------------------------------------------------------------------------
// P2-2: the replay never rescues past another gate

test("the nationwide replay classifier: location eligibility and current operation are independent axes", async () => {
  const { classifyApproximate } = await import("../src/quality/approximate-replay.ts");
  const base = { targetId: "t", jurisdiction: "j", prefecture: null, blockerCodes: [] as string[], explicitExistence: true,
    location: "areaOrHost" as const, reusableAnchor: true, alreadyPublished: false, text: "" };
  assert.equal(classifyApproximate(base).category, "A-rescuedByAreaApproximate");
  assert.equal(classifyApproximate({ ...base, blockerCodes: ["exactResourceRights"] }).category, "C-rightsBlocked");
  assert.equal(classifyApproximate({ ...base, reusableAnchor: false }).category, "D-noReusableAnchor");
  assert.equal(classifyApproximate({ ...base, location: "addressOnly" }).category, "G-geocodingNeeded");
  assert.equal(classifyApproximate({ ...base, explicitExistence: false }).category, "B-existenceInsufficient");
  assert.equal(classifyApproximate({ ...base, explicitExistence: false, blockerCodes: ["noPermittedSmokingPlaceEvidence"] }).category, "F-prohibitionOrConflict");
  assert.equal(classifyApproximate({ ...base, blockerCodes: ["closureOrAvailabilityRequiresReconciliation"] }).category, "F-prohibitionOrConflict");
  for (const text of ["a former site closed in 2024", "the room is suspended", "施設は休止中", "facility abolished"]) {
    const c = classifyApproximate({ ...base, text });
    assert.equal(c.category, "E-currentOperation", `${text}: never A while closure evidence is unreconciled`);
    assert.equal(c.adr0017RemovesLocationBlocker, true, "location eligibility is recorded separately");
  }
  assert.equal(classifyApproximate({ ...base, explicitExistence: false, text: "street-smoking prohibited-district policy" }).category, "B-existenceInsufficient");
  assert.equal(classifyApproximate({ ...base, location: "unestablished" }).adr0017RemovesLocationBlocker, false);
});
