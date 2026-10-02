// Reads published tiles as LOGICAL tiles (Issue #158): a single-part head is its own v1 body; a multipart head's
// parts are verified against its manifest and assembled. Used by offline analysis (quality, scale), never by the
// request path, which serves heads and parts as stored. Throws on any inconsistency rather than returning a partial
// logical tile.

import { type Db, sha256Hex } from "../db.ts";
import { TILE_SCHEMA_VERSION, TileBodyV1, type TileSourceV1, type TileSpotV1 } from "./dto.ts";
import { TILE_MANIFEST_SCHEMA_VERSION, type TileManifestV1, logicalContent } from "./parts.ts";

export interface LogicalTile {
  tileId: string;
  z: number;
  x: number;
  y: number;
  revision: number;
  schemaVersion: number;
  spotCount: number;
  publishedAt: string;
  /** The complete logical body (spots in id order, sources in id order), exactly as a single-part body would be. */
  body: TileBodyV1;
  /** The stored physical bodies, in part order (one for a single-part tile). */
  physical: string[];
}

export async function readLogicalTiles(db: Db): Promise<LogicalTile[]> {
  const { results: heads } = await db.prepare(
    "SELECT tile_id, z, x, y, revision, schema_version, content_sha256, spot_count, body_json, published_at FROM tile_snapshots ORDER BY tile_id",
  ).all<{ tile_id: string; z: number; x: number; y: number; revision: number; schema_version: number; content_sha256: string;
    spot_count: number; body_json: string; published_at: string }>();
  const { results: parts } = await db.prepare(
    "SELECT tile_id, part_index, revision, content_sha256, spot_count, body_json FROM tile_snapshot_parts ORDER BY tile_id, part_index",
  ).all<{ tile_id: string; part_index: number; revision: number; content_sha256: string; spot_count: number; body_json: string }>();
  const partsOf = new Map<string, typeof parts>();
  for (const p of parts) (partsOf.get(p.tile_id) ?? partsOf.set(p.tile_id, []).get(p.tile_id)!).push(p);

  const out: LogicalTile[] = [];
  for (const h of heads) {
    const common = { tileId: h.tile_id, z: h.z, x: h.x, y: h.y, revision: h.revision, schemaVersion: h.schema_version,
      spotCount: h.spot_count, publishedAt: h.published_at };
    if (h.schema_version === TILE_SCHEMA_VERSION) {
      if (partsOf.has(h.tile_id)) throw new Error(`tile ${h.tile_id}: a single-part head has stored parts`);
      out.push({ ...common, body: TileBodyV1.parse(JSON.parse(h.body_json)), physical: [h.body_json] });
      continue;
    }
    if (h.schema_version !== TILE_MANIFEST_SCHEMA_VERSION) throw new Error(`tile ${h.tile_id}: unknown head schema ${h.schema_version}`);
    const manifest = JSON.parse(h.body_json) as TileManifestV1;
    const stored = partsOf.get(h.tile_id) ?? [];
    if (manifest.tile !== h.tile_id || manifest.revision !== h.revision || manifest.partCount !== stored.length
      || manifest.parts.length !== stored.length) {
      throw new Error(`tile ${h.tile_id}: manifest does not describe its ${stored.length} stored parts`);
    }
    const spots: TileSpotV1[] = [];
    const sources = new Map<string, TileSourceV1>();
    for (const [i, p] of stored.entries()) {
      const entry = manifest.parts[i];
      if (p.part_index !== i || entry.index !== i || p.revision !== h.revision || entry.sha256 !== p.content_sha256
        || await sha256Hex(p.body_json) !== p.content_sha256 || entry.spotCount !== p.spot_count) {
        throw new Error(`tile ${h.tile_id}: part ${i} does not match its manifest entry`);
      }
      const body = TileBodyV1.parse(JSON.parse(p.body_json));
      if (body.tile !== h.tile_id || body.revision !== h.revision) throw new Error(`tile ${h.tile_id}: part ${i} names another tile or revision`);
      spots.push(...body.spots);
      for (const s of body.sources) sources.set(s.id, s);
    }
    for (let i = 1; i < spots.length; i++) {
      if (!(spots[i - 1].id < spots[i].id)) throw new Error(`tile ${h.tile_id}: parts overlap or are out of order`);
    }
    const logicalSources = [...sources.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (spots.length !== manifest.spotCount || spots.length !== h.spot_count
      || await sha256Hex(logicalContent(spots, logicalSources)) !== manifest.logicalSha256) {
      throw new Error(`tile ${h.tile_id}: assembled parts do not reproduce the manifest's logical content`);
    }
    out.push({ ...common, physical: stored.map((p) => p.body_json),
      body: { schemaVersion: TILE_SCHEMA_VERSION, tile: h.tile_id, revision: h.revision, generatedAt: manifest.generatedAt, spots, sources: logicalSources } });
  }
  return out;
}
