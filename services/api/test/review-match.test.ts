// Reviewed ambiguousMatch decisions in cross-release reconciliation (ADR-0008 decisions 3 and 8,
// Issue #86). The second releases below are ARTIFICIAL test fixtures derived from the one real Taito
// release under a test-only source, as in review-queue.test.ts; they do not count as the two-real-
// release validation, and Taito's own gate stays closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbStatement } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { planCrossReleaseMatch } from "../src/pipeline/match.ts";
import { applyReviewedRemoval } from "../src/pipeline/removal.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { type ReviewDecision, recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { REVIEW_MATCH_APPLICATION_VERSION, ReviewedMatchError, planReviewedMatch } from "../src/pipeline/reviewed-match.ts";
import { type SourceAdapter, sourceCompleteness } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

const SOURCE = "test-review-match";
const LATER = "2026-09-26T03:00:00Z";
const RERUN = "2026-09-27T03:00:00Z";
const REVIEWER = "test-reviewer";

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules under an unapproved source, matcher gate open. */
const PARTIAL_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY review match source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
  completeness: undefined, // undeclared -> partial
};
const COMPLETE_ADAPTER: SourceAdapter = { ...PARTIAL_ADAPTER, completeness: "complete" };

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const bytesOf = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));
const withRef = (line: string, ref: string) => line.replace(/^[^,]*/, ref);
// `#` is not mapped into the observation, so a changed `#` changes the raw row but no value.
const REF_CHANGED = bytesOf([LINES[0], withRef(LINES[1], "901"), ...LINES.slice(2)]);
const TWO_REFS_CHANGED = bytesOf([LINES[0], withRef(LINES[1], "901"), withRef(LINES[2], "902"), ...LINES.slice(3)]);
const NO_REF = withRef(LINES[1], "");
const DUPLICATED = bytesOf([LINES[0], NO_REF, NO_REF, ...LINES.slice(2)]);
const CHANGED = bytesOf([LINES[0], LINES[1].replace("上野公園前交番裏", "上野公園前交番裏（改）"), ...LINES.slice(2)]);
const DROPPED = bytesOf([LINES[0], ...LINES.slice(2)]);
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };
const THIRD = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-20", fetchedAt: "2026-09-26T00:00:00Z" };

async function setup(bytes: Uint8Array, adapter = PARTIAL_ADAPTER) {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY review match source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'approved', ?, ?)`,
  ).run(SOURCE, NOW, NOW);
  const { releaseId: firstId } = await ingestRelease(db, adapter, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, adapter, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const { releaseId: secondId } = await ingestRelease(db, adapter, bytes, SECOND);
  const first = await resolve(db, adapter, secondId);
  assert.equal(first.status, "needsReview");
  return { db, firstId, secondId, itemIds: first.status === "needsReview" ? first.reviewItemIds : [] };
}
const resolve = (db: SqliteD1, adapter: SourceAdapter, releaseId: number, now = LATER) =>
  resolveFirstRelease(db, adapter, releaseId, { now, newSpotId: sequentialSpotIds("B") });
const decide = (db: SqliteD1, reviewItemId: number, decision: ReviewDecision, sourceEntityId?: number) =>
  recordReviewDecision(db, { reviewItemId, decision, sourceEntityId, decidedBy: REVIEWER, decidedAt: LATER });

/** Everything canonical or published, plus release state and the audit table. */
function canonical(db: SqliteD1) {
  return Object.fromEntries(["source_entities", "source_record_entities", "source_record_match_keys", "spots",
    "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots",
    "source_releases", "review_match_applications"]
    .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
}
const recordOf = (db: SqliteD1, releaseId: number, ordinal: number) =>
  one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = ?", releaseId, ordinal).record_id as number;
const entityOf = (db: SqliteD1, recordId: number) =>
  one(db, `SELECT e.source_entity_id, l.spot_id FROM source_record_entities e
    JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id WHERE e.record_id = ?`, recordId);
const releaseStatus = (db: SqliteD1, releaseId: number) =>
  one(db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", releaseId);

test("Taito keeps partial completeness and the closed second-release gate", () => {
  assert.equal(sourceCompleteness(TAITO_ADAPTER), "partial");
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
});

test("matchedToEntity with unchanged values: reviewed match applied, entity and spot ids kept, audited; rerun idempotent", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(REF_CHANGED);
  const prior = entityOf(db, recordOf(db, firstId, 1));
  const spotsBefore = all(db, "SELECT spot_id FROM spots ORDER BY spot_id").map((r) => r.spot_id);
  const priorSpot = one(db, "SELECT * FROM spots WHERE spot_id = ?", prior.spot_id);
  const decisionId = await decide(db, itemId, "matchedToEntity", prior.source_entity_id);

  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.equal(result.status, "resolved");
  const spotIds = result.status === "resolved" ? result.spotIds : [];
  assert.equal(spotIds[0], prior.spot_id, "the reviewed record keeps its entity's spot");
  assert.deepEqual([...spotIds].sort(), spotsBefore, "no spot created, none lost");
  const record = recordOf(db, secondId, 1);
  assert.deepEqual(one(db, "SELECT source_entity_id, method FROM source_record_entities WHERE record_id = ?", record),
    { source_entity_id: prior.source_entity_id, method: "manual" });
  assert.deepEqual(all(db, "SELECT * FROM review_match_applications"), [{
    review_match_application_id: 1, review_item_id: itemId, review_decision_id: decisionId, decision: "matchedToEntity",
    record_id: record, release_id: secondId, source_entity_id: prior.source_entity_id,
    executor_version: REVIEW_MATCH_APPLICATION_VERSION, applied_at: LATER,
  }]);
  const spot = one(db, "SELECT * FROM spots WHERE spot_id = ?", prior.spot_id);
  assert.deepEqual({ ...spot, last_verified_at: priorSpot.last_verified_at, updated_at: priorSpot.updated_at }, priorSpot, "only evidence fields move");
  assert.equal(spot.last_verified_at, SECOND.observedOn);
  assert.deepEqual(all(db, "SELECT DISTINCT record_id FROM spot_field_provenance WHERE spot_id = ?", prior.spot_id), [{ record_id: record }]);
  assert.deepEqual(releaseStatus(db, secondId), { status: "applied", is_current: 1 });
  assert.deepEqual(releaseStatus(db, firstId), { status: "applied", is_current: 0 });

  const after = canonical(db);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), { status: "alreadyApplied" });
  assert.deepEqual(canonical(db), after, "same decision re-run: nothing written again");
  assert.throws(() => db.raw.prepare("UPDATE review_match_applications SET applied_at = ?").run(RERUN), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM review_match_applications").run(), /immutable/);
  // A later decision cannot be substituted for the applied one.
  const later = await decide(db, itemId, "confirmedNew");
  assert.throws(() => db.raw.prepare(
    `INSERT INTO review_match_applications (review_item_id, review_decision_id, decision, record_id, release_id, source_entity_id, executor_version, applied_at)
     VALUES (?, ?, 'confirmedNew', ?, ?, NULL, ?, ?)`).run(itemId, later, record, secondId, REVIEW_MATCH_APPLICATION_VERSION, RERUN), /UNIQUE|review_match_applications/);
});

test("confirmedNew with no unresolved previous entity: applied as a new spot", async () => {
  const { db, firstId, secondId, itemIds } = await setup(DUPLICATED);
  const prior = entityOf(db, recordOf(db, firstId, 1));
  assert.equal(itemIds.length, 2);
  await decide(db, itemIds[0], "matchedToEntity", prior.source_entity_id);
  await decide(db, itemIds[1], "confirmedNew");
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  assert.equal(result.status, "resolved");
  const spotIds = result.status === "resolved" ? result.spotIds : [];
  assert.equal(spotIds[0], prior.spot_id);
  assert.match(spotIds[1], /^sp_B/, "a new spot id");
  assert.equal(one(db, "SELECT count(*) AS n FROM spots").n, 35);
  const newRecord = recordOf(db, secondId, 2);
  assert.equal(one(db, "SELECT method FROM source_record_entities WHERE record_id = ?", newRecord).method, "new");
  assert.deepEqual(all(db, "SELECT decision, record_id, source_entity_id FROM review_match_applications ORDER BY record_id"), [
    { decision: "matchedToEntity", record_id: recordOf(db, secondId, 1), source_entity_id: prior.source_entity_id },
    { decision: "confirmedNew", record_id: newRecord, source_entity_id: null },
  ]);
});

test("confirmedNew leaving a previous entity unresolved: not a silent removal; needsReview with a disappearance item", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(CHANGED);
  await decide(db, itemId, "confirmedNew");
  const before = canonical(db);
  const result = await resolve(db, PARTIAL_ADAPTER, secondId);
  const gone = entityOf(db, recordOf(db, firstId, 1));
  const residual = one(db, "SELECT * FROM review_items WHERE kind = 'disappearance'");
  assert.deepEqual(result, { status: "needsReview", reviewItemIds: [residual.review_item_id] });
  assert.equal(residual.source_entity_id, gone.source_entity_id);
  assert.deepEqual(canonical(db), before);
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", gone.spot_id).lifecycle, "active");
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId, RERUN), result, "rerun: same item");
});

for (const decision of ["deferred", null] as const) {
  test(`${decision ?? "no decision"}: needsReview, canonical unchanged`, async () => {
    const { db, secondId, itemIds } = await setup(REF_CHANGED);
    if (decision) await decide(db, itemIds[0], decision);
    const before = canonical(db);
    assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId), { status: "needsReview", reviewItemIds: itemIds });
    assert.deepEqual(canonical(db), before);
  });
}

test("only the latest decision counts: matched then deferred is open; deferred then matched applies", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(REF_CHANGED);
  const entity = entityOf(db, recordOf(db, firstId, 1)).source_entity_id;
  const superseded = await decide(db, itemId, "matchedToEntity", entity);
  await decide(db, itemId, "deferred");
  const before = canonical(db);
  assert.equal((await resolve(db, PARTIAL_ADAPTER, secondId)).status, "needsReview");
  assert.deepEqual(canonical(db), before);
  // The schema refuses applying a superseded decision too.
  assert.throws(() => db.raw.prepare(
    `INSERT INTO review_match_applications (review_item_id, review_decision_id, decision, record_id, release_id, source_entity_id, executor_version, applied_at)
     VALUES (?, ?, 'matchedToEntity', ?, ?, ?, ?, ?)`).run(itemId, superseded, recordOf(db, secondId, 1), secondId, entity, REVIEW_MATCH_APPLICATION_VERSION, LATER),
  /not the latest/);
  const latest = await decide(db, itemId, "matchedToEntity", entity);
  assert.equal((await resolve(db, PARTIAL_ADAPTER, secondId)).status, "resolved");
  assert.equal(one(db, "SELECT review_decision_id FROM review_match_applications").review_decision_id, latest);
});

test("stale: a newer competing release of the source refuses the reviewed plan; canonical unchanged", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(REF_CHANGED);
  await decide(db, itemId, "matchedToEntity", entityOf(db, recordOf(db, firstId, 1)).source_entity_id);
  await ingestRelease(db, PARTIAL_ADAPTER, TAITO_BYTES, THIRD);
  const before = canonical(db);
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), (e) => e instanceof ReviewedMatchError && /competes/.test(e.message));
  assert.deepEqual(canonical(db), before);
});

test("stale: a decision recorded after the resolver read the queue aborts the whole batch (atomicity)", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(REF_CHANGED);
  await decide(db, itemId, "matchedToEntity", entityOf(db, recordOf(db, firstId, 1)).source_entity_id);
  const before = canonical(db);
  const batch = db.batch.bind(db);
  let raced = false;
  db.batch = async (statements: DbStatement[]) => {
    if (!raced && statements.length > 3) {
      raced = true;
      db.raw.prepare("INSERT INTO review_decisions (review_item_id, decision, decision_version, decided_by, decided_at) VALUES (?, 'deferred', 'review-decision.v1', ?, ?)")
        .run(itemId, REVIEWER, RERUN);
    }
    return batch(statements);
  };
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), /review_match_applications/);
  assert.ok(raced);
  assert.deepEqual(canonical(db), before, "no link, spot, provenance, match key or release state written");
});

test("matchedToEntity outside the item's candidates: refused by the schema and by the planner", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(REF_CHANGED);
  const other = entityOf(db, recordOf(db, firstId, 5)).source_entity_id;
  await assert.rejects(decide(db, itemId, "matchedToEntity", other), /not valid for this review item/);

  const previous = all(db, `SELECT r.record_id AS recordId, r.raw_sha256 AS rawSha256, e.source_entity_id AS sourceEntityId, l.spot_id AS spotId
    FROM source_records r JOIN source_record_entities e ON e.record_id = r.record_id JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id
    WHERE r.release_id = ? ORDER BY r.ordinal`, firstId) as any[];
  const next = all(db, "SELECT record_id AS recordId, raw_sha256 AS rawSha256 FROM source_records WHERE release_id = ? ORDER BY ordinal", secondId) as any[];
  const plan = planCrossReleaseMatch(previous, next);
  const [a] = plan.ambiguous;
  const forged = (decision: string, sourceEntityId: number | null, decisionVersion = "review-decision.v1") =>
    [{ reviewItemId: itemId, recordId: a.recordId, candidateEntityIds: a.candidateEntityIds, latest: { reviewDecisionId: 99, decision, decisionVersion, sourceEntityId } }];
  assert.throws(() => planReviewedMatch(plan, previous, next, forged("matchedToEntity", other)), /not a candidate/);
  assert.throws(() => planReviewedMatch(plan, previous, next, forged("confirmedNew", null, "review-decision.v0")), /not review-decision.v1/);
  assert.throws(() => planReviewedMatch(plan, previous, next, forged("removalConfirmed", null)), /does not resolve/);
  const open = planReviewedMatch(plan, previous, next, []);
  assert.deepEqual([open.openReviewItemIds, open.unresolvedPreviousEntityIds], [[], []], "an unstored item is open, not decided");
  assert.equal(open.decisions.length, next.length - 1);
});

test("two records reviewed onto one entity: refused", async () => {
  const { db, firstId, secondId, itemIds } = await setup(DUPLICATED);
  const entity = entityOf(db, recordOf(db, firstId, 1)).source_entity_id;
  await decide(db, itemIds[0], "matchedToEntity", entity);
  await decide(db, itemIds[1], "matchedToEntity", entity);
  const before = canonical(db);
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), /claimed by records/);
  assert.deepEqual(canonical(db), before);
});

test("other changed values: a reviewed same entity is not an approved field update", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(CHANGED);
  await decide(db, itemId, "matchedToEntity", entityOf(db, recordOf(db, firstId, 1)).source_entity_id);
  const before = canonical(db);
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), /value update policy is not implemented/);
  assert.deepEqual(canonical(db), before);
});

test("canonical drift: the spot no longer holds what the record states; refused", async () => {
  const { db, firstId, secondId, itemIds: [itemId] } = await setup(REF_CHANGED);
  const prior = entityOf(db, recordOf(db, firstId, 1));
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  db.raw.prepare("UPDATE spots SET name = 'drifted' WHERE spot_id = ?").run(prior.spot_id);
  const before = canonical(db);
  await assert.rejects(resolve(db, PARTIAL_ADAPTER, secondId), /canonical drift in name/);
  assert.deepEqual(canonical(db), before);
});

test("a removed spot is never revived by a reviewed match", async () => {
  // A: first release; B drops record 1 -> removal applied; B rejected; C changes record 1's `#`.
  const { db, firstId, secondId, itemIds: [removalItem] } = await setup(DROPPED, COMPLETE_ADAPTER);
  const prior = entityOf(db, recordOf(db, firstId, 1));
  await decide(db, removalItem, "removalConfirmed");
  assert.equal((await applyReviewedRemoval(db, removalItem, { now: LATER })).status, "applied");
  db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(secondId);
  const { releaseId: thirdId } = await ingestRelease(db, COMPLETE_ADAPTER, REF_CHANGED, THIRD);
  const third = await resolve(db, COMPLETE_ADAPTER, thirdId);
  assert.equal(third.status, "needsReview");
  const [itemId] = third.status === "needsReview" ? third.reviewItemIds : [];
  await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
  const before = canonical(db);
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, thirdId), /removed or merged/);
  assert.deepEqual(canonical(db), before);
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", prior.spot_id).lifecycle, "removed");
  const latest = one(db, "SELECT max(review_decision_id) AS id FROM review_decisions WHERE review_item_id = ?", itemId).id;
  assert.throws(() => db.raw.prepare(
    `INSERT INTO review_match_applications (review_item_id, review_decision_id, decision, record_id, release_id, source_entity_id, executor_version, applied_at)
     VALUES (?, ?, 'matchedToEntity', ?, ?, ?, ?, ?)`).run(itemId, latest, recordOf(db, thirdId, 1), thirdId, prior.source_entity_id, REVIEW_MATCH_APPLICATION_VERSION, LATER),
  /not the latest/, "the schema refuses it too");
});

test("atomicity: one open item among decided ones writes nothing canonical", async () => {
  const { db, firstId, secondId, itemIds } = await setup(TWO_REFS_CHANGED);
  assert.equal(itemIds.length, 2);
  await decide(db, itemIds[0], "matchedToEntity", entityOf(db, recordOf(db, firstId, 1)).source_entity_id);
  const before = canonical(db);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId), { status: "needsReview", reviewItemIds: [itemIds[1]] });
  assert.deepEqual(canonical(db), before, "no source_record_entities, spots, provenance, applications or release state");
  assert.deepEqual(releaseStatus(db, secondId), { status: "ingested", is_current: 0 });

  await decide(db, itemIds[1], "matchedToEntity", entityOf(db, recordOf(db, firstId, 2)).source_entity_id);
  assert.equal((await resolve(db, PARTIAL_ADAPTER, secondId)).status, "resolved");
  assert.equal(one(db, "SELECT count(*) AS n FROM review_match_applications").n, 2);
});

test("a manual source_record_entities decision requires its application row", async () => {
  const { db, firstId, secondId } = await setup(REF_CHANGED);
  assert.throws(() => db.raw.prepare(
    `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at)
     VALUES (?, ?, ?, 'manual', 'x', ?)`).run(recordOf(db, secondId, 1), secondId, entityOf(db, recordOf(db, firstId, 1)).source_entity_id, LATER),
  /requires a review_match_application/);
});

test("schema: a matchedToEntity application needs the chosen entity still linked to an active, unmerged spot", async () => {
  const insert = (db: SqliteD1, itemId: number, decisionId: number, recordId: number, releaseId: number, entityId: number) => db.raw.prepare(
    `INSERT INTO review_match_applications (review_item_id, review_decision_id, decision, record_id, release_id, source_entity_id, executor_version, applied_at)
     VALUES (?, ?, 'matchedToEntity', ?, ?, ?, ?, ?)`).run(itemId, decisionId, recordId, releaseId, entityId, REVIEW_MATCH_APPLICATION_VERSION, LATER);
  const prepared = async (breakLink?: (db: SqliteD1, spotId: string) => void) => {
    const { db, firstId, secondId, itemIds: [itemId] } = await setup(REF_CHANGED);
    const prior = entityOf(db, recordOf(db, firstId, 1));
    const decisionId = await decide(db, itemId, "matchedToEntity", prior.source_entity_id);
    breakLink?.(db, prior.spot_id);
    return () => insert(db, itemId, decisionId, recordOf(db, secondId, 1), secondId, prior.source_entity_id);
  };
  const refused = /review_match_applications: not the latest/;

  // Missing link: the old NOT EXISTS(bad spot) form accepted this.
  assert.throws(await prepared((db, spotId) => db.raw.prepare("DELETE FROM spot_source_entities WHERE spot_id = ?").run(spotId)), refused);
  // Merged spot.
  assert.throws(await prepared((db, spotId) => {
    db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(spotId);
    const target = one(db, "SELECT spot_id FROM spots WHERE spot_id <> ? ORDER BY spot_id LIMIT 1", spotId).spot_id;
    db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(target, spotId);
  }), refused);
  // Not active (temporarilyClosed stands in for any non-active lifecycle; removed is covered above).
  assert.throws(await prepared((db, spotId) => {
    db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(spotId);
    db.raw.prepare("UPDATE spots SET lifecycle = 'temporarilyClosed' WHERE spot_id = ?").run(spotId);
  }), refused);
  // Active, unmerged, linked: accepted.
  (await prepared())();
});
