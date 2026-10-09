// Scoped rights-notice fingerprints. Whole-page hashes are unusable: Kyoto pages carry access/download
// counters and Minato pages a per-request CSRF meta. Each source therefore declares an explicit scope
// contract (text anchors or JSON fields); only that legally meaningful range is hashed. A scope that cannot
// be located exactly is reported as such and never replaced by a guessed fingerprint.
// Read-only: no baseline, registry or publication is ever written here.
import { sha256Hex } from "../db.ts";
import { transportFailure, type HealthOptions, type HealthResult } from "./check.ts";

// `start` must occur exactly once in the normalized text; `end` is the first occurrence after it and is
// excluded, so legal text appended inside the section is still captured.
export interface RightsRange { start: string; end: string }
export type RightsScope =
  | { kind: "htmlText"; ranges: RightsRange[]; requiredMarkers: string[] }
  | { kind: "jsonFields"; fields: string[]; requiredMarkers: string[] };
// reviewDueAt is an operational reminder (JST day), not a legal expiry.
export interface RightsContract { url: string; scope: RightsScope; reviewedFingerprint: string; reviewedAt: string; reviewDueAt: string }
export type RightsOutcome = "unchanged" | "changed" | "scopeMissing" | "scopeAmbiguous" | "markerMissing" | "unavailable" | "notChecked";
export interface RightsObservation {
  url: string; outcome: RightsOutcome; reason: string | null; httpStatus: number | null;
  fingerprint: string | null; reviewedFingerprint: string; reviewedAt: string; reviewDueAt: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find(v => v !== undefined);
// Visible text plus link targets and image alt text (license badges are often links/images only).
export function normalizeHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, tag => {
      const name = tag.match(/^<\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
      const value = name === "a" ? attribute(tag, "href") : name === "img" ? attribute(tag, "alt") : undefined;
      return value === undefined ? " " : ` [${name === "a" ? "link" : "img"}:${value}] `;
    })
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
      if (body[0] !== "#") return ENTITIES[body.toLowerCase()] ?? entity;
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/\s+/g, " ").trim();
}

export type ScopeResult = { ok: true; text: string } | { ok: false; outcome: "scopeMissing" | "scopeAmbiguous" | "markerMissing" };
export function extractRightsScope(body: string, scope: RightsScope): ScopeResult {
  let text: string;
  if (scope.kind === "htmlText") {
    const normalized = normalizeHtml(body), parts: string[] = [];
    for (const range of scope.ranges) {
      const start = normalized.indexOf(range.start);
      if (start < 0) return { ok: false, outcome: "scopeMissing" };
      if (normalized.indexOf(range.start, start + 1) >= 0) return { ok: false, outcome: "scopeAmbiguous" };
      const end = normalized.indexOf(range.end, start + range.start.length);
      if (end < 0) return { ok: false, outcome: "scopeMissing" };
      parts.push(normalized.slice(start, end).trim());
    }
    text = parts.join("\n");
  } else {
    let json: unknown;
    try { json = JSON.parse(body); } catch { return { ok: false, outcome: "scopeMissing" }; }
    const values: [string, string | number | boolean][] = [];
    for (const field of scope.fields) {
      let value: unknown = json;
      for (const key of field.split(".")) value = value !== null && typeof value === "object" && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return { ok: false, outcome: "scopeMissing" };
      values.push([field, value]);
    }
    text = JSON.stringify(values);
  }
  return scope.requiredMarkers.every(marker => text.includes(marker)) ? { ok: true, text } : { ok: false, outcome: "markerMissing" };
}

export async function rightsFingerprint(text: string): Promise<string> { return sha256Hex(new TextEncoder().encode(text)); }

const MIME = { htmlText: ["text/html", "application/xhtml+xml"], jsonFields: ["application/json"] } as const;
// Redirects are not followed: a rights page that moved needs a human to re-point the contract.
export async function checkRights(contract: RightsContract, options: HealthOptions): Promise<RightsObservation> {
  const observation: RightsObservation = { url: contract.url, outcome: "unavailable", reason: null, httpStatus: null, fingerprint: null,
    reviewedFingerprint: contract.reviewedFingerprint, reviewedAt: contract.reviewedAt, reviewDueAt: contract.reviewDueAt };
  const maxBytes = options.maxBytes ?? 2_000_000, controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, options.timeoutMs ?? 20_000); });
  try {
    if (new URL(contract.url).protocol !== "https:") throw new Error("HTTPS resource required");
    const response = await Promise.race([options.fetch(contract.url, { redirect: "manual", signal: controller.signal }), deadline]);
    observation.httpStatus = response.status;
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      observation.reason = response.status === 429 ? "rateLimited" : `http:${response.status}`; return observation;
    }
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!mime || !(MIME[contract.scope.kind] as readonly string[]).includes(mime)) { void response.body?.cancel().catch(() => {}); observation.reason = "unexpectedMime"; return observation; }
    if (Number(response.headers.get("content-length")) > maxBytes) { void response.body?.cancel().catch(() => {}); observation.reason = "transport:sizeLimit"; return observation; }
    const bytes = new Uint8Array(await Promise.race([response.arrayBuffer(), deadline]));
    if (bytes.byteLength > maxBytes) { observation.reason = "transport:sizeLimit"; return observation; }
    const scoped = extractRightsScope(new TextDecoder("utf-8").decode(bytes), contract.scope);
    if (!scoped.ok) { observation.outcome = scoped.outcome; observation.reason = scoped.outcome; return observation; }
    observation.fingerprint = await rightsFingerprint(scoped.text);
    observation.outcome = observation.fingerprint === contract.reviewedFingerprint ? "unchanged" : "changed";
    return observation;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(cause.code) ? cause.code : null;
    observation.reason = `transport:${transportFailure(error instanceof Error ? error.message : "", code)}${code ? `(${code})` : ""}`;
    return observation;
  } finally { clearTimeout(timer!); controller.abort(); }
}

export function notChecked(contract: RightsContract): RightsObservation {
  return { url: contract.url, outcome: "notChecked", reason: null, httpStatus: null, fingerprint: null,
    reviewedFingerprint: contract.reviewedFingerprint, reviewedAt: contract.reviewedAt, reviewDueAt: contract.reviewDueAt };
}

// Rights evidence is independent of data availability: a data failure never implies a rights change.
export function withRights(result: HealthResult, rights: RightsObservation[]): HealthResult {
  const rightsChanged = rights.some(item => item.outcome === "changed");
  const rightsScopeMissing = rights.some(item => ["scopeMissing", "scopeAmbiguous", "markerMissing"].includes(item.outcome));
  return { ...result, rights, signals: { ...result.signals, rightsChanged, rightsScopeMissing,
    rightsReviewRequired: result.signals.rightsReviewRequired || rightsChanged || rightsScopeMissing } };
}
