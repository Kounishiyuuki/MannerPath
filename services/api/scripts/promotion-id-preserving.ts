// ID-preserving input for a v4 promotion that adds reviewed sources (V1_TOKYO_RELEASE_PLAN §4 option a).
// Local files only: no Wrangler, credentials, network or remote write path.
//
// The live DATA database is a promoted v4 GREEN, which is sealed ("promoted state is immutable"), so a copy of
// it cannot simply be extended. Instead this rebuilds a fresh local pipeline database from the reviewed
// fixtures and reuses the live spot IDs:
//   1. read the snapshot (a local SQLite copy of a read-only `wrangler d1 export --remote`) without writing it;
//   2. re-ingest every source the snapshot carries from its reviewed fixture, which must be byte-identical
//      to the live release (same content SHA-256), and resolve it with the live ID of each record;
//   3. add the requested new sources with fresh IDs, then publish tiles;
//   4. keep the output only if every live published spot is still published under the same ID, in the same
//      tile, with an identical public tile entry, and every new spot belongs to a new source.
// Any refusal deletes the partial output. The output is the `--database` of `promotion:v4:build`.
// Runbook: docs/release/ID_PRESERVING_PROMOTION_RUNBOOK.md.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isoSeconds, sha256Hex } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { observeRelease } from "../src/pipeline/observe.ts";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { SPOT_ID, newSpotId } from "../src/spot-id.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { applyMigration, migratedSqlite, migrationFiles, SqliteD1 } from "../test/support/sqlite-d1.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { MINATO_ADAPTER, MINATO_FIXTURE_RELEASE, MINATO_SOURCE_ID } from "../src/pipeline/minato-adapter.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, KOTO_SOURCE_ID } from "../src/pipeline/koto-adapter.ts";
import { MUSASHINO_ADAPTER, MUSASHINO_FIXTURE_RELEASE, MUSASHINO_SOURCE_ID } from "../src/pipeline/musashino-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../src/pipeline/osaka-adapter.ts";
import { KYOTO_ADAPTER, KYOTO_FIXTURE_RELEASE, KYOTO_SOURCE_ID } from "../src/pipeline/kyoto-adapter.ts";
import { CHIYODA_ADAPTER, CHIYODA_FIXTURE_RELEASE, CHIYODA_SOURCE_ID } from "../src/pipeline/chiyoda-adapter.ts";
import { CHUO_PARK_ADAPTER, CHUO_PARK_FIXTURE_RELEASE, CHUO_PARK_SOURCE_ID } from "../src/pipeline/chuo-park-adapter.ts";
import { CHUO_PRIVATE_ADAPTER, CHUO_PRIVATE_FIXTURE_RELEASE, CHUO_PRIVATE_SOURCE_ID } from "../src/pipeline/chuo-private-adapter.ts";
import { SHIBUYA_ADAPTER, SHIBUYA_FIXTURE_RELEASE, SHIBUYA_SOURCE_ID } from "../src/pipeline/shibuya-adapter.ts";
import { TOSHIMA_ADAPTER, TOSHIMA_FIXTURE_RELEASE, TOSHIMA_SOURCE_ID } from "../src/pipeline/toshima-adapter.ts";

type Release = Parameters<typeof ingestRelease>[3];
export interface ReviewedFixture { adapter: SourceAdapter; release: Release; fixture: string }
const F = "../../data-pipeline/fixtures/";

/** Sources the live corpus may carry, in the order production applied them. Re-ingested, never added. */
export const LIVE_SOURCES: Readonly<Record<string, ReviewedFixture>> = {
  [TAITO_SOURCE_ID]: { adapter: TAITO_ADAPTER, release: TAITO_FIXTURE_RELEASE, fixture: `${F}taito-public-smoking-areas/20260818_koshukitsuenjo.csv` },
  [MINATO_SOURCE_ID]: { adapter: MINATO_ADAPTER, release: MINATO_FIXTURE_RELEASE, fixture: `${F}minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv` },
  [KOTO_SOURCE_ID]: { adapter: KOTO_ADAPTER, release: KOTO_FIXTURE_RELEASE, fixture: `${F}koto-station-smoking-areas/131083_237_public_smoking_area_station.csv` },
  [MUSASHINO_SOURCE_ID]: { adapter: MUSASHINO_ADAPTER, release: MUSASHINO_FIXTURE_RELEASE, fixture: `${F}musashino-public-smoking-areas/doc.kml` },
  [OSAKA_SOURCE_ID]: { adapter: OSAKA_ADAPTER, release: OSAKA_FIXTURE_RELEASE, fixture: `${F}osaka-designated-smoking-areas/opendata_1012.csv` },
  [KYOTO_SOURCE_ID]: { adapter: KYOTO_ADAPTER, release: KYOTO_FIXTURE_RELEASE, fixture: `${F}kyoto-public-smoking-places/20260903_shisetsu.csv` },
};

/** The reviewed Tokyo factReference additions. Listing here is not publication approval. */
export const ADDITIVE_SOURCES: Readonly<Record<string, ReviewedFixture>> = {
  [CHIYODA_SOURCE_ID]: { adapter: CHIYODA_ADAPTER, release: CHIYODA_FIXTURE_RELEASE, fixture: `${F}chiyoda-smoking-places/chiyoda-page-facts.csv` },
  [CHUO_PARK_SOURCE_ID]: { adapter: CHUO_PARK_ADAPTER, release: CHUO_PARK_FIXTURE_RELEASE, fixture: `${F}chuo-park-smoking-places/chuo-park-page-facts.csv` },
  [CHUO_PRIVATE_SOURCE_ID]: { adapter: CHUO_PRIVATE_ADAPTER, release: CHUO_PRIVATE_FIXTURE_RELEASE, fixture: `${F}chuo-private-smoking-places/chuo-private-page-facts.csv` },
  [SHIBUYA_SOURCE_ID]: { adapter: SHIBUYA_ADAPTER, release: SHIBUYA_FIXTURE_RELEASE, fixture: `${F}shibuya-smoking-places/shibuya-page-facts.csv` },
  [TOSHIMA_SOURCE_ID]: { adapter: TOSHIMA_ADAPTER, release: TOSHIMA_FIXTURE_RELEASE, fixture: `${F}toshima-smoking-places/toshima-page-facts.csv` },
};

/** Bookkeeping that `wrangler d1 export` and SQLite may add; never canonical. */
const IGNORED_TABLE = /^(sqlite_|_cf_|d1_migrations$)/;
/** New spots this close to a live published spot are refused as possible duplicates. */
export const DUPLICATE_RADIUS_M = 25;

function refuse(message: string): never { throw new Error(`id-preserving promotion refused: ${message}`); }

function schemaOf(db: DatabaseSync): string[] {
  return (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all() as Record<string, string>[])
    .filter(r => !IGNORED_TABLE.test(r.tbl_name))
    .map(r => `${r.type}\t${r.name}\t${r.sql.replace(/\s+/g, " ").trim()}`);
}

function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

const fileSha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** A record is the same record when it is the same row of the same release bytes. */
const recordKey = (sourceId: string, releaseSha256: string, ordinal: number, rawSha256: string) => `${sourceId}\t${releaseSha256}\t${ordinal}\t${rawSha256}`;

type TileEntry = { tile: string; spot: Awaited<ReturnType<typeof readPublishedTiles>>[number]["spots"][number] };
async function tileEntries(raw: DatabaseSync): Promise<Map<string, TileEntry>> {
  const entries = new Map<string, TileEntry>();
  for (const t of await readPublishedTiles(new SqliteD1(raw))) for (const spot of t.spots) entries.set(spot.id, { tile: t.tile, spot });
  return entries;
}

interface Live {
  releases: Map<string, { contentSha256: string; parserVersion: string }>;
  idByRecord: Map<string, string>;
  tiles: Map<string, TileEntry>;
}

async function readSnapshot(path: string, addSourceIds: readonly string[], live: Readonly<Record<string, ReviewedFixture>>): Promise<Live> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if ((db.prepare("PRAGMA integrity_check").get() as Record<string, string>).integrity_check !== "ok") refuse("snapshot integrity_check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length) refuse("snapshot has foreign key violations");
    const expected = migratedSqlite();
    try {
      const want = schemaOf(expected), got = schemaOf(db);
      if (want.join("\n") !== got.join("\n")) {
        refuse(`snapshot schema does not match this checkout's migrations (${want.filter(s => !got.includes(s)).length} missing, ${got.filter(s => !want.includes(s)).length} unexpected objects)`);
      }
    } finally { expected.close(); }
    if (!db.prepare("SELECT 1 FROM promotion_v4_completions").get()) refuse("snapshot is not a completed v4 promotion");

    const releases = new Map<string, { contentSha256: string; parserVersion: string }>();
    for (const r of db.prepare("SELECT source_id, content_sha256, parser_version, status, is_current FROM source_releases ORDER BY source_id, release_id").all() as Record<string, string | number>[]) {
      const id = String(r.source_id);
      if (!Object.hasOwn(live, id)) refuse(`snapshot carries ${id}, which has no reviewed fixture to rebuild from`);
      if (r.status !== "applied" || r.is_current !== 1 || releases.has(id)) refuse(`${id}: only one current applied release per source is supported`);
      releases.set(id, { contentSha256: String(r.content_sha256), parserVersion: String(r.parser_version) });
    }
    for (const id of addSourceIds) if (releases.has(id) || db.prepare("SELECT 1 FROM sources WHERE source_id=?").get(id)) refuse(`${id} already exists in the snapshot`);
    if (db.prepare("SELECT 1 FROM spots WHERE merged_into IS NOT NULL").get()) refuse("snapshot has merged spots; cross-source merges are not rebuilt");

    const idByRecord = new Map<string, string>();
    const links = db.prepare(
      `SELECT r.source_id, r.content_sha256, sr.ordinal, sr.raw_sha256, sse.spot_id
       FROM spot_source_entities sse
       JOIN source_record_entities sre USING (source_entity_id)
       JOIN source_records sr ON sr.record_id = sre.record_id AND sr.release_id = sre.release_id
       JOIN source_releases r ON r.release_id = sr.release_id`).all() as Record<string, string | number>[];
    const linkedSpots = new Set<string>();
    for (const l of links) {
      const key = recordKey(String(l.source_id), String(l.content_sha256), Number(l.ordinal), String(l.raw_sha256));
      if (idByRecord.has(key) || linkedSpots.has(String(l.spot_id))) refuse(`snapshot links ${l.spot_id} ambiguously`);
      idByRecord.set(key, String(l.spot_id));
      linkedSpots.add(String(l.spot_id));
    }
    const tiles = await tileEntries(db);
    if (tiles.size === 0) refuse("snapshot publishes no spots");
    for (const id of tiles.keys()) if (!linkedSpots.has(id)) refuse(`published spot ${id} has no source record link`);
    return { releases, idByRecord, tiles };
  } finally { db.close(); }
}

export interface IdPreservingReport {
  status: "completed";
  snapshotSha256: string;
  outputSha256: string;
  preservedPublishedSpots: number;
  addedSpots: Record<string, number>;
  publishedSpots: number;
  tiles: number;
}

export async function buildIdPreservingInput(snapshotPath: string, outputPath: string, addSourceIds: readonly string[], options: {
  now: string; expectedAdded?: number; duplicateRadiusM?: number;
  liveSources?: Readonly<Record<string, ReviewedFixture>>; additiveSources?: Readonly<Record<string, ReviewedFixture>>;
}): Promise<IdPreservingReport> {
  const liveSources = options.liveSources ?? LIVE_SOURCES, additiveSources = options.additiveSources ?? ADDITIVE_SOURCES;
  const snapshot = resolve(snapshotPath), output = resolve(outputPath), partial = `${output}.partial`;
  if (!existsSync(snapshot)) refuse(`snapshot ${snapshotPath} does not exist`);
  if (snapshot === output) refuse("output must differ from the snapshot");
  if (existsSync(output) || existsSync(partial)) refuse(`output ${outputPath} already exists`);
  if (addSourceIds.length === 0) refuse("no sources requested");
  if (new Set(addSourceIds).size !== addSourceIds.length) refuse("duplicate source in request");
  for (const id of addSourceIds) if (!Object.hasOwn(additiveSources, id)) refuse(`${id} is not a reviewed additive source`);

  const snapshotSha256 = fileSha256(snapshot);
  const live = await readSnapshot(snapshot, addSourceIds, liveSources);
  if (fileSha256(snapshot) !== snapshotSha256) refuse("snapshot changed while it was read");
  const liveIds = new Set(live.idByRecord.values());

  const raw = new DatabaseSync(partial);
  try {
    raw.exec("PRAGMA foreign_keys=ON;");
    for (const file of migrationFiles()) applyMigration(raw, readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    const db = new SqliteD1(raw);
    const issued = new Set<string>();
    const ingestSource = async (id: string, { adapter, release, fixture }: ReviewedFixture, idFor: (recordId: number) => string) => {
      if (adapter.registry.sourceId !== id) refuse(`${id} maps to adapter ${adapter.registry.sourceId}`);
      if (!(await ensureReviewedSource(db, id, options.now)).created) refuse(`${id} registry row already existed`);
      const bytes = new Uint8Array(readFileSync(new URL(fixture, import.meta.url)));
      const ingest = await ingestRelease(db, adapter, bytes, release);
      await recordReviewedAnchors(db, adapter, await sha256Hex(bytes), options.now);
      const queue = (await observeRelease(db, adapter, ingest.releaseId)).map(o => idFor(o.recordId));
      let next = 0;
      const resolved = await resolveFirstRelease(db, adapter, ingest.releaseId, { now: options.now, newSpotId: () => {
        if (next >= queue.length) refuse(`${id}: resolve asked for more spot IDs than it has observations`);
        return queue[next++];
      } });
      if (resolved.status !== "resolved" || next !== queue.length) refuse(`${id} did not resolve as one first release`);
      return { releaseId: ingest.releaseId, spotIds: resolved.spotIds };
    };
    const freshId = () => {
      const id = newSpotId();
      if (liveIds.has(id) || issued.has(id)) refuse(`spot ID collision ${id}`);
      issued.add(id);
      return id;
    };

    for (const id of Object.keys(liveSources).filter(s => live.releases.has(s))) {
      const want = live.releases.get(id)!;
      const record = (recordId: number) => {
        const r = raw.prepare("SELECT r.content_sha256, sr.ordinal, sr.raw_sha256 FROM source_records sr JOIN source_releases r USING(release_id) WHERE sr.record_id=?").get(recordId) as Record<string, string | number>;
        if (r.content_sha256 !== want.contentSha256) refuse(`${id}: the reviewed fixture (${r.content_sha256}) is not the live release (${want.contentSha256})`);
        return live.idByRecord.get(recordKey(id, String(r.content_sha256), Number(r.ordinal), String(r.raw_sha256))) ?? freshId();
      };
      const { releaseId } = await ingestSource(id, liveSources[id], record);
      const parser = (raw.prepare("SELECT parser_version FROM source_releases WHERE release_id=?").get(releaseId) as { parser_version: string }).parser_version;
      if (parser !== want.parserVersion) refuse(`${id}: parser ${parser} differs from the live ${want.parserVersion}`);
    }
    const addedSpots: Record<string, number> = {};
    for (const id of addSourceIds) addedSpots[id] = (await ingestSource(id, additiveSources[id], freshId)).spotIds.length;
    await publishTiles(db, { now: options.now });

    if (raw.prepare("PRAGMA foreign_key_check").all().length) refuse("output has foreign key violations");
    const tiles = await tileEntries(raw);
    for (const [id, entry] of live.tiles) {
      const now = tiles.get(id);
      if (!now) refuse(`live published spot ${id} is not published in the output`);
      if (JSON.stringify(now) !== JSON.stringify(entry)) refuse(`live published spot ${id} changed its tile or public tile entry`);
    }
    const added = [...tiles.values()].filter(e => !live.tiles.has(e.spot.id));
    const addedTotal = Object.values(addedSpots).reduce((a, b) => a + b, 0);
    if (added.some(e => !issued.has(e.spot.id) || e.spot.sourceIds.some(s => !addSourceIds.includes(s)))) refuse("a spot outside the requested sources became published");
    if (added.length !== addedTotal) refuse(`${addedTotal} new spots were resolved but ${added.length} are published`);
    if (options.expectedAdded !== undefined && addedTotal !== options.expectedAdded) refuse(`expected ${options.expectedAdded} new spots, got ${addedTotal}`);
    const radius = options.duplicateRadiusM ?? DUPLICATE_RADIUS_M;
    const livePoints = [...live.tiles.values()].map(e => e.spot);
    for (const { spot } of added) {
      if (!SPOT_ID.test(spot.id)) refuse(`malformed spot ID ${spot.id}`);
      if (livePoints.some(p => distanceM(p, spot) < radius)) refuse(`new spot ${spot.id} is within ${radius} m of a live published spot`);
    }
    const report = { preservedPublishedSpots: live.tiles.size, addedSpots, publishedSpots: tiles.size, tiles: (raw.prepare("SELECT count(*) n FROM tile_snapshots").get() as { n: number }).n };
    raw.close();
    renameSync(partial, output);
    return { status: "completed", snapshotSha256, outputSha256: fileSha256(output), ...report };
  } catch (error) {
    if (raw.isOpen) raw.close();
    rmSync(partial, { force: true });
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--snapshot", "--out", "--add", "--expect-added"].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith("--") || args.has(argv[i])) throw new Error(`invalid/missing/duplicate option: ${argv[i]}`);
    args.set(argv[i], argv[i + 1]);
  }
  const snapshot = args.get("--snapshot"), out = args.get("--out"), add = args.get("--add");
  if (!snapshot || !out || !add) throw new Error("usage: promotion:id-preserving --snapshot <live.sqlite> --out <new.sqlite> --add a,b,c [--expect-added N]");
  if ([snapshot, out].some(p => /^(https?:|file:)/.test(p) || p === ":memory:")) throw new Error("--snapshot and --out must be local file paths");
  const expectedAdded = args.has("--expect-added") ? Number(args.get("--expect-added")) : undefined;
  if (expectedAdded !== undefined && !Number.isSafeInteger(expectedAdded)) throw new Error("--expect-added must be an integer");
  console.log(JSON.stringify(await buildIdPreservingInput(snapshot, out, add.split(","), { now: isoSeconds(new Date()), expectedAdded }), null, 2));
}
