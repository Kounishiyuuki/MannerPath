// Public API v1 (docs/API.md). Three reads and three writes exist in this slice. The config handler
// answers from the canonical constants alone and touches no database.
// The tile handler serves the stored snapshot body byte-for-byte; the ETag is derived from the stored hash, never recomputed here.
// The spot detail handler builds its body from canonical rows, gated on published snapshot
// membership; it carries no ETag, because no stored hash describes that body.
// The report write stores an immutable proposal and never touches canonical data (ADR-0007); the two
// App Attest writes (challenge issuance, key registration) exist only to authorize it (§6).

import { Hono } from "hono";
import { z } from "zod";
import { configBody } from "./config/dto.ts";
import { type Db, isoSeconds } from "./db.ts";
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
import { createReport, submitterHash } from "./reports/create.ts";
import {
  ATTESTED_REPORT_SCHEMA_VERSION, REPORT_BODY_MAX_BYTES, REPORT_SCHEMA_VERSION, REPORT_SUBMISSION_MAX_BYTES,
  ReportPayloadV2, ReportRequestV1, ReportSubmissionV2, validationDetail,
} from "./reports/dto.ts";
import { consumeReportBudget } from "./reports/rate-limit.ts";
import { SPOT_ID } from "./spot-id.ts";
import { readPublishedSpot } from "./spots/detail.ts";
import { tileEtag } from "./tiles/dto.ts";

export interface Env {
  DB: Db;
  /**
   * "disabled" or unset (the documented local/test default): report schema 1, unattested.
   * "required": report schema 2 only, App Attest verified — and only when the two bindings below are
   * valid too. Any other value is a misconfiguration and fails closed with 503, so a typo can never
   * silently disable attestation (ADR-0007 §6).
   */
  REPORT_ATTESTATION?: string;
  /** `<Team ID>.<bundle identifier>`, the App Attest RP ID. Deployment configuration, not committed. */
  REPORT_APP_ATTEST_APP_ID?: string;
  /** `development` or `production` — the App Attest aaguid this deployment accepts. */
  REPORT_APP_ATTEST_ENVIRONMENT?: string;
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
    new Response(JSON.stringify(configBody(c.env)), {
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

  // POST /v1/app-attest/challenges: a server-issued one-time challenge (ADR-0007 §6). Registration
  // challenges are capped deployment-wide and report challenges per registered key, each with a
  // single-statement count-and-insert, because issuing one writes a D1 row for an unauthenticated
  // caller.
  app.post("/v1/app-attest/challenges", async (c) => {
    const attestation = attestationConfig(c.env);
    if (attestation.kind !== "appAttest") return attestationUnavailable(attestation);
    const body = await readJson(c.req.raw, 256, "requestTooLarge");
    if (!body.ok) return body.response;
    const parsed = ChallengeRequestV1.safeParse(body.json);
    if (!parsed.success) return problem(400, "invalidChallengeRequest", validationDetail(parsed.error));
    const request = parsed.data;

    const now = clock();
    if (request.purpose === "report") {
      if (decode32(request.keyId) === null) return problem(400, "invalidChallengeRequest", "keyId: invalid_format");
      if ((await readKey(c.env.DB, request.keyId)) === null) {
        return rejected({ ok: false, reason: "keyNotRegistered", detail: "no registered App Attest key with this keyId" });
      }
    }
    const issued = await issueChallenge(c.env.DB, request.purpose === "report" ? { purpose: "report", keyId: request.keyId } : { purpose: "registration" }, now);
    if (issued === null) {
      return problem(429, "challengeLimited", "too many outstanding challenges", { "Retry-After": String(CHALLENGE_TTL_SECONDS) });
    }
    return created({ schemaVersion: CHALLENGE_SCHEMA_VERSION, ...issued });
  });

  // POST /v1/app-attest/keys: initial App Attest key registration. The key is stored only after every
  // attestation check passed; the attestation object itself is never stored.
  app.post("/v1/app-attest/keys", async (c) => {
    const attestation = attestationConfig(c.env);
    if (attestation.kind !== "appAttest") return attestationUnavailable(attestation);
    const body = await readJson(c.req.raw, KEY_REGISTRATION_MAX_BYTES, "requestTooLarge");
    if (!body.ok) return body.response;
    const parsed = KeyRegistrationRequestV1.safeParse(body.json);
    if (!parsed.success) return problem(400, "invalidKeyRegistration", validationDetail(parsed.error));

    const now = clock();
    const result = await registerAppAttestKey(context(c.env.DB, attestation, now), parsed.data);
    if (result.ok) return created({ schemaVersion: KEY_REGISTRATION_SCHEMA_VERSION, keyId: parsed.data.keyId, registeredAt: isoSeconds(now) });
    if (result.reason === "malformed") return problem(400, "invalidKeyRegistration", result.detail);
    if (result.reason === "alreadyRegistered") return problem(409, "keyAlreadyRegistered", "this App Attest key is already registered");
    return rejected(result as Rejected);
  });

  // POST /v1/reports: a user verification/correction report (ADR-0007). The report is stored as an
  // immutable proposal with a pending moderation state; it never mutates canonical spot data, and no
  // part of the payload is logged. Error details carry JSON paths and issue codes, never values.
  // A deployment accepts exactly one request version: 1 where attestation is disabled, 2 (App Attest
  // verified) where it is required.
  app.post("/v1/reports", async (c) => {
    // Configuration is checked before anything is read: a misconfigured policy must not accept a
    // single report.
    const attestation = attestationConfig(c.env);
    if (attestation.kind === "unsupported") return attestationUnavailable(attestation);

    const max = attestation.kind === "disabled" ? REPORT_BODY_MAX_BYTES : REPORT_SUBMISSION_MAX_BYTES;
    const body = await readJson(c.req.raw, max, "reportTooLarge");
    if (!body.ok) return body.response;

    const expected = attestation.kind === "disabled" ? REPORT_SCHEMA_VERSION : ATTESTED_REPORT_SCHEMA_VERSION;
    const version = (body.json as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof version === "number" && version !== expected) {
      return problem(400, "reportSchemaUnsupported", `this deployment accepts report schemaVersion ${expected} only (see /v1/config)`);
    }
    return attestation.kind === "disabled"
      ? unattestedReport(c.env, body.json)
      : attestedReport(c.env, attestation, body.json);
  });

  async function unattestedReport(env: Env, json: unknown): Promise<Response> {
    const parsed = ReportRequestV1.safeParse(json);
    if (!parsed.success) return problem(400, "invalidReport", validationDetail(parsed.error));
    const request = parsed.data;

    const now = clock();
    const hash = await submitterHash(request.installId, env.REPORT_SUBMITTER_PEPPER);
    const limited = await rateLimited(env.DB, hash, now);
    if (limited !== null) return limited;

    return created(await createReport(env.DB, request, { now, attestationStatus: ATTESTATION_STATUS_V1, submitterHash: hash }));
  }

  async function attestedReport(env: Env, attestation: Extract<AttestationConfig, { kind: "appAttest" }>, json: unknown): Promise<Response> {
    const envelope = ReportSubmissionV2.safeParse(json);
    if (!envelope.success) return problem(400, "invalidReport", validationDetail(envelope.error));
    const { payload: payloadText, attestation: material } = envelope.data;
    if (decode32(material.keyId) === null || decode32(material.challenge) === null) {
      return problem(400, "invalidReport", "attestation.keyId and attestation.challenge must be 32 bytes of canonical base64");
    }

    const now = clock();
    const ctx = context(env.DB, attestation, now);
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

    // 4. Abuse boundary, then one batch: counter advance + report + moderation row. The trigger on
    // app_attest_keys aborts the batch if a concurrent request already advanced the counter.
    const hash = await submitterHash(report.data.installId, env.REPORT_SUBMITTER_PEPPER);
    const limited = await rateLimited(env.DB, hash, now);
    if (limited !== null) return limited;
    try {
      return created(await createReport(env.DB, report.data, {
        now,
        attestationStatus: "verified",
        submitterHash: hash,
        guards: [advanceCounterStatement(env.DB, material.keyId, verified.counter)],
      }));
    } catch (e) {
      if (isCounterRace(e)) return rejected({ ok: false, reason: "counterNotIncreasing", detail: "counterNotIncreasing" });
      throw e;
    }
  }

  function context(db: Db, attestation: Extract<AttestationConfig, { kind: "appAttest" }>, now: Date): AppAttestContext {
    return { db, appId: attestation.appId, environment: attestation.environment, trustAnchor, now };
  }

  app.notFound(() => problem(404, "notFound", "no such endpoint"));
  return app;
}

function attestationUnavailable(attestation: AttestationConfig): Response {
  const detail = attestation.kind === "unsupported" ? attestation.detail : "App Attest is not enabled on this deployment (see /v1/config)";
  return problem(503, "attestationUnavailable", detail);
}

async function rateLimited(db: Db, hash: string, now: Date): Promise<Response | null> {
  const budget = await consumeReportBudget(db, hash, now);
  if (budget.allowed) return null;
  return problem(429, "reportRateLimited", "too many reports from this install", { "Retry-After": String(budget.retryAfterSeconds) });
}

const prefixed = (prefix: string, detail: string) => detail.split("; ").map((d) => `${prefix}.${d}`).join("; ");

/** The Worker's app: the pinned Apple root and the real clock. */
export const app = createApp();
