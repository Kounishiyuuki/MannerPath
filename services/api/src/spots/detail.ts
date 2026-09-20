// Published spot detail (ADR-0006, docs/API.md). Publication membership is the public read gate:
// every read starts from tile_snapshot_spots, so a canonical spot that is not in a published
// snapshot — blocked source, never published, merged, removed — is not reachable here at all.
// The source/release conditions are repeated as defence in depth against a stale snapshot row.

import { type Db } from "../db.ts";
import { type CandidateRow, sourceDto, spotDto } from "../tiles/publish.ts";
import { PUBLIC_PROVENANCE_FIELDS, SPOT_DETAIL_SCHEMA_VERSION, SpotDetailBodyV1, type SpotProvenanceV1 } from "./dto.ts";

type DetailRow = CandidateRow & { tile_snapshot_id: string };

export async function readPublishedSpot(db: Db, requestedId: string): Promise<SpotDetailBodyV1 | null> {
  // One hop only: spots triggers guarantee a merge target is itself unmerged (ADR-0006 decision 9).
  const requested = await db.prepare("SELECT merged_into FROM spots WHERE spot_id = ?")
    .bind(requestedId).first<{ merged_into: string | null }>();
  const mergedInto = requested?.merged_into ?? null;
  const targetId = mergedInto ?? requestedId;

  const row = await db.prepare(
    `SELECT s.spot_id, s.name, s.latitude, s.longitude, s.tile_id, s.tile_z, s.tile_x, s.tile_y, s.spot_type,
            s.access_type, s.environment, s.supports_paper, s.supports_heated, s.opening_hours_raw,
            s.opening_hours_json, s.opening_hours_status, s.time_zone, s.evidence_quality,
            s.evidence_quality_version, s.last_verified_at,
            src.source_id, src.display_name, src.license_name, src.license_url, src.attribution_text, src.publication_status,
            ts.tile_id AS tile_snapshot_id
     FROM tile_snapshot_spots ts
     JOIN spots s ON s.spot_id = ts.spot_id
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     JOIN sources src ON src.source_id = rel.source_id
     WHERE ts.spot_id = ? AND s.lifecycle = 'active' AND s.merged_into IS NULL
       AND rel.status = 'applied' AND src.publication_status = 'approved'`,
  ).bind(targetId).first<DetailRow>();
  if (row === null) return null;

  // Provenance of resolved fields, limited to the same publishable evidence and to the public field
  // allowlist. The column's own CHECK constraint is not the public vocabulary, so the allowlist is
  // applied in SQL: a provenance field added later is withheld by default. Only the source, the
  // named rule and the observation date are public; raw records and internal IDs never leave here.
  const fields = PUBLIC_PROVENANCE_FIELDS;
  const { results: provenance } = await db.prepare(
    `SELECT p.field, rel.source_id, p.rule, rel.observed_on
     FROM spot_field_provenance p
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     JOIN sources src ON src.source_id = rel.source_id
     WHERE p.spot_id = ? AND rel.status = 'applied' AND src.publication_status = 'approved'
       AND p.field IN (${fields.map(() => "?").join(", ")})
     ORDER BY p.field`,
  ).bind(targetId, ...fields).all<{ field: SpotProvenanceV1["field"]; source_id: string; rule: string; observed_on: string | null }>();

  // Last gate before the body leaves the server: a DTO drift or an unexpected canonical value is a
  // 500, never a silently malformed or over-sharing public response.
  return SpotDetailBodyV1.parse({
    schemaVersion: SPOT_DETAIL_SCHEMA_VERSION,
    requestedId,
    mergedInto,
    spot: { ...spotDto(row), tile: row.tile_snapshot_id },
    sources: [sourceDto(row)],
    provenance: provenance.map((p) => ({ field: p.field, sourceId: p.source_id, rule: p.rule, observedOn: p.observed_on })),
  });
}
