// Unified availability + scoped rights drift monitoring (supersedes #223/#225). Offline only: every fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { checkSourceHealth, type HealthResult } from "../src/source-health/check.ts";
import { buildReport, evaluateResult, validateReviews, type SourceReview } from "../src/source-health/evaluate.ts";
import { checkRights, extractRightsScope, rightsFingerprint, withRights, type RightsContract } from "../src/source-health/rights.ts";
import { liveTransport, main, productionHealthTargets, sourceReviews } from "../scripts/source-health.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const TODAY = "2026-10-09";
const targets = productionHealthTargets();
const ids = targets.map(t => t.adapter.registry.sourceId);
const byId = (id: string) => targets.find(t => t.adapter.registry.sourceId === id)!;
const reviews = sourceReviews();
const reviewOf = (id: string) => reviews.find(r => r.sourceId === id)!;
const taito = byId("taito-public-smoking-areas");
const fixture = readFileSync(new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url));
const csv = (status = 200, headers: Record<string, string> = {}) => new Response(status === 200 ? fixture : null, { status, headers: { "content-type": "text/csv", ...headers } });
const plain = (overrides: Partial<SourceReview> = {}): SourceReview => ({ ...reviewOf("taito-public-smoking-areas"), knownAdvisories: [], rights: [], ...overrides });
const failing = (code: string) => async () => { throw new Error("fetch failed", { cause: { code } }); };
const allSources = async (fetch: () => Promise<Response>) => {
  const results: HealthResult[] = [];
  for (const target of targets) results.push(await checkSourceHealth(target, { fetch, timeoutMs: 50 }));
  return results;
};

// ---- Availability: unknown failures block; only explicit expiring advisories downgrade.

test("all six sources 503, connection refused or DNS failure exit 1", async () => {
  for (const fetch of [async () => csv(503), failing("ECONNREFUSED"), failing("ENOTFOUND")]) {
    const report = buildReport(await allSources(fetch), reviews, TODAY);
    assert.equal(report.exitCode, 1); assert.equal(report.summary.blocking.length, 6, "Osaka's timeout advisory covers no other failure");
  }
});
test("unknown ENOTFOUND / ECONNREFUSED are blocking", async () => {
  for (const code of ["ENOTFOUND", "ECONNREFUSED"]) {
    const report = buildReport([await checkSourceHealth(taito, { fetch: failing(code) })], [plain()], TODAY);
    assert.equal(report.exitCode, 1); assert.deepEqual(report.results[0].blocking, [`transport:network(${code})`]);
  }
});
test("Osaka known runner timeout is advisory while active and blocking from expiresAt", async () => {
  const osaka = byId("osaka-designated-smoking-areas");
  const known = reviewOf(osaka.adapter.registry.sourceId).knownAdvisories;
  assert.ok(known.length && known.every(item => item.expiresAt === "2026-11-09"), "explicit, dated expiry");
  const timeout = await checkSourceHealth(osaka, { timeoutMs: 5, fetch: () => new Promise(() => {}) });
  const active = buildReport([timeout], reviews, TODAY);
  assert.equal(active.exitCode, 0); assert.deepEqual(active.results[0].advisory.filter(a => a.startsWith("known:")), ["known:transport:timeout"]);
  assert.equal(buildReport([timeout], reviews, "2026-11-08").exitCode, 0);
  const expired = buildReport([timeout], reviews, "2026-11-09");
  assert.equal(expired.exitCode, 1); assert.deepEqual(expired.results[0].blocking, ["transport:timeout", "knownAdvisoryExpired"]);
  // The same advisory never covers a different failure on the same source.
  assert.equal(buildReport([await checkSourceHealth(osaka, { fetch: async () => csv(503) })], reviews, TODAY).exitCode, 1);
});
test("unexplained HTTP statuses fail closed; 429 is explicitly rateLimited", async () => {
  for (const status of [300, 304, 418, 500, 503, 204]) {
    const evaluated = evaluateResult(await checkSourceHealth(taito, { fetch: async () => new Response(null, { status, headers: { "content-type": "text/csv" } }) }), plain(), TODAY);
    assert.equal(evaluated.severity, "blocking", String(status)); assert.deepEqual(evaluated.blocking, [`http:${status}`]);
  }
  const limited = evaluateResult(await checkSourceHealth(taito, { fetch: async () => csv(429) }), plain(), TODAY);
  assert.equal(limited.signals.rateLimited, true); assert.deepEqual(limited.blocking, ["rateLimited"]);
  const scoped = plain({ knownAdvisories: [{ signal: "http:503", reason: "maintenance window", recordedAt: TODAY, expiresAt: "2026-10-12" }] });
  assert.equal(evaluateResult(await checkSourceHealth(taito, { fetch: async () => csv(503) }), scoped, TODAY).severity, "advisory");
  assert.equal(evaluateResult(await checkSourceHealth(taito, { fetch: async () => csv(500) }), scoped, TODAY).severity, "blocking");
});
test("known advisories may only cover availability signals and must expire within 92 days", () => {
  const withAdvisory = (signal: string, expiresAt = "2026-11-09") => reviews.map(r => r.sourceId === "taito-public-smoking-areas"
    ? { ...r, knownAdvisories: [{ signal, reason: "x", recordedAt: TODAY, expiresAt }] } : r);
  validateReviews(reviews, ids);
  for (const signal of ["rightsChanged", "rightsScopeMissing", "schemaIncompatible", "parserIncompatible", "unexpectedMime", "crossOriginRelocation", "transport:unknown", "http:304"])
    assert.throws(() => validateReviews(withAdvisory(signal), ids), /availability/, signal);
  assert.throws(() => validateReviews(withAdvisory("transport:timeout", "2027-10-09"), ids), /expiry/);
  assert.throws(() => validateReviews(withAdvisory("transport:timeout", TODAY), ids), /expiry/);
});

// ---- Scoped rights fingerprints (Kyoto counters and Minato session meta reproduced from the live pages).

const kyotoPage = (count: number, license = "CC-BY 4.0（表示）") => `<html><head><meta name="viewport" content="x"></head><body><table>
  <tr><td class="tdWidth">データリソースID</td><td>21432</td></tr><tr><td>著作権者</td><td>京都市</td></tr>
  <tr><td>データのライセンス</td><td><a href="https://creativecommons.org/licenses/by/4.0/legalcode.ja">${license}</a></td></tr>
  <tr><td>作成日時</td><td>2026-09-03 18:23:54</td></tr><tr><td>アクセス数</td><td>${count}</td></tr><tr><td>今月のDL数</td><td>${count + 7}</td></tr></table></body></html>`;
const minatoPage = (token: string, court = "第一審", extra = "") => `<html><head><meta name="_csrf_token" content="${token}" /></head><body>
  <h2>本サイトの利用について</h2><p>本サイトで公開しているコンテンツは、自由に利用できます。商用利用も可能です。</p>${extra}
  <p>日本国東京地方裁判所を、${court}の専属的な合意管轄裁判所とします。</p><p>CC BYと互換性があり</p>
  <footer><h3>About 港区オープンデータカタログ</h3><span>generated ${token}</span></footer></body></html>`;
const html = (body: string, status = 200) => async () => new Response(status === 200 ? body : null, { status, headers: { "content-type": "text/html; charset=UTF-8" } });
async function reviewedContract(id: string, index: number, page: string): Promise<RightsContract> {
  const contract = reviewOf(id).rights[index];
  const scoped = extractRightsScope(page, contract.scope);
  assert.ok(scoped.ok, `${id} fixture matches the production scope contract`);
  return { ...contract, reviewedFingerprint: await rightsFingerprint(scoped.text) };
}

test("Kyoto: access/download counters alone never change the rights fingerprint; legal text does", async () => {
  const contract = await reviewedContract("kyoto-public-smoking-places", 0, kyotoPage(272));
  assert.equal((await checkRights(contract, { fetch: html(kyotoPage(273)) })).outcome, "unchanged");
  assert.equal((await checkRights(contract, { fetch: html(kyotoPage(99999)) })).outcome, "unchanged");
  const changed = await checkRights(contract, { fetch: html(kyotoPage(273, "CC-BY 4.0（表示・継承）")) });
  assert.equal(changed.outcome, "changed"); assert.notEqual(changed.fingerprint, contract.reviewedFingerprint);
  const missing = await checkRights(contract, { fetch: html(kyotoPage(273).replace("データリソースID", "ID")) });
  assert.equal(missing.outcome, "scopeMissing"); assert.equal(missing.fingerprint, null, "no guessed fingerprint");
  const marker = await checkRights(contract, { fetch: html(kyotoPage(273).replace("CC-BY 4.0（表示）", "表示")) });
  assert.equal(marker.outcome, "markerMissing");
});
test("Minato: CSRF/session meta and timestamps alone are unchanged; one meaningful legal character is changed", async () => {
  const contract = await reviewedContract("minato-designated-smoking-areas", 0, minatoPage("ImE4NWQy.asiswQ.a"));
  assert.equal((await checkRights(contract, { fetch: html(minatoPage("IjlkM2Nm.asiswQ.b")) })).outcome, "unchanged");
  assert.equal((await checkRights(contract, { fetch: html(minatoPage("ImE4NWQy.asiswQ.a", "第二審")) })).outcome, "changed");
  // A clause appended inside the section is captured because the end anchor is exclusive.
  assert.equal((await checkRights(contract, { fetch: html(minatoPage("x", "第一審", "<p>商用利用には事前申請が必要です。</p>")) })).outcome, "changed");
  const doubled = minatoPage("x").replace("<footer>", "<h2>本サイトの利用について</h2><footer>");
  assert.equal((await checkRights(contract, { fetch: html(doubled) })).outcome, "scopeAmbiguous");
  assert.equal((await checkRights(contract, { fetch: html(minatoPage("x").replace("About 港区", "港区")) })).outcome, "scopeMissing");
});
test("htmlText scope: start and end must each occur exactly once; missing/ambiguous never fingerprint and block", async () => {
  const base = { url: "https://example.lg.jp/rights.html", reviewedAt: TODAY, reviewDueAt: "2099-01-01",
    scope: { kind: "htmlText" as const, ranges: [{ start: "START", end: "END" }], requiredMarkers: ["approved"] } };
  const reviewed = extractRightsScope("<p>START approved END</p>", base.scope);
  assert.ok(reviewed.ok);
  const contract: RightsContract = { ...base, reviewedFingerprint: await rightsFingerprint(reviewed.text) };
  assert.equal((await checkRights(contract, { fetch: html("<p>START approved END</p>") })).outcome, "unchanged");
  for (const [page, outcome] of [["START approved", "scopeMissing"], ["START approved END revoked END", "scopeAmbiguous"],
    ["START approved END approved END", "scopeAmbiguous"], ["START START approved END", "scopeAmbiguous"]] as const) {
    const observed = await checkRights(contract, { fetch: html(`<p>${page}</p>`) });
    assert.equal(observed.outcome, outcome, page); assert.equal(observed.fingerprint, null, `${page}: no fingerprint`);
    const verdict = evaluateResult(withRights(await checkSourceHealth(taito, { fetch: async () => csv() }), [observed]), plain({ rights: [contract] }), TODAY);
    assert.equal(verdict.signals.rightsScopeMissing, true, page); assert.deepEqual(verdict.blocking, ["rightsScopeMissing"], page);
  }
});
test("production htmlText contracts use start/end anchors that are distinct", () => {
  for (const review of reviews) for (const contract of review.rights) if (contract.scope.kind === "htmlText")
    for (const range of contract.scope.ranges) assert.ok(range.start && range.end && !range.start.includes(range.end), contract.url);
});
test("rights body is stream-bounded: Content-Length is a hint, the stream itself is cut and cancelled", async () => {
  const max = 64, base: RightsContract = { url: "https://example.lg.jp/r.html", reviewedAt: TODAY, reviewDueAt: "2099-01-01", reviewedFingerprint: "x",
    scope: { kind: "htmlText", ranges: [{ start: "S", end: "E" }], requiredMarkers: [] } };
  const streamed = (total: number, headers: Record<string, string> = {}) => {
    const state = { pulled: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { if (state.pulled >= total) return controller.close(); const n = Math.min(16, total - state.pulled); state.pulled += n; controller.enqueue(new Uint8Array(n).fill(0x61)); },
      cancel() { state.cancelled = true; },
    }, { highWaterMark: 0 });
    return { state, fetch: async () => new Response(body, { headers: { "content-type": "text/html", ...headers } }) };
  };
  const declared = streamed(1_000, { "content-length": String(max + 1) });
  assert.equal((await checkRights(base, { fetch: declared.fetch, maxBytes: max })).reason, "transport:sizeLimit");
  assert.equal(declared.state.pulled, 0, "declared oversize is rejected before any body read"); assert.ok(declared.state.cancelled);
  for (const headers of [{}, { "content-length": "10" }]) {
    const overrun = streamed(10_000, headers);
    const observed = await checkRights(base, { fetch: overrun.fetch, maxBytes: max });
    assert.equal(observed.reason, "transport:sizeLimit"); assert.equal(observed.fingerprint, null);
    assert.ok(overrun.state.pulled <= max + 16, `stopped mid-stream (${overrun.state.pulled})`); assert.ok(overrun.state.cancelled, "reader cancelled");
  }
  const exact = streamed(max);
  assert.notEqual((await checkRights(base, { fetch: exact.fetch, maxBytes: max })).reason, "transport:sizeLimit");
  const plusOne = streamed(max + 1);
  assert.equal((await checkRights(base, { fetch: plusOne.fetch, maxBytes: max })).reason, "transport:sizeLimit"); assert.ok(plusOne.state.cancelled);
  assert.doesNotMatch(readFileSync(new URL("../src/source-health/rights.ts", import.meta.url), "utf8"), /\.(arrayBuffer|text|json|blob)\(\)/);
});
test("ECDHE/AEAD transport is scoped to the Osaka mapnavi data host only", () => {
  const osaka = "osaka-designated-smoking-areas";
  assert.equal(liveTransport(osaka, "data", byId(osaka).url).name, "node-https-ecdhe-aead");
  assert.equal(new URL(byId(osaka).url).hostname, "www.mapnavi.city.osaka.lg.jp");
  for (const contract of reviewOf(osaka).rights) assert.equal(liveTransport(osaka, "rights", contract.url).name, "node-fetch", contract.url);
  assert.equal(liveTransport(osaka, "rights", "https://www.mapnavi.city.osaka.lg.jp/x").name, "node-fetch");
  assert.equal(liveTransport(osaka, "data", "https://www.city.osaka.lg.jp/x.csv").name, "node-fetch");
  for (const target of targets.filter(t => t.adapter.registry.sourceId !== osaka)) {
    const id = target.adapter.registry.sourceId;
    assert.equal(liveTransport(id, "data", target.url).name, "node-fetch", id);
    assert.equal(liveTransport(id, "data", byId(osaka).url).name, "node-fetch", id);
    for (const contract of reviewOf(id).rights) assert.equal(liveTransport(id, "rights", contract.url).name, "node-fetch", contract.url);
  }
});
test("Koto JSON license fields: field change is rightsChanged, missing field is scopeMissing", async () => {
  const body = (license: Record<string, unknown>) => JSON.stringify({ success: true, result: { metadata_modified: String(Math.random()), ...license } });
  const base = { license_id: "CC-BY-4.0", license_title: "クリエイティブ・コモンズ 表示（CC BY）", license_url: "https://creativecommons.org/licenses/by/4.0/deed.ja" };
  const json = (text: string) => async () => new Response(text, { headers: { "content-type": "application/json;charset=utf-8" } });
  const contract = await reviewedContract("koto-station-smoking-areas", 0, body(base));
  assert.equal((await checkRights(contract, { fetch: json(body(base)) })).outcome, "unchanged");
  assert.equal((await checkRights(contract, { fetch: json(body({ ...base, license_url: "https://creativecommons.org/licenses/by-nc/4.0/" })) })).outcome, "changed");
  assert.equal((await checkRights(contract, { fetch: json(body({ license_id: "CC-BY-4.0" })) })).outcome, "scopeMissing");
});
test("rights drift semantics: changed and scope missing block separately; page failure is not a rights change", async () => {
  const contract = await reviewedContract("kyoto-public-smoking-places", 0, kyotoPage(1));
  const healthy = await checkSourceHealth(taito, { fetch: async () => csv() });
  const evaluate = async (page: () => Promise<Response>, review = plain({ rights: [contract] }), today = TODAY) =>
    evaluateResult(withRights(healthy, [await checkRights(contract, { fetch: page })]), review, today);
  const ok = await evaluate(html(kyotoPage(2)));
  assert.equal(ok.severity, "ok"); assert.equal(ok.signals.rightsChanged, false);
  const changed = await evaluate(html(kyotoPage(2, "CC-BY 4.0（表示・継承）")));
  assert.equal(changed.signals.rightsChanged, true); assert.equal(changed.signals.rightsReviewRequired, true); assert.deepEqual(changed.blocking, ["rightsChanged"]);
  const missing = await evaluate(html("<html><body>maintenance</body></html>"));
  assert.equal(missing.signals.rightsChanged, false, "scope missing is not asserted as a change");
  assert.equal(missing.signals.rightsScopeMissing, true); assert.equal(missing.signals.rightsReviewRequired, true); assert.deepEqual(missing.blocking, ["rightsScopeMissing"]);
  for (const [page, reason] of [[html("", 503), "rightsPage:http:503"], [html("", 302), "rightsPage:http:302"], [failing("ENOTFOUND"), "rightsPage:transport:network(ENOTFOUND)"]] as const) {
    const unavailable = await evaluate(page);
    assert.equal(unavailable.signals.rightsChanged, false); assert.equal(unavailable.signals.rightsReviewRequired, false); assert.deepEqual(unavailable.blocking, [reason]);
  }
  const due = await evaluate(html(kyotoPage(2)), plain({ rights: [contract], reviewDueAt: "2099-01-01" }), contract.reviewDueAt);
  assert.equal(due.severity, "advisory"); assert.deepEqual(due.advisory, ["rightsReviewDue"]);
  assert.equal((await checkRights(contract, { fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) })).reason, "unexpectedMime");
});
test("multi-signal: moved + rightsChanged and contentChanged + reviewDue are both preserved", async () => {
  const contract = await reviewedContract("kyoto-public-smoking-places", 0, kyotoPage(1));
  let calls = 0;
  const moved = await checkSourceHealth(taito, { fetch: async () => ++calls === 1 ? csv(301, { location: "/moved.csv" }) : csv() });
  const both = evaluateResult(withRights(moved, [await checkRights(contract, { fetch: html(kyotoPage(1, "CC-BY 4.0（表示・継承）")) })]), plain({ rights: [contract] }), TODAY);
  assert.deepEqual(both.blocking, ["rightsChanged"]); assert.ok(both.advisory.includes("moved")); assert.equal(both.signals.moved, true);
  const changed = await checkSourceHealth({ ...taito, baselineSha256: "0".repeat(64) }, { fetch: async () => csv() });
  const due = evaluateResult(changed, plain({ reviewDueAt: TODAY }), TODAY);
  assert.equal(due.severity, "advisory"); assert.deepEqual(due.advisory, ["contentChanged", "humanReviewDue"]);
  assert.equal(due.signals.rightsChanged, false, "content changed is not rights changed");
});
test("production rights contracts: one+ scoped contract per source, never a whole-page hash", () => {
  for (const review of reviews) {
    assert.ok(review.rights.length >= 1, review.sourceId);
    for (const contract of review.rights) {
      assert.ok(contract.scope.requiredMarkers.length >= 1, contract.url);
      if (contract.scope.kind === "htmlText") for (const range of contract.scope.ranges) assert.ok(range.start.length >= 4 && range.end.length >= 4);
    }
  }
});

// ---- Offline CLI, no automatic baseline update, corpus invariance.

async function runOffline(): Promise<{ exitCode: number; report: ReturnType<typeof buildReport> }> {
  const network = globalThis.fetch, out: string[] = [];
  globalThis.fetch = async () => { throw new Error("offline monitor attempted network"); };
  try { await main(["--offline"], new Date("2026-10-09T00:00:00Z"), { out: text => void out.push(text), err: () => {} }); }
  finally { globalThis.fetch = network; }
  const exitCode = Number(process.exitCode ?? 0); process.exitCode = 0;
  return { exitCode, report: JSON.parse(out.join("")) };
}
test("offline monitor replays reviewed fixtures with no network and never writes a baseline", async () => {
  const metadata = new URL("../../data-pipeline/source-health/review-metadata.json", import.meta.url);
  const before = readFileSync(metadata);
  const first = await runOffline(), second = await runOffline();
  assert.equal(first.exitCode, 0); assert.equal(first.report.results.length, 6);
  for (const item of first.report.results) {
    assert.equal(item.status, "healthy", item.sourceId);
    assert.ok(item.rights.every((r: { outcome: string }) => r.outcome === "notChecked")); assert.ok(item.advisory.includes("rightsNotChecked"));
  }
  assert.deepEqual(second.report, first.report, "deterministic");
  assert.ok(readFileSync(metadata).equals(before), "reviewed baselines are only changed by a human edit");
  for (const file of ["../scripts/source-health.ts", "../src/source-health/rights.ts", "../src/source-health/evaluate.ts"])
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /writeFile|appendFile|createWriteStream/);
  await assert.rejects(main(["--live", "--offline"]), /Usage/);
});
test("health and rights checks leave registry, canonical spots, promotion and tile bodies unchanged", async t => {
  const db = new SqliteD1();
  t.after(() => db.raw.close());
  await importAllReviewedSources(db, "2026-10-09T00:00:00Z");
  await publishTiles(db, { now: "2026-10-09T00:00:00Z" });
  const snapshot = () => ({
    registry: JSON.stringify(SOURCE_ADAPTERS.map(adapter => adapter.registry)),
    sources: db.raw.prepare("SELECT source_id FROM sources ORDER BY source_id").all(),
    spots: db.raw.prepare("SELECT spot_id FROM spots ORDER BY spot_id").all(),
    published: db.raw.prepare("SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id").all(),
    tiles: v1TileRows(db),
  });
  const before = snapshot();
  assert.equal(before.sources.length, 6); assert.equal(before.spots.length, 515); assert.equal(before.published.length, 513); assert.equal(before.tiles.length, 81);
  await runOffline();
  await buildReport(await allSources(async () => csv(503)), reviews, TODAY);
  assert.deepEqual(snapshot(), before);
});
