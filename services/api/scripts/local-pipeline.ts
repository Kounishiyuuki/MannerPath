// Runs ingest -> resolve -> publish for the committed Taito fixture against the LOCAL D1 database
// (.wrangler/state, the same one `wrangler dev` serves). It never talks to a remote database.
//
// It creates the Taito registry row from the reviewed entry (approved, with attribution) when it is
// missing, and never rewrites an existing row: a database that still holds the older blocked Taito
// row is upgraded deliberately with `npm run local:registry`.
//
//   npx wrangler d1 migrations apply DB --local
//   npm run local:pipeline
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { type Db, isoSeconds } from "../src/db.ts";
import { ingestTaitoCsv } from "../src/pipeline/ingest.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";

const FIXTURE = new URL("../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url);

const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const db = proxy.env.DB;
  const now = isoSeconds(new Date());
  console.log("registry", await ensureReviewedSource(db, TAITO_SOURCE_ID, now));
  const ingest = await ingestTaitoCsv(db, TAITO_SOURCE_ID, new Uint8Array(readFileSync(FIXTURE)), TAITO_FIXTURE_RELEASE);
  console.log("ingest", ingest);
  console.log("resolve", await resolveFirstRelease(db, ingest.releaseId, { now }).then((r) =>
    r.status === "resolved" ? { status: r.status, spots: r.spotIds.length } : r));
  console.log("publish", JSON.stringify(await publishTiles(db, { now }), null, 2));
} finally {
  await proxy.dispose();
}
