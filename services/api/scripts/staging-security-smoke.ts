// GET-only security readiness smoke. No challenge, report, credential, DB or deployment operation.
import { pathToFileURL } from "node:url";
import { ConfigBodyV1 } from "../src/config/dto.ts";
import { PromotionReadinessV1 } from "../src/pipeline/promotion-readiness.ts";

export interface SmokeTarget { origin: string; remote: boolean; expect: "unavailable" | "v3" }
export function smokeTarget(argv: string[]): SmokeTarget {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--base-url", "--confirm-staging", "--expect-reports"].includes(argv[i]) ||
        !argv[i + 1] || flags.has(argv[i])) throw new Error("invalid smoke options");
    flags.set(argv[i], argv[i + 1]);
  }
  const url = new URL(flags.get("--base-url") ?? "http://127.0.0.1:8787");
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("origin required");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (local) {
    if (!["http:", "https:"].includes(url.protocol) || flags.has("--confirm-staging")) throw new Error("invalid local target");
  } else if (url.protocol !== "https:" || url.port ||
      !/^mannerpath-api-staging\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
      flags.get("--confirm-staging") !== "mannerpath-api-staging") {
    throw new Error("explicit staging workers.dev target required");
  }
  const expect = flags.get("--expect-reports") ?? "unavailable";
  if (expect !== "unavailable" && expect !== "v3") throw new Error("invalid expected report state");
  return { origin: url.origin, remote: !local, expect };
}

async function boundedJSON(response: Response): Promise<unknown> {
  const limit = 8192;
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel(); throw new Error("invalid smoke response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid smoke response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("invalid smoke response"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function stagingSmoke(target: SmokeTarget, send: typeof fetch = fetch) {
  const get = async (path: string) => {
    const response = await send(target.origin + path, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" },
    });
    if (response.headers.get("x-content-type-options") !== "nosniff") throw new Error("missing response protection");
    return { response, body: await boundedJSON(response) };
  };
  const readiness = await get("/v1/readiness");
  const parsed = PromotionReadinessV1.safeParse(readiness.body);
  if (!parsed.success || !(readiness.response.status === 200 && parsed.data.completed && parsed.data.state === "completed") &&
      !(target.remote === false && readiness.response.status === 503 && parsed.data.state === "localPipeline" && !parsed.data.completed)) {
    throw new Error("promotion readiness unavailable");
  }
  if (readiness.response.headers.get("cache-control") !== "no-store") throw new Error("readiness cache policy mismatch");
  const config = await get("/v1/config");
  const result = ConfigBodyV1.safeParse(config.body);
  if (config.response.status !== 200 || !result.success ||
      config.response.headers.get("cache-control") !== "public, no-cache") throw new Error("invalid public config");
  const value = result.data;
  if (target.remote && value.reports.attestation !== "appAttest") throw new Error("remote attestation configuration invalid");
  if (value.reports.photoEvidenceEnabled === true) throw new Error("photo intake unexpectedly available");
  if (target.expect === "unavailable") {
    if (value.reports.available) throw new Error("report intake unexpectedly available");
  } else if (!value.reports.available || value.reports.attestation !== "appAttest" ||
      value.schemaVersions.report !== 3 || value.minimumSupportedSchemaVersions.report !== 3) {
    throw new Error("schema v3 unavailable");
  }
  return { event: "stagingSecuritySmoke", target: target.remote ? "staging" : "local", result: "PASS",
    reports: target.expect, checks: ["promotionReadiness", "configCompatibility", "reportAvailability", "photosDisabled", "readCachePolicy", "nosniff"],
    writePath: "UNVERIFIED" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await stagingSmoke(smokeTarget(process.argv.slice(2))))); }
  catch { console.error("staging security smoke failed; stop and inspect configuration without logging response bodies"); process.exitCode = 1; }
}
