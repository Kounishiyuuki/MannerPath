// Bounded multipart tile snapshots (Issue #158; ADR-0005 "Amendment — bounded tile parts"; docs/API.md).
//
// A LOGICAL tile is the complete published content of one XYZ data tile. It is stored and served as one or more
// PHYSICAL parts. Each part is an ordinary schemaVersion-1 tile body (the same DTO, the same field semantics) that
// carries a disjoint, id-ordered subset of the tile's spots and exactly the sources those spots cite. A tile whose
// whole body fits the part budget has exactly one part, and that part IS today's v1 body, byte for byte.
//
// Density is handled here, not by zoom: #156 measured ~2,080 spots inside ~110 m x 110 m, so no data zoom keeps a
// tile under 250 spots. Partitioning is deterministic and depends only on the canonical input: spots in id order,
// packed greedily against hard budgets on spot count and serialized bytes. Gzip size is never a partitioning input
// (it varies between zlib builds, Issue #76, and would make the parts depend on the machine); the gzip budget is a
// hard check of the quality gate instead (src/quality/analyze.ts). No spot is ever dropped to meet a budget: a tile
// that cannot be represented within the budgets fails the publish loudly.

import { sha256Hex } from "../db.ts";
import { TILE_SCHEMA_VERSION, type TileBodyV1, type TileSourceV1, type TileSpotV1 } from "./dto.ts";

/** Physical part body schema: an ordinary tile body (TileBodyV1). */
export const TILE_PART_SCHEMA_VERSION = TILE_SCHEMA_VERSION;
/** The multipart manifest body schema, stored in tile_snapshots.schema_version for a multipart tile. */
export const TILE_MANIFEST_SCHEMA_VERSION = 2;
/** The manifest document's own version (its JSON `manifestVersion`). */
export const TILE_MANIFEST_VERSION = 1;

/** Hard per-part spot count (the ADR-0005 reevaluation threshold, now a hard budget per physical part). */
export const TILE_PART_MAX_SPOTS = 250;
/**
 * Hard per-part (and per-manifest) serialized body budget in UTF-8 bytes. Every stored tile row body is at most
 * this, whatever the local density (migration 0028 enforces it in the schema). Chosen so that:
 *   - a SQL literal of it (every byte a quote, doubled) plus its INSERT stays under the 90,000-byte statement budget
 *     of segmented promotion (PR #159), and so under D1's 100 KB statement limit;
 *   - every real reviewed tile measured (largest 42 spots, 36,972 bytes) stays a single, v1-compatible part.
 */
export const TILE_ROW_MAX_BODY_BYTES = 44_000;
/** Hard gzip budget per stored body: a quality-gate check (measured ~13-15% of raw for tile JSON), never an input. */
export const TILE_PART_MAX_GZIP_BYTES = 16_384;
/** Worst-case SQL single-quoted literal of one stored tile row body (every byte a quote, doubled). */
export const TILE_ROW_MAX_SQL_LITERAL_BYTES = 2 * TILE_ROW_MAX_BODY_BYTES + 2;

export class TileBudgetError extends Error {}

export interface TilePartEntry {
  index: number;
  spotCount: number;
  byteLength: number;
  sha256: string;
}

/** The manifest of a multipart logical tile. Bounded: it fits TILE_ROW_MAX_BODY_BYTES or the publish fails. */
export interface TileManifestV1 {
  manifestVersion: typeof TILE_MANIFEST_VERSION;
  tile: string;
  revision: number;
  generatedAt: string;
  partSchemaVersion: typeof TILE_PART_SCHEMA_VERSION;
  spotCount: number;
  partCount: number;
  /** SHA-256 of the logical content ({spots, sources} of the whole tile), for change detection and verification. */
  logicalSha256: string;
  parts: TilePartEntry[];
}

export interface PartitionedTile {
  /** Physical part bodies, in part order. One part means a single-part (v1-compatible) tile. */
  parts: { body: string; sha256: string; spotCount: number }[];
  /** The manifest body, present only when there is more than one part. */
  manifest: { body: string; sha256: string } | null;
  logicalSha256: string;
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** The logical content the publisher compares across republishes (and the manifest's logicalSha256 covers). */
export function logicalContent(spots: readonly TileSpotV1[], sources: readonly TileSourceV1[]): string {
  return JSON.stringify({ spots, sources });
}

/** Serializes a part body with the fixed v1 key order (identical to the single-body publisher's output). */
export function partBody(tile: string, revision: number, generatedAt: string, spots: readonly TileSpotV1[], sources: readonly TileSourceV1[]): string {
  const body: TileBodyV1 = { schemaVersion: TILE_SCHEMA_VERSION, tile, revision, generatedAt, spots: [...spots], sources: [...sources] };
  return JSON.stringify(body);
}

/**
 * Splits one logical tile into bounded parts. `spots` must be sorted by id and `sources` must contain every source a
 * spot cites. Deterministic: identical input yields identical parts, hashes and manifest. Throws TileBudgetError when
 * a single spot or the manifest cannot fit, never drops a spot.
 */
export interface TileBudgets {
  maxPartSpots: number;
  maxBodyBytes: number;
}
export const TILE_BUDGETS: TileBudgets = { maxPartSpots: TILE_PART_MAX_SPOTS, maxBodyBytes: TILE_ROW_MAX_BODY_BYTES };

export async function partitionTile(
  tile: string, revision: number, generatedAt: string, spots: readonly TileSpotV1[], sources: readonly TileSourceV1[],
  budgets: TileBudgets = TILE_BUDGETS,
): Promise<PartitionedTile> {
  // Tests may tighten the budgets to hit exact boundaries; nothing may loosen them past the schema's limits.
  if (budgets.maxPartSpots > TILE_PART_MAX_SPOTS || budgets.maxBodyBytes > TILE_ROW_MAX_BODY_BYTES) {
    throw new TileBudgetError("tile budgets cannot exceed the stored-row limits");
  }
  for (let i = 1; i < spots.length; i++) {
    if (!(spots[i - 1].id < spots[i].id)) throw new TileBudgetError(`tile ${tile}: spots must be strictly ordered by id`);
  }
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const sourceBytes = new Map(sources.map((s) => [s.id, utf8(JSON.stringify(s))]));
  const empty = utf8(partBody(tile, revision, generatedAt, [], []));

  // Greedy, id-ordered packing against exact serialized size. Size of a part body = empty overhead + spots and their
  // separators + cited sources and their separators.
  const groups: TileSpotV1[][] = [];
  let current: TileSpotV1[] = [];
  let currentSources = new Set<string>();
  let spotBytes = 0, srcBytes = 0;
  const sizeWith = (spot: TileSpotV1, bytes: number) => {
    let addSrc = 0;
    const added = new Set<string>();
    for (const id of spot.sourceIds) {
      if (currentSources.has(id) || added.has(id)) continue;
      const b = sourceBytes.get(id);
      if (b === undefined) throw new TileBudgetError(`tile ${tile}: spot ${spot.id} cites source ${id}, which the tile does not carry`);
      added.add(id);
      addSrc += b + 1;
    }
    const nSpots = current.length + 1, nSources = currentSources.size + added.size;
    return empty + spotBytes + bytes + (nSpots - 1) + srcBytes + addSrc - (nSources > 0 ? 1 : 0);
  };
  for (const spot of spots) {
    const bytes = utf8(JSON.stringify(spot));
    if (current.length > 0 && (current.length + 1 > budgets.maxPartSpots || sizeWith(spot, bytes) > budgets.maxBodyBytes)) {
      groups.push(current);
      current = []; currentSources = new Set(); spotBytes = 0; srcBytes = 0;
    }
    if (sizeWith(spot, bytes) > budgets.maxBodyBytes) {
      throw new TileBudgetError(`tile ${tile}: spot ${spot.id} alone exceeds the ${budgets.maxBodyBytes}-byte part budget`);
    }
    for (const id of spot.sourceIds) if (!currentSources.has(id)) { currentSources.add(id); srcBytes += sourceBytes.get(id)! + 1; }
    current.push(spot); spotBytes += bytes;
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);

  const parts = [];
  for (const group of groups) {
    const cited = [...new Set(group.flatMap((s) => s.sourceIds))].sort().map((id) => sourceById.get(id)!);
    const body = partBody(tile, revision, generatedAt, group, cited);
    const byteLength = utf8(body);
    // The arithmetic above is an optimization; the serialized body is the authority.
    if (byteLength > budgets.maxBodyBytes || group.length > budgets.maxPartSpots) {
      throw new TileBudgetError(`tile ${tile}: part of ${group.length} spots is ${byteLength} bytes, over budget`);
    }
    parts.push({ body, sha256: await sha256Hex(body), spotCount: group.length, byteLength });
  }
  const logicalSha256 = await sha256Hex(logicalContent(spots, sources));
  if (parts.length === 1) return { parts: parts.map(({ byteLength: _, ...p }) => p), manifest: null, logicalSha256 };

  const manifest: TileManifestV1 = {
    manifestVersion: TILE_MANIFEST_VERSION, tile, revision, generatedAt, partSchemaVersion: TILE_PART_SCHEMA_VERSION,
    spotCount: spots.length, partCount: parts.length, logicalSha256,
    parts: parts.map((p, index) => ({ index, spotCount: p.spotCount, byteLength: p.byteLength, sha256: p.sha256 })),
  };
  const body = JSON.stringify(manifest);
  if (utf8(body) > budgets.maxBodyBytes) {
    throw new TileBudgetError(`tile ${tile}: ${parts.length} parts need a ${utf8(body)}-byte manifest, over the ${budgets.maxBodyBytes}-byte budget; `
      + "the tile is too dense for the current data zoom and budgets (no spot is dropped; review zoom/budgets)");
  }
  return { parts: parts.map(({ byteLength: _, ...p }) => p), manifest: { body, sha256: await sha256Hex(body) }, logicalSha256 };
}

/** The manifest a single-part tile is served with: one part, which is the stored v1 body. Deterministic. */
export function singlePartManifest(tile: string, revision: number, generatedAt: string, body: string, sha256: string, spotCount: number,
  logicalSha256: string): TileManifestV1 {
  return {
    manifestVersion: TILE_MANIFEST_VERSION, tile, revision, generatedAt, partSchemaVersion: TILE_PART_SCHEMA_VERSION,
    spotCount, partCount: 1, logicalSha256, parts: [{ index: 0, spotCount, byteLength: utf8(body), sha256 }],
  };
}

/** Strong ETags. Distinct prefixes keep the v1 body, manifest and part validators from ever colliding. */
export const manifestEtag = (headSha256: string) => `"m${TILE_MANIFEST_VERSION}-${headSha256}"`;
export const partEtag = (partSha256: string) => `"p${TILE_PART_SCHEMA_VERSION}-${partSha256}"`;
