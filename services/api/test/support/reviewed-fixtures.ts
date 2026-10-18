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
import { KOMATSU_AIRPORT_FIXTURE_RELEASE, KOMATSU_AIRPORT_SOURCE_ID } from "../../src/pipeline/komatsu-airport-adapter.ts";
import { sha256Hex } from "../../src/db.ts";
import { OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../../src/pipeline/osaka-adapter.ts";
import { SENDAI_AREA_ANCHOR, SENDAI_FIXTURE_RELEASE, SENDAI_SOURCE_ID } from "../../src/pipeline/sendai-adapter.ts";
import { recordAreaAnchor, recordReviewedAnchors } from "../../src/pipeline/area-anchor.ts";
import { ensureReviewedSource } from "../../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../../src/pipeline/taito.ts";
import { sequentialSpotIds } from "./fixture.ts";
import { TAKAMATSU_AIRPORT_FIXTURE_RELEASE, TAKAMATSU_AIRPORT_SOURCE_ID } from "../../src/pipeline/takamatsu-airport-adapter.ts";
import { KOCHI_AIRPORT_FIXTURE_RELEASE, KOCHI_AIRPORT_SOURCE_ID } from "../../src/pipeline/kochi-airport-adapter.ts";
import { MATSUYAMA_AIRPORT_FIXTURE_RELEASE, MATSUYAMA_AIRPORT_SOURCE_ID } from "../../src/pipeline/matsuyama-airport-adapter.ts";
import { OITA_AIRPORT_FIXTURE_RELEASE, OITA_AIRPORT_SOURCE_ID } from "../../src/pipeline/oita-airport-adapter.ts";
import { YONAGO_AIRPORT_FIXTURE_RELEASE, YONAGO_AIRPORT_SOURCE_ID } from "../../src/pipeline/yonago-airport-adapter.ts";
import { CHUO_PARK_FIXTURE_RELEASE, CHUO_PARK_SOURCE_ID } from "../../src/pipeline/chuo-park-adapter.ts";
import { CHIYODA_FIXTURE_RELEASE, CHIYODA_SOURCE_ID } from "../../src/pipeline/chiyoda-adapter.ts";
import { MIYAZAKI_AIRPORT_FIXTURE_RELEASE, MIYAZAKI_AIRPORT_SOURCE_ID } from "../../src/pipeline/miyazaki-airport-adapter.ts";
import { HIROSHIMA_AIRPORT_FIXTURE_RELEASE, HIROSHIMA_AIRPORT_SOURCE_ID } from "../../src/pipeline/hiroshima-airport-adapter.ts";

export const REVIEWED_FIXTURES: Readonly<Record<string, { release: ReleaseMetadata; file: string }>> = {
  [TAKAMATSU_AIRPORT_SOURCE_ID]: { release: TAKAMATSU_AIRPORT_FIXTURE_RELEASE, file: "takamatsu-airport-smoking-places/takamatsu-airport-page-facts.csv" },
  [KOCHI_AIRPORT_SOURCE_ID]: { release: KOCHI_AIRPORT_FIXTURE_RELEASE, file: "kochi-airport-smoking-places/kochi-airport-page-facts.csv" },
  [MATSUYAMA_AIRPORT_SOURCE_ID]: { release: MATSUYAMA_AIRPORT_FIXTURE_RELEASE, file: "matsuyama-airport-smoking-places/matsuyama-airport-page-facts.csv" },
  [OITA_AIRPORT_SOURCE_ID]: { release: OITA_AIRPORT_FIXTURE_RELEASE, file: "oita-airport-smoking-places/oita-airport-page-facts.csv" },
  [YONAGO_AIRPORT_SOURCE_ID]: { release: YONAGO_AIRPORT_FIXTURE_RELEASE, file: "yonago-airport-smoking-places/yonago-airport-page-facts.csv" },
  [CHUO_PARK_SOURCE_ID]: { release: CHUO_PARK_FIXTURE_RELEASE, file: "chuo-park-smoking-places/chuo-park-page-facts.csv" },
  [CHIYODA_SOURCE_ID]: { release: CHIYODA_FIXTURE_RELEASE, file: "chiyoda-smoking-places/chiyoda-page-facts.csv" },
  [MIYAZAKI_AIRPORT_SOURCE_ID]: { release: MIYAZAKI_AIRPORT_FIXTURE_RELEASE, file: "miyazaki-airport-smoking-places/miyazaki-airport-page-facts.csv" },
  [HIROSHIMA_AIRPORT_SOURCE_ID]: { release: HIROSHIMA_AIRPORT_FIXTURE_RELEASE, file: "hiroshima-airport-smoking-places/hiroshima-airport-page-facts.csv" },
  [SENDAI_SOURCE_ID]: { release: SENDAI_FIXTURE_RELEASE, file: "sendai-kaigan-park-smoking-areas/041009_public_facility.csv" },
  [TAITO_SOURCE_ID]: { release: TAITO_FIXTURE_RELEASE, file: "taito-public-smoking-areas/20260818_koshukitsuenjo.csv" },
  [OSAKA_SOURCE_ID]: { release: OSAKA_FIXTURE_RELEASE, file: "osaka-designated-smoking-areas/opendata_1012.csv" },
  [KOTO_SOURCE_ID]: { release: KOTO_FIXTURE_RELEASE, file: "koto-station-smoking-areas/131083_237_public_smoking_area_station.csv" },
  [MUSASHINO_SOURCE_ID]: { release: MUSASHINO_FIXTURE_RELEASE, file: "musashino-public-smoking-areas/doc.kml" },
  [MINATO_SOURCE_ID]: { release: MINATO_FIXTURE_RELEASE, file: "minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv" },
  [KYOTO_SOURCE_ID]: { release: KYOTO_FIXTURE_RELEASE, file: "kyoto-public-smoking-places/20260903_shisetsu.csv" },
  [KOMATSU_AIRPORT_SOURCE_ID]: { release: KOMATSU_AIRPORT_FIXTURE_RELEASE, file: "komatsu-airport-smoking-places/komatsu-airport-page-facts.csv" },
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
  if (adapters.length > 1000) throw new Error("reviewed-fixtures: source ID slots exhausted (maximum index 999)");
  for (const [i, adapter] of adapters.entries()) {
    const fixture = REVIEWED_FIXTURES[adapter.registry.sourceId];
    if (!fixture) throw new Error(`reviewed-fixtures: no pinned fixture for ${adapter.registry.sourceId}`);
    await ensureReviewedSource(db, adapter.registry.sourceId, now);
    const bytes = reviewedFixtureBytes(fixture.file);
    const { releaseId } = await ingestRelease(db, adapter, bytes, fixture.release);
    // Sendai's ADR-0017 anchor is a named reviewed constant; ADR-0018 adapters declare theirs per release.
    if (adapter.registry.sourceId === SENDAI_SOURCE_ID) await recordAreaAnchor(db, adapter, SENDAI_AREA_ANCHOR, now);
    await recordReviewedAnchors(db, adapter, await sha256Hex(bytes), now);
    // Preserve the original eight sources' IDs; later sources use a namespace disjoint from
    // both those numeric prefixes and community fixtures' single-letter prefixes.
    let sequence = 0;
    const newSpotId = i < 8 ? sequentialSpotIds(String(i))
      : () => `sp_0Z${String(i).padStart(3, "0")}${String(++sequence).padStart(21, "0")}`;
    const result = await resolveFirstRelease(db, adapter, releaseId, { now, newSpotId });
    if (result.status !== "resolved") throw new Error(`reviewed-fixtures: ${adapter.registry.sourceId} did not resolve`);
  }
}
