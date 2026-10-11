// The pinned first-release fixture of every reviewed source, keyed by source id. Tests that run the real
// multi-source pipeline iterate SOURCE_ADAPTERS through this map, so a new reviewed source must add its
// fixture here or those tests fail instead of silently leaving it out.
import { readFileSync } from "node:fs";
import type { Db } from "../../src/db.ts";
import type { SourceAdapter } from "../../src/pipeline/source-adapter.ts";
import { SOURCE_ADAPTERS } from "../../src/pipeline/adapters.ts";
import { ingestRelease, type ReleaseMetadata } from "../../src/pipeline/ingest.ts";
import { KOTO_FIXTURE_RELEASE, KOTO_SOURCE_ID } from "../../src/pipeline/koto-adapter.ts";
import { KYOTO_FIXTURE_RELEASE, KYOTO_SOURCE_ID } from "../../src/pipeline/kyoto-adapter.ts";
import { MINATO_FIXTURE_RELEASE, MINATO_SOURCE_ID } from "../../src/pipeline/minato-adapter.ts";
import { MUSASHINO_FIXTURE_RELEASE, MUSASHINO_SOURCE_ID } from "../../src/pipeline/musashino-adapter.ts";
import { OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../../src/pipeline/osaka-adapter.ts";
import { SENDAI_AREA_ANCHOR, SENDAI_FIXTURE_RELEASE, SENDAI_SOURCE_ID } from "../../src/pipeline/sendai-adapter.ts";
import { recordAreaAnchor } from "../../src/pipeline/area-anchor.ts";
import { ensureReviewedSource } from "../../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../../src/pipeline/taito.ts";
import { sequentialSpotIds } from "./fixture.ts";

export const REVIEWED_FIXTURES: Readonly<Record<string, { release: ReleaseMetadata; file: string }>> = {
  [SENDAI_SOURCE_ID]: { release: SENDAI_FIXTURE_RELEASE, file: "sendai-kaigan-park-smoking-areas/041009_public_facility.csv" },
  [TAITO_SOURCE_ID]: { release: TAITO_FIXTURE_RELEASE, file: "taito-public-smoking-areas/20260818_koshukitsuenjo.csv" },
  [OSAKA_SOURCE_ID]: { release: OSAKA_FIXTURE_RELEASE, file: "osaka-designated-smoking-areas/opendata_1012.csv" },
  [KOTO_SOURCE_ID]: { release: KOTO_FIXTURE_RELEASE, file: "koto-station-smoking-areas/131083_237_public_smoking_area_station.csv" },
  [MUSASHINO_SOURCE_ID]: { release: MUSASHINO_FIXTURE_RELEASE, file: "musashino-public-smoking-areas/doc.kml" },
  [MINATO_SOURCE_ID]: { release: MINATO_FIXTURE_RELEASE, file: "minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv" },
  [KYOTO_SOURCE_ID]: { release: KYOTO_FIXTURE_RELEASE, file: "kyoto-public-smoking-places/20260903_shisetsu.csv" },
};

export function reviewedFixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../../data-pipeline/fixtures/${file}`, import.meta.url)));
}

// Historical read-only v1 corpus inventory. New reviewed adapters are intentionally excluded from
// historical coverage/artifact fixtures; importAllReviewedSources still covers every adapter.
export const PRODUCTION_BASELINE_SOURCE_IDS = [
  TAITO_SOURCE_ID, OSAKA_SOURCE_ID, KOTO_SOURCE_ID, MUSASHINO_SOURCE_ID, MINATO_SOURCE_ID, KYOTO_SOURCE_ID,
] as const;

/** Recreates the explicit six-source production baseline in a test/local database only. */
export async function importProductionBaselineSources(db: Db, now: string): Promise<void> {
  const adapters = PRODUCTION_BASELINE_SOURCE_IDS.map(id => {
    const adapter = SOURCE_ADAPTERS.find(a => a.registry.sourceId === id);
    if (!adapter) throw new Error(`reviewed-fixtures: baseline adapter missing for ${id}`);
    return adapter;
  });
  await importReviewedSources(db, now, adapters);
}

/** Ingests and resolves every reviewed source's pinned first release, in SOURCE_ADAPTERS order. */
export async function importAllReviewedSources(db: Db, now: string): Promise<void> {
  await importReviewedSources(db, now, SOURCE_ADAPTERS);
}

async function importReviewedSources(db: Db, now: string, adapters: readonly SourceAdapter[]): Promise<void> {
  for (const [i, adapter] of adapters.entries()) {
    const fixture = REVIEWED_FIXTURES[adapter.registry.sourceId];
    if (!fixture) throw new Error(`reviewed-fixtures: no pinned fixture for ${adapter.registry.sourceId}`);
    await ensureReviewedSource(db, adapter.registry.sourceId, now);
    const { releaseId } = await ingestRelease(db, adapter, reviewedFixtureBytes(fixture.file), fixture.release);
    if (adapter.registry.sourceId === SENDAI_SOURCE_ID) await recordAreaAnchor(db, adapter, SENDAI_AREA_ANCHOR, now);
    const result = await resolveFirstRelease(db, adapter, releaseId, { now, newSpotId: sequentialSpotIds(String(i)) });
    if (result.status !== "resolved") throw new Error(`reviewed-fixtures: ${adapter.registry.sourceId} did not resolve`);
  }
}
