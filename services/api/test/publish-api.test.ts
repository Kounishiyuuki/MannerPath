// Publication gate, z14 snapshots and the /v1 tile endpoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { app, ifNoneMatchMatches } from "../src/app.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../src/geo/tile.ts";
import { TAITO_ATTRIBUTION_TEXT, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { TileBodyV1, tileEtag } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TEST_BLOCKED_SOURCE, addBlockedTestSource, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The real (approved) Taito source plus the same file under an isolated unapproved test source. */
async function publishedDb(prefix = "0"): Promise<SqliteD1> {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  await importTaito(db, { sourceId: TEST_BLOCKED_SOURCE, newSpotId: sequentialSpotIds("9") });
  await importTaito(db, { newSpotId: sequentialSpotIds(prefix) });
  await publishTiles(db, { now: NOW });
  return db;
}

const get = (db: SqliteD1, path: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers }, { DB: db });

test("an unapproved source publishes nothing, and bypassing the publisher is rejected by the trigger", async () => {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  await importTaito(db, { sourceId: TEST_BLOCKED_SOURCE });
  const report = await publishTiles(db, { now: NOW });
  assert.deepEqual(report.published, []);
  assert.deepEqual(report.excluded, [{ sourceId: TEST_BLOCKED_SOURCE, publicationStatus: "blocked", spotCount: 32 }]);
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshots").n, 0);

  // Bypassing the publisher does not help: the database trigger rejects the unpublishable spot.
  const s = one(db, "SELECT spot_id, tile_id, tile_x, tile_y FROM spots LIMIT 1");
  db.raw.prepare(
    `INSERT INTO tile_snapshots (tile_id, z, x, y, revision, schema_version, content_sha256, spot_count, body_json, published_at)
     VALUES (?, 14, ?, ?, 1, 1, ?, 0, '{}', ?)`,
  ).run(s.tile_id, s.tile_x, s.tile_y, "0".repeat(64), NOW);
  assert.throws(
    () => db.raw.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").run(s.spot_id, s.tile_id),
    /not publishable/,
  );
});

test("the approved Taito source publishes complete z14 snapshots; the unapproved source's spots stay out", async () => {
  const db = await publishedDb();
  assert.equal(one(db, "SELECT publication_status FROM sources WHERE source_id = ?", TAITO_SOURCE_ID).publication_status, "approved");
  const tiles = all(db, "SELECT * FROM tile_snapshots ORDER BY tile_id");
  const published = all(db, "SELECT spot_id, tile_id FROM tile_snapshot_spots");
  const approvedSpots = all(db,
    `SELECT s.* FROM spots s JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ?`, TAITO_SOURCE_ID);
  // 34 canonical Taito spots, 32 published: the two the ward's other current publication
  // contradicts are withheld by the Issue #42 reconciliation (lifecycle / publication hold).
  assert.equal(approvedSpots.length, 34);
  assert.equal(published.length, 32);
  const publishable = approvedSpots.filter((s) => s.lifecycle === "active" && s.publication_hold === null);
  assert.deepEqual(new Set(published.map((p) => p.spot_id)), new Set(publishable.map((s) => s.spot_id)));
  assert.ok(published.every((p) => !p.spot_id.startsWith("sp_9")), "no spot of the unapproved source is published");

  const bodySpotIds: string[] = [];
  for (const t of tiles) {
    assert.equal(t.z, DATA_TILE_ZOOM);
    assert.equal(t.revision, 1);
    assert.equal(t.schema_version, 1);
    assert.equal(t.content_sha256, sha256(t.body_json), "hash is over the exact stored body");
    const body = TileBodyV1.parse(JSON.parse(t.body_json));
    assert.equal(body.tile, t.tile_id);
    assert.equal(body.spots.length, t.spot_count);
    assert.deepEqual(body.sources, [{
      id: TAITO_SOURCE_ID, displayName: "台東区 公衆喫煙所", licenseName: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode.ja", attributionText: TAITO_ATTRIBUTION_TEXT,
    }], "every Taito tile carries the approved attribution");
    for (const s of body.spots) {
      assert.equal(formatTileId(tileForCoordinate(s.latitude, s.longitude, DATA_TILE_ZOOM)), t.tile_id);
      assert.deepEqual(s.sourceIds, [TAITO_SOURCE_ID]);
      bodySpotIds.push(s.id);
    }
    assert.deepEqual(all(db, "SELECT spot_id FROM tile_snapshot_spots WHERE tile_id = ? ORDER BY spot_id", t.tile_id).map((r) => r.spot_id),
      body.spots.map((s) => s.id));
  }
  assert.equal(bodySpotIds.length, 32);
  assert.equal(new Set(bodySpotIds).size, 32);
  // Research §5 measured 34 Taito spots in 5 occupied z14 tiles; 32 of them survive reconciliation.
  assert.equal(tiles.length, 5);
});

test("tile body v1: exact shape, fixed key order, heated-only and unknown values carried through", async () => {
  const db = await publishedDb();
  const bodies = all(db, "SELECT body_json FROM tile_snapshots").map((t) => JSON.parse(t.body_json));
  assert.deepEqual(Object.keys(bodies[0]), ["schemaVersion", "tile", "revision", "generatedAt", "spots", "sources"]);
  const spots = bodies.flatMap((b) => b.spots);
  assert.deepEqual(Object.keys(spots[0]), [
    "id", "name", "latitude", "longitude", "spotType", "accessType", "environment", "supportsPaper",
    "supportsHeated", "openingHours", "lifecycle", "evidenceQuality", "evidenceQualityVersion", "lastVerifiedAt", "sourceIds",
  ]);
  const heated = spots.find((s) => s.name === "e-booth御徒町　※加熱式たばこ専用");
  assert.deepEqual([heated.supportsPaper, heated.supportsHeated, heated.openingHours.status, heated.openingHours.parsed], ["no", "yes", "unparsed", null]);
  const park = spots.find((s) => s.name === "上野公園前交番裏");
  assert.deepEqual(park, {
    id: park.id, name: "上野公園前交番裏", latitude: 35.7112, longitude: 139.77377, spotType: "unknown", accessType: "unknown",
    environment: "unknown", supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: { status: "parsed", raw: "終日利用可能", parsed: { v: 1, kind: "allDay" }, timeZone: "Asia/Tokyo" },
    lifecycle: "active", evidenceQuality: "officialListing", evidenceQualityVersion: "evidence-quality.v1",
    lastVerifiedAt: "2026-08-18", sourceIds: [TAITO_SOURCE_ID],
  });
  assert.ok(spots.every((s) => s.lastVerifiedAt === "2026-08-18"));
});

test("snapshots are deterministic and republished only when content changes", async () => {
  const a = await publishedDb();
  const b = await publishedDb();
  const bodies = (db: SqliteD1) => all(db, "SELECT tile_id, body_json, content_sha256 FROM tile_snapshots ORDER BY tile_id");
  assert.deepEqual(bodies(a), bodies(b), "same evidence, IDs and time give byte-identical bodies");

  const before = bodies(a);
  const again = await publishTiles(a, { now: "2026-12-31T00:00:00Z" });
  assert.deepEqual(again.published, []);
  assert.equal(again.unchanged.length, 5);
  assert.deepEqual(bodies(a), before, "no-op publish keeps revision, body and ETag");

  const target = one(a, "SELECT spot_id, tile_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 1");
  a.raw.prepare("UPDATE spots SET name = 'renamed' WHERE spot_id = ?").run(target.spot_id);
  const changed = await publishTiles(a, { now: "2026-12-31T00:00:00Z" });
  assert.deepEqual(changed.published.map((p) => [p.tileId, p.revision]), [[target.tile_id, 2]]);
  const row = one(a, "SELECT * FROM tile_snapshots WHERE tile_id = ?", target.tile_id);
  assert.equal(row.content_sha256, sha256(row.body_json));
  assert.notEqual(row.content_sha256, before.find((t) => t.tile_id === target.tile_id)!.content_sha256);
});

test("blocking an approved source after publication empties its tiles on the next publish (complete snapshots)", async () => {
  const db = await publishedDb();
  db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(TAITO_SOURCE_ID);
  const report = await publishTiles(db, { now: "2026-12-31T00:00:00Z" });
  assert.equal(report.published.length, 5);
  assert.ok(report.published.every((p) => p.spotCount === 0 && p.revision === 2));
  assert.equal(one(db, "SELECT count(*) AS n FROM tile_snapshot_spots").n, 0);
  for (const t of all(db, "SELECT body_json FROM tile_snapshots")) {
    assert.deepEqual(JSON.parse(t.body_json).spots, []);
    assert.deepEqual(JSON.parse(t.body_json).sources, []);
  }
});

test("GET /v1/tiles serves the stored body byte-for-byte with a strong ETag", async () => {
  const db = await publishedDb();
  const t = one(db, "SELECT * FROM tile_snapshots ORDER BY tile_id LIMIT 1");
  const res = await get(db, `/v1/tiles/${t.tile_id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(res.headers.get("ETag"), tileEtag(1, t.content_sha256));
  assert.equal(res.headers.get("ETag"), `"1-${sha256(t.body_json)}"`);
  assert.equal(res.headers.get("Cache-Control"), "public, no-cache");
  const text = await res.text();
  assert.equal(text, t.body_json);
  TileBodyV1.parse(JSON.parse(text));
});

test("If-None-Match returns 304 for a current tag and 200 otherwise", async () => {
  const db = await publishedDb();
  const t = one(db, "SELECT * FROM tile_snapshots ORDER BY tile_id LIMIT 1");
  const etag = tileEtag(1, t.content_sha256);
  for (const inm of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
    const res = await get(db, `/v1/tiles/${t.tile_id}`, { "If-None-Match": inm });
    assert.equal(res.status, 304, inm);
    assert.equal(res.headers.get("ETag"), etag);
    assert.equal(await res.text(), "");
  }
  // The smoke check compares a 304's tag with the 200's this way; a gzipping edge weakens only the 200's.
  assert.equal(ifNoneMatchMatches(etag, `W/${etag}`), true);
  assert.equal(ifNoneMatchMatches(`W/"0-${t.content_sha256}"`, etag), false);
  for (const inm of ['"other"', `"0-${t.content_sha256}"`]) {
    const res = await get(db, `/v1/tiles/${t.tile_id}`, { "If-None-Match": inm });
    assert.equal(res.status, 200, inm);
  }

  // After a republish, the old tag no longer matches.
  const spot = one(db, "SELECT spot_id FROM tile_snapshot_spots WHERE tile_id = ? LIMIT 1", t.tile_id);
  db.raw.prepare("UPDATE spots SET name = 'renamed' WHERE spot_id = ?").run(spot.spot_id);
  await publishTiles(db, { now: "2026-12-31T00:00:00Z" });
  const res = await get(db, `/v1/tiles/${t.tile_id}`, { "If-None-Match": etag });
  assert.equal(res.status, 200);
  assert.notEqual(res.headers.get("ETag"), etag);
  assert.equal(JSON.parse(await res.text()).revision, 2);
});

test("invalid and unpublished tiles: 400 for malformed or non-z14 IDs, 404 when nothing is published", async () => {
  const db = await publishedDb();
  const cases: [string, number, string][] = [
    ["/v1/tiles/13/7276/3225", 400, "unsupportedZoom"],
    ["/v1/tiles/15/29105/12903", 400, "unsupportedZoom"],
    ["/v1/tiles/014/14552/6451", 400, "invalidTileId"],
    ["/v1/tiles/14/16384/6451", 400, "invalidTileId"],
    ["/v1/tiles/14/-1/6451", 400, "invalidTileId"],
    ["/v1/tiles/14/abc/6451", 400, "invalidTileId"],
    ["/v1/tiles/14/0/0", 404, "tileNotPublished"],
    ["/v1/spots/x", 404, "spotNotFound"],
    ["/tiles/14/0/0", 404, "notFound"],
  ];
  for (const [path, status, error] of cases) {
    const res = await get(db, path);
    assert.equal(res.status, status, path);
    assert.equal((await res.json() as { error: string }).error, error, path);
    assert.equal(res.headers.get("ETag"), null);
  }

  // A tile that only contains spots of an unapproved source was never published.
  const blocked = new SqliteD1();
  addBlockedTestSource(blocked);
  await importTaito(blocked, { sourceId: TEST_BLOCKED_SOURCE });
  const tileId = one(blocked, "SELECT tile_id FROM spots LIMIT 1").tile_id;
  assert.equal((await get(blocked, `/v1/tiles/${tileId}`)).status, 404);
});
