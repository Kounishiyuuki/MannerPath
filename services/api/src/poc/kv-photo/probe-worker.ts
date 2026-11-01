// FREE-TIER PROBE for A1 (docs/release/V1_KV_PHOTO_A1_POC.md) — a separate, disposable Worker entry with the same guards
// as src/poc/free-tier-probe/worker.ts: every request needs the PROBE_TOKEN bearer, both databases must carry the probe
// identity row, App Attest trusts only the driver's TEST root. Synthetic data only; deleted after the run.
// Routes: the real challenge/key routes, synthetic report creation, ① intent, ② upload, and /probe/kv-* facts.
// No route returns photo bytes: kv-check reports status, length and SHA-256 only.
import { createApp } from "../../app.ts";
import { base64Decode } from "../../attest/bytes.ts";
import { type Db, sha256Hex } from "../../db.ts";
import { attestedSubmitter, createReport, submitterHash } from "../../reports/create.ts";
import { runRetentionMaintenance } from "../../reports/retention-automation.ts";
import { CURRENT_REPORT_TERMS } from "../../reports/terms.ts";
import { queueDuePhotosForErasure } from "../binary-photo/erasure.ts";
import { PROBE_IDENTITY } from "../free-tier-probe/identity.ts";
import { KvPhotoStore, type PhotoKv } from "./kv-photo-store.ts";
import { handlePhotoIntent, handlePhotoUpload } from "./two-step.ts";

interface ProbeEnv {
  REPORTS_DB: Db; PHOTOS_DB: Db; PHOTO_KV: PhotoKv; PROBE_TOKEN?: string;
  REPORT_ATTESTATION: string; REPORT_APP_ATTEST_APP_ID: string; REPORT_APP_ATTEST_ENVIRONMENT: string;
  REPORT_APP_ATTEST_BUNDLE_VERSIONS: string; REPORT_SUBMITTER_PEPPER?: string; RATE_LIMIT_KEY_PEPPER?: string;
  REPORT_REGISTRATION: string; REPORT_REGISTRATION_MAX_PER_HOUR: string; REPORT_REGISTRATION_MAX_PER_DAY: string;
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

const photoTermsCovered = () => true; // synthetic data only

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
    const row = await env.PHOTOS_DB.prepare("SELECT trust_anchor FROM probe_config WHERE id = 1").first<{ trust_anchor: string }>();
    const anchor = row ? base64Decode(row.trust_anchor) : null;
    if (!anchor) return json(409, { error: "setupRequired" });
    const store = new KvPhotoStore(env.PHOTOS_DB, env.PHOTO_KV);
    const opts = { now: () => new Date(), store, photoTermsCovered, trustAnchor: anchor };

    if (req.method === "GET" && url.pathname === "/probe/kv-usage") return json(200, await store.usage());
    if (req.method === "POST" && url.pathname === "/probe/reports") {
      const body = await req.json() as { keyId?: string };
      if (!body.keyId) return json(400, { error: "keyId" });
      const idempotencyKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      const report = await createReport(env.REPORTS_DB, { schemaVersion: 3, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J",
        installId: crypto.randomUUID(), idempotencyKey, acceptedTermsVersion: CURRENT_REPORT_TERMS.version },
      { now: new Date(), attestationStatus: "verified", submitterHash: await submitterHash(attestedSubmitter(body.keyId), env.REPORT_SUBMITTER_PEPPER) });
      return json(201, { reportId: report.reportId });
    }
    // Deletion facts on the newest ready photo: read, fence + KV.delete, read again, and whether KV still answers.
    if (req.method === "POST" && url.pathname === "/probe/kv-check") {
      const photo = await env.REPORTS_DB.prepare("SELECT storage_key, content_sha256 FROM community_evidence_photos WHERE lifecycle = 'ready' ORDER BY created_at DESC LIMIT 1")
        .first<{ storage_key: string; content_sha256: string }>();
      if (!photo) return json(404, { error: "noPhoto" });
      const before = await store.read(photo.storage_key);
      const facts: Record<string, unknown> = { key: photo.storage_key, before: before.status,
        sha256Matches: before.status === "available" ? (await sha256Hex(before.bytes)) === photo.content_sha256 : null };
      if (url.searchParams.get("delete") === "1") {
        await store.delete(photo.storage_key);
        const raw = await env.PHOTO_KV.get(photo.storage_key, "arrayBuffer");
        Object.assign(facts, { after: (await store.read(photo.storage_key)).status, kvStillAnswers: raw !== null, deletedAt: new Date().toISOString() });
      }
      return json(200, facts);
    }
    if (req.method === "POST" && url.pathname === "/probe/kv-raw") {
      const { key } = await req.json() as { key?: string };
      if (!key?.startsWith("private/evidence/")) return json(400, { error: "key" });
      return json(200, { kvAnswers: (await env.PHOTO_KV.get(key, "arrayBuffer")) !== null, ledger: (await store.read(key)).status });
    }
    if (req.method === "POST" && url.pathname === "/probe/retention") {
      const now = new Date();
      return json(200, { queued: await queueDuePhotosForErasure(env.REPORTS_DB, now), ...(await runRetentionMaintenance(env.REPORTS_DB, { now, mode: "cleanup", photoStorage: store as never })) });
    }
    const intent = url.pathname.match(/^\/v4\/reports\/(rp_[0-9A-HJKMNP-TV-Z]{26})\/photo-intents$/);
    if (req.method === "POST" && intent) return handlePhotoIntent(req, intent[1], env as never, env.REPORTS_DB, opts);
    const upload = url.pathname.match(/^\/v4\/photo-uploads\/([A-Za-z0-9_-]{43})$/);
    if (req.method === "PUT" && upload) return handlePhotoUpload(req, upload[1], env as never, env.REPORTS_DB, opts);
    if (url.pathname.startsWith("/v1/app-attest/")) return createApp({ appAttestTrustAnchor: anchor }).fetch(req, env as never, ctx);
    return notFound();
  },
} satisfies ExportedHandler<ProbeEnv>;
