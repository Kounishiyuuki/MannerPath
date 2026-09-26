// Consuming an applied reviewed removal in cross-release release finalization (ADR-0008 decisions 3,
// 5 and 8, Issue #89): a previous entity whose spot was removed by applyReviewedRemoval is
// resolvedByReviewedRemoval, audited in review_removal_resolutions in the release batch, and nothing
// else resolves a disappearance.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbStatement } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { PromotionError, buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { applyReviewedRemoval } from "../src/pipeline/removal.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { type ReviewDecision, recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { REVIEW_REMOVAL_RESOLUTION_VERSION, ReviewedMatchError, ReviewedRemovalResolutionError } from "../src/pipeline/reviewed-match.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

const SOURCE = "test-removal-resolution";
const LATER = "2026-09-26T03:00:00Z";
const APPLY = "2026-09-27T03:00:00Z";
const RERUN = "2026-09-28T03:00:00Z";
const REPUBLISH = "2026-09-29T03:00:00Z";
const REVIEWER = "test-reviewer";

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules under a test source, matcher gate open. */
const PARTIAL_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY resolution source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
  completeness: undefined,
};
const COMPLETE_ADAPTER: SourceAdapter = { ...PARTIAL_ADAPTER, completeness: "complete" };

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const DROPPED = new TextEncoder().encode([LINES[0], ...LINES.slice(2)].join("\r\n")); // record 1 disappears
const DROPPED_TWO = new TextEncoder().encode([LINES[0], ...LINES.slice(3)].join("\r\n")); // records 1 and 2 disappear
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };
const THIRD = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-20", fetchedAt: "2026-09-26T00:00:00Z" };

async function setup(bytes = DROPPED, adapter = COMPLETE_ADAPTER) {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY resolution source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'approved', ?, ?)`,
  ).run(SOURCE, NOW, NOW);
  const { releaseId: firstId } = await ingestRelease(db, adapter, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, adapter, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const { releaseId: secondId } = await ingestRelease(db, adapter, bytes, SECOND);
  assert.equal((await resolve(db, adapter, secondId, LATER)).status, "needsReview");
  const items = all(db, "SELECT * FROM review_items ORDER BY review_item_id");
  return { db, firstId, secondId, items, item: items[0] };
}
const resolve = (db: SqliteD1, adapter: SourceAdapter, releaseId: number, now = RERUN) =>
  resolveFirstRelease(db, adapter, releaseId, { now, newSpotId: sequentialSpotIds("B") });
const decide = (db: SqliteD1, reviewItemId: number, decision: ReviewDecision) =>
  recordReviewDecision(db, { reviewItemId, decision, decidedBy: REVIEWER, decidedAt: LATER });
const confirmAndApply = async (db: SqliteD1, reviewItemId: number) => {
  await decide(db, reviewItemId, "removalConfirmed");
  assert.equal((await applyReviewedRemoval(db, reviewItemId, { now: APPLY })).status, "applied");
};

/** Everything a refused release finalization must leave untouched. */
function state(db: SqliteD1) {
  return Object.fromEntries(["source_releases", "source_record_entities", "source_record_match_keys", "spot_source_entities",
    "spot_field_provenance", "spots", "review_match_applications", "review_removal_applications", "review_removal_resolutions"]
    .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
}
const release = (db: SqliteD1, id: number) => one(db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", id);
const resolutions = (db: SqliteD1) => all(db, "SELECT * FROM review_removal_resolutions");

test("Taito keeps partial completeness and the closed second-release gate", () => {
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal(TAITO_ADAPTER.completeness, "partial");
});

test("applied reviewed removal -> resolvedByReviewedRemoval: B applied/current in one batch, audited, no fake record decision", async () => {
  const { db, firstId, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  const application = one(db, "SELECT * FROM review_removal_applications");
  const removedHistory = {
    provenance: all(db, "SELECT * FROM spot_field_provenance WHERE spot_id = ? ORDER BY field", item.spot_id),
    links: all(db, "SELECT * FROM spot_source_entities WHERE spot_id = ?", item.spot_id),
    entity: one(db, "SELECT * FROM source_entities WHERE source_entity_id = ?", item.source_entity_id),
    records: all(db, "SELECT * FROM source_record_entities WHERE source_entity_id = ?", item.source_entity_id),
  };

  const result = await resolve(db, COMPLETE_ADAPTER, secondId);
  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" ? result.spotIds.length : 0, 33, "one spot per B record; the removed one has no record");
  assert.deepEqual(release(db, secondId), { status: "applied", is_current: 1 });
  assert.deepEqual(release(db, firstId), { status: "applied", is_current: 0 });

  assert.deepEqual(resolutions(db), [{
    review_removal_resolution_id: 1, release_id: secondId, previous_release_id: firstId, review_item_id: item.review_item_id,
    review_decision_id: application.review_decision_id, review_removal_application_id: application.review_removal_application_id,
    source_entity_id: item.source_entity_id, spot_id: item.spot_id, resolver_version: REVIEW_REMOVAL_RESOLUTION_VERSION, applied_at: RERUN,
  }]);
  // The removed spot keeps its id, lifecycle, entity, link, provenance and A-record history; B gets no row for it.
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", item.spot_id).lifecycle, "removed");
  assert.deepEqual({
    provenance: all(db, "SELECT * FROM spot_field_provenance WHERE spot_id = ? ORDER BY field", item.spot_id),
    links: all(db, "SELECT * FROM spot_source_entities WHERE spot_id = ?", item.spot_id),
    entity: one(db, "SELECT * FROM source_entities WHERE source_entity_id = ?", item.source_entity_id),
    records: all(db, "SELECT * FROM source_record_entities WHERE source_entity_id = ?", item.source_entity_id),
  }, removedHistory);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_record_entities WHERE release_id = ?", secondId).n, 33);
  assert.equal(one(db, "SELECT count(*) AS n FROM spots WHERE lifecycle = 'active'").n, 33);
  assert.equal(one(db, `SELECT count(*) AS n FROM spot_field_provenance p JOIN source_records r ON r.record_id = p.record_id
    WHERE r.release_id = ? AND p.field = 'existence'`, secondId).n, 33, "unaffected spots cite B");
  assert.deepEqual(application, one(db, "SELECT * FROM review_removal_applications"), "the application is consumed, not changed");
});

test("rerun after B applied -> alreadyApplied, nothing new written", async () => {
  const { db, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  assert.equal((await resolve(db, COMPLETE_ADAPTER, secondId)).status, "resolved");
  const after = state(db);
  assert.deepEqual(await resolve(db, COMPLETE_ADAPTER, secondId, REPUBLISH), { status: "alreadyApplied" });
  assert.deepEqual(state(db), after);
});

test("removalConfirmed without its application -> needsReview, nothing written", async () => {
  const { db, secondId, item } = await setup();
  await decide(db, item.review_item_id, "removalConfirmed");
  const before = state(db);
  assert.deepEqual(await resolve(db, COMPLETE_ADAPTER, secondId), { status: "needsReview", reviewItemIds: [item.review_item_id] });
  assert.deepEqual(state(db), before);
});

for (const decision of ["removalRejected", "deferred", null] as const) {
  test(`${decision ?? "no decision"} -> unresolved, needsReview, nothing written`, async () => {
    const { db, secondId, item } = await setup();
    if (decision) await decide(db, item.review_item_id, decision);
    const before = state(db);
    assert.deepEqual(await resolve(db, COMPLETE_ADAPTER, secondId), { status: "needsReview", reviewItemIds: [item.review_item_id] });
    assert.deepEqual(state(db), before);
  });
}

test("a removed spot without a review_removal_application cannot exist, so the entity stays unresolved", async () => {
  const { db, secondId, item } = await setup();
  // Unpublish first so only the application gate (0010) can refuse the lifecycle change.
  db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(item.spot_id);
  assert.throws(() => db.raw.prepare("UPDATE spots SET lifecycle = 'removed' WHERE spot_id = ?").run(item.spot_id),
    /requires a review_removal_application/);
  assert.equal((await resolve(db, COMPLETE_ADAPTER, secondId)).status, "needsReview");
});

test("latest decision changed after the application -> fail closed, nothing written", async () => {
  const { db, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  await decide(db, item.review_item_id, "removalRejected");
  const before = state(db);
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, secondId), (e: unknown) =>
    e instanceof ReviewedRemovalResolutionError && /latest decision is/.test(e.message));
  assert.deepEqual(state(db), before);
});

test("link drift after the application: another entity linked to the spot -> rejected", async () => {
  const { db, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, publication_status, created_at, updated_at)
     VALUES ('test-other-source', 'TEST ONLY other source', 'municipal', 'approved', ?, ?)`,
  ).run(NOW, NOW);
  const other = Number(db.raw.prepare("INSERT INTO source_entities (source_id, created_at) VALUES ('test-other-source', ?)").run(NOW).lastInsertRowid);
  db.raw.prepare("INSERT INTO spot_source_entities (source_entity_id, spot_id, method, linked_at, resolver_version) VALUES (?, ?, 'manual', ?, 'test')")
    .run(other, item.spot_id, NOW);
  const before = state(db);
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, secondId), (e: unknown) =>
    e instanceof ReviewedRemovalResolutionError && /linked to entities/.test(e.message));
  assert.deepEqual(state(db), before);
});

test("link drift after the application: the item entity's link is gone -> rejected", async () => {
  const { db, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  db.raw.prepare("DELETE FROM spot_source_entities WHERE source_entity_id = ?").run(item.source_entity_id);
  const before = state(db);
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, secondId), /records without an entity and spot/);
  assert.deepEqual(state(db), before);
});

test("schema: forged resolutions are refused (wrong spot, wrong item, wrong application, unlinked, version)", async () => {
  const { db, firstId, secondId, items } = await setup(DROPPED_TWO);
  const [a, b] = items;
  await confirmAndApply(db, a.review_item_id);
  await confirmAndApply(db, b.review_item_id);
  const appOf = (itemId: number) => one(db, "SELECT * FROM review_removal_applications WHERE review_item_id = ?", itemId);
  const insert = (o: Row) => db.raw.prepare(
    `INSERT INTO review_removal_resolutions (release_id, previous_release_id, review_item_id, review_decision_id,
       review_removal_application_id, source_entity_id, spot_id, resolver_version, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(o.release_id, o.previous_release_id, o.review_item_id, o.review_decision_id, o.review_removal_application_id,
    o.source_entity_id, o.spot_id, o.resolver_version, RERUN);
  const good = {
    release_id: secondId, previous_release_id: firstId, review_item_id: a.review_item_id, review_decision_id: appOf(a.review_item_id).review_decision_id,
    review_removal_application_id: appOf(a.review_item_id).review_removal_application_id, source_entity_id: a.source_entity_id,
    spot_id: a.spot_id, resolver_version: REVIEW_REMOVAL_RESOLUTION_VERSION,
  };
  for (const forged of [
    { spot_id: b.spot_id },
    { review_item_id: b.review_item_id },
    { review_removal_application_id: appOf(b.review_item_id).review_removal_application_id },
    { review_decision_id: appOf(b.review_item_id).review_decision_id },
    { source_entity_id: b.source_entity_id },
    { release_id: firstId, previous_release_id: secondId },
    { resolver_version: "review-removal-resolution.v2" },
  ]) {
    assert.throws(() => insert({ ...good, ...forged }), /review_removal_resolutions: not the applied latest/, JSON.stringify(forged));
  }
  // Unlinked after application: refused by the schema even when the resolver is bypassed.
  db.raw.prepare("DELETE FROM spot_source_entities WHERE source_entity_id = ?").run(a.source_entity_id);
  assert.throws(() => insert(good), /review_removal_resolutions: not the applied latest/);
  assert.equal(resolutions(db).length, 0);
});

test("schema: the audit row is append-only", async () => {
  const { db, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  await resolve(db, COMPLETE_ADAPTER, secondId);
  assert.throws(() => db.raw.prepare("UPDATE review_removal_resolutions SET applied_at = 'x'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM review_removal_resolutions").run(), /immutable/);
});

test("schema: a previous release that is no longer current is refused", async () => {
  const { db, firstId, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  const app = one(db, "SELECT * FROM review_removal_applications");
  db.raw.prepare("UPDATE source_releases SET is_current = 0 WHERE release_id = ?").run(firstId);
  assert.throws(() => db.raw.prepare(
    `INSERT INTO review_removal_resolutions (release_id, previous_release_id, review_item_id, review_decision_id,
       review_removal_application_id, source_entity_id, spot_id, resolver_version, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(secondId, firstId, item.review_item_id, app.review_decision_id, app.review_removal_application_id, item.source_entity_id,
    item.spot_id, REVIEW_REMOVAL_RESOLUTION_VERSION, RERUN), /review_removal_resolutions: not the applied latest/);
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, secondId), /none is current/);
  assert.deepEqual(release(db, secondId), { status: "ingested", is_current: 0 });
});

test("a newer competing release refuses finalization; canonical unchanged", async () => {
  const { db, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  await ingestRelease(db, COMPLETE_ADAPTER, TAITO_BYTES, THIRD);
  const before = state(db);
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, secondId), (e: unknown) => e instanceof ReviewedMatchError && /competes/.test(e.message));
  assert.deepEqual(state(db), before);
});

test("race: a decision recorded after the resolver read the queue aborts the whole batch", async () => {
  const { db, secondId, item } = await setup();
  await confirmAndApply(db, item.review_item_id);
  const before = state(db);
  const batch = db.batch.bind(db);
  let raced = false;
  db.batch = async (statements: DbStatement[]) => {
    if (!raced && statements.length > 3) {
      raced = true;
      db.raw.prepare("INSERT INTO review_decisions (review_item_id, decision, decision_version, decided_by, decided_at) VALUES (?, 'deferred', 'review-decision.v1', ?, ?)")
        .run(item.review_item_id, REVIEWER, RERUN);
    }
    return batch(statements);
  };
  await assert.rejects(resolve(db, COMPLETE_ADAPTER, secondId), /review_removal_resolutions/);
  assert.ok(raced);
  assert.deepEqual(state(db), before, "no release state, provenance, match key, record decision or audit row written");
});

test("atomicity: one applied removal and one unresolved candidate -> needsReview with no partial write", async () => {
  const { db, secondId, items } = await setup(DROPPED_TWO);
  assert.equal(items.length, 2);
  await confirmAndApply(db, items[0].review_item_id);
  const before = state(db);
  assert.deepEqual(await resolve(db, COMPLETE_ADAPTER, secondId), { status: "needsReview", reviewItemIds: [items[1].review_item_id] });
  assert.deepEqual(state(db), before);
  // Once the second is applied too, B finalizes with both audited.
  await confirmAndApply(db, items[1].review_item_id);
  assert.equal((await resolve(db, COMPLETE_ADAPTER, secondId)).status, "resolved");
  assert.deepEqual(resolutions(db).map((r) => r.review_item_id), items.map((i) => i.review_item_id));
});

test("partial source: a disappearance is never resolved by removal", async () => {
  const { db, secondId, item } = await setup(DROPPED, PARTIAL_ADAPTER);
  assert.equal(item.kind, "disappearance");
  await assert.rejects(decide(db, item.review_item_id, "removalConfirmed"));
  await assert.rejects(applyReviewedRemoval(db, item.review_item_id, { now: APPLY }), /not a complete source's removal candidate/);
  assert.deepEqual(await resolve(db, PARTIAL_ADAPTER, secondId), { status: "needsReview", reviewItemIds: [item.review_item_id] });
  assert.equal(resolutions(db).length, 0);
});

const REVIEWED_COMPLETE_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER, assertResolvable: () => {}, attenuate: () => [], crossReleaseValidated: true, completeness: "complete",
};

test("E2E: A -> publish -> B disappearance -> removal applied -> B applied/current -> republish -> promotion of B", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_REGISTRY.sourceId, NOW);
  const { releaseId: firstId } = await ingestRelease(db, REVIEWED_COMPLETE_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, REVIEWED_COMPLETE_ADAPTER, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const rawBefore = all(db, "SELECT * FROM source_records ORDER BY record_id");
  const { releaseId: secondId } = await ingestRelease(db, REVIEWED_COMPLETE_ADAPTER, DROPPED, SECOND);
  assert.equal((await resolve(db, REVIEWED_COMPLETE_ADAPTER, secondId, LATER)).status, "needsReview");
  const [item] = all(db, "SELECT * FROM review_items");
  assert.equal(item.kind, "removalCandidate");

  await confirmAndApply(db, item.review_item_id);
  // Between the executor and republish the export keeps failing closed (#85 behavior).
  await assert.rejects(buildPromotionBundle(db), PromotionError);

  assert.equal((await resolve(db, REVIEWED_COMPLETE_ADAPTER, secondId)).status, "resolved");
  assert.deepEqual(release(db, secondId), { status: "applied", is_current: 1 });
  assert.deepEqual(release(db, firstId), { status: "applied", is_current: 0 });
  // Published tiles still carry A's evidence until republished: the export of B fails closed.
  await assert.rejects(buildPromotionBundle(db), PromotionError);

  await publishTiles(db, { now: REPUBLISH });
  const published = all(db, "SELECT spot_id FROM tile_snapshot_spots").map((r) => r.spot_id);
  assert.equal(published.length, 33);
  assert.ok(!published.includes(item.spot_id), "removed spot is gone from published tiles");
  assert.ok(!all(db, "SELECT body_json FROM tile_snapshots").some((t) => t.body_json.includes(`"id":"${item.spot_id}"`)));

  const bundle = await buildPromotionBundle(db);
  assert.equal(bundle.manifest.releaseId, secondId);
  assert.ok(!bundle.sql.includes(item.spot_id), "removed spot is not promoted");

  // Canonical DB keeps the removed spot and every piece of history.
  assert.equal(one(db, "SELECT lifecycle FROM spots WHERE spot_id = ?", item.spot_id).lifecycle, "removed");
  assert.deepEqual(all(db, "SELECT * FROM source_records WHERE release_id = ? ORDER BY record_id", firstId), rawBefore);
  assert.ok(one(db, "SELECT count(*) AS n FROM spot_field_provenance WHERE spot_id = ?", item.spot_id).n > 0);
  assert.equal(one(db, "SELECT count(*) AS n FROM spot_source_entities WHERE spot_id = ?", item.spot_id).n, 1);
  assert.equal(one(db, "SELECT count(*) AS n FROM review_removal_applications").n, 1);
  assert.equal(one(db, "SELECT count(*) AS n FROM review_removal_resolutions").n, 1);
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal(TAITO_ADAPTER.completeness, "partial");
});
