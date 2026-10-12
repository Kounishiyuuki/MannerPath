// Read API edge hardening: per-endpoint cache policy, nosniff, the tile edge cache (src/edge-cache.ts) and the
// optional per-client challenge budget (src/attest/challenge-budget.ts). docs/OPERATIONS.md "Cache and CDN semantics".
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONDITIONAL_HEADER_MAX_BYTES, REQUEST_URL_MAX_BYTES, app, ifNoneMatchMatches } from "../src/app.ts";
import { challengeBudget, rateLimitKey } from "../src/attest/challenge-budget.ts";
import { type EdgeCache, READ_CACHE_CONTROL, edgeCacheKey, serveWithEdgeCache, storable } from "../src/edge-cache.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito } from "./support/fixture.ts";
import { SqliteD1, reportsD1 } from "./support/sqlite-d1.ts";

const REVALIDATE = "public, no-cache";
const LIMITS = { urlMaxBytes: REQUEST_URL_MAX_BYTES, conditionalHeaderMaxBytes: CONDITIONAL_HEADER_MAX_BYTES, ifNoneMatchMatches };
const ORIGIN = "https://api.example.invalid";
const ATTEST_ENV = { REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: "ABCDE12345.com.example.mannerpath", REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41" };
const PEPPER = "test-pepper-value-not-a-real-secret";

async function published() {
  const db = new SqliteD1();
  await importTaito(db);
  await publishTiles(db, { now: NOW });
  const tile = db.raw.prepare("SELECT tile_id FROM tile_snapshots WHERE spot_count > 0 ORDER BY tile_id LIMIT 1").get() as { tile_id: string };
  const spot = db.raw.prepare("SELECT spot_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 1").get() as { spot_id: string };
  return { db, tileId: tile.tile_id, spotId: spot.spot_id };
}
const get = (db: SqliteD1, path: string, init: RequestInit = {}) => app.request(`${ORIGIN}${path}`, init, { DB: db });

test("tile, manifest and part reads carry the 60 s / swr 300 policy, a strong ETag and nosniff; 304 keeps them", async () => {
  const { db, tileId } = await published();
  for (const path of [`/v1/tiles/${tileId}`, `/v1/tiles/${tileId}/manifest`, `/v1/tiles/${tileId}/parts/0`]) {
    const res = await get(db, path);
    if (path.endsWith(tileId) && res.status === 409) continue;
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("Cache-Control"), READ_CACHE_CONTROL, path);
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff", path);
    const etag = res.headers.get("ETag")!;
    assert.match(etag, /^"[12]-[0-9a-f]{64}"$/, path);
    for (const conditional of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const again = await get(db, path, { headers: { "If-None-Match": conditional } });
      assert.equal(again.status, 304, `${path} ${conditional}`);
      assert.equal(await again.text(), "");
      assert.deepEqual([again.headers.get("ETag"), again.headers.get("Cache-Control"), again.headers.get("X-Content-Type-Options")],
        [etag, READ_CACHE_CONTROL, "nosniff"]);
    }
    assert.equal((await get(db, path, { headers: { "If-None-Match": '"2-stale"' } })).status, 200, path);
  }
  assert.equal(READ_CACHE_CONTROL, "public, max-age=60, stale-while-revalidate=300");
  assert.doesNotMatch(READ_CACHE_CONTROL, /immutable|private|no-store/, "a tile URL is mutable: never immutable");
});

test("endpoints whose semantics need revalidation or no storage keep their policy; errors are no-store and nosniff", async () => {
  const { db, tileId, spotId } = await published();
  assert.equal((await get(db, "/v1/config")).headers.get("Cache-Control"), REVALIDATE);
  assert.equal((await get(db, `/v1/spots/${spotId}`)).headers.get("Cache-Control"), REVALIDATE);
  assert.equal((await get(db, "/v1/coverage/tasks")).headers.get("Cache-Control"), REVALIDATE);
  assert.equal((await get(db, "/v1/readiness")).headers.get("Cache-Control"), "no-store");
  const sensitive = await app.request(`${ORIGIN}/v1/app-attest/challenges`, { method: "POST", body: "{}" }, { DB: db, REPORTS_DB: reportsD1() });
  assert.equal(sensitive.headers.get("Cache-Control"), "no-store");
  const errors = [
    await get(db, "/v1/tiles/14/0/0"), await get(db, "/v1/tiles/13/0/0"), await get(db, "/v1/tiles/014/1/1"),
    await get(db, `/v1/tiles/${tileId}/parts/127`), await get(db, `/v1/tiles/${tileId}/parts/01`), await get(db, "/v1/spots/sp_missing"),
    await get(db, `/v1/tiles/${tileId}?${"q".repeat(REQUEST_URL_MAX_BYTES)}`), sensitive,
  ];
  for (const res of errors) {
    assert.ok(res.status >= 400, String(res.status));
    assert.equal(res.headers.get("Cache-Control"), "no-store", String(res.status));
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff", String(res.status));
    assert.equal(storable(res), false);
  }
});

test("an unsupported method or an unknown path is a JSON, no-store, nosniff 404; HEAD has no body", async () => {
  const { db, tileId } = await published();
  for (const [method, path] of [["PUT", `/v1/tiles/${tileId}`], ["DELETE", `/v1/tiles/${tileId}/manifest`], ["POST", `/v1/tiles/${tileId}/parts/0`],
    ["PATCH", "/v1/config"], ["POST", "/v1/spots/sp_x"], ["GET", "/v1/nothing"], ["GET", "/"]]) {
    const res = await get(db, path, { method });
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.deepEqual([res.headers.get("Content-Type"), res.headers.get("Cache-Control"), res.headers.get("X-Content-Type-Options")],
      ["application/json; charset=utf-8", "no-store", "nosniff"], `${method} ${path}`);
    assert.equal((await res.json() as { error: string }).error, "notFound");
  }
  const head = await get(db, `/v1/tiles/${tileId}/manifest`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

// A Cache API double with the same contract the Worker relies on: keyed by request URL, stores what it is given.
function fakeCache(options: { failMatch?: boolean } = {}) {
  const store = new Map<string, Response>();
  const cache: EdgeCache = {
    match: async (key) => {
      if (options.failMatch) throw new Error("cache unavailable");
      return store.get(key.url)?.clone();
    },
    put: async (key, response) => { assert.equal(key.method, "GET"); store.set(key.url, response); },
  };
  return { store, cache };
}

async function harness(options: { failMatch?: boolean } = {}) {
  const { db, tileId, spotId } = await published();
  const { store, cache } = fakeCache(options);
  const pending: Promise<unknown>[] = [];
  let origin = 0;
  const serve = async (path: string, init: RequestInit = {}) => {
    const res = await serveWithEdgeCache(new Request(`${ORIGIN}${path}`, init), async (r) => { origin++; return app.fetch(r, { DB: db }); },
      cache, (p) => pending.push(p), LIMITS);
    await Promise.all(pending);
    return res;
  };
  return { db, tileId, spotId, store, serve, origin: () => origin };
}

test("the edge cache stores only GET 200 tile reads under origin + path; the query never forms or busts a key", async () => {
  const h = await harness();
  const manifest = `/v1/tiles/${h.tileId}/manifest`;
  const first = await h.serve(manifest);
  assert.equal(first.status, 200);
  assert.equal(h.origin(), 1);
  assert.deepEqual([...h.store.keys()], [`${ORIGIN}${manifest}`]);
  const stored = h.store.get(`${ORIGIN}${manifest}`)!;
  assert.equal(stored.headers.get("Cache-Control"), READ_CACHE_CONTROL, "the stored TTL is the response's own policy");
  for (const query of ["", "?a=1", "?b=2&c=3", "?"]) {
    const res = await h.serve(`${manifest}${query}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), await first.clone().text());
  }
  assert.equal(h.origin(), 1, "every query variant was served from the one key");
  // A revalidating client gets a 304 from the cached ETag without reaching the origin.
  const etag = first.headers.get("ETag")!;
  const revalidated = await h.serve(manifest, { headers: { "If-None-Match": etag } });
  assert.equal(revalidated.status, 304);
  assert.deepEqual([revalidated.headers.get("ETag"), revalidated.headers.get("Cache-Control"), revalidated.headers.get("X-Content-Type-Options")],
    [etag, READ_CACHE_CONTROL, "nosniff"]);
  assert.equal(h.origin(), 1);
  // A conditional request on a miss still fills the cache: the origin is asked unconditionally.
  const part = `/v1/tiles/${h.tileId}/parts/0`;
  const partEtag = (await get(h.db, part)).headers.get("ETag")!;
  assert.equal((await h.serve(part, { headers: { "If-None-Match": partEtag } })).status, 304);
  assert.ok(h.store.has(`${ORIGIN}${part}`));
});

test("errors, other endpoints, other methods and oversized input never touch the edge cache", async () => {
  const h = await harness();
  for (const path of ["/v1/tiles/14/0/0", "/v1/tiles/13/0/0", `/v1/tiles/${h.tileId}/parts/127`]) {
    assert.ok((await h.serve(path)).status >= 400);
    assert.ok((await h.serve(path)).status >= 400);
  }
  for (const path of ["/v1/config", `/v1/spots/${h.spotId}`, "/v1/coverage/tasks", "/v1/readiness"]) await h.serve(path);
  for (const method of ["HEAD", "POST", "PUT", "DELETE"]) await h.serve(`/v1/tiles/${h.tileId}/manifest`, { method });
  assert.equal((await h.serve(`/v1/tiles/${h.tileId}/manifest?${"q".repeat(REQUEST_URL_MAX_BYTES)}`)).status, 413);
  assert.equal((await h.serve(`/v1/tiles/${h.tileId}/manifest`, { headers: { "If-None-Match": "x".repeat(CONDITIONAL_HEADER_MAX_BYTES + 1) } })).status, 413);
  assert.deepEqual([...h.store.keys()], [], "nothing above was stored");
  assert.equal(edgeCacheKey(new Request(`${ORIGIN}/v1/spots/${h.spotId}`)), null);
  assert.equal(edgeCacheKey(new Request(`${ORIGIN}/v1/tiles/${h.tileId}`, { method: "HEAD" })), null);
  assert.equal(edgeCacheKey(new Request(`${ORIGIN}/v1/tiles/${h.tileId}/manifest/extra`)), null);
  assert.equal(edgeCacheKey(new Request(`${ORIGIN}/v1/tiles/${h.tileId}/parts/0?x=1`))!.url, `${ORIGIN}/v1/tiles/${h.tileId}/parts/0`);
  // Only the exact read policy with an ETag is storable.
  const ok = (cc: string, etag: string | null, extra: Record<string, string> = {}) =>
    storable(new Response("{}", { status: 200, headers: { "Cache-Control": cc, ...(etag ? { ETag: etag } : {}), ...extra } }));
  assert.equal(ok(READ_CACHE_CONTROL, '"2-a"'), true);
  assert.equal(ok(REVALIDATE, '"2-a"'), false);
  assert.equal(ok("no-store", '"2-a"'), false);
  assert.equal(ok(READ_CACHE_CONTROL, null), false);
  assert.equal(ok(READ_CACHE_CONTROL, '"2-a"', { "Set-Cookie": "a=b" }), false);
});

test("a failing cache read falls back to the origin answer", async () => {
  const h = await harness({ failMatch: true });
  const res = await h.serve(`/v1/tiles/${h.tileId}/manifest`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), READ_CACHE_CONTROL);
  assert.equal(h.origin(), 1);
});

test("the challenge bucket is off without configuration, fails closed when half-configured, and keys by a peppered HMAC", async () => {
  const req = (ip?: string) => new Request(`${ORIGIN}/v1/app-attest/challenges`, { method: "POST", headers: ip ? { "CF-Connecting-IP": ip } : {} });
  const keys: string[] = [];
  const limiter = (success: boolean) => ({ limit: async ({ key }: { key: string }) => { keys.push(key); return { success }; } });
  assert.equal(await challengeBudget({}, req("192.0.2.1")), "notConfigured");
  assert.equal(await challengeBudget({ CHALLENGE_RATE_LIMITER: limiter(true) }, req("192.0.2.1")), "misconfigured");
  assert.equal(await challengeBudget({ RATE_LIMIT_KEY_PEPPER: PEPPER }, req("192.0.2.1")), "misconfigured");
  assert.equal(await challengeBudget({ CHALLENGE_RATE_LIMITER: limiter(true), RATE_LIMIT_KEY_PEPPER: "short" }, req("192.0.2.1")), "misconfigured");
  assert.equal(await challengeBudget({ CHALLENGE_RATE_LIMITER: limiter(true), RATE_LIMIT_KEY_PEPPER: PEPPER, REPORT_SUBMITTER_PEPPER: PEPPER }, req("192.0.2.1")),
    "misconfigured", "the report pepper is never reused");
  assert.deepEqual(keys, [], "no misconfiguration ever reaches the limiter");

  assert.equal(await challengeBudget({ CHALLENGE_RATE_LIMITER: limiter(true), RATE_LIMIT_KEY_PEPPER: PEPPER }, req("192.0.2.1")), "allowed");
  assert.equal(await challengeBudget({ CHALLENGE_RATE_LIMITER: limiter(false), RATE_LIMIT_KEY_PEPPER: PEPPER }, req("192.0.2.1")), "limited");
  assert.equal(await challengeBudget({ CHALLENGE_RATE_LIMITER: { limit: async () => { throw new Error("down"); } }, RATE_LIMIT_KEY_PEPPER: PEPPER }, req("192.0.2.1")),
    "allowed", "a Rate Limiting outage leaves the global ceiling as the backstop");
  await challengeBudget({ CHALLENGE_RATE_LIMITER: limiter(true), RATE_LIMIT_KEY_PEPPER: PEPPER }, req());
  assert.equal(keys[0], keys[1], "one address, one bucket");
  assert.equal(keys[0], await rateLimitKey(PEPPER, "192.0.2.1"));
  assert.match(keys[0], /^[0-9a-f]{64}$/);
  assert.equal(keys.some((k) => k.includes("192.0.2.1")), false, "the address itself never reaches the limiter");
  assert.notEqual(await rateLimitKey(PEPPER, "192.0.2.1"), await rateLimitKey(`${PEPPER}x`, "192.0.2.1"));
  assert.notEqual(await rateLimitKey(PEPPER, "192.0.2.1"), await rateLimitKey(PEPPER, "192.0.2.2"));
  assert.equal(keys.at(-1), await rateLimitKey(PEPPER, "no-client-address"), "no address: one shared bucket, never unlimited");
});

test("POST /v1/app-attest/challenges applies the bucket before the body and before D1; the global ceiling is untouched", async () => {
  const post = (env: Record<string, unknown>, reports = reportsD1()) => ({
    reports,
    res: app.request(`${ORIGIN}/v1/app-attest/challenges`, {
      method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.7" },
      body: JSON.stringify({ schemaVersion: 1, purpose: "registration" }),
    }, { DB: new SqliteD1(), REPORTS_DB: reports, ...ATTEST_ENV, ...env } as any),
  });
  const count = (db: SqliteD1) => (db.raw.prepare("SELECT count(*) AS n FROM app_attest_challenges").get() as { n: number }).n;
  const off = post({});
  assert.equal((await off.res).status, 201, "no binding, no pepper: unchanged behaviour");
  assert.equal(count(off.reports), 1);
  const limited = post({ CHALLENGE_RATE_LIMITER: { limit: async () => ({ success: false }) }, RATE_LIMIT_KEY_PEPPER: PEPPER });
  const res = await limited.res;
  assert.deepEqual([res.status, res.headers.get("Retry-After"), res.headers.get("Cache-Control")], [429, "60", "no-store"]);
  assert.equal((await res.json() as { error: string }).error, "challengeRateLimited");
  assert.equal(count(limited.reports), 0, "a limited caller writes no row");
  const half = post({ CHALLENGE_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal((await half.res).status, 503);
  assert.equal(count(half.reports), 0);
  const allowed = post({ CHALLENGE_RATE_LIMITER: { limit: async () => ({ success: true }) }, RATE_LIMIT_KEY_PEPPER: PEPPER });
  assert.equal((await allowed.res).status, 201);
  // Neither the address nor its HMAC is stored anywhere in the report store.
  const dump = JSON.stringify(allowed.reports.raw.prepare("SELECT * FROM app_attest_challenges").all());
  assert.equal(dump.includes("198.51.100.7"), false);
  assert.equal(dump.includes(await rateLimitKey(PEPPER, "198.51.100.7")), false);
});
