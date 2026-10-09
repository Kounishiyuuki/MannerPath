// Health checks use committed fixtures and injected transports only; no live network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { boundedDownload, probePayload, classifyHealth, HEALTH_SOURCES, auditSource, deterministicJson } from "../scripts/source-health-lib.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${path}`, import.meta.url)));
const baseline = fixture("taito-public-smoking-areas/20260818_koshukitsuenjo.csv");
const url = "https://official.example/resource.csv";
const csvResponse = (bytes = baseline) => new Response(bytes, { headers: { "content-type": "text/csv; charset=utf-8" } });
const counts = new Map([
  ["taito-public-smoking-areas", [34, 34]], ["osaka-designated-smoking-areas", [524, 344]],
  ["koto-station-smoking-areas", [3, 3]], ["musashino-public-smoking-areas", [25, 3]],
  ["minato-designated-smoking-areas", [169, 114]], ["kyoto-public-smoking-places", [1777, 17]],
]);

test("all six reviewed sources have offline fixture schema, parser and content baselines", async () => {
  assert.equal(HEALTH_SOURCES.length, 6);
  assert.deepEqual(new Set(HEALTH_SOURCES.map((s) => s.adapter.registry.sourceId)), new Set(counts.keys()));
  for (const source of HEALTH_SOURCES) {
    const report = await auditSource(source, { live: false, fetchImpl: async () => { throw new Error("offline must not fetch"); } });
    assert.equal(report.status, "healthy");
    assert.equal(report.rights.status, "reviewedBaseline");
    assert.equal(report.probe?.schema, "same");
    assert.equal(report.probe?.parser, "pass");
    assert.equal(report.probe?.content, "same");
    assert.equal(report.probe?.rowCount, counts.get(source.sourceId)?.[0]);
    assert.equal(report.probe?.observationCount, counts.get(source.sourceId)?.[1]);
  }
});

test("payload probe verifies SHA256 and every selected observation", () => {
  const probe = probePayload(TAITO_ADAPTER, baseline, baseline);
  assert.equal(probe.sha256, createHash("sha256").update(baseline).digest("hex"));
  assert.equal(probe.schema, "same");
  assert.equal(probe.parser, "pass");
  assert.equal(probe.content, "same");
  assert.equal(probe.rowCount, 34);
  assert.equal(probe.observationCount, 34);
});

test("schema drift and invalid coordinates are distinct probe failures", () => {
  const changedHeader = new TextEncoder().encode(new TextDecoder().decode(baseline).replace("名称カナ", "renamed-column"));
  assert.equal(probePayload(TAITO_ADAPTER, changedHeader, baseline).schema, "changed");
  const rows = TAITO_ADAPTER.parse(baseline);
  rows.rows[0][rows.header.indexOf("緯度")] = "invalid";
  const encode = (cells: string[]) => cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",");
  const invalid = new TextEncoder().encode([rows.header, ...rows.rows].map(encode).join("\r\n"));
  const probe = probePayload(TAITO_ADAPTER, invalid, baseline);
  assert.equal(probe.schema, "same");
  assert.equal(probe.parser, "fail");
  assert.equal(probe.content, "changed");
});

test("bounded download validates media type and returns exact bytes", async () => {
  const result = await boundedDownload(url, { fetchImpl: async () => csvResponse(), expectedTypes: ["text/csv"] });
  assert.equal(result.status, 200);
  assert.deepEqual(new Uint8Array(result.bytes), baseline);
  await assert.rejects(boundedDownload(url, { fetchImpl: async () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }), expectedTypes: ["text/csv"] }), /content.type/i);
});

test("HTTP failures preserve their status without parsing an HTML error page", async () => {
  for (const status of [403, 404, 410, 429, 500, 503]) {
    const result = await boundedDownload(url, { fetchImpl: async () => new Response("error", { status, headers: { "content-type": "text/html" } }), expectedTypes: ["text/csv"] });
    assert.equal(result.status, status);
  }
});

test("declared and streamed oversized responses are rejected", async () => {
  await assert.rejects(boundedDownload(url, { maxBytes: 3, fetchImpl: async () => new Response("four", { headers: { "content-length": "4" } }) }), /byte|size|limit/i);
  await assert.rejects(boundedDownload(url, { maxBytes: 3, fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close(); } })) }), /byte|size|limit/i);
});

test("redirects are manual, bounded and limited to HTTP(S)", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, "manual");
    calls++;
    return new Response(null, { status: 302, headers: { location: "/next.csv" } });
  };
  await assert.rejects(boundedDownload(url, { maxRedirects: 1, fetchImpl }), /redirect/i);
  assert.equal(calls, 2);
  await assert.rejects(boundedDownload(url, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "file:///tmp/private" } }) }), /protocol|https?|cross-origin/i);
});

test("timeout covers both connection and body streaming", async () => {
  const abortingFetch: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("timeout abort")), { once: true });
  });
  await assert.rejects(boundedDownload(url, { timeoutMs: 20, fetchImpl: abortingFetch }), /timeout|abort/i);
  await assert.rejects(boundedDownload(url, { timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ start() {} })) }), /timeout|abort/i);
});

const good = { availability: "available", moved: false, schema: "same", content: "same", rights: "reviewedBaseline" } as const;
test("classification requires affirmative removal and rights evidence", () => {
  assert.equal(classifyHealth(good), "healthy");
  assert.equal(classifyHealth({ ...good, moved: true }), "moved");
  assert.equal(classifyHealth({ ...good, availability: "accessBlocked" }), "accessBlocked");
  assert.equal(classifyHealth({ ...good, availability: "temporarilyUnavailable" }), "temporarilyUnavailable");
  assert.equal(classifyHealth({ ...good, availability: "notFound" }), "unknown");
  assert.equal(classifyHealth({ ...good, availability: "unknown" }), "unknown");
  assert.equal(classifyHealth({ ...good, schema: "changed" }), "schemaChanged");
  assert.equal(classifyHealth({ ...good, content: "changed" }), "contentChanged");
  assert.equal(classifyHealth({ ...good, rights: "changed" }), "rightsReviewRequired");
  assert.equal(classifyHealth({ ...good, rights: "reviewRequired" }), "rightsReviewRequired");
  assert.equal(classifyHealth({ ...good, availability: "notFound", removedEvidence: true }), "removed");
  assert.notEqual(classifyHealth({ ...good, availability: "accessBlocked", rights: "unknown" }), "removed");
});


test("live-shaped audits preserve blocked/notFound results and unverified rights", async () => {
  const source = HEALTH_SOURCES.find((s) => s.sourceId === "taito-public-smoking-areas")!;
  for (const [httpStatus, expected] of [[403, "accessBlocked"], [404, "unknown"], [410, "unknown"], [503, "temporarilyUnavailable"]] as const) {
    const report = await auditSource(source, { live: true, fetchImpl: async () => new Response("error", { status: httpStatus }) });
    assert.equal(report.status, expected);
    assert.equal(report.httpStatus, httpStatus);
    assert.equal(report.probe, null);
    assert.equal(report.rights.status, "unknown");
  }
  const report = await auditSource(source, { live: true, fetchImpl: async () => csvResponse() });
  assert.equal(report.probe?.content, "same");
  assert.equal(report.rights.status, "unknown");
  assert.equal(report.freshness.currentOperationConfirmed, false);
});

test("a same-publisher redirect is moved only after valid payload probes", async () => {
  const source = HEALTH_SOURCES.find((s) => s.sourceId === "taito-public-smoking-areas")!;
  let requests = 0;
  const report = await auditSource(source, { live: true, fetchImpl: async (input) => String(input) === source.dataUrl && ++requests === 1
    ? new Response(null, { status: 302, headers: { location: "/successor.csv" } }) : csvResponse() });
  assert.equal(report.status, "moved");
  assert.equal(report.redirects, 1);
  assert.equal(report.finalUrl, new URL("/successor.csv", source.dataUrl).href);
  assert.equal(report.probe?.parser, "pass");
});

test("deterministic JSON recursively sorts object keys and preserves source ordering", async () => {
  assert.equal(deterministicJson({ z: [{ b: 2, a: 1 }], a: 0 }), deterministicJson({ a: 0, z: [{ a: 1, b: 2 }] }));
  assert.notEqual(deterministicJson([1, 2]), deterministicJson([2, 1]));
  const source = HEALTH_SOURCES[0];
  const options = { live: false, fetchImpl: async () => { throw new Error("no network"); } };
  assert.equal(deterministicJson(await auditSource(source, options)), deterministicJson(await auditSource(source, options)));
});

test("same-schema changed content remains distinguishable from parser failure", () => {
  const changed = new TextEncoder().encode(new TextDecoder().decode(baseline).replace("台東区", "台東区 "));
  const probe = probePayload(TAITO_ADAPTER, changed, baseline);
  assert.equal(probe.schema, "same");
  assert.equal(probe.parser, "pass");
  assert.equal(probe.content, "changed");
  const malformed = probePayload(TAITO_ADAPTER, new TextEncoder().encode('"unterminated'), baseline);
  assert.equal(malformed.parser, "fail");
  assert.ok(malformed.error);
});

test("download rejects invalid limits, absent content types and publisher changes", async () => {
  for (const options of [{ maxBytes: 0 }, { timeoutMs: 0 }, { maxRedirects: -1 }, { maxBytes: NaN }]) {
    await assert.rejects(boundedDownload(url, { ...options, fetchImpl: async () => { throw new Error("must not fetch"); } }), /invalid.*limit/i);
  }
  await assert.rejects(boundedDownload(url, { expectedTypes: ["text/csv"], fetchImpl: async () => new Response(new Uint8Array([1])) }), /content.type/i);
  await assert.rejects(boundedDownload(url, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://other.example/data.csv" } }) }), /cross-origin/i);
  await assert.rejects(boundedDownload(url, { fetchImpl: async () => new Response(null, { status: 302 }) }), /location/i);
});


test("rights fingerprints detect drift without asserting legal expiry", async () => {
  const source = HEALTH_SOURCES[0];
  const fetchImpl: typeof fetch = async (input) => String(input) === source.dataUrl ? csvResponse() : new Response("reviewed terms", { headers: { "content-type": "text/html" } });
  const initial = await auditSource(source, { live: true, fetchImpl });
  assert.ok(initial.rights.fingerprints.length > 0);
  const same = await auditSource(source, { live: true, fetchImpl, previous: initial });
  assert.equal(same.rights.status, "unchanged");
  const changed = await auditSource(source, { live: true, previous: initial, fetchImpl: async (input) => String(input) === source.dataUrl ? csvResponse() : new Response("different terms", { headers: { "content-type": "text/html" } }) });
  assert.equal(changed.status, "rightsReviewRequired");
  assert.equal(changed.rights.status, "reviewRequired");
  assert.equal(changed.probe?.content, "same");
  const blocked = await auditSource(source, { live: true, previous: initial, fetchImpl: async (input) => String(input) === source.dataUrl ? csvResponse() : new Response("blocked", { status: 403 }) });
  assert.equal(blocked.rights.status, "unknown");
  assert.notEqual(blocked.status, "removed");
});

test("previous download fingerprint detects drift even with unchanged reviewed fixture", async () => {
  const source = HEALTH_SOURCES[0];
  const report = await auditSource(source, { live: true, previous: { sourceId: source.sourceId, downloadSha256: "0".repeat(64) }, fetchImpl: async () => csvResponse() });
  assert.equal(report.status, "contentChanged");
  assert.equal(report.probe?.content, "same");
});

test("Musashino ZIP transport probes the committed nested KML baseline", async () => {
  const source = HEALTH_SOURCES.find((s) => s.sourceId === "musashino-public-smoking-areas")!;
  const zip = fixture("musashino-public-smoking-areas/toilet.zip");
  const report = await auditSource(source, { live: true, fetchImpl: async (input) => String(input) === source.dataUrl
    ? new Response(zip, { headers: { "content-type": "application/zip" } })
    : new Response("terms", { headers: { "content-type": "text/html" } }) });
  assert.equal(report.status, "healthy");
  assert.equal(report.downloadSha256, createHash("sha256").update(zip).digest("hex"));
  assert.equal(report.probe?.schema, "same");
  assert.equal(report.probe?.content, "same");
  assert.equal(report.probe?.rowCount, 25);
  assert.equal(report.probe?.observationCount, 3);
});

test("Kyoto uses reviewed POST form and validates application/force-download payload", async () => {
  const source = HEALTH_SOURCES.find((s) => s.sourceId === "kyoto-public-smoking-places")!;
  const bytes = fixture("kyoto-public-smoking-places/20260903_shisetsu.csv");
  const report = await auditSource(source, { live: true, fetchImpl: async (input, init) => {
    if (String(input) !== source.dataUrl) return new Response("terms", { headers: { "content-type": "text/html" } });
    assert.equal(init?.method, "POST");
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("upload_file"), "20260903182354_data（令和8年9月3日現在）.csv");
    assert.equal(form.get("download"), "このデータをダウンロード");
    return new Response(bytes, { headers: { "content-type": "application/force-download" } });
  } });
  assert.equal(report.status, "healthy");
  assert.equal(report.probe?.content, "same");
  assert.equal(report.probe?.observationCount, 17);
});

test("a stalled stream cancellation cannot bypass download deadlines", async () => {
  const stalled = () => new ReadableStream<Uint8Array>({ start() {}, cancel() { return new Promise(() => {}); } });
  const cases = [
    { response: () => new Response(stalled()), options: {} },
    { response: () => new Response(stalled(), { status: 302, headers: { location: "/next" } }), options: {} },
    { response: () => new Response(stalled(), { headers: { "content-type": "text/html" } }), options: { expectedTypes: ["text/csv"] } },
    { response: () => new Response(stalled(), { headers: { "content-length": "100" } }), options: { maxBytes: 1 } },
  ];
  for (const scenario of cases) {
    let timer: ReturnType<typeof setTimeout>;
    try {
      const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cleanup exceeded deadline")), 250); });
      await assert.rejects(Promise.race([boundedDownload(url, { timeoutMs: 20, fetchImpl: async () => scenario.response(), ...scenario.options }), guard]), (error: Error) => {
        assert.notEqual(error.message, "cleanup exceeded deadline");
        return true;
      });
    } finally { clearTimeout(timer!); }
  }
});

test("Osaka accepts its publisher CSV media type and probes the reviewed corpus", async () => {
  const source = HEALTH_SOURCES.find((s) => s.sourceId === "osaka-designated-smoking-areas")!;
  const bytes = fixture("osaka-designated-smoking-areas/opendata_1012.csv");
  const report = await auditSource(source, { live: true, fetchImpl: async (input) => String(input) === source.dataUrl
    ? new Response(bytes, { headers: { "content-type": "text/comma-separated-values" } })
    : new Response("terms", { headers: { "content-type": "text/html" } }) });
  assert.equal(report.status, "healthy");
  assert.equal(report.probe?.content, "same");
  assert.equal(report.probe?.rowCount, 524);
  assert.equal(report.probe?.observationCount, 344);
});

test("transport diagnostics retain actionable TLS codes without volatile cause details", async () => {
  const source = HEALTH_SOURCES[0];
  const report = await auditSource(source, { live: true, fetchImpl: async (input) => {
    if (String(input) !== source.dataUrl) return new Response("terms", { headers: { "content-type": "text/html" } });
    throw new Error("fetch failed", { cause: Object.assign(new Error("volatile address OpenSSL"), { code: "ERR_SSL_DH_KEY_TOO_SMALL" }) });
  } });
  assert.equal(report.status, "temporarilyUnavailable");
  assert.match(report.error ?? "", /ERR_SSL_DH_KEY_TOO_SMALL/);
  assert.doesNotMatch(report.error ?? "", /volatile address/);
  assert.ok(report.rights.fingerprints.every((page) => page.sha256 !== null));
});
