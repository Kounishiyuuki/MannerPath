# ADR-0019 — Read API edge cache and bounded tile staleness

Status: **Accepted — maintainer decision 2026-10-12.** Implemented in `services/api/src/edge-cache.ts`,
`src/index.ts` and `src/app.ts` (security lane 1, commit `305e6b1`). Not deployed: no Cloudflare, production or
dashboard change was made.

Amends ADR-0005 (tile caching: "revalidate every time" becomes bounded freshness) and the "Cache and CDN semantics"
invariant in `docs/OPERATIONS.md`. Relates to ADR-0015 (manifest + parts) and ADR-0018 §5 (evidence hold).

## Context

Every public read sent `Cache-Control: public, no-cache`: cacheable, but revalidated on every use. A republished
tile was visible at once, but every revalidation still ran the Worker and read D1, even when it ended as a `304`.
The read API is public by design: no login, no App Attest, no secret URL. So repeated tile reads, whether a scraper,
a misbehaving client or a flood, cost a Worker invocation and a D1 read each, with no per-caller key to limit by.
Tiles are by far the most-read and most-repeated responses, and their bodies are stored complete per tile with a
content-hash `ETag`.

## Decision

### 1. Tiles: bounded freshness

`GET /v1/tiles/{z}/{x}/{y}`, `…/manifest` and `…/parts/{index}` send
`Cache-Control: public, max-age=60, stale-while-revalidate=300`.

- **`max-age=60`**: a client or shared cache may reuse a tile for one minute without asking. This is the bound on
  how long a republish can stay unseen by a cache that honours only `max-age`.
- **`stale-while-revalidate=300`**: a cache that supports it may answer once more from a copy up to 5 minutes past
  freshness *while* it revalidates in the background, so a burst after expiry does not stampede the Worker. The
  Workers Cache API does not use it; it applies to downstream caches that do.
- **`ETag` is unchanged**: still the stored schema version + content hash, never recomputed per request. After
  `max-age` a cache revalidates with `If-None-Match`; an unchanged tile is a `304`, a republished one a new body.
  Nothing is `immutable`: a tile or part URL names a position, not content.
- **Edge cache**: only `GET` tile, manifest and part reads go through `caches.default`. Key = origin + path.
  Only a `200` with an `ETag` and exactly this policy is stored. A conditional request is answered from the stored
  `ETag`, so a revalidation inside the window costs no D1 read. Oversized URL or `If-None-Match` input and any
  cache failure fall through to the app unchanged.

### 2. Everything else is not cached

| Response | Policy | Why |
|---|---|---|
| `GET /v1/spots/{id}` | `public, no-cache` | Immediacy: a spot that leaves publication (blocked source, evidence hold) must leave its detail at once |
| `GET /v1/config` | `public, no-cache` | A stale `reports.available` or schema range would offer an entry point the server refuses |
| `GET /v1/coverage/tasks` | `public, no-cache` | Not in scope of this decision; it stays as before (see "Not decided") |
| `GET /v1/readiness` | `no-store` | Operational gate; must reflect the current database |
| Every write (reports, photos, App Attest) | `no-store` | Per-request, never shared |
| Every error (4xx/5xx, unknown path/method JSON `404`) | `no-store` | An error must never be replayed from a cache |

None of these is edge-cached. Every response carries `X-Content-Type-Options: nosniff`.

### 3. The query string is not part of the tile key

The tile, manifest and part handlers read only the path parameters (`c.req.param()`) and `If-None-Match`; no tile
handler reads the query. Dropping the query from the key therefore cannot change a body, and `?anything` cannot
create a new key (cache busting). A test (`test/read-edge-hardening.test.ts`) asserts that the app's own answer
for each tile endpoint is byte-identical, with the same `ETag`, with and without a query. If a query parameter ever
gains meaning on a tile endpoint, that test fails, and this ADR must be amended to put the parameter in the key.

### 4. The public read API stays unauthenticated

This decision bounds cost through caching. It adds no login, no App Attest and no secret to reading published data,
and the API URL is not a secret. Per-caller limits on reads belong to the edge (an account-level WAF / Rate Limiting
rule), not to client credentials.

## Consequences

- **Bounded staleness.** After a republish, a promotion cutover, an evidence hold or its clear (ADR-0018 §5), a tile
  can stay old for up to 60 s in the edge cache and in a client's HTTP cache. A downstream cache that honours
  `stale-while-revalidate` may serve it once more, up to 300 s after expiry, while revalidating. A held spot can
  therefore stay visible on the map for that window, while its detail (`no-cache`) already answers `404`. That is
  the accepted trade-off: the hold is fail closed in the database and in every rebuilt tile at once; only cached
  copies lag, by a bounded and documented time.
- **Mixed revisions are refused, not applied.** A manifest and a part from different revisions can meet in a cache.
  The ADR-0015 client applies a multi-part tile only when every part hashes to its manifest entry, so it keeps its
  cached tile and succeeds on a later sync. The v1 path replaces a whole tile atomically (ADR-0005).
- **DoS cost.** Inside the window, repeated tile reads at one location cost no D1 read, and a revalidation is a
  cache-local `304`. This is cache-only relief: a flood of distinct tiles still reaches D1, and the edge rule stays
  the per-caller control.
- **Cloudflare constraint.** The Workers Cache API stores nothing on a `*.workers.dev` hostname. The edge cache takes
  effect only on a custom domain (a zone). Without one, behaviour is correct, with no edge relief. Each data centre
  caches separately.

## Rollback

Return the tile policy to `public, no-cache` (one constant, `READ_CACHE_CONTROL`, which also disables edge storage,
because only that exact policy is stored), and remove the cache wrapper in `src/index.ts`. Roll back if any of these
holds:

- a staleness incident: users act on a removed or held spot past the documented window, or legal/policy requires
  immediate withdrawal from every surface;
- clients fail to converge after mixed revisions (repeated part-hash mismatches past the window);
- the edge cache serves a body whose `ETag` does not match the stored hash, or serves any non-`200` or non-tile
  response;
- a tile endpoint gains a query parameter or header that changes its answer before the key is amended.

## Not decided (left to later lanes)

- `GET /v1/coverage/tasks` stays `no-cache` and outside the edge cache.
- The successful App Attest key-registration budget (layer 3 in `docs/OPERATIONS.md` "Read API and challenge abuse
  budget") is not implemented; it is left to a later security lane.
- Enabling the optional challenge bucket (`CHALLENGE_RATE_LIMITER` + `RATE_LIMIT_KEY_PEPPER`) and any edge rule are
  account and deployment actions, not part of this decision.
