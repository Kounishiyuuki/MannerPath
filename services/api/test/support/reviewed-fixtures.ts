// The pinned first-release fixture of every reviewed source, keyed by source id. Tests that run the real
// multi-source pipeline iterate SOURCE_ADAPTERS through this map, so a new reviewed source must add its
// fixture here or those tests fail instead of silently leaving it out.
import { readFileSync } from "node:fs";
import type { Db } from "../../src/db.ts";
import { SOURCE_ADAPTERS } from "../../src/pipeline/adapters.ts";
import { ingestRelease, type ReleaseMetadata } from "../../src/pipeline/ingest.ts";
import { KOTO_FIXTURE_RELEASE, KOTO_SOURCE_ID } from "../../src/pipeline/koto-adapter.ts";
import { KYOTO_FIXTURE_RELEASE, KYOTO_SOURCE_ID } from "../../src/pipeline/kyoto-adapter.ts";
import { MINATO_FIXTURE_RELEASE, MINATO_SOURCE_ID } from "../../src/pipeline/minato-adapter.ts";
import { MUSASHINO_FIXTURE_RELEASE, MUSASHINO_SOURCE_ID } from "../../src/pipeline/musashino-adapter.ts";
import { OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../../src/pipeline/osaka-adapter.ts";
import { ensureReviewedSource } from "../../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../../src/pipeline/taito.ts";
import { sequentialSpotIds } from "./fixture.ts";

export const REVIEWED_FIXTURES: Readonly<Record<string, { release: ReleaseMetadata; file: string }>> = {
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

/** Ingests and resolves every reviewed source's pinned first release, in SOURCE_ADAPTERS order. */
export async function importAllReviewedSources(db: Db, now: string): Promise<void> {
  for (const [i, adapter] of SOURCE_ADAPTERS.entries()) {
    const fixture = REVIEWED_FIXTURES[adapter.registry.sourceId];
    if (!fixture) throw new Error(`reviewed-fixtures: no pinned fixture for ${adapter.registry.sourceId}`);
    await ensureReviewedSource(db, adapter.registry.sourceId, now);
    const { releaseId } = await ingestRelease(db, adapter, reviewedFixtureBytes(fixture.file), fixture.release);
    const result = await resolveFirstRelease(db, adapter, releaseId, { now, newSpotId: sequentialSpotIds(String(i)) });
    if (result.status !== "resolved") throw new Error(`reviewed-fixtures: ${adapter.registry.sourceId} did not resolve`);
  }
}
