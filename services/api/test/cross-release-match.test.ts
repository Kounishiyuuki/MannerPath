// Cross-release matcher (ADR-0008 decision 3, Issue #78). The second releases below are ARTIFICIAL
// test fixtures derived from the one real Taito release; they exercise the engine and are not the
// "two real releases" validation ADR-0008 requires, which is why TAITO_ADAPTER keeps its gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import {
  CROSS_RELEASE_MATCHER_VERSION, RAW_SHA256_KEY_VERSION, planCrossReleaseMatch,
} from "../src/pipeline/match.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import {
  NOW, TAITO_BYTES, TEST_BLOCKED_TAITO_ADAPTER, addBlockedTestSource, importTaito, sequentialSpotIds,
} from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
// node:sqlite rows have a null prototype; spread them so deepEqual compares plain objects.
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;

const SOURCE = "test-cross-release";
const LATER = "2026-09-26T03:00:00Z";

/**
 * TEST ONLY: Taito rules under an unapproved source whose matcher counts as validated, without the
 * Taito list-page attestations (bound to the real 20260818 file) and without attenuations, which
 * the matcher does not carry across releases. Not in SOURCE_ADAPTERS.
 */
const TEST_CROSS_RELEASE_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: SOURCE, displayName: "TEST ONLY cross-release source", attributionText: null, publicationStatus: "blocked" },
  assertResolvable: () => {},
  attenuate: () => [],
  crossReleaseValidated: true,
};

const decoder = new TextDecoder();
const LINES = decoder.decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows, ""]
const bytesOf = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));
const ADDED_ROW = "35,131067,台東区,テスト追加喫煙所,テストツイカキツエンジョ,台東区上野公園１番,,終日利用可能,終日利用可能,35.7001,139.7801,";
const withAddedRow = () => bytesOf([...LINES.slice(0, -1), ADDED_ROW, ""]);
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };

// `approved` only in the sources ROW of a throwaway test DB, so publishTiles can be exercised; the
// adapter stays outside SOURCE_ADAPTERS and is never reviewed.
function freshDb(publicationStatus: "blocked" | "approved" = "blocked") {
  const db = new SqliteD1();
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY cross-release source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, ?, ?, ?)`,
  ).run(SOURCE, publicationStatus, NOW, NOW);
  return db;
}

async function applyFirst(db: SqliteD1) {
  const { releaseId } = await ingestRelease(db, TEST_CROSS_RELEASE_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, TEST_CROSS_RELEASE_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  return releaseId;
}

async function ingestSecond(db: SqliteD1, bytes: Uint8Array, meta = SECOND) {
  return (await ingestRelease(db, TEST_CROSS_RELEASE_ADAPTER, bytes, meta)).releaseId;
}

const resolveSecond = (db: SqliteD1, releaseId: number) =>
  resolveFirstRelease(db, TEST_CROSS_RELEASE_ADAPTER, releaseId, { now: LATER, newSpotId: sequentialSpotIds("B") });

function snapshot(db: SqliteD1) {
  return {
    entities: all(db, "SELECT * FROM source_entities ORDER BY source_entity_id"),
    decisions: all(db, "SELECT * FROM source_record_entities ORDER BY record_id"),
    spots: all(db, "SELECT * FROM spots ORDER BY spot_id"),
    links: all(db, "SELECT * FROM spot_source_entities ORDER BY source_entity_id"),
    provenance: all(db, "SELECT * FROM spot_field_provenance ORDER BY spot_id, field"),
    attenuations: all(db, "SELECT * FROM spot_field_attenuations ORDER BY spot_id, field, effect"),
    keys: all(db, "SELECT * FROM source_record_match_keys ORDER BY record_id"),
    releases: all(db, "SELECT release_id, status, is_current, applied_at FROM source_releases ORDER BY release_id"),
  };
}

test("the production Taito adapter keeps the second-release gate: only one real Taito release exists", async () => {
  assert.equal(TAITO_ADAPTER.crossReleaseValidated, false);
  const db = new SqliteD1();
  await importTaito(db);
  const { releaseId } = await ingestRelease(db, TAITO_ADAPTER, withAddedRow(), SECOND);
  await assert.rejects(resolveFirstRelease(db, TAITO_ADAPTER, releaseId, { now: LATER }), /cross-release reconciliation is not implemented/);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_record_match_keys").n, 0);
});

test("a first release writes no match keys and only first-release decisions (behavior unchanged)", async () => {
  const db = freshDb();
  await applyFirst(db);
  assert.equal(one(db, "SELECT count(*) AS n FROM source_record_match_keys").n, 0);
  assert.deepEqual(all(db, "SELECT DISTINCT method, matcher_version FROM source_record_entities"),
    [{ method: "new", matcher_version: "first-release.v1" }]);
});

test("identical records keep their source_entity and spot_id; a new record gets a new entity and spot", async () => {
  const db = freshDb();
  const firstId = await applyFirst(db);
  const before = snapshot(db);
  const secondId = await ingestSecond(db, withAddedRow());
  const result = await resolveSecond(db, secondId);
  assert.equal(result.status, "resolved");
  const after = snapshot(db);

  const decisions = all(db,
    `SELECT e.*, r.ordinal FROM source_record_entities e JOIN source_records r ON r.record_id = e.record_id
     WHERE e.release_id = ? ORDER BY r.ordinal`, secondId);
  assert.equal(decisions.length, 35);
  const previous = all(db,
    `SELECT e.source_entity_id, r.ordinal FROM source_record_entities e JOIN source_records r ON r.record_id = e.record_id
     WHERE e.release_id = ? ORDER BY r.ordinal`, firstId);
  for (const [i, d] of decisions.slice(0, 34).entries()) {
    assert.equal(d.method, "raw_identical");
    assert.equal(d.matcher_version, CROSS_RELEASE_MATCHER_VERSION);
    assert.equal(d.source_entity_id, previous[i].source_entity_id, "same upstream place -> same source_entity");
  }
  const added = decisions[34];
  assert.equal(added.method, "new");
  assert.equal(added.matcher_version, CROSS_RELEASE_MATCHER_VERSION);
  assert.equal(before.entities.some((e) => e.source_entity_id === added.source_entity_id), false);
  assert.equal(after.entities.length, 35);

  // Spot ids: the 34 previous spots are the same rows; exactly one spot is new, with a new id.
  assert.deepEqual(result.status === "resolved" && result.spotIds.slice(0, 34), before.links.map((l) => l.spot_id));
  assert.equal(after.spots.length, 35);
  const newSpot = after.spots.find((s) => !before.spots.some((b) => b.spot_id === s.spot_id))!;
  assert.equal(newSpot.name, "テスト追加喫煙所");
  assert.equal(newSpot.last_verified_at, "2026-09-18");
  assert.deepEqual(after.links.slice(0, 34), before.links, "entity -> spot links never change");

  for (const b of before.spots) {
    const a = after.spots.find((s) => s.spot_id === b.spot_id)!;
    // Values and created_at are unchanged; the evidence moved to the newer release.
    assert.deepEqual({ ...a, last_verified_at: null, updated_at: null }, { ...b, last_verified_at: null, updated_at: null });
    assert.equal(a.last_verified_at, "2026-09-18");
    assert.equal(a.updated_at, LATER);
  }
  // Provenance of matched spots cites the new release's record, same fields/columns/rules.
  const citing = all(db,
    `SELECT DISTINCT r.release_id FROM spot_field_provenance p JOIN source_records r ON r.record_id = p.record_id`);
  assert.deepEqual(citing, [{ release_id: secondId }]);
  assert.deepEqual(after.provenance.map((p) => [p.spot_id, p.field, p.source_columns_json, p.rule]),
    [...before.provenance.map((p) => [p.spot_id, p.field, p.source_columns_json, p.rule]),
      ...after.provenance.filter((p) => p.spot_id === newSpot.spot_id).map((p) => [p.spot_id, p.field, p.source_columns_json, p.rule])]
      .sort((x, y) => `${x[0]}${x[1]}`.localeCompare(`${y[0]}${y[1]}`)));

  assert.deepEqual(after.releases.map((r) => [r.release_id, r.status, r.is_current]), [[firstId, "applied", 0], [secondId, "applied", 1]]);
  // Match keys: one per record of both releases, under the recorded key version.
  assert.equal(after.keys.length, 34 + 35);
  assert.deepEqual([...new Set(after.keys.map((k) => k.key_version))], [RAW_SHA256_KEY_VERSION]);
  assert.ok(CROSS_RELEASE_MATCHER_VERSION.endsWith(RAW_SHA256_KEY_VERSION));
  assert.deepEqual(await resolveSecond(db, secondId), { status: "alreadyApplied" });
});

test("match key rows are immutable", async () => {
  const db = freshDb();
  await applyFirst(db);
  await resolveSecond(db, await ingestSecond(db, withAddedRow()));
  assert.throws(() => db.raw.prepare("UPDATE source_record_match_keys SET match_key = 'x'").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM source_record_match_keys").run(), /immutable/);
});

for (const [label, lines, kind] of [
  // A changed name: an edit and an add + remove cannot be told apart without a reviewed natural key.
  ["a changed record is ambiguous", [LINES[0], LINES[1].replace("上野公園前交番裏", "上野公園前交番裏（改）"), ...LINES.slice(2)], "ambiguousMatch"],
  // A dropped record: disappearance is never applied without completeness and review.
  ["a disappeared record waits for review", [LINES[0], ...LINES.slice(2)], "disappearance"],
] as const) {
  test(`${label}: review item only, nothing canonical written, no new entity`, async () => {
    const db = freshDb();
    await applyFirst(db);
    const secondId = await ingestSecond(db, bytesOf([...lines]));
    const before = snapshot(db);
    const result = await resolveSecond(db, secondId);
    assert.equal(result.status, "needsReview");
    assert.deepEqual(all(db, "SELECT kind FROM review_items"), [{ kind }]);
    const after = snapshot(db);
    assert.deepEqual(after, before);
    assert.equal(one(db, "SELECT status FROM source_releases WHERE release_id = ?", secondId).status, "ingested");
    assert.ok(one(db, "SELECT count(*) AS n FROM source_observations WHERE release_id = ?", secondId).n > 0);
  });
}

// The spot of the file's first record; the second release keeps that record raw-identical.
const firstSpot = (db: SqliteD1) => one(db,
  `SELECT l.spot_id FROM spot_source_entities l JOIN source_record_entities e ON e.source_entity_id = l.source_entity_id
   JOIN source_records r ON r.record_id = e.record_id WHERE r.ordinal = 1 ORDER BY r.release_id LIMIT 1`).spot_id as string;

for (const [label, mutate, pattern] of [
  ["canonical drift (name)", (db: SqliteD1, id: string) => db.raw.prepare("UPDATE spots SET name = '改変' WHERE spot_id = ?").run(id),
    /canonical drift in name/],
  ["canonical drift (coordinate)", (db: SqliteD1, id: string) => db.raw.prepare("UPDATE spots SET latitude = latitude + 0.001 WHERE spot_id = ?").run(id),
    /canonical drift in latitude/],
  ["an existing attenuation", (db: SqliteD1, id: string) => db.raw.prepare(
    `INSERT INTO spot_field_attenuations (spot_id, field, effect, attestation_version, reference_kind, reference_url, checked_at,
       release_id, release_content_sha256, release_observed_on, release_source_url, resolver_version, applied_at)
     SELECT ?, 'openingHours', 'hoursUnknown', 'test.v1', 'publisherWebPage', 'https://example.invalid/', ?, release_id,
       content_sha256, observed_on, source_url, 'test', ? FROM source_releases WHERE release_id = 1`).run(id, NOW, NOW),
    /merged, held or attenuated/],
  ["a publication hold", (db: SqliteD1, id: string) => db.raw.prepare("UPDATE spots SET publication_hold = 'locationSuperseded' WHERE spot_id = ?").run(id),
    /merged, held or attenuated/],
  ["a merge", (db: SqliteD1, id: string) => db.raw.prepare(
    "UPDATE spots SET merged_into = (SELECT spot_id FROM spots WHERE spot_id <> ? ORDER BY spot_id LIMIT 1) WHERE spot_id = ?").run(id, id),
    /merged, held or attenuated/],
] as const) {
  test(`a matched spot with ${label} is refused: evidence is not moved, nothing changes`, async () => {
    const db = freshDb();
    await applyFirst(db);
    mutate(db, firstSpot(db));
    const secondId = await ingestSecond(db, withAddedRow());
    const before = snapshot(db);
    await assert.rejects(resolveSecond(db, secondId), pattern);
    assert.deepEqual(snapshot(db), before, "spots, provenance, decisions, keys and release state unchanged");
    assert.equal(one(db, "SELECT count(*) AS n FROM source_record_entities WHERE release_id = ?", secondId).n, 0);
    assert.equal(one(db, "SELECT status FROM source_releases WHERE release_id = ?", secondId).status, "ingested");
  });
}

test("second release -> publish: matched spot ids stay in their tiles, only the new record adds a spot", async () => {
  const db = freshDb("approved");
  await applyFirst(db);
  const first = await publishTiles(db, { now: NOW });
  const tilesBefore = all(db, "SELECT tile_id, revision, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id");
  const publishedBefore = all(db, "SELECT spot_id, tile_id FROM tile_snapshot_spots ORDER BY spot_id");
  assert.equal(publishedBefore.length, 34, "no attenuations under the test adapter, so every spot is published");

  const secondId = await ingestSecond(db, withAddedRow());
  const resolved = await resolveSecond(db, secondId);
  assert.equal(resolved.status, "resolved");
  const second = await publishTiles(db, { now: LATER });
  const publishedAfter = all(db, "SELECT spot_id, tile_id FROM tile_snapshot_spots ORDER BY spot_id");
  assert.equal(publishedAfter.length, 35);
  const added = publishedAfter.filter((p) => !publishedBefore.some((b) => b.spot_id === p.spot_id));
  assert.equal(added.length, 1);
  assert.equal(added[0].spot_id, resolved.status === "resolved" && resolved.spotIds[34]);
  for (const b of publishedBefore) assert.ok(publishedAfter.some((a) => a.spot_id === b.spot_id && a.tile_id === b.tile_id));

  // Every tile carries a matched spot whose lastVerifiedAt moved, so every tile is republished.
  const tilesAfter = all(db, "SELECT tile_id, revision, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id");
  assert.equal(second.unchanged.length, 0);
  for (const b of tilesBefore) {
    const a = tilesAfter.find((t) => t.tile_id === b.tile_id)!;
    assert.equal(a.revision, b.revision + 1);
    assert.notEqual(a.content_sha256, b.content_sha256);
    const beforeIds = JSON.parse(b.body_json).spots.map((x: Row) => x.id);
    const afterSpots = JSON.parse(a.body_json).spots as Row[];
    for (const id of beforeIds) assert.equal(afterSpots.find((x) => x.id === id)?.lastVerifiedAt, "2026-09-18");
  }
  assert.equal(first.published.length, tilesBefore.length);
  assert.equal(new Set(tilesAfter.flatMap((t) => JSON.parse(t.body_json).spots.map((x: Row) => x.id))).size, 35);
});

test("a release not newer than the current one is refused before anything is written", async () => {
  const db = freshDb();
  await applyFirst(db);
  const secondId = await ingestSecond(db, withAddedRow(), { ...SECOND, observedOn: "2026-08-01" });
  const before = snapshot(db);
  await assert.rejects(resolveSecond(db, secondId), /is not newer than current release/);
  assert.deepEqual(snapshot(db), before);
});

test("cross-source: identical rows of another source are never matched", async () => {
  const db = freshDb();
  addBlockedTestSource(db);
  await applyFirst(db);
  const { releaseId } = await ingestRelease(db, TEST_BLOCKED_TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, TEST_BLOCKED_TAITO_ADAPTER, releaseId, { now: LATER, newSpotId: sequentialSpotIds("C") });
  const decisions = all(db,
    `SELECT e.method, se.source_id FROM source_record_entities e JOIN source_entities se ON se.source_entity_id = e.source_entity_id
     WHERE e.release_id = ?`, releaseId);
  assert.equal(decisions.length, 34);
  assert.ok(decisions.every((d) => d.method === "new" && d.source_id === "test-blocked-municipal"));
  assert.equal(one(db, "SELECT count(*) AS n FROM spots").n, 68);
  // The schema refuses a decision linking a record to another source's entity.
  const foreign = one(db, "SELECT source_entity_id FROM source_entities WHERE source_id = ? LIMIT 1", SOURCE).source_entity_id;
  const record = one(db, "SELECT record_id FROM source_records WHERE release_id = ? LIMIT 1", releaseId).record_id;
  assert.throws(() => db.raw.prepare(
    `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at)
     VALUES (?, ?, ?, 'raw_identical', 'x', ?)`).run(record, releaseId, foreign, LATER), /different sources|UNIQUE/);
});

test("planner: unique raw match, new only when no previous entity is left, duplicates are ambiguous", () => {
  const prev = (recordId: number, sourceEntityId: number, rawSha256: string) => ({ recordId, sourceEntityId, rawSha256, spotId: `s${sourceEntityId}` });
  assert.deepEqual(planCrossReleaseMatch([prev(1, 10, "a")], [{ recordId: 2, rawSha256: "a" }, { recordId: 3, rawSha256: "b" }]), {
    decisions: [
      { recordId: 2, method: "raw_identical", sourceEntityId: 10, previousRecordId: 1 },
      { recordId: 3, method: "new" },
    ],
    ambiguous: [],
    unmatchedPreviousEntityIds: [],
  });
  // Two new records with the same raw values: the previous entity is never matched twice.
  const dup = planCrossReleaseMatch([prev(1, 10, "a")], [{ recordId: 2, rawSha256: "a" }, { recordId: 3, rawSha256: "a" }]);
  assert.deepEqual(dup.decisions, []);
  assert.deepEqual(dup.ambiguous.map((a) => [a.recordId, a.candidateEntityIds]), [[2, [10]], [3, [10]]]);
  assert.deepEqual(dup.unmatchedPreviousEntityIds, []);
  // Two previous entities with the same raw values.
  const prevDup = planCrossReleaseMatch([prev(1, 10, "a"), prev(2, 11, "a")], [{ recordId: 3, rawSha256: "a" }]);
  assert.deepEqual(prevDup.ambiguous.map((a) => a.candidateEntityIds), [[10, 11]]);
  // A changed record while a previous entity is unmatched: ambiguous, never a silent new entity.
  const changed = planCrossReleaseMatch([prev(1, 10, "a")], [{ recordId: 2, rawSha256: "z" }]);
  assert.deepEqual(changed.decisions, []);
  assert.deepEqual(changed.ambiguous.map((a) => a.candidateEntityIds), [[10]]);
  assert.deepEqual(changed.unmatchedPreviousEntityIds, []);
  // Disappearance: reported as a candidate, not decided.
  assert.deepEqual(planCrossReleaseMatch([prev(1, 10, "a"), prev(2, 11, "b")], [{ recordId: 3, rawSha256: "a" }]).unmatchedPreviousEntityIds, [11]);
});
