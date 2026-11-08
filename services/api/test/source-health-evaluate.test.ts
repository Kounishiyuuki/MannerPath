import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSourceHealth, type HealthResult } from "../src/source-health/check.ts";
import { buildReport, evaluateResult, jstDate, renderSummary, validateReviews, type SourceReview } from "../src/source-health/evaluate.ts";
import { productionHealthTargets, repositoryReviewedHealthTargets, sourceReviews } from "../scripts/source-health.ts";
import { ECDHE_AEAD_CIPHERS, ecdheAeadFetch } from "../scripts/source-health-transport.ts";

const targets = productionHealthTargets();
const target = targets.find(t => t.adapter.registry.sourceId === "taito-public-smoking-areas")!;
const fixture = readFileSync(new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url));
const response = (body: BodyInit | null = fixture, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/csv", ...headers } });
const TODAY = "2026-10-09";
const review = (overrides: Partial<SourceReview> = {}): SourceReview => ({ sourceId: target.adapter.registry.sourceId, rightsReviewedAt: "2026-10-09",
  rightsEvidence: "test", sourceObservedAt: "2026-08-18", editionLabel: null, editionObservedAt: "2026-10-09", reviewDueAt: "2027-01-09",
  reviewerNote: "test", knownAdvisories: [], rights: [], ...overrides });
const tlsFailure = (code: string) => async () => { throw new Error("fetch failed", { cause: { code, message: "private detail" } }); };
const check = (fetch: () => Promise<Response>, overrides = {}) => checkSourceHealth({ ...target, ...overrides }, { fetch });

test("transport TLS failure is classified symbolically and blocks when not a known limitation", async () => {
  const result = await check(tlsFailure("ERR_SSL_DH_KEY_TOO_SMALL"));
  assert.equal(result.signals.transportFailure, "tls"); assert.equal(result.signals.transportCode, "ERR_SSL_DH_KEY_TOO_SMALL");
  assert.equal(result.signals.rightsReviewRequired, false, "TLS failure is not a rights failure");
  const evaluated = evaluateResult(result, review(), TODAY);
  assert.equal(evaluated.severity, "blocking"); assert.deepEqual(evaluated.blocking, ["transport:tls(ERR_SSL_DH_KEY_TOO_SMALL)"]);
  const certificate = await check(tlsFailure("CERT_HAS_EXPIRED"));
  assert.equal(certificate.signals.transportFailure, "tls");
});
test("known TLS limitation is advisory only for its exact code and only until it expires", async () => {
  const known = review({ knownAdvisories: [{ signal: "transport:tls(ERR_SSL_DH_KEY_TOO_SMALL)", reason: "publisher DHE", recordedAt: "2026-10-09", expiresAt: "2026-11-09" }] });
  const evaluated = evaluateResult(await check(tlsFailure("ERR_SSL_DH_KEY_TOO_SMALL")), known, TODAY);
  assert.equal(evaluated.severity, "advisory"); assert.deepEqual(evaluated.advisory, ["known:transport:tls(ERR_SSL_DH_KEY_TOO_SMALL)"]);
  assert.equal(evaluateResult(await check(tlsFailure("ERR_TLS_CERT_ALTNAME_INVALID")), known, TODAY).severity, "blocking");
  const expired = evaluateResult(await check(tlsFailure("ERR_SSL_DH_KEY_TOO_SMALL")), known, "2026-11-09");
  assert.equal(expired.severity, "blocking"); assert.deepEqual(expired.blocking, ["transport:tls(ERR_SSL_DH_KEY_TOO_SMALL)", "knownAdvisoryExpired"]);
});
test("unknown transport, timeout and network failures are blocking without a known advisory", async () => {
  const unknown = await check(async () => { throw new Error("boom"); });
  assert.equal(unknown.signals.transportFailure, "unknown");
  assert.deepEqual(evaluateResult(unknown, review(), TODAY).blocking, ["transport:unknown"]);
  const reset = evaluateResult(await check(tlsFailure("ECONNRESET")), review(), TODAY);
  assert.equal(reset.severity, "blocking"); assert.deepEqual(reset.blocking, ["transport:network(ECONNRESET)"]);
  const timeout = evaluateResult(await checkSourceHealth(target, { timeoutMs: 5, fetch: () => new Promise(() => {}) }), review(), TODAY);
  assert.deepEqual(timeout.blocking, ["transport:timeout"]);
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
  const known403 = review({ knownAdvisories: [{ signal: "unexpectedAccessBlocked", reason: "catalog policy", recordedAt: "2026-10-09", expiresAt: "2026-12-09" }] });
  assert.equal(evaluateResult(await check(async () => response(null, 403)), known403, TODAY).severity, "advisory");
  assert.deepEqual(evaluateResult(await check(async () => response(null, 503)), review(), TODAY).blocking, ["http:503"]);
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
  const reviews = sourceReviews().map(item => ({ ...item, knownAdvisories: [] }));
  // Review metadata covers every health-configured source, deployed or repository-reviewed (Komatsu).
  validateReviews(reviews, repositoryReviewedHealthTargets().map(t => t.adapter.registry.sourceId));
  // A same-origin move is advisory; clone one healthy moved result per source.
  let calls = 0;
  const moved = await check(async () => ++calls === 1 ? response("", 301, { location: "/moved.csv" }) : response());
  const results: HealthResult[] = targets.map(item => ({ ...moved, sourceId: item.adapter.registry.sourceId }));
  const advisoryOnly = buildReport(results, reviews, TODAY);
  assert.equal(advisoryOnly.exitCode, 0); assert.equal(advisoryOnly.results.length, 6); assert.equal(advisoryOnly.summary.advisory.length, 6);
  results[0] = await checkSourceHealth(targets[0], { fetch: async () => response("changed,header\n1,2") });
  const blocked = buildReport(results, reviews, TODAY);
  assert.equal(blocked.exitCode, 1); assert.deepEqual(blocked.summary.blocking, [targets[0].adapter.registry.sourceId]);
  assert.equal(blocked.results.length, 6, "a blocker does not stop later sources");
  assert.match(renderSummary(blocked), /BLOCKING/);
});
test("review metadata must cover every source with valid dates", () => {
  const ids = repositoryReviewedHealthTargets().map(t => t.adapter.registry.sourceId);
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

test("operator queue uses existing severity, gives distinct checks and leaves JSON untouched", async () => {
  const healthy = await check(async () => response());
  const results: HealthResult[] = [
    { ...healthy, sourceId: "z-normal" },
    { ...healthy, sourceId: "c-content", status: "contentChanged", signals: { ...healthy.signals, contentChanged: true } },
    { ...healthy, sourceId: "b-fetch", status: "unavailable", httpStatus: 503, signals: { ...healthy.signals, serverError: true } },
    { ...healthy, sourceId: "a-rights", signals: { ...healthy.signals, rightsChanged: true } },
    { ...healthy, sourceId: "d-due" },
  ];
  const report = buildReport(results, results.map(r => review({ sourceId: r.sourceId, reviewDueAt: r.sourceId === "d-due" ? TODAY : "2027-01-09" })), TODAY);
  const before = JSON.stringify(report);
  const markdown = renderSummary(report, results.map(r => ({ sourceId: r.sourceId, dataUrl: `https://official.example/${r.sourceId}`, rightsUrls: ["https://official.example/terms"] })));
  assert.equal(JSON.stringify(report), before);
  assert.deepEqual(report.summary.blocking, ["b-fetch", "a-rights"], "existing report order and exit code stay intact");
  assert.equal(report.exitCode, 1);
  const queue = markdown.split("### 詳細")[0];
  assert.ok(queue.indexOf("a-rights") < queue.indexOf("b-fetch"));
  assert.ok(queue.indexOf("b-fetch") < queue.indexOf("c-content"));
  assert.ok(queue.indexOf("c-content") < queue.indexOf("z-normal"));
  assert.match(queue, /取得失敗は施設閉鎖ではない/);
  assert.match(queue, /文言変更だけでfixtureを更新しない/);
  assert.match(queue, /住所\/設備の範囲変更/);
  assert.match(queue, /期限到来は公開失効ではなく/);
  assert.match(queue, /3 正常/);
  const contentRow = queue.split("\n").find(line => line.includes("| c-content |"))!;
  assert.match(contentRow, /https:\/\/official.example\/c-content/);
  assert.doesNotMatch(contentRow, /official.example\/terms/);
  const rightsRow = queue.split("\n").find(line => line.includes("| a-rights |"))!;
  assert.match(rightsRow, /official.example\/terms/);
});

test("summary uses configured URLs only and excludes credentials, queries, fragments and raw observations", async () => {
  const result = await check(async () => response());
  result.finalUrl = "https://redirect.example/PRIVATE_REDIRECT";
  result.redirects = [{ url: "https://other.example/PRIVATE_ORIGIN", status: 302, location: result.finalUrl }];
  result.notes.push("PRIVATE_NOTE <script>response body</script>");
  const report = buildReport([result], [review()], TODAY);
  const context = [{ sourceId: result.sourceId, dataUrl: "https://official.example/data?token=PRIVATE_QUERY#PRIVATE_FRAGMENT", rightsUrls: [] }];
  const output = renderSummary(report, context);
  assert.match(output, /https:\/\/official.example\/data/);
  assert.doesNotMatch(output, /PRIVATE_|redirect.example|other.example|<script>/);
  assert.equal(context[0].dataUrl, "https://official.example/data?token=PRIVATE_QUERY#PRIVATE_FRAGMENT");
  for (const dataUrl of ["https://user:PRIVATE_PASSWORD@official.example/", "javascript:PRIVATE_SCRIPT", "not a URL"]) {
    const omitted = renderSummary(report, [{ sourceId: result.sourceId, dataUrl, rightsUrls: [] }]);
    assert.match(omitted, /URL omitted/); assert.doesNotMatch(omitted, /PRIVATE_|user:/);
  }
  assert.doesNotMatch(renderSummary(report), /PRIVATE_REDIRECT/, "missing trusted context never falls back to final URL");
});

test("summary table escapes markup and cannot gain rows from configured labels", async () => {
  const healthy = await check(async () => response());
  const sourceId = "test|`label`\n<img src=x>";
  const report = buildReport([{ ...healthy, sourceId }], [review({ sourceId })], TODAY);
  const output = renderSummary(report, [{ sourceId, dataUrl: "https://official.example/a|b", rightsUrls: [] }]);
  assert.doesNotMatch(output, /<img|`label`|test\|/);
  assert.match(output, /test&#124;&#96;label&#96; &lt;img src=x&gt;/);
  assert.match(output, /official.example\/a&#124;b/);
});
