// Ingest: file bytes -> one source_releases row + one immutable source_records row per CSV record,
// written in one batch. No interpretation happens here; the resolver reads the raw rows later.

import { type Db, sha256Hex } from "../db.ts";
import { parseCsv } from "./csv.ts";
import { TAITO_PARSER_VERSION, TAITO_REGISTRY, assertTaitoHeader } from "./taito.ts";

export interface ReleaseMetadata {
  sourceUrl: string;
  /** Date the publisher says the data reflects (YYYY-MM-DD); null when unknown. Never the fetch date. */
  observedOn: string | null;
  fetchedAt: string;
  httpLastModified: string | null;
}

/** Inserts the Taito registry row if missing. Never changes an existing row, so never approves a source. */
export async function ensureTaitoSource(db: Db, now: string): Promise<void> {
  const s = TAITO_REGISTRY;
  await db.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'blocked', ?, ?) ON CONFLICT (source_id) DO NOTHING`,
  ).bind(s.sourceId, s.displayName, s.kind, s.licenseName, s.licenseUrl, s.attributionText, now, now).run();
}

/**
 * Stores a Taito-format CSV as a release of `sourceId` (the registered Taito source in production;
 * tests may pass an isolated source). Re-ingesting the same bytes for the same observation returns
 * the existing release.
 */
export async function ingestTaitoCsv(
  db: Db,
  sourceId: string,
  bytes: Uint8Array,
  meta: ReleaseMetadata,
): Promise<{ releaseId: number; created: boolean }> {
  const contentSha = await sha256Hex(bytes);
  const existing = await db.prepare(
    "SELECT release_id FROM source_releases WHERE source_id = ? AND content_sha256 = ? AND observed_on IS ?",
  ).bind(sourceId, contentSha, meta.observedOn).first<{ release_id: number }>();
  if (existing) return { releaseId: existing.release_id, created: false };

  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  const { header, rows } = parseCsv(text);
  assertTaitoHeader(header);

  // Records find their release by (source, hash, observation) so the whole release is one batch.
  const releaseLookup = "(SELECT release_id FROM source_releases WHERE source_id = ? AND content_sha256 = ? AND observed_on IS ?)";
  const statements = [
    db.prepare(
      `INSERT INTO source_releases (source_id, observed_on, fetched_at, source_url, http_last_modified, content_sha256,
         byte_length, header_json, record_count, parser_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(sourceId, meta.observedOn, meta.fetchedAt, meta.sourceUrl, meta.httpLastModified, contentSha,
      bytes.byteLength, JSON.stringify(header), rows.length, TAITO_PARSER_VERSION),
  ];
  for (const [i, values] of rows.entries()) {
    const rawJson = JSON.stringify(values);
    statements.push(db.prepare(
      `INSERT INTO source_records (release_id, ordinal, upstream_row_ref, raw_values_json, raw_sha256)
       VALUES (${releaseLookup}, ?, ?, ?, ?)`,
    ).bind(sourceId, contentSha, meta.observedOn, i + 1, values[0] === "" ? null : values[0], rawJson, await sha256Hex(rawJson)));
  }
  await db.batch(statements);

  const created = await db.prepare(
    "SELECT release_id FROM source_releases WHERE source_id = ? AND content_sha256 = ? AND observed_on IS ?",
  ).bind(sourceId, contentSha, meta.observedOn).first<{ release_id: number }>();
  if (!created) throw new Error(`ingest: release for ${sourceId} ${contentSha} was not stored`);
  return { releaseId: created.release_id, created: true };
}
