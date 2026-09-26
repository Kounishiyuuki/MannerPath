// Removal executor (ADR-0008 decisions 5 and 8, Issue #84). As in review-queue.test.ts, the second
// release is an ARTIFICIAL test fixture derived from the one real Taito release under a test-only
// source; it does not count as the two-real-release validation, and Taito's own gate stays closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { REMOVAL_EXECUTOR_VERSION, RemovalApplicationError, applyReviewedRemoval } from "../src/pipeline/removal.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { type ReviewDecision, recordReviewDecision } from "../src/pipeline/review-queue.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

const SOURCE = "test-review-removal";
const LATER = "2026-09-26T03:00:00Z";
const APPLY = "2026-09-27T03:00:00Z";
const REPUBLISH = "2026-09-28T03:00:00Z";
const REVIEWER = "test-reviewer";

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules under a test source, matcher gate open. */
const PARTIAL_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY removal source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
  completeness: undefined,
};
const COMPLETE_ADAPTER: SourceAdapter = { ...PARTIAL_ADAPTER, completeness: "complete" };

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const DROPPED = new TextEncoder().encode([LINES[0], ...LINES.slice(2)].join("\r\n")); // record 1 disappears
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };

async function setup(adapter = COMPLETE_ADAPTER) {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY removal source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'approved', ?, ?)`,
  ).run(SOURCE, NOW, NOW);
  const { releaseId: firstId } = await ingestRelease(db, adapter, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, adapter, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const { releaseId: secondId } = await ingestRelease(db, adapter, DROPPED, SECOND);
  const result = await resolveFirstRelease(db, adapter, secondId, { now: LATER, newSpotId: sequentialSpotIds("B") });
  assert.equal(result.status, "needsReview");
  const [item] = all(db, "SELECT * FROM review_items");
  return { db, firstId, secondId, item };
}
const decide = (db: SqliteD1, reviewItemId: number, decision: ReviewDecision, decidedAt = LATER) =>
  recordReviewDecision(db, { reviewItemId, decision, decidedBy: REVIEWER, decidedAt });
const apply = (db: Db, reviewItemId: number) => applyReviewedRemoval(db, reviewItemId, { now: APPLY });

/** Evidence and history that removal must never touch. */
function history(db: SqliteD1) {
  return Object.fromEntries(["source_releases", "source_records", "source_observations", "source_entities", "source_record_entities",
    "source_record_match_keys", "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "review_items", "review_decisions"]
    .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
}
/** Canonical and published state that a refused application must leave untouched. */
function state(db: SqliteD1) {
  return { ...history(db), spots: all(db, "SELECT * FROM spots ORDER BY spot_id"),
    tile_snapshots: all(db, "SELECT * FROM tile_snapshots ORDER BY tile_id"),
    tile_snapshot_spots: all(db, "SELECT * FROM tile_snapshot_spots ORDER BY spot_id"),
    review_removal_applications: all(db, "SELECT * FROM review_removal_applications") };
}
const removedCount = (db: SqliteD1) => one(db, "SELECT count(*) AS n FROM spots WHERE lifecycle = 'removed'").n;

test("Taito's production gate stays closed and its source partial", () => {
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal(TAITO_ADAPTER.completeness, "partial");
});

test("removalConfirmed -> executor sets lifecycle removed and records the audited application", async () => {
  const { db, item } = await setup();
  const before = history(db);
  const decisionId = await decide(db, item.review_item_id, "removalConfirmed");
  const spotBefore = one(db, "SELECT * FROM spots WHERE spot_id = ?", item.spot_id);

  const result = await apply(db, item.review_item_id);
  assert.deepEqual(result, {
    status: "applied", spotId: item.spot_id, reviewItemId: item.review_item_id, reviewDecisionId: decisionId, tileId: spotBefore.tile_id,
  });
  assert.deepEqual(one(db, "SELECT * FROM review_removal_applications"), {
    review_removal_application_id: 1, spot_id: item.spot_id, review_item_id: item.review_item_id,
    review_decision_id: decisionId, executor_version: REMOVAL_EXECUTOR_VERSION, applied_at: APPLY,
  });
  // Only lifecycle (and its updated_at) changes; the id and every other column stay.
  assert.deepEqual(one(db, "SELECT * FROM spots WHERE spot_id = ?", item.spot_id),
    { ...spotBefore, lifecycle: "removed", updated_at: APPLY });
  assert.equal(removedCount(db), 1);
  assert.deepEqual({ ...history(db), review_decisions: before.review_decisions }, before, "no raw, provenance, link or review item changed");
  assert.equal(all(db, "SELECT * FROM review_decisions").length, 1, "the decision row itself is untouched");
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", item.spot_id).n, 0, "unpublished");
});

for (const [decision, reason] of [["removalRejected", "removalRejected"], ["deferred", "deferred"]] as const) {
  test(`${decision} -> not applicable, nothing changes`, async () => {
    const { db, item } = await setup();
    await decide(db, item.review_item_id, decision);
    const before = state(db);
    assert.deepEqual(await apply(db, item.review_item_id), { status: "notApplicable", reviewItemId: item.review_item_id, reason });
    assert.deepEqual(state(db), before);
  });
}

test("no decision -> not applicable, nothing changes", async () => {
  const { db, item } = await setup();
  const before = state(db);
  assert.deepEqual(await apply(db, item.review_item_id), { status: "notApplicable", reviewItemId: item.review_item_id, reason: "noDecision" });
  assert.deepEqual(state(db), before);
});

test("a later removalRejected supersedes an earlier removalConfirmed: not applied", async () => {
  const { db, item } = await setup();
  await decide(db, item.review_item_id, "removalConfirmed");
  await decide(db, item.review_item_id, "removalRejected", APPLY);
  const before = state(db);
  assert.equal((await apply(db, item.review_item_id)).status, "notApplicable");
  assert.deepEqual(state(db), before);
});

test("partial disappearance -> refused, and cannot be removed even by direct SQL", async () => {
  const { db, item } = await setup(PARTIAL_ADAPTER);
  assert.equal(item.kind, "disappearance");
  await decide(db, item.review_item_id, "removalRejected");
  const before = state(db);
  await assert.rejects(apply(db, item.review_item_id), RemovalApplicationError);
  assert.deepEqual(state(db), before);
  assert.throws(() => db.raw.prepare(
    "INSERT INTO review_removal_applications (spot_id, review_item_id, review_decision_id, executor_version, applied_at) VALUES (?, ?, 1, 'x', ?)",
  ).run(item.spot_id, item.review_item_id, APPLY), /not the latest removalConfirmed/);
  db.raw.exec("DELETE FROM tile_snapshot_spots");
  assert.throws(() => db.raw.prepare("UPDATE spots SET lifecycle = 'removed' WHERE spot_id = ?").run(item.spot_id),
    /requires a review_removal_application/);
});

test("stale decision: a decision recorded after the executor read the queue aborts the whole batch", async () => {
  const { db, item } = await setup();
  await decide(db, item.review_item_id, "removalConfirmed");
  const before = state(db);
  // Interleave a reviewer's new decision between the executor's read and its write.
  let superseded = 0;
  const racing: Db = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      superseded = await decide(db, item.review_item_id, "removalRejected", APPLY);
      return db.batch(statements);
    },
  };
  await assert.rejects(apply(racing, item.review_item_id), /not the latest removalConfirmed/);
  assert.deepEqual(state(db), { ...before, review_decisions: all(db, "SELECT * FROM review_decisions ORDER BY 1, 2") });
  assert.equal(removedCount(db), 0);
  assert.ok(superseded > 0);
  assert.equal((await apply(db, item.review_item_id)).status, "notApplicable");
});

test("a superseded removalConfirmed cannot be applied by direct SQL either", async () => {
  const { db, item } = await setup();
  const old = await decide(db, item.review_item_id, "removalConfirmed");
  await decide(db, item.review_item_id, "removalConfirmed", APPLY);
  assert.throws(() => db.raw.prepare(
    "INSERT INTO review_removal_applications (spot_id, review_item_id, review_decision_id, executor_version, applied_at) VALUES (?, ?, ?, 'x', ?)",
  ).run(item.spot_id, item.review_item_id, old, APPLY), /not the latest removalConfirmed/);
});

test("same decision reapplied -> idempotent; a different latest decision after application -> fail closed", async () => {
  const { db, item } = await setup();
  const decisionId = await decide(db, item.review_item_id, "removalConfirmed");
  assert.equal((await apply(db, item.review_item_id)).status, "applied");
  const after = state(db);
  assert.deepEqual(await apply(db, item.review_item_id),
    { status: "alreadyApplied", spotId: item.spot_id, reviewItemId: item.review_item_id, reviewDecisionId: decisionId });
  assert.deepEqual(state(db), after);

  await decide(db, item.review_item_id, "removalConfirmed", REPUBLISH);
  await assert.rejects(apply(db, item.review_item_id), /was removed on review decision/);
  assert.deepEqual({ ...state(db), review_decisions: after.review_decisions }, after);
  assert.throws(() => db.raw.prepare(
    "INSERT INTO review_removal_applications (spot_id, review_item_id, review_decision_id, executor_version, applied_at) VALUES (?, ?, ?, 'x', ?)",
  ).run(item.spot_id, item.review_item_id, decisionId + 1, APPLY), /not the latest|UNIQUE/);
});

test("applications, items and decisions are immutable; a reviewed removal cannot be reverted by an update", async () => {
  const { db, item } = await setup();
  await decide(db, item.review_item_id, "removalConfirmed");
  await apply(db, item.review_item_id);
  assert.throws(() => db.raw.prepare("UPDATE review_removal_applications SET applied_at = 'x'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM review_removal_applications").run(), /immutable/);
  assert.throws(() => db.raw.prepare("UPDATE review_decisions SET decision = 'deferred'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM review_items").run(), /immutable/);
  assert.throws(() => db.raw.prepare("UPDATE spots SET lifecycle = 'active' WHERE spot_id = ?").run(item.spot_id), /cannot be reverted/);
  assert.throws(() => db.raw.prepare("DELETE FROM spots WHERE spot_id = ?").run(item.spot_id));
});

test("first release -> publish -> disappearance -> removalConfirmed -> executor -> republish", async () => {
  const { db, item, firstId } = await setup();
  const tilesBefore = new Map(all(db, "SELECT * FROM tile_snapshots").map((t) => [t.tile_id, t]));
  const publishedBefore = all(db, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id").map((r) => r.spot_id);
  assert.equal(publishedBefore.length, 34, "the test source carries no Taito attenuations, so all 34 publish");
  assert.ok(publishedBefore.includes(item.spot_id));
  const spotIdsBefore = all(db, "SELECT spot_id FROM spots ORDER BY spot_id").map((r) => r.spot_id);
  const historyBefore = history(db);

  await decide(db, item.review_item_id, "removalConfirmed");
  const applied = await apply(db, item.review_item_id);
  assert.equal(applied.status, "applied");
  const tileId = applied.status === "applied" ? applied.tileId : "";

  const report = await publishTiles(db, { now: REPUBLISH });
  assert.deepEqual(report.published.map((p) => p.tileId), [tileId], "only the affected tile is republished");
  assert.deepEqual(report.unchanged, [...tilesBefore.keys()].filter((t) => t !== tileId).sort());

  const tile = one(db, "SELECT * FROM tile_snapshots WHERE tile_id = ?", tileId);
  const old = tilesBefore.get(tileId)!;
  assert.equal(tile.revision, old.revision + 1);
  assert.notEqual(tile.content_sha256, old.content_sha256, "new content hash, so a new ETag");
  assert.equal(tile.spot_count, old.spot_count - 1);
  assert.ok(!JSON.parse(tile.body_json).spots.some((s: { id: string }) => s.id === item.spot_id), "gone from the tile body");
  for (const [id, t] of tilesBefore) if (id !== tileId) assert.deepEqual(one(db, "SELECT * FROM tile_snapshots WHERE tile_id = ?", id), t);

  assert.deepEqual(all(db, "SELECT spot_id FROM spots ORDER BY spot_id").map((r) => r.spot_id), spotIdsBefore, "spot ids stay, removed one included");
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", item.spot_id).lifecycle, "removed");
  assert.deepEqual(all(db, "SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id").map((r) => r.spot_id),
    publishedBefore.filter((s) => s !== item.spot_id), "the other 33 stay published under their ids");
  assert.deepEqual({ ...history(db), review_decisions: historyBefore.review_decisions }, historyBefore, "source/entity/provenance history kept");
  assert.equal(one(db, "SELECT status FROM source_releases WHERE release_id = ?", firstId).status, "applied");
  assert.equal(one(db, "SELECT count(*) AS n FROM spot_field_provenance WHERE spot_id = ?", item.spot_id).n > 0, true);
  // A second republish changes nothing.
  assert.deepEqual((await publishTiles(db, { now: REPUBLISH })).published, []);
});
