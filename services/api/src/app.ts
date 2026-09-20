// Public API v1 (docs/API.md). Two reads exist in this slice. The tile handler serves the stored
// snapshot body byte-for-byte; the ETag is derived from the stored hash, never recomputed here.
// The spot detail handler builds its body from canonical rows, gated on published snapshot
// membership; it carries no ETag, because no stored hash describes that body.

import { Hono } from "hono";
import { z } from "zod";
import { type Db } from "./db.ts";
import { DATA_TILE_ZOOM, formatTileId, parseTileId } from "./geo/tile.ts";
import { SPOT_ID } from "./spot-id.ts";
import { readPublishedSpot } from "./spots/detail.ts";
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

app.get("/v1/spots/:id", async (c) => {
  const id = c.req.param("id");
  // A malformed, unknown, unpublished and blocked ID are all the same 404: publication membership
  // is the read gate, and the response must never reveal that an unpublished canonical row exists.
  const body = SPOT_ID.test(id) ? await readPublishedSpot(c.env.DB, id) : null;
  if (body === null) return problem(404, "spotNotFound", "no published spot with this id");
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": CACHE_CONTROL },
  });
});

app.notFound(() => problem(404, "notFound", "no such endpoint"));
