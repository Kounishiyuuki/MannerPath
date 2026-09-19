// Public API v1 (docs/API.md). Only the tile read exists in this slice. The handler serves the stored
// snapshot body byte-for-byte; the ETag is derived from the stored hash, never recomputed here.

import { Hono } from "hono";
import { z } from "zod";
import { type Db } from "./db.ts";
import { DATA_TILE_ZOOM, formatTileId, parseTileId } from "./geo/tile.ts";
import { tileEtag } from "./tiles/dto.ts";

export interface Env {
  DB: Db;
}

const TileParams = z.object({ z: z.string(), x: z.string(), y: z.string() });

// Revalidate on every use: the ETag makes that a cheap 304 while guaranteeing a republished tile is seen.
const CACHE_CONTROL = "public, no-cache";

function problem(status: 400 | 404, code: string, detail: string) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** RFC 9110 §13.1.2: weak comparison, list of entity tags or "*". */
export function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => opaque(tag) === opaque(etag));
}

export const app = new Hono<{ Bindings: Env }>();

app.get("/v1/tiles/:z/:x/:y", async (c) => {
  const params = TileParams.parse(c.req.param());
  const tile = parseTileId(`${params.z}/${params.x}/${params.y}`);
  if (tile === null) return problem(400, "invalidTileId", "tile must be {z}/{x}/{y} in canonical decimal form and within range");
  if (tile.z !== DATA_TILE_ZOOM) return problem(400, "unsupportedZoom", `z must be ${DATA_TILE_ZOOM}`);

  const row = await c.env.DB.prepare(
    "SELECT schema_version, content_sha256, body_json FROM tile_snapshots WHERE tile_id = ?",
  ).bind(formatTileId(tile)).first<{ schema_version: number; content_sha256: string; body_json: string }>();
  if (row === null) return problem(404, "tileNotPublished", "no snapshot has been published for this tile");

  const etag = tileEtag(row.schema_version, row.content_sha256);
  const headers = { ETag: etag, "Cache-Control": CACHE_CONTROL };
  if (ifNoneMatchMatches(c.req.header("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(row.body_json, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
});

app.notFound(() => problem(404, "notFound", "no such endpoint"));
