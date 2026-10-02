// Public API v1 (docs/API.md). Four reads and three writes exist in this slice. The config handler
// answers from the canonical constants alone and touches no database.
// The tile handler serves the stored snapshot body byte-for-byte; the ETag is derived from the stored hash, never recomputed here.
// The spot detail handler builds its body from canonical rows, gated on published snapshot
// membership; it carries no ETag, because no stored hash describes that body. The coverage-task handler (ADR-0013)
// derives gap tasks from published spots and the seed-area list only.
// The report write stores an immutable proposal and never touches canonical data (ADR-0007); the two
// App Attest writes (challenge issuance, key registration) exist only to authorize it (§6).
//
// Database ownership (ADR-0014). `DB` is the canonical DATA_DB, replaced on every blue/green cutover; the read
// routes use it and nothing else. `REPORTS_DB` is the durable report store that no cutover touches; the report and
// App Attest routes use it and nothing else. No request reads both, so a report never waits on, or depends on, the
// canonical database: its spotId is an opaque reference resolved only at review. A missing or failing REPORTS_DB
// fails the report routes closed (503 reportStoreUnavailable) and leaves the read routes serving.

import { Hono } from "hono";
import { z } from "zod";
import { configBody } from "./config/dto.ts";
import { COVERAGE_TASKS_SCHEMA_VERSION, CoverageTasksBodyV1 } from "./coverage/dto.ts";
import { SEED_AREAS_VERSION } from "./coverage/seed-areas.ts";
import { CoverageProbeOverflow, publishedGapTasks } from "./coverage/published-gaps.ts";
import { COVERAGE_TASKS_VERSION } from "./coverage/tasks.ts";
import { type Db, isoSeconds, sha256Hex } from "./db.ts";
import { DATA_TILE_ZOOM, formatTileId, parseTileId } from "./geo/tile.ts";
import { APPLE_APP_ATTEST_ROOT_DER } from "./attest/apple-root.ts";
import { base64Decode } from "./attest/bytes.ts";
import {
  type AppAttestContext, CHALLENGE_SCHEMA_VERSION, ChallengeRequestV1, KEY_REGISTRATION_MAX_BYTES,
  KEY_REGISTRATION_SCHEMA_VERSION, KeyRegistrationRequestV1, type Rejected, consumeReportChallenge, decode32,
  registerAppAttestKey, verifyReportAssertion,
} from "./attest/protocol.ts";
import { CHALLENGE_TTL_SECONDS, advanceCounterStatement, isCounterRace, issueChallenge, readKey } from "./attest/store.ts";
import { ATTESTATION_STATUS_V1, type AttestationConfig, attestationConfig } from "./reports/attestation.ts";
import { attestedSubmitter, createReport, submitterHash } from "./reports/create.ts";
import {
  ATTESTED_REPORT_SCHEMA_VERSION, REPORT_BODY_MAX_BYTES, REPORT_SCHEMA_VERSION, REPORT_SUBMISSION_MAX_BYTES,
  ReportPayloadV2, ReportRequestV1, ReportSubmissionV2, validationDetail,
} from "./reports/dto.ts";
import { consumeReportBudget } from "./reports/rate-limit.ts";
import { CURRENT_REPORT_TERMS } from "./reports/terms.ts";
import { SPOT_ID } from "./spot-id.ts";
import { readPublishedSpot } from "./spots/detail.ts";
import { TILE_SCHEMA_VERSION, TILE_SCHEMA_VERSION_V1, TileManifestV2, tileEtag } from "./tiles/dto.ts";
import { assembleTileV1 } from "./tiles/parts.ts";
import { promotionReadiness } from "./pipeline/promotion-readiness.ts";

export interface Env {
  /** The canonical DATA_DB (tiles, spots, provenance, publication). Swapped by blue/green cutover. */
  DB: Db;
  /** The durable report store (reports, moderation, App Attest, anti-abuse). Never swapped by a cutover (ADR-0014). */
  REPORTS_DB?: Db;
  /**
   * "disabled" or unset (the documented local/test default): report schema 1, unattested.
   * "required": report schema 2 only, App Attest verified — and only when the three bindings below are
   * valid too. Any other value is a misconfiguration and fails closed with 503, so a typo can never
   * silently disable attestation (ADR-0007 §6).
   */
  REPORT_ATTESTATION?: string;
  /** `<App ID prefix (usually the Team ID)>.<bundle identifier>`, the App Attest RP ID. Not committed. */
  REPORT_APP_ATTEST_APP_ID?: string;
  /** `development` or `production` — the App Attest aaguid this deployment accepts. */
  REPORT_APP_ATTEST_ENVIRONMENT?: string;
  /** Comma-separated exact CFBundleVersion values accepted in `apple_bundle_version_01`. Not committed. */
  REPORT_APP_ATTEST_BUNDLE_VERSIONS?: string;
  /** Pepper for the hashed report submitter key. No value is committed (ADR-0007 §5). */
  REPORT_SUBMITTER_PEPPER?: string;
}

const TileParams = z.object({ z: z.string(), x: z.string(), y: z.string() });

// Revalidate on every use: the ETag makes that a cheap 304 while guaranteeing a republished tile is seen.
const CACHE_CONTROL = "public, no-cache";

function problem(
  status: 400 | 403 | 404 | 409 | 413 | 429 | 503,
  code: string,
  detail: string,
  headers: Record<string, string> = {},
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ error: code, ...extra, detail }), {
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

const created = (body: unknown) => new Response(JSON.stringify(body), {
  status: 201,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

/** A definite App Attest refusal: nothing was stored and no counter moved (docs/API.md). */
const rejected = (r: Rejected) => problem(403, "attestationRejected", r.detail, {}, { reason: r.reason });

/** Reads a body of at most `max` bytes as JSON, or answers the 413/400 that ends the request. */
async function readJson(req: Request, max: number, tooLarge: string): Promise<{ ok: true; json: unknown } | { ok: false; response: Response }> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > max) {
    return { ok: false, response: problem(413, tooLarge, `request body must be at most ${max} bytes`) };
  }
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, response: problem(400, "invalidJson", "request body must be a JSON object") };
  }
}

export interface AppOptions {
  /**
   * The App Attest trust anchor (DER). Always the pinned Apple root in the Worker; only tests pass
   * another one, and no binding or header can change it.
   */
  appAttestTrustAnchor?: Uint8Array;
  /** Clock override for tests of expiry. */
  now?: () => Date;
}

export function createApp(options: AppOptions = {}) {
  const trustAnchor = options.appAttestTrustAnchor ?? APPLE_APP_ATTEST_ROOT_DER;
  const clock = options.now ?? (() => new Date());
  const app = new Hono<{ Bindings: Env }>();

  // GET /v1/config: the non-secret compatibility contract (docs/API.md). Every value is read from the
  // canonical constant the serving code uses, so it cannot drift from behaviour. It exposes no secret
  // and nothing per-caller; of the environment it reveals only whether reports are accepted, derived
  // from REPORT_ATTESTATION, never the configured value.
  app.get("/v1/config", (c) =>
    new Response(JSON.stringify(configBody(c.env, { reportStore: c.env.REPORTS_DB !== undefined })), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": CACHE_CONTROL },
    }));

  app.get("/v1/readiness", async (c) => {
    try {
      const body = await promotionReadiness(c.env.DB);
      return new Response(JSON.stringify(body), {
        status: body.completed ? 200 : 503,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    } catch {
      return problem(503, "promotionIncomplete", "promotion completion could not be verified");
    }
  });

  // Tiles (ADR-0005, ADR-0015). Every tile route takes a canonical tile ID at DATA_TILE_ZOOM.
  function requestedTileId(param: Record<string, string>): string | Response {
    const params = TileParams.parse(param);
    const tile = parseTileId(`${params.z}/${params.x}/${params.y}`);
    if (tile === null) return problem(400, "invalidTileId", "tile must be {z}/{x}/{y} in canonical decimal form and within range");
    if (tile.z !== DATA_TILE_ZOOM) return problem(400, "unsupportedZoom", `z must be ${DATA_TILE_ZOOM}`);
    return formatTileId(tile);
  }
  type SnapshotRow = { schema_version: number; content_sha256: string; body_json: string };
  const readSnapshot = (db: Db, tileId: string) => db.prepare(
    "SELECT schema_version, content_sha256, body_json FROM tile_snapshots WHERE tile_id = ?",
  ).bind(tileId).first<SnapshotRow>();
  function tileResponse(req: Request, body: string, etag: string): Response {
    const headers = { ETag: etag, "Cache-Control": CACHE_CONTROL };
    if (ifNoneMatchMatches(req.headers.get("If-None-Match") ?? undefined, etag)) return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  }

  // The v1 complete body, for clients that predate parts. A tile of more than one part is refused rather than
  // truncated: an older client replaces its cached tile with whatever it receives, so a partial body would delete spots.
  app.get("/v1/tiles/:z/:x/:y", async (c) => {
    const tileId = requestedTileId(c.req.param());
    if (typeof tileId !== "string") return tileId;
    const row = await readSnapshot(c.env.DB, tileId);
    if (row === null) return problem(404, "tileNotPublished", "no snapshot has been published for this tile");
    // A database migrated to 0028 but not yet republished still holds v1 bodies; serve them unchanged.
    if (row.schema_version === TILE_SCHEMA_VERSION_V1) return tileResponse(c.req.raw, row.body_json, tileEtag(row.schema_version, row.content_sha256));

    const manifest = TileManifestV2.parse(JSON.parse(row.body_json));
    if (manifest.parts.length > 1) {
      return problem(409, "tileRequiresParts", `this tile has ${manifest.parts.length} parts; read GET /v1/tiles/${tileId}/manifest`);
    }
    const { results: parts } = await c.env.DB.prepare(
      "SELECT body_json FROM tile_snapshot_parts WHERE tile_id = ? ORDER BY part_index",
    ).bind(tileId).all<{ body_json: string }>();
    const body = JSON.stringify(assembleTileV1(row.body_json, parts.map((p) => p.body_json)));
    return tileResponse(c.req.raw, body, tileEtag(TILE_SCHEMA_VERSION_V1, await sha256Hex(body)));
  });

  app.get("/v1/tiles/:z/:x/:y/manifest", async (c) => {
    const tileId = requestedTileId(c.req.param());
    if (typeof tileId !== "string") return tileId;
    const row = await readSnapshot(c.env.DB, tileId);
    if (row === null) return problem(404, "tileNotPublished", "no snapshot has been published for this tile");
    if (row.schema_version !== TILE_SCHEMA_VERSION) return problem(503, "tileRepublishPending", "this tile has not been republished as parts yet");
    return tileResponse(c.req.raw, row.body_json, tileEtag(row.schema_version, row.content_sha256));
  });

  app.get("/v1/tiles/:z/:x/:y/parts/:index", async (c) => {
    const tileId = requestedTileId(c.req.param());
    if (typeof tileId !== "string") return tileId;
    const index = c.req.param("index");
    if (!/^(0|[1-9][0-9]?)$/.test(index)) return problem(400, "invalidTilePart", "part must be a canonical decimal index");
    const row = await c.env.DB.prepare(
      "SELECT content_sha256, body_json FROM tile_snapshot_parts WHERE tile_id = ? AND part_index = ?",
    ).bind(tileId, Number(index)).first<{ content_sha256: string; body_json: string }>();
    if (row === null) return problem(404, "tilePartNotPublished", "this tile has no such part in its current snapshot");
    return tileResponse(c.req.raw, row.body_json, tileEtag(TILE_SCHEMA_VERSION, row.content_sha256));
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

  // GET /v1/coverage/tasks: public, read-only coverage-gap tasks (ADR-0013). Derived from the published corpus and
  // the seed-area list only — never from reports — so it carries no user-derived data while Issue #124 is open.
  app.get("/v1/coverage/tasks", async (c) => {
    let tasks;
    try { tasks = await publishedGapTasks(c.env.DB); }
    catch (error) {
      if (error instanceof CoverageProbeOverflow) return problem(503, "coverageTemporarilyUnavailable", "coverage spatial candidate budget exceeded; retry after operator review");
      throw error;
    }
    const body = CoverageTasksBodyV1.parse({
      schemaVersion: COVERAGE_TASKS_SCHEMA_VERSION, rules: COVERAGE_TASKS_VERSION, seedAreas: SEED_AREAS_VERSION,
      meaning: "information around this area is thin; this is not a claim that a smoking place exists",
      tasks,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": CACHE_CONTROL },
    });
  });

  // POST /v1/app-attest/challenges: a server-issued one-time challenge (ADR-0007 §6). Registration
  // challenges are capped deployment-wide and report challenges per registered key, each with a
  // single-statement count-and-insert, because issuing one writes a D1 row for an unauthenticated
  // caller.
  app.post("/v1/app-attest/challenges", (c) => withReportStore(c.env, (reports) => challenges(c.req.raw, c.env, reports)));

  async function challenges(req: Request, env: Env, reports: Db): Promise<Response> {
    const attestation = attestationConfig(env);
    if (attestation.kind !== "appAttest") return attestationUnavailable(attestation);
    const body = await readJson(req, 256, "requestTooLarge");
    if (!body.ok) return body.response;
    const parsed = ChallengeRequestV1.safeParse(body.json);
    if (!parsed.success) return problem(400, "invalidChallengeRequest", validationDetail(parsed.error));
    const request = parsed.data;

    const now = clock();
    if (request.purpose === "report") {
      if (decode32(request.keyId) === null) return problem(400, "invalidChallengeRequest", "keyId: invalid_format");
      if ((await readKey(reports, request.keyId)) === null) {
        return rejected({ ok: false, reason: "keyNotRegistered", detail: "no registered App Attest key with this keyId" });
      }
    }
    const issued = await issueChallenge(reports, request.purpose === "report" ? { purpose: "report", keyId: request.keyId } : { purpose: "registration" }, now);
    if (issued === null) {
      return problem(429, "challengeLimited", "too many outstanding challenges", { "Retry-After": String(CHALLENGE_TTL_SECONDS) });
    }
    return created({ schemaVersion: CHALLENGE_SCHEMA_VERSION, ...issued });
  }

  // POST /v1/app-attest/keys: initial App Attest key registration. The key is stored only after every
  // attestation check passed; the attestation object itself is never stored.
  app.post("/v1/app-attest/keys", (c) => withReportStore(c.env, (reports) => registerKey(c.req.raw, c.env, reports)));

  async function registerKey(req: Request, env: Env, reports: Db): Promise<Response> {
    const attestation = attestationConfig(env);
    if (attestation.kind !== "appAttest") return attestationUnavailable(attestation);
    const body = await readJson(req, KEY_REGISTRATION_MAX_BYTES, "requestTooLarge");
    if (!body.ok) return body.response;
    const parsed = KeyRegistrationRequestV1.safeParse(body.json);
    if (!parsed.success) return problem(400, "invalidKeyRegistration", validationDetail(parsed.error));

    const now = clock();
    const result = await registerAppAttestKey(context(reports, attestation, now), parsed.data);
    if (result.ok) return created({ schemaVersion: KEY_REGISTRATION_SCHEMA_VERSION, keyId: parsed.data.keyId, registeredAt: isoSeconds(now) });
    if (result.reason === "malformed") return problem(400, "invalidKeyRegistration", result.detail);
    if (result.reason === "alreadyRegistered") return problem(409, "keyAlreadyRegistered", "this App Attest key is already registered");
    return rejected(result as Rejected);
  }

  // POST /v1/reports: a user verification/correction report (ADR-0007). The report is stored as an
  // immutable proposal with a pending moderation state; it never mutates canonical spot data, and no
  // part of the payload is logged. Error details carry JSON paths and issue codes, never values.
  // A deployment accepts exactly one request version: 1 where attestation is disabled, 2 (App Attest
  // verified) where it is required.
  app.post("/v1/reports", (c) => withReportStore(c.env, (reports) => report(c.req.raw, c.env, reports)));

  async function report(req: Request, env: Env, reports: Db): Promise<Response> {
    // Configuration is checked before anything is read: a misconfigured policy must not accept a
    // single report.
    const attestation = attestationConfig(env);
    if (attestation.kind === "unsupported") return attestationUnavailable(attestation);

    const max = attestation.kind === "disabled" ? REPORT_BODY_MAX_BYTES : REPORT_SUBMISSION_MAX_BYTES;
    const body = await readJson(req, max, "reportTooLarge");
    if (!body.ok) return body.response;

    const expected = attestation.kind === "disabled" ? REPORT_SCHEMA_VERSION : ATTESTED_REPORT_SCHEMA_VERSION;
    const version = (body.json as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof version === "number" && version !== expected) {
      return problem(400, "reportSchemaUnsupported", `this deployment accepts report schemaVersion ${expected} only (see /v1/config)`);
    }
    return attestation.kind === "disabled"
      ? unattestedReport(env, reports, body.json)
      : attestedReport(env, reports, attestation, body.json);
  }

  async function unattestedReport(env: Env, reports: Db, json: unknown): Promise<Response> {
    const parsed = ReportRequestV1.safeParse(json);
    if (!parsed.success) return problem(400, "invalidReport", validationDetail(parsed.error));
    const request = parsed.data;

    const outdated = outdatedTerms(request.acceptedTermsVersion);
    if (outdated !== null) return outdated;

    const now = clock();
    const hash = await submitterHash(request.installId, env.REPORT_SUBMITTER_PEPPER);
    const limited = await rateLimited(reports, hash, now);
    if (limited !== null) return limited;

    return created(await createReport(reports, request, { now, attestationStatus: ATTESTATION_STATUS_V1, submitterHash: hash }));
  }

  async function attestedReport(env: Env, reports: Db, attestation: Extract<AttestationConfig, { kind: "appAttest" }>, json: unknown): Promise<Response> {
    const envelope = ReportSubmissionV2.safeParse(json);
    if (!envelope.success) return problem(400, "invalidReport", validationDetail(envelope.error));
    const { payload: payloadText, attestation: material } = envelope.data;
    if (decode32(material.keyId) === null || decode32(material.challenge) === null) {
      return problem(400, "invalidReport", "attestation.keyId and attestation.challenge must be 32 bytes of canonical base64");
    }

    const now = clock();
    const ctx = context(reports, attestation, now);
    // 1. Burn the challenge first: from here on, whatever fails, this challenge is spent.
    const burned = await consumeReportChallenge(ctx, material.challenge, material.keyId);
    if (burned !== null) return rejected(burned);

    // 2. The exact bytes the assertion must cover, then the report they contain.
    const payload = base64Decode(payloadText);
    if (payload === null) return problem(400, "invalidReport", "payload: invalid_base64");
    if (payload.length > REPORT_BODY_MAX_BYTES) return problem(413, "reportTooLarge", `payload must be at most ${REPORT_BODY_MAX_BYTES} bytes`);
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload));
    } catch {
      return problem(400, "invalidReport", "payload: invalid_json");
    }
    const report = ReportPayloadV2.safeParse(decoded);
    if (!report.success) return problem(400, "invalidReport", prefixed("payload", validationDetail(report.error)));

    // 3. Verify the assertion over those bytes. Pure: nothing is written.
    const verified = await verifyReportAssertion(ctx, material, payload);
    if (!verified.ok) return rejected(verified);
    const outdated = outdatedTerms(report.data.acceptedTermsVersion);
    if (outdated !== null) return outdated;

    // 4. Abuse boundary, then one batch: counter advance + report + moderation row. The trigger on
    // app_attest_keys aborts the batch if a concurrent request already advanced the counter.
    // The submitter is the verified App Attest key, not the payload's installId: the client chooses installId
    // freely, so one attested install could otherwise rotate it to escape the rate limit and to pass as several
    // "independent" submitters in community corroboration (Issue #150).
    const hash = await submitterHash(attestedSubmitter(material.keyId), env.REPORT_SUBMITTER_PEPPER);
    const limited = await rateLimited(reports, hash, now);
    if (limited !== null) return limited;
    try {
      return created(await createReport(reports, report.data, {
        now,
        attestationStatus: "verified",
        submitterHash: hash,
        guards: [advanceCounterStatement(reports, material.keyId, verified.counter)],
      }));
    } catch (e) {
      if (isCounterRace(e)) return rejected({ ok: false, reason: "counterNotIncreasing", detail: "counterNotIncreasing" });
      throw e;
    }
  }

  function context(db: Db, attestation: Extract<AttestationConfig, { kind: "appAttest" }>, now: Date): AppAttestContext {
    return { db, appId: attestation.appId, environment: attestation.environment, bundleVersions: attestation.bundleVersions, trustAnchor, now };
  }

  app.notFound(() => problem(404, "notFound", "no such endpoint"));
  return app;
}

/**
 * Runs a report-store route against REPORTS_DB, or fails it closed. Without the binding nothing is accepted, and a
 * store error answers 503 (the client keeps its report and retries) instead of falling back anywhere: a report is
 * never written to the canonical DB, whatever happens. Every report write is one batch, so a failure stores no report.
 */
async function withReportStore(env: Env, route: (reports: Db) => Promise<Response>): Promise<Response> {
  if (env.REPORTS_DB === undefined) return reportStoreUnavailable();
  try {
    return await route(env.REPORTS_DB);
  } catch {
    return reportStoreUnavailable();
  }
}

const reportStoreUnavailable = () =>
  problem(503, "reportStoreUnavailable", "the report store is unavailable; retry later", { "Retry-After": "60" });

function attestationUnavailable(attestation: AttestationConfig): Response {
  const detail = attestation.kind === "unsupported" ? attestation.detail : "App Attest is not enabled on this deployment (see /v1/config)";
  return problem(503, "attestationUnavailable", detail);
}

/**
 * A report may name only the terms version this deployment currently shows (/v1/config). An older or unknown one
 * means the client displayed a different document, so the consent it carries is not the one we would record.
 */
function outdatedTerms(accepted: string | undefined): Response | null {
  if (accepted === undefined || accepted === CURRENT_REPORT_TERMS.version) return null;
  return problem(409, "termsVersionOutdated", `this deployment records consent to terms version ${CURRENT_REPORT_TERMS.version} only (see /v1/config)`);
}

async function rateLimited(db: Db, hash: string, now: Date): Promise<Response | null> {
  const budget = await consumeReportBudget(db, hash, now);
  if (budget.allowed) return null;
  return problem(429, "reportRateLimited", "too many reports from this install", { "Retry-After": String(budget.retryAfterSeconds) });
}

const prefixed = (prefix: string, detail: string) => detail.split("; ").map((d) => `${prefix}.${d}`).join("; ");

/** The Worker's app: the pinned Apple root and the real clock. */
export const app = createApp();
