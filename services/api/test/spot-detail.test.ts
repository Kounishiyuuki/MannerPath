// GET /v1/spots/{id}: the publication gate, the public provenance boundary and merge redirects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { TAITO_ATTRIBUTION_TEXT, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { SpotDetailBodyV1 } from "../src/spots/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TEST_BLOCKED_SOURCE, addBlockedTestSource, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const get = (db: SqliteD1, path: string) => app.request(path, {}, { DB: db });

/** The real (approved) Taito source plus the same file under an isolated unapproved test source. */
async function publishedDb(): Promise<SqliteD1> {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  await importTaito(db, { sourceId: TEST_BLOCKED_SOURCE, newSpotId: sequentialSpotIds("9") });
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  await publishTiles(db, { now: NOW });
  return db;
}

const publishedSpotId = (db: SqliteD1, name: string) =>
  one(db, `SELECT ts.spot_id FROM tile_snapshot_spots ts JOIN spots s ON s.spot_id = ts.spot_id WHERE s.name = ?`, name).spot_id;

test("a published spot returns 200 with the v1 detail body, tile-consistent spot fields and attribution", async () => {
  const db = await publishedDb();
  const id = publishedSpotId(db, "上野公園前交番裏");
  const res = await get(db, `/v1/spots/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "public, no-cache");
  // No detail ETag in v1: no stored hash describes this body (docs/API.md).
  assert.equal(res.headers.get("ETag"), null);

  const body = SpotDetailBodyV1.parse(await res.json());
  assert.deepEqual(Object.keys(body), ["schemaVersion", "requestedId", "mergedInto", "spot", "sources", "provenance"]);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.requestedId, id);
  assert.equal(body.mergedInto, null);

  const tileBody = JSON.parse(one(db, "SELECT body_json FROM tile_snapshots WHERE tile_id = ?", body.spot.tile).body_json);
  const { tile, ...spotWithoutTile } = body.spot;
  assert.deepEqual(spotWithoutTile, tileBody.spots.find((s: Row) => s.id === id), "detail and tile describe the spot identically");
  // spotType "unknown" is a supported canonical value and is returned normally (ADR-0006).
  assert.equal(body.spot.spotType, "unknown");
  assert.equal(body.spot.lastVerifiedAt, "2026-08-18");
  assert.deepEqual(body.spot.sourceIds, [TAITO_SOURCE_ID]);
  assert.deepEqual(body.sources, [{
    id: TAITO_SOURCE_ID, displayName: "台東区 公衆喫煙所", licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode.ja", attributionText: TAITO_ATTRIBUTION_TEXT,
  }], "the approved Taito attribution matches the tile API's source DTO exactly");
  assert.deepEqual(body.sources, tileBody.sources);
});

test("public provenance names field, source, rule and observation date only", async () => {
  const db = await publishedDb();
  const id = publishedSpotId(db, "上野公園前交番裏");
  const body = SpotDetailBodyV1.parse(await (await get(db, `/v1/spots/${id}`)).json());
  assert.deepEqual(body.provenance, [
    { field: "existence", sourceId: TAITO_SOURCE_ID, rule: "taito.listed.v1", observedOn: "2026-08-18" },
    { field: "lifecycle", sourceId: TAITO_SOURCE_ID, rule: "taito.listed.v1", observedOn: "2026-08-18" },
    { field: "location", sourceId: TAITO_SOURCE_ID, rule: "taito.coordinates.v1", observedOn: "2026-08-18" },
    { field: "name", sourceId: TAITO_SOURCE_ID, rule: "taito.name.v1", observedOn: "2026-08-18" },
    { field: "openingHours", sourceId: TAITO_SOURCE_ID, rule: "taito.hours.v1", observedOn: "2026-08-18" },
  ]);
  // Every resolved field in the response has a provenance row and vice versa (no invented fields).
  const stored = all(db, "SELECT field FROM spot_field_provenance WHERE spot_id = ? ORDER BY field", id).map((r) => r.field);
  assert.deepEqual(body.provenance.map((p) => p.field), stored);
});

test("no raw source record, internal identifier or unresolved raw column leaks into the body", async () => {
  const db = await publishedDb();
  const heatedId = publishedSpotId(db, "e-booth御徒町　※加熱式たばこ専用");
  const text = await (await get(db, `/v1/spots/${heatedId}`)).text();
  // 名称カナ / 設置位置 / 方書 stay raw evidence only (ADR-0006 Issue #12 amendment, rule table).
  for (const leak of ["名称カナ", "設置位置", "方書", "台東区上野", "recordId", "record_id", "releaseId",
    "rawValues", "sourceColumns", "sourceEntityId", "matcherVersion", "contentSha256"]) {
    assert.ok(!text.includes(leak), `body must not contain ${leak}`);
  }
  const body = SpotDetailBodyV1.parse(JSON.parse(text));
  assert.deepEqual([body.spot.supportsPaper, body.spot.supportsHeated], ["no", "yes"]);
  assert.equal(body.spot.openingHours.status, "unparsed");
});

test("canonical but unpublished spots are not discoverable: unapproved source, unpublished row, unknown and malformed IDs", async () => {
  const db = await publishedDb();
  // The unapproved source's canonical spots exist but are in no snapshot.
  const blockedId = one(db,
    `SELECT s.spot_id FROM spots s JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ? LIMIT 1`, TEST_BLOCKED_SOURCE).spot_id;
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots WHERE spot_id = ?", blockedId).n, 0);

  const unknownId = `sp_${"0".repeat(26)}`;
  for (const path of [`/v1/spots/${blockedId}`, `/v1/spots/${unknownId}`, "/v1/spots/x", "/v1/spots/sp_lowercase"]) {
    const res = await get(db, path);
    assert.equal(res.status, 404, path);
    assert.equal((await res.json() as { error: string }).error, "spotNotFound", path);
  }

  // Blocking the approved Taito source and republishing empties the snapshots, hiding its spots too.
  const publishedId = publishedSpotId(db, "上野公園前交番裏");
  assert.equal((await get(db, `/v1/spots/${publishedId}`)).status, 200);
  db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(TAITO_SOURCE_ID);
  await publishTiles(db, { now: "2026-12-31T00:00:00Z" });
  assert.equal((await get(db, `/v1/spots/${publishedId}`)).status, 404);
  assert.equal(one(db, "SELECT count(*) AS n FROM spots WHERE spot_id = ?", publishedId).n, 1, "the canonical row still exists");
});

test("an unapproved source's spots have no public detail at all", async () => {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  await importTaito(db, { sourceId: TEST_BLOCKED_SOURCE });
  await publishTiles(db, { now: NOW });
  for (const s of all(db, "SELECT spot_id FROM spots")) {
    assert.equal((await get(db, `/v1/spots/${s.spot_id}`)).status, 404);
  }
});

test("a merged ID resolves one hop to its published target and reports the redirect", async () => {
  const db = await publishedDb();
  const target = publishedSpotId(db, "上野公園前交番裏");
  const merged = publishedSpotId(db, "JR上野駅（広小路口）ぺデストリアンデッキ上");
  // A published spot cannot be merged in place (trigger); unpublish it first, as the publish step does.
  db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(merged);
  db.raw.prepare("UPDATE spots SET merged_into = ? WHERE spot_id = ?").run(target, merged);

  const res = await get(db, `/v1/spots/${merged}`);
  assert.equal(res.status, 200);
  const body = SpotDetailBodyV1.parse(await res.json());
  assert.equal(body.requestedId, merged);
  assert.equal(body.mergedInto, target);
  assert.equal(body.spot.id, target);
  assert.equal(body.spot.name, "上野公園前交番裏");

  // The merge target itself still answers under its own ID with no redirect.
  const direct = SpotDetailBodyV1.parse(await (await get(db, `/v1/spots/${target}`)).json());
  assert.equal(direct.mergedInto, null);
  assert.deepEqual(direct.spot, body.spot);

  // A merge whose target is not published stays hidden, like any other unpublished spot.
  db.raw.prepare("DELETE FROM tile_snapshot_spots WHERE spot_id = ?").run(target);
  assert.equal((await get(db, `/v1/spots/${merged}`)).status, 404);
  assert.equal((await get(db, `/v1/spots/${target}`)).status, 404);
});

test("a provenance field outside the public allowlist is withheld, and the spot still reads normally", async () => {
  const db = await publishedDb();
  const id = publishedSpotId(db, "上野公園前交番裏");
  const before = SpotDetailBodyV1.parse(await (await get(db, `/v1/spots/${id}`)).json());
  const recordId = one(db, "SELECT record_id FROM spot_field_provenance WHERE spot_id = ? AND field = 'existence'", id).record_id;

  // Simulate a later migration widening spot_field_provenance.field: the column's CHECK constraint
  // is not the public vocabulary, so the row must be inserted past it to test the API's allowlist.
  db.raw.exec("PRAGMA ignore_check_constraints = ON");
  db.raw.prepare(
    `INSERT INTO spot_field_provenance (spot_id, field, record_id, source_columns_json, rule, resolver_version, resolved_at)
     VALUES (?, 'internalReviewNote', ?, '["名称カナ"]', 'internal.review.v1', 'internal.v1', ?)`,
  ).run(id, recordId, NOW);
  db.raw.exec("PRAGMA ignore_check_constraints = OFF");
  assert.equal(one(db, "SELECT count(*) AS n FROM spot_field_provenance WHERE spot_id = ? AND field = 'internalReviewNote'", id).n, 1);

  const res = await get(db, `/v1/spots/${id}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("internalReviewNote"), "a non-public provenance field must not be emitted");
  assert.ok(!text.includes("internal.review.v1"));
  assert.deepEqual(SpotDetailBodyV1.parse(JSON.parse(text)), before, "the published response is otherwise unchanged");
});
