// ADR-0015: tile_snapshots.body_json is a manifest; a test that inspects a whole tile reads it assembled from its
// parts, exactly as a v1 client receives it. content_sha256 and revision stay the manifest row's.
import { type DatabaseSync } from "node:sqlite";
import { assembleTileV1 } from "../../src/tiles/parts.ts";

export interface V1TileRow { tile_id: string; revision: number; content_sha256: string; spot_count: number; body_json: string }

export function v1TileRows(db: DatabaseSync | { raw: DatabaseSync }): V1TileRow[] {
  const raw = "raw" in db ? db.raw : db;
  const parts = new Map<string, string[]>();
  for (const p of raw.prepare("SELECT tile_id, body_json FROM tile_snapshot_parts ORDER BY tile_id, part_index").all() as { tile_id: string; body_json: string }[]) {
    parts.set(p.tile_id, [...(parts.get(p.tile_id) ?? []), p.body_json]);
  }
  return (raw.prepare("SELECT tile_id, revision, content_sha256, spot_count, body_json FROM tile_snapshots ORDER BY tile_id").all() as unknown as V1TileRow[])
    .map((t) => ({ ...t, body_json: JSON.stringify(assembleTileV1(t.body_json, parts.get(t.tile_id) ?? [])) }));
}

export const v1TileBody = (db: DatabaseSync | { raw: DatabaseSync }, tileId: string) =>
  v1TileRows(db).find((t) => t.tile_id === tileId)?.body_json;
