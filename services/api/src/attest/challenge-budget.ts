// Per-client budget for App Attest challenge issuance (docs/OPERATIONS.md "Read API and challenge abuse budget").
// One layer of four: an edge IP rule (account configuration), this Worker bucket, the successful key registration
// budget, and the deployment-wide emergency ceiling in issueChallenge. This layer is optional and needs both a
// Workers Rate Limiting binding and its own secret pepper; with neither, issuance behaves exactly as before.
//
// Privacy: the client address is used only as HMAC input inside this request. The bucket key is the HMAC under
// RATE_LIMIT_KEY_PEPPER, so neither the address nor a reversible form of it reaches D1, a log or a response, and the
// Rate Limiting service sees only the keyed digest.

const KEY_CONTEXT = "mannerpath.app-attest-challenge.v1\n";
const PEPPER_MIN_LENGTH = 32;

export interface ChallengeBudgetEnv {
  CHALLENGE_RATE_LIMITER?: RateLimit;
  RATE_LIMIT_KEY_PEPPER?: string;
  REPORT_SUBMITTER_PEPPER?: string;
}

export type ChallengeBudget = "notConfigured" | "allowed" | "limited" | "misconfigured";

export async function rateLimitKey(pepper: string, clientAddress: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(KEY_CONTEXT + clientAddress));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function challengeBudget(env: ChallengeBudgetEnv, request: Request): Promise<ChallengeBudget> {
  const limiter = env.CHALLENGE_RATE_LIMITER;
  const pepper = env.RATE_LIMIT_KEY_PEPPER;
  if (limiter === undefined && pepper === undefined) return "notConfigured";
  // Half a configuration, a short pepper or a reused report pepper fails closed, like REPORT_ATTESTATION: a typo
  // must never silently drop the layer, and one leaked pepper must not unlock both hashes.
  if (limiter === undefined || pepper === undefined || pepper.length < PEPPER_MIN_LENGTH || pepper === env.REPORT_SUBMITTER_PEPPER) {
    return "misconfigured";
  }
  // Cloudflare sets CF-Connecting-IP on every request it routes to the Worker. Without it (not via Cloudflare) all
  // such callers share one bucket rather than going unlimited.
  const key = await rateLimitKey(pepper, request.headers.get("CF-Connecting-IP") ?? "no-client-address");
  try {
    return (await limiter.limit({ key })).success ? "allowed" : "limited";
  } catch {
    // A Rate Limiting outage must not take issuance down; the deployment-wide ceiling still bounds D1 writes.
    return "allowed";
  }
}
