// Reviewed relocation application (ADR-0009 implementation plan step C, Issue #97). The second releases are
// ARTIFICIAL test fixtures derived from the one real Taito release under a test-only source, as in
// review-relocation.test.ts and review-relocation-hold.test.ts; Taito's own gates stay closed. Full tile /
// promotion relocation E2E is step D and not covered here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../src/geo/tile.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { CROSS_RELEASE_MATCHER_VERSION } from "../src/pipeline/match.ts";
import { RELOCATION_POLICY_VERSION } from "../src/pipeline/relocation.ts";
import {
  RELOCATION_APPLICATION_EXECUTOR_VERSION, applyReviewedRelocation,
} from "../src/pipeline/relocation-application.ts";
import { HOLD_RELOCATION_UNDER_REVIEW, holdRelocationCandidate } from "../src/pipeline/relocation-hold.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { type ReviewDecision, recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { type SourceAdapter, sourceCompleteness } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyMigration, migratedSqlite, withoutTrigger } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });

const SOURCE = "test-relocation-application";
const LATER = "2026-09-26T03:00:00Z";
const HOLD_AT = "2026-09-27T03:00:00Z";
const APPLY_AT = "2026-09-28T03:00:00Z";
const RESOLVE_AT = "2026-09-29T03:00:00Z";
const REVIEWER = "test-reviewer";

/** TEST ONLY, not in SOURCE_ADAPTERS: Taito rules under an unapproved source, matcher gate open. */
const ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY relocation application source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
  completeness: undefined, // undeclared -> partial
};

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const row1 = (edit: (line: string) => string) => new TextEncoder().encode([LINES[0], edit(LINES[1]), ...LINES.slice(2)].join("\r\n"));
// Row 1 is `1,...,上野公園前交番裏,...,35.7112,139.77377,`.
const OLD = { latitude: 35.7112, longitude: 139.77377 };
const NEAR = { latitude: 35.7113, longitude: 139.77377 }; // ~11 m, same z14 tile
const FAR = { latitude: 35.7312, longitude: 139.77377 }; // ~2.2 km, another z14 tile
const MOVED = row1((l) => l.replace(",35.7112,", ",35.7113,"));
const MOVED_FAR = row1((l) => l.replace(",35.7112,", ",35.7312,"));
const MOVED_AND_RENAMED = row1((l) => l.replace(",35.7112,", ",35.7113,").replace("上野公園前交番裏", "上野公園前交番裏（改）"));
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };
const THIRD = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-20", fetchedAt: "2026-09-26T00:00:00Z" };
const tileOf = (c: { latitude: number; longitude: number }) => formatTileId(tileForCoordinate(c.latitude, c.longitude, DATA_TILE_ZOOM));

const recordOf = (db: SqliteD1, releaseId: number, ordinal: number) =>
  one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = ?", releaseId, ordinal).record_id as number;
const entityOf = (db: SqliteD1, recordId: number) =>
  one(db, `SELECT e.source_entity_id, l.spot_id FROM source_record_entities e
    JOIN spot_source_entities l ON l.source_entity_id = e.source_entity_id WHERE e.record_id = ?`, recordId) as { source_entity_id: number; spot_id: string };
const resolve = (db: SqliteD1, releaseId: number, now = LATER) =>
  resolveFirstRelease(db, ADAPTER, releaseId, { now, newSpotId: sequentialSpotIds("B") });
const decide = (db: SqliteD1, reviewItemId: number, decision: ReviewDecision, sourceEntityId?: number) =>
  recordReviewDecision(db, { reviewItemId, decision, sourceEntityId, decidedBy: REVIEWER, decidedAt: LATER });
const apply = (db: SqliteD1, reviewItemId: number, adapter = ADAPTER) => applyReviewedRelocation(db, adapter, reviewItemId, { now: APPLY_AT });
const spotOf = (db: SqliteD1, spotId: string) => one(db, "SELECT * FROM spots WHERE spot_id = ?", spotId);
const applications = (db: SqliteD1) => all(db, "SELECT * FROM review_relocation_applications ORDER BY 1");
const unpublish = (db: SqliteD1, spotId: string) => db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(spotId);
const INVALID_APPLICATION = /review_relocation_applications: not the current, latest relocationConfirmed decision/;
const COORDINATE_GUARD = /a coordinate or tile changes only through a reviewed relocation application/;

/** Every table an application must leave alone. spots and tile_snapshot_spots are compared separately. */
function untouched(db: SqliteD1) {
  return Object.fromEntries(["source_releases", "source_records", "source_observations", "source_entities", "source_record_entities",
    "source_record_match_keys", "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "review_items",
    "review_decisions", "review_match_applications", "review_removal_applications", "review_removal_resolutions",
    "review_relocation_holds", "review_relocation_resolutions", "tile_snapshots", "tile_snapshot_spots"]
    .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
}
const everything = (db: SqliteD1) => ({ ...untouched(db), spots: all(db, "SELECT * FROM spots ORDER BY 1"), review_relocation_applications: applications(db) });

/** First release applied and published; `bytes` ingested and reviewed as the same entity; no relocationCandidate stored yet. */
async function identityDecided(bytes = MOVED) {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY relocation application source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'approved', ?, ?)`,
  ).run(SOURCE, NOW, NOW);
  const { releaseId: firstId } = await ingestRelease(db, ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, ADAPTER, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  await publishTiles(db, { now: NOW });
  const { releaseId: secondId } = await ingestRelease(db, ADAPTER, bytes, SECOND);
  const first = await resolve(db, secondId);
  const identityItemId = first.status === "needsReview" ? first.reviewItemIds[0] : NaN;
  const prior = entityOf(db, recordOf(db, firstId, 1));
  const identityDecisionId = await decide(db, identityItemId, "matchedToEntity", prior.source_entity_id);
  return { db, firstId, secondId, identityItemId, identityDecisionId, prior };
}

/** identityDecided() + resolved again: one open relocationCandidate. */
async function candidate(bytes = MOVED) {
  const s = await identityDecided(bytes);
  const { db, secondId } = s;
  const result = await resolve(db, secondId);
  const item = one(db, "SELECT * FROM review_items WHERE kind = 'relocationCandidate'");
  assert.deepEqual(result, { status: "needsReview", reviewItemIds: [item.review_item_id] });
  return { ...s, item, itemId: item.review_item_id as number };
}

/** candidate() + held by its own hold step. */
async function held(bytes = MOVED) {
  const s = await candidate(bytes);
  assert.equal((await holdRelocationCandidate(s.db, ADAPTER, s.itemId, { now: HOLD_AT })).status, "held");
  return s;
}

/** held() + a relocationConfirmed decision newer than the identity decision. */
async function confirmed(bytes = MOVED) {
  const s = await held(bytes);
  const decisionId = await decide(s.db, s.itemId, "relocationConfirmed");
  return { ...s, decisionId };
}

/** The application row applyReviewedRelocation would write for `s`, for direct-SQL tests. */
function applicationValues(s: Awaited<ReturnType<typeof confirmed>>, over: Row = {}) {
  const d = JSON.parse(s.item.details_json);
  return {
    review_item_id: s.itemId, review_decision_id: s.decisionId, identity_review_decision_id: s.identityDecisionId,
    review_relocation_hold_id: one(s.db, "SELECT review_relocation_hold_id FROM review_relocation_holds WHERE review_item_id = ?", s.itemId).review_relocation_hold_id,
    spot_id: s.prior.spot_id, source_entity_id: s.prior.source_entity_id, record_id: s.item.record_id, release_id: s.secondId,
    previous_record_id: d.previousRecordId, previous_release_id: s.firstId, previous_observation_id: d.previousObservationId,
    new_observation_id: d.newObservationId, mapping_version: d.mappingVersion,
    old_latitude: d.previousCoordinate.latitude, old_longitude: d.previousCoordinate.longitude, old_tile_id: tileOf(d.previousCoordinate),
    new_latitude: d.newCoordinate.latitude, new_longitude: d.newCoordinate.longitude,
    new_tile_x: tileForCoordinate(d.newCoordinate.latitude, d.newCoordinate.longitude, DATA_TILE_ZOOM).x,
    new_tile_y: tileForCoordinate(d.newCoordinate.latitude, d.newCoordinate.longitude, DATA_TILE_ZOOM).y,
    new_tile_id: tileOf(d.newCoordinate), relocation_policy_version: RELOCATION_POLICY_VERSION,
    executor_version: RELOCATION_APPLICATION_EXECUTOR_VERSION, applied_at: APPLY_AT, ...over,
  };
}
function insertApplication(db: SqliteD1, values: Row) {
  const columns = Object.keys(values);
  db.raw.prepare(`INSERT INTO review_relocation_applications (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...Object.values(values));
}

test("Taito gates unchanged: partial, cross-release gate closed, no natural key or threshold", () => {
  assert.equal(sourceCompleteness(TAITO_ADAPTER), "partial");
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  assert.equal("naturalKey" in TAITO_ADAPTER, false);
  assert.equal("relocationThreshold" in TAITO_ADAPTER, false);
});

for (const [name, bytes, to] of [["same z14 tile", MOVED, NEAR], ["another z14 tile", MOVED_FAR, FAR]] as const) {
  test(`apply (${name}): same spot moves to the re-derived coordinate and tile, its hold is lifted, nothing else changes`, async () => {
    const s = await confirmed(bytes);
    assert.equal(tileOf(to) === tileOf(OLD), name === "same z14 tile", "fixture precondition");
    const before = untouched(s.db);
    const spotBefore = spotOf(s.db, s.prior.spot_id);
    assert.equal(spotBefore.publication_hold, HOLD_RELOCATION_UNDER_REVIEW);

    assert.deepEqual(await apply(s.db, s.itemId), {
      status: "applied", spotId: s.prior.spot_id, reviewItemId: s.itemId, reviewDecisionId: s.decisionId,
      oldTileId: tileOf(OLD), newTileId: tileOf(to),
    });

    const tile = tileForCoordinate(to.latitude, to.longitude, DATA_TILE_ZOOM);
    assert.deepEqual(spotOf(s.db, s.prior.spot_id), {
      ...spotBefore, latitude: to.latitude, longitude: to.longitude, tile_x: tile.x, tile_y: tile.y, tile_id: tileOf(to), publication_hold: null,
    }, "spot_id, created_at, updated_at, lifecycle, merge, last_verified_at, resolver_version and every value unchanged");
    assert.deepEqual(untouched(s.db), before, "links, entities, provenance, observations, review rows, hold rows, releases, snapshots");
    assert.deepEqual(applications(s.db), [applicationValues(s, { review_relocation_application_id: 1 })]);
    assert.deepEqual(one(s.db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", s.secondId), { status: "ingested", is_current: 0 },
      "the release is applied only by the resolver");
  });
}

test("decision: none, deferred or relocationRejected is never applied; the hold stays and nothing is written", async () => {
  for (const decisions of [[], ["deferred"], ["relocationRejected"], ["relocationConfirmed", "deferred"], ["relocationConfirmed", "relocationRejected"]] as ReviewDecision[][]) {
    const s = await held();
    for (const d of decisions) await decide(s.db, s.itemId, d);
    const before = everything(s.db);
    const reason = decisions.length === 0 ? "noDecision" : decisions[decisions.length - 1];
    assert.deepEqual(await apply(s.db, s.itemId), { status: "notApplicable", reviewItemId: s.itemId, reason }, decisions.join(" -> "));
    assert.deepEqual(everything(s.db), before, `${decisions.join(" -> ")}: nothing written`);
    assert.equal(spotOf(s.db, s.prior.spot_id).publication_hold, HOLD_RELOCATION_UNDER_REVIEW);
  }
});

test("decision freshness: D1 matched E -> R1 confirmed applies", async () => {
  const s = await confirmed();
  assert.ok(s.decisionId > s.identityDecisionId);
  assert.equal((await apply(s.db, s.itemId)).status, "applied");
});

test("decision freshness: D1 -> R1 confirmed -> D2 matched E makes R1 stale; a new R2 applies", async () => {
  const s = await confirmed();
  const d2 = await decide(s.db, s.identityItemId, "matchedToEntity", s.prior.source_entity_id);
  const before = everything(s.db);
  await assert.rejects(apply(s.db, s.itemId), /relocation decision \d+ is older than identity decision \d+; a new relocation decision is needed/);
  assert.throws(() => insertApplication(s.db, applicationValues(s, { identity_review_decision_id: d2 })), INVALID_APPLICATION, "the schema refuses R1 too");
  assert.deepEqual(everything(s.db), before);
  const r2 = await decide(s.db, s.itemId, "relocationConfirmed");
  assert.deepEqual(await apply(s.db, s.itemId), { status: "applied", spotId: s.prior.spot_id, reviewItemId: s.itemId, reviewDecisionId: r2,
    oldTileId: tileOf(OLD), newTileId: tileOf(NEAR) });
  assert.equal(applications(s.db)[0].identity_review_decision_id, d2);
});

test("decision freshness: D1 -> R1 -> D2 confirmedNew -> D3 matched E never revives R1; a new R2 applies", async () => {
  const s = await confirmed();
  await decide(s.db, s.identityItemId, "confirmedNew");
  await assert.rejects(apply(s.db, s.itemId), /identity item's latest decision is review-decision.v1 confirmedNew/);
  await decide(s.db, s.identityItemId, "matchedToEntity", s.prior.source_entity_id);
  const before = everything(s.db);
  await assert.rejects(apply(s.db, s.itemId), /is older than identity decision/);
  assert.deepEqual(everything(s.db), before);
  await decide(s.db, s.itemId, "relocationConfirmed");
  assert.equal((await apply(s.db, s.itemId)).status, "applied");
});

test("hold ownership: no hold, a locationSuperseded hold, or a relocationUnderReview hold without this item's row is refused", async () => {
  // No hold at all: the candidate was never held.
  {
    const s = await candidate();
    await decide(s.db, s.itemId, "relocationConfirmed");
    const before = everything(s.db);
    await assert.rejects(apply(s.db, s.itemId), /has no hold row of its own/);
    assert.deepEqual(everything(s.db), before);
  }
  // locationSuperseded (0004's hold) is not a relocation hold.
  {
    const s = await candidate();
    await decide(s.db, s.itemId, "relocationConfirmed");
    unpublish(s.db, s.prior.spot_id);
    s.db.raw.prepare("UPDATE spots SET publication_hold = 'locationSuperseded' WHERE spot_id = ?").run(s.prior.spot_id);
    await assert.rejects(apply(s.db, s.itemId), /has no hold row of its own/);
  }
  // relocationUnderReview set by another item's hold row only (a state the schema refuses; forged without its triggers).
  {
    const s = await candidate();
    await decide(s.db, s.itemId, "relocationConfirmed");
    unpublish(s.db, s.prior.spot_id);
    withoutTrigger(s.db.raw, "review_relocation_holds_valid", () => s.db.raw.prepare(
      "INSERT INTO review_relocation_holds (review_item_id, spot_id, executor_version, applied_at) VALUES (?, ?, 'review-relocation-hold.v1', ?)",
    ).run(s.identityItemId, s.prior.spot_id, HOLD_AT));
    withoutTrigger(s.db.raw, "spots_relocation_hold_requires_row", () =>
      s.db.raw.prepare("UPDATE spots SET publication_hold = 'relocationUnderReview' WHERE spot_id = ?").run(s.prior.spot_id));
    const before = everything(s.db);
    await assert.rejects(apply(s.db, s.itemId), /has no hold row of its own/);
    const otherHold = one(s.db, "SELECT review_relocation_hold_id FROM review_relocation_holds").review_relocation_hold_id;
    const decisionId = one(s.db, "SELECT max(review_decision_id) AS id FROM review_decisions WHERE review_item_id = ?", s.itemId).id;
    assert.throws(() => insertApplication(s.db, { ...applicationValues({ ...s, decisionId }, { review_relocation_hold_id: otherHold }) }),
      INVALID_APPLICATION, "another item's hold row cannot be consumed");
    assert.deepEqual(everything(s.db), before);
  }
});

test("hold ownership: another item's unconsumed hold row on the same spot makes the owner ambiguous; the schema refuses", async () => {
  const s = await confirmed();
  withoutTrigger(s.db.raw, "review_relocation_holds_valid", () => s.db.raw.prepare(
    "INSERT INTO review_relocation_holds (review_item_id, spot_id, executor_version, applied_at) VALUES (?, ?, 'review-relocation-hold.v1', ?)",
  ).run(s.identityItemId, s.prior.spot_id, HOLD_AT));
  const before = everything(s.db);
  await assert.rejects(apply(s.db, s.itemId), INVALID_APPLICATION);
  assert.deepEqual(everything(s.db), before);
});

test("idempotent: a second run reports alreadyApplied and writes nothing; a second row is refused", async () => {
  const s = await confirmed();
  await apply(s.db, s.itemId);
  const after = everything(s.db);
  assert.deepEqual(await apply(s.db, s.itemId), { status: "alreadyApplied", spotId: s.prior.spot_id, reviewItemId: s.itemId, reviewDecisionId: s.decisionId });
  assert.deepEqual(everything(s.db), after);
  assert.throws(() => insertApplication(s.db, applicationValues(s)), /UNIQUE|INVALID|not the current/);
  // A later decision on an applied item is recorded as evidence, but it cannot re-apply or undo the move.
  await decide(s.db, s.itemId, "relocationRejected");
  await assert.rejects(apply(s.db, s.itemId), /was applied on decision \d+, but its latest decision is \d+/);
});

test("stale premise: moved, closed, merged, superseded or fingerprint-drifted state is refused; nothing written", async () => {
  const cases: [string, (s: Awaited<ReturnType<typeof confirmed>>) => Promise<unknown> | unknown, RegExp][] = [
    ["coordinate already changed", (s) => withoutTrigger(s.db.raw, "spots_coordinate_requires_relocation_application",
      () => s.db.raw.prepare("UPDATE spots SET latitude = 35.71121 WHERE spot_id = ?").run(s.prior.spot_id)), /not at the previous observation's coordinate/],
    ["temporarilyClosed", (s) => s.db.raw.prepare("UPDATE spots SET lifecycle = 'temporarilyClosed' WHERE spot_id = ?").run(s.prior.spot_id), /is temporarilyClosed/],
    ["merged", (s) => s.db.raw.prepare("UPDATE spots SET merged_into = (SELECT spot_id FROM spots WHERE spot_id <> ? ORDER BY 1 LIMIT 1) WHERE spot_id = ?")
      .run(s.prior.spot_id, s.prior.spot_id), /merged/],
    ["candidate release rejected", (s) => s.db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(s.secondId), INVALID_APPLICATION],
    ["newer release", (s) => ingestRelease(s.db, ADAPTER, TAITO_BYTES, THIRD), INVALID_APPLICATION],
    ["incomparable release", (s) => ingestRelease(s.db, ADAPTER, TAITO_BYTES, { ...THIRD, observedOn: null }), INVALID_APPLICATION],
    // source_releases evidence is immutable (0001); the fingerprint check is defence in depth against a forged state.
    ["previous fingerprint drifted", (s) => withoutTrigger(s.db.raw, "source_releases_evidence_immutable",
      () => s.db.raw.prepare("UPDATE source_releases SET content_sha256 = ? WHERE release_id = ?").run("0".repeat(64), s.firstId)), INVALID_APPLICATION],
  ];
  for (const [name, stale, error] of cases) {
    const s = await confirmed();
    await stale(s);
    const before = everything(s.db);
    await assert.rejects(apply(s.db, s.itemId), error, name);
    assert.deepEqual(everything(s.db), before, `${name}: nothing written`);
  }
});

test("trust boundary: another mapping version, or a mapping that re-derives differently, is refused before any write", async () => {
  const s = await confirmed();
  const before = everything(s.db);
  await assert.rejects(apply(s.db, s.itemId, { ...ADAPTER, mappingVersion: "taito-observation.v999" }), /cites mapping .*, not the adapter's taito-observation.v999/);
  const drifted: SourceAdapter = { ...ADAPTER, observe: (values) => ({ ...ADAPTER.observe(values), latitude: ADAPTER.observe(values).latitude + 0.00001 }) };
  await assert.rejects(apply(s.db, s.itemId, drifted), /re-derives differently from its stored/);
  assert.deepEqual(everything(s.db), before);
});

test("trust boundary: a forged candidate whose relational rows all exist is refused because raw does not re-derive to them", async () => {
  const { db, firstId, secondId, identityItemId, identityDecisionId, prior } = await identityDecided();
  const alternate = (recordId: number, latitude: number) => Number(db.raw.prepare(
    `INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, name, latitude, longitude, supports_paper,
       supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle_claim, field_provenance_json)
     SELECT record_id, release_id, source_id, 'alternate-mapping.v1', name, ?, longitude, supports_paper, supports_heated,
       opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle_claim, field_provenance_json
     FROM source_observations WHERE record_id = ? AND mapping_version = ?`).run(latitude, recordId, ADAPTER.mappingVersion).lastInsertRowid);
  const previousRecord = recordOf(db, firstId, 1);
  const record = recordOf(db, secondId, 1);
  const forged = { latitude: 35.7199, longitude: OLD.longitude };
  const sha = (id: number) => one(db, "SELECT content_sha256 FROM source_releases WHERE release_id = ?", id).content_sha256;
  const forgedId = Number(db.raw.prepare(
    `INSERT INTO review_items (source_id, release_id, release_content_sha256, previous_release_id, kind, matcher_version,
       source_completeness, candidate_key, record_id, source_entity_id, spot_id, details_json, created_at)
     VALUES (?, ?, ?, ?, 'relocationCandidate', ?, 'partial', ?, ?, ?, ?, ?, ?)`,
  ).run(SOURCE, secondId, sha(secondId), firstId, CROSS_RELEASE_MATCHER_VERSION, `record:${record}|entity:${prior.source_entity_id}`,
    record, prior.source_entity_id, prior.spot_id, JSON.stringify({
      reason: "forged", previousRecordId: previousRecord, mappingVersion: "alternate-mapping.v1",
      previousObservationId: alternate(previousRecord, OLD.latitude), newObservationId: alternate(record, forged.latitude),
      previousCoordinate: OLD, newCoordinate: forged, distanceMetres: haversineMeters(OLD, forged), otherChangedFields: [],
      identity: { method: "reviewedMatch", reviewItemId: identityItemId, reviewDecisionId: identityDecisionId },
      matcherVersion: CROSS_RELEASE_MATCHER_VERSION, relocationPolicyVersion: RELOCATION_POLICY_VERSION, thresholdVersion: null,
      previousReleaseContentSha256: sha(firstId),
    }), LATER).lastInsertRowid);
  // The schema accepts the forgery (relational integrity only), and an adapter claiming that mapping can hold it.
  const renamed: SourceAdapter = { ...ADAPTER, mappingVersion: "alternate-mapping.v1" };
  assert.equal((await holdRelocationCandidate(db, renamed, forgedId, { now: HOLD_AT })).status, "held");
  await decide(db, forgedId, "relocationConfirmed");
  const before = everything(db);
  await assert.rejects(apply(db, forgedId), /cites mapping alternate-mapping\.v1, not the adapter's/);
  await assert.rejects(apply(db, forgedId, renamed), /re-derives differently from its stored alternate-mapping\.v1 observation/,
    "raw -> mapping does not yield the cited rows, so the forged coordinate never reaches spots");
  assert.deepEqual(everything(db), before);
  assert.equal(spotOf(db, prior.spot_id).latitude, OLD.latitude);
});

test("other observed fields: coordinate + name changed is refused by the executor and by the schema", async () => {
  const s = await confirmed(MOVED_AND_RENAMED);
  assert.deepEqual(JSON.parse(s.item.details_json).otherChangedFields, ["name"]);
  const before = everything(s.db);
  await assert.rejects(apply(s.db, s.itemId), /other observed fields changed \(name\); a value update policy is not implemented/);
  assert.throws(() => insertApplication(s.db, applicationValues(s)), INVALID_APPLICATION);
  assert.deepEqual(everything(s.db), before);
});

test("direct SQL: no coordinate or tile update without an application; hold lift only with its move", async () => {
  const s = await confirmed();
  const other = entityOf(s.db, recordOf(s.db, s.firstId, 2)).spot_id;
  const before = everything(s.db);
  for (const id of [s.prior.spot_id, other]) {
    unpublish(s.db, id);
    assert.throws(() => s.db.raw.prepare("UPDATE spots SET latitude = ?, longitude = ? WHERE spot_id = ?").run(NEAR.latitude, NEAR.longitude, id), COORDINATE_GUARD);
    const t = tileForCoordinate(FAR.latitude, FAR.longitude, DATA_TILE_ZOOM);
    assert.throws(() => s.db.raw.prepare("UPDATE spots SET tile_x = ?, tile_y = ?, tile_id = ? WHERE spot_id = ?").run(t.x, t.y, tileOf(FAR), id),
      COORDINATE_GUARD, "tile only");
  }
  // Even the exact application values, and the lift, are refused without the application row.
  const tile = tileForCoordinate(NEAR.latitude, NEAR.longitude, DATA_TILE_ZOOM);
  assert.throws(() => s.db.raw.prepare(
    "UPDATE spots SET latitude = ?, longitude = ?, tile_x = ?, tile_y = ?, tile_id = ?, publication_hold = NULL WHERE spot_id = ?",
  ).run(NEAR.latitude, NEAR.longitude, tile.x, tile.y, tileOf(NEAR), s.prior.spot_id), /reviewed relocation application/);
  assert.throws(() => s.db.raw.prepare("UPDATE spots SET publication_hold = NULL WHERE spot_id = ?").run(s.prior.spot_id),
    /lifted only by its reviewed relocation application/);
  assert.deepEqual(all(s.db, "SELECT * FROM spots ORDER BY 1"), before.spots);
  // A new spot still gets its initial coordinate on INSERT.
  s.db.raw.prepare(
    `INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type, lifecycle, evidence_quality,
       evidence_quality_version, resolver_version, created_at, updated_at) VALUES ('spot-new-0001', 'n', ?, ?, 14, ?, ?, ?, 'unknown', 'active', 'q', 'q.v1', 'r.v1', ?, ?)`,
  ).run(NEAR.latitude, NEAR.longitude, tile.x, tile.y, tileOf(NEAR), NOW, NOW);
});

test("direct SQL: inserting a valid application row is the move itself; afterwards the row authorizes nothing", async () => {
  const s = await confirmed();
  const other = entityOf(s.db, recordOf(s.db, s.firstId, 2)).spot_id;
  insertApplication(s.db, applicationValues(s));
  const moved = spotOf(s.db, s.prior.spot_id);
  assert.deepEqual([moved.latitude, moved.longitude, moved.tile_id, moved.publication_hold], [NEAR.latitude, NEAR.longitude, tileOf(NEAR), null],
    "no application row exists without its move");
  assert.deepEqual(await apply(s.db, s.itemId), { status: "alreadyApplied", spotId: s.prior.spot_id, reviewItemId: s.itemId, reviewDecisionId: s.decisionId });
  const tile = (c: typeof OLD) => tileForCoordinate(c.latitude, c.longitude, DATA_TILE_ZOOM);
  // Back to the old coordinate, again to the new one, or to anywhere: the premise (held, at the old coordinate) is gone.
  for (const c of [OLD, FAR]) {
    assert.throws(() => s.db.raw.prepare("UPDATE spots SET latitude = ?, longitude = ?, tile_x = ?, tile_y = ?, tile_id = ? WHERE spot_id = ?")
      .run(c.latitude, c.longitude, tile(c).x, tile(c).y, tileOf(c), s.prior.spot_id), COORDINATE_GUARD);
  }
  // Another spot cannot borrow this spot's application.
  unpublish(s.db, other);
  assert.throws(() => s.db.raw.prepare("UPDATE spots SET latitude = ?, longitude = ?, tile_x = ?, tile_y = ?, tile_id = ? WHERE spot_id = ?")
    .run(NEAR.latitude, NEAR.longitude, tile(NEAR).x, tile(NEAR).y, tileOf(NEAR), other), COORDINATE_GUARD);
  assert.throws(() => s.db.raw.prepare("UPDATE review_relocation_applications SET applied_at = ?").run(LATER), /immutable/);
  assert.throws(() => s.db.raw.prepare("DELETE FROM review_relocation_applications").run(), /immutable/);
});

test("direct SQL: a row whose premise went stale cannot be inserted, so a stale row can never move the spot later", async () => {
  const s = await confirmed();
  await decide(s.db, s.identityItemId, "matchedToEntity", s.prior.source_entity_id);
  const before = everything(s.db);
  assert.throws(() => insertApplication(s.db, applicationValues(s)), INVALID_APPLICATION);
  assert.throws(() => insertApplication(s.db, applicationValues(s, { review_item_id: s.identityItemId })), INVALID_APPLICATION, "another item");
  assert.throws(() => insertApplication(s.db, applicationValues(s, { new_latitude: 35.7199 })), INVALID_APPLICATION, "another coordinate");
  assert.throws(() => insertApplication(s.db, applicationValues(s, { executor_version: "review-relocation-application.v0" })), INVALID_APPLICATION);
  assert.deepEqual(everything(s.db), before);
});

test("resolver: a confirmed decision without an application is not consumed", async () => {
  const s = await confirmed();
  const before = everything(s.db);
  await assert.rejects(resolve(s.db, s.secondId, RESOLVE_AT), /held \(relocationUnderReview\); carry-forward is not implemented/);
  assert.deepEqual(everything(s.db), before);
  // Unheld with a confirmed decision: still review state only.
  const t = await candidate();
  await decide(t.db, t.itemId, "relocationConfirmed");
  assert.deepEqual(await resolve(t.db, t.secondId, RESOLVE_AT), { status: "needsReview", reviewItemIds: [t.itemId] });
  assert.equal(one(t.db, "SELECT status FROM source_releases WHERE release_id = ?", t.secondId).status, "ingested");
});

test("resolver: consumes the application once and applies the release with the reviewed-match semantics", async () => {
  const s = await confirmed(MOVED_FAR);
  await apply(s.db, s.itemId);
  const spotBefore = spotOf(s.db, s.prior.spot_id);
  const record = s.item.record_id as number;
  const result = await resolve(s.db, s.secondId, RESOLVE_AT);
  assert.equal(result.status, "resolved");
  assert.ok(result.status === "resolved" && result.spotIds.includes(s.prior.spot_id));

  assert.deepEqual(spotOf(s.db, s.prior.spot_id), { ...spotBefore, last_verified_at: SECOND.observedOn, resolver_version: ADAPTER.resolverVersion, updated_at: RESOLVE_AT },
    "same id, coordinate and tile as applied; only the evidence moved");
  assert.deepEqual(all(s.db, "SELECT DISTINCT record_id FROM spot_field_provenance WHERE spot_id = ?", s.prior.spot_id), [{ record_id: record }]);
  assert.deepEqual(one(s.db, "SELECT method, source_entity_id FROM source_record_entities WHERE record_id = ?", record),
    { method: "manual", source_entity_id: s.prior.source_entity_id });
  assert.deepEqual(all(s.db, "SELECT release_id, status, is_current FROM source_releases ORDER BY 1"),
    [{ release_id: s.firstId, status: "applied", is_current: 0 }, { release_id: s.secondId, status: "applied", is_current: 1 }]);
  assert.equal(one(s.db, "SELECT count(*) AS n FROM review_match_applications WHERE review_item_id = ?", s.identityItemId).n, 1);
  assert.deepEqual(all(s.db, "SELECT * FROM review_relocation_resolutions"), [{
    review_relocation_resolution_id: 1, release_id: s.secondId, previous_release_id: s.firstId, review_relocation_application_id: 1,
    review_item_id: s.itemId, spot_id: s.prior.spot_id, resolver_version: "review-relocation-resolution.v1", applied_at: RESOLVE_AT,
  }]);
  assert.equal(spotOf(s.db, s.prior.spot_id).created_at, NOW);

  // Consumed once: a rerun is alreadyApplied, and a second resolution row is refused.
  const after = everything(s.db);
  assert.deepEqual(await resolve(s.db, s.secondId, RESOLVE_AT), { status: "alreadyApplied" });
  assert.deepEqual(everything(s.db), after);
  assert.throws(() => s.db.raw.prepare(
    `INSERT INTO review_relocation_resolutions (release_id, previous_release_id, review_relocation_application_id, review_item_id, spot_id,
       resolver_version, applied_at) VALUES (?, ?, 1, ?, ?, 'review-relocation-resolution.v1', ?)`,
  ).run(s.secondId, s.firstId, s.itemId, s.prior.spot_id, RESOLVE_AT), /UNIQUE|not a completed consumption/);

  // The ordinary publish step puts it in its new tile (tile/ETag E2E is step D).
  await publishTiles(s.db, { now: RESOLVE_AT });
  assert.deepEqual(all(s.db, "SELECT tile_id FROM tile_snapshot_spots WHERE spot_id = ?", s.prior.spot_id), [{ tile_id: tileOf(FAR) }]);
});

test("publication fence: between application and resolution the moved spot is unpublishable; the resolution lifts the fence", async () => {
  const s = await confirmed(MOVED_FAR);
  const spotId = s.prior.spot_id;
  const oldRecord = one(s.db, "SELECT record_id FROM spot_field_provenance WHERE spot_id = ? AND field = 'existence'", spotId).record_id;
  assert.equal((await apply(s.db, s.itemId)).status, "applied");

  // A. Applied, not yet resolved: new coordinate, no hold, old applied evidence, pending application.
  assert.deepEqual(
    (({ latitude, longitude, tile_id, publication_hold }) => ({ latitude, longitude, tile_id, publication_hold }))(spotOf(s.db, spotId)),
    { ...FAR, tile_id: tileOf(FAR), publication_hold: null });
  assert.equal(applications(s.db).length, 1);
  assert.deepEqual(all(s.db, "SELECT * FROM review_relocation_resolutions"), []);
  assert.equal(one(s.db, "SELECT status FROM source_releases WHERE release_id = ?", s.secondId).status, "ingested");
  assert.equal(one(s.db, "SELECT record_id FROM spot_field_provenance WHERE spot_id = ? AND field = 'existence'", spotId).record_id, oldRecord);
  assert.deepEqual(all(s.db, "SELECT spot_id FROM pending_relocation_applications"), [{ spot_id: spotId }]);
  await publishTiles(s.db, { now: APPLY_AT });
  assert.deepEqual(all(s.db, "SELECT * FROM tile_snapshot_spots WHERE spot_id = ?", spotId), [], "not published at the new coordinate");
  for (const t of v1TileRows(s.db)) {
    assert.ok(!JSON.parse(t.body_json).spots.some((x: Row) => x.id === spotId), "absent from every tile body");
  }

  // B. Direct SQL cannot bypass it.
  assert.throws(() => s.db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(spotId, tileOf(FAR)),
    /no pending relocation application/);

  // C. The resolver consumes the application; the spot is publishable in its new tile.
  assert.equal((await resolve(s.db, s.secondId, RESOLVE_AT)).status, "resolved");
  assert.equal(all(s.db, "SELECT * FROM review_relocation_resolutions").length, 1);
  assert.deepEqual(one(s.db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", s.secondId), { status: "applied", is_current: 1 });
  assert.equal(one(s.db, "SELECT record_id FROM spot_field_provenance WHERE spot_id = ? AND field = 'existence'", spotId).record_id, s.item.record_id);
  assert.deepEqual((({ updated_at, last_verified_at }) => ({ updated_at, last_verified_at }))(spotOf(s.db, spotId)),
    { updated_at: RESOLVE_AT, last_verified_at: SECOND.observedOn });
  assert.deepEqual(all(s.db, "SELECT * FROM pending_relocation_applications"), []);
  await publishTiles(s.db, { now: RESOLVE_AT });
  assert.deepEqual(all(s.db, "SELECT tile_id FROM tile_snapshot_spots WHERE spot_id = ?", spotId), [{ tile_id: tileOf(FAR) }]);

  // D. A consumed application is history only: it never fences again (direct re-insert after unpublishing).
  unpublish(s.db, spotId);
  s.db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(spotId, tileOf(FAR));
  assert.equal(applications(s.db).length, 1);
});

test("publication fence: a resolver that fails closed leaves the application pending and the spot unpublishable", async () => {
  const s = await confirmed(MOVED_FAR);
  await apply(s.db, s.itemId);
  await decide(s.db, s.itemId, "relocationRejected");
  await assert.rejects(resolve(s.db, s.secondId, RESOLVE_AT), /relocation was applied .* but/);
  await publishTiles(s.db, { now: RESOLVE_AT });
  assert.deepEqual(all(s.db, "SELECT * FROM tile_snapshot_spots WHERE spot_id = ?", s.prior.spot_id), []);
  assert.throws(() => s.db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(s.prior.spot_id, tileOf(FAR)),
    /no pending relocation application/);
});

/** The resolution row the resolver would write for `s`'s application 1, by direct SQL. */
const insertResolution = (s: Awaited<ReturnType<typeof confirmed>>) => s.db.raw.prepare(
  `INSERT INTO review_relocation_resolutions (release_id, previous_release_id, review_relocation_application_id, review_item_id, spot_id,
     resolver_version, applied_at) VALUES (?, ?, 1, ?, ?, 'review-relocation-resolution.v1', ?)`,
).run(s.secondId, s.firstId, s.itemId, s.prior.spot_id, RESOLVE_AT);
const existenceRecord = (db: SqliteD1, spotId: string) =>
  one(db, "SELECT record_id FROM spot_field_provenance WHERE spot_id = ? AND field = 'existence'", spotId).record_id;

/** Applied, not resolved: the resolution must not be writable, and the spot must stay fenced. */
async function assertFenced(s: Awaited<ReturnType<typeof confirmed>>, oldRecord: number) {
  const spotId = s.prior.spot_id;
  assert.equal(one(s.db, "SELECT status FROM source_releases WHERE release_id = ?", s.secondId).status, "ingested");
  assert.equal(existenceRecord(s.db, spotId), oldRecord);
  assert.deepEqual(all(s.db, "SELECT spot_id FROM pending_relocation_applications"), [{ spot_id: spotId }]);
  await publishTiles(s.db, { now: RESOLVE_AT });
  assert.deepEqual(all(s.db, "SELECT * FROM tile_snapshot_spots WHERE spot_id = ?", spotId), []);
  assert.throws(() => s.db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(spotId, tileOf(FAR)),
    /no pending relocation application/);
}

test("publication fence: a resolution row inserted directly before the resolver ran is refused (Codex repro)", async () => {
  const s = await confirmed(MOVED_FAR);
  const spotId = s.prior.spot_id;
  const oldRecord = existenceRecord(s.db, spotId);
  assert.equal((await apply(s.db, s.itemId)).status, "applied");
  assert.deepEqual(
    (({ latitude, longitude, publication_hold }) => ({ latitude, longitude, publication_hold }))(spotOf(s.db, spotId)),
    { ...FAR, publication_hold: null });
  assert.deepEqual(one(s.db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", s.firstId), { status: "applied", is_current: 1 });
  assert.equal(applications(s.db).length, 1);

  assert.throws(() => insertResolution(s), /review_relocation_resolutions: not a completed consumption/);
  assert.deepEqual(all(s.db, "SELECT * FROM review_relocation_resolutions"), []);
  await assertFenced(s, oldRecord);
});

test("publication fence: a resolution row that got in without its trigger still does not lift the fence", async () => {
  const s = await confirmed(MOVED_FAR);
  const oldRecord = existenceRecord(s.db, s.prior.spot_id);
  await apply(s.db, s.itemId);
  withoutTrigger(s.db.raw, "review_relocation_resolutions_valid", () => insertResolution(s));
  assert.equal(all(s.db, "SELECT * FROM review_relocation_resolutions").length, 1);
  await assertFenced(s, oldRecord);
});

test("publication fence: a consumed application stays unfenced after a later release moves the evidence and current flag on", async () => {
  const s = await confirmed(MOVED_FAR);
  await apply(s.db, s.itemId);
  assert.equal((await resolve(s.db, s.secondId, RESOLVE_AT)).status, "resolved");
  const { releaseId: thirdId } = await ingestRelease(s.db, ADAPTER, MOVED_FAR, THIRD);
  assert.equal((await resolve(s.db, thirdId, RESOLVE_AT)).status, "resolved");
  assert.deepEqual(one(s.db, "SELECT status, is_current FROM source_releases WHERE release_id = ?", s.secondId), { status: "applied", is_current: 0 });
  assert.notEqual(existenceRecord(s.db, s.prior.spot_id), s.item.record_id);
  assert.deepEqual(all(s.db, "SELECT * FROM pending_relocation_applications"), []);
  await publishTiles(s.db, { now: RESOLVE_AT });
  assert.deepEqual(all(s.db, "SELECT tile_id FROM tile_snapshot_spots WHERE spot_id = ?", s.prior.spot_id), [{ tile_id: tileOf(FAR) }]);
});

test("publication fence: a fail-closed resolver writes no resolution and keeps the release, the evidence and the fence", async () => {
  for (const redecide of [
    (s: Awaited<ReturnType<typeof confirmed>>) => decide(s.db, s.itemId, "relocationRejected"),
    (s: Awaited<ReturnType<typeof confirmed>>) => decide(s.db, s.identityItemId, "matchedToEntity", s.prior.source_entity_id),
  ]) {
    const s = await confirmed(MOVED_FAR);
    const oldRecord = existenceRecord(s.db, s.prior.spot_id);
    await apply(s.db, s.itemId);
    await redecide(s);
    await assert.rejects(resolve(s.db, s.secondId, RESOLVE_AT), /relocation was applied .* but/);
    assert.deepEqual(all(s.db, "SELECT * FROM review_relocation_resolutions"), []);
    await assertFenced(s, oldRecord);
  }
});

test("resolver: an application whose decision or identity was re-recorded afterwards fails closed; nothing written", async () => {
  for (const [name, redecide] of [
    ["relocationRejected after application", (s: Awaited<ReturnType<typeof confirmed>>) => decide(s.db, s.itemId, "relocationRejected")],
    ["identity re-recorded after application", (s: Awaited<ReturnType<typeof confirmed>>) =>
      decide(s.db, s.identityItemId, "matchedToEntity", s.prior.source_entity_id)],
  ] as const) {
    const s = await confirmed();
    await apply(s.db, s.itemId);
    await redecide(s);
    const before = everything(s.db);
    await assert.rejects(resolve(s.db, s.secondId, RESOLVE_AT), /relocation was applied .* but/, name);
    assert.deepEqual(everything(s.db), before, `${name}: nothing written`);
  }
});

test("migration 0015 on a populated database: rows kept, hold trigger replaced, integrity intact", () => {
  const db = migratedSqlite("0014_relocation_hold.sql");
  const T = "2026-09-20T00:00:00Z";
  db.exec(`INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type, lifecycle, evidence_quality,
      evidence_quality_version, resolver_version, created_at, updated_at, publication_hold)
    VALUES ('spot-0001', 'n', 35.7, 139.7, 14, 1, 1, '14/1/1', 'unknown', 'active', 'q', 'q.v1', 'r.v1', '${T}', '${T}', 'locationSuperseded')`);
  const rows = db.prepare("SELECT * FROM spots").all();
  applyMigration(db, readFileSync(new URL("../migrations/0015_relocation_application.sql", import.meta.url), "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM spots").all(), rows);
  assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.match((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'spots_relocation_hold_is_final'").get() as { sql: string }).sql,
    /review_relocation_applications/);
});
