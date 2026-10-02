// ADR-0015: bounded, content-addressed tile parts — the split, the stored bounds, the manifest/part endpoints,
// the v1 path for older clients, and atomic replacement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { app } from "../src/app.ts";
import { sha256Hex } from "../src/db.ts";
import { TileManifestV2, TilePartBodyV2, type TileSourceV1, type TileSpotV1, tileEtag } from "../src/tiles/dto.ts";
import { assembleTileV1, manifestBody, readPublishedTiles, splitTileParts, sqlLiteralBytes, TILE_PART_POLICY, TileBudgetExceeded } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { syntheticId } from "../scripts/scale/corpus.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileBody, v1TileRows } from "./support/tiles.ts";

type Row = Record<string, any>;
const one = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).get(...p) as Row;
const all = (db: SqliteD1, sql: string, ...p: any[]) => db.raw.prepare(sql).all(...p) as Row[];
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const get = (db: SqliteD1, path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, { DB: db });

const SOURCES: TileSourceV1[] = ["src-a", "src-b"].map((id) => ({
  id, displayName: `Source ${id}`, licenseName: "CC BY 4.0", licenseUrl: "https://example.invalid/license", attributionText: `© ${id}`,
}));
const sourcesById = new Map(SOURCES.map((s) => [s.id, s]));

/** A dense tile like #156's station areas: n spots in ~110 m, names of realistic (Japanese, multi-byte) length. */
function denseSpots(n: number, nameLength = 20): TileSpotV1[] {
  return Array.from({ length: n }, (_, i): TileSpotV1 => ({
    id: syntheticId("sp", i), name: "喫煙所".repeat(Math.ceil(nameLength / 3)).slice(0, nameLength) + i,
    latitude: 35.69 + (i % 100) * 1e-5, longitude: 139.7 + Math.floor(i / 100) * 1e-5,
    spotType: "ashtray", accessType: "public", environment: "outdoor", supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" }, lifecycle: "active",
    evidenceQuality: "communityReported", evidenceQualityVersion: "evidence-quality.v1", lastVerifiedAt: null,
    sourceIds: [SOURCES[i % 2].id], spotSubtype: null, hostType: "unknown", accessDetail: null,
    verification: { version: "spot-verification.v1", existence: "communityReported", locationPrecision: "communityPinned", confirmations: 1, lastReviewedMonth: "2026-10" },
  })).sort((a, b) => (a.id < b.id ? -1 : 1));
}

test("a dense tile splits into parts within every bound, in id order, each citing only its own sources", async () => {
  const spots = denseSpots(2223);
  const parts = await splitTileParts("14/14552/6451", spots, sourcesById);
  assert.ok(parts.length > 1);
  const bodies = parts.map((p) => TilePartBodyV2.parse(JSON.parse(p.bodyJson)));
  for (const [i, p] of parts.entries()) {
    assert.ok(p.spotCount <= TILE_PART_POLICY.maxSpots, `part ${i}: ${p.spotCount} spots`);
    assert.ok(p.rawBytes <= TILE_PART_POLICY.maxRawBytes, `part ${i}: ${p.rawBytes} bytes`);
    assert.equal(p.rawBytes, sqlLiteralBytes(p.bodyJson));
    assert.equal(p.sha256, sha256(p.bodyJson));
    assert.deepEqual([bodies[i].part, bodies[i].partCount], [i, parts.length]);
    assert.deepEqual(bodies[i].sources.map((s) => s.id), [...new Set(bodies[i].spots.flatMap((s) => s.sourceIds))].sort());
  }
  assert.deepEqual(bodies.flatMap((b) => b.spots), spots, "the parts are the tile, in order, nothing lost or repeated");
  // A part closes only when the next spot would breach a bound: greedy packing, so no part but the last is small.
  for (const [i, p] of parts.slice(0, -1).entries()) {
    const next = JSON.stringify(spots[parts.slice(0, i + 1).reduce((n, q) => n + q.spotCount, 0)]);
    assert.ok(p.spotCount === TILE_PART_POLICY.maxSpots || p.rawBytes + sqlLiteralBytes(next) + 1 > TILE_PART_POLICY.maxRawBytes - 4, `part ${i} closed early`);
  }
});

test("the split is deterministic: equal content gives byte-identical parts and hashes", async () => {
  const a = await splitTileParts("14/1/1", denseSpots(600), sourcesById);
  const b = await splitTileParts("14/1/1", denseSpots(600), sourcesById);
  assert.deepEqual(a, b);
  // A change in one spot changes only the part that holds it.
  const changed = denseSpots(600);
  changed[599] = { ...changed[599], name: "renamed" };
  const c = await splitTileParts("14/1/1", changed, sourcesById);
  assert.deepEqual(c.slice(0, -1).map((p) => p.sha256), a.slice(0, -1).map((p) => p.sha256));
  assert.notEqual(c.at(-1)!.sha256, a.at(-1)!.sha256);
});

test("bytes close parts first for real-size spots; the spot cap binds below it; an empty tile has no parts; too many parts or an oversized spot fails publication", async () => {
  // ~690-byte spots: 64 KiB holds ~95, so bytes, not the 250-spot cap, close each part.
  const short = await splitTileParts("14/1/1", denseSpots(600, 1), sourcesById);
  assert.ok(short.length > 3 && short.every((p) => p.spotCount < TILE_PART_POLICY.maxSpots), short.map((p) => p.spotCount).join(" "));
  assert.deepEqual((await splitTileParts("14/1/1", denseSpots(600, 1), sourcesById, { ...TILE_PART_POLICY, maxSpots: 50 })).map((p) => p.spotCount),
    Array(12).fill(50));
  // A single quote costs two bytes as a SQL literal, so a quote-heavy part closes sooner.
  const quoted = denseSpots(600, 1).map((s) => ({ ...s, name: "'".repeat(300) }));
  const quotedParts = await splitTileParts("14/1/1", quoted, sourcesById);
  assert.ok(quotedParts.every((p) => sqlLiteralBytes(p.bodyJson) <= TILE_PART_POLICY.maxRawBytes));
  const plain = denseSpots(600, 1).map((s) => ({ ...s, name: "x".repeat(300) }));
  assert.ok(quotedParts.length > (await splitTileParts("14/1/1", plain, sourcesById)).length);
  // Outlier text: bytes, not the spot count, close these parts.
  const long = await splitTileParts("14/1/1", denseSpots(600, 2000), sourcesById);
  assert.ok(long.every((p) => p.spotCount < TILE_PART_POLICY.maxSpots && p.rawBytes <= TILE_PART_POLICY.maxRawBytes), long.map((p) => `${p.spotCount}/${p.rawBytes}`).join(" "));
  assert.deepEqual(await splitTileParts("14/1/1", [], sourcesById), []);
  await assert.rejects(splitTileParts("14/1/1", denseSpots(600, 1), sourcesById, { ...TILE_PART_POLICY, maxParts: 2 }),
    (e) => e instanceof TileBudgetExceeded && /600 spots need \d+ parts, above tile-parts.v1 maxParts 2/.test(e.message));
  const huge = denseSpots(1, 1);
  huge[0] = { ...huge[0], name: "x".repeat(TILE_PART_POLICY.maxRawBytes) };
  await assert.rejects(splitTileParts("14/1/1", huge, sourcesById), TileBudgetExceeded);
});

test("the manifest pins every part by hash and sums their spots; the assembled v1 body is the whole tile", async () => {
  const spots = denseSpots(700);
  const parts = await splitTileParts("14/1/1", spots, sourcesById);
  const manifest = manifestBody("14/1/1", 3, NOW, parts);
  assert.deepEqual(Object.keys(manifest), ["schemaVersion", "tile", "revision", "generatedAt", "partPolicy", "spotCount", "parts"]);
  assert.equal(manifest.spotCount, 700);
  assert.deepEqual(manifest.parts.map((p) => p.sha256), parts.map((p) => p.sha256));
  const v1 = assembleTileV1(JSON.stringify(manifest), parts.map((p) => p.bodyJson));
  assert.deepEqual(Object.keys(v1), ["schemaVersion", "tile", "revision", "generatedAt", "spots", "sources"]);
  assert.deepEqual(v1.spots, spots);
  assert.deepEqual(v1.sources, SOURCES);
  assert.throws(() => assembleTileV1(JSON.stringify(manifest), parts.slice(1).map((p) => p.bodyJson)), /part rows for/);
  assert.throws(() => assembleTileV1(JSON.stringify(manifest), [...parts].reverse().map((p) => p.bodyJson)), /part row 0 is/);
});

test("migration 0028 restates the part policy: an oversized or overfull part row cannot be stored", async () => {
  const db = await taitoDb();
  const t = one(db, "SELECT tile_id FROM tile_snapshot_parts ORDER BY tile_id LIMIT 1");
  const insert = (index: number, spotCount: number, body: string) => db.raw.prepare(
    "INSERT INTO tile_snapshot_parts (tile_id, part_index, content_sha256, spot_count, body_json) VALUES (?, ?, ?, ?, ?)",
  ).run(t.tile_id, index, sha256(body), spotCount, body);
  const fits = JSON.stringify({ pad: "x".repeat(TILE_PART_POLICY.maxRawBytes - 10) });
  assert.equal(new TextEncoder().encode(fits).length, TILE_PART_POLICY.maxRawBytes);
  insert(1, 1, fits);
  assert.throws(() => insert(2, 1, JSON.stringify({ pad: "x".repeat(TILE_PART_POLICY.maxRawBytes - 9) })), /CHECK constraint failed/);
  // Counted as a SQL literal: the same length with one quote no longer fits.
  assert.throws(() => insert(2, 1, JSON.stringify({ pad: "'" + "x".repeat(TILE_PART_POLICY.maxRawBytes - 11) })), /CHECK constraint failed/);
  assert.throws(() => insert(3, TILE_PART_POLICY.maxSpots + 1, "{}"), /CHECK constraint failed/);
  assert.throws(() => insert(TILE_PART_POLICY.maxParts, 1, "{}"), /CHECK constraint failed/);
});

async function taitoDb(): Promise<SqliteD1> {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return db;
}

/**
 * Rewrites one published tile as several small parts, as a dense tile would publish: the same spots, split with a
 * 3-spot policy. Only the storage layout changes, so the endpoints are tested against a real multi-part snapshot.
 */
async function splitPublishedTile(db: SqliteD1): Promise<{ tileId: string; v1: string; manifest: string }> {
  const t = one(db, "SELECT tile_id, revision, spot_count FROM tile_snapshots ORDER BY spot_count DESC, tile_id LIMIT 1");
  const v1 = v1TileBody(db, t.tile_id)!;
  const body = JSON.parse(v1);
  const parts = await splitTileParts(t.tile_id, body.spots, new Map(body.sources.map((s: TileSourceV1) => [s.id, s])), { ...TILE_PART_POLICY, maxSpots: 3 });
  const manifest = JSON.stringify(manifestBody(t.tile_id, t.revision + 1, NOW, parts));
  db.raw.prepare("DELETE FROM tile_snapshot_parts WHERE tile_id = ?").run(t.tile_id);
  db.raw.prepare("UPDATE tile_snapshots SET body_json = ?, content_sha256 = ?, revision = revision + 1 WHERE tile_id = ?").run(manifest, sha256(manifest), t.tile_id);
  for (const p of parts) {
    db.raw.prepare("INSERT INTO tile_snapshot_parts (tile_id, part_index, content_sha256, spot_count, body_json) VALUES (?, ?, ?, ?, ?)")
      .run(t.tile_id, p.index, p.sha256, p.spotCount, p.bodyJson);
  }
  return { tileId: t.tile_id, v1, manifest };
}

test("manifest and parts: strong ETags, 304s, hashes the client can verify, and the parts assemble to the v1 tile", async () => {
  const db = await taitoDb();
  const { tileId, v1, manifest } = await splitPublishedTile(db);

  const m = await get(db, `/v1/tiles/${tileId}/manifest`);
  assert.equal(m.status, 200);
  assert.equal(m.headers.get("ETag"), tileEtag(2, sha256(manifest)));
  assert.equal(m.headers.get("Cache-Control"), "public, no-cache");
  const text = await m.text();
  assert.equal(text, manifest);
  const parsed = TileManifestV2.parse(JSON.parse(text));
  assert.ok(parsed.parts.length >= 3, `${parsed.parts.length} parts`);
  assert.equal((await get(db, `/v1/tiles/${tileId}/manifest`, { "If-None-Match": m.headers.get("ETag")! })).status, 304);

  const partBodies: string[] = [];
  for (const entry of parsed.parts) {
    const res = await get(db, `/v1/tiles/${tileId}/parts/${entry.index}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(sha256(body), entry.sha256, "a part's bytes hash to its manifest entry");
    assert.equal(res.headers.get("ETag"), tileEtag(2, entry.sha256));
    assert.equal((await get(db, `/v1/tiles/${tileId}/parts/${entry.index}`, { "If-None-Match": tileEtag(2, entry.sha256) })).status, 304);
    partBodies.push(body);
  }
  assert.equal(JSON.stringify(assembleTileV1(text, partBodies)), JSON.stringify({ ...JSON.parse(v1), revision: parsed.revision }));

  for (const [path, status, error] of [
    [`/v1/tiles/${tileId}/parts/${parsed.parts.length}`, 404, "tilePartNotPublished"],
    [`/v1/tiles/${tileId}/parts/01`, 400, "invalidTilePart"],
    [`/v1/tiles/${tileId}/parts/-1`, 400, "invalidTilePart"],
    [`/v1/tiles/15/0/0/manifest`, 400, "unsupportedZoom"],
    [`/v1/tiles/14/0/0/manifest`, 404, "tileNotPublished"],
  ] as const) {
    const res = await get(db, path);
    assert.equal(res.status, status, path);
    assert.equal((await res.json()).error, error, path);
  }
});

test("an older client never receives a partial tile: the v1 path refuses a multi-part tile and serves the rest unchanged", async () => {
  const db = await taitoDb();
  const before = new Map(await Promise.all(v1TileRows(db).map(async (t) => {
    const res = await get(db, `/v1/tiles/${t.tile_id}`);
    return [t.tile_id, { etag: res.headers.get("ETag"), body: await res.text() }] as const;
  })));
  const { tileId } = await splitPublishedTile(db);
  const res = await get(db, `/v1/tiles/${tileId}`);
  assert.equal(res.status, 409);
  const problem = await res.json();
  assert.equal(problem.error, "tileRequiresParts");
  assert.match(problem.detail, new RegExp(`GET /v1/tiles/${tileId}/manifest`));
  for (const [id, v] of before) {
    if (id === tileId) continue;
    const again = await get(db, `/v1/tiles/${id}`);
    assert.deepEqual({ etag: again.headers.get("ETag"), body: await again.text() }, v, `${id}: v1 bytes and ETag unchanged`);
  }
});

test("a database migrated to 0028 but not republished serves its v1 bodies, 503s the manifest, and converts on publish", async () => {
  const db = await taitoDb();
  const t = v1TileRows(db)[0];
  // What a pre-0028 row looks like: the v1 body itself, hashed, schema 1, no parts.
  const legacy = JSON.stringify({ ...JSON.parse(t.body_json), revision: t.revision + 1 });
  db.raw.prepare("DELETE FROM tile_snapshot_parts WHERE tile_id = ?").run(t.tile_id);
  db.raw.prepare("UPDATE tile_snapshots SET schema_version = 1, body_json = ?, content_sha256 = ?, revision = revision + 1 WHERE tile_id = ?")
    .run(legacy, sha256(legacy), t.tile_id);

  const v1 = await get(db, `/v1/tiles/${t.tile_id}`);
  assert.equal(await v1.text(), legacy);
  assert.equal(v1.headers.get("ETag"), tileEtag(1, sha256(legacy)));
  const manifest = await get(db, `/v1/tiles/${t.tile_id}/manifest`);
  assert.equal(manifest.status, 503);
  assert.equal((await manifest.json()).error, "tileRepublishPending");
  assert.deepEqual((await readPublishedTiles(db, t.tile_id))[0].spots, JSON.parse(legacy).spots);

  const report = await publishTiles(db, { now: "2026-12-31T00:00:00Z" });
  assert.deepEqual(report.published.map((p) => p.tileId), [t.tile_id], "only the legacy row republishes");
  const row = one(db, "SELECT schema_version, revision FROM tile_snapshots WHERE tile_id = ?", t.tile_id);
  assert.deepEqual([row.schema_version, row.revision], [2, t.revision + 2]);
  assert.equal((await get(db, `/v1/tiles/${t.tile_id}/manifest`)).status, 200);
});

test("publication replaces a tile's manifest and parts atomically: a failed batch leaves the previous snapshot whole", async () => {
  const db = await taitoDb();
  const t = one(db, "SELECT tile_id FROM tile_snapshots ORDER BY tile_id LIMIT 1");
  const snapshot = () => ({ tiles: all(db, "SELECT * FROM tile_snapshots ORDER BY tile_id"), parts: all(db, "SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index"),
    members: all(db, "SELECT * FROM tile_snapshot_spots ORDER BY spot_id") });
  const before = snapshot();
  const spot = one(db, "SELECT spot_id FROM tile_snapshot_spots WHERE tile_id = ? LIMIT 1", t.tile_id);
  db.raw.prepare("UPDATE spots SET name = 'renamed' WHERE spot_id = ?").run(spot.spot_id);
  // The part insert is the last write of the tile's group; make it fail after the manifest row was already updated.
  db.raw.prepare("CREATE TEMP TRIGGER fail_part BEFORE INSERT ON tile_snapshot_parts BEGIN SELECT RAISE(ABORT, 'injected'); END").run();
  await assert.rejects(publishTiles(db, { now: "2026-12-31T00:00:00Z" }), /injected/);
  assert.deepEqual(snapshot(), before, "no manifest without its parts, no parts without their manifest");
  db.raw.prepare("DROP TRIGGER fail_part").run();
  const report = await publishTiles(db, { now: "2026-12-31T00:00:00Z" });
  assert.deepEqual(report.published.map((p) => p.tileId), [t.tile_id]);
  const manifest = TileManifestV2.parse(JSON.parse(one(db, "SELECT body_json FROM tile_snapshots WHERE tile_id = ?", t.tile_id).body_json));
  const stored = all(db, "SELECT content_sha256, body_json FROM tile_snapshot_parts WHERE tile_id = ? ORDER BY part_index", t.tile_id);
  assert.deepEqual(stored.map((p) => p.content_sha256), manifest.parts.map((p) => p.sha256));
  for (const p of stored) assert.equal(await sha256Hex(p.body_json), p.content_sha256);
});
