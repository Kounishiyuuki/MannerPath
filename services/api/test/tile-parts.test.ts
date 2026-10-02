// Bounded multipart tiles (Issue #158, migration 0028, src/tiles/parts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { app } from "../src/app.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { PromotionError, buildMultiSourcePromotionBundle, buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { TileBodyV1, type TileSourceV1, type TileSpotV1, tileEtag } from "../src/tiles/dto.ts";
import { readLogicalTiles } from "../src/tiles/logical.ts";
import { TILE_MANIFEST_SCHEMA_VERSION, TILE_ROW_MAX_BODY_BYTES, TileBudgetError, type TileManifestV1, logicalContent,
  manifestEtag, partBody, partEtag, partitionTile } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { NOW, TAITO_BYTES, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, withoutTrigger } from "./support/sqlite-d1.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const bytes = (s: string) => Buffer.byteLength(s);
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const id = (n: number) => `sp_${n.toString(32).toUpperCase().split("").map((c) => CROCKFORD[parseInt(c, 32)]).join("").padStart(26, "0")}`;
const SOURCE: TileSourceV1 = { id: "src-a", displayName: "A", licenseName: "CC BY 4.0", licenseUrl: "https://example.invalid/l", attributionText: "A" };
const SOURCE_B: TileSourceV1 = { ...SOURCE, id: "src-b", displayName: "B", attributionText: "B" };
function spot(n: number, opts: { name?: string; source?: string } = {}): TileSpotV1 {
  return {
    id: id(n), name: opts.name ?? `spot ${n}`, latitude: 35.7, longitude: 139.77, spotType: "unknown", accessType: "unknown",
    environment: "unknown", supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: { status: "none", raw: null, parsed: null, timeZone: "Asia/Tokyo" }, lifecycle: "active",
    evidenceQuality: "officialListing", evidenceQualityVersion: "evidence-quality.v1", lastVerifiedAt: "2026-08-18",
    sourceIds: [opts.source ?? "src-a"], spotSubtype: null, hostType: "unknown", accessDetail: null,
    verification: { version: "spot-verification.v1", existence: "official", locationPrecision: "publisherPoint", confirmations: null, lastReviewedMonth: "2026-08" },
  };
}
const TILE = "14/14552/6450";
const spots = (n: number, offset = 1) => Array.from({ length: n }, (_, i) => spot(i + offset));

// ---------------------------------------------------------------------------------------------------------------
// Pure partitioning.

test("partitioning is deterministic, id-ordered and complete; identical input -> identical parts and manifest", async () => {
  const input = spots(400);
  const a = await partitionTile(TILE, 3, NOW, input, [SOURCE]);
  const b = await partitionTile(TILE, 3, NOW, input, [SOURCE]);
  assert.deepEqual(a, b);
  assert.ok(a.parts.length > 1 && a.manifest !== null);
  const decoded = a.parts.map((p) => TileBodyV1.parse(JSON.parse(p.body)));
  assert.deepEqual(decoded.flatMap((d) => d.spots.map((s) => s.id)), input.map((s) => s.id), "no spot dropped, none repeated, id order kept");
  for (const p of a.parts) {
    assert.ok(bytes(p.body) <= TILE_ROW_MAX_BODY_BYTES);
    assert.equal(p.sha256, sha(p.body));
  }
  const m = JSON.parse(a.manifest!.body) as TileManifestV1;
  assert.deepEqual(m.parts.map((p) => p.index), m.parts.map((_, i) => i));
  assert.deepEqual(m.parts.map((p) => p.sha256), a.parts.map((p) => p.sha256));
  assert.equal(m.spotCount, 400);
  assert.equal(m.logicalSha256, sha(logicalContent(input, [SOURCE])));
  await assert.rejects(partitionTile(TILE, 3, NOW, [...input].reverse(), [SOURCE]), TileBudgetError, "unordered input is refused, never reordered silently");
});

test("a tile that fits is exactly one part, byte-identical to the v1 body; no manifest", async () => {
  const input = spots(5);
  const r = await partitionTile(TILE, 1, NOW, input, [SOURCE]);
  assert.equal(r.parts.length, 1);
  assert.equal(r.manifest, null);
  assert.equal(r.parts[0].body, JSON.stringify({ schemaVersion: 1, tile: TILE, revision: 1, generatedAt: NOW, spots: input, sources: [SOURCE] }));
});

test("exact byte boundary: a body of exactly the budget is one part; one byte less splits", async () => {
  const input = spots(7);
  const exact = bytes(partBody(TILE, 1, NOW, input, [SOURCE]));
  assert.equal((await partitionTile(TILE, 1, NOW, input, [SOURCE], { maxPartSpots: 250, maxBodyBytes: exact })).parts.length, 1);
  const split = await partitionTile(TILE, 1, NOW, input, [SOURCE], { maxPartSpots: 250, maxBodyBytes: exact - 1 });
  assert.equal(split.parts.length, 2);
  assert.deepEqual(split.parts.map((p) => TileBodyV1.parse(JSON.parse(p.body)).spots.length), [6, 1], "one spot over the boundary moves to the next part");
  for (const p of split.parts) assert.ok(bytes(p.body) <= exact - 1);
});

test("exact spot boundary: N spots under a cap of N is one part; N+1 is two", async () => {
  assert.equal((await partitionTile(TILE, 1, NOW, spots(10), [SOURCE], { maxPartSpots: 10, maxBodyBytes: TILE_ROW_MAX_BODY_BYTES })).parts.length, 1);
  const r = await partitionTile(TILE, 1, NOW, spots(11), [SOURCE], { maxPartSpots: 10, maxBodyBytes: TILE_ROW_MAX_BODY_BYTES });
  assert.deepEqual(r.parts.map((p) => p.spotCount), [10, 1]);
});

test("each part carries exactly the sources its spots cite (attribution travels with every part)", async () => {
  const input = [spot(1, { source: "src-a" }), spot(2, { source: "src-b" }), spot(3, { source: "src-b" })];
  const r = await partitionTile(TILE, 1, NOW, input, [SOURCE, SOURCE_B], { maxPartSpots: 1, maxBodyBytes: TILE_ROW_MAX_BODY_BYTES });
  assert.deepEqual(r.parts.map((p) => TileBodyV1.parse(JSON.parse(p.body)).sources.map((s) => s.id)), [["src-a"], ["src-b"], ["src-b"]]);
  await assert.rejects(partitionTile(TILE, 1, NOW, [spot(1, { source: "missing" })], [SOURCE]), /does not carry/);
});

test("a single spot over the budget, or a manifest over it, fails loudly; nothing is dropped", async () => {
  const huge = spot(1, { name: "x".repeat(2_000) });
  await assert.rejects(partitionTile(TILE, 1, NOW, [huge], [SOURCE], { maxPartSpots: 250, maxBodyBytes: 1_500 }), /alone exceeds/);
  await assert.rejects(partitionTile(TILE, 1, NOW, spots(300), [SOURCE], { maxPartSpots: 1, maxBodyBytes: 20_000 }), /manifest, over the/);
  await assert.rejects(partitionTile(TILE, 1, NOW, spots(3), [SOURCE], { maxPartSpots: 251, maxBodyBytes: 1_000 }), /cannot exceed/);
});

test("a dense 2,500-spot logical tile is bounded: every part within budget, the manifest within budget", async () => {
  const input = spots(2_500);
  const r = await partitionTile(TILE, 1, NOW, input, [SOURCE]);
  assert.ok(r.parts.length > 10);
  assert.ok(r.parts.every((p) => bytes(p.body) <= TILE_ROW_MAX_BODY_BYTES && p.spotCount <= 250));
  assert.ok(bytes(r.manifest!.body) <= TILE_ROW_MAX_BODY_BYTES);
  assert.equal(r.parts.reduce((n, p) => n + p.spotCount, 0), 2_500);
});

// ---------------------------------------------------------------------------------------------------------------
// The published representation: Taito-format rows under the Taito registry (TEST ONLY adapter, not in SOURCE_ADAPTERS),
// 2,100 records packed into one z14 tile — the #156 density.

const DENSE: SourceAdapter = { ...TAITO_ADAPTER, assertResolvable: () => {}, attenuate: () => [] };
const HEADER = new TextDecoder().decode(TAITO_BYTES).split("\r\n")[0];
function denseCsv(n: number, nameSuffix = ""): Uint8Array {
  const rows = Array.from({ length: n }, (_, i) =>
    [i + 1, "131067", "台東区", `テスト喫煙所${i + 1}${nameSuffix}`, "テスト", "台東区上野", "", "終日利用可能", "終日利用可能",
      (35.701917 + (i % 50) * 0.00002).toFixed(6), (139.757080 + Math.floor(i / 50) * 0.00002).toFixed(6), ""].join(","));
  return new TextEncoder().encode([HEADER, ...rows, ""].join("\r\n"));
}
async function denseDb(n = 2_100): Promise<SqliteD1> {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, DENSE, denseCsv(n), { ...TAITO_FIXTURE_RELEASE, sourceUrl: "https://example.invalid/dense.csv" });
  assert.equal((await resolveFirstRelease(db, DENSE, releaseId, { now: NOW, newSpotId: sequentialSpotIds("D") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  return db;
}
const one = (db: SqliteD1, sql: string, ...p: unknown[]) => db.raw.prepare(sql).get(...(p as never[])) as Record<string, any>;
const get = (db: SqliteD1, path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, { DB: db });

test("publish stores a dense tile as a bounded manifest + parts, with every spot in the membership", async () => {
  const db = await denseDb();
  const head = one(db, "SELECT * FROM tile_snapshots");
  assert.equal(head.schema_version, TILE_MANIFEST_SCHEMA_VERSION);
  assert.equal(head.spot_count, 2_100);
  assert.ok(bytes(head.body_json) <= TILE_ROW_MAX_BODY_BYTES);
  const parts = db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY part_index").all() as Record<string, any>[];
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => bytes(p.body_json) <= TILE_ROW_MAX_BODY_BYTES && p.revision === head.revision));
  assert.equal(one(db, "SELECT count(*) n FROM tile_snapshot_spots").n, 2_100);
  const [logical] = await readLogicalTiles(db);
  assert.equal(logical.body.spots.length, 2_100);
  // Quality's hard per-part budgets pass for a 2,100-spot logical tile.
  const q = await analyzeCorpus(db, { now: NOW, gzip: (s) => bytes(s) });
  assert.equal(q.checks.find((c) => c.id === "tile-zoom-thresholds")!.status, "fail", "raw-as-gzip stand-in exceeds 16 KiB on purpose");
  const real = await analyzeCorpus(db, { now: NOW, gzip: (s) => gzipSync(s).length });
  assert.equal(real.checks.find((c) => c.id === "tile-zoom-thresholds")!.status, "pass");
  assert.equal(real.thresholds.maxSpotsPerTile, 2_100);
  assert.ok(real.thresholds.maxSpotsPerPart <= 250);
});

test("republish: identical input keeps the revision; a change replaces every part atomically; shrinking returns to one v1 part", async () => {
  const db = await denseDb();
  const before = one(db, "SELECT * FROM tile_snapshots");
  const partsBefore = db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY part_index").all();
  assert.deepEqual((await publishTiles(db, { now: "2026-10-01T00:00:00Z" })).unchanged, [before.tile_id]);
  assert.deepEqual(db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY part_index").all(), partsBefore);
  // Unpublish most spots (as a removal would): the logical tile shrinks below the budget.
  const keep = db.raw.prepare("SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 3").all().map((r: any) => r.spot_id);
  db.raw.prepare(`DELETE FROM tile_snapshot_spots WHERE spot_id NOT IN (${keep.map(() => "?").join(",")})`).run(...keep);
  db.raw.prepare(`UPDATE spots SET publication_hold = 'locationSuperseded' WHERE spot_id NOT IN (${keep.map(() => "?").join(",")})`).run(...keep);
  const r = await publishTiles(db, { now: "2026-10-02T00:00:00Z" });
  assert.deepEqual(r.published.map((p) => [p.revision, p.spotCount, p.partCount]), [[before.revision + 1, 3, 1]]);
  const after = one(db, "SELECT * FROM tile_snapshots");
  assert.equal(after.schema_version, 1);
  assert.equal(one(db, "SELECT count(*) n FROM tile_snapshot_parts").n, 0, "old parts are removed in the same batch");
  assert.equal(TileBodyV1.parse(JSON.parse(after.body_json)).spots.length, 3);
});

test("schema budgets: no part or head body over the budget, no part without its head revision, no part update", async () => {
  const db = await denseDb();
  const head = one(db, "SELECT * FROM tile_snapshots");
  const big = JSON.stringify({ pad: "x".repeat(TILE_ROW_MAX_BODY_BYTES) });
  assert.throws(() => db.raw.prepare("INSERT INTO tile_snapshot_parts VALUES (?, 999, ?, 1, ?, 0, ?)").run(head.tile_id, head.revision, sha(big), big), /CHECK/);
  assert.throws(() => db.raw.prepare("INSERT INTO tile_snapshot_parts VALUES (?, 999, ?, 1, ?, 0, '{}')").run(head.tile_id, head.revision + 1, sha("{}")), /same revision/);
  assert.throws(() => db.raw.prepare("UPDATE tile_snapshot_parts SET spot_count = 0").run(), /never updated/);
  assert.throws(() => db.raw.prepare("UPDATE tile_snapshots SET body_json = ?, revision = revision + 1").run(big), /bounded parts/);
});

// ---------------------------------------------------------------------------------------------------------------
// API.

test("legacy single-body GET: a single-part tile is unchanged (body, ETag, 304); a multipart tile fails closed with 409", async () => {
  const taito = new SqliteD1();
  await importTaito(taito, { newSpotId: sequentialSpotIds("0") });
  await publishTiles(taito, { now: NOW });
  const t = one(taito, "SELECT * FROM tile_snapshots ORDER BY spot_count DESC LIMIT 1");
  const res = await get(taito, `/v1/tiles/${t.tile_id}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), t.body_json);
  assert.equal(res.headers.get("ETag"), tileEtag(1, t.content_sha256));
  assert.equal((await get(taito, `/v1/tiles/${t.tile_id}`, { "If-None-Match": tileEtag(1, t.content_sha256) })).status, 304);

  const dense = await denseDb();
  const d = one(dense, "SELECT * FROM tile_snapshots");
  const refused = await get(dense, `/v1/tiles/${d.tile_id}`);
  assert.equal(refused.status, 409);
  const problem = await refused.json() as { error: string };
  assert.equal(problem.error, "tileRequiresMultipart");
  assert.equal(refused.headers.get("ETag"), null, "nothing cacheable is returned");
  assert.ok(!JSON.stringify(problem).includes("sp_"), "no spot of the tile leaks to an old client");
});

test("manifest + parts: every part fetched by index reproduces the logical tile; ETags are deterministic; 304 works", async () => {
  const dense = await denseDb();
  const d = one(dense, "SELECT * FROM tile_snapshots");
  const mres = await get(dense, `/v1/tiles/${d.tile_id}/manifest`);
  assert.equal(mres.status, 200);
  assert.equal(mres.headers.get("ETag"), manifestEtag(d.content_sha256));
  const manifest = await mres.json() as TileManifestV1;
  assert.equal((await get(dense, `/v1/tiles/${d.tile_id}/manifest`, { "If-None-Match": manifestEtag(d.content_sha256) })).status, 304);
  const assembled: string[] = [];
  for (const entry of manifest.parts) {
    const pres = await get(dense, `/v1/tiles/${d.tile_id}/parts/${entry.index}`);
    assert.equal(pres.status, 200);
    const text = await pres.text();
    assert.equal(sha(text), entry.sha256);
    assert.equal(bytes(text), entry.byteLength);
    assert.equal(pres.headers.get("ETag"), partEtag(entry.sha256));
    const body = TileBodyV1.parse(JSON.parse(text));
    assert.equal(body.revision, manifest.revision);
    assembled.push(...body.spots.map((s) => s.id));
  }
  assert.equal(new Set(assembled).size, manifest.spotCount);
  assert.equal((await get(dense, `/v1/tiles/${d.tile_id}/parts/${manifest.partCount}`)).status, 404);
  assert.equal((await get(dense, `/v1/tiles/${d.tile_id}/parts/01`)).status, 400);
  // A second identical database publishes identical heads, parts and ETags.
  const again = await denseDb();
  assert.equal(one(again, "SELECT content_sha256 FROM tile_snapshots").content_sha256, d.content_sha256);
});

test("a single-part tile has a one-part manifest whose part 0 is the v1 body", async () => {
  const taito = new SqliteD1();
  await importTaito(taito, { newSpotId: sequentialSpotIds("0") });
  await publishTiles(taito, { now: NOW });
  const t = one(taito, "SELECT * FROM tile_snapshots ORDER BY tile_id LIMIT 1");
  const manifest = await (await get(taito, `/v1/tiles/${t.tile_id}/manifest`)).json() as TileManifestV1;
  assert.deepEqual([manifest.partCount, manifest.parts[0].sha256, manifest.spotCount], [1, t.content_sha256, t.spot_count]);
  const part = await get(taito, `/v1/tiles/${t.tile_id}/parts/0`);
  assert.equal(await part.text(), t.body_json);
  assert.equal((await get(taito, `/v1/tiles/${t.tile_id}/parts/1`)).status, 404);
});

// ---------------------------------------------------------------------------------------------------------------
// Verification of stored parts, and promotion boundaries.

for (const [name, tamper, expected] of [
  ["missing part", (db: SqliteD1) => db.raw.prepare("DELETE FROM tile_snapshot_parts WHERE part_index = 1").run(), /does not describe/],
  ["duplicated part", (db: SqliteD1) => {
    const p = one(db, "SELECT * FROM tile_snapshot_parts WHERE part_index = 0");
    db.raw.prepare("DELETE FROM tile_snapshot_parts WHERE part_index = 1").run();
    db.raw.prepare("INSERT INTO tile_snapshot_parts VALUES (?, 1, ?, 1, ?, ?, ?)").run(p.tile_id, p.revision, p.content_sha256, p.spot_count, p.body_json);
  }, /does not match its manifest|overlap/],
  ["wrong revision", (db: SqliteD1) => withoutTrigger(db.raw, "tile_snapshot_parts_head", () => {
    const p = one(db, "SELECT * FROM tile_snapshot_parts WHERE part_index = 1");
    db.raw.prepare("DELETE FROM tile_snapshot_parts WHERE part_index = 1").run();
    db.raw.prepare("INSERT INTO tile_snapshot_parts VALUES (?, 1, ?, 1, ?, ?, ?)").run(p.tile_id, p.revision + 1, p.content_sha256, p.spot_count, p.body_json);
  }), /does not match its manifest/],
  ["corrupt part", (db: SqliteD1) => {
    const p = one(db, "SELECT * FROM tile_snapshot_parts WHERE part_index = 1");
    db.raw.prepare("DELETE FROM tile_snapshot_parts WHERE part_index = 1").run();
    db.raw.prepare("INSERT INTO tile_snapshot_parts VALUES (?, 1, ?, 1, ?, ?, ?)").run(p.tile_id, p.revision, p.content_sha256, p.spot_count, p.body_json.replace("テスト喫煙所", "テスト喫煙所X"));
  }, /does not match its manifest/],
] as const) {
  test(`logical verification refuses a ${name}; nothing partial is returned`, async () => {
    const db = await denseDb(600);
    tamper(db);
    await assert.rejects(readLogicalTiles(db), expected as RegExp);
  });
}

test("promotion v2/v3 refuse a database with multipart tiles (segmented promotion carries parts)", async () => {
  const db = await denseDb(600);
  await assert.rejects(buildPromotionBundle(db), (e: unknown) => e instanceof PromotionError && /bounded parts/.test(e.message));
  await assert.rejects(buildMultiSourcePromotionBundle(db), (e: unknown) => e instanceof PromotionError && /bounded parts/.test(e.message));
});
