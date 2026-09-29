import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSourceCandidates, planCrossSourceMerge, type CrossSourceSpot, type CrossSourceReview } from "../src/pipeline/cross-source.ts";
const spot = (id: string, source: string): CrossSourceSpot => ({ spotId: id, latitude: 35, longitude: 139,
  name: " Ａ公園 喫煙所 ", location: "north entrance", mergedInto: null, inboundRedirectIds: [],
  evidence: [{ sourceId: source, releaseId: 1, recordId: source === "alpha" ? 1 : 2, entityId: source === "alpha" ? 1 : 2,
    existence: "reviewed designated smoking enclosure", attribution: `${source} licensed attribution`,
    fields: { hours: null, access: "public", lifecycle: "active", tobacco: "unknown" } }] });
const a = spot("stable-a", "alpha"), b = spot("stable-b", "beta");
const candidate = () => crossSourceCandidates([a, b])[0];
const review = (decision: CrossSourceReview["decision"]): CrossSourceReview => ({ candidateKey: candidate().key, decision,
  reviewer: "human-reviewer", reviewedAt: "2026-09-29T00:00:00Z", identityEvidence: "Reviewed site plans identify the same smoking enclosure" });

test("near + normalized same name nominates only; no automatic canonical merge", () => {
  const other = structuredClone(b); other.name = "A公園喫煙所"; other.latitude += 0.0001;
  assert.deepEqual(crossSourceCandidates([a, other])[0].reasons, ["proximity100m", "normalizedName", "normalizedLocation"]);
  const before = JSON.stringify([a, b]);
  assert.equal(planCrossSourceMerge(candidate(), null, a.spotId), null);
  assert.equal(JSON.stringify([a, b]), before);
});
test("near + different evidence and same host distinct enclosures remain candidates only", () => {
  const other = structuredClone(b); other.name = "same convenience store south ashtray"; other.location = "south";
  other.evidence[0].existence = "independently reviewed south ashtray";
  assert.deepEqual(crossSourceCandidates([a, other])[0].reasons, ["proximity100m"]);
  for (const decision of ["distinctSpots", "insufficientEvidence"] as const) assert.equal(planCrossSourceMerge(candidate(), review(decision), a.spotId), null);
});
test("distant same name and same-source records are excluded", () => {
  const far = structuredClone(b); far.latitude = 34.69; far.longitude = 135.5;
  assert.deepEqual(crossSourceCandidates([a, far]), []);
  assert.deepEqual(crossSourceCandidates([a, { ...b, evidence: a.evidence }]), []);
});
test("same review preserves every source field, existence, attribution and stable ID with redirects/history", () => {
  const c = candidate(); c.spots[1].inboundRedirectIds = ["old-favorite"];
  const current = crossSourceCandidates(c.spots)[0];
  const decision = { ...review("sameRealWorldSpot"), candidateKey: current.key };
  const plan = planCrossSourceMerge(current, decision, a.spotId)!;
  assert.equal(plan.survivorId, a.spotId);
  assert.deepEqual(plan.redirects, [{ from: "old-favorite", to: a.spotId }, { from: b.spotId, to: a.spotId }]);
  assert.deepEqual(plan.evidence, [...a.evidence, ...b.evidence]); assert.deepEqual(plan.history, decision);
  assert.equal(plan.publication, "hold");
  assert.deepEqual(planCrossSourceMerge(current, decision, a.spotId), plan);
});
test("coordinates/hours/access/lifecycle/unknown conflicts never choose a winner", () => {
  const other = structuredClone(b); other.latitude += 0.0001;
  other.evidence[0].fields = { hours: "09:00-17:00", access: "customers", lifecycle: "removed", tobacco: false };
  const c = crossSourceCandidates([a, other])[0];
  const plan = planCrossSourceMerge(c, { ...review("sameRealWorldSpot"), candidateKey: c.key }, a.spotId)!;
  assert.deepEqual(plan.conflicts, ["coordinates", "access", "hours", "lifecycle", "tobacco"]);
  assert.equal(plan.publication, "hold"); assert.equal(plan.evidence[0].fields.tobacco, "unknown");
});
test("snapshot binding, identity evidence, survivor and invalid coordinates fail closed", () => {
  const c = candidate(); c.spots[1].name = "changed";
  assert.throws(() => planCrossSourceMerge(c, review("sameRealWorldSpot"), a.spotId), /stale/);
  assert.throws(() => planCrossSourceMerge(candidate(), { ...review("sameRealWorldSpot"), identityEvidence: " " }, a.spotId), /invalid review/);
  assert.throws(() => planCrossSourceMerge(candidate(), review("sameRealWorldSpot"), "new-id"), /survivor/);
  assert.throws(() => crossSourceCandidates([{ ...a, latitude: NaN }, b]), /invalid/);
  assert.throws(() => crossSourceCandidates([{ ...a, evidence: [{ ...a.evidence[0], existence: "" }] }, b]), /unreviewed/);
});
test("candidate reruns and input order are idempotent", () => {
  assert.deepEqual(crossSourceCandidates([b, a]), crossSourceCandidates([a, b]));
});
test("same business name can nominate distinct smoking spots but never confirms them", () => {
  const left = structuredClone(a), right = structuredClone(b);
  left.name = right.name = "Example convenience store";
  left.location = "north enclosure"; right.location = "south enclosure"; right.latitude += 0.0002;
  const c = crossSourceCandidates([left, right])[0];
  assert.equal(planCrossSourceMerge(c, null, left.spotId), null);
  assert.equal(planCrossSourceMerge(c, { ...review("distinctSpots"), candidateKey: c.key }, left.spotId), null);
});
test("100m-500m requires a name/location signal; farther matches never nominate", () => {
  const other = structuredClone(b); other.latitude += 0.003; other.name = "unrelated"; other.location = "other";
  assert.deepEqual(crossSourceCandidates([a, other]), []);
  other.name = a.name; assert.equal(crossSourceCandidates([a, other]).length, 1);
  other.latitude += 0.003; assert.deepEqual(crossSourceCandidates([a, other]), []);
});
