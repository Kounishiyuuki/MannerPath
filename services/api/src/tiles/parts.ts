// Bounded tile parts (ADR-0015). A tile's complete snapshot is split into parts so that no response body and no
// D1 row grows with spot density: zoom cannot do that alone, because a dense block (a station plaza, an arcade)
// stays inside one tile at any useful zoom. The split is a pure function of the tile's content, so equal content
// always yields byte-identical parts and hashes — the property ETags, the manifest and promotion rely on.

import { type Db, type DbStatement, sha256Hex } from "../db.ts";
import { TILE_SCHEMA_VERSION, TileBodyV1, TileManifestV2, TilePartBodyV2, TILE_SCHEMA_VERSION_V1, type TileSourceV1, type TileSpotV1 } from "./dto.ts";

/**
 * Versioned part budget (ADR-0015 records the measurements). maxSpots keeps the ADR-0005 per-response spot budget:
 * 250 real spots are ~200 KB raw / ~11 KB gzip. maxRawBytes bounds every stored part row and response body, 8x
 * under the D1 2 MB row limit, so that the spot count binds for ordinary DTOs and bytes bind only for outliers
 * (it is restated by migration 0028). maxGzipBytes keeps the ADR-0005 transfer budget and is enforced by the
 * publication quality gate, not by the split: gzip output differs between zlib builds, and the split must not.
 * maxParts bounds the manifest row and the requests one tile can cost a client.
 */
export const TILE_PART_POLICY = {
  version: "tile-parts.v1",
  maxSpots: 250,
  maxRawBytes: 256 * 1024,
  maxGzipBytes: 16 * 1024,
  maxParts: 64,
} as const;

/** A manifest lists at most maxParts entries of ~90 bytes; this bounds its D1 row with room to spare. */
export const TILE_MANIFEST_MAX_BYTES = 8 * 1024;

export class TileBudgetExceeded extends Error {}

export interface BuiltPart {
  index: number;
  bodyJson: string;
  sha256: string;
  spotCount: number;
  rawBytes: number;
}

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

/**
 * Splits a tile's spots (sorted by id) into parts in that order: a part closes when one more spot would exceed
 * maxSpots or maxRawBytes. Each part lists only the sources its spots cite. Throws TileBudgetExceeded when a single
 * spot cannot fit a part or the tile needs more than maxParts — publication must stop, not emit an oversized tile.
 */
export async function splitTileParts(tileId: string, spots: readonly TileSpotV1[], sourcesById: ReadonlyMap<string, TileSourceV1>,
  policy: typeof TILE_PART_POLICY = TILE_PART_POLICY): Promise<BuiltPart[]> {
  const groups: TileSpotV1[][] = [];
  let current: TileSpotV1[] = [];
  let currentSources = new Set<string>();
  // Exact size of the part body being built, excluding the two part numbers (at most 2 digits each with maxParts 64,
  // counted with a 0 placeholder, so 2 bytes are reserved): envelope with empty spots + each spot + separators.
  let envelope = 0, spotBytes = 0;
  const envelopeFor = (ids: Set<string>) => bytes(JSON.stringify(partBody(tileId, 0, 0, [], [...ids].sort().map((id) => sourcesById.get(id)!))));
  const reserve = String(policy.maxParts - 1).length * 2 - 2;
  for (const spot of spots) {
    const len = bytes(JSON.stringify(spot));
    const ids = new Set([...currentSources, ...spot.sourceIds]);
    const nextEnvelope = ids.size === currentSources.size ? envelope : envelopeFor(ids);
    const nextSize = nextEnvelope + spotBytes + len + current.length + reserve;
    if (current.length > 0 && (current.length >= policy.maxSpots || nextSize > policy.maxRawBytes)) {
      groups.push(current);
      current = []; currentSources = new Set(); spotBytes = 0;
      envelope = envelopeFor(new Set(spot.sourceIds));
      currentSources = new Set(spot.sourceIds);
    } else {
      envelope = nextEnvelope; currentSources = ids;
    }
    current.push(spot); spotBytes += len;
  }
  if (current.length > 0) groups.push(current);
  if (groups.length > policy.maxParts) {
    throw new TileBudgetExceeded(`tile ${tileId}: ${spots.length} spots need ${groups.length} parts, above ${policy.version} maxParts ${policy.maxParts}`);
  }

  const parts: BuiltPart[] = [];
  for (const [index, group] of groups.entries()) {
    const sourceIds = [...new Set(group.flatMap((s) => s.sourceIds))].sort();
    const body = partBody(tileId, index, groups.length, group, sourceIds.map((id) => sourcesById.get(id)!));
    TilePartBodyV2.parse(body);
    const bodyJson = JSON.stringify(body);
    const rawBytes = bytes(bodyJson);
    if (rawBytes > policy.maxRawBytes || group.length > policy.maxSpots) {
      throw new TileBudgetExceeded(`tile ${tileId} part ${index}: ${group.length} spots / ${rawBytes} bytes exceed ${policy.version} (${policy.maxSpots} spots / ${policy.maxRawBytes} bytes)`);
    }
    parts.push({ index, bodyJson, sha256: await sha256Hex(bodyJson), spotCount: group.length, rawBytes });
  }
  return parts;
}

// Fixed key order: the literal is the serialisation contract.
function partBody(tile: string, part: number, partCount: number, spots: TileSpotV1[], sources: TileSourceV1[]): TilePartBodyV2 {
  return { schemaVersion: TILE_SCHEMA_VERSION, tile, part, partCount, spots, sources };
}

export function manifestBody(tile: string, revision: number, generatedAt: string, parts: readonly BuiltPart[]): TileManifestV2 {
  const body: TileManifestV2 = {
    schemaVersion: TILE_SCHEMA_VERSION, tile, revision, generatedAt, partPolicy: TILE_PART_POLICY.version,
    spotCount: parts.reduce((n, p) => n + p.spotCount, 0),
    parts: parts.map((p) => ({ index: p.index, spotCount: p.spotCount, sha256: p.sha256 })),
  };
  return TileManifestV2.parse(body);
}

/**
 * The complete v1 body of a tile, assembled from its manifest and part bodies. Served at the v1 path only for a tile
 * of at most one part (an older client must never receive a partial snapshot), and used wherever a whole tile is read.
 * Sources are merged and re-sorted, so the result equals what publishTiles wrote as one v1 body before ADR-0015.
 */
export function assembleTileV1(manifestJson: string, partJsons: readonly string[]): TileBodyV1 {
  const manifest = TileManifestV2.parse(JSON.parse(manifestJson));
  if (partJsons.length !== manifest.parts.length) throw new Error(`tile ${manifest.tile}: ${partJsons.length} part rows for ${manifest.parts.length} manifest parts`);
  const parts = partJsons.map((j) => JSON.parse(j) as TilePartBodyV2);
  parts.forEach((p, i) => { TilePartBodyV2.parse(p); if (p.tile !== manifest.tile || p.part !== i) throw new Error(`tile ${manifest.tile}: part row ${i} is ${p.tile} part ${p.part}`); });
  const spots = parts.flatMap((p) => p.spots);
  const sources = [...new Map(parts.flatMap((p) => p.sources).map((s) => [s.id, s])).values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Validated, but the literal is returned: its key order is the serialisation contract, not the schema's.
  const body: TileBodyV1 = { schemaVersion: TILE_SCHEMA_VERSION_V1, tile: manifest.tile, revision: manifest.revision,
    generatedAt: manifest.generatedAt, spots, sources };
  TileBodyV1.parse(body);
  return body;
}

/**
 * Every published tile as its complete v1 body, in tile order — the corpus a client sees. Reads the stored v1 body
 * of a tile not yet republished as parts. Tooling and tests read tiles through this, never tile_snapshots.body_json.
 */
export async function readPublishedTiles(db: Db, tileId?: string): Promise<TileBodyV1[]> {
  const filter = tileId === undefined ? "" : " WHERE tile_id = ?";
  const bind = <T extends DbStatement>(s: T) => (tileId === undefined ? s : s.bind(tileId));
  const { results: tiles } = await bind(db.prepare(`SELECT tile_id, schema_version, body_json FROM tile_snapshots${filter} ORDER BY tile_id`))
    .all<{ tile_id: string; schema_version: number; body_json: string }>();
  const { results: parts } = await bind(db.prepare(`SELECT tile_id, body_json FROM tile_snapshot_parts${filter} ORDER BY tile_id, part_index`))
    .all<{ tile_id: string; body_json: string }>();
  const partsByTile = new Map<string, string[]>();
  for (const p of parts) partsByTile.set(p.tile_id, [...(partsByTile.get(p.tile_id) ?? []), p.body_json]);
  return tiles.map((t) => (t.schema_version === TILE_SCHEMA_VERSION_V1
    ? TileBodyV1.parse(JSON.parse(t.body_json))
    : assembleTileV1(t.body_json, partsByTile.get(t.tile_id) ?? [])));
}
