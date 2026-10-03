// ADR-0017 location authority (0030 spot_location_authorities). A spot that was ever area-anchored carries an
// append-only authority chain: the anchor (seq 1), the reviewed exact upgrade (first exact authority, also kept as
// immutable history in area_precision_upgrades), later reviewed ADR-0009 relocations and unchanged continuations. The
// published location evidence and coordinate must be exactly the latest row — enforced by the DB on every write path and
// re-checked by the shared public invariant. The upgrade's comparison must be current (B3) and an anchor's point must be
// read from its publication's raw record (B4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { app } from "../src/app.ts";
import { applyAreaPrecisionUpgrade } from "../src/pipeline/area-anchor.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import type { TileSpotV1 } from "../src/tiles/dto.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW } from "./support/fixture.ts";
import { type SqliteD1, withoutTrigger } from "./support/sqlite-d1.ts";
import { MOVED_C, MOVED_D, PARK, areaPipeline, csv, decideIdentity, exactChain, meta, nextRelease, spotByName } from "./support/area.ts";
import { registerAreaPointMapping } from "../src/pipeline/area-point-mapping.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { observeRelease } from "../src/pipeline/observe.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { sequentialSpotIds } from "./support/fixture.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row | undefined;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const count = (db: SqliteD1, table: string) => (one(db, `SELECT count(*) n FROM ${table}`)!.n as number);

async function published(db: SqliteD1): Promise<TileSpotV1[]> {
  await publishTiles(db, { now: "2026-10-20T00:00:00Z" });
  return (await readPublishedTiles(db)).flatMap((t) => t.spots).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
const detail = async (db: SqliteD1, id: string) => app.request(`/v1/spots/${id}`, {}, { DB: db });
const quality = async (db: SqliteD1) =>
  (await analyzeCorpus(db, { now: NOW, gzip: (b) => gzipSync(b).length, adapters: [] })).checks.find((c) => c.id === "area-anchor-never-exact")?.status;
const insertRow = (db: SqliteD1, table: string, o: Row, verb = "INSERT") =>
  db.raw.prepare(`${verb} INTO ${table} (${Object.keys(o).join(", ")}) VALUES (${Object.keys(o).map(() => "?").join(", ")})`).run(...Object.values(o));

// ---------------------------------------------------------------------------------------------------------------
// B2: first upgrade is history; the current authority advances through later ADR-0009 relocations

test("A approximate -> B same-coordinate exact -> C relocation -> D relocation -> continuation: one consistent authority", async () => {
  const { db, adapter } = await areaPipeline();
  const id = await exactChain(db, adapter);
  const chain = all(db, "SELECT seq, kind, precision, latitude, longitude FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq", id);
  assert.deepEqual(chain.map((r) => [r.seq, r.kind, r.precision, r.latitude, r.longitude]), [
    [1, "areaAnchor", "areaApproximate", PARK.latitude, PARK.longitude],
    [2, "exactUpgrade", "publisherPoint", PARK.latitude, PARK.longitude],
    [3, "relocation", "publisherPoint", MOVED_C.latitude, MOVED_C.longitude],
    [4, "relocation", "publisherPoint", MOVED_D.latitude, MOVED_D.longitude],
    [5, "continuation", "publisherPoint", MOVED_D.latitude, MOVED_D.longitude],
  ]);
  // The first upgrade stays immutable history: it still describes A -> B, not the current point.
  const upgrade = one(db, "SELECT * FROM area_precision_upgrades WHERE spot_id = ?", id)!;
  assert.deepEqual([upgrade.old_latitude, upgrade.new_latitude, upgrade.upgrade_kind], [PARK.latitude, PARK.latitude, "sameCoordinate"]);
  // Spot id, coordinate, provenance and precision all follow the latest authority.
  const latest = one(db, "SELECT * FROM spot_location_authorities WHERE spot_id = ? AND seq = 5", id)!;
  const loc = one(db, "SELECT * FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'", id)!;
  assert.deepEqual([loc.record_id, loc.rule, loc.source_columns_json], [latest.evidence_record_id, latest.location_rule, latest.location_columns_json]);
  const spot = (await published(db)).find((s) => s.id === id)!;
  assert.deepEqual([spot.latitude, spot.longitude, spot.verification.locationPrecision], [MOVED_D.latitude, MOVED_D.longitude, "publisherPoint"]);
  assert.equal((await detail(db, id)).status, 200);
  assert.equal(await quality(db), "pass");
  // ADR-0009 is not weakened: each move is a reviewed relocation application.
  assert.equal(count(db, "review_relocation_applications"), 2);
  assert.equal(all(db, "SELECT 1 FROM spot_location_authorities WHERE kind = 'relocation' AND relocation_review_item_id IS NULL").length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// B1: location provenance is exactly the current authority — DB on INSERT/UPDATE/REPLACE/DELETE, public fail-closed

test("after an upgrade and relocations, location provenance cannot name anything but the current authority", async () => {
  const { db, adapter } = await areaPipeline();
  const id = await exactChain(db, adapter, "D");
  const latest = one(db, "SELECT * FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq DESC LIMIT 1", id)!;
  const loc = one(db, "SELECT * FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'", id)!;
  // Same source, other records: the B-release record (an older authority), and a host-only record of the same source.
  const older = one(db, "SELECT evidence_record_id r FROM spot_location_authorities WHERE spot_id = ? AND seq = 2", id)!.r as number;
  const host = one(db, "SELECT record_id r FROM source_records WHERE release_id = 1 AND upstream_row_ref = '3'")!.r as number;
  const swaps: [string, Row][] = [
    ["older authority's record", { record_id: older }],
    ["same-source host-only record", { record_id: host }],
    ["other columns", { source_columns_json: '["lon","lat"]' }],
    ["other rule", { rule: "test.other.v1" }],
    ["anchor rule after the upgrade", { rule: `area-anchor.v1:${PARK.anchorId}` }],
  ];
  for (const [name, change] of swaps) {
    const set = Object.keys(change).map((k) => `${k} = ?`).join(", ");
    assert.throws(() => db.raw.prepare(`UPDATE spot_field_provenance SET ${set} WHERE spot_id = ? AND field = 'location'`).run(...Object.values(change), id),
      /location authority|location evidence/, `${name}: UPDATE refused`);
    assert.throws(() => insertRow(db, "spot_field_provenance", { ...loc, ...change }, "INSERT OR REPLACE"),
      /location authority|location evidence/, `${name}: REPLACE refused`);
  }
  assert.throws(() => db.raw.prepare("DELETE FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'").run(id), /never deleted/);
  assert.deepEqual(one(db, "SELECT * FROM spot_field_provenance WHERE spot_id = ? AND field = 'location'", id), loc, "nothing changed");
  assert.equal(loc.record_id, latest.evidence_record_id);

  // With the DB guard removed, the shared public invariant still fails closed for every swap.
  for (const [name, change] of swaps) {
    const { db: t, adapter: ta } = await areaPipeline();
    const tid = await exactChain(t, ta, "D");
    const set = Object.keys(change).map((k) => `${k} = ?`).join(", ");
    const resolved = { ...change, record_id: change.record_id === older ? one(t, "SELECT evidence_record_id r FROM spot_location_authorities WHERE spot_id = ? AND seq = 2", tid)!.r : change.record_id };
    if (resolved.record_id === undefined) delete resolved.record_id;
    await published(t);
    withoutTrigger(t.raw, "spot_field_provenance_location_authority_update",
      () => t.raw.prepare(`UPDATE spot_field_provenance SET ${set} WHERE spot_id = ? AND field = 'location'`).run(...Object.values(resolved), tid));
    assert.equal(await quality(t), "fail", `${name}: quality fails on the published snapshot`);
    assert.equal((await detail(t, tid)).status, 404, `${name}: not served`);
    assert.equal((await published(t)).some((s) => s.id === tid), false, `${name}: not republished`);
  }
});

test("an authority row must be exactly its evidence: observation, release, rule, columns, coordinate, continuity", async () => {
  const { db, adapter } = await areaPipeline();
  const id = await exactChain(db, adapter, "D");
  const latest = one(db, "SELECT * FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq DESC LIMIT 1", id)!;
  const host = one(db, "SELECT o.observation_id, r.record_id FROM source_records r JOIN source_observations o USING (record_id) WHERE r.release_id = 1 AND r.upstream_row_ref = '2'")!;
  const next = { ...latest, seq: latest.seq + 1, kind: "continuation", relocation_review_item_id: null, recorded_at: "2026-10-30T00:00:00Z" };
  const bad: [string, Row][] = [
    ["unrelated record of the same source (another entity)", { evidence_record_id: host.record_id, evidence_observation_id: host.observation_id }],
    ["observation of another record", { evidence_observation_id: host.observation_id }],
    ["other release", { evidence_release_id: 1 }],
    ["other release digest", { evidence_release_content_sha256: "f".repeat(64) }],
    ["other rule", { location_rule: "test.other.v1" }],
    ["other columns", { location_columns_json: '["lon","lat"]' }],
    ["other mapping", { mapping_version: "test-area.map.v0" }],
    ["typed coordinate", { latitude: 36, longitude: 140 }],
    ["seq gap", { seq: latest.seq + 2 }],
    ["approximate after exact", { precision: "areaApproximate", location_rule: `area-anchor.v1:${PARK.anchorId}` }],
    ["a second upgrade", { kind: "exactUpgrade" }],
    ["relocation without its reviewed item", { kind: "relocation" }],
  ];
  for (const [name, change] of bad) {
    assert.throws(() => insertRow(db, "spot_location_authorities", { ...next, ...change }), /spot_location_authorities|CHECK constraint/, name);
  }
  // Same evidence re-appended as a "continuation" of itself is not a continuation (different record required).
  assert.throws(() => insertRow(db, "spot_location_authorities", next), /spot_location_authorities/);
  assert.throws(() => insertRow(db, "spot_location_authorities", latest, "INSERT OR REPLACE"), /spot_location_authorities/);
  assert.throws(() => db.raw.prepare("UPDATE spot_location_authorities SET latitude = 36 WHERE spot_id = ?").run(id), /immutable|append-only/);
  assert.throws(() => db.raw.prepare("DELETE FROM spot_location_authorities WHERE spot_id = ?").run(id), /immutable|never deleted|append-only/);
  // The pin moves only to a newly appended reviewed authority's point.
  assert.throws(() => db.raw.prepare("UPDATE spots SET latitude = 36, longitude = 140 WHERE spot_id = ?").run(id), /location authority|relocation/);
  assert.equal(count(db, "spot_location_authorities"), latest.seq);
});

// ---------------------------------------------------------------------------------------------------------------
// B3: the upgrade's comparison must be current when it is written

test("stale same-coordinate review: a newer release after the review rejects the upgrade; the later correct flow works", async () => {
  const { db, adapter } = await areaPipeline();
  const spotId = spotByName(db, "公園内喫煙所").spot_id as string;
  const before = (await published(db)).find((s) => s.id === spotId)!;
  const spotRow = one(db, "SELECT * FROM spots WHERE spot_id = ?", spotId);
  const b = await nextRelease(db, adapter, ["exactAtAnchor", "exact"], "2026-10-10");
  const bItem = (b.first as { reviewItemIds: number[] }).reviewItemIds[0];
  await decideIdentity(db, bItem, spotId);
  // A newer release C arrives after the B review.
  const c = await nextRelease(db, adapter, ["exactAtAnchor", "exact"], "2026-10-14", "2026-10-15T00:00:00Z");
  const evidenceB = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '1'", b.releaseId)!.record_id as number;
  const input = { spotId, evidenceRecordId: evidenceB, identityReviewItemId: bItem, targetPrecision: "publisherPoint" as const,
    areaPremise: "insideArea" as const, reviewedBy: "reviewer", now: "2026-10-16T00:00:00Z" };
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, input), /stale or competing|competes/);
  assert.equal(count(db, "area_precision_upgrades"), 0, "zero upgrade rows");
  assert.equal(count(db, "spot_location_authorities"), 1, "authority untouched");
  assert.deepEqual(one(db, "SELECT * FROM spots WHERE spot_id = ?", spotId), spotRow, "spot untouched");
  assert.deepEqual((await published(db)).find((s) => s.id === spotId), before, "publish unchanged");
  // The later, correct flow: B is rejected as superseded, C is reviewed and upgrades.
  db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(b.releaseId);
  const cFirst = await c.resolve("2026-10-16T01:00:00Z");
  const cItem = (cFirst as { reviewItemIds: number[] }).reviewItemIds[0];
  await decideIdentity(db, cItem, spotId, "2026-10-16T02:00:00Z");
  const evidenceC = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '1'", c.releaseId)!.record_id as number;
  // The B premise stays refused even now: its comparison is not the one being applied.
  await assert.rejects(() => applyAreaPrecisionUpgrade(db, adapter, input));
  assert.deepEqual(await applyAreaPrecisionUpgrade(db, adapter, { ...input, evidenceRecordId: evidenceC, identityReviewItemId: cItem }),
    { status: "applied", spotId, kind: "sameCoordinate" });
  assert.equal((await c.resolve("2026-10-17T00:00:00Z")).status, "resolved");
  const after = (await published(db)).find((s) => s.id === spotId)!;
  assert.deepEqual([after.latitude, after.longitude, after.verification.locationPrecision], [PARK.latitude, PARK.longitude, "publisherPoint"]);
  assert.equal(one(db, "SELECT evidence_release_id r FROM area_precision_upgrades")!.r, c.releaseId);
});

// ---------------------------------------------------------------------------------------------------------------
// F4 (B4): an anchor's point is read through the source's REVIEWED area-point mapping, never through columns a caller names

test("reviewed mapping-column authority: only the reviewed lat/lon columns of the genuine record can be an anchor point", async () => {
  const { db, adapter, sourceId } = await areaPipeline();
  const row = one(db, "SELECT * FROM area_location_anchors")!;
  const record = one(db, "SELECT raw_values_json v FROM source_records WHERE record_id = ?", row.origin_record_id)!.v as string;
  // The genuine park record states lat/lon 35.7155,139.7733 AND other numeric cells seats/capacity 36,140.
  assert.deepEqual(JSON.parse(record).slice(3, 8), [String(PARK.latitude), String(PARK.longitude), "area", "36", "140"]);
  assert.deepEqual({ ...one(db, "SELECT name_column, latitude_column, longitude_column FROM area_point_mappings WHERE source_id = ?", sourceId) },
    { name_column: "name", latitude_column: "lat", longitude_column: "lon" });
  let n = 0;
  const fresh = (o: Row) => ({ ...row, anchor_id: `aa_direct_${++n}`, evidence_sha256: String(n).padStart(64, "0"), ...o });
  // Correct reviewed columns + the correct coordinate: accepted (direct SQL, too).
  insertRow(db, "area_location_anchors", fresh({}));
  const otherRecord = one(db, "SELECT record_id, raw_values_json FROM source_records WHERE release_id = 1 AND upstream_row_ref = '2'")!;
  const cases: [string, Row][] = [
    ["seats/capacity as the point (36,140)", { latitude: 36, longitude: 140 }],
    ["correct columns, typed 36,140", { latitude: 36, longitude: 140, area_name: row.area_name }],
    ["correct record, altered coordinate", { latitude: PARK.latitude + 0.0001 }],
    ["same release, a different record", { origin_record_id: otherRecord.record_id, origin_record_values_json: otherRecord.raw_values_json }],
    ["same release, a different record's point", { latitude: 35.71, longitude: 139.77 }],
    ["mapping version not reviewed", { origin_mapping_version: "test-area.map.v0" }],
    ["header altered (columns renamed)", { origin_header_json: '["id","name","area","seats","capacity","statement","lat","lon"]' }],
  ];
  for (const [name, change] of cases) {
    assert.throws(() => insertRow(db, "area_location_anchors", fresh(change)), /area_location_anchors|FOREIGN KEY/, name);
  }
  // The reviewed mapping itself cannot be re-pointed: not by REPLACE/UPDATE, and not under the same version.
  const mapping = one(db, "SELECT * FROM area_point_mappings WHERE source_id = ?", sourceId)!;
  assert.throws(() => insertRow(db, "area_point_mappings", { ...mapping, latitude_column: "seats", longitude_column: "capacity" }, "INSERT OR REPLACE"), /immutable/);
  assert.throws(() => db.raw.prepare("UPDATE area_point_mappings SET latitude_column = 'seats'").run(), /immutable/);
  assert.throws(() => insertRow(db, "area_point_mappings", { ...mapping, latitude_column: "lat", longitude_column: "lat" }, "INSERT OR REPLACE"), /immutable|CHECK/);
  // A mapping registered under another version with seats/capacity (or swapped lat/lon) cannot carry an anchor either:
  // the release is observed under the reviewed version only.
  for (const [version, lat, lon, point] of [["test-area.map.seats", "seats", "capacity", [36, 140]], ["test-area.map.swapped", "lon", "lat", [PARK.longitude, PARK.latitude]]] as const) {
    insertRow(db, "area_point_mappings", { ...mapping, mapping_version: version, latitude_column: lat, longitude_column: lon });
    assert.throws(() => insertRow(db, "area_location_anchors", fresh({ origin_mapping_version: version, latitude: point[0], longitude: point[1] })),
      /mapping version is not the one this publication is observed under/, version);
  }
  // Code path: an adapter claiming other columns under the reviewed version is refused.
  const seatsAdapter = { ...adapter, areaPointColumns: { ...adapter.areaPointColumns!, latitude: "seats", longitude: "capacity" } };
  await assert.rejects(() => registerAreaPointMapping(db, seatsAdapter, NOW), /registered with other columns/);
  assert.equal(count(db, "area_location_anchors"), 2);
});

// ---------------------------------------------------------------------------------------------------------------
// F1: the evidence an authority cites cannot be rewritten underneath it, and the public read re-checks it

test("an authority's observation, record, release and entity link cannot be rewritten (REPLACE included)", async () => {
  const { db, adapter } = await areaPipeline();
  const id = await exactChain(db, adapter, "D");
  db.raw.exec("PRAGMA recursive_triggers = OFF");
  const latest = one(db, "SELECT * FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq DESC LIMIT 1", id)!;
  const obs = one(db, "SELECT * FROM source_observations WHERE observation_id = ?", latest.evidence_observation_id)!;
  const rec = one(db, "SELECT * FROM source_records WHERE record_id = ?", latest.evidence_record_id)!;
  const rel = one(db, "SELECT * FROM source_releases WHERE release_id = ?", latest.evidence_release_id)!;
  const link = one(db, "SELECT * FROM source_record_entities WHERE record_id = ?", latest.evidence_record_id)!;
  const otherRecord = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND record_id <> ?", rel.release_id, rec.record_id)!.record_id;
  const probes: [string, string, Row][] = [
    ["observation coordinate", "source_observations", { ...obs, latitude: 36, longitude: 140 }],
    ["observation mapping", "source_observations", { ...obs, mapping_version: "test-area.map.v9" }],
    ["observation location claim", "source_observations", { ...obs, field_provenance_json: obs.field_provenance_json.replace('"lat","lon"', '"lon","lat"') }],
    ["observation record linkage", "source_observations", { ...obs, record_id: otherRecord }],
    ["observation release linkage", "source_observations", { ...obs, release_id: 1 }],
    ["record raw values", "source_records", { ...rec, raw_values_json: rec.raw_values_json.replace("35.7146", "36") }],
    ["release digest", "source_releases", { ...rel, content_sha256: "e".repeat(64) }],
    ["record entity link", "source_record_entities", { ...link, note: "rewritten" }],
  ];
  for (const [name, table, values] of probes) {
    assert.throws(() => insertRow(db, table, values, "INSERT OR REPLACE"), /immutable|append-only|fixed|UNIQUE|FOREIGN KEY/, name);
  }
  assert.throws(() => db.raw.prepare("UPDATE source_record_entities SET note = 'x' WHERE record_id = ?").run(latest.evidence_record_id), /fixed/);
  assert.deepEqual(one(db, "SELECT * FROM source_observations WHERE observation_id = ?", obs.observation_id), obs, "observation unchanged");
  assert.equal((await published(db)).find((s) => s.id === id)?.latitude, MOVED_D.latitude);

  // With the storage guards removed, the shared public decision still notices evidence rewritten under the authority.
  const rewrites: [string, (t: SqliteD1, o: Row) => void][] = [
    ["observation coordinate", (t, o) => withoutTrigger(t.raw, "source_observations_no_replace", () =>
      insertRow(t, "source_observations", { ...o, latitude: 36, longitude: 140 }, "INSERT OR REPLACE"))],
    ["observation mapping", (t, o) => withoutTrigger(t.raw, "source_observations_no_replace", () =>
      insertRow(t, "source_observations", { ...o, mapping_version: "test-area.map.v9" }, "INSERT OR REPLACE"))],
    ["observation location columns", (t, o) => withoutTrigger(t.raw, "source_observations_no_replace", () =>
      insertRow(t, "source_observations", { ...o, field_provenance_json: String(o.field_provenance_json).replace('"lat","lon"', '"lon","lat"') }, "INSERT OR REPLACE"))],
    ["release digest", (t, o) => withoutTrigger(t.raw, "source_releases_evidence_immutable", () =>
      t.raw.prepare("UPDATE source_releases SET content_sha256 = ? WHERE release_id = ?").run("e".repeat(64), o.release_id))],
  ];
  for (const [name, rewrite] of rewrites) {
    const { db: t, adapter: ta } = await areaPipeline();
    const tid = await exactChain(t, ta, "D");
    t.raw.exec("PRAGMA recursive_triggers = OFF");
    await published(t);
    const l = one(t, "SELECT evidence_observation_id o FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq DESC LIMIT 1", tid)!.o;
    rewrite(t, one(t, "SELECT * FROM source_observations WHERE observation_id = ?", l)!);
    assert.equal(await quality(t), "fail", `${name}: quality fails`);
    assert.equal((await detail(t, tid)).status, 404, `${name}: not served`);
    assert.equal((await published(t)).some((s) => s.id === tid), false, `${name}: not republished`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// F3: a continuation only moves forward, within the comparison being applied

test("continuation monotonicity: no rollback to an older record, no duplicate-current, stale-identity or competing release", async () => {
  const { db, adapter } = await areaPipeline();
  const id = await exactChain(db, adapter, "E");
  const chain = all(db, "SELECT * FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq", id);
  const latest = chain.at(-1)!;
  const d = chain.find((r) => r.seq === 4)!; // relocation D: release 4, the same point as the current authority
  const append = (o: Row) => insertRow(db, "spot_location_authorities", { ...latest, seq: latest.seq + 1, kind: "continuation",
    relocation_review_item_id: null, recorded_at: "2026-10-30T00:00:00Z", ...o });
  const evidenceOf = (recordId: number) => {
    const o = one(db, "SELECT o.observation_id, o.release_id, r.content_sha256 FROM source_observations o JOIN source_releases r USING (release_id) WHERE o.record_id = ?", recordId)!;
    return { evidence_record_id: recordId, evidence_observation_id: o.observation_id, evidence_release_id: o.release_id, evidence_release_content_sha256: o.content_sha256 };
  };
  // A -> ... -> E current: a continuation back to D's record (release 4) is a rollback.
  assert.throws(() => append(evidenceOf(d.evidence_record_id)), /moves only forward|continues the previous|another release/, "rollback to D");
  // Another record of the current release (duplicate current).
  const exactE = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '2'", latest.evidence_release_id)!.record_id;
  assert.throws(() => append(evidenceOf(exactE)), /spot_location_authorities/, "duplicate current release");
  // A newer release F is pending, but its park record is not linked to the spot's entity yet (stale identity), and a
  // competing newer release G exists.
  const fRelease = await ingestRelease(db, adapter, csv(["exactMovedD", "exact"]), meta("2026-10-22"));
  await observeRelease(db, adapter, fRelease.releaseId);
  const fPark = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '1'", fRelease.releaseId)!.record_id;
  const fExact = one(db, "SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '2'", fRelease.releaseId)!.record_id;
  assert.throws(() => append(evidenceOf(fPark)), /continues the previous/, "F's park record is not linked to the spot's entity");
  assert.throws(() => append(evidenceOf(fExact)), /spot_location_authorities/, "another entity's record");
  const g = await ingestRelease(db, adapter, csv(["exactMovedD", "exact", "newInPark"]), meta("2026-10-24"));
  await assert.rejects(() => resolveFirstRelease(db, adapter, fRelease.releaseId, { now: "2026-10-25T00:00:00Z", newSpotId: sequentialSpotIds("F") }), /competes|moves only forward/,
    "a competing newer release refuses the continuation (the schema refuses it even where the resolver does not check)");
  assert.equal(all(db, "SELECT 1 FROM spot_location_authorities WHERE spot_id = ?", id).length, chain.length, "the chain did not move");
  // The correct flow: the competing G is rejected, and F resolves forward with one continuation.
  db.raw.prepare("UPDATE source_releases SET status = 'rejected' WHERE release_id = ?").run(g.releaseId);
  assert.equal((await resolveFirstRelease(db, adapter, fRelease.releaseId, { now: "2026-10-25T00:00:00Z", newSpotId: sequentialSpotIds("F") })).status, "resolved");
  const after = all(db, "SELECT * FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq", id);
  assert.deepEqual([after.length, after.at(-1)!.kind, after.at(-1)!.evidence_record_id], [chain.length + 1, "continuation", fPark]);
  const spot = (await published(db)).find((s) => s.id === id)!;
  assert.deepEqual([spot.latitude, spot.longitude, spot.verification.locationPrecision], [MOVED_D.latitude, MOVED_D.longitude, "publisherPoint"]);
  // And the rollback is still refused afterwards.
  const now = all(db, "SELECT * FROM spot_location_authorities WHERE spot_id = ? ORDER BY seq", id).at(-1)!;
  assert.throws(() => insertRow(db, "spot_location_authorities", { ...now, seq: now.seq + 1, ...evidenceOf(d.evidence_record_id),
    recorded_at: "2026-10-31T00:00:00Z" }), /spot_location_authorities/);
});
