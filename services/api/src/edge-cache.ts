// Edge response cache for the public tile reads (Workers Cache API, docs/OPERATIONS.md "Cache and CDN semantics").
// Only tile, manifest and part GETs are cached, keyed by origin + path alone: the handlers never read the query or a
// request header other than If-None-Match, so dropping both cannot change a body, and `?anything` cannot bust the key.
// Only a 200 that carries an ETag and exactly READ_CACHE_CONTROL is stored, so an error, a no-store or a revalidate-
// every-time response never is. The conditional answer is computed here from the stored ETag, which lets a cached
// tile answer a revalidating client with a 304 without reaching D1.

/** Tile, manifest and part responses. A republish is visible within max-age; ADR-0015 clients apply only complete,
 * hash-matching part sets, so a manifest and a part from different revisions are refused, never applied. */
export const READ_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

/** The subset of the Workers Cache API used here; the Worker passes `caches.default`, tests a double. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface EdgeCacheLimits {
  urlMaxBytes: number;
  conditionalHeaderMaxBytes: number;
  ifNoneMatchMatches: (header: string | undefined, etag: string) => boolean;
}

const TILE_READ = /^\/v1\/tiles\/[^/]+\/[^/]+\/[^/]+(?:\/manifest|\/parts\/[^/]+)?$/;
const bytes = (s: string) => new TextEncoder().encode(s).length;

export function edgeCacheKey(request: Request): Request | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  return TILE_READ.test(url.pathname) ? new Request(`${url.origin}${url.pathname}`) : null;
}

export function storable(response: Response): boolean {
  return response.status === 200 && response.headers.get("ETag") !== null
    && response.headers.get("Cache-Control") === READ_CACHE_CONTROL && !response.headers.has("Set-Cookie");
}

export async function serveWithEdgeCache(
  request: Request, handle: (request: Request) => Promise<Response>, cache: EdgeCache | undefined,
  waitUntil: (promise: Promise<unknown>) => void, limits: EdgeCacheLimits,
): Promise<Response> {
  const key = cache === undefined ? null : edgeCacheKey(request);
  const conditional = request.headers.get("If-None-Match") ?? undefined;
  // Oversized input keeps the app's own 413 answer: the key would hide the long query.
  if (key === null || bytes(request.url) > limits.urlMaxBytes || bytes(conditional ?? "") > limits.conditionalHeaderMaxBytes) {
    return handle(request);
  }
  // The cache is an optimisation only: a failing cache read or write falls back to the origin answer.
  let response = await cache!.match(key).catch(() => undefined);
  if (response === undefined) {
    response = await handle(new Request(key.url));
    if (storable(response)) waitUntil(cache!.put(key, response.clone()).catch(() => undefined));
  }
  const etag = response.headers.get("ETag");
  if (response.status === 200 && etag !== null && limits.ifNoneMatchMatches(conditional, etag)) {
    const headers = new Headers({ ETag: etag });
    for (const name of ["Cache-Control", "X-Content-Type-Options"]) {
      const value = response.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(null, { status: 304, headers });
  }
  return response;
}
