// ADR-0018 §5, migration 0033: a reviewed source-evidence hold. Source health stays advisory; only a maintainer's
// explicit hold, citing a live report that shows the fact range or the page gone, takes a published spot out of
// publication (fail closed), and only an explicit clear brings it back. Every hold and clear stays in the table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { clearSourceEvidenceHolds, evidenceHoldSignal, holdSourceEvidence } from "../src/pipeline/evidence-hold.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import {
  KOMATSU_AIRPORT_ADAPTER, KOMATSU_AIRPORT_FIXTURE_RELEASE, KOMATSU_AIRPORT_FIXTURE_SHA256, KOMATSU_AIRPORT_SOURCE_ID,
} from "../src/pipeline/komatsu-airport-adapter.ts";
import { buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { checkSourceHealth } from "../src/source-health/check.ts";
import { buildReport, type HealthReport } from "../src/source-health/evaluate.ts";
import { extractRightsScope, rightsFingerprint } from "../src/source-health/rights.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { productionHealthTargets, sourceReviews } from "../scripts/source-health.ts";
import { run as sourceHoldCli } from "../scripts/source-hold.ts";
import { importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-10-12T00:00:00Z";
const LATER = new Date("2026-10-13T00:00:00Z");
const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/komatsu-airport-smoking-places/komatsu-airport-page-facts.csv", import.meta.url)));
const SHA = "a".repeat(64);
const published = (db: SqliteD1) => v1TileRows(db).flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots.map((s) => s.id));
const holds = (db: SqliteD1) => db.raw.prepare("SELECT * FROM spot_evidence_holds ORDER BY hold_id").all() as Record<string, unknown>[];
const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

async function komatsu(db = new SqliteD1()) {
  await ensureReviewedSource(db, KOMATSU_AIRPORT_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, KOMATSU_AIRPORT_ADAPTER, BYTES, KOMATSU_AIRPORT_FIXTURE_RELEASE);
  await recordReviewedAnchors(db, KOMATSU_AIRPORT_ADAPTER, KOMATSU_AIRPORT_FIXTURE_SHA256, NOW);
  await resolveFirstRelease(db, KOMATSU_AIRPORT_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("K") });
  await publishTiles(db, { now: NOW });
  assert.equal(published(db).length, 1);
  return db;
}

// A health report for the Komatsu page, as the maintainer would save it from `source:health --live`.
const LISTED = `<html><body><img alt=""> 喫煙場所はどこですか。 国際線２F出発ロビーに1ヶ所、屋外にも1ヶ所（バス乗り場付近） 関連リンク</body></html>`;
async function report(body: string, status = 200, offline = false): Promise<HealthReport> {
  const target = productionHealthTargets().find((t) => t.adapter.registry.sourceId === KOMATSU_AIRPORT_SOURCE_ID)!;
  const scoped = extractRightsScope(LISTED, target.pageFact!.scope);
  assert.ok(scoped.ok);
  const reviewed = { ...target, pageFact: { ...target.pageFact!, reviewedFingerprint: await rightsFingerprint(scoped.text) } };
  const result = await checkSourceHealth(reviewed, { fetch: async () => new Response(body, { status, headers: { "content-type": "text/html" } }) });
  if (offline) result.pageFactNotChecked = true;
  return buildReport([result], sourceReviews(), "2026-10-12");
}
const CHANGED = `<html><body><img alt=""> 喫煙場所はどこですか。 国際線２F出発ロビーは閉鎖しました（バス乗り場付近） 関連リンク</body></html>`;
const SCOPE_GONE = "<html><body>ページが見つかりません</body></html>";

test("only a missing fact range or a missing page is a hold signal; a changed page, an ok or an offline report is not", async () => {
  assert.equal(evidenceHoldSignal(await report(SCOPE_GONE), KOMATSU_AIRPORT_SOURCE_ID), "pageFactScopeMissing");
  assert.equal(evidenceHoldSignal(await report("gone", 404), KOMATSU_AIRPORT_SOURCE_ID), "resourceMissing");
  const changed = await report(CHANGED);
  assert.equal(changed.results[0].status, "contentChanged");
  assert.throws(() => evidenceHoldSignal(changed, KOMATSU_AIRPORT_SOURCE_ID), /never held/);
  const listed = await report(LISTED);
  assert.throws(() => evidenceHoldSignal(listed, KOMATSU_AIRPORT_SOURCE_ID), /not blocking/);
  const offline = await report(SCOPE_GONE, 200, true);
  assert.throws(() => evidenceHoldSignal(offline, KOMATSU_AIRPORT_SOURCE_ID), /offline/);
  // A transient 5xx is blocking for health, but it is neither signal: no hold, so no mass unpublication.
  const outage = await report("down", 503);
  assert.equal(outage.results[0].severity, "blocking");
  assert.throws(() => evidenceHoldSignal(outage, KOMATSU_AIRPORT_SOURCE_ID), /neither a missing fact range nor a missing page/);
});

test("source health alone never touches the database; a refused hold writes nothing", async () => {
  const db = await komatsu();
  const before = published(db);
  for (const r of [await report(CHANGED), await report("down", 503), await report(SCOPE_GONE, 200, true)]) {
    await assert.rejects(holdSourceEvidence(db, KOMATSU_AIRPORT_ADAPTER.registry, r, { reportSha256: SHA, heldBy: "maintainer", now: LATER }));
  }
  assert.equal(count(db, "spot_evidence_holds"), 0);
  assert.deepEqual(published(db), before);
  // A dataset source withdraws by release, not by a page-fact hold.
  await importTaito(db, { newSpotId: sequentialSpotIds("T") });
  await assert.rejects(holdSourceEvidence(db, TAITO_ADAPTER.registry, await report(SCOPE_GONE), { reportSha256: SHA, heldBy: "maintainer", now: LATER }),
    /not a factReference source/);
});

test("a hold unpublishes the spot fail closed, keeps it out of every republish, and only an explicit clear restores it", async () => {
  const db = await komatsu();
  const [spotId] = published(db);
  const held = await holdSourceEvidence(db, KOMATSU_AIRPORT_ADAPTER.registry, await report(SCOPE_GONE), { reportSha256: SHA, heldBy: "maintainer", now: LATER });
  assert.deepEqual(held, { sourceId: KOMATSU_AIRPORT_SOURCE_ID, signal: "pageFactScopeMissing", held: [spotId], alreadyHeld: [] });
  assert.equal(count(db, "tile_snapshot_spots"), 0, "unpublished in the same batch as the hold");
  await publishTiles(db, { now: NOW });
  assert.deepEqual(published(db), [], "a republish never brings a held spot back");
  // The spot itself is untouched: the hold is publication state, not a lifecycle change.
  assert.equal((db.raw.prepare("SELECT lifecycle FROM spots WHERE spot_id = ?").get(spotId) as { lifecycle: string }).lifecycle, "active");
  // Idempotent: a second hold of the same source records nothing new.
  const again = await holdSourceEvidence(db, KOMATSU_AIRPORT_ADAPTER.registry, await report("gone", 404), { reportSha256: SHA, heldBy: "maintainer", now: LATER });
  assert.deepEqual([again.held, again.alreadyHeld], [[], [spotId]]);
  assert.equal(count(db, "spot_evidence_holds"), 1);

  // The schema refuses every shortcut: a direct tile membership, a delete, a rewrite, a second active hold.
  const tileId = (db.raw.prepare("SELECT tile_id FROM spots WHERE spot_id = ?").get(spotId) as { tile_id: string }).tile_id;
  assert.throws(() => db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(spotId, tileId), /held because its source evidence is missing/);
  assert.throws(() => db.raw.prepare("DELETE FROM spot_evidence_holds").run(), /never deleted/);
  assert.throws(() => db.raw.prepare("UPDATE spot_evidence_holds SET reason = reason, health_signal = 'resourceMissing'").run(), /one reviewed clear/);
  assert.throws(() => db.raw.prepare(`INSERT INTO spot_evidence_holds (source_id, spot_id, reason, health_signal, health_report_sha256,
    health_evaluated_on, executor_version, held_by, held_at) VALUES (?, ?, 'sourceEvidenceMissing', 'resourceMissing', ?, '2026-10-12',
    'source-evidence-hold.v1', 'maintainer', ?)`).run(KOMATSU_AIRPORT_SOURCE_ID, spotId, SHA, NOW), /append-only/);

  assert.deepEqual(await clearSourceEvidenceHolds(db, KOMATSU_AIRPORT_SOURCE_ID, { clearedBy: "maintainer", basis: "factsReReviewed", now: LATER }), [spotId]);
  await assert.rejects(clearSourceEvidenceHolds(db, KOMATSU_AIRPORT_SOURCE_ID, { clearedBy: "maintainer", basis: "factsReReviewed", now: LATER }), /no active hold/);
  assert.throws(() => db.raw.prepare("UPDATE spot_evidence_holds SET cleared_by = 'someone'").run(), /one reviewed clear/);
  await publishTiles(db, { now: NOW });
  assert.deepEqual(published(db), [spotId]);
  // History is kept: the cleared hold stays, with who cleared it and why, next to the report it cited.
  const [row] = holds(db);
  assert.deepEqual([row.reason, row.health_signal, row.health_report_sha256, row.health_evaluated_on, row.held_by, row.cleared_by, row.clear_basis],
    ["sourceEvidenceMissing", "pageFactScopeMissing", SHA, "2026-10-12", "maintainer", "maintainer", "factsReReviewed"]);
});

test("a spot's hold must cite the source of its own existence evidence, on an unpublished spot", async () => {
  const db = await komatsu();
  const [spotId] = published(db);
  await importTaito(db, { newSpotId: sequentialSpotIds("T") });
  const insert = (sourceId: string) => db.raw.prepare(`INSERT INTO spot_evidence_holds (source_id, spot_id, reason, health_signal,
    health_report_sha256, health_evaluated_on, executor_version, held_by, held_at) VALUES (?, ?, 'sourceEvidenceMissing',
    'pageFactScopeMissing', ?, '2026-10-12', 'source-evidence-hold.v1', 'maintainer', ?)`).run(sourceId, spotId, SHA, NOW);
  assert.throws(() => insert(KOMATSU_AIRPORT_SOURCE_ID), /unpublished spot whose existence evidence comes from this source/, "still published");
  db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(spotId);
  assert.throws(() => insert("taito-public-smoking-areas"), /existence evidence comes from this source/, "another source's report");
});

test("the CLI holds from a saved report file, republishes, and a promotion of the held state carries neither spot nor hold", async () => {
  const db = await komatsu();
  await importTaito(db, { newSpotId: sequentialSpotIds("T") });
  await publishTiles(db, { now: NOW });
  const komatsuSpot = (db.raw.prepare("SELECT spot_id FROM spots WHERE name LIKE '小松空港%'").get() as { spot_id: string }).spot_id;
  assert.ok(published(db).includes(komatsuSpot));
  const dir = mkdtempSync(join(tmpdir(), "source-hold-"));
  const file = join(dir, "report.json");
  writeFileSync(file, JSON.stringify(await report(SCOPE_GONE), null, 2) + "\n");
  await assert.rejects(sourceHoldCli(db, ["hold", `--source=${KOMATSU_AIRPORT_SOURCE_ID}`, `--report=${file}`], LATER), /--by/);
  const out = await sourceHoldCli(db, ["hold", `--source=${KOMATSU_AIRPORT_SOURCE_ID}`, `--report=${file}`, "--by=maintainer"], LATER) as { held: string[] };
  assert.deepEqual(out.held, [komatsuSpot]);
  assert.equal(holds(db)[0].health_report_sha256, (await import("node:crypto")).createHash("sha256").update(readFileSync(file)).digest("hex"));
  assert.ok(!published(db).includes(komatsuSpot), "the CLI republished: no tile body still carries the spot");
  assert.ok(published(db).length > 0, "other sources stay published");

  // Promotion carries the published state only; the hold row stays in the origin, and a fresh target accepts it.
  const bundle = await buildMultiSourcePromotionBundle(db);
  assert.doesNotMatch(bundle.sql, /spot_evidence_holds/);
  const target = migratedSqlite();
  applyPromotionBundle(target, bundle.sql);
  assert.equal((target.prepare("SELECT count(*) n FROM tile_snapshot_spots WHERE spot_id = ?").get(komatsuSpot) as { n: number }).n, 0);
  // Repeat: the same origin exports byte-identical bundles, and a target that already holds one refuses another.
  assert.equal((await buildMultiSourcePromotionBundle(db)).sql, bundle.sql);
  assert.throws(() => applyPromotionBundle(target, bundle.sql), /empty, freshly migrated database/);

  await assert.rejects(sourceHoldCli(db, ["clear", `--source=${KOMATSU_AIRPORT_SOURCE_ID}`, "--by=maintainer", "--basis=because"], LATER), /Usage/);
  const cleared = await sourceHoldCli(db, ["clear", `--source=${KOMATSU_AIRPORT_SOURCE_ID}`, "--by=maintainer", "--basis=healthFalsePositive"], LATER) as { cleared: string[] };
  assert.deepEqual(cleared.cleared, [komatsuSpot]);
  assert.ok(published(db).includes(komatsuSpot));
});

test("a held row in a target database refuses every promotion bootstrap", () => {
  const db = migratedSqlite();
  for (const guard of ["promotion_bootstraps_empty_target", "promotion_multi_bootstraps_empty_target", "promotion_v4_empty_target"]) {
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(guard) as { sql: string }).sql;
    assert.match(sql, /EXISTS \(SELECT 1 FROM spot_evidence_holds\)/, guard);
  }
});

// Append-only is a DB invariant, not a CLI habit: SQLite's REPLACE conflict resolution deletes the conflicting row
// without firing DELETE triggers (recursive_triggers is off), so every REPLACE path must be refused before the insert.
test("spot_evidence_holds is append-only in the database itself, including every INSERT OR REPLACE path", async () => {
  const db = await komatsu();
  const [spotId] = published(db);
  const snapshot = () => JSON.stringify(holds(db));
  const columns = "hold_id, source_id, spot_id, reason, health_signal, health_report_sha256, health_evaluated_on, executor_version, held_by, held_at";
  const values = (holdId: number | null, digest: string) =>
    [holdId, KOMATSU_AIRPORT_SOURCE_ID, spotId, "sourceEvidenceMissing", "resourceMissing", digest, "2026-10-12", "source-evidence-hold.v1", "maintainer", NOW];
  const insert = (verb: string, holdId: number | null, digest: string) =>
    db.raw.prepare(`${verb} INTO spot_evidence_holds (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...values(holdId, digest));

  // A. A normal hold.
  await holdSourceEvidence(db, KOMATSU_AIRPORT_ADAPTER.registry, await report(SCOPE_GONE), { reportSha256: SHA, heldBy: "maintainer", now: LATER });
  const [held] = holds(db);
  const active = snapshot();
  // D. The same hold_id again; E. INSERT OR REPLACE on the same hold_id (would rewrite the digest).
  assert.throws(() => insert("INSERT", Number(held.hold_id), "b".repeat(64)), /append-only/);
  assert.throws(() => insert("INSERT OR REPLACE", Number(held.hold_id), "b".repeat(64)), /append-only/);
  assert.throws(() => insert("REPLACE", Number(held.hold_id), "b".repeat(64)), /append-only/);
  // F. A new id that collides with the active hold of the spot (would delete the active row).
  assert.throws(() => insert("INSERT OR REPLACE", null, "c".repeat(64)), /append-only/);
  assert.throws(() => insert("INSERT OR REPLACE", 999, "c".repeat(64)), /append-only/);
  // G. DELETE; H. rewriting any evidence field, alone or together with a clear.
  assert.throws(() => db.raw.prepare("DELETE FROM spot_evidence_holds").run(), /never deleted/);
  for (const change of ["health_report_sha256 = 'd'", "source_id = 'taito-public-smoking-areas'", "spot_id = 'sp_x'", "health_signal = 'pageFactScopeMissing'",
    "held_by = 'x'", "hold_id = 77", "cleared_at = '2026-10-13T00:00:00Z', cleared_by = 'm', clear_basis = 'factsReReviewed', health_report_sha256 = 'd'"]) {
    assert.throws(() => db.raw.prepare(`UPDATE spot_evidence_holds SET ${change}`).run(), /one reviewed clear|CHECK|FOREIGN/, change);
    assert.throws(() => db.raw.prepare(`UPDATE OR REPLACE spot_evidence_holds SET ${change}`).run(), /one reviewed clear|CHECK|FOREIGN/, change);
  }
  // J. Every failed operation left the row exactly as it was.
  assert.equal(snapshot(), active);

  // B/I. The clear fields, one way, once.
  await clearSourceEvidenceHolds(db, KOMATSU_AIRPORT_SOURCE_ID, { clearedBy: "maintainer", basis: "factsReReviewed", now: LATER });
  const cleared = snapshot();
  // C. A cleared hold is never re-cleared, un-cleared or replaced.
  for (const change of ["cleared_by = 'other'", "clear_basis = 'healthFalsePositive'", "cleared_at = NULL, cleared_by = NULL, clear_basis = NULL", "cleared_at = '2027-01-01T00:00:00Z'"]) {
    assert.throws(() => db.raw.prepare(`UPDATE spot_evidence_holds SET ${change}`).run(), /one reviewed clear|CHECK/, change);
  }
  assert.throws(() => insert("INSERT OR REPLACE", Number(held.hold_id), "b".repeat(64)), /append-only/);
  assert.equal(snapshot(), cleared);
  // A later hold of the same spot is a new row next to the cleared one, never a replacement of it.
  await publishTiles(db, { now: NOW });
  await holdSourceEvidence(db, KOMATSU_AIRPORT_ADAPTER.registry, await report("gone", 404), { reportSha256: "e".repeat(64), heldBy: "maintainer", now: LATER });
  const rows = holds(db);
  assert.equal(rows.length, 2);
  assert.equal(JSON.stringify(rows[0]), JSON.stringify(JSON.parse(cleared)[0]));
  assert.ok(Number(rows[1].hold_id) > Number(rows[0].hold_id));
});
