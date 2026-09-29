// Pure staging workflow only. No DB dependency or canonical write path.
export const CROSS_SOURCE_VERSION = "cross-source-review.v1";
export interface SourceEvidence {
  sourceId: string;
  releaseId: number;
  recordId: number;
  entityId: number;
  /** Independently reviewed smoking-location evidence; never host/business evidence. */
  existence: string;
  attribution: string;
  fields: Readonly<Record<string, string | number | boolean | null>>;
}
export interface CrossSourceSpot {
  spotId: string;
  latitude: number;
  longitude: number;
  name: string;
  location: string;
  evidence: readonly SourceEvidence[];
  /** Existing redirects into this spot; snapshot loader must supply the complete set. */
  inboundRedirectIds: readonly string[];
  mergedInto: string | null;
}
export interface CrossSourceCandidate {
  key: string;
  version: typeof CROSS_SOURCE_VERSION;
  spots: readonly [CrossSourceSpot, CrossSourceSpot];
  reasons: readonly string[];
}
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");
function validate(s: CrossSourceSpot): void {
  if (!s.spotId || s.mergedInto !== null || !Number.isFinite(s.latitude) || Math.abs(s.latitude) > 90
    || !Number.isFinite(s.longitude) || Math.abs(s.longitude) > 180 || !s.evidence.length
    || s.evidence.some(e => !e.sourceId || !e.existence.trim() || !e.attribution.trim())) {
    throw new Error("cross-source: invalid or unreviewed snapshot");
  }
}
function distance(a: CrossSourceSpot, b: CrossSourceSpot): number {
  const rad = Math.PI / 180;
  const h = Math.sin((a.latitude - b.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad)
    * Math.sin((a.longitude - b.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
/** Broad review recall: <=100m alone, or <=500m plus exact normalized name/location.
 * Never an identity decision. Name/location cannot nominate geographically distant hosts. */
export function crossSourceCandidates(input: readonly CrossSourceSpot[]): CrossSourceCandidate[] {
  input.forEach(validate);
  if (new Set(input.map(s => s.spotId)).size !== input.length) throw new Error("cross-source: duplicate spot ID");
  const spots = [...input].sort((a, b) => a.spotId.localeCompare(b.spotId));
  const result: CrossSourceCandidate[] = [];
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const a = spots[i], b = spots[j];
    if (!a.evidence.some(x => b.evidence.some(y => x.sourceId !== y.sourceId))) continue;
    const d = distance(a, b);
    const reasons = [d <= 100 ? "proximity100m" : "", normalize(a.name) && normalize(a.name) === normalize(b.name) ? "normalizedName" : "",
      normalize(a.location) && normalize(a.location) === normalize(b.location) ? "normalizedLocation" : ""].filter(Boolean);
    if (d > 500 || (d > 100 && reasons.length === 0)) continue;
    result.push({ key: JSON.stringify([CROSS_SOURCE_VERSION, a, b]), version: CROSS_SOURCE_VERSION,
      spots: structuredClone([a, b]), reasons });
  }
  return result;
}
export interface CrossSourceReview {
  candidateKey: string;
  decision: "sameRealWorldSpot" | "distinctSpots" | "insufficientEvidence";
  reviewer: string;
  reviewedAt: string;
  /** Specific smoking-location identity evidence, independent of host/name similarity. */
  identityEvidence: string;
}
export interface MergePlan {
  survivorId: string;
  redirects: readonly { from: string; to: string }[];
  history: CrossSourceReview;
  evidence: readonly SourceEvidence[];
  conflicts: readonly string[];
  publication: "hold";
}
/** Explicit survivor selection is a separate operation after a same review. Returns a proposal,
 * never applies it. Snapshot-bound key invalidates decisions after evidence/identity drift. */
export function planCrossSourceMerge(candidate: CrossSourceCandidate, review: CrossSourceReview | null, survivorId: string): MergePlan | null {
  const [a, b] = candidate.spots;
  const verified = crossSourceCandidates([a, b])[0];
  if (!verified || verified.key !== candidate.key || candidate.version !== CROSS_SOURCE_VERSION) throw new Error("cross-source: stale candidate");
  if (!review) return null;
  if (review.candidateKey !== candidate.key || !review.reviewer.trim() || !Number.isFinite(Date.parse(review.reviewedAt))
    || !review.identityEvidence.trim()) throw new Error("cross-source: invalid review");
  if (review.decision === "distinctSpots" || review.decision === "insufficientEvidence") return null;
  if (review.decision !== "sameRealWorldSpot") throw new Error("cross-source: invalid decision");
  if (survivorId !== a.spotId && survivorId !== b.spotId) throw new Error("cross-source: survivor must be an existing candidate ID");
  const loser = survivorId === a.spotId ? b : a;
  const evidence = structuredClone([...a.evidence, ...b.evidence]);
  const fields = [...new Set(evidence.flatMap(e => Object.keys(e.fields)))].sort();
  const conflicts = fields.filter(f => new Set(evidence.map(e => JSON.stringify(e.fields[f] ?? null))).size > 1);
  if (a.latitude !== b.latitude || a.longitude !== b.longitude) conflicts.unshift("coordinates");
  const redirectIds = [...new Set([loser.spotId, ...a.inboundRedirectIds, ...b.inboundRedirectIds])].sort();
  if (redirectIds.includes(survivorId) || redirectIds.includes(a.spotId) && redirectIds.includes(b.spotId)) throw new Error("cross-source: redirect cycle");
  return { survivorId, redirects: redirectIds.map(from => ({ from, to: survivorId })), history: structuredClone(review),
    evidence, conflicts, publication: "hold" };
}
