// Public API v1 (docs/API.md). Three reads and one write exist in this slice. The config handler
// answers from the canonical constants alone and touches no database.
// The tile handler serves the stored snapshot body byte-for-byte; the ETag is derived from the stored hash, never recomputed here.
// The spot detail handler builds its body from canonical rows, gated on published snapshot
// membership; it carries no ETag, because no stored hash describes that body.
// The report write stores an immutable proposal and never touches canonical data (ADR-0007).

import { Hono } from "hono";
import { z } from "zod";
import { configBody } from "./config/dto.ts";
import { type Db } from "./db.ts";
import { DATA_TILE_ZOOM, formatTileId, parseTileId } from "./geo/tile.ts";
import { ATTESTATION_STATUS_V1, attestationConfig } from "./reports/attestation.ts";
import { createReport, submitterHash } from "./reports/create.ts";
import { REPORT_BODY_MAX_BYTES, ReportRequestV1, validationDetail } from "./reports/dto.ts";
import { consumeReportBudget } from "./reports/rate-limit.ts";
import { SPOT_ID } from "./spot-id.ts";
import { readPublishedSpot } from "./spots/detail.ts";
import { tileEtag } from "./tiles/dto.ts";

export interface Env {
  DB: Db;
  /**
   * "disabled" or unset (the documented local/test default). "required" is accepted as intent but
   * unsupported while App Attest is deferred, and any other value is a misconfiguration; both fail
   * closed with 503 so a typo can never silently disable attestation (ADR-0007 §6).
   */
  REPORT_ATTESTATION?: string;
  /** Pepper for the hashed report submitter key. No value is committed (ADR-0007 §5). */
  REPORT_SUBMITTER_PEPPER?: string;
}

const TileParams = z.object({ z: z.string(), x: z.string(), y: z.string() });

// Revalidate on every use: the ETag makes that a cheap 304 while guaranteeing a republished tile is seen.
const CACHE_CONTROL = "public, no-cache";

function problem(status: 400 | 404 | 413 | 429 | 503, code: string, detail: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
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

// GET /v1/config: the non-secret compatibility contract (docs/API.md). Every value is read from the
// canonical constant the serving code uses, so it cannot drift from behaviour. It exposes no secret
// and nothing per-caller; of the environment it reveals only whether reports are accepted, derived
// from REPORT_ATTESTATION, never the configured value.
app.get("/v1/config", (c) =>
  new Response(JSON.stringify(configBody(c.env.REPORT_ATTESTATION)), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": CACHE_CONTROL },
  }));

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

// POST /v1/reports: a user verification/correction report (ADR-0007). The report is stored as an
// immutable proposal with a pending moderation state; it never mutates canonical spot data, and no
// part of the payload is logged. Error details carry JSON paths and issue codes, never values.
app.post("/v1/reports", async (c) => {
  // Configuration is checked before anything is read: an enforcing or misspelled policy must not
  // accept a single report while the attestation protocol is missing.
  const attestation = attestationConfig(c.env.REPORT_ATTESTATION);
  if (attestation.kind === "unsupported") return problem(503, "attestationUnavailable", attestation.detail);

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > REPORT_BODY_MAX_BYTES) {
    return problem(413, "reportTooLarge", `report body must be at most ${REPORT_BODY_MAX_BYTES} bytes`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return problem(400, "invalidJson", "request body must be a JSON object");
  }

  const parsed = ReportRequestV1.safeParse(json);
  if (!parsed.success) return problem(400, "invalidReport", validationDetail(parsed.error));
  const request = parsed.data;

  const now = new Date();
  const hash = await submitterHash(request.installId, c.env.REPORT_SUBMITTER_PEPPER);
  const budget = await consumeReportBudget(c.env.DB, hash, now);
  if (!budget.allowed) {
    return problem(429, "reportRateLimited", "too many reports from this install", {
      "Retry-After": String(budget.retryAfterSeconds),
    });
  }

  const body = await createReport(c.env.DB, request, {
    now,
    attestationStatus: ATTESTATION_STATUS_V1,
    submitterHash: hash,
  });
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
});

app.notFound(() => problem(404, "notFound", "no such endpoint"));
