// Every unauthenticated GET route of the read Worker, fetched exactly as a client would (docs/PRIVACY_BOUNDARY.md).
// A privacy test asserts that none of the collected texts names a private value; the needles must be specific values
// (IDs, hashes, keys, the private note), never generic words such as "photo" that a public config legitimately uses.
import assert from "node:assert/strict";
import { app } from "../../src/app.ts";
import type { SqliteD1 } from "./sqlite-d1.ts";

/** Path → status, headers and body of every public read route over `db`, for every published tile and the given spots. */
export async function publicSurface(db: SqliteD1, spotIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const get = async (path: string) => {
    const res = await app.request(path, {}, { DB: db });
    out.set(path, `${res.status} ${JSON.stringify([...res.headers])}\n${await res.text()}`);
  };
  for (const path of ["/v1/config", "/v1/readiness", "/v1/coverage/tasks"]) await get(path);
  const tiles = db.raw.prepare("SELECT tile_id FROM tile_snapshots ORDER BY tile_id").all() as { tile_id: string }[];
  for (const { tile_id } of tiles) {
    await get(`/v1/tiles/${tile_id}`);
    await get(`/v1/tiles/${tile_id}/manifest`);
    const parts = db.raw.prepare("SELECT part_index FROM tile_snapshot_parts WHERE tile_id = ? ORDER BY part_index").all(tile_id) as { part_index: number }[];
    for (const { part_index } of parts) await get(`/v1/tiles/${tile_id}/parts/${part_index}`);
  }
  for (const id of spotIds) await get(`/v1/spots/${id}`);
  return out;
}

export function assertNothingPrivate(surface: Map<string, string>, needles: readonly string[], label: string) {
  assert.ok(surface.size > 3, `${label}: no public route was read`);
  for (const needle of needles) {
    assert.ok(needle.length >= 8, `${label}: needle ${JSON.stringify(needle)} is too generic to prove anything`);
    for (const [path, text] of surface) assert.equal(text.includes(needle), false, `${label}: ${path} carries ${needle}`);
  }
}
