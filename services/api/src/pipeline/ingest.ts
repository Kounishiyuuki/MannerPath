// Ingest: file bytes -> one source_releases row + one immutable source_records row per record,
// written in one batch. The adapter (ADR-0008) supplies the file shape; this code is source-agnostic.
// No interpretation happens here; the resolver reads the raw rows later.

import { type Db, sha256Hex } from "../db.ts";
import type { SourceAdapter } from "./source-adapter.ts";

export interface ReleaseMetadata {
  sourceUrl: string;
  /** Date the publisher says the data reflects (YYYY-MM-DD); null when unknown. Never the fetch date. */
  observedOn: string | null;
  fetchedAt: string;
  httpLastModified: string | null;
}

/**
 * Stores a file in `adapter`'s format as a release of the adapter's own source. The source identity
 * is `adapter.registry.sourceId` and nothing else (ADR-0008): a caller cannot file one source's
 * bytes under another. Re-ingesting the same bytes for the same observation returns the existing
 * release.
 */
export async function ingestRelease(
  db: Db,
  adapter: SourceAdapter,
  bytes: Uint8Array,
  meta: ReleaseMetadata,
): Promise<{ releaseId: number; created: boolean }> {
  const sourceId = adapter.registry.sourceId;
  const contentSha = await sha256Hex(bytes);
  const existing = await db.prepare(
    "SELECT release_id FROM source_releases WHERE source_id = ? AND content_sha256 = ? AND observed_on IS ?",
  ).bind(sourceId, contentSha, meta.observedOn).first<{ release_id: number }>();
  if (existing) return { releaseId: existing.release_id, created: false };

  const { header, rows } = adapter.parse(bytes);

  // Records find their release by (source, hash, observation) so the whole release is one batch.
  const releaseLookup = "(SELECT release_id FROM source_releases WHERE source_id = ? AND content_sha256 = ? AND observed_on IS ?)";
  const statements = [
    db.prepare(
      `INSERT INTO source_releases (source_id, observed_on, fetched_at, source_url, http_last_modified, content_sha256,
         byte_length, header_json, record_count, parser_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(sourceId, meta.observedOn, meta.fetchedAt, meta.sourceUrl, meta.httpLastModified, contentSha,
      bytes.byteLength, JSON.stringify(header), rows.length, adapter.parserVersion),
  ];
  for (const [i, values] of rows.entries()) {
    const rawJson = JSON.stringify(values);
    statements.push(db.prepare(
      `INSERT INTO source_records (release_id, ordinal, upstream_row_ref, raw_values_json, raw_sha256)
       VALUES (${releaseLookup}, ?, ?, ?, ?)`,
    ).bind(sourceId, contentSha, meta.observedOn, i + 1, adapter.upstreamRowRef(values), rawJson, await sha256Hex(rawJson)));
  }
  await db.batch(statements);

  const created = await db.prepare(
    "SELECT release_id FROM source_releases WHERE source_id = ? AND content_sha256 = ? AND observed_on IS ?",
  ).bind(sourceId, contentSha, meta.observedOn).first<{ release_id: number }>();
  if (!created) throw new Error(`ingest: release for ${sourceId} ${contentSha} was not stored`);
  return { releaseId: created.release_id, created: true };
}
