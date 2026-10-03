// Research only: fresh in-memory reproduction; never opens local or remote D1.
import { writeFileSync } from 'node:fs';
import { SqliteD1 } from '../../../services/api/test/support/sqlite-d1.ts';
import { importAllReviewedSources } from '../../../services/api/test/support/reviewed-fixtures.ts';
import { publishTiles } from '../../../services/api/src/tiles/publish.ts';

if (!process.argv[2]) throw new Error('Usage: node openpoi-official-baseline.mjs <output.json>');
const db = new SqliteD1();
try {
  const now = '2026-10-04T00:00:00Z';
  await importAllReviewedSources(db, now);
  await publishTiles(db, { now });
  const records = db.raw.prepare(`
    SELECT s.spot_id, s.name, s.latitude, s.longitude, src.source_id,
           r.upstream_row_ref, r.raw_values_json, rel.content_sha256
    FROM spots s JOIN tile_snapshot_spots t USING (spot_id)
    JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
    JOIN source_records r USING (record_id)
    JOIN source_releases rel USING (release_id)
    JOIN sources src USING (source_id) ORDER BY s.spot_id
  `).all();
  writeFileSync(process.argv[2], JSON.stringify(records) + '\n');
  console.log(`Reproduced ${records.length} published official records`);
} finally {
  db.raw.close();
}
