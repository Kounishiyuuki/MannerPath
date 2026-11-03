// Research-only reproduction: fresh in-memory SQLite through the real D1 migrations.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { SqliteD1, applyPromotionBundle } from "../../../services/api/test/support/sqlite-d1.ts";
import { importAllReviewedSources } from "../../../services/api/test/support/reviewed-fixtures.ts";
import { publishTiles } from "../../../services/api/src/tiles/publish.ts";
import { analyzeCorpus } from "../../../services/api/src/quality/analyze.ts";
import { buildMultiSourcePromotionBundle, verifyPromotionBundle } from "../../../services/api/src/pipeline/promotion.ts";
import { generateCrossSourceCandidates } from "../../../services/api/src/pipeline/cross-source.ts";

const now = "2026-10-10T00:00:00Z";
const db = new SqliteD1();
const target = new SqliteD1();
try {
  await importAllReviewedSources(db, now);
  await publishTiles(db, { now });
  const count = (table: string) => (db.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
  const quality = await analyzeCorpus(db, { now });
  assert.equal(quality.failedChecks, 0);
  const baseline = {
    sources: count("sources"), canonical: count("spots"),
    published: count("tile_snapshot_spots"), tiles: count("tile_snapshots"),
  };
  assert.deepEqual(baseline, { sources: 6, canonical: 515, published: 513, tiles: 81 });
  const cross = await generateCrossSourceCandidates(db, { now });
  assert.equal(cross.length, 0);
  const bundle = await buildMultiSourcePromotionBundle(db);
  await verifyPromotionBundle(bundle.sql, bundle.manifest.contentSha256);
  applyPromotionBundle(target.raw, bundle.sql);
  const targetQuality = await analyzeCorpus(target, { now });
  assert.equal(targetQuality.failedChecks, 0);
  const exported = await buildMultiSourcePromotionBundle(target);
  assert.equal(exported.sql, bundle.sql);
  const targetCount = (table: string) => (target.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
  const summary = {
    baseline, quality: { passed: quality.checks.length, failed: quality.failedChecks },
    crossSourceCandidates: cross.length,
    promotion: {
      version: bundle.manifest.generator, contentSha256: bundle.manifest.contentSha256, verified: true,
      targetCanonical: targetCount("spots"), targetPublished: targetCount("tile_snapshot_spots"),
      targetTiles: targetCount("tile_snapshots"),
      targetQuality: { passed: targetQuality.checks.length, failed: targetQuality.failedChecks },
      byteIdenticalReexport: true,
    },
    coverage: quality.nationwide.communityAcquisition.prefectureCoverage.prefectures
      .filter(p => ["22", "23", "25", "28"].includes(p.code)),
  };
  // Exclusive output creation; no DB file, production operation, or raw source rows exported.
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(summary));
} finally {
  db.raw.close();
  target.raw.close();
}
