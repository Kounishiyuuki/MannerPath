// ADR-0017 (0030 area_point_mappings, review F4): the reviewed area-point mapping of a source, per mapping version — which
// header columns of its publications ARE the area name, latitude and longitude. It comes only from the reviewed adapter
// code (`SourceAdapter.areaPointColumns`), is registered once per (source, mapping version) and is immutable, so an anchor
// never names its own columns and no caller can read a point out of other numeric cells of the same record.
import type { Db, DbStatement } from "../db.ts";
import type { SourceAdapter } from "./source-adapter.ts";

/** The anchor policy the mapping is reviewed under (area-anchor.ts AREA_ANCHOR_POLICY_VERSION; no import, to avoid a cycle). */
const AREA_ANCHOR_POLICY_VERSION_ID = "area-anchor-policy.v1";

/** Idempotent registration statement for a batch; nothing when the adapter states no area points. */
export function areaPointMappingStatements(db: Db, adapter: SourceAdapter, now: string): DbStatement[] {
  const c = adapter.areaPointColumns;
  if (!c) return [];
  return [db.prepare(
    `INSERT INTO area_point_mappings (source_id, mapping_version, name_column, latitude_column, longitude_column, policy_version,
       reviewed_by, reviewed_on, recorded_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM area_point_mappings WHERE source_id = ? AND mapping_version = ?)`,
  ).bind(adapter.registry.sourceId, adapter.mappingVersion, c.name, c.latitude, c.longitude, AREA_ANCHOR_POLICY_VERSION_ID,
    c.reviewedBy, c.reviewedOn, now, adapter.registry.sourceId, adapter.mappingVersion)];
}

/** Registers the adapter's mapping, refusing a different mapping already registered under the same version. */
export async function registerAreaPointMapping(db: Db, adapter: SourceAdapter, now: string): Promise<void> {
  const c = adapter.areaPointColumns;
  if (!c) throw new Error(`area point mapping: ${adapter.registry.sourceId} states no reviewed area-point columns`);
  const existing = await db.prepare(
    "SELECT name_column, latitude_column, longitude_column FROM area_point_mappings WHERE source_id = ? AND mapping_version = ?",
  ).bind(adapter.registry.sourceId, adapter.mappingVersion).first<{ name_column: string; latitude_column: string; longitude_column: string }>();
  if (existing) {
    if (existing.name_column !== c.name || existing.latitude_column !== c.latitude || existing.longitude_column !== c.longitude) {
      throw new Error(`area point mapping: ${adapter.registry.sourceId} ${adapter.mappingVersion} was registered with other columns; a changed mapping needs a new mappingVersion`);
    }
    return;
  }
  await db.batch(areaPointMappingStatements(db, adapter, now));
}
