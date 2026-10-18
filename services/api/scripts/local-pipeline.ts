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
import { type Db, isoSeconds, sha256Hex } from "../src/db.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { MINATO_ADAPTER, MINATO_FIXTURE_RELEASE, MINATO_SOURCE_ID } from "../src/pipeline/minato-adapter.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, KOTO_SOURCE_ID } from "../src/pipeline/koto-adapter.ts";
import { KYOTO_ADAPTER, KYOTO_FIXTURE_RELEASE, KYOTO_SOURCE_ID } from "../src/pipeline/kyoto-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../src/pipeline/osaka-adapter.ts";
import { SENDAI_ADAPTER, SENDAI_AREA_ANCHOR, SENDAI_FIXTURE_RELEASE, SENDAI_SOURCE_ID } from "../src/pipeline/sendai-adapter.ts";
import { recordAreaAnchor, recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { MUSASHINO_ADAPTER, MUSASHINO_FIXTURE_RELEASE, MUSASHINO_SOURCE_ID } from "../src/pipeline/musashino-adapter.ts";
import { KOMATSU_AIRPORT_ADAPTER, KOMATSU_AIRPORT_FIXTURE_RELEASE, KOMATSU_AIRPORT_SOURCE_ID } from "../src/pipeline/komatsu-airport-adapter.ts";
import { TAKAMATSU_AIRPORT_ADAPTER, TAKAMATSU_AIRPORT_FIXTURE_RELEASE, TAKAMATSU_AIRPORT_SOURCE_ID } from "../src/pipeline/takamatsu-airport-adapter.ts";
import { KOCHI_AIRPORT_ADAPTER, KOCHI_AIRPORT_FIXTURE_RELEASE, KOCHI_AIRPORT_SOURCE_ID } from "../src/pipeline/kochi-airport-adapter.ts";
import { MATSUYAMA_AIRPORT_ADAPTER, MATSUYAMA_AIRPORT_FIXTURE_RELEASE, MATSUYAMA_AIRPORT_SOURCE_ID } from "../src/pipeline/matsuyama-airport-adapter.ts";
import { OITA_AIRPORT_ADAPTER, OITA_AIRPORT_FIXTURE_RELEASE, OITA_AIRPORT_SOURCE_ID } from "../src/pipeline/oita-airport-adapter.ts";
import { YONAGO_AIRPORT_ADAPTER, YONAGO_AIRPORT_FIXTURE_RELEASE, YONAGO_AIRPORT_SOURCE_ID } from "../src/pipeline/yonago-airport-adapter.ts";
import { CHUO_PARK_ADAPTER, CHUO_PARK_FIXTURE_RELEASE, CHUO_PARK_SOURCE_ID } from "../src/pipeline/chuo-park-adapter.ts";
import { CHIYODA_ADAPTER, CHIYODA_FIXTURE_RELEASE, CHIYODA_SOURCE_ID } from "../src/pipeline/chiyoda-adapter.ts";
import { MIYAZAKI_AIRPORT_ADAPTER, MIYAZAKI_AIRPORT_FIXTURE_RELEASE, MIYAZAKI_AIRPORT_SOURCE_ID } from "../src/pipeline/miyazaki-airport-adapter.ts";
import { HIROSHIMA_AIRPORT_ADAPTER, HIROSHIMA_AIRPORT_FIXTURE_RELEASE, HIROSHIMA_AIRPORT_SOURCE_ID } from "../src/pipeline/hiroshima-airport-adapter.ts";

// Preserve the original no-argument command. Import other reviewed sources into the same local DB:
//   npm run local:pipeline -- osaka-designated-smoking-areas
//   npm run local:pipeline -- koto-station-smoking-areas
const sourceId = process.argv[2] ?? TAITO_SOURCE_ID;
if (process.argv.length > 3 || ![TAITO_SOURCE_ID, OSAKA_SOURCE_ID, KOTO_SOURCE_ID, MUSASHINO_SOURCE_ID, MINATO_SOURCE_ID, KYOTO_SOURCE_ID, SENDAI_SOURCE_ID, TAKAMATSU_AIRPORT_SOURCE_ID, KOCHI_AIRPORT_SOURCE_ID, MATSUYAMA_AIRPORT_SOURCE_ID, OITA_AIRPORT_SOURCE_ID, YONAGO_AIRPORT_SOURCE_ID, MIYAZAKI_AIRPORT_SOURCE_ID, HIROSHIMA_AIRPORT_SOURCE_ID, KOMATSU_AIRPORT_SOURCE_ID, CHUO_PARK_SOURCE_ID, CHIYODA_SOURCE_ID].includes(sourceId)) {
  throw new Error(`local:pipeline: unreviewed source ${sourceId}`);
}
const selected = sourceId === HIROSHIMA_AIRPORT_SOURCE_ID ? {
  adapter: HIROSHIMA_AIRPORT_ADAPTER, release: HIROSHIMA_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/hiroshima-airport-smoking-places/hiroshima-airport-page-facts.csv",
} : sourceId === MIYAZAKI_AIRPORT_SOURCE_ID ? {
  adapter: MIYAZAKI_AIRPORT_ADAPTER, release: MIYAZAKI_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/miyazaki-airport-smoking-places/miyazaki-airport-page-facts.csv",
} : sourceId === CHIYODA_SOURCE_ID ? {
  adapter: CHIYODA_ADAPTER, release: CHIYODA_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/chiyoda-smoking-places/chiyoda-page-facts.csv",
} : sourceId === CHUO_PARK_SOURCE_ID ? {
  adapter: CHUO_PARK_ADAPTER, release: CHUO_PARK_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/chuo-park-smoking-places/chuo-park-page-facts.csv",
} : sourceId === YONAGO_AIRPORT_SOURCE_ID ? {
  adapter: YONAGO_AIRPORT_ADAPTER, release: YONAGO_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/yonago-airport-smoking-places/yonago-airport-page-facts.csv",
} : sourceId === OITA_AIRPORT_SOURCE_ID ? {
  adapter: OITA_AIRPORT_ADAPTER, release: OITA_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/oita-airport-smoking-places/oita-airport-page-facts.csv",
} : sourceId === MATSUYAMA_AIRPORT_SOURCE_ID ? {
  adapter: MATSUYAMA_AIRPORT_ADAPTER, release: MATSUYAMA_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/matsuyama-airport-smoking-places/matsuyama-airport-page-facts.csv",
} : sourceId === KOCHI_AIRPORT_SOURCE_ID ? {
  adapter: KOCHI_AIRPORT_ADAPTER, release: KOCHI_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/kochi-airport-smoking-places/kochi-airport-page-facts.csv",
} : sourceId === TAKAMATSU_AIRPORT_SOURCE_ID ? {
  adapter: TAKAMATSU_AIRPORT_ADAPTER, release: TAKAMATSU_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/takamatsu-airport-smoking-places/takamatsu-airport-page-facts.csv",
} : sourceId === KOMATSU_AIRPORT_SOURCE_ID ? {
  adapter: KOMATSU_AIRPORT_ADAPTER, release: KOMATSU_AIRPORT_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/komatsu-airport-smoking-places/komatsu-airport-page-facts.csv",
} : sourceId === SENDAI_SOURCE_ID ? {
  adapter: SENDAI_ADAPTER, release: SENDAI_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/sendai-kaigan-park-smoking-areas/041009_public_facility.csv",
} : sourceId === KYOTO_SOURCE_ID ? {
  adapter: KYOTO_ADAPTER, release: KYOTO_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/kyoto-public-smoking-places/20260903_shisetsu.csv",
} : sourceId === MUSASHINO_SOURCE_ID ? {
  adapter: MUSASHINO_ADAPTER, release: MUSASHINO_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/musashino-public-smoking-areas/doc.kml",
} : sourceId === MINATO_SOURCE_ID ? {
  adapter: MINATO_ADAPTER, release: MINATO_FIXTURE_RELEASE,
  fixture: "../../data-pipeline/fixtures/minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv",
} : sourceId === KOTO_SOURCE_ID ? {
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
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const ingest = await ingestRelease(db, selected.adapter, bytes, selected.release);
  console.log("ingest", ingest);
  // Sendai's ADR-0017 anchor is a named reviewed constant; ADR-0018 adapters declare theirs per release.
  if (sourceId === SENDAI_SOURCE_ID) await recordAreaAnchor(db, selected.adapter, SENDAI_AREA_ANCHOR, now);
  console.log("anchors", await recordReviewedAnchors(db, selected.adapter, await sha256Hex(bytes), now));
  console.log("resolve", await resolveFirstRelease(db, selected.adapter, ingest.releaseId, { now }).then((r) =>
    r.status === "resolved" ? { status: r.status, spots: r.spotIds.length } : r));
  console.log("publish", JSON.stringify(await publishTiles(db, { now }), null, 2));
} finally {
  await proxy.dispose();
}
