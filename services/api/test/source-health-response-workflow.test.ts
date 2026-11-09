// Offline observations for the manual Issue response procedure: no incident store or auto-resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSourceHealth, type HealthTarget } from "../src/source-health/check.ts";
import { evaluateResult, type SourceReview } from "../src/source-health/evaluate.ts";
import { checkRights, extractRightsScope, rightsFingerprint, withRights, type RightsContract, type RightsScope } from "../src/source-health/rights.ts";
import { productionHealthTargets } from "../scripts/source-health.ts";

const target = productionHealthTargets().find(t => t.adapter.registry.sourceId === "taito-public-smoking-areas")!;
const fixturePath = new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url);
const metadataPath = new URL("../../data-pipeline/source-health/review-metadata.json", import.meta.url);
const fixture = readFileSync(fixturePath);
const TODAY = "2026-11-09";
const scope: RightsScope = { kind: "htmlText", ranges: [{ start: "BEGIN", end: "END" }], requiredMarkers: ["TEST"] };
const page = (text: string) => `<h1>BEGIN</h1><p>TEST ${text}</p><footer>END</footer>`;
async function fingerprint(body: string) {
  const scoped = extractRightsScope(body, scope); assert.equal(scoped.ok, true);
  if (!scoped.ok) throw new Error("invalid synthetic scope");
  return rightsFingerprint(scoped.text);
}
async function setup() {
  const legal = page("synthetic reuse notice");
  const contract: RightsContract = { url: "https://example.invalid/terms", scope, reviewedFingerprint: await fingerprint(legal), reviewedAt: TODAY, reviewDueAt: "2099-01-01" };
  const review: SourceReview = { sourceId: target.adapter.registry.sourceId, rightsReviewedAt: TODAY, rightsEvidence: "synthetic",
    sourceObservedAt: TODAY, editionLabel: "synthetic", editionObservedAt: TODAY, reviewDueAt: "2099-01-01", reviewerNote: "synthetic",
    knownAdvisories: [], rights: [contract] };
  const before = { metadata: readFileSync(metadataPath), fixture: readFileSync(fixturePath), registry: JSON.stringify(target.adapter.registry), review: JSON.stringify(review) };
  const observe = async (dataStatus = 200, terms = legal, rightsStatus = 200, dataTarget: HealthTarget = target, body: BodyInit = fixture) => {
    const data = await checkSourceHealth(dataTarget, { fetch: async () => new Response(dataStatus === 200 ? body : null, {
      status: dataStatus, headers: { "content-type": dataTarget.pageFact ? "text/html" : "text/csv" } }) });
    const rights = await checkRights(contract, { fetch: async () => new Response(rightsStatus === 200 ? terms : null, {
      status: rightsStatus, headers: { "content-type": "text/html" } }) });
    return evaluateResult(withRights(data, [rights]), review, TODAY);
  };
  const unchanged = () => {
    assert.deepEqual(readFileSync(metadataPath), before.metadata);
    assert.deepEqual(readFileSync(fixturePath), before.fixture);
    assert.equal(JSON.stringify(target.adapter.registry), before.registry);
    assert.equal(JSON.stringify(review), before.review, "observations never update reviewed fingerprints or deadlines");
  };
  return { legal, contract, observe, unchanged };
}

test("repeat detections keep the same source/scope/reason for one manual response thread", async () => {
  const h = await setup();
  const first = await h.observe(503), second = await h.observe(503);
  assert.equal(first.status, "unavailable"); assert.equal(first.severity, "blocking");
  assert.deepEqual(first.blocking, ["http:503"]);
  assert.equal(first.sourceId, second.sourceId);
  assert.deepEqual(first.blocking, second.blocking);
  assert.equal(first.finalUrl, second.finalUrl);
  assert.equal("responseState" in second, false, "observation is not an acknowledgement or closure operation");
  h.unchanged();
});

test("fetch recovery clears availability signals only when the resource and notice can actually be checked", async () => {
  const h = await setup();
  const failed = await h.observe(503), recovered = await h.observe();
  assert.deepEqual(failed.blocking, ["http:503"]);
  assert.equal(recovered.status, "healthy"); assert.equal(recovered.severity, "ok");
  assert.deepEqual(recovered.blocking, []); assert.equal(recovered.rights![0].outcome, "unchanged");
  const recoveryWithDrift = await h.observe(200, page("synthetic new permission restriction"));
  assert.equal(recoveryWithDrift.status, "healthy", "the data request alone is healthy");
  assert.deepEqual(recoveryWithDrift.blocking, ["rightsChanged"], "a successful fetch cannot resolve other work");
  h.unchanged();
});

test("repeated rights drift remains blocking; an unavailable notice is not recovery or approval", async () => {
  const h = await setup(), changed = page("synthetic restricted reuse");
  const first = await h.observe(200, changed), repeat = await h.observe(200, changed);
  assert.deepEqual(first.blocking, ["rightsChanged"]); assert.deepEqual(repeat.blocking, first.blocking);
  assert.equal(first.rights![0].fingerprint, repeat.rights![0].fingerprint);
  assert.notEqual(first.rights![0].fingerprint, h.contract.reviewedFingerprint);
  const different = await h.observe(200, page("another synthetic restriction"));
  assert.notEqual(different.rights![0].fingerprint, first.rights![0].fingerprint, "same reason can contain new evidence needing fresh review");
  const unavailable = await h.observe(200, "", 503);
  assert.deepEqual(unavailable.blocking, ["rightsPage:http:503"]);
  assert.equal(unavailable.rights![0].fingerprint, null);
  assert.equal(unavailable.severity, "blocking"); h.unchanged();
});

test("repeated facility wording drift and missing scope never update facts or assert facility closure", async () => {
  const h = await setup(), original = page("synthetic outdoor smoking room");
  const dataTarget: HealthTarget = { ...target, url: "https://example.invalid/facility", mimeTypes: ["text/html"],
    pageFact: { scope, reviewedFingerprint: await fingerprint(original) } };
  const baseline = JSON.stringify(dataTarget.pageFact);
  const changed = page("synthetic room limited to facility customers");
  const first = await h.observe(200, h.legal, 200, dataTarget, changed), repeat = await h.observe(200, h.legal, 200, dataTarget, changed);
  assert.equal(first.status, "contentChanged"); assert.equal(first.severity, "advisory");
  assert.ok(first.advisory.includes("contentChanged")); assert.deepEqual(repeat.advisory, first.advisory);
  const missing = await h.observe(200, h.legal, 200, dataTarget, "maintenance");
  assert.equal(missing.pageFactScopeMissing, true); assert.equal(missing.severity, "blocking");
  assert.equal((await h.observe(404, h.legal, 200, dataTarget)).status, "unavailable");
  assert.equal(JSON.stringify(dataTarget.pageFact), baseline);
  h.unchanged();
});
