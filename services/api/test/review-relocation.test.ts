// Relocation candidate detection + review vocabulary (ADR-0009 implementation plan step A, Issue #93).
// The second releases below are ARTIFICIAL test fixtures derived from the one real Taito release under
// a test-only source, as in review-match.test.ts; they do not count as the two-real-release validation,
// and Taito's own gates stay closed. Nothing here applies a relocation: no coordinate, tile or hold moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbStatement } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { applyReviewedRemoval } from "../src/pipeline/removal.ts";
import { CROSS_RELEASE_MATCHER_VERSION } from "../src/pipeline/match.ts";
import { RELOCATION_POLICY_VERSION } from "../src/pipeline/relocation.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import {
  RELOCATION_REVIEW_DECISION_VERSION, REVIEW_DECISION_VERSION, type ReviewDecision, recordReviewDecision,
} from "../src/pipeline/review-queue.ts";
import { ReviewedMatchError } from "../src/pipeline/reviewed-match.ts";
import { type SourceAdapter, sourceCompleteness } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

const SOURCE = "test-review-relocation";
const LATER = "2026-09-26T03:00:00Z";
const RERUN = "2026-09-27T03:00:00Z";
const REVIEWER = "test-reviewer";

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules under an unapproved source, matcher gate open. */
const PARTIAL_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY relocation source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
  completeness: undefined, // undeclared -> partial
};
const COMPLETE_ADAPTER: SourceAdapter = { ...PARTIAL_ADAPTER, completeness: "complete" };

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const bytesOf = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));
const row1 = (edit: (line: string) => string) => bytesOf([LINES[0], edit(LINES[1]), ...LINES.slice(2)]);
// Row 1 is `1,...,上野公園前交番裏,...,35.7112,139.77377,`. `#` is not mapped into the observation.
const REF_CHANGED = row1((l) => l.replace(/^[^,]*/, "901"));
const SAME_NUMBER = row1((l) => l.replace(",35.7112,", ",35.711200,"));
const MOVED = row1((l) => l.replace(",35.7112,", ",35.7113,"));
const MOVED_AND_RENAMED = row1((l) => l.replace(",35.7112,", ",35.7113,").replace("上野公園前交番裏", "上野公園前交番裏（改）"));
const RENAMED = row1((l) => l.replace("上野公園前交番裏", "上野公園前交番裏（改）"));
const row1Of = (bytes: Uint8Array) => new TextDecoder().decode(bytes).split("\r\n")[1];
const moveLatitude = (line: string) => line.split(",").map((v, i) => (i === 9 ? (Number(v) + 0.0001).toFixed(6) : v)).join(",");
const MOVED_TWO = bytesOf([LINES[0], moveLatitude(LINES[1]), moveLatitude(LINES[2]), ...LINES.slice(3)]);
const DROPPED = bytesOf([LINES[0], ...LINES.slice(2)]);
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };
const THIRD = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-20", fetchedAt: "2026-09-26T00:00:00Z" };

async function setup(bytes: Uint8Array, adapter = PARTIAL_ADAPTER) {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY relocation source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'approved', ?, ?)`,
  ).run(SOURCE, NOW, NOW);
  const { releaseId: firstId } = await ingestRelease(db, adapter, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, adapter, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const { releaseId: secondId } = await ingestRelease(db, adapter, bytes, SECOND);
  const first = await resolve(db, adapter, secondId);
  assert.equal(first.status, "needsReview");
  const itemIds = first.status === "needsReview" ? first.reviewItemIds : [];
  const prior = entityOf(db, recordOf(db, firstId, 1));
  return { db, firstId, secondId, itemId: itemIds[0], itemIds, prior };
}
const resolve = (db: SqliteD1, adapter: SourceAdapter, releaseId: number, now = LATER) =>
  resolveFirstRelease(db, adapter, releaseId, { now, newSpotId: sequentialSpotIds("B") });
const decide = (db: SqliteD1, reviewItemId: number, decision: ReviewDecision, sourceEntityId?: number) =>
  recordReviewDecision(db, { reviewItemId, decision, sourceEntityId, decidedBy: REVIEWER, decidedAt: LATER });

/** Everything canonical or published, release state, and the application/audit tables. */
function canonical(db: SqliteD1) {
  return Object.fromEntries(["source_entities", "source_record_entities", "source_record_match_keys", "spots",
    "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots",
    "source_releases", "review_match_applications", "review_removal_applications", "review_removal_resolutions"]
    .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
}
const recordOf = (db: SqliteD1, releaseId: number, ordinal: number) =>
  one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = ?", releaseId, ordinal).record_id as number;
const entityOf = (db: SqliteD1, recordId: number) =>
  one(db, `SELECT e.source_entity_id, l.spot_id FROM source_record_entities e
    JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id WHERE e.record_id = ?`, recordId) as { source_entity_id: number; spot_id: string };
const observationOf = (db: SqliteD1, recordId: number) => one(db,
  "SELECT observation_id FROM source_observations WHERE record_id = ? AND mapping_version = ?", recordId, PARTIAL_ADAPTER.mappingVersion).observation_id as number;
const relocations = (db: SqliteD1) => all(db, "SELECT * FROM review_items WHERE kind = 'relocationCandidate' ORDER BY review_item_id");

/** MOVED, reviewed as the same entity, resolved once: one relocationCandidate. */
async function relocated(bytes = MOVED) {
  const s = await setup(bytes);
  const identityDecisionId = await decide(s.db, s.itemId, "matchedToEntity", s.prior.source_entity_id);
  const before = canonical(s.db);
  const result = await resolve(s.db, PARTIAL_ADAPTER, s.secondId);
  const [item] = relocations(s.db);
  return { ...s, identityDecisionId, before, result, item };
}

function insertItem(db: SqliteD1, base: Row, over: Row = {}, details: Row = {}) {
  const r = { ...base, ...over, details_json: JSON.stringify({ ...JSON.parse(base.details_json), ...details }) };
  db.raw.prepare(
    `INSERT INTO review_items (source_id, release_id, release_content_sha256, previous_release_id, kind, matcher_version,
       source_completeness, candidate_key, record_id, source_entity_id, spot_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.source_id, r.release_id, r.release_content_sha256, r.previous_release_id, r.kind, r.matcher_version,
    r.source_completeness, r.candidate_key, r.record_id, r.source_entity_id, r.spot_id, r.details_json, r.created_at);
}
const insertDecision = (db: SqliteD1, itemId: number, decision: string, version: string, sourceEntityId: number | null = null) =>
  db.raw.prepare(`INSERT INTO review_decisions (review_item_id, decision, decision_version, source_entity_id, decided_by, decided_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(itemId, decision, version, sourceEntityId, REVIEWER, LATER);
const PREMISE = /relocationCandidate premise does not hold/;
const NOT_VALID = /not valid for this review item/;

test("Taito keeps partial completeness, no natural key and the closed second-release gate", () => {
  assert.equal(sourceCompleteness(TAITO_ADAPTER), "partial");
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal("naturalKey" in TAITO_ADAPTER, false);
});

test("matchedToEntity with an unchanged observation: the reviewed match is applied as before, no relocation item", async () => {
  const { db, secondId, itemId, prior } = await setup(REF_CHANGED);
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.equal(result.status, "resolved");
  assert.equal(one(db, "SELECT count(*) AS n FROM review_match_applications").n, 1);
  assert.equal(one(db, "SELECT method FROM source_record_entities WHERE record_id = ?", recordOf(db, secondId, 1)).method, "manual");
  assert.deepEqual(relocations(db), []);
});

test("35.7112 and 35.711200 are the same number: not a relocation; the reviewed match is applied", async () => {
  const { db, secondId, itemId, prior } = await setup(SAME_NUMBER);
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  assert.equal((await resolve(db, PARTIAL_ADAPTER, secondId)).status, "resolved");
  assert.deepEqual(relocations(db), []);
  assert.equal(one(db, "SELECT latitude FROM spots WHERE spot_id = ?", prior.spot_id).latitude, 35.7112);
});

test("coordinate-only change: relocationCandidate, needsReview, release ingested, nothing canonical written", async () => {
  const { db, secondId, firstId, prior, before, result, item } = await relocated();
  assert.deepEqual(result, { status: "needsReview", reviewItemIds: [item.review_item_id] });
  assert.deepEqual(canonical(db), before, "no link, spot, coordinate, tile, provenance, match key, application or release state");
  assert.deepEqual(one(db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", secondId), { status: "ingested", is_current: 0 });
  assert.deepEqual(one(db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", firstId), { status: "applied", is_current: 1 });
  const spot = one(db, "SELECT latitude, longitude, tile_id, publication_hold FROM spots WHERE spot_id = ?", prior.spot_id);
  assert.deepEqual([spot.latitude, spot.publication_hold], [35.7112, null]);
  const record = recordOf(db, secondId, 1);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_record_entities WHERE record_id = ?", record).n, 0);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_record_match_keys WHERE record_id = ?", record).n, 0);
  assert.deepEqual({ ...item, details_json: undefined, review_item_id: undefined }, {
    review_item_id: undefined, source_id: SOURCE, release_id: secondId,
    release_content_sha256: one(db, "SELECT content_sha256 FROM source_releases WHERE release_id = ?", secondId).content_sha256,
    previous_release_id: firstId, kind: "relocationCandidate", matcher_version: CROSS_RELEASE_MATCHER_VERSION,
    source_completeness: "partial", candidate_key: `record:${record}|entity:${prior.source_entity_id}`,
    record_id: record, source_entity_id: prior.source_entity_id, spot_id: prior.spot_id, details_json: undefined, created_at: LATER,
  });
});

test("details_json: coordinates, previous record, identity, versions, fingerprint, informational distance", async () => {
  const { db, firstId, identityDecisionId, itemId, item } = await relocated();
  const previous = { latitude: 35.7112, longitude: 139.77377 };
  const next = { latitude: 35.7113, longitude: 139.77377 };
  assert.deepEqual(JSON.parse(item.details_json), {
    reason: "a reviewer matched this record to the entity, and its observed coordinate differs from the previous record's; the move is pending relocation review and nothing canonical changed",
    previousRecordId: recordOf(db, firstId, 1),
    mappingVersion: PARTIAL_ADAPTER.mappingVersion,
    previousObservationId: observationOf(db, recordOf(db, firstId, 1)),
    newObservationId: observationOf(db, item.record_id),
    previousCoordinate: previous,
    newCoordinate: next,
    distanceMetres: haversineMeters(previous, next),
    otherChangedFields: [],
    identity: { method: "reviewedMatch", reviewItemId: itemId, reviewDecisionId: identityDecisionId },
    matcherVersion: CROSS_RELEASE_MATCHER_VERSION,
    relocationPolicyVersion: RELOCATION_POLICY_VERSION,
    thresholdVersion: null,
    previousReleaseContentSha256: one(db, "SELECT content_sha256 FROM source_releases WHERE release_id = ?", firstId).content_sha256,
  });
  assert.equal(RELOCATION_POLICY_VERSION, "relocation-policy.v1");
  const distance = JSON.parse(item.details_json).distanceMetres;
  assert.ok(distance > 11 && distance < 11.2, `about 11 m, got ${distance}`);
});

test("rerun: the same relocationCandidate id, no duplicate; decisions of every v2 kind are not consumed", async () => {
  const { db, secondId, before, result, item } = await relocated();
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result);
  assert.equal(relocations(db).length, 1);
  assert.equal(relocations(db)[0].created_at, LATER, "stored item kept as it is");
  for (const decision of ["deferred", "relocationRejected", "relocationConfirmed"] as const) {
    const id = await decide(db, item.review_item_id, decision);
    assert.deepEqual(one(db, "SELECT decision, decision_version, source_entity_id FROM review_decisions WHERE review_decision_id = ?", id),
      { decision, decision_version: RELOCATION_REVIEW_DECISION_VERSION, source_entity_id: null });
    assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result, `${decision} is not applied`);
    assert.deepEqual(canonical(db), before, `${decision}: no coordinate update, no release application`);
  }
  assert.equal(RELOCATION_REVIEW_DECISION_VERSION, "review-decision.v2");
  assert.equal(REVIEW_DECISION_VERSION, "review-decision.v1", "v1 keeps its meaning");
});

test("an open or deferred ambiguousMatch is answered first: no relocation item before identity is decided", async () => {
  const { db, secondId, itemId, prior } = await setup(MOVED);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId), { status: "needsReview", reviewItemIds: [itemId] });
  await decide(db, itemId, "deferred");
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId), { status: "needsReview", reviewItemIds: [itemId] });
  assert.deepEqual(relocations(db), []);
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.deepEqual(result, { status: "needsReview", reviewItemIds: [relocations(db)[0].review_item_id] });
});

test("coordinate and another observed field changed: relocationCandidate records it; no value is updated", async () => {
  const { db, before, result, item, prior } = await relocated(MOVED_AND_RENAMED);
  assert.equal(result.status, "needsReview");
  assert.deepEqual(JSON.parse(item.details_json).otherChangedFields, ["name"]);
  assert.deepEqual(canonical(db), before);
  assert.equal(one(db, "SELECT name FROM spots WHERE spot_id = ?", prior.spot_id).name, "上野公園前交番裏");
});

test("same coordinate, another field changed: the existing value-update refusal, no relocationCandidate", async () => {
  const { db, secondId, itemId, prior } = await setup(RENAMED);
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  const before = canonical(db);
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), /value update policy is not implemented/);
  assert.deepEqual(canonical(db), before);
  assert.deepEqual(relocations(db), []);
});

for (const [name, breakSpot] of [
  ["merged", (db: SqliteD1, spotId: string) => {
    const target = one(db, "SELECT spot_id FROM spots WHERE spot_id <> ? ORDER BY spot_id LIMIT 1", spotId).spot_id;
    db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(target, spotId);
  }],
  ["temporarilyClosed", (db: SqliteD1, spotId: string) => db.raw.prepare("UPDATE spots SET lifecycle = 'temporarilyClosed' WHERE spot_id = ?").run(spotId)],
] as const) {
  test(`spot ${name}: no relocationCandidate, refused by the resolver and by the schema`, async () => {
    const { db, secondId, itemId, prior } = await setup(MOVED);
    await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
    await resolve(db, PARTIAL_ADAPTER, secondId);
    const [item] = relocations(db);
    db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(prior.spot_id);
    breakSpot(db, prior.spot_id);
    assert.throws(() => insertItem(db, item), PREMISE, "the schema re-checks the spot");

    const fresh = await setup(MOVED);
    await decide(fresh.db, fresh.itemId, "matchedToEntity", fresh.prior.source_entity_id);
    fresh.db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(fresh.prior.spot_id);
    breakSpot(fresh.db, fresh.prior.spot_id);
    const before = canonical(fresh.db);
    await assert.rejects(resolve(fresh.db, PARTIAL_ADAPTER, fresh.secondId), (e) => e instanceof ReviewedMatchError && /active, unmerged/.test(e.message));
    assert.deepEqual(relocations(fresh.db), []);
    assert.deepEqual(canonical(fresh.db), before);
  });
}

test("spot removed by an applied reviewed removal: no relocationCandidate, never revived", async () => {
  // A: first release; B drops record 1 -> removal applied; B rejected; C moves record 1.
  const { db, firstId, secondId, itemId: removalItem, prior } = await setup(DROPPED, COMPLETE_ADAPTER);
  await decide(db, removalItem, "removalConfirmed");
  assert.equal((await applyReviewedRemoval(db, removalItem, { now: LATER })).status, "applied");
  db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(secondId);
  const { releaseId: thirdId } = await ingestRelease(db, COMPLETE_ADAPTER, MOVED, THIRD);
  const third = await resolve(db, COMPLETE_ADAPTER, thirdId);
  assert.equal(third.status, "needsReview");
  await decide(db, third.status === "needsReview" ? third.reviewItemIds[0] : 0, "matchedToEntity", prior.source_entity_id);
  const before = canonical(db);
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, thirdId), /spot is removed; a relocation needs an active, unmerged spot/);
  assert.deepEqual(canonical(db), before);
  assert.deepEqual(relocations(db), []);
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", prior.spot_id).lifecycle, "removed");
  assert.equal(firstId, one(db, "SELECT release_id FROM source_releases WHERE is_current = 1").release_id);
});

test("an unrelated publication_hold: refused, the hold is left as it is, no relocationCandidate", async () => {
  const { db, secondId, itemId, prior } = await setup(MOVED);
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(prior.spot_id);
  db.raw.prepare("UPDATE spots SET publication_hold = 'locationSuperseded' WHERE spot_id = ?").run(prior.spot_id);
  const before = canonical(db);
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), /held \(locationSuperseded\); carry-forward is not implemented/);
  assert.deepEqual(canonical(db), before);
  assert.equal(one(db, "SELECT publication_hold FROM spots WHERE spot_id = ?", prior.spot_id).publication_hold, "locationSuperseded");
  assert.deepEqual(relocations(db), []);
});

test("stale comparison: a newer competing release refuses the candidate in the resolver and in the schema", async () => {
  const { db, secondId, itemId, prior } = await setup(MOVED);
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  await resolve(db, PARTIAL_ADAPTER, secondId);
  const [item] = relocations(db);
  const fresh = await setup(MOVED);
  await decide(fresh.db, fresh.itemId, "matchedToEntity", fresh.prior.source_entity_id);
  await ingestRelease(fresh.db, PARTIAL_ADAPTER, TAITO_BYTES, THIRD);
  await assert.rejects(resolve(fresh.db, PARTIAL_ADAPTER, fresh.secondId), /competes/);
  assert.deepEqual(relocations(fresh.db), []);

  assert.throws(() => insertItem(db, item), /UNIQUE/, "no competitor yet: only the stored identity collides");
  const { releaseId: unknownId } = await ingestRelease(db, PARTIAL_ADAPTER, TAITO_BYTES, { ...THIRD, observedOn: null });
  assert.throws(() => insertItem(db, item), PREMISE, "an unknown observed_on is not comparable");
  db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(unknownId);
  await ingestRelease(db, PARTIAL_ADAPTER, REF_CHANGED, THIRD);
  assert.throws(() => insertItem(db, item), PREMISE, "a newer release");
});

test("schema: a relocationCandidate must name its identity ambiguousMatch item and that item's latest matchedToEntity decision", async () => {
  const { db, firstId, itemId, identityDecisionId, item, prior } = await relocated();
  const other = entityOf(db, recordOf(db, firstId, 2));
  // Every variant below differs from the stored item only in what the trigger checks, so it hits the
  // trigger before the UNIQUE identity.
  const identity = (o: Row) => ({ identity: { method: "reviewedMatch", reviewItemId: itemId, reviewDecisionId: identityDecisionId, ...o } });
  assert.throws(() => insertItem(db, item, {}, identity({ reviewItemId: item.review_item_id })), PREMISE, "not an ambiguousMatch item");
  assert.throws(() => insertItem(db, item, {}, identity({ reviewDecisionId: 999 })), PREMISE, "unknown decision");
  assert.throws(() => insertItem(db, item, {}, identity({ reviewItemId: String(itemId) })), PREMISE, "ids are integers");
  assert.throws(() => insertItem(db, item, {}, identity({ method: "naturalKey" })), PREMISE, "no natural key path in step A");
  assert.throws(() => insertItem(db, item, { candidate_key: "x" }), /inconsistent/, "candidate_key is fixed");
  assert.throws(() => insertItem(db, item, { spot_id: null }), /inconsistent|premise does not hold/);
  assert.throws(() => insertItem(db, item, { source_entity_id: other.source_entity_id,
    candidate_key: `record:${item.record_id}|entity:${other.source_entity_id}` }), PREMISE, "an entity that is not the decided one");
  assert.throws(() => insertItem(db, item, { spot_id: other.spot_id }), PREMISE, "another spot");
  assert.throws(() => insertItem(db, item, {}, { previousRecordId: recordOf(db, firstId, 2) }), PREMISE, "another previous record");
  assert.throws(() => insertItem(db, item, {}, { newCoordinate: { latitude: 35.7112, longitude: 139.77377 } }), PREMISE, "no coordinate change");
  assert.throws(() => insertItem(db, item, {}, { newCoordinate: { latitude: 35.7114, longitude: 139.77377 } }), PREMISE, "not the stored observation");
  assert.throws(() => insertItem(db, item, {}, { relocationPolicyVersion: "relocation-policy.v0" }), PREMISE);
  assert.throws(() => insertItem(db, item, {}, { thresholdVersion: "t.v1" }), PREMISE);
  assert.throws(() => insertItem(db, item, {}, { previousReleaseContentSha256: "0".repeat(64) }), PREMISE);
  assert.throws(() => insertItem(db, item, { matcher_version: "other.v1" }), PREMISE);
  // The unchanged row passes every trigger and meets only the UNIQUE identity.
  assert.throws(() => insertItem(db, item), /UNIQUE/);

  assert.throws(() => insertItem(db, item, {}, { newObservationId: observationOf(db, recordOf(db, firstId, 1)) }), PREMISE, "another observation row");
  assert.throws(() => insertItem(db, item, {}, { mappingVersion: "other-mapping.v1" }), PREMISE, "another mapping version");
  // Re-recording the same choice keeps the premise (creation evidence may be an earlier decision); any
  // other latest identity decision makes it fail.
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  assert.throws(() => insertItem(db, item), /UNIQUE/, "same entity re-decided: premise still holds");
  await decide(db, itemId, "deferred");
  assert.throws(() => insertItem(db, item), PREMISE, "identity no longer decided");
});

test("exact observation binding: an observation under another mapping version never satisfies the premise", async () => {
  const { db, firstId, secondId, item } = await relocated();
  const alternate = (recordId: number, latitude: number) => Number(db.raw.prepare(
    `INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, name, latitude, longitude, supports_paper,
       supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle_claim, field_provenance_json)
     SELECT record_id, release_id, source_id, 'alternate-mapping.v1', name, ?, longitude, supports_paper, supports_heated,
       opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle_claim, field_provenance_json
     FROM source_observations WHERE observation_id = ?`).run(latitude, observationOf(db, recordId)).lastInsertRowid);
  const altNew = alternate(recordOf(db, secondId, 1), 35.7199);
  const altPrevious = alternate(recordOf(db, firstId, 1), 35.7188);
  // The resolver keeps reading the adapter's mapping: the same accepted candidate, bound to its rows.
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), { status: "needsReview", reviewItemIds: [item.review_item_id] });
  const details = JSON.parse(relocations(db)[0].details_json);
  assert.equal(details.mappingVersion, PARTIAL_ADAPTER.mappingVersion);
  assert.equal(details.newObservationId, observationOf(db, item.record_id));
  const newCoordinate = { latitude: 35.7199, longitude: 139.77377 };
  // Forgeries that only an alternate-mapping row matches.
  assert.throws(() => insertItem(db, item, {}, { newCoordinate }), PREMISE, "alternate coordinate on the adapter's row");
  assert.throws(() => insertItem(db, item, {}, { newObservationId: altNew, newCoordinate }), PREMISE, "alternate row under the adapter's mapping");
  assert.throws(() => insertItem(db, item, {}, { mappingVersion: "alternate-mapping.v1", newObservationId: altNew, newCoordinate }), PREMISE,
    "previous observation is not under the alternate mapping");
  assert.throws(() => insertItem(db, item, {}, { mappingVersion: "alternate-mapping.v1", newObservationId: altNew, newCoordinate,
    previousObservationId: altPrevious, previousCoordinate: { latitude: 35.7188, longitude: 139.77377 } }), PREMISE,
    "both alternate rows: the spot does not hold that previous coordinate");
  assert.throws(() => insertItem(db, item), /UNIQUE/, "the genuine candidate still passes every trigger");
});

test("identity re-decided after the candidate: v2 decisions refused against the stale premise; the resolver fails closed", async () => {
  const { db, secondId, itemId, item, before } = await relocated();
  await decide(db, item.review_item_id, "deferred");
  await decide(db, itemId, "confirmedNew");
  for (const decision of ["relocationConfirmed", "relocationRejected", "deferred"] as const) {
    await assert.rejects(decide(db, item.review_item_id, decision), NOT_VALID);
  }
  // confirmedNew leaves the previous entity over: a disappearance, not the stale relocation.
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.equal(result.status, "needsReview");
  assert.equal(one(db, "SELECT kind FROM review_items WHERE review_item_id = ?", (result as any).reviewItemIds[0]).kind, "disappearance");
  assert.deepEqual(canonical(db), before);
});

test("identity re-decided to the same entity: the same candidate is kept, its evidence unchanged, v2 decisions still recordable", async () => {
  const { db, secondId, itemId, item, prior, before, result, identityDecisionId } = await relocated();
  const redecided = await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  assert.ok(redecided > identityDecisionId);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result, "same id, no differs error");
  assert.deepEqual(relocations(db), [item], "no duplicate; the stored item is unchanged");
  assert.equal(JSON.parse(relocations(db)[0].details_json).identity.reviewDecisionId, identityDecisionId, "creation evidence kept");
  await decide(db, item.review_item_id, "relocationConfirmed");
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result, "still not applied");
  assert.deepEqual(canonical(db), before);
});

test("identity re-decided as deferred: the old candidate is not actionable; the open ambiguity comes first", async () => {
  const { db, secondId, itemId, item, before } = await relocated();
  await decide(db, itemId, "deferred");
  await assert.rejects(decide(db, item.review_item_id, "relocationConfirmed"), NOT_VALID);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), { status: "needsReview", reviewItemIds: [itemId] });
  assert.deepEqual(canonical(db), before);
});

test("identity re-decided to another entity: old candidates not actionable; the resolver follows the latest identity", async () => {
  const { db, firstId, secondId, itemIds } = await setup(MOVED_TWO);
  const [e1, e2] = [1, 2].map((n) => entityOf(db, recordOf(db, firstId, n)).source_entity_id);
  await decide(db, itemIds[0], "matchedToEntity", e1);
  await decide(db, itemIds[1], "matchedToEntity", e2);
  const before = canonical(db);
  const first = await resolve(db, PARTIAL_ADAPTER, secondId);
  const old = relocations(db).map((r) => r.review_item_id);
  assert.deepEqual(first, { status: "needsReview", reviewItemIds: old });
  await decide(db, itemIds[0], "matchedToEntity", e2);
  await decide(db, itemIds[1], "matchedToEntity", e1);
  for (const id of old) await assert.rejects(decide(db, id, "relocationConfirmed"), NOT_VALID);
  const second = await resolve(db, PARTIAL_ADAPTER, secondId);
  const fresh = relocations(db).filter((r) => !old.includes(r.review_item_id));
  assert.deepEqual(second, { status: "needsReview", reviewItemIds: fresh.map((r) => r.review_item_id) });
  assert.deepEqual(fresh.map((r) => [r.record_id, r.source_entity_id]), [[recordOf(db, secondId, 1), e2], [recordOf(db, secondId, 2), e1]]);
  assert.deepEqual(canonical(db), before);
});

test("ordering: an unresolved removal is reviewed before a same-coordinate value change is refused", async () => {
  // Record 1 renamed (same coordinate, reviewed as its entity), record 2 dropped (complete source).
  const { db, firstId, secondId, itemIds } = await setup(bytesOf([LINES[0], row1Of(RENAMED), ...LINES.slice(3)]), COMPLETE_ADAPTER);
  const [e1] = [entityOf(db, recordOf(db, firstId, 1)).source_entity_id];
  await decide(db, itemIds[0], "matchedToEntity", e1);
  const before = canonical(db);
  const result = await resolve(db, COMPLETE_ADAPTER, secondId);
  const removal = one(db, "SELECT review_item_id FROM review_items WHERE kind = 'removalCandidate'").review_item_id;
  assert.deepEqual(result, { status: "needsReview", reviewItemIds: [removal] }, "not stopped by the value-update refusal first");
  assert.deepEqual(canonical(db), before);
  await decide(db, removal, "removalConfirmed");
  assert.equal((await applyReviewedRemoval(db, removal, { now: LATER })).status, "applied");
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, secondId, RERUN), /value update policy is not implemented/);
  assert.deepEqual(relocations(db), []);
});

test("race: re-recording the same identity choice between read and insert is safe", async () => {
  const { db, secondId, itemId, prior } = await setup(MOVED);
  const identityDecisionId = await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  const batch = db.batch.bind(db);
  let raced = false;
  db.batch = async (statements: DbStatement[]) => {
    if (!raced && statements.some((s) => (s as unknown as { values: unknown[] }).values.includes("relocationCandidate"))) {
      raced = true;
      db.raw.prepare(`INSERT INTO review_decisions (review_item_id, decision, decision_version, source_entity_id, decided_by, decided_at)
        VALUES (?, 'matchedToEntity', 'review-decision.v1', ?, ?, ?)`).run(itemId, prior.source_entity_id, REVIEWER, RERUN);
    }
    return batch(statements);
  };
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.ok(raced);
  const [item] = relocations(db);
  assert.deepEqual(result, { status: "needsReview", reviewItemIds: [item.review_item_id] });
  assert.equal(JSON.parse(item.details_json).identity.reviewDecisionId, identityDecisionId);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result);
  await decide(db, item.review_item_id, "relocationConfirmed");
});

test("race: an identity decision changing its meaning (deferred) between read and insert aborts the insert", async () => {
  const { db, secondId, itemId, prior } = await setup(MOVED);
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  const before = canonical(db);
  const batch = db.batch.bind(db);
  let raced = false;
  db.batch = async (statements: DbStatement[]) => {
    if (!raced && statements.some((s) => (s as unknown as { values: unknown[] }).values.includes("relocationCandidate"))) {
      raced = true;
      db.raw.prepare("INSERT INTO review_decisions (review_item_id, decision, decision_version, decided_by, decided_at) VALUES (?, 'deferred', 'review-decision.v1', ?, ?)")
        .run(itemId, REVIEWER, RERUN);
    }
    return batch(statements);
  };
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), PREMISE);
  assert.ok(raced);
  assert.deepEqual(relocations(db), []);
  assert.deepEqual(canonical(db), before);
});

test("review-decision.v2 only on a relocationCandidate, and only its vocabulary", async () => {
  const { db, item } = await relocated();
  const id = item.review_item_id;
  for (const decision of ["relocationConfirmed", "relocationRejected", "deferred"]) {
    assert.throws(() => insertDecision(db, id, decision, REVIEW_DECISION_VERSION), NOT_VALID, `${decision} v1 on a relocationCandidate`);
  }
  for (const decision of ["matchedToEntity", "confirmedNew", "removalConfirmed", "removalRejected"]) {
    assert.throws(() => insertDecision(db, id, decision, RELOCATION_REVIEW_DECISION_VERSION), NOT_VALID, `${decision} v2`);
    await assert.rejects(decide(db, id, decision as ReviewDecision), NOT_VALID);
  }
  assert.throws(() => insertDecision(db, id, "relocationConfirmed", RELOCATION_REVIEW_DECISION_VERSION, item.source_entity_id), NOT_VALID,
    "no entity on a relocation decision");
  assert.throws(() => insertDecision(db, id, "relocationConfirmed", "review-decision.v3"), NOT_VALID);
  for (const decision of ["relocationConfirmed", "relocationRejected", "deferred"]) insertDecision(db, id, decision, RELOCATION_REVIEW_DECISION_VERSION);
});

test("v1 kinds keep v1 only: v2 and relocation decisions refused on ambiguousMatch, disappearance and removalCandidate", async () => {
  const ambiguous = await setup(MOVED);
  const disappearance = await setup(DROPPED);
  const complete = await setup(DROPPED, COMPLETE_ADAPTER);
  for (const [db, itemId, kind] of [
    [ambiguous.db, ambiguous.itemId, "ambiguousMatch"], [disappearance.db, disappearance.itemId, "disappearance"],
    [complete.db, complete.itemId, "removalCandidate"],
  ] as const) {
    assert.equal(one(db, "SELECT kind FROM review_items WHERE review_item_id = ?", itemId).kind, kind);
    for (const version of [REVIEW_DECISION_VERSION, RELOCATION_REVIEW_DECISION_VERSION]) {
      for (const decision of ["relocationConfirmed", "relocationRejected"]) assert.throws(() => insertDecision(db, itemId, decision, version), NOT_VALID);
    }
    assert.throws(() => insertDecision(db, itemId, "deferred", RELOCATION_REVIEW_DECISION_VERSION), NOT_VALID, `${kind} + v2`);
    await assert.rejects(decide(db, itemId, "relocationConfirmed"), NOT_VALID);
    await assert.rejects(decide(db, itemId, "relocationRejected"), NOT_VALID);
    const v1 = await decide(db, itemId, "deferred");
    assert.equal(one(db, "SELECT decision_version FROM review_decisions WHERE review_decision_id = ?", v1).decision_version, REVIEW_DECISION_VERSION);
  }
});
