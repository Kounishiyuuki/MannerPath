// Per-client budget for App Attest challenge issuance (docs/OPERATIONS.md "Read API and challenge abuse budget").
// One layer of four: an edge IP rule (account configuration), this Worker bucket (also checked before key registration), the successful key registration
// budget, and the deployment-wide emergency ceiling in issueChallenge. This layer needs both a
// Workers Rate Limiting binding and its own secret pepper. It remains optional for report-purpose
// challenges; enabled new registration requires it at both issuance and key-registration routes.
//
// Privacy: the client address is used only as HMAC input inside this request. The bucket key is the HMAC under
// RATE_LIMIT_KEY_PEPPER, so neither the address nor a reversible form of it reaches D1, a log or a response, and the
// Rate Limiting service sees only the keyed digest.

import { normalizedPepper } from "../secrets/pepper.ts";

const KEY_CONTEXT = "mannerpath.app-attest-challenge.v1\n";

export interface ChallengeBudgetEnv {
  CHALLENGE_RATE_LIMITER?: RateLimit;
  RATE_LIMIT_KEY_PEPPER?: string;
  REPORT_SUBMITTER_PEPPER?: string;
}

export type ChallengeBudget = "notConfigured" | "allowed" | "limited" | "misconfigured" | "unavailable";

export async function rateLimitKey(pepper: string, clientAddress: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(KEY_CONTEXT + clientAddress));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function challengeBudget(env: ChallengeBudgetEnv, request: Request): Promise<ChallengeBudget> {
  const limiter = env.CHALLENGE_RATE_LIMITER;
  if (limiter === undefined && env.RATE_LIMIT_KEY_PEPPER === undefined) return "notConfigured";
  // Half a configuration, a pepper under 32 UTF-8 bytes after trimming, or the report pepper reused (compared after
  // the same normalization) fails closed, like REPORT_ATTESTATION: a typo must never silently drop the layer, and
  // one leaked pepper must not unlock both hashes.
  const pepper = normalizedPepper(env.RATE_LIMIT_KEY_PEPPER);
  const submitter = env.REPORT_SUBMITTER_PEPPER?.trim();
  if (limiter === undefined || pepper === null || pepper === submitter) return "misconfigured";
  // Cloudflare sets CF-Connecting-IP on every request it routes to the Worker. Without it (not via Cloudflare) all
  // such callers share one bucket rather than going unlimited.
  const key = await rateLimitKey(pepper, request.headers.get("CF-Connecting-IP") ?? "no-client-address");
  try {
    const result = await limiter.limit({ key });
    if (typeof result?.success !== "boolean") return "unavailable";
    return result.success ? "allowed" : "limited";
  } catch {
    // A configured limiter that fails is a broken security control: issuance (the entry to report writes, never a
    // read) stops rather than continuing unchecked. Nothing about the caller, key or binding is surfaced.
    return "unavailable";
  }
}
