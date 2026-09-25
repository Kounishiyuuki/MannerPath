import { readFileSync } from "node:fs";
import { ingestRelease } from "../../src/pipeline/ingest.ts";
import { TAITO_ADAPTER } from "../../src/pipeline/taito-adapter.ts";
import { ensureReviewedSource } from "../../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../../src/pipeline/source-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY, TAITO_SOURCE_ID } from "../../src/pipeline/taito.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

export const TAITO_BYTES = new Uint8Array(readFileSync(
  new URL("../../../data-pipeline/fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url),
));
export const NOW = "2026-09-21T03:00:00Z";

// An isolated source that is *not* approved, used to exercise the generic publication gate. The
// registered Taito source is approved (docs/SOURCES.md, Issue #22), so it can no longer play the
// blocked role: unknown/unreviewed sources are what must stay unpublishable by default.
export const TEST_BLOCKED_SOURCE = "test-blocked-municipal";

/**
 * TEST ONLY: the Taito file format and rules under the unapproved source above. Production code never
 * lets a caller pick a source id; a test that needs Taito-shaped data under another source uses this
 * adapter, whose own registry.sourceId is that source. It is not in SOURCE_ADAPTERS.
 */
export const TEST_BLOCKED_TAITO_ADAPTER: SourceAdapter = {
  ...TAITO_ADAPTER,
  registry: { ...TAITO_REGISTRY, sourceId: TEST_BLOCKED_SOURCE, displayName: "TEST ONLY unapproved municipal source", attributionText: null, publicationStatus: "blocked" },
};

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
  const adapter = sourceId === TAITO_SOURCE_ID ? TAITO_ADAPTER
    : sourceId === TEST_BLOCKED_SOURCE ? TEST_BLOCKED_TAITO_ADAPTER
    : (() => { throw new Error(`fixture: no adapter for ${sourceId}`); })();
  if (sourceId === TAITO_SOURCE_ID) await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, adapter, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  const resolved = await resolveFirstRelease(db, adapter, releaseId, { now: NOW, newSpotId: opts.newSpotId });
  return { releaseId, resolved };
}
