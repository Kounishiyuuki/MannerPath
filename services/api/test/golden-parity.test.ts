// Golden parity for the committed Taito fixture (Issue #68, ADR-0008). The whole pipeline —
// ingest -> resolve -> publish -> promotion bundle -> quality analysis — runs with deterministic
// spot IDs and clock, and every row of every table plus every derived output (tile bodies, hashes,
// ETags, promotion manifest/SQL, quality report) must equal the committed golden byte-for-byte.
//
// Issue #70 intentionally changes only the quality report shape. The other golden sections remain byte-identical.
// Issue #73 added only `tables.source_observations`, and Issue #80 only the empty
// `tables.review_items` / `tables.review_decisions`, and Issue #84 only the empty
// `tables.review_removal_applications`, and Issue #86 only the empty
// `tables.review_match_applications`, and Issue #89 only the empty
// `tables.review_removal_resolutions`, and Issue #95 only the empty
// `tables.review_relocation_holds`, and Issue #97 only the empty
// `tables.review_relocation_applications` / `tables.review_relocation_resolutions`, and Issue #107 only the
// empty `tables.cross_source_candidates` / `cross_source_decisions` / `cross_source_merge_applications` /
// `promotion_cross_source_merge_attestations`, and Issue #124/#127 (0021) only the empty
// `report_terms_versions` / `community_effect_applications` / `community_effect_evidence` /
// `community_publication_holds` / `promotion_multi_bootstrap_additive_releases` plus the zero
// `quality.nationwide.community` block, and ADR-0011 (0022) only the empty `derived_coordinate_geocodes` /
// `derived_coordinate_reviews`, and ADR-0012 (0023) only additive members — the empty `community_evidence_upgrades`,
// the NULL `spots` refinement/community columns and `source_observations.claims_json`, the tile spots' `spotSubtype`
// / `hostType` / `accessDetail` / `verification` fields (and the hashes, ETags, sizes and promotion bytes that follow
// from them), the `quality.nationwide.coverage` / `confidence` blocks and the passing `confidence-never-overstated`
// check; every other byte was unchanged.
//
// Compressed tile sizes depend on the zlib build (Issue #76), so the golden's quality analysis runs
// with a deterministic stand-in sizer instead of node:zlib. Its `gzipBytes` figures are therefore
// synthetic; the gate those figures feed is tested against TILE_REEVALUATION_GZIP_BYTES in
// data-quality.test.ts. Raw tile bytes, hashes and ETags stay pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { app } from "../src/app.ts";
import { buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const GOLDEN = new URL("./golden/taito-pipeline.golden.json", import.meta.url);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const portableGzipSize = (body: string) => Math.ceil(Buffer.byteLength(body) / 4);

function dumpTables(db: SqliteD1): Record<string, unknown[]> {
  const tables = db.raw.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' ORDER BY name",
  ).all() as { name: string }[];
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    const columns = (db.raw.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
    const order = columns.map((_, i) => i + 1).join(", ");
    out[name] = (db.raw.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all() as Record<string, unknown>[])
      .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) =>
        [k, v instanceof Uint8Array ? `hex:${Buffer.from(v).toString("hex")}` : v])));
  }
  return out;
}

async function pipelineOutputs() {
  const db = new SqliteD1();
  const imported = await importTaito(db, { newSpotId: sequentialSpotIds() });
  const publish = await publishTiles(db, { now: NOW });
  const tiles = [];
  for (const { tileId } of publish.published) {
    const res = await app.request(`/v1/tiles/${tileId}`, {}, { DB: db });
    const body = await res.text();
    tiles.push({ tileId, status: res.status, etag: res.headers.get("ETag"), bodySha256: sha256(body), body });
  }
  const promotion = await buildPromotionBundle(db);
  const quality = await analyzeCorpus(db, { now: NOW, gzip: portableGzipSize });
  return {
    imported,
    publish,
    publishedSpotCount: publish.published.reduce((n, t) => n + t.spotCount, 0),
    tiles,
    promotion: { manifest: promotion.manifest, sqlSha256: sha256(promotion.sql) },
    quality,
    tables: dumpTables(db),
  };
}

test("Taito fixture pipeline output is byte-identical to the committed golden", async () => {
  const actual = `${JSON.stringify(await pipelineOutputs(), null, 2)}\n`;
  if (process.env.GOLDEN_UPDATE === "1") writeFileSync(GOLDEN, actual);
  const expected = readFileSync(GOLDEN, "utf8");
  // Compare structurally first for a readable diff, then byte-for-byte.
  assert.deepEqual(JSON.parse(actual), JSON.parse(expected));
  assert.equal(actual, expected);
});

test("the golden itself pins the documented Taito publication: 34 canonical, 32 published, 5 tiles", () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.equal(golden.tables.spots.length, 34);
  assert.equal(golden.publishedSpotCount, 32);
  assert.equal(golden.tiles.length, 5);
  assert.ok(golden.tiles.every((t: { status: number; etag: string | null }) => t.status === 200 && t.etag));
});
