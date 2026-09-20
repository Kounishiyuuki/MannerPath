import { readFileSync } from "node:fs";
import { ingestTaitoCsv } from "../../src/pipeline/ingest.ts";
import { ensureReviewedSource } from "../../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../../src/pipeline/resolve.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../../src/pipeline/taito.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

export const TAITO_BYTES = new Uint8Array(readFileSync(
  new URL("../../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url),
));
export const NOW = "2026-09-21T03:00:00Z";

// An isolated source that is *not* approved, used to exercise the generic publication gate. The
// registered Taito source is approved (docs/SOURCES.md, Issue #22), so it can no longer play the
// blocked role: unknown/unreviewed sources are what must stay unpublishable by default.
export const TEST_BLOCKED_SOURCE = "test-blocked-municipal";

export function addBlockedTestSource(db: SqliteD1): void {
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, 'TEST ONLY unapproved municipal source', 'municipal', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/legalcode.ja', NULL, 'blocked', ?, ?)`,
  ).run(TEST_BLOCKED_SOURCE, NOW, NOW);
}

/** Deterministic spot IDs for byte-level reproducibility tests (production uses the CSPRNG). */
export function sequentialSpotIds(prefix = "0"): () => string {
  let n = 0;
  return () => `sp_${prefix}${String(++n).padStart(25, "0")}`;
}

export async function importTaito(db: SqliteD1, opts: { sourceId?: string; newSpotId?: () => string } = {}) {
  const sourceId = opts.sourceId ?? TAITO_SOURCE_ID;
  if (sourceId === TAITO_SOURCE_ID) await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId } = await ingestTaitoCsv(db, sourceId, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  const resolved = await resolveFirstRelease(db, releaseId, { now: NOW, newSpotId: opts.newSpotId });
  return { releaseId, resolved };
}
