// Source registry writes (ADR-0006: the `sources` table is the publication authority and mirrors
// docs/SOURCES.md). Two deliberately separate operations:
//
//   ensureReviewedSource        - the row exists. Insert-only, never touches an existing row.
//   applyReviewedSourceRegistry - the existing row matches the reviewed entry. Explicit upgrade path.
//
// Both accept only a source listed in REVIEWED_SOURCES, so an importer can neither register nor
// approve a source that this repository has not reviewed. Approving a source therefore stays a
// repository change (docs/SOURCES.md + this list), reviewed in a PR.

import { type Db } from "../db.ts";
import { SOURCE_ADAPTERS } from "./adapters.ts";

export interface ReviewedSource {
  sourceId: string;
  displayName: string;
  kind: "municipal" | "operator" | "osm" | "userReport";
  licenseName: string | null;
  licenseUrl: string | null;
  attributionText: string | null;
  /** The reviewed publication decision. 'approved' is source-specific and never a default. */
  publicationStatus: "approved" | "blocked";
}

/**
 * Sources whose license and attribution have been reviewed in docs/SOURCES.md, one per reviewed
 * source adapter (ADR-0008). A source that is not here has no registry entry in code: it is
 * blocked by absence, not by a status field.
 * OSM is deliberately absent (ODbL obligations unreviewed, docs/DATA_POLICY.md); the schema also
 * refuses `kind = 'osm'` with `publication_status = 'approved'`.
 */
export const REVIEWED_SOURCES: readonly ReviewedSource[] = SOURCE_ADAPTERS.map((a) => a.registry);

const bySourceId = new Map(REVIEWED_SOURCES.map((s) => [s.sourceId, s]));

export function reviewedSource(sourceId: string): ReviewedSource {
  const s = bySourceId.get(sourceId);
  if (!s) {
    throw new Error(
      `registry: ${sourceId} is not a reviewed source. Review it in docs/SOURCES.md and add it to REVIEWED_SOURCES; code never approves a source on its own.`,
    );
  }
  return s;
}

/**
 * Creates the registry row for a reviewed source if it is missing, with its reviewed metadata and
 * publication status — so a fresh or local database gets the known reviewed row rather than a
 * generic blocked one. An existing row is left exactly as it is: changing it is the explicit
 * `applyReviewedSourceRegistry` operation, so a stale row is never silently rewritten by an import.
 */
export async function ensureReviewedSource(db: Db, sourceId: string, now: string): Promise<{ created: boolean }> {
  const s = reviewedSource(sourceId);
  const before = await db.prepare("SELECT 1 AS present FROM sources WHERE source_id = ?").bind(s.sourceId).first<{ present: number }>();
  if (before) return { created: false };
  await db.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (source_id) DO NOTHING`,
  ).bind(s.sourceId, s.displayName, s.kind, s.licenseName, s.licenseUrl, s.attributionText, s.publicationStatus, now, now).run();
  return { created: true };
}

/**
 * Re-applies a reviewed entry to an existing registry row: the upgrade path for a database created
 * before the review, for example a Taito row still stored as 'blocked' with no attribution text.
 * It is a named operation (`npm run local:registry`), never a side effect of ingest, and it can
 * only move a row to the status this repository has reviewed for that specific source.
 * Publication is not changed here: tiles reflect the new status at the next publish (ADR-0006
 * decision 11), which is also how a downgrade to 'blocked' empties the tiles.
 */
export async function applyReviewedSourceRegistry(
  db: Db,
  sourceId: string,
  now: string,
): Promise<{ status: "absent" | "unchanged" | "updated"; publicationStatus: "approved" | "blocked" }> {
  const s = reviewedSource(sourceId);
  const row = await db.prepare(
    "SELECT display_name, kind, license_name, license_url, attribution_text, publication_status FROM sources WHERE source_id = ?",
  ).bind(s.sourceId).first<{
    display_name: string; kind: string; license_name: string | null; license_url: string | null;
    attribution_text: string | null; publication_status: "approved" | "blocked";
  }>();
  if (!row) return { status: "absent", publicationStatus: s.publicationStatus };
  const matches = row.display_name === s.displayName && row.kind === s.kind && row.license_name === s.licenseName
    && row.license_url === s.licenseUrl && row.attribution_text === s.attributionText
    && row.publication_status === s.publicationStatus;
  if (matches) return { status: "unchanged", publicationStatus: s.publicationStatus };
  await db.prepare(
    `UPDATE sources SET display_name = ?, kind = ?, license_name = ?, license_url = ?, attribution_text = ?,
       publication_status = ?, updated_at = ? WHERE source_id = ?`,
  ).bind(s.displayName, s.kind, s.licenseName, s.licenseUrl, s.attributionText, s.publicationStatus, now, s.sourceId).run();
  return { status: "updated", publicationStatus: s.publicationStatus };
}
