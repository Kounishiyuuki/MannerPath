// Review queue (ADR-0008 decisions 5 and 8, Issue #80). The second releases below are ARTIFICIAL test
// fixtures derived from the one real Taito release under a test-only source, as in
// cross-release-match.test.ts; they do not count as the two-real-release validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { CROSS_RELEASE_MATCHER_VERSION } from "../src/pipeline/match.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { REVIEW_DECISION_VERSION, recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { type SourceAdapter, sourceCompleteness } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, TEST_BLOCKED_SOURCE, addBlockedTestSource, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

const SOURCE = "test-review-queue";
const LATER = "2026-09-26T03:00:00Z";
const RERUN = "2026-09-27T03:00:00Z";
const REVIEWER = "test-reviewer";

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules under an unapproved source, matcher gate open. */
const PARTIAL_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY review queue source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
  completeness: undefined, // undeclared -> partial
};
/** TEST ONLY: the same source declared complete, so a disappearance is a removal candidate. */
const COMPLETE_ADAPTER: SourceAdapter = { ...PARTIAL_ADAPTER, completeness: "complete" };

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const bytesOf = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));
const CHANGED = bytesOf([LINES[0], LINES[1].replace("上野公園前交番裏", "上野公園前交番裏（改）"), ...LINES.slice(2)]);
const DROPPED = bytesOf([LINES[0], ...LINES.slice(2)]);
// Record 1 twice without its `#` (unique per release when present): two new records with identical
// raw values, both competing for record 1's entity.
const NO_REF = LINES[1].replace(/^[^,]*/, "");
const DUPLICATED = bytesOf([LINES[0], NO_REF, NO_REF, ...LINES.slice(2)]);
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };

function freshDb() {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY review queue source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'approved', ?, ?)`,
  ).run(SOURCE, NOW, NOW);
  return db;
}
async function setup(bytes: Uint8Array, adapter = PARTIAL_ADAPTER) {
  const db = freshDb();
  const { releaseId: firstId } = await ingestRelease(db, adapter, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, adapter, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const { releaseId: secondId } = await ingestRelease(db, adapter, bytes, SECOND);
  return { db, firstId, secondId };
}
const resolve = (db: SqliteD1, adapter: SourceAdapter, releaseId: number, now = LATER) =>
  resolveFirstRelease(db, adapter, releaseId, { now, newSpotId: sequentialSpotIds("B") });

/** Everything canonical or published, plus release state: none of it may move while under review. */
function canonical(db: SqliteD1) {
  return Object.fromEntries(["source_entities", "source_record_entities", "source_record_match_keys", "spots",
    "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots", "source_releases"]
    .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
}
const recordOf = (db: SqliteD1, releaseId: number, ordinal: number) =>
  one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = ?", releaseId, ordinal).record_id as number;
const entityOf = (db: SqliteD1, recordId: number) =>
  one(db, `SELECT e.source_entity_id, l.spot_id FROM source_record_entities e
    JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id WHERE e.record_id = ?`, recordId);

test("Taito keeps partial completeness and the closed second-release gate", () => {
  assert.equal(TAITO_ADAPTER.completeness, "partial");
  assert.equal(sourceCompleteness(TAITO_ADAPTER), "partial");
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal(sourceCompleteness({ ...TAITO_ADAPTER, completeness: undefined }), "partial", "undeclared is partial, never complete");
});

test("ambiguous (changed record): stored as a review item, canonical unchanged, release ingested, rerun idempotent", async () => {
  const { db, firstId, secondId } = await setup(CHANGED);
  const before = canonical(db);
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.equal(result.status, "needsReview");
  assert.deepEqual(canonical(db), before);
  assert.equal(one(db, "SELECT status FROM source_releases WHERE release_id = ?", secondId).status, "ingested");

  const previous = entityOf(db, recordOf(db, firstId, 1));
  const items = all(db, "SELECT * FROM review_items");
  assert.equal(items.length, 1);
  const [item] = items;
  assert.deepEqual(result.status === "needsReview" && result.reviewItemIds, [item.review_item_id]);
  assert.equal(item.kind, "ambiguousMatch");
  assert.equal(item.source_id, SOURCE);
  assert.equal(item.release_id, secondId);
  assert.equal(item.previous_release_id, firstId);
  assert.equal(item.release_content_sha256, one(db, "SELECT content_sha256 FROM source_releases WHERE release_id = ?", secondId).content_sha256);
  assert.equal(item.matcher_version, CROSS_RELEASE_MATCHER_VERSION);
  assert.equal(item.source_completeness, "partial");
  assert.equal(item.record_id, recordOf(db, secondId, 1));
  assert.equal(item.candidate_key, `record:${item.record_id}|entities:${previous.source_entity_id}`);
  const details = JSON.parse(item.details_json);
  assert.deepEqual(details.candidateEntityIds, [previous.source_entity_id]);
  assert.equal("candidateSpotIds" in details, false, "candidate spots are read from spot_source_entities");
  assert.match(details.reason, /no reviewed natural-key policy/);

  const rerun = await resolve(db, PARTIAL_ADAPTER, secondId, RERUN);
  assert.deepEqual(rerun, result, "same input -> same review item");
  assert.deepEqual(all(db, "SELECT * FROM review_items"), items, "no duplicate, created_at kept");
  assert.deepEqual(canonical(db), before);
});

test("ambiguous (duplicate new raw values): one item per competing record, never a silent new entity", async () => {
  const { db, firstId, secondId } = await setup(DUPLICATED);
  const before = canonical(db);
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.equal(result.status, "needsReview");
  const entity = entityOf(db, recordOf(db, firstId, 1)).source_entity_id;
  assert.deepEqual(all(db, "SELECT kind, record_id, json_extract(details_json, '$.candidateEntityIds') AS c FROM review_items ORDER BY record_id"),
    [1, 2].map((ordinal) => ({ kind: "ambiguousMatch", record_id: recordOf(db, secondId, ordinal), c: `[${entity}]` })));
  assert.deepEqual(canonical(db), before);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result);
  assert.equal(one(db, "SELECT count(*) AS n FROM review_items").n, 2);
});

test("disappearance from a partial source: a disappearance item, not removal; spot, lifecycle and publication unchanged", async () => {
  const { db, firstId, secondId } = await setup(DROPPED);
  const before = canonical(db);
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.equal(result.status, "needsReview");
  assert.deepEqual(canonical(db), before, "no lifecycle, coordinate, hold, provenance, tile or release change");

  const gone = entityOf(db, recordOf(db, firstId, 1));
  const [item] = all(db, "SELECT * FROM review_items");
  assert.equal(item.kind, "disappearance");
  assert.equal(item.source_completeness, "partial");
  assert.equal(item.source_entity_id, gone.source_entity_id);
  assert.equal(item.spot_id, gone.spot_id);
  assert.equal(item.previous_release_id, firstId);
  assert.equal(item.release_id, secondId);
  assert.equal(item.matcher_version, CROSS_RELEASE_MATCHER_VERSION);
  assert.equal(item.record_id, null);
  assert.deepEqual(JSON.parse(item.details_json).previousRecordId, recordOf(db, firstId, 1));
  const spot = one(db, "SELECT lifecycle, publication_hold FROM spots WHERE spot_id = ?", gone.spot_id);
  assert.deepEqual(spot, { lifecycle: "active", publication_hold: null });
  assert.ok(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", gone.spot_id).n === 1, "still published");

  // Partial disappearance is not removal evidence, so it cannot even be confirmed as a removal.
  await assert.rejects(recordReviewDecision(db, { reviewItemId: item.review_item_id, decision: "removalConfirmed", decidedBy: REVIEWER, decidedAt: RERUN }),
    /not valid for this review item/);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result);
  assert.equal(one(db, "SELECT count(*) AS n FROM review_items").n, 1);
});

test("disappearance from a complete (test-only) source: a removal candidate, still nothing canonical changes", async () => {
  const { db, firstId, secondId } = await setup(DROPPED, COMPLETE_ADAPTER);
  const before = canonical(db);
  const result = await resolve(db, COMPLETE_ADAPTER, secondId);
  assert.equal(result.status, "needsReview");
  const [item] = all(db, "SELECT * FROM review_items");
  assert.equal(item.kind, "removalCandidate");
  assert.equal(item.source_completeness, "complete");
  assert.equal(item.source_entity_id, entityOf(db, recordOf(db, firstId, 1)).source_entity_id);
  assert.deepEqual(canonical(db), before);
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", item.spot_id).lifecycle, "active");
});

test("review decisions are append-only evidence: stored with reviewer/time/version/note, spots unchanged", async () => {
  const { db, secondId } = await setup(DROPPED, COMPLETE_ADAPTER);
  const result = await resolve(db, COMPLETE_ADAPTER, secondId);
  assert.equal(result.status, "needsReview");
  const [reviewItemId] = result.status === "needsReview" ? result.reviewItemIds : [];
  const before = canonical(db);
  const decisionId = await recordReviewDecision(db, {
    reviewItemId, decision: "removalConfirmed", decidedBy: REVIEWER, decidedAt: RERUN, note: "test: confirmed gone on site",
  });
  assert.deepEqual(one(db, "SELECT * FROM review_decisions WHERE review_decision_id = ?", decisionId), {
    review_decision_id: decisionId, review_item_id: reviewItemId, decision: "removalConfirmed",
    decision_version: REVIEW_DECISION_VERSION, source_entity_id: null, decided_by: REVIEWER, decided_at: RERUN,
    note: "test: confirmed gone on site",
  });
  assert.deepEqual(canonical(db), before, "recording a decision applies nothing");
  assert.equal(one(db, "SELECT count(*) AS n FROM spots WHERE lifecycle = 'removed'").n, 0);
  // Still under review for the resolver: it never reads decisions, and applying one is the separate
  // removal executor (review-removal.test.ts), so the release is not applied.
  assert.deepEqual(await resolve(db, COMPLETE_ADAPTER, secondId, RERUN), result);

  assert.throws(() => db.raw.prepare("UPDATE review_decisions SET decision = 'removalRejected'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM review_decisions").run(), /immutable/);
  assert.throws(() => db.raw.prepare("UPDATE review_items SET kind = 'disappearance'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM review_items").run(), /immutable/);
  await assert.rejects(recordReviewDecision(db, { reviewItemId, decision: "deferred", decidedBy: " ", decidedAt: RERUN }), /CHECK/);
});

test("an ambiguous item accepts only one of its candidates, or confirmedNew", async () => {
  const { db, firstId, secondId } = await setup(CHANGED);
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  const [reviewItemId] = result.status === "needsReview" ? result.reviewItemIds : [];
  const candidate = entityOf(db, recordOf(db, firstId, 1)).source_entity_id;
  const other = entityOf(db, recordOf(db, firstId, 2)).source_entity_id;
  const before = canonical(db);
  await assert.rejects(recordReviewDecision(db, { reviewItemId, decision: "matchedToEntity", sourceEntityId: other, decidedBy: REVIEWER, decidedAt: RERUN }),
    /not valid/);
  await assert.rejects(recordReviewDecision(db, { reviewItemId, decision: "removalConfirmed", decidedBy: REVIEWER, decidedAt: RERUN }), /not valid/);
  await recordReviewDecision(db, { reviewItemId, decision: "matchedToEntity", sourceEntityId: candidate, decidedBy: REVIEWER, decidedAt: RERUN });
  await recordReviewDecision(db, { reviewItemId, decision: "confirmedNew", decidedBy: REVIEWER, decidedAt: RERUN, note: "supersedes" });
  assert.equal(one(db, "SELECT count(*) AS n FROM review_decisions WHERE review_item_id = ?", reviewItemId).n, 2);
  assert.deepEqual(canonical(db), before);
});

test("the schema refuses a partial removal candidate and a cross-source item", async () => {
  const { db, firstId, secondId } = await setup(DROPPED);
  await resolve(db, PARTIAL_ADAPTER, secondId);
  const item = one(db, "SELECT * FROM review_items");
  const insert = (over: Row) => {
    const r = { ...item, candidate_key: "x", ...over };
    db.raw.prepare(
      `INSERT INTO review_items (source_id, release_id, release_content_sha256, previous_release_id, kind, matcher_version,
         source_completeness, candidate_key, record_id, source_entity_id, spot_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.source_id, r.release_id, r.release_content_sha256, r.previous_release_id, r.kind, r.matcher_version,
      r.source_completeness, r.candidate_key, r.record_id, r.source_entity_id, r.spot_id, r.details_json, r.created_at);
  };
  assert.throws(() => insert({ kind: "removalCandidate" }), /inconsistent/);
  assert.throws(() => insert({ kind: "relocation" }), /inconsistent/);
  assert.throws(() => insert({ release_content_sha256: "0".repeat(64) }), /does not belong/);
  assert.throws(() => insert({ candidate_key: item.candidate_key }), /UNIQUE/);
});

function insertItem(db: SqliteD1, base: Row, over: Row) {
  const r = { ...base, candidate_key: `direct:${Math.random()}`, ...over };
  db.raw.prepare(
    `INSERT INTO review_items (source_id, release_id, release_content_sha256, previous_release_id, kind, matcher_version,
       source_completeness, candidate_key, record_id, source_entity_id, spot_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.source_id, r.release_id, r.release_content_sha256, r.previous_release_id, r.kind, r.matcher_version,
    r.source_completeness, r.candidate_key, r.record_id, r.source_entity_id, r.spot_id, r.details_json, r.created_at);
}

test("direct SQL cannot create a candidate outside the previous release, the source or the entity's spot", async () => {
  const { db, firstId, secondId } = await setup(DROPPED);
  await resolve(db, PARTIAL_ADAPTER, secondId);
  const disappearance = one(db, "SELECT * FROM review_items");
  // Same source, but never recorded in the previous release.
  const stray = Number(db.raw.prepare("INSERT INTO source_entities (source_id, created_at) VALUES (?, ?)").run(SOURCE, NOW).lastInsertRowid);
  addBlockedTestSource(db);
  await importTaito(db, { sourceId: TEST_BLOCKED_SOURCE, newSpotId: sequentialSpotIds("F") });
  const foreign = one(db, "SELECT source_entity_id FROM source_entities WHERE source_id = ? LIMIT 1", TEST_BLOCKED_SOURCE).source_entity_id;
  const other = entityOf(db, recordOf(db, firstId, 2));
  const rejected = /not the previous release's entities/;

  assert.throws(() => insertItem(db, disappearance, { source_entity_id: foreign }), /does not belong|not the previous/);
  assert.throws(() => insertItem(db, disappearance, { source_entity_id: stray }), rejected);
  assert.throws(() => insertItem(db, disappearance, { spot_id: other.spot_id }), rejected);
  insertItem(db, disappearance, { source_entity_id: other.source_entity_id, spot_id: other.spot_id }); // consistent -> accepted

  const ambiguous = { ...disappearance, kind: "ambiguousMatch", record_id: recordOf(db, secondId, 1), source_entity_id: null, spot_id: null };
  const withCandidates = (ids: unknown[]) => ({ details_json: JSON.stringify({ reason: "direct", candidateEntityIds: ids }) });
  assert.throws(() => insertItem(db, ambiguous, withCandidates([])), rejected);
  assert.throws(() => insertItem(db, ambiguous, withCandidates([stray])), rejected);
  assert.throws(() => insertItem(db, ambiguous, withCandidates([foreign])), rejected);
  assert.throws(() => insertItem(db, ambiguous, withCandidates([String(other.source_entity_id)])), rejected);
  assert.throws(() => insertItem(db, ambiguous, withCandidates([other.source_entity_id, other.source_entity_id])), rejected);
  insertItem(db, ambiguous, withCandidates([other.source_entity_id])); // consistent -> accepted
});

test("recordReviewDecision returns its own row id; unknown decision versions are refused", async () => {
  const { db, secondId } = await setup(DROPPED, COMPLETE_ADAPTER);
  const result = await resolve(db, COMPLETE_ADAPTER, secondId);
  const [reviewItemId] = result.status === "needsReview" ? result.reviewItemIds : [];
  const first = await recordReviewDecision(db, { reviewItemId, decision: "deferred", decidedBy: REVIEWER, decidedAt: RERUN, note: "first" });
  // Another writer's decision lands in between; each call still returns exactly the row it inserted.
  db.raw.prepare(`INSERT INTO review_decisions (review_item_id, decision, decision_version, decided_by, decided_at, note)
    VALUES (?, 'deferred', ?, 'other-writer', ?, 'other')`).run(reviewItemId, REVIEW_DECISION_VERSION, RERUN);
  const second = await recordReviewDecision(db, { reviewItemId, decision: "removalRejected", decidedBy: REVIEWER, decidedAt: NOW, note: "second" });
  assert.equal(one(db, "SELECT note FROM review_decisions WHERE review_decision_id = ?", first).note, "first");
  assert.equal(one(db, "SELECT note FROM review_decisions WHERE review_decision_id = ?", second).note, "second");
  // Latest = largest id, even though its decided_at is earlier.
  assert.equal(one(db, "SELECT max(review_decision_id) AS id FROM review_decisions WHERE review_item_id = ?", reviewItemId).id, second);
  for (const version of ["review-decision.v2", "x"]) {
    assert.throws(() => db.raw.prepare(`INSERT INTO review_decisions (review_item_id, decision, decision_version, decided_by, decided_at)
      VALUES (?, 'deferred', ?, ?, ?)`).run(reviewItemId, version, REVIEWER, RERUN), /not valid for this review item/);
  }
});
