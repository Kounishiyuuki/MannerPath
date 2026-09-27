// Relocation tile / ETag / promotion E2E (ADR-0009 implementation plan step D). It runs the whole
// operational order — A ingest/resolve/publish, B ingest, reviewed identity, relocationCandidate, hold,
// publish, relocationConfirmed, application, publish (fenced), resolve B, publish, promotion, fresh target —
// and checks tile bodies, revisions, content hashes and ETags through GET /v1/tiles and GET /v1/spots.
//
// The second release is an ARTIFICIAL fixture: the one real Taito file with row 1's coordinate edited. It
// runs under the Taito source id with a TEST-ONLY adapter whose gates are open (as the removal promotion E2E
// in review-removal-resolution.test.ts does), because promotion accepts only a reviewed, approved source.
// TAITO_ADAPTER itself stays partial with its cross-release gate closed.
//
// Baselines. Applying release B refreshes last_verified_at of every matched spot, so the publish after the
// resolver legitimately changes every tile body (lastVerifiedAt). What the relocation itself changes is
// isolated by a CONTROL database that applies the same B timestamps with the coordinate unchanged: every tile
// other than the old/new tile must equal the control byte for byte (revision, hash, body), and the old/new
// tiles must equal the control's body with exactly the move applied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { app } from "../src/app.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../src/geo/tile.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { PromotionError, buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { applyReviewedRelocation } from "../src/pipeline/relocation-application.ts";
import { holdRelocationCandidate } from "../src/pipeline/relocation-hold.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { type ReviewDecision, recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { type SourceAdapter, sourceCompleteness } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { tileEtag } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, migratedSqlite } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const LATER = "2026-09-26T03:00:00Z";
const HOLD_AT = "2026-09-27T03:00:00Z";
const APPLY_AT = "2026-09-28T03:00:00Z";
const RESOLVE_AT = "2026-09-29T03:00:00Z";
const REPUBLISH_AT = "2026-09-30T03:00:00Z";
const RERUN_AT = "2026-10-01T03:00:00Z";
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules and source id, matcher gate open, no list-page attenuation. */
const ADAPTER: SourceAdapter = { ...TAITO_ADAPTER, assertResolvable: () => {}, attenuate: () => [], crossReleaseValidated: true };

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
// Row 1 is `1,...,上野公園前交番裏,...,35.7112,139.77377,`.
const OLD = { latitude: 35.7112, longitude: 139.77377 };
const moved = (to: { latitude: number; longitude: number }) => new TextEncoder().encode(
  [LINES[0], LINES[1].replace(",35.7112,139.77377,", `,${to.latitude},${to.longitude},`), ...LINES.slice(2)].join("\r\n"));
const tileOf = (c: { latitude: number; longitude: number }) => formatTileId(tileForCoordinate(c.latitude, c.longitude, DATA_TILE_ZOOM));

const CASES = [
  // ~2.2 km north: a z14 tile no Taito spot is in, so the new tile is created (404 -> 200).
  { name: "cross-tile, into a new tile", to: { latitude: 35.7312, longitude: 139.77377 }, crossTile: true, newTileExists: false },
  // ~1.9 km east: a z14 tile that already holds other Taito spots.
  { name: "cross-tile, into an existing tile", to: { latitude: 35.7112, longitude: 139.795 }, crossTile: true, newTileExists: true },
  // ~11 m north: the same z14 tile.
  { name: "same-tile", to: { latitude: 35.7113, longitude: 139.77377 }, crossTile: false, newTileExists: true },
] as const;

const get = (db: SqliteD1, path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, { DB: db });
const snapshots = (db: SqliteD1) => new Map(all(db, "SELECT * FROM tile_snapshots ORDER BY tile_id").map((t) => [t.tile_id as string, t]));
const etagOf = (t: Row) => tileEtag(t.schema_version, t.content_sha256);
const members = (db: SqliteD1, spotId: string) => all(db, "SELECT tile_id FROM tile_snapshot_spots WHERE spot_id = ?", spotId).map((r) => r.tile_id);
const inAnyBody = (db: SqliteD1, spotId: string) => all(db, "SELECT body_json FROM tile_snapshots").some((t) => JSON.parse(t.body_json).spots.some((s: Row) => s.id === spotId));
const release = (db: SqliteD1, id: number) => one(db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", id);
const existenceRecord = (db: SqliteD1, spotId: string) =>
  one(db, "SELECT record_id FROM spot_field_provenance WHERE spot_id = ? AND field = 'existence'", spotId).record_id as number;
const decide = (db: SqliteD1, reviewItemId: number, decision: ReviewDecision, sourceEntityId?: number) =>
  recordReviewDecision(db, { reviewItemId, decision, sourceEntityId, decidedBy: "test-reviewer", decidedAt: LATER });
const resolve = (db: SqliteD1, releaseId: number, now: string) =>
  resolveFirstRelease(db, ADAPTER, releaseId, { now, newSpotId: sequentialSpotIds("B") });

/** Tiles whose stored rows differ between two snapshot maps (added, removed or changed). */
function changedTiles(before: Map<string, Row>, after: Map<string, Row>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort()
    .filter((id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
}

/** A published with the reviewed Taito registry row; returns the database and A's release id. */
async function releaseA() {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.equal((await resolveFirstRelease(db, ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("A") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  return { db, firstId: releaseId };
}

/** CONTROL: the same B timestamps with no move (raw-identical), published at the same instant. */
async function control() {
  const { db } = await releaseA();
  const { releaseId } = await ingestRelease(db, ADAPTER, TAITO_BYTES, SECOND);
  assert.equal((await resolve(db, releaseId, RESOLVE_AT)).status, "resolved");
  await publishTiles(db, { now: REPUBLISH_AT });
  return snapshots(db);
}

test("Taito gates unchanged: partial, cross-release gate closed, no natural key or threshold", () => {
  assert.equal(sourceCompleteness(TAITO_ADAPTER), "partial");
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal("naturalKey" in TAITO_ADAPTER, false);
  assert.equal("relocationThreshold" in TAITO_ADAPTER, false);
  assert.equal(sourceCompleteness(ADAPTER), "partial", "the test adapter keeps partial completeness");
});

for (const c of CASES) {
  test(`E2E ${c.name}: tiles, revisions, hashes, ETags, spot detail, fence and promotion`, async () => {
    const oldTile = tileOf(OLD);
    const newTile = tileOf(c.to);
    assert.equal(oldTile !== newTile, c.crossTile, "fixture precondition: z14 tiles of the old and new coordinate");

    // ── Release A published: baseline 1 (A).
    const { db, firstId } = await releaseA();
    const snapA = snapshots(db);
    assert.ok(snapA.has(oldTile));
    assert.equal(snapA.has(newTile), c.newTileExists, "fixture precondition: whether the new tile already exists");
    const recordA = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = 1", firstId).record_id as number;
    const { source_entity_id: entityId, spot_id: spotId } = one(db,
      `SELECT e.source_entity_id, l.spot_id FROM source_record_entities e
       JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id WHERE e.record_id = ?`, recordA);
    assert.deepEqual(members(db, spotId), [oldTile]);
    const spotCount = one(db, "SELECT count(*) AS n FROM spots").n;
    const historyA = {
      release: one(db, "SELECT * FROM source_releases WHERE release_id = ?", firstId),
      records: all(db, "SELECT * FROM source_records WHERE release_id = ? ORDER BY record_id", firstId),
      observations: all(db, "SELECT o.* FROM source_observations o JOIN source_records r ON r.record_id = o.record_id WHERE r.release_id = ? ORDER BY 1", firstId),
      links: all(db, "SELECT * FROM source_record_entities WHERE release_id = ? ORDER BY record_id", firstId),
    };
    const spotA = await (await get(db, `/v1/spots/${spotId}`)).json() as Row;
    assert.deepEqual([spotA.spot.latitude, spotA.spot.longitude, spotA.spot.tile], [OLD.latitude, OLD.longitude, oldTile]);
    if (!c.newTileExists) assert.equal((await get(db, `/v1/tiles/${newTile}`)).status, 404);

    // ── Release B: reviewed identity -> relocationCandidate -> hold.
    const { releaseId: secondId } = await ingestRelease(db, ADAPTER, moved(c.to), SECOND);
    const first = await resolve(db, secondId, LATER);
    assert.equal(first.status, "needsReview");
    const identityItemId = first.status === "needsReview" ? first.reviewItemIds[0] : NaN;
    await decide(db, identityItemId, "matchedToEntity", entityId);
    const second = await resolve(db, secondId, LATER);
    const item = one(db, "SELECT * FROM review_items WHERE kind = 'relocationCandidate'");
    assert.deepEqual(second, { status: "needsReview", reviewItemIds: [item.review_item_id] });
    assert.deepEqual(snapshots(db), snapA, "detecting a candidate writes no tile");
    assert.equal((await holdRelocationCandidate(db, ADAPTER, item.review_item_id, { now: HOLD_AT })).status, "held");
    assert.deepEqual(members(db, spotId), [], "held: unpublished first");
    // Membership is gone but the old body still lists the spot until republish: promotion fails closed.
    await assert.rejects(buildPromotionBundle(db), PromotionError);

    // ── publish after hold: only the old tile changes, and the spot is in no tile.
    const holdReport = await publishTiles(db, { now: HOLD_AT });
    const snapHold = snapshots(db);
    assert.deepEqual(holdReport.published.map((p) => p.tileId), [oldTile]);
    assert.deepEqual(changedTiles(snapA, snapHold), [oldTile]);
    assert.equal(snapHold.get(oldTile)!.revision, snapA.get(oldTile)!.revision + 1);
    assert.notEqual(snapHold.get(oldTile)!.content_sha256, snapA.get(oldTile)!.content_sha256);
    assert.equal(inAnyBody(db, spotId), false);
    assert.equal((await get(db, `/v1/spots/${spotId}`)).status, 404);

    // ── relocationConfirmed -> application: new coordinate, hold lifted, pending, still on A's evidence.
    await decide(db, item.review_item_id, "relocationConfirmed");
    const applied = await applyReviewedRelocation(db, ADAPTER, item.review_item_id, { now: APPLY_AT });
    assert.deepEqual(applied, { status: "applied", spotId, reviewItemId: item.review_item_id,
      reviewDecisionId: applied.status === "applied" ? applied.reviewDecisionId : NaN, oldTileId: oldTile, newTileId: newTile });
    assert.deepEqual(one(db, "SELECT latitude, longitude, tile_id, publication_hold FROM spots WHERE spot_id = ?", spotId),
      { ...c.to, tile_id: newTile, publication_hold: null });
    assert.deepEqual(all(db, "SELECT spot_id FROM pending_relocation_applications"), [{ spot_id: spotId }]);
    assert.deepEqual(release(db, secondId), { status: "ingested", is_current: 0 });
    assert.equal(existenceRecord(db, spotId), recordA);

    // Fence: publishing now changes nothing and publishes the spot nowhere; the API does not show it.
    const fencedReport = await publishTiles(db, { now: APPLY_AT });
    assert.deepEqual(fencedReport.published, []);
    assert.deepEqual(snapshots(db), snapHold);
    assert.deepEqual(members(db, spotId), []);
    assert.equal(inAnyBody(db, spotId), false);
    assert.equal((await get(db, `/v1/spots/${spotId}`)).status, 404);
    if (!c.newTileExists) assert.equal((await get(db, `/v1/tiles/${newTile}`)).status, 404);
    // Promotion here is the old current release A without the relocating spot: never the new coordinate on A.
    const fencedBundle = await buildPromotionBundle(db);
    assert.equal(fencedBundle.manifest.releaseId, firstId);
    assert.equal(fencedBundle.sql.includes(spotId), false, "neither the old nor the new coordinate of the spot is promoted");
    assert.equal(fencedBundle.manifest.rows.spots, spotCount - 1);

    // ── resolve B: evidence moves, the application is consumed; tiles still carry A until republished.
    assert.equal((await resolve(db, secondId, RESOLVE_AT)).status, "resolved");
    assert.deepEqual(release(db, secondId), { status: "applied", is_current: 1 });
    assert.deepEqual(release(db, firstId), { status: "applied", is_current: 0 });
    assert.equal(existenceRecord(db, spotId), item.record_id);
    assert.deepEqual(all(db, "SELECT DISTINCT record_id FROM spot_field_provenance WHERE spot_id = ?", spotId), [{ record_id: item.record_id }]);
    assert.equal(all(db, "SELECT * FROM review_relocation_resolutions").length, 1);
    assert.deepEqual(all(db, "SELECT * FROM pending_relocation_applications"), []);
    await assert.rejects(buildPromotionBundle(db), PromotionError, "published tiles still cite A");

    // ── final publish: baseline 2 (the control) isolates the move from B's lastVerifiedAt refresh.
    const finalReport = await publishTiles(db, { now: REPUBLISH_AT });
    const snapFinal = snapshots(db);
    const snapControl = await control();
    const expectedTiles = [...new Set([...snapA.keys(), newTile])].sort();
    assert.deepEqual([...snapFinal.keys()], expectedTiles, "the old tile is kept (possibly smaller), the new tile exists");
    assert.deepEqual(finalReport.published.map((p) => p.tileId), expectedTiles,
      "every tile is republished: B refreshed lastVerifiedAt of every matched spot");
    for (const [tileId, t] of snapFinal) {
      assert.equal(t.revision, (snapHold.get(tileId)?.revision ?? 0) + 1, `${tileId}: exactly one revision per content change`);
      assert.equal(t.content_sha256, sha256(t.body_json), `${tileId}: hash covers the stored body`);
      if (tileId === oldTile || tileId === newTile) continue;
      assert.deepEqual(t, snapControl.get(tileId), `${tileId}: unrelated tile equals the no-move control (revision, hash, body)`);
    }
    // The spot DTO as the control publishes it, with only the coordinate moved.
    const controlOld = JSON.parse(snapControl.get(oldTile)!.body_json);
    const dtoControl = controlOld.spots.find((s: Row) => s.id === spotId);
    const dtoMoved = { ...dtoControl, ...c.to };
    const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : 1);
    const oldBody = JSON.parse(snapFinal.get(oldTile)!.body_json);
    if (c.crossTile) {
      assert.deepEqual(oldBody, { ...controlOld, revision: snapHold.get(oldTile)!.revision + 1,
        spots: controlOld.spots.filter((s: Row) => s.id !== spotId) }, "old tile: the control body without the spot");
      const newBody = JSON.parse(snapFinal.get(newTile)!.body_json);
      const controlNew = snapControl.get(newTile);
      assert.deepEqual(newBody, controlNew === undefined
        ? { schemaVersion: 1, tile: newTile, revision: 1, generatedAt: REPUBLISH_AT, spots: [dtoMoved], sources: controlOld.sources }
        : { ...JSON.parse(controlNew.body_json), spots: [...JSON.parse(controlNew.body_json).spots, dtoMoved].sort(byId) },
      "new tile: the same spot id at the new coordinate, with the source attribution");
      assert.equal(snapFinal.get(newTile)!.revision, c.newTileExists ? snapA.get(newTile)!.revision + 1 : 1);
    } else {
      assert.deepEqual(oldBody, { ...controlOld, revision: snapA.get(oldTile)!.revision + 2,
        spots: controlOld.spots.map((s: Row) => (s.id === spotId ? dtoMoved : s)) }, "same tile: only the spot's coordinate differs");
    }
    assert.deepEqual(members(db, spotId), [newTile]);
    assert.equal(all(db, "SELECT body_json FROM tile_snapshots").filter((t) => t.body_json.includes(`"id":"${spotId}"`)).length, 1);
    assert.equal(dtoMoved.lastVerifiedAt, SECOND.observedOn);

    // Relocation-only view (A -> final with the lastVerifiedAt refresh taken out): only old/new tiles differ.
    const withoutRefresh = (body: string) => JSON.stringify({ ...JSON.parse(body), revision: 0, generatedAt: "",
      spots: JSON.parse(body).spots.map((s: Row) => ({ ...s, lastVerifiedAt: null })) });
    const semanticChanges = expectedTiles.filter((id) => !snapA.has(id) || withoutRefresh(snapA.get(id)!.body_json) !== withoutRefresh(snapFinal.get(id)!.body_json));
    assert.deepEqual(semanticChanges, [...new Set([oldTile, newTile])].sort());

    // ── ETag / If-None-Match on every tile the move changed.
    for (const tileId of [...new Set([oldTile, newTile])]) {
      const current = snapFinal.get(tileId)!;
      const res = await get(db, `/v1/tiles/${tileId}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("ETag"), etagOf(current));
      assert.equal(await res.text(), current.body_json);
      for (const stale of [snapA.get(tileId), snapHold.get(tileId)]) {
        if (stale === undefined) continue;
        assert.notEqual(etagOf(stale), etagOf(current));
        assert.equal((await get(db, `/v1/tiles/${tileId}`, { "If-None-Match": etagOf(stale) })).status, 200, `${tileId}: stale ETag`);
      }
      assert.equal((await get(db, `/v1/tiles/${tileId}`, { "If-None-Match": etagOf(current) })).status, 304, `${tileId}: current ETag`);
    }

    // ── republish of the same state is idempotent: nothing changes, not even published_at.
    const rerun = await publishTiles(db, { now: RERUN_AT });
    assert.deepEqual(rerun.published, []);
    assert.deepEqual(rerun.unchanged, expectedTiles);
    assert.deepEqual(snapshots(db), snapFinal);
    assert.equal((await get(db, `/v1/tiles/${newTile}`, { "If-None-Match": etagOf(snapFinal.get(newTile)!) })).status, 304);

    // ── spot detail: same id, new coordinate and tile, B's evidence.
    const detailRes = await get(db, `/v1/spots/${spotId}`);
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json() as Row;
    assert.deepEqual([detail.requestedId, detail.spot.id, detail.spot.latitude, detail.spot.longitude, detail.spot.tile],
      [spotId, spotId, c.to.latitude, c.to.longitude, newTile]);
    assert.ok(detail.provenance.length > 0 && detail.provenance.every((p: Row) => p.observedOn === SECOND.observedOn));

    // ── identity and history: same spot, no new spot, nothing deleted.
    assert.equal(one(db, "SELECT count(*) AS n FROM spots").n, spotCount, "no spot was created");
    assert.equal(one(db, "SELECT created_at FROM spots WHERE spot_id = ?", spotId).created_at, NOW);
    assert.deepEqual({
      release: one(db, "SELECT * FROM source_releases WHERE release_id = ?", firstId),
      records: all(db, "SELECT * FROM source_records WHERE release_id = ? ORDER BY record_id", firstId),
      observations: all(db, "SELECT o.* FROM source_observations o JOIN source_records r ON r.record_id = o.record_id WHERE r.release_id = ? ORDER BY 1", firstId),
      links: all(db, "SELECT * FROM source_record_entities WHERE release_id = ? ORDER BY record_id", firstId),
    }, { ...historyA, release: { ...historyA.release, is_current: 0 } }, "A's release, raw records, observations and links are kept");
    assert.deepEqual(all(db, "SELECT kind FROM review_items ORDER BY review_item_id").map((r) => r.kind), ["ambiguousMatch", "relocationCandidate"]);
    assert.deepEqual(all(db, "SELECT decision FROM review_decisions ORDER BY review_decision_id").map((r) => r.decision), ["matchedToEntity", "relocationConfirmed"]);
    for (const t of ["review_relocation_holds", "review_relocation_applications", "review_relocation_resolutions"]) {
      assert.equal(one(db, `SELECT count(*) AS n FROM ${t}`).n, 1, t);
    }
    assert.deepEqual(one(db, "SELECT old_latitude, old_longitude, old_tile_id, new_latitude, new_longitude, new_tile_id FROM review_relocation_applications"),
      { old_latitude: OLD.latitude, old_longitude: OLD.longitude, old_tile_id: oldTile, new_latitude: c.to.latitude, new_longitude: c.to.longitude, new_tile_id: newTile });

    // ── promotion of B: new coordinate, new tile membership, B's accepted evidence; A stays local history.
    const bundle = await buildPromotionBundle(db);
    assert.equal(bundle.manifest.releaseId, secondId);
    assert.equal(bundle.manifest.rows.source_releases, 1, "single-release bootstrap: previous releases are not carried");
    assert.equal(bundle.manifest.rows.spots, spotCount);
    assert.deepEqual(bundle.manifest.tiles.map((t) => [t.tileId, t.revision, t.contentSha256]),
      expectedTiles.map((id) => [id, snapFinal.get(id)!.revision, snapFinal.get(id)!.content_sha256]));
    assert.ok(bundle.sql.includes(`INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES ('${spotId}', '${newTile}');`));
    const spotInsert = bundle.sql.split("\n").find((l) => l.startsWith(`INSERT INTO spots `) && l.includes(`VALUES ('${spotId}'`))!;
    assert.ok(spotInsert.includes(`, ${c.to.latitude}, ${c.to.longitude}, 14, `) && spotInsert.includes(`'${newTile}'`), "canonical row at the new coordinate");
    assert.ok(!spotInsert.includes(`, ${OLD.latitude}, ${OLD.longitude}, `), "the old coordinate is not canonical");
    assert.ok(bundle.sql.includes(`INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at, note) VALUES (${item.record_id}, ${secondId}, ${entityId}, 'manual'`));
    assert.ok(!bundle.sql.includes(`VALUES (${recordA}, ${firstId}, `), "A's record is not carried");

    // ── fresh target: KNOWN GAP (follow-up issue). The single-release bootstrap bundle does not carry the review
    // chain (review_items / review_decisions / review_match_applications, which reference the previous release),
    // so migration 0011's trigger refuses B's reviewed ('manual') link on the receiving side. It fails closed; a
    // relocated (or any reviewed-match) release cannot bootstrap a fresh database until that gap is closed.
    const target = migratedSqlite();
    target.exec("PRAGMA foreign_keys = ON;");
    assert.throws(() => target.exec(bundle.sql), /source_record_entities: a manual decision requires a review_match_application/);
    assert.equal((target.prepare("SELECT count(*) AS n FROM tile_snapshot_spots").get() as Row).n, 0, "nothing is published on the target");
  });
}
