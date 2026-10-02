import { EARTH_RADIUS_M } from "../geo/distance.ts";
import type { Db } from "../db.ts";
import { SEED_AREAS, SEED_RADIUS_METRES } from "./seed-areas.ts";
import { gapTasks } from "./tasks.ts";

export const MAX_COVERAGE_PROBE_ROWS = 4096;
export class CoverageProbeOverflow extends Error {}

/** One indexed statement, independent of corpus size. The inner diamond is guaranteed covered by a
 * latitude/longitude path no longer than the radius; only ambiguous bounding-box candidates need exact distance.
 * Membership in the published snapshot remains the rights gate. No canonical/report-only row counts. */
export async function publishedGapTasks(db: Db) {
  const radius = SEED_RADIUS_METRES;
  const seeds = SEED_AREAS.map((s) => {
    const dy = radius / 110_000;
    return { ...s, dy, dx: dy / Math.cos((Math.abs(s.latitude) + dy) * Math.PI / 180),
      lonMeters: EARTH_RADIUS_M * Math.PI / 180 * Math.cos(s.latitude * Math.PI / 180) };
  });
  const rows = (await db.prepare(`
    WITH seeds AS (SELECT value AS seed FROM json_each(?)),
    covered AS MATERIALIZED (
      SELECT seed FROM seeds WHERE EXISTS (
        SELECT 1 FROM spots s WHERE
          s.latitude BETWEEN json_extract(seed,'$.latitude')-json_extract(seed,'$.dy') AND json_extract(seed,'$.latitude')+json_extract(seed,'$.dy')
          AND s.longitude BETWEEN json_extract(seed,'$.longitude')-json_extract(seed,'$.dx') AND json_extract(seed,'$.longitude')+json_extract(seed,'$.dx')
          AND abs(s.latitude-json_extract(seed,'$.latitude'))*${EARTH_RADIUS_M * Math.PI / 180}
            + abs(s.longitude-json_extract(seed,'$.longitude'))*json_extract(seed,'$.lonMeters') <= ?
          AND EXISTS (SELECT 1 FROM tile_snapshot_spots t WHERE t.spot_id=s.spot_id)
      )
    )
    SELECT json_extract(a.seed,'$.id') AS id, s.latitude, s.longitude FROM seeds a
      JOIN spots s ON s.latitude BETWEEN json_extract(a.seed,'$.latitude')-json_extract(a.seed,'$.dy') AND json_extract(a.seed,'$.latitude')+json_extract(a.seed,'$.dy')
        AND s.longitude BETWEEN json_extract(a.seed,'$.longitude')-json_extract(a.seed,'$.dx') AND json_extract(a.seed,'$.longitude')+json_extract(a.seed,'$.dx')
    WHERE NOT EXISTS (SELECT 1 FROM covered c WHERE json_extract(c.seed,'$.id')=json_extract(a.seed,'$.id'))
      AND EXISTS (SELECT 1 FROM tile_snapshot_spots t WHERE t.spot_id=s.spot_id)
    UNION ALL SELECT json_extract(seed,'$.id'), json_extract(seed,'$.latitude'), json_extract(seed,'$.longitude') FROM covered
    LIMIT 4097
  `).bind(JSON.stringify(seeds), radius).all<{ id: string; latitude: number; longitude: number }>()).results;
  if (rows.length > MAX_COVERAGE_PROBE_ROWS) throw new CoverageProbeOverflow("coverage boundary candidate budget exceeded");
  // Exact checks for the outer box, and one centre sentinel for each proven covered area.
  const bySeed = new Map<string, { latitude: number; longitude: number }[]>();
  for (const r of rows) { const list = bySeed.get(r.id) ?? []; list.push(r); bySeed.set(r.id, list); }
  return SEED_AREAS.flatMap((seed) => gapTasks(bySeed.get(seed.id) ?? [], { seedAreas: [seed] }))
    .sort((a,b) => a.priority-b.priority || a.seedAreaId.localeCompare(b.seedAreaId));
}
