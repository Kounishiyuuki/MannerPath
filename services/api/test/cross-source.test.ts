// Cross-source review and merge (ADR-0008 decision 4, Issue #107, migration 0019).
//
// Synthetic independently reviewed sources: A is the real Taito release; B is TEST-ONLY — Taito-format rows derived
// from A (copies, moved copies, renamed copies) under Koto's reviewed registry entry, parsed with Taito's rules, so
// overlap is controlled and v3 promotion's registry gate passes. The real Taito / Osaka / Koto releases barely
// overlap and are not used as identity evidence; their regression is the last test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Db } from "../src/db.ts";
import { COMPARED_FIELDS, CrossSourceError, applyCrossSourceMerge, generateCrossSourceCandidates, normalizeText,
  recallPairs, recordCrossSourceDecision } from "../src/pipeline/cross-source.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, KOTO_SOURCE_ID } from "../src/pipeline/koto-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../src/pipeline/osaka-adapter.ts";
import { PromotionError, buildMultiSourcePromotionBundle, buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE } from "../src/pipeline/taito.ts";
import { readPublishedSpot } from "../src/spots/detail.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { rehashed } from "./support/promotion-tamper.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => (db.raw.prepare(sql).all(...p) as Row[]).map((r) => ({ ...r }));
const one = (db: SqliteD1, sql: string, ...p: any[]) => ({ ...(db.raw.prepare(sql).get(...p) as Row) });
const REVIEWER = "test-reviewer";
const DECIDED = "2026-09-29T01:00:00Z";
const APPLY = "2026-09-29T02:00:00Z";
const REPUBLISH = "2026-09-29T03:00:00Z";
const EVIDENCE = "TEST: reviewed on-site photos and both site plans identify one designated smoking enclosure";

/** TEST ONLY: Taito's parser under Koto's reviewed registry entry, no Taito attestations. Not in SOURCE_ADAPTERS. */
const SOURCE_B: SourceAdapter = { ...TAITO_ADAPTER, registry: KOTO_ADAPTER.registry, assertResolvable: () => {}, attenuate: () => [] };
const B_RELEASE = { ...TAITO_FIXTURE_RELEASE, sourceUrl: "https://example.invalid/test-only-source-b.csv", observedOn: "2026-09-01" };

const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n"); // [header, 34 rows incl. one multi-line, ""]
const cells = (line: string) => line.split(",");
const row = (ordinal: number) => cells(LINES.find((l) => l.startsWith(`${ordinal},`))!);
const shifted = (c: string[], dLat: number) => { const x = [...c]; x[9] = (Number(x[9]) + dLat).toFixed(6); return x; };

/** B's synthetic rows, keyed by what they test. Ordinals are A records with no attenuation or hold. */
function sourceBBytes(ids: number[]): Uint8Array {
  const [same, moved, named, host, far, heated] = ids.map(row);
  const hostA = [...host]; // same host/business name as a renamed A record, 300 m away: recall only
  const rows = [
    same,                                                     // identical copy: agrees on every value
    shifted(moved, 0.0003),                                   // ~33 m away: coordinate conflict
    shifted(named, 0.003),                                    // ~330 m away, same name: name recall
    (() => { const x = shifted(hostA, 0.0027); x[3] = "テスト用コンビニ上野店"; return x; })(),
    (() => { const x = [...far]; x[9] = "34.690000"; x[10] = "135.500000"; return x; })(), // Osaka, same name: never
    (() => { const x = [...heated]; x[3] = `${x[3]}※加熱式たばこ専用`; return x; })(),          // unknown vs no
  ].map((c, i) => { const x = [...c]; x[0] = String(i + 1); return x.join(","); });
  return new TextEncoder().encode([LINES[0], ...rows, ""].join("\r\n"));
}

interface World { db: SqliteD1; a: (ordinal: number) => string; b: (ordinal: number) => string; ids: number[] }

async function world(): Promise<World> {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("A") });
  // A records that the Taito attestations leave untouched, so a copy in B can agree exactly.
  const clean = all(db, `SELECT r.ordinal FROM source_records r
    JOIN spot_field_provenance p ON p.record_id = r.record_id AND p.field = 'existence'
    JOIN spots s ON s.spot_id = p.spot_id
    WHERE s.publication_hold IS NULL AND s.lifecycle = 'active'
      AND NOT EXISTS (SELECT 1 FROM spot_field_attenuations t WHERE t.spot_id = s.spot_id)
      AND r.ordinal <> 32 -- the one multi-line record
    ORDER BY r.ordinal`).map((r) => r.ordinal as number);
  const ids = [clean[0], clean[4], clean[8], clean[12], clean[16], clean[20]];
  assert.equal(ids.every((id) => Number.isInteger(id)), true);
  await ensureReviewedSource(db, KOTO_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, SOURCE_B, sourceBBytes(ids), B_RELEASE);
  assert.equal((await resolveFirstRelease(db, SOURCE_B, releaseId, { now: NOW, newSpotId: sequentialSpotIds("B") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  const spotOf = (sourceId: string, ordinal: number) => one(db, `SELECT p.spot_id FROM spot_field_provenance p
    JOIN source_records r ON r.record_id = p.record_id JOIN source_releases rel ON rel.release_id = r.release_id
    WHERE p.field = 'existence' AND rel.source_id = ? AND r.ordinal = ?`, sourceId, ordinal).spot_id as string;
  return { db, ids, a: (o) => spotOf(TAITO_ADAPTER.registry.sourceId, o), b: (o) => spotOf(KOTO_SOURCE_ID, o) };
}

const candidateFor = (db: SqliteD1, x: string, y: string) =>
  one(db, `SELECT * FROM cross_source_current_candidates WHERE spot_a_id = ? AND spot_b_id = ?`, ...[x, y].sort());
const decide = (db: SqliteD1, candidateId: number, decision: "sameRealWorldSpot" | "distinctSpots" | "insufficientEvidence",
  survivorSpotId?: string, decidedAt = DECIDED) =>
  recordCrossSourceDecision(db, { candidateId, decision, survivorSpotId, identityEvidence: decision === "sameRealWorldSpot" ? EVIDENCE : undefined,
    decidedBy: REVIEWER, decidedAt });
const canonical = (db: SqliteD1) => Object.fromEntries(["spots", "spot_source_entities", "spot_field_provenance",
  "spot_field_attenuations", "source_entities", "source_records", "tile_snapshots", "tile_snapshot_spots"]
  .map((t) => [t, all(db, `SELECT * FROM ${t} ORDER BY 1, 2`)]));
const published = (db: SqliteD1, spotId: string) => one(db, "SELECT count(*) n FROM tile_snapshot_spots WHERE spot_id = ?", spotId).n === 1;

// ---------------------------------------------------------------------------------------------------------------

test("recall rule (pure): 100 m alone, 100-500 m only with a normalized name, never beyond 500 m or within a source", () => {
  const s = (spotId: string, sourceId: string, dLat: number, name: string) => ({ spotId, sourceId, latitude: 35.7 + dLat, longitude: 139.77, name, location: null });
  assert.deepEqual(recallPairs([s("a", "x", 0, "Ａ公園 喫煙所"), s("b", "y", 0.0005, "a公園喫煙所")]).map((p) => p.reasons), [["proximity100m", "normalizedName"]]);
  assert.deepEqual(recallPairs([s("a", "x", 0, "one"), s("b", "y", 0.003, "two")]), [], "330 m, different names");
  assert.deepEqual(recallPairs([s("a", "x", 0, "same"), s("b", "y", 0.003, "same")]).map((p) => p.reasons), [["normalizedName"]]);
  assert.deepEqual(recallPairs([s("a", "x", 0, "same"), s("b", "y", 0.006, "same")]), [], "660 m: never, whatever the name");
  assert.deepEqual(recallPairs([s("a", "x", 0, "same"), s("b", "x", 0, "same")]), [], "same source: cross-release matching's job");
  assert.equal(normalizeText("  "), "");
  assert.deepEqual(recallPairs([s("b", "y", 0, "n"), s("a", "x", 0, "n")]), recallPairs([s("a", "x", 0, "n"), s("b", "y", 0, "n")]));
  assert.throws(() => recallPairs([s("a", "x", Number.NaN, "n")]), CrossSourceError);
});

test("1: a near pair becomes a candidate bound to both states, and nothing is merged or unpublished", async () => {
  const w = await world();
  const before = canonical(w.db);
  const ids = await generateCrossSourceCandidates(w.db, { now: NOW });
  assert.ok(ids.length >= 4);
  const c = candidateFor(w.db, w.a(w.ids[0]), w.b(1));
  assert.deepEqual(JSON.parse(c.reasons_json), ["proximity100m", "normalizedName"]);
  assert.equal(c.state_a_json, one(w.db, "SELECT state_json FROM cross_source_spot_state WHERE spot_id = ?", c.spot_a_id).state_json);
  assert.deepEqual(canonical(w.db), before, "a candidate changes nothing canonical or published");
  assert.deepEqual(await generateCrossSourceCandidates(w.db, { now: NOW }), ids, "re-running generation is a no-op");
  assert.equal(one(w.db, "SELECT count(*) n FROM cross_source_candidates").n, ids.length);
  assert.deepEqual(await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY }),
    { status: "notApplicable", candidateId: c.cross_source_candidate_id, reason: "noDecision" });
  // The far same-name copy (Osaka coordinates) is no candidate.
  assert.equal(one(w.db, "SELECT count(*) n FROM cross_source_candidates WHERE ? IN (spot_a_id, spot_b_id)", w.b(5)).n, 0);
});

test("2: a shared host/business name only nominates; it never merges, and sameRealWorldSpot needs identity evidence", async () => {
  const w = await world();
  // Give A's record the same convenience-store name B's renamed copy carries, 300 m away.
  const aHost = w.a(w.ids[3]);
  w.db.raw.prepare("UPDATE spots SET name = 'テスト用コンビニ上野店' WHERE spot_id = ?").run(aHost);
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const c = candidateFor(w.db, aHost, w.b(4));
  assert.deepEqual(JSON.parse(c.reasons_json), ["normalizedName"]);
  const before = canonical(w.db);
  assert.equal((await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY })).status, "notApplicable");
  await assert.rejects(recordCrossSourceDecision(w.db, { candidateId: c.cross_source_candidate_id, decision: "sameRealWorldSpot",
    survivorSpotId: aHost, decidedBy: REVIEWER, decidedAt: DECIDED }), /identity evidence/);
  await assert.rejects(recordCrossSourceDecision(w.db, { candidateId: c.cross_source_candidate_id, decision: "sameRealWorldSpot",
    survivorSpotId: aHost, identityEvidence: "   ", decidedBy: REVIEWER, decidedAt: DECIDED }), /identity evidence/);
  assert.deepEqual(canonical(w.db), before);
});

for (const decision of ["distinctSpots", "insufficientEvidence"] as const) {
  test(`3/4: ${decision} is recorded as evidence and changes nothing canonical`, async () => {
    const w = await world();
    await generateCrossSourceCandidates(w.db, { now: NOW });
    const c = candidateFor(w.db, w.a(w.ids[0]), w.b(1));
    const before = canonical(w.db);
    await decide(w.db, c.cross_source_candidate_id, decision);
    await assert.rejects(recordCrossSourceDecision(w.db, { candidateId: c.cross_source_candidate_id, decision,
      survivorSpotId: c.spot_a_id, decidedBy: REVIEWER, decidedAt: DECIDED }), /not valid/);
    assert.deepEqual(await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY }),
      { status: "notApplicable", candidateId: c.cross_source_candidate_id, reason: decision });
    assert.deepEqual(canonical(w.db), before);
    assert.throws(() => w.db.raw.prepare("UPDATE cross_source_decisions SET decision = 'sameRealWorldSpot'").run(), /immutable/);
    assert.throws(() => w.db.raw.prepare("DELETE FROM cross_source_candidates").run(), /immutable/);
  });
}

test("5/6/9/16: an agreeing sameRealWorldSpot merges on the explicit survivor; the loser redirects; evidence stays; only the loser's tile changes", async () => {
  const w = await world();
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const survivor = w.a(w.ids[0]), loser = w.b(1);
  const c = candidateFor(w.db, survivor, loser);
  await assert.rejects(decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", "sp_NOTACANDIDATE0000000000000"), /not valid/);
  const decisionId = await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
  const spotIds = all(w.db, "SELECT spot_id FROM spots ORDER BY spot_id").map((r) => r.spot_id);
  const evidence = (id: string) => ({ links: all(w.db, "SELECT * FROM spot_source_entities WHERE spot_id = ?", id),
    provenance: all(w.db, "SELECT * FROM spot_field_provenance WHERE spot_id = ? ORDER BY field", id),
    attenuations: all(w.db, "SELECT * FROM spot_field_attenuations WHERE spot_id = ?", id) });
  const loserEvidence = evidence(loser), survivorEvidence = evidence(survivor);
  const records = all(w.db, "SELECT * FROM source_records ORDER BY record_id");
  const tilesBefore = new Map(all(w.db, "SELECT * FROM tile_snapshots").map((t) => [t.tile_id, t]));
  const survivorRow = one(w.db, "SELECT * FROM spots WHERE spot_id = ?", survivor);

  const result = await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY });
  assert.equal(result.status, "applied");
  assert.deepEqual(result.status === "applied" && [result.survivorSpotId, result.loserSpotId, result.held, result.conflicts], [survivor, loser, false, []]);
  assert.deepEqual(all(w.db, "SELECT spot_id FROM spots ORDER BY spot_id").map((r) => r.spot_id), spotIds, "no id issued, none deleted");
  assert.equal(one(w.db, "SELECT merged_into FROM spots WHERE spot_id = ?", loser).merged_into, survivor);
  assert.deepEqual(one(w.db, "SELECT * FROM spots WHERE spot_id = ?", survivor), survivorRow, "the survivor row is untouched");
  assert.deepEqual(evidence(loser), loserEvidence, "the loser keeps its source's links, provenance and attenuations");
  assert.deepEqual(evidence(survivor), survivorEvidence);
  assert.deepEqual(all(w.db, "SELECT * FROM source_records ORDER BY record_id"), records, "raw evidence of both sources stays");
  const app = one(w.db, "SELECT * FROM cross_source_merge_applications");
  assert.deepEqual([app.cross_source_decision_id, app.survivor_spot_id, app.loser_spot_id, app.conflict_hold, app.executor_version],
    [decisionId, survivor, loser, 0, "cross-source-merge.v1"]);

  const report = await publishTiles(w.db, { now: REPUBLISH });
  const loserTile = String(one(w.db, "SELECT tile_id FROM spots WHERE spot_id = ?", loser).tile_id);
  assert.deepEqual(report.published.map((p) => p.tileId), [loserTile], "only the loser's tile is rebuilt");
  for (const [id, t] of tilesBefore) if (id !== loserTile) assert.deepEqual(one(w.db, "SELECT * FROM tile_snapshots WHERE tile_id = ?", id), t);
  assert.equal(published(w.db, survivor), true, "an agreeing survivor keeps publishing");
  assert.equal(published(w.db, loser), false);
  const viaLoser = await readPublishedSpot(w.db, loser);
  assert.deepEqual([viaLoser?.requestedId, viaLoser?.mergedInto, viaLoser?.spot.id], [loser, survivor, survivor], "the old id redirects");
});

test("7/8: inbound redirects are repointed (one hop kept), and cycles or chains are refused", async () => {
  const w = await world();
  const survivor = w.a(w.ids[0]), loser = w.b(1), old = w.b(3);
  // An existing redirect old -> loser (an earlier same-source merge; unpublished first).
  w.db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(old);
  w.db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(loser, old);
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const c = candidateFor(w.db, survivor, loser);
  await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
  assert.equal((await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY })).status, "applied");
  assert.deepEqual(all(w.db, "SELECT spot_id, merged_into FROM spots WHERE merged_into IS NOT NULL ORDER BY spot_id"),
    [{ spot_id: loser, merged_into: survivor }, { spot_id: old, merged_into: survivor }].sort((x, y) => (x.spot_id < y.spot_id ? -1 : 1)));
  assert.deepEqual(JSON.parse(one(w.db, "SELECT redirected_spot_ids_json j FROM cross_source_merge_applications").j), [old]);
  // No redirect points at a redirect; no cycle can be made.
  assert.equal(one(w.db, "SELECT count(*) n FROM spots s JOIN spots t ON t.spot_id = s.merged_into WHERE t.merged_into IS NOT NULL").n, 0);
  w.db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(survivor);
  assert.throws(() => w.db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(loser, survivor), /itself merged|repoint/);
  assert.throws(() => w.db.raw.prepare("UPDATE spots SET merged_into = NULL WHERE spot_id = ?").run(loser), /cannot be removed/);
});

test("10/11/12: unknown vs false and coordinate conflicts are detected, never resolved, and hold the survivor", async () => {
  const w = await world();
  await generateCrossSourceCandidates(w.db, { now: NOW });
  for (const [ordinalB, ordinalA, expected] of [[6, w.ids[5], ["supports_paper", "supports_heated"]], [2, w.ids[1], ["latitude"]]] as const) {
    const survivor = w.a(ordinalA), loser = w.b(ordinalB);
    const c = candidateFor(w.db, survivor, loser);
    await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
    const values = one(w.db, "SELECT * FROM spots WHERE spot_id = ?", survivor);
    const result = await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY });
    assert.equal(result.status, "applied");
    if (result.status !== "applied") return;
    assert.deepEqual(result.conflicts, [...expected]);
    assert.equal(result.held, true);
    assert.deepEqual(one(w.db, "SELECT * FROM spots WHERE spot_id = ?", survivor), values, "no value is picked: unknown stays unknown");
    assert.equal(published(w.db, survivor), false, "held and unpublished in the same statement");
  }
  assert.equal(one(w.db, "SELECT supports_paper FROM spots WHERE spot_id = ?", w.a(w.ids[5])).supports_paper, "unknown");
  await publishTiles(w.db, { now: REPUBLISH });
  assert.equal(published(w.db, w.a(w.ids[5])), false, "publishTiles leaves a held survivor out");
  const held = one(w.db, "SELECT spot_id, tile_id FROM spots WHERE spot_id = ?", w.a(w.ids[1]));
  assert.throws(() => w.db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(held.spot_id, held.tile_id),
    /cross-source merge conflict/);
  assert.ok(COMPARED_FIELDS.includes("supports_paper"));
});

test("13: a candidate whose spot changed is stale: no decision, no application", async () => {
  const w = await world();
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const survivor = w.a(w.ids[0]), loser = w.b(1);
  const c = candidateFor(w.db, survivor, loser);
  await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
  // A spot changes after the review (here: a new inbound redirect to the loser).
  const other = w.b(3);
  w.db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(other);
  w.db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(loser, other);
  const before = canonical(w.db);
  await assert.rejects(applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY }), /stale/);
  await assert.rejects(decide(w.db, c.cross_source_candidate_id, "distinctSpots"), /stale/);
  assert.deepEqual(canonical(w.db), before);
  assert.equal(one(w.db, "SELECT count(*) n FROM cross_source_merge_applications").n, 0);
  // Even past the executor's own check, the schema refuses it inside the statement.
  assert.throws(() => w.db.raw.prepare(`INSERT INTO cross_source_merge_applications (cross_source_candidate_id, cross_source_decision_id,
    survivor_spot_id, loser_spot_id, redirected_spot_ids_json, conflicts_json, conflict_hold, executor_version, applied_at)
    VALUES (?, 1, ?, ?, ?, '[]', 0, 'cross-source-merge.v1', ?)`).run(c.cross_source_candidate_id, survivor, loser, JSON.stringify([other]), APPLY), /stale/);
});

test("14: a superseded review is not applied, and a decision recorded between read and write aborts the merge", async () => {
  const w = await world();
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const survivor = w.a(w.ids[0]), loser = w.b(1);
  const c = candidateFor(w.db, survivor, loser);
  await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
  await decide(w.db, c.cross_source_candidate_id, "insufficientEvidence", undefined, APPLY);
  assert.deepEqual(await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY }),
    { status: "notApplicable", candidateId: c.cross_source_candidate_id, reason: "insufficientEvidence" });

  await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor, REPUBLISH);
  const before = canonical(w.db);
  const racing: Db = { prepare: (sql) => w.db.prepare(sql), batch: async (statements) => {
    await decide(w.db, c.cross_source_candidate_id, "distinctSpots", undefined, REPUBLISH);
    return w.db.batch(statements);
  } };
  await assert.rejects(applyCrossSourceMerge(racing, c.cross_source_candidate_id, { now: APPLY }), /not the latest sameRealWorldSpot/);
  assert.deepEqual(canonical(w.db), before);
  assert.equal(one(w.db, "SELECT count(*) n FROM cross_source_merge_applications").n, 0);
});

test("15: reapplying the same decision is alreadyApplied and writes nothing; a newer decision after it fails closed", async () => {
  const w = await world();
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const survivor = w.a(w.ids[0]), loser = w.b(1);
  const c = candidateFor(w.db, survivor, loser);
  const decisionId = await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
  await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY });
  const after = canonical(w.db);
  assert.deepEqual(await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: REPUBLISH }),
    { status: "alreadyApplied", candidateId: c.cross_source_candidate_id, decisionId, survivorSpotId: survivor, loserSpotId: loser });
  assert.deepEqual(canonical(w.db), after);
  assert.equal(one(w.db, "SELECT count(*) n FROM cross_source_merge_applications").n, 1);
  assert.throws(() => w.db.raw.prepare("UPDATE cross_source_merge_applications SET conflict_hold = 1").run(), /immutable/);
  assert.throws(() => w.db.raw.prepare("DELETE FROM cross_source_merge_applications").run(), /immutable/);
});

test("removal and relocation of a merge survivor are refused (temporary cross-source gate)", async () => {
  const w = await world();
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const survivor = w.a(w.ids[0]);
  const c = candidateFor(w.db, survivor, w.b(1));
  await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
  await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY });
  for (const table of ["review_removal_applications", "review_relocation_applications"]) {
    const trigger = one(w.db, "SELECT sql FROM sqlite_master WHERE name = ?", `${table}_cross_source_gate`).sql as string;
    assert.match(trigger, /cross-source merge survivor/);
  }
  assert.throws(() => w.db.raw.prepare(`INSERT INTO review_removal_applications (spot_id, review_item_id, review_decision_id, executor_version, applied_at)
    VALUES (?, 1, 1, 'review-removal-executor.v1', ?)`).run(survivor, APPLY), /cross-source merge survivor|FOREIGN KEY/);
});

// ---------------------------------------------------------------------------------------------------------------
// Promotion v3.

async function mergedWorld() {
  const w = await world();
  await generateCrossSourceCandidates(w.db, { now: NOW });
  const old = w.b(3);
  const merges: [string, string][] = [[w.a(w.ids[0]), w.b(1)], [w.a(w.ids[5]), w.b(6)]]; // agreeing, and held
  // An inbound redirect to a loser, made before the candidates, travels as a repointed redirect.
  w.db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(old);
  w.db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(w.b(6), old);
  await generateCrossSourceCandidates(w.db, { now: NOW });
  for (const [survivor, loser] of merges) {
    const c = candidateFor(w.db, survivor, loser);
    await decide(w.db, c.cross_source_candidate_id, "sameRealWorldSpot", survivor);
    assert.equal((await applyCrossSourceMerge(w.db, c.cross_source_candidate_id, { now: APPLY })).status, "applied");
  }
  return { ...w, merges, old };
}

test("17: a v3 bundle reproduces merges, redirects, retained evidence, audit, holds and tile membership on a fresh database", async () => {
  const w = await mergedWorld();
  await assert.rejects(buildMultiSourcePromotionBundle(w.db), (e: unknown) => e instanceof PromotionError && /membership|republish/.test(e.message),
    "before publishTiles the export refuses");
  await publishTiles(w.db, { now: REPUBLISH });
  await assert.rejects(buildPromotionBundle(w.db, { releaseId: 1 }), /promotion-bundle.v3/);
  const bundle = await buildMultiSourcePromotionBundle(w.db);
  assert.equal(bundle.manifest.rows.promotion_cross_source_merge_attestations, 2);

  const target = migratedSqlite();
  applyPromotionBundle(target, bundle.sql);
  const t = new SqliteD1(target);
  const pick = (db: SqliteD1, sql: string) => all(db, sql);
  for (const sql of [
    "SELECT spot_id, merged_into, lifecycle, publication_hold FROM spots WHERE merged_into IS NOT NULL OR spot_id IN (SELECT survivor_spot_id FROM cross_source_merges) ORDER BY spot_id",
    "SELECT * FROM tile_snapshot_spots ORDER BY spot_id",
    "SELECT * FROM tile_snapshots ORDER BY tile_id",
    "SELECT * FROM cross_source_publication_blocks ORDER BY spot_id",
    `SELECT * FROM spot_field_provenance WHERE spot_id IN (${[...w.merges.flat(), w.old].map((id) => `'${id}'`).join(", ")}) ORDER BY spot_id, field`,
    `SELECT * FROM spot_source_entities WHERE spot_id IN (${[...w.merges.flat(), w.old].map((id) => `'${id}'`).join(", ")}) ORDER BY source_entity_id`,
    "SELECT source_id, attribution_text FROM sources ORDER BY source_id",
  ]) assert.deepEqual(pick(t, sql), pick(w.db, sql), sql);
  const attested = all(t, "SELECT loser_spot_id, survivor_spot_id, conflict_hold, identity_evidence, decided_by, conflicts_json FROM promotion_cross_source_merge_attestations ORDER BY loser_spot_id");
  assert.deepEqual(attested.map((a) => [a.survivor_spot_id, a.conflict_hold]).sort(), [[w.merges[0][0], 0], [w.merges[1][0], 1]].sort());
  assert.ok(attested.every((a) => a.identity_evidence === EVIDENCE && a.decided_by === REVIEWER));
  assert.equal(all(t, "SELECT * FROM cross_source_candidates").length, 0, "the runtime review chain does not travel");
  assert.deepEqual((await readPublishedSpot(t, w.merges[0][1]))?.spot.id, w.merges[0][0], "redirects resolve on the target");
  // A re-export of the bootstrapped database is byte-identical.
  assert.equal((await buildMultiSourcePromotionBundle(t)).sql, bundle.sql);
});

test("18: a tampered merge in a v3 bundle is refused and rolls back the whole file", async () => {
  const w = await mergedWorld();
  await publishTiles(w.db, { now: REPUBLISH });
  const { sql } = await buildMultiSourcePromotionBundle(w.db);
  const tampers: [string, (body: string) => string][] = [
    ["an attestation dropped", (b) => b.replace(/^INSERT INTO promotion_cross_source_merge_attestations .*\n/m, "")],
    ["a held merge claimed unheld", (b) => b.replace(/(INSERT INTO promotion_cross_source_merge_attestations [^\n]*), 1, ('cross-source-merge\.v1')/, "$1, 0, $2")],
    ["a redirect retargeted", (b) => b.replace(new RegExp(`(INSERT INTO spots [^\\n]*'${w.merges[0][1]}', )'${w.merges[0][0]}'`), `$1'${w.merges[1][0]}'`)],
  ];
  for (const [name, edit] of tampers) {
    const tampered = await rehashed(sql, edit);
    assert.notEqual(tampered, sql, `${name}: the edit applied`);
    const target = migratedSqlite();
    assert.throws(() => applyPromotionBundle(target, tampered), undefined, name);
    for (const table of ["sources", "spots", "tile_snapshot_spots", "promotion_cross_source_merge_attestations", "promotion_multi_bootstraps"]) {
      assert.equal((target.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n, 0, `${name}: ${table} rolled back`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------

test("19: Taito + Osaka + Koto real pipeline: 381 canonical / 379 published, candidates change nothing, v3 bundle has no merge key", async () => {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  for (const [adapter, release, file, prefix] of [
    [OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, "osaka-designated-smoking-areas/opendata_1012.csv", "2"],
    [KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, "koto-station-smoking-areas/131083_237_public_smoking_area_station.csv", "3"],
  ] as const) {
    await ensureReviewedSource(db, adapter.registry.sourceId, NOW);
    const bytes = new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${file}`, import.meta.url)));
    const { releaseId } = await ingestRelease(db, adapter, bytes, release);
    assert.equal((await resolveFirstRelease(db, adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds(prefix) })).status, "resolved");
  }
  await publishTiles(db, { now: NOW });
  assert.equal(one(db, "SELECT count(*) n FROM spots").n, 381);
  assert.equal(one(db, "SELECT count(*) n FROM tile_snapshot_spots").n, 379);
  const bundleBefore = await buildMultiSourcePromotionBundle(db);
  const before = canonical(db);
  await generateCrossSourceCandidates(db, { now: NOW });
  assert.deepEqual(canonical(db), before, "candidates alone change nothing");
  assert.equal((await publishTiles(db, { now: REPUBLISH })).published.length, 0);
  const bundle = await buildMultiSourcePromotionBundle(db);
  assert.equal(bundle.sql, bundleBefore.sql, "the v3 bytes do not depend on unreviewed candidates");
  assert.equal("promotion_cross_source_merge_attestations" in bundle.manifest.rows, false);
  assert.deepEqual(bundle.manifest.sources.map((s) => s.sourceId), [KOTO_SOURCE_ID, OSAKA_SOURCE_ID, TAITO_ADAPTER.registry.sourceId].sort());
});
