// Runs ingest -> resolve -> publish for a reviewed fixture against the LOCAL D1 database
// (.wrangler/state, the same one `wrangler dev` serves). It never talks to a remote database.
//
// It creates the selected source's registry row from its reviewed entry when missing, and never
// rewrites an existing row: registry upgrades are deliberate through `npm run local:registry`.
//
//   npx wrangler d1 migrations apply DB --local
//   npm run local:pipeline
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { type Db, isoSeconds } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, KOTO_SOURCE_ID } from "../src/pipeline/koto-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../src/pipeline/osaka-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";

// Preserve the original no-argument command. Import other reviewed sources into the same local DB:
//   npm run local:pipeline -- osaka-designated-smoking-areas
//   npm run local:pipeline -- koto-station-smoking-areas
const sourceId = process.argv[2] ?? TAITO_SOURCE_ID;
if (process.argv.length > 3 || ![TAITO_SOURCE_ID, OSAKA_SOURCE_ID, KOTO_SOURCE_ID].includes(sourceId)) {
  throw new Error(`local:pipeline: expected source ${TAITO_SOURCE_ID}, ${OSAKA_SOURCE_ID} or ${KOTO_SOURCE_ID}`);
}
const selected = sourceId === KOTO_SOURCE_ID ? {
  adapter: KOTO_ADAPTER, release: KOTO_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/koto-station-smoking-areas/131083_237_public_smoking_area_station.csv",
} : sourceId === OSAKA_SOURCE_ID ? {
  adapter: OSAKA_ADAPTER, release: OSAKA_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/osaka-designated-smoking-areas/opendata_1012.csv",
} : {
  adapter: TAITO_ADAPTER, release: TAITO_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv",
};
const FIXTURE = new URL(selected.fixture, import.meta.url);

const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const db = proxy.env.DB;
  const now = isoSeconds(new Date());
  console.log("registry", await ensureReviewedSource(db, sourceId, now));
  const ingest = await ingestRelease(db, selected.adapter, new Uint8Array(readFileSync(FIXTURE)), selected.release);
  console.log("ingest", ingest);
  console.log("resolve", await resolveFirstRelease(db, selected.adapter, ingest.releaseId, { now }).then((r) =>
    r.status === "resolved" ? { status: r.status, spots: r.spotIds.length } : r));
  console.log("publish", JSON.stringify(await publishTiles(db, { now }), null, 2));
} finally {
  await proxy.dispose();
}
