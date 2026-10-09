import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSourceHealth, type HealthResult } from "../src/source-health/check.ts";
import { buildReport, evaluateResult, jstDate, renderSummary, validateReviews, type SourceReview } from "../src/source-health/evaluate.ts";
import { productionHealthTargets, sourceReviews } from "../scripts/source-health.ts";
import { ECDHE_AEAD_CIPHERS, ecdheAeadFetch } from "../scripts/source-health-transport.ts";

const targets = productionHealthTargets();
const target = targets.find(t => t.adapter.registry.sourceId === "taito-public-smoking-areas")!;
const fixture = readFileSync(new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url));
const response = (body: BodyInit | null = fixture, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/csv", ...headers } });
const TODAY = "2026-10-09";
const review = (overrides: Partial<SourceReview> = {}): SourceReview => ({ sourceId: target.adapter.registry.sourceId, rightsReviewedAt: "2026-10-09",
  rightsEvidence: "test", sourceObservedAt: "2026-08-18", editionLabel: null, editionObservedAt: "2026-10-09", reviewDueAt: "2027-01-09",
  reviewerNote: "test", knownAdvisories: [], ...overrides });
const tlsFailure = (code: string) => async () => { throw new Error("fetch failed", { cause: { code, message: "private detail" } }); };
const check = (fetch: () => Promise<Response>, overrides = {}) => checkSourceHealth({ ...target, ...overrides }, { fetch });

test("transport TLS failure is classified symbolically and blocks when not a known limitation", async () => {
  const result = await check(tlsFailure("ERR_SSL_DH_KEY_TOO_SMALL"));
  assert.equal(result.signals.transportFailure, "tls"); assert.equal(result.signals.transportCode, "ERR_SSL_DH_KEY_TOO_SMALL");
  assert.equal(result.signals.rightsReviewRequired, false, "TLS failure is not a rights failure");
  const evaluated = evaluateResult(result, review(), TODAY);
  assert.equal(evaluated.severity, "blocking"); assert.deepEqual(evaluated.blocking, ["transport:tls"]);
  const certificate = await check(tlsFailure("CERT_HAS_EXPIRED"));
  assert.equal(certificate.signals.transportFailure, "tls");
});
test("known TLS limitation is advisory and only for its exact code", async () => {
  const known = review({ knownAdvisories: [{ kind: "transport", code: "ERR_SSL_DH_KEY_TOO_SMALL", note: "publisher DHE", reviewDueAt: "2027-01-09" }] });
  const evaluated = evaluateResult(await check(tlsFailure("ERR_SSL_DH_KEY_TOO_SMALL")), known, TODAY);
  assert.equal(evaluated.severity, "advisory"); assert.deepEqual(evaluated.advisory, ["knownTransportLimitation"]);
  assert.equal(evaluateResult(await check(tlsFailure("ERR_TLS_CERT_ALTNAME_INVALID")), known, TODAY).severity, "blocking");
  const expired = evaluateResult(await check(tlsFailure("ERR_SSL_DH_KEY_TOO_SMALL")), known, "2027-01-09");
  assert.equal(expired.severity, "advisory"); assert.ok(expired.advisory.includes("humanReviewDue"));
});
test("unknown transport failure is never swallowed; transient network failure is advisory", async () => {
  const unknown = await check(async () => { throw new Error("boom"); });
  assert.equal(unknown.signals.transportFailure, "unknown");
  assert.deepEqual(evaluateResult(unknown, review(), TODAY).blocking, ["transport:unknown"]);
  const reset = evaluateResult(await check(tlsFailure("ECONNRESET")), review(), TODAY);
  assert.equal(reset.severity, "advisory"); assert.deepEqual(reset.advisory, ["transient:network"]);
  const timeout = evaluateResult(await checkSourceHealth(target, { timeoutMs: 5, fetch: () => new Promise(() => {}) }), review(), TODAY);
  assert.deepEqual(timeout.advisory, ["transient:timeout"]);
  const oversized = evaluateResult(await checkSourceHealth(target, { maxBytes: 5, fetch: async () => response() }), review(), TODAY);
  assert.deepEqual(oversized.blocking, ["transport:sizeLimit"]);
});
test("moved + contentChanged keeps both signals and stays advisory", async () => {
  let calls = 0;
  const result = await check(async () => ++calls === 1 ? response("", 301, { location: "/moved.csv" }) : response(), { baselineSha256: "0".repeat(64) });
  assert.equal(result.status, "moved");
  assert.equal(result.signals.moved, true); assert.equal(result.signals.contentChanged, true); assert.equal(result.signals.schemaCompatible, true);
  const evaluated = evaluateResult(result, review(), TODAY);
  assert.equal(evaluated.severity, "advisory"); assert.deepEqual(evaluated.advisory, ["moved", "contentChanged"]);
});
test("moved + schemaChanged keeps moved and blocks on schema", async () => {
  let calls = 0;
  const result = await check(async () => ++calls === 1 ? response("", 302, { location: "/moved.csv" }) : response("changed,header\n1,2"));
  assert.equal(result.status, "schemaChanged"); assert.equal(result.signals.moved, true);
  const evaluated = evaluateResult(result, review(), TODAY);
  assert.equal(evaluated.severity, "blocking"); assert.deepEqual(evaluated.blocking, ["parserIncompatible"]); assert.ok(evaluated.advisory.includes("moved"));
});
test("rights regression, removal-equivalent 404, unexpected 403 and MIME are blocking", async () => {
  const cross = evaluateResult(await check(async () => response("", 302, { location: "https://example.org/x.csv" })), review(), TODAY);
  assert.deepEqual(cross.blocking, ["crossOriginRelocation"]);
  const missingRights = await checkSourceHealth({ ...target, adapter: { ...target.adapter, registry: { ...target.adapter.registry, licenseUrl: null } } }, { fetch: async () => response() });
  assert.deepEqual(evaluateResult(missingRights, review(), TODAY).blocking, ["rightsMetadataMissing"]);
  assert.deepEqual(evaluateResult(await check(async () => response(null, 404)), review(), TODAY).blocking, ["resourceMissing"]);
  assert.deepEqual(evaluateResult(await check(async () => response(null, 403)), review(), TODAY).blocking, ["unexpectedAccessBlocked"]);
  assert.deepEqual(evaluateResult(await check(async () => response(null, 405)), review(), TODAY).blocking, ["http:405"]);
  assert.deepEqual(evaluateResult(await check(async () => response("<html>", 200, { "content-type": "text/html" })), review(), TODAY).blocking, ["unexpectedMime"]);
  const known403 = review({ knownAdvisories: [{ kind: "accessBlocked", note: "catalog policy", reviewDueAt: "2027-01-09" }] });
  assert.equal(evaluateResult(await check(async () => response(null, 403)), known403, TODAY).severity, "advisory");
  assert.deepEqual(evaluateResult(await check(async () => response(null, 503)), review(), TODAY).advisory, ["serverError"]);
});
test("humanReviewDue boundary is inclusive on the due JST day", async () => {
  const healthy = await check(async () => response());
  assert.equal(evaluateResult(healthy, review(), "2027-01-08").review.humanReviewDue, false);
  assert.equal(evaluateResult(healthy, review(), "2027-01-08").severity, "ok");
  const due = evaluateResult(healthy, review(), "2027-01-09");
  assert.equal(due.review.humanReviewDue, true); assert.equal(due.severity, "advisory"); assert.deepEqual(due.advisory, ["humanReviewDue"]);
  assert.equal(jstDate(new Date("2027-01-08T14:59:59Z")), "2027-01-08");
  assert.equal(jstDate(new Date("2027-01-08T15:00:00Z")), "2027-01-09");
  const unknownObservation = evaluateResult(healthy, review({ sourceObservedAt: null }), TODAY);
  assert.equal(unknownObservation.severity, "ok", "unknown observation date is surfaced but not noisy"); assert.deepEqual(unknownObservation.advisory, ["observationDateUnknown"]);
});
test("all-source aggregation: advisory-only exits 0, any blocker exits 1, every source reported", async () => {
  const reviews = sourceReviews();
  validateReviews(reviews, targets.map(t => t.adapter.registry.sourceId));
  const results: HealthResult[] = [];
  for (const item of targets) results.push(await checkSourceHealth(item, { fetch: async () => response(null, 503) }));
  const advisoryOnly = buildReport(results, reviews, TODAY);
  assert.equal(advisoryOnly.exitCode, 0); assert.equal(advisoryOnly.results.length, 6); assert.equal(advisoryOnly.summary.advisory.length, 6);
  results[0] = await checkSourceHealth(targets[0], { fetch: async () => response("changed,header\n1,2") });
  const blocked = buildReport(results, reviews, TODAY);
  assert.equal(blocked.exitCode, 1); assert.deepEqual(blocked.summary.blocking, [targets[0].adapter.registry.sourceId]);
  assert.equal(blocked.results.length, 6, "a blocker does not stop later sources");
  assert.match(renderSummary(blocked), /BLOCKING/);
});
test("review metadata must cover every source with valid dates", () => {
  const ids = targets.map(t => t.adapter.registry.sourceId);
  assert.throws(() => validateReviews(sourceReviews().slice(1), ids));
  assert.throws(() => validateReviews(sourceReviews().map((r, i) => i ? r : { ...r, reviewDueAt: "2027-13-40" }), ids));
});
test("workflow JSON and summary carry no raw source body or private error detail", async () => {
  const results = [await check(async () => response(), { baselineSha256: "0".repeat(64) }), await check(tlsFailure("ERR_SSL_DH_KEY_TOO_SMALL"))];
  const report = buildReport(results, [review()], TODAY);
  const output = JSON.stringify(report) + renderSummary(report);
  const firstRow = fixture.toString("utf8").split(/\r?\n/)[1];
  for (const cell of firstRow.split(",").filter(cell => cell.length > 3)) assert.ok(!output.includes(cell), "no raw row value");
  assert.ok(!output.includes("private detail"));
  assert.deepEqual(Object.keys(report), ["version", "evaluatedOn", "exitCode", "summary", "results"]);
});
test("hardened transport offers only ECDHE AEAD suites and refuses unsafe inputs without network", async () => {
  for (const cipher of ECDHE_AEAD_CIPHERS.split(":")) assert.match(cipher, /^ECDHE-(RSA|ECDSA)-(AES(128|256)-GCM-SHA(256|384)|CHACHA20-POLY1305)$/);
  await assert.rejects(ecdheAeadFetch("http://example.org/x.csv"), /HTTPS resource required/);
  await assert.rejects(ecdheAeadFetch("https://example.org/x.csv", { body: new Uint8Array(1) }), /string request bodies/);
  const source = readFileSync(new URL("../scripts/source-health-transport.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /rejectUnauthorized:\s*false|SECLEVEL|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity/);
});
