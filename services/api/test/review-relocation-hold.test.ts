// Relocation hold step (ADR-0009 implementation plan step B, Issue #95). The second releases are
// ARTIFICIAL test fixtures derived from the one real Taito release under a test-only source, as in
// review-relocation.test.ts; Taito's own gates stay closed. A hold only withholds: nothing here moves a
// coordinate, applies a relocation decision or lifts a hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { CROSS_RELEASE_MATCHER_VERSION } from "../src/pipeline/match.ts";
import { RELOCATION_POLICY_VERSION } from "../src/pipeline/relocation.ts";
import {
  HOLD_RELOCATION_UNDER_REVIEW, RELOCATION_HOLD_EXECUTOR_VERSION, RelocationHoldError, holdRelocationCandidate,
} from "../src/pipeline/relocation-hold.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { type ReviewDecision, recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { type SourceAdapter, sourceCompleteness } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyMigration, migratedSqlite, withoutTrigger } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

const SOURCE = "test-relocation-hold";
const LATER = "2026-09-26T03:00:00Z";
const HOLD_AT = "2026-09-27T03:00:00Z";
const REVIEWER = "test-reviewer";

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules under an unapproved source, matcher gate open. */
const ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY relocation hold source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
  completeness: undefined, // undeclared -> partial
};

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const bytesOf = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));
// Row 1 is `1,...,上野公園前交番裏,...,35.7112,139.77377,`: moved by 0.0001 degrees of latitude.
const MOVED = bytesOf([LINES[0], LINES[1].replace(",35.7112,", ",35.7113,"), ...LINES.slice(2)]);
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };
const THIRD = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-20", fetchedAt: "2026-09-26T00:00:00Z" };

const recordOf = (db: SqliteD1, releaseId: number, ordinal: number) =>
  one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = ?", releaseId, ordinal).record_id as number;
const entityOf = (db: SqliteD1, recordId: number) =>
  one(db, `SELECT e.source_entity_id, l.spot_id FROM source_record_entities e
    JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id WHERE e.record_id = ?`, recordId) as { source_entity_id: number; spot_id: string };
const observationOf = (db: SqliteD1, recordId: number) => one(db,
  "SELECT observation_id FROM source_observations WHERE record_id = ? AND mapping_version = ?", recordId, ADAPTER.mappingVersion).observation_id as number;
const resolve = (db: SqliteD1, releaseId: number, now = LATER) =>
  resolveFirstRelease(db, ADAPTER, releaseId, { now, newSpotId: sequentialSpotIds("B") });
const decide = (db: SqliteD1, reviewItemId: number, decision: ReviewDecision, sourceEntityId?: number) =>
  recordReviewDecision(db, { reviewItemId, decision, sourceEntityId, decidedBy: REVIEWER, decidedAt: LATER });
const hold = (db: SqliteD1, reviewItemId: number, adapter = ADAPTER) => holdRelocationCandidate(db, adapter, reviewItemId, { now: HOLD_AT });
const spotOf = (db: SqliteD1, spotId: string) => one(db, "SELECT * FROM spots WHERE spot_id = ?", spotId);
const published = (db: SqliteD1, spotId: string) => one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n as number;
const holdRows = (db: SqliteD1) => all(db, "SELECT * FROM review_relocation_holds ORDER BY 1");
const insertHoldRow = (db: SqliteD1, reviewItemId: number, spotId: string, executor = RELOCATION_HOLD_EXECUTOR_VERSION) =>
  db.raw.prepare("INSERT INTO review_relocation_holds (review_item_id, spot_id, executor_version, applied_at) VALUES (?, ?, ?, ?)")
    .run(reviewItemId, spotId, executor, HOLD_AT);
const INVALID_ROW = /review_relocation_holds: not a current, actionable relocationCandidate/;

/** Every table a hold must leave alone. spots and tile_snapshot_spots are compared separately. */
function untouched(db: SqliteD1) {
  return Object.fromEntries(["source_releases", "source_records", "source_observations", "source_entities", "source_record_entities",
    "source_record_match_keys", "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "review_items",
    "review_decisions", "review_match_applications", "review_removal_applications", "review_removal_resolutions", "tile_snapshots"]
    .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
}
function everything(db: SqliteD1) {
  return { ...untouched(db), spots: all(db, "SELECT * FROM spots ORDER BY 1"), tile_snapshot_spots: all(db, "SELECT * FROM tile_snapshot_spots ORDER BY 1, 2"),
    review_relocation_holds: holdRows(db) };
}

/** First release applied and published; MOVED ingested, reviewed as the same entity, resolved: one open relocationCandidate. */
async function candidate() {
  const s = await identityDecided();
  const result = await resolve(s.db, s.secondId);
  const item = one(s.db, "SELECT * FROM review_items WHERE kind = 'relocationCandidate'");
  assert.deepEqual(result, { status: "needsReview", reviewItemIds: [item.review_item_id] });
  return { ...s, item, itemId: item.review_item_id as number };
}

/** As candidate(), but stops after the identity decision: no relocationCandidate is stored yet. */
async function identityDecided() {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY relocation hold source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'approved', ?, ?)`,
  ).run(SOURCE, NOW, NOW);
  const { releaseId: firstId } = await ingestRelease(db, ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, ADAPTER, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const { releaseId: secondId } = await ingestRelease(db, ADAPTER, MOVED, SECOND);
  const first = await resolve(db, secondId);
  const identityItemId = first.status === "needsReview" ? first.reviewItemIds[0] : NaN;
  const prior = entityOf(db, recordOf(db, firstId, 1));
  const identityDecisionId = await decide(db, identityItemId, "matchedToEntity", prior.source_entity_id);
  return { db, firstId, secondId, identityItemId, identityDecisionId, prior };
}

test("Taito gates unchanged: partial, cross-release gate closed, no natural key or threshold", () => {
  assert.equal(sourceCompleteness(TAITO_ADAPTER), "partial");
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal("naturalKey" in TAITO_ADAPTER, false);
  assert.equal("relocationThreshold" in TAITO_ADAPTER, false);
});

test("detecting a candidate does not hold: the resolver leaves the spot published and unheld", async () => {
  const { db, prior } = await candidate();
  assert.equal(spotOf(db, prior.spot_id).publication_hold, null);
  assert.equal(published(db, prior.spot_id), 1);
  assert.deepEqual(holdRows(db), []);
});

test("hold: unpublished, then relocationUnderReview with its row; nothing else changes", async () => {
  const { db, secondId, prior, itemId } = await candidate();
  const before = untouched(db);
  const spotBefore = spotOf(db, prior.spot_id);
  const otherSnapshots = all(db, "SELECT * FROM tile_snapshot_spots WHERE spot_id <> ? ORDER BY 1, 2", prior.spot_id);

  assert.deepEqual(await hold(db, itemId), { status: "held", spotId: prior.spot_id, reviewItemId: itemId, tileId: spotBefore.tile_id });

  assert.deepEqual(spotOf(db, prior.spot_id), { ...spotBefore, publication_hold: HOLD_RELOCATION_UNDER_REVIEW },
    "coordinate, tile, id, lifecycle, merge, updated_at and every value unchanged");
  assert.equal(published(db, prior.spot_id), 0);
  assert.deepEqual(all(db, "SELECT * FROM tile_snapshot_spots ORDER BY 1, 2"), otherSnapshots, "only this spot is unpublished");
  assert.deepEqual(holdRows(db), [{ review_relocation_hold_id: 1, review_item_id: itemId, spot_id: prior.spot_id,
    executor_version: "review-relocation-hold.v1", applied_at: HOLD_AT }]);
  assert.deepEqual(untouched(db), before, "links, entities, provenance, attenuations, observations, review items and decisions, releases");
  assert.deepEqual(one(db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", secondId), { status: "ingested", is_current: 0 });

  // The ordinary publish step drops it from its tile body; it is never republished while held.
  await publishTiles(db, { now: HOLD_AT });
  assert.equal(published(db, prior.spot_id), 0);
  const body = one(db, "SELECT body_json FROM tile_snapshots WHERE tile_id = ? ORDER BY revision DESC LIMIT 1", spotBefore.tile_id).body_json;
  assert.ok(!body.includes(prior.spot_id), "the spot is gone from its tile body");
  assert.throws(() => db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(prior.spot_id, spotBefore.tile_id), /not publishable/);
});

test("unpublish first: the schema refuses a hold on a spot that is still in a snapshot", async () => {
  const { db, prior, itemId } = await candidate();
  insertHoldRow(db, itemId, prior.spot_id);
  assert.throws(() => db.raw.prepare("UPDATE spots SET publication_hold = 'relocationUnderReview' WHERE spot_id = ?").run(prior.spot_id),
    /unpublish this spot from its tile before/);
});

test("idempotent: a second run writes nothing and reports alreadyHeld", async () => {
  const { db, prior, itemId } = await candidate();
  await hold(db, itemId);
  const after = everything(db);
  assert.deepEqual(await hold(db, itemId), { status: "alreadyHeld", spotId: prior.spot_id, reviewItemId: itemId });
  assert.deepEqual(everything(db), after);
  assert.throws(() => insertHoldRow(db, itemId, prior.spot_id), INVALID_ROW, "a second row is refused: the spot is held");
});

for (const decision of [null, "relocationConfirmed", "relocationRejected", "deferred"] as const) {
  test(`a relocation decision is neither required nor consumed (latest: ${decision ?? "none"})`, async () => {
    const { db, secondId, prior, itemId } = await candidate();
    if (decision) await decide(db, itemId, decision);
    const decisions = all(db, "SELECT * FROM review_decisions ORDER BY 1");
    const spotBefore = spotOf(db, prior.spot_id);
    assert.equal((await hold(db, itemId)).status, "held");
    assert.deepEqual(spotOf(db, prior.spot_id), { ...spotBefore, publication_hold: HOLD_RELOCATION_UNDER_REVIEW }, "no coordinate moves, even on relocationConfirmed");
    assert.deepEqual(all(db, "SELECT * FROM review_decisions ORDER BY 1"), decisions, "no decision is written");
    assert.equal(one(db, "SELECT status FROM source_releases WHERE release_id = ?", secondId).status, "ingested");
  });
}

test("no decision lifts the hold: relocationRejected / deferred after holding; direct SQL cannot lift or replace it", async () => {
  const { db, prior, itemId } = await candidate();
  await hold(db, itemId);
  for (const decision of ["relocationRejected", "deferred", "relocationConfirmed"] as const) {
    await decide(db, itemId, decision);
    assert.equal((await hold(db, itemId)).status, "alreadyHeld");
    assert.equal(spotOf(db, prior.spot_id).publication_hold, HOLD_RELOCATION_UNDER_REVIEW);
    assert.equal(spotOf(db, prior.spot_id).latitude, 35.7112);
  }
  for (const value of [null, "locationSuperseded"]) {
    assert.throws(() => db.raw.prepare("UPDATE spots SET publication_hold = ? WHERE spot_id = ?").run(value, prior.spot_id),
      /lifted only by its reviewed relocation application/);
  }
  assert.throws(() => db.raw.prepare("UPDATE review_relocation_holds SET applied_at = ?").run(LATER), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM review_relocation_holds").run(), /immutable/);
  await publishTiles(db, { now: LATER });
  assert.equal(published(db, prior.spot_id), 0, "a rejection never republishes the old coordinate");
});

test("the resolver does not consume the hold: a rerun after holding fails closed and writes nothing", async () => {
  const { db, secondId, itemId } = await candidate();
  await hold(db, itemId);
  const after = everything(db);
  await assert.rejects(resolve(db, secondId), /held \(relocationUnderReview\); carry-forward is not implemented/);
  assert.deepEqual(everything(db), after);
});

test("direct SQL: relocationUnderReview needs its hold row; a held spot cannot be inserted", async () => {
  const { db, prior } = await candidate();
  const other = entityOf(db, recordOf(db, one(db, "SELECT release_id FROM source_releases WHERE is_current = 1").release_id, 2)).spot_id;
  db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id IN (?, ?)").run(prior.spot_id, other);
  for (const id of [prior.spot_id, other]) {
    assert.throws(() => db.raw.prepare("UPDATE spots SET publication_hold = 'relocationUnderReview' WHERE spot_id = ?").run(id),
      /requires a review_relocation_hold/);
  }
  assert.throws(() => db.raw.prepare("UPDATE spots SET publication_hold = 'somethingElse' WHERE spot_id = ?").run(other), /CHECK/);
  assert.throws(() => db.raw.prepare(
    `INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type, lifecycle, evidence_quality,
       evidence_quality_version, resolver_version, created_at, updated_at, publication_hold)
     VALUES ('spot-held-0001', 'n', 35.7, 139.7, 14, 1, 1, '14/1/1', 'unknown', 'active', 'q', 'q.v1', 'r.v1', ?, ?, 'relocationUnderReview')`,
  ).run(NOW, NOW), /requires a review_relocation_hold/);
  // locationSuperseded keeps its 0004 meaning and path: no hold row needed.
  db.raw.prepare("UPDATE spots SET publication_hold = 'locationSuperseded' WHERE spot_id = ?").run(other);
  assert.equal(spotOf(db, other).publication_hold, "locationSuperseded");
});

test("mismatched ids: the hold row must name a relocationCandidate and its own spot, with the known executor", async () => {
  const { db, prior, itemId, identityItemId, firstId } = await candidate();
  const other = entityOf(db, recordOf(db, firstId, 2)).spot_id;
  const before = everything(db);
  assert.throws(() => insertHoldRow(db, itemId, other), INVALID_ROW, "another spot");
  assert.throws(() => insertHoldRow(db, identityItemId, prior.spot_id), INVALID_ROW, "an ambiguousMatch item");
  assert.throws(() => insertHoldRow(db, itemId, prior.spot_id, "review-relocation-hold.v0"), INVALID_ROW, "unknown executor version");
  assert.throws(() => insertHoldRow(db, 999_999, prior.spot_id), INVALID_ROW, "missing item");
  await assert.rejects(hold(db, identityItemId), RelocationHoldError);
  await assert.rejects(hold(db, 999_999), /does not exist/);
  // Cross-source: another adapter cannot hold this source's candidate.
  const foreign: SourceAdapter = { ...ADAPTER, registry: { ...ADAPTER.registry, sourceId: "test-other-source" } };
  await assert.rejects(hold(db, itemId, foreign), /belongs to test-relocation-hold, not to adapter source test-other-source/);
  assert.deepEqual(everything(db), before);
});

test("stale identity: a re-decided ambiguousMatch makes the candidate unholdable; re-recording the same entity keeps it", async () => {
  for (const [redecide, holdable] of [["deferred", false], ["confirmedNew", false], ["matchedToEntity", true]] as const) {
    const { db, prior, identityItemId, itemId } = await candidate();
    await decide(db, identityItemId, redecide, redecide === "matchedToEntity" ? prior.source_entity_id : undefined);
    const before = everything(db);
    if (holdable) {
      assert.equal((await hold(db, itemId)).status, "held", redecide);
    } else {
      await assert.rejects(hold(db, itemId), INVALID_ROW, redecide);
      assert.deepEqual(everything(db), before, `${redecide}: nothing written`);
      assert.equal(published(db, prior.spot_id), 1);
    }
  }
});

test("stale comparison: a competing release, an unknown observed_on, or a finished release refuses the hold", async () => {
  const cases: [string, (db: SqliteD1, secondId: number) => Promise<unknown> | unknown][] = [
    ["newer release", (db) => ingestRelease(db, ADAPTER, TAITO_BYTES, THIRD)],
    ["unknown observed_on", (db) => ingestRelease(db, ADAPTER, TAITO_BYTES, { ...THIRD, observedOn: null })],
    ["release rejected", (db, secondId) => db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(secondId)],
  ];
  for (const [name, stale] of cases) {
    const { db, secondId, prior, itemId } = await candidate();
    await stale(db, secondId);
    const before = everything(db);
    await assert.rejects(hold(db, itemId), INVALID_ROW, name);
    assert.deepEqual(everything(db), before, `${name}: nothing written`);
    assert.equal(published(db, prior.spot_id), 1);
  }
});

test("spot drift: moved, closed, merged or already held spots are refused and left as they are", async () => {
  const unpublish = (db: SqliteD1, id: string) => db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(id);
  const cases: [string, (db: SqliteD1, spotId: string, otherId: string) => void, RegExp][] = [
    // Migration 0015 refuses a direct coordinate update; the drift stands for a state written before that guard.
    ["coordinate changed", (db, id) => withoutTrigger(db.raw, "spots_coordinate_requires_relocation_application",
      () => db.raw.prepare("UPDATE spots SET latitude = 35.71121 WHERE spot_id = ?").run(id)), INVALID_ROW],
    ["temporarilyClosed", (db, id) => { unpublish(db, id); db.raw.prepare("UPDATE spots SET lifecycle = 'temporarilyClosed' WHERE spot_id = ?").run(id); }, INVALID_ROW],
    ["merged", (db, id, other) => { unpublish(db, id); db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(other, id); }, INVALID_ROW],
    ["locationSuperseded", (db, id) => { unpublish(db, id); db.raw.prepare("UPDATE spots SET publication_hold = 'locationSuperseded' WHERE spot_id = ?").run(id); },
      /already held \(locationSuperseded\); an existing hold is never overwritten/],
  ];
  for (const [name, drift, error] of cases) {
    const { db, firstId, prior, itemId } = await candidate();
    drift(db, prior.spot_id, entityOf(db, recordOf(db, firstId, 2)).spot_id);
    const before = everything(db);
    await assert.rejects(hold(db, itemId), error, name);
    assert.throws(() => insertHoldRow(db, itemId, prior.spot_id), INVALID_ROW, `${name}: the schema refuses it too`);
    assert.deepEqual(everything(db), before, `${name}: nothing written`);
  }
});


test("stale hold row: a valid row whose premise goes stale afterwards cannot set the hold (the transition re-checks it)", async () => {
  const setHold = (db: SqliteD1, id: string) => db.raw.prepare("UPDATE spots SET publication_hold = 'relocationUnderReview' WHERE spot_id = ?").run(id);
  const STALE_TRANSITION = /requires a review_relocation_hold whose relocationCandidate premise is still current/;
  const cases: [string, (s: Awaited<ReturnType<typeof candidate>>) => Promise<unknown> | unknown][] = [
    ["identity deferred", (s) => decide(s.db, s.identityItemId, "deferred")],
    ["identity confirmedNew", (s) => decide(s.db, s.identityItemId, "confirmedNew")],
    ["coordinate drift", (s) => withoutTrigger(s.db.raw, "spots_coordinate_requires_relocation_application",
      () => s.db.raw.prepare("UPDATE spots SET latitude = 35.71121 WHERE spot_id = ?").run(s.prior.spot_id))],
    ["candidate release rejected", (s) => s.db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(s.secondId)],
    ["newer release", (s) => ingestRelease(s.db, ADAPTER, TAITO_BYTES, THIRD)],
    ["incomparable release", (s) => ingestRelease(s.db, ADAPTER, TAITO_BYTES, { ...THIRD, observedOn: null })],
  ];
  for (const [name, stale] of cases) {
    const s = await candidate();
    insertHoldRow(s.db, s.itemId, s.prior.spot_id);
    await stale(s);
    s.db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(s.prior.spot_id);
    const before = spotOf(s.db, s.prior.spot_id);
    assert.throws(() => setHold(s.db, s.prior.spot_id), STALE_TRANSITION, name);
    assert.deepEqual(spotOf(s.db, s.prior.spot_id), before, `${name}: spot unchanged`);
  }
  // Control: with the premise still current the same direct transition is accepted, but not together
  // with a change of anything the premise reads.
  const s = await candidate();
  insertHoldRow(s.db, s.itemId, s.prior.spot_id);
  s.db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(s.prior.spot_id);
  assert.throws(() => s.db.raw.prepare("UPDATE spots SET publication_hold = 'relocationUnderReview', latitude = 35.7199 WHERE spot_id = ?")
    .run(s.prior.spot_id), new RegExp(`${STALE_TRANSITION.source}|coordinate or tile changes only through a reviewed relocation application`),
    "moved in the same update (0015's coordinate guard refuses it too)");
  setHold(s.db, s.prior.spot_id);
  assert.equal(spotOf(s.db, s.prior.spot_id).publication_hold, HOLD_RELOCATION_UNDER_REVIEW);
});

test("trust boundary: a forged alternate-mapping candidate the schema accepts is refused by the executor, nothing written", async () => {
  const { db, firstId, secondId, identityItemId, identityDecisionId, prior } = await identityDecided();
  const alternate = (recordId: number, latitude: number) => Number(db.raw.prepare(
    `INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, name, latitude, longitude, supports_paper,
       supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle_claim, field_provenance_json)
     SELECT record_id, release_id, source_id, 'alternate-mapping.v1', name, ?, longitude, supports_paper, supports_heated,
       opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle_claim, field_provenance_json
     FROM source_observations WHERE observation_id = ?`).run(latitude, observationOf(db, recordId)).lastInsertRowid);
  const previousRecord = recordOf(db, firstId, 1);
  const record = recordOf(db, secondId, 1);
  const previousCoordinate = { latitude: 35.7112, longitude: 139.77377 };
  const newCoordinate = { latitude: 35.7199, longitude: 139.77377 };
  const sha = (id: number) => one(db, "SELECT content_sha256 FROM source_releases WHERE release_id = ?", id).content_sha256;
  const forgedId = Number(db.raw.prepare(
    `INSERT INTO review_items (source_id, release_id, release_content_sha256, previous_release_id, kind, matcher_version,
       source_completeness, candidate_key, record_id, source_entity_id, spot_id, details_json, created_at)
     VALUES (?, ?, ?, ?, 'relocationCandidate', ?, 'partial', ?, ?, ?, ?, ?, ?)`,
  ).run(SOURCE, secondId, sha(secondId), firstId, CROSS_RELEASE_MATCHER_VERSION, `record:${record}|entity:${prior.source_entity_id}`,
    record, prior.source_entity_id, prior.spot_id, JSON.stringify({
      reason: "forged", previousRecordId: previousRecord, mappingVersion: "alternate-mapping.v1",
      previousObservationId: alternate(previousRecord, 35.7112), newObservationId: alternate(record, 35.7199),
      previousCoordinate, newCoordinate, distanceMetres: haversineMeters(previousCoordinate, newCoordinate), otherChangedFields: [],
      identity: { method: "reviewedMatch", reviewItemId: identityItemId, reviewDecisionId: identityDecisionId },
      matcherVersion: CROSS_RELEASE_MATCHER_VERSION, relocationPolicyVersion: RELOCATION_POLICY_VERSION, thresholdVersion: null,
      previousReleaseContentSha256: sha(firstId),
    }), LATER).lastInsertRowid);
  const before = everything(db);
  await assert.rejects(hold(db, forgedId), /cites mapping alternate-mapping\.v1, not the adapter's/);
  assert.deepEqual(everything(db), before, "no hold row, no unpublication, no hold");
  assert.equal(published(db, prior.spot_id), 1);
  // Under an adapter whose mapping is the forged one, the cited rows must still be that mapping's rows.
  const renamed: SourceAdapter = { ...ADAPTER, mappingVersion: "alternate-mapping.v1" };
  assert.equal((await hold(db, forgedId, renamed)).status, "held", "the schema checks cited rows only; the mapping authority is the adapter");
});

test("migration 0014 on a populated database: held rows kept, the three triggers recreated unchanged, integrity intact", () => {
  const db = migratedSqlite("0013_relocation_review_candidates.sql");
  const T = "2026-09-20T00:00:00Z";
  db.exec(`INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type, lifecycle, evidence_quality,
      evidence_quality_version, resolver_version, created_at, updated_at, publication_hold)
    VALUES ('spot-0001', 'n', 35.7, 139.7, 14, 1, 1, '14/1/1', 'unknown', 'active', 'q', 'q.v1', 'r.v1', '${T}', '${T}', 'locationSuperseded'),
           ('spot-0002', 'n', 35.7, 139.7, 14, 1, 1, '14/1/1', 'unknown', 'active', 'q', 'q.v1', 'r.v1', '${T}', '${T}', NULL)`);
  const triggers = () => db.prepare(`SELECT name, sql FROM sqlite_master WHERE name IN
    ('spots_published_stay_publishable', 'tile_snapshot_spots_publication_invariant', 'review_items_relocation_premise') ORDER BY name`).all();
  const columns = () => db.prepare("SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('spots')").all();
  const before = { triggers: triggers(), columns: columns(), rows: db.prepare("SELECT * FROM spots ORDER BY spot_id").all() };
  applyMigration(db, readFileSync(new URL("../migrations/0014_relocation_hold.sql", import.meta.url), "utf8"));
  assert.deepEqual({ triggers: triggers(), columns: columns(), rows: db.prepare("SELECT * FROM spots ORDER BY spot_id").all() }, before);
  assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE sql LIKE '%publication_hold_0004%'").get()!.n, 0);
});
