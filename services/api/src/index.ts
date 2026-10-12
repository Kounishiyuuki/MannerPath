import { CONDITIONAL_HEADER_MAX_BYTES, type Env, REQUEST_URL_MAX_BYTES, app, ifNoneMatchMatches } from "./app.ts";
import { serveWithEdgeCache } from "./edge-cache.ts";
import { scheduled } from "./refresh/scheduled.ts";

const LIMITS = { urlMaxBytes: REQUEST_URL_MAX_BYTES, conditionalHeaderMaxBytes: CONDITIONAL_HEADER_MAX_BYTES, ifNoneMatchMatches };

export default {
  // Tile reads go through the edge cache (src/edge-cache.ts); every other request reaches the app unchanged.
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    serveWithEdgeCache(request, async (r) => app.fetch(r, env, ctx), caches.default, (p) => ctx.waitUntil(p), LIMITS),
  scheduled,
};
