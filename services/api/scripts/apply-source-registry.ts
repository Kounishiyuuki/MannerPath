// Re-applies the reviewed source-registry entries (src/pipeline/registry.ts, docs/SOURCES.md) to the
// LOCAL D1 database (.wrangler/state). This is the upgrade path for a database created before a
// source was reviewed — for example a `taito-public-smoking-areas` row still stored as 'blocked'
// with no attribution text. It never talks to a remote database and can only set the status this
// repository has reviewed for each listed source.
//
//   npx wrangler d1 migrations apply DB --local
//   npm run local:registry      # then npm run local:pipeline to republish
import { getPlatformProxy } from "wrangler";
import { type Db, isoSeconds } from "../src/db.ts";
import { REVIEWED_SOURCES, applyReviewedSourceRegistry } from "../src/pipeline/registry.ts";

const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const now = isoSeconds(new Date());
  for (const s of REVIEWED_SOURCES) {
    console.log(s.sourceId, await applyReviewedSourceRegistry(proxy.env.DB, s.sourceId, now));
  }
} finally {
  await proxy.dispose();
}
