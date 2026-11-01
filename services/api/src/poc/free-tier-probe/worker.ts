// FREE-TIER PROBE — a separate, disposable Worker for measuring configuration 3 on Workers Free
// (docs/release/V1_FREE_TIER_PROBE_RUNBOOK.md). It is NOT the API Worker: own entry, own generated config
// (scripts/free-tier-probe-config.ts), own two D1 databases, synthetic data only, deleted after the run.
//
// Guards, all fail closed with 404 (the probe does not advertise itself):
//   - every request needs `Authorization: Bearer <PROBE_TOKEN>` (Secret, ≥ 32 chars, constant-time compare);
//   - both databases must carry the probe identity row written by the probe's own migrations, so binding a real
//     REPORTS_DB or any other store makes every route refuse;
//   - the App Attest trust anchor is the driver's generated TEST root, stored once by /probe/setup. Nothing here
//     trusts Apple's root, so no real device key can ever register against the probe.
// Routes: the real challenge/key/report routes (createApp), the PoC v3 photo route, synthetic report creation, D1 checks and
// a retention pass. A Cron trigger, if configured, runs the same retention pass for scheduled-CPU measurement.
import { createApp } from "../../app.ts";
import { base64Decode } from "../../attest/bytes.ts";
import type { Db } from "../../db.ts";
import { attestedSubmitter, createReport, submitterHash } from "../../reports/create.ts";
import { runRetentionMaintenance } from "../../reports/retention-automation.ts";
import { CURRENT_REPORT_TERMS } from "../../reports/terms.ts";
import { D1PhotoStore } from "../binary-photo/d1-photo-store.ts";
import { queueDuePhotosForErasure } from "../binary-photo/erasure.ts";
import { handleBinaryPhoto } from "../binary-photo/route.ts";
import { sealPhoto } from "../binary-photo/photo-crypto.ts";
import { runD1Checks } from "./d1-checks.ts";
import { PROBE_IDENTITY } from "./identity.ts";

interface ProbeEnv {
  REPORTS_DB: Db; PHOTOS_DB: Db; PROBE_TOKEN?: string;
  REPORT_ATTESTATION: string; REPORT_APP_ATTEST_APP_ID: string; REPORT_APP_ATTEST_ENVIRONMENT: string;
  REPORT_APP_ATTEST_BUNDLE_VERSIONS: string; REPORT_SUBMITTER_PEPPER?: string; RATE_LIMIT_KEY_PEPPER?: string;
  REPORT_REGISTRATION: string; REPORT_REGISTRATION_MAX_PER_HOUR: string; REPORT_REGISTRATION_MAX_PER_DAY: string;
  CHALLENGE_RATE_LIMITER?: unknown;
}

const notFound = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function tokenMatches(header: string | null, token: string | undefined): boolean {
  if (!token || token.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = new TextEncoder().encode(header.slice(7)), want = new TextEncoder().encode(token);
  let diff = given.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= want[i] ^ (given[i] ?? 0);
  return diff === 0;
}

async function isProbeStore(db: Db): Promise<boolean> {
  try { return (await db.prepare("SELECT name FROM probe_identity WHERE id = 1").first<{ name: string }>())?.name === PROBE_IDENTITY; }
  catch { return false; }
}

async function trustAnchor(env: ProbeEnv): Promise<Uint8Array | null> {
  const row = await env.PHOTOS_DB.prepare("SELECT trust_anchor FROM probe_config WHERE id = 1").first<{ trust_anchor: string }>();
  return row ? base64Decode(row.trust_anchor) : null;
}

const photoTermsCovered = () => true; // synthetic data only; the API Worker's REVIEWED_PHOTO_TERMS stays empty

export default {
  async fetch(req: Request, env: ProbeEnv, ctx: ExecutionContext): Promise<Response> {
    if (!tokenMatches(req.headers.get("Authorization"), env.PROBE_TOKEN)) return notFound();
    if (!(await isProbeStore(env.REPORTS_DB)) || !(await isProbeStore(env.PHOTOS_DB))) return notFound();
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/probe/setup") {
      const body = await req.json() as { trustAnchor?: string };
      if (!body.trustAnchor || base64Decode(body.trustAnchor) === null) return json(400, { error: "trustAnchor" });
      await env.PHOTOS_DB.prepare("INSERT INTO probe_config (id, trust_anchor) VALUES (1, ?) ON CONFLICT (id) DO NOTHING").bind(body.trustAnchor).run();
      return json(200, { ok: true });
    }
    const anchor = await trustAnchor(env);
    if (!anchor) return json(409, { error: "setupRequired" });
    const store = new D1PhotoStore(env.PHOTOS_DB);

    if (req.method === "GET" && url.pathname === "/probe/usage") return json(200, await store.usage());
    if (req.method === "POST" && url.pathname === "/probe/reports") {
      const body = await req.json() as { keyId?: string };
      if (!body.keyId) return json(400, { error: "keyId" });
      const idempotencyKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      const report = await createReport(env.REPORTS_DB, { schemaVersion: 3, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J",
        installId: crypto.randomUUID(), idempotencyKey, acceptedTermsVersion: CURRENT_REPORT_TERMS.version },
      { now: new Date(), attestationStatus: "verified", submitterHash: await submitterHash(attestedSubmitter(body.keyId), env.REPORT_SUBMITTER_PEPPER) });
      return json(201, { reportId: report.reportId });
    }
    if (req.method === "POST" && url.pathname === "/probe/d1-checks") return json(200, await runD1Checks(env.PHOTOS_DB));
    if (req.method === "POST" && url.pathname === "/probe/retention") return json(200, await retention(env, store));
    // F11: CPU of crypto-erasure sealing alone (run in its own time window; analytics cannot split by path).
    if (req.method === "POST" && url.pathname === "/probe/seal") {
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length < 32 + 1 || body.length > 32 + 1_200_000) return json(400, { error: "body" });
      const sealed = await sealPhoto(body.subarray(32), "probe/seal.jpg", 1, body.subarray(0, 32));
      return json(200, { sealedBytes: sealed.length });
    }
    const photo = url.pathname.match(/^\/v3\/reports\/(rp_[0-9A-HJKMNP-TV-Z]{26})\/photos$/);
    if (req.method === "POST" && photo) {
      return handleBinaryPhoto(req, photo[1], env as never, env.REPORTS_DB, { now: () => new Date(), store, photoTermsCovered, trustAnchor: anchor });
    }
    // v1.0 new places without photos: the API Worker's own POST /v1/reports handler, unchanged, for its CPU and D1 cost.
    if (url.pathname.startsWith("/v1/app-attest/") || (req.method === "POST" && url.pathname === "/v1/reports")) {
      return createApp({ appAttestTrustAnchor: anchor }).fetch(req, env as never, ctx);
    }
    return notFound();
  },

  async scheduled(_event: ScheduledController, env: ProbeEnv): Promise<void> {
    if (!(await isProbeStore(env.REPORTS_DB)) || !(await isProbeStore(env.PHOTOS_DB))) return;
    const result = await retention(env, new D1PhotoStore(env.PHOTOS_DB));
    if (result.outcome !== "complete") throw new Error(`probe retention ${result.outcome}`);
  },
} satisfies ExportedHandler<ProbeEnv>;

async function retention(env: ProbeEnv, store: D1PhotoStore) {
  const now = new Date();
  const queued = await queueDuePhotosForErasure(env.REPORTS_DB, now);
  const result = await runRetentionMaintenance(env.REPORTS_DB, { now, mode: "cleanup", photoStorage: store });
  return { queued, ...result };
}

