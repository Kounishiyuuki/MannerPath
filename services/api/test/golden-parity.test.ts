// Golden parity for the committed Taito fixture (Issues #68/#72, ADR-0008). The whole pipeline —
// ingest -> resolve -> publish -> promotion bundle -> quality analysis — runs with deterministic
// spot IDs and clock, and every row of every table plus every derived output (tile bodies, hashes,
// ETags, promotion manifest/SQL, quality report) must equal the committed golden byte-for-byte.
//
// The golden was generated from main before the SourceAdapter extraction. A refactor must not change
// it; an intended output change regenerates it (GOLDEN_UPDATE=1) and justifies the diff in its PR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { app } from "../src/app.ts";
import { buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const GOLDEN = new URL("./golden/taito-pipeline.golden.json", import.meta.url);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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
  const quality = await analyzeCorpus(db, { now: NOW, gzip: (b) => gzipSync(b).byteLength });
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
  assert.equal(golden.tables.source_observations.length, 34);
  assert.deepEqual([...new Set(golden.tables.source_observations.map((o: { mapping_version: string }) => o.mapping_version))], ["taito-observation.v1"]);
  assert.equal(golden.publishedSpotCount, 32);
  assert.equal(golden.tiles.length, 5);
  assert.ok(golden.tiles.every((t: { status: number; etag: string | null }) => t.status === 200 && t.etag));
});
