// ADR-0012 research replay rules (coverage-replay.v1). Pure functions over committed review records: which blockers
// are about RIGHTS (nobody may reuse the data yet), which are about the DATA (it does not say what MannerPath needs),
// and which acquisition route a target therefore belongs to. Used by scripts/coverage-replay.ts.
//
// ADR-0012 relaxes exactly one blocker: `currentOperationUnknown`. An official listing without removal evidence is no
// longer withheld for being old — it publishes with its date and a freshness label (stale != nonexistent). Explicit
// closure or suspension evidence is a different thing and still blocks (the review records it in its reason, not as
// this code). Every other blocker keeps its meaning: coverage-first never turns a host facility, a missing
// coordinate or an unlicensed file into a spot.

export const RIGHTS_BLOCKERS = ["reuseForbidden", "licenseUnknown", "exactTermsUnknown", "redistributionBlocked"] as const;
export const DATA_BLOCKERS = [
  "coordinatesMissing", "noSmokingPoint", "hostPointOnly", "noSmokingEvidence", "polygonOnly",
  "coordinateSemanticsUnknown", "incompatibleFormat",
] as const;
export const ACCESS_BLOCKERS = ["rawUnavailable", "accessBlocked"] as const;
export const RELAXED_BY_ADR_0012 = ["currentOperationUnknown"] as const;
/** Blockers the community route can answer: a person on site can say "there is an ashtray here" and pin it. */
const COMMUNITY_ANSWERABLE = ["noSmokingPoint", "hostPointOnly", "noSmokingEvidence", "coordinatesMissing", "polygonOnly"];

export interface ReviewInput {
  targetId?: string;
  jurisdiction: string;
  verdict: string;
  blockerCodes: string[] | string;
  reason?: string;
  kind?: string;
}

export type BlockedBy = "alreadyReviewedSource" | "notBlocked" | "rightsOnly" | "dataOnly" | "rightsAndData" | "accessOnly" | "relaxedByAdr0012";
/**
 * A: official reusable source · B: operator reusable source · C: community acquisition target ·
 * D: license-unresolved official information, a reference lead only · E: OSM/Google/other app, reference only.
 * `retryAccess`: the raw could not be read, so nothing is known yet.
 */
export type Route = "A-officialReusable" | "B-operatorReusable" | "C-communityAcquisition" | "D-referenceLead" | "E-referenceOnly" | "retryAccess";

const has = (codes: readonly string[], set: readonly string[]) => codes.some((c) => set.includes(c));

export function blockerCodes(review: ReviewInput): string[] {
  const raw = review.blockerCodes;
  // A few early records stored the list as its Python repr ("['a', 'b']").
  return Array.isArray(raw) ? raw : [...raw.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
}

export function classifyReview(review: ReviewInput): { jurisdiction: string; kind: string; blockers: string[]; blockedBy: BlockedBy; route: Route } {
  const blockers = blockerCodes(review);
  const rights = has(blockers, RIGHTS_BLOCKERS);
  const data = has(blockers, DATA_BLOCKERS);
  const access = has(blockers, ACCESS_BLOCKERS);
  const relaxed = has(blockers, RELAXED_BY_ADR_0012);
  // A research duplicate of a source already reviewed and published (Taito, Osaka…): official and reusable, counted
  // once in the corpus, never as new coverage.
  const duplicate = blockers.length > 0 && blockers.every((c) => c === "duplicateKnownResearch");
  const blockedBy: BlockedBy = duplicate ? "alreadyReviewedSource" : rights && data ? "rightsAndData" : rights ? "rightsOnly" : data ? "dataOnly"
    : access ? "accessOnly" : relaxed ? "relaxedByAdr0012" : "notBlocked";
  const kind = review.kind ?? "municipality";
  const thirdParty = !duplicate && !rights && !data && /OpenStreetMap|\bOSM\b|Google|MapKit/.test(review.reason ?? "");
  const route: Route = duplicate ? (kind === "operator" ? "B-operatorReusable" : "A-officialReusable")
    : thirdParty ? "E-referenceOnly"
    : rights ? "D-referenceLead"
    : data && has(blockers, COMMUNITY_ANSWERABLE) ? "C-communityAcquisition"
    : access && !data ? "retryAccess"
    : kind === "operator" ? "B-operatorReusable" : "A-officialReusable";
  return { jurisdiction: review.jurisdiction, kind, blockers, blockedBy, route };
}

export function summarize(rows: readonly { blockedBy: BlockedBy; route: Route; blockers: string[] }[]) {
  const count = <K extends string>(values: K[]) => {
    const out: Record<string, number> = {};
    for (const v of values) out[v] = (out[v] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  return {
    reviewedTargets: rows.length,
    blockedBy: count(rows.map((r) => r.blockedBy)),
    route: count(rows.map((r) => r.route)),
    blockerFrequency: count(rows.flatMap((r) => r.blockers)),
  };
}
