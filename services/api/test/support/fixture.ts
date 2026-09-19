import { readFileSync } from "node:fs";
import { ensureTaitoSource, ingestTaitoCsv } from "../../src/pipeline/ingest.ts";
import { resolveFirstRelease } from "../../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../../src/pipeline/taito.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

export const TAITO_BYTES = new Uint8Array(readFileSync(
  new URL("../../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url),
));
export const NOW = "2026-09-21T03:00:00Z";

// An isolated, explicitly approved source used only to exercise successful publication. It is
// never the registered Taito source, whose registry status stays 'blocked'.
export const TEST_APPROVED_SOURCE = "test-approved-municipal";

export function addApprovedTestSource(db: SqliteD1): void {
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY approved municipal source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', 'TEST ONLY attribution', 'approved', ?, ?)`,
  ).run(TEST_APPROVED_SOURCE, NOW, NOW);
}

/** Deterministic spot IDs for byte-level reproducibility tests (production uses the CSPRNG). */
export function sequentialSpotIds(prefix = "0"): () => string {
  let n = 0;
  return () => `sp_${prefix}${String(++n).padStart(25, "0")}`;
}

export async function importTaito(db: SqliteD1, opts: { sourceId?: string; newSpotId?: () => string } = {}) {
  const sourceId = opts.sourceId ?? TAITO_SOURCE_ID;
  if (sourceId === TAITO_SOURCE_ID) await ensureTaitoSource(db, NOW);
  const { releaseId } = await ingestTaitoCsv(db, sourceId, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  const resolved = await resolveFirstRelease(db, releaseId, { now: NOW, newSpotId: opts.newSpotId });
  return { releaseId, resolved };
}
