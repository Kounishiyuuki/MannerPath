// Read-only health probes cannot alter the six-source fixture corpus or publication.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HEALTH_SOURCES, auditSource } from "../scripts/source-health-lib.ts";
import { TAITO_FIXTURE_RELEASE } from "../src/pipeline/taito.ts";
import { OSAKA_FIXTURE_RELEASE } from "../src/pipeline/osaka-adapter.ts";
import { KOTO_FIXTURE_RELEASE } from "../src/pipeline/koto-adapter.ts";
import { MUSASHINO_FIXTURE_RELEASE } from "../src/pipeline/musashino-adapter.ts";
import { MINATO_FIXTURE_RELEASE } from "../src/pipeline/minato-adapter.ts";
import { KYOTO_FIXTURE_RELEASE } from "../src/pipeline/kyoto-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const releases = [TAITO_FIXTURE_RELEASE, OSAKA_FIXTURE_RELEASE, KOTO_FIXTURE_RELEASE,
  MUSASHINO_FIXTURE_RELEASE, MINATO_FIXTURE_RELEASE, KYOTO_FIXTURE_RELEASE];
const paths = ["taito-public-smoking-areas/20260818_koshukitsuenjo.csv",
  "osaka-designated-smoking-areas/opendata_1012.csv",
  "koto-station-smoking-areas/131083_237_public_smoking_area_station.csv",
  "musashino-public-smoking-areas/doc.kml",
  "minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv",
  "kyoto-public-smoking-places/20260903_shisetsu.csv"];

test("health audit preserves source count, spot IDs, published spots and exact tile bytes", async () => {
  const db = new SqliteD1();
  try {
    const newSpotId = sequentialSpotIds("8");
    // Match by source identity rather than relying on report ordering.
    for (let i = 0; i < releases.length; i++) {
      const source = HEALTH_SOURCES.find(s => paths[i].startsWith(`${s.adapter.registry.sourceId}/`))!;
      assert.ok(source);
      const bytes = new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${paths[i]}`, import.meta.url)));
      await ensureReviewedSource(db, source.adapter.registry.sourceId, NOW);
      const { releaseId } = await ingestRelease(db, source.adapter, bytes, releases[i]);
      await resolveFirstRelease(db, source.adapter, releaseId, { now: NOW, newSpotId });
    }
    await publishTiles(db, { now: NOW });
    const snapshot = () => ({
      sources: db.raw.prepare("SELECT * FROM sources ORDER BY source_id").all(),
      spotIds: db.raw.prepare("SELECT spot_id FROM spots ORDER BY spot_id").all(),
      publishedSpots: db.raw.prepare("SELECT * FROM tile_snapshot_spots ORDER BY spot_id").all(),
      tiles: db.raw.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all(),
      parts: db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index").all(),
    });
    const before = snapshot();
    assert.equal(before.sources.length, 6);
    assert.equal(before.spotIds.length, 515);
    assert.equal(before.publishedSpots.length, 513);
    const fetchImpl: typeof fetch = async () => { throw new Error("fixture audit attempted network"); };
    for (const source of HEALTH_SOURCES) await auditSource(source, { live: false, fetchImpl });
    assert.deepEqual(snapshot(), before);
  } finally {
    db.raw.close();
  }
});
