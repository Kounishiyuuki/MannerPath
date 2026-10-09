import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { checkSourceHealth } from "../src/source-health/check.ts";
import { productionHealthTargets } from "../scripts/source-health.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { importAllReviewedSources, REVIEWED_FIXTURES, reviewedFixtureBytes } from "./support/reviewed-fixtures.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-10-09T00:00:00Z";

// Compare every canonical table, including evidence and publication state, without pinning corpus counts.
function databaseContents(db: SqliteD1) {
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return tables.map(({ name }) => ({
    name,
    rows: db.raw.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort(),
  }));
}

test("source health failures and changed payloads leave the approved corpus and registry intact", async t => {
  const db = new SqliteD1();
  t.after(() => db.raw.close());
  await importAllReviewedSources(db, NOW);
  await publishTiles(db, { now: NOW });
  const beforeDatabase = databaseContents(db);
  const beforeRegistry = JSON.stringify(SOURCE_ADAPTERS.map(adapter => adapter.registry));
  const beforeTiles = v1TileRows(db);
  assert.ok(beforeTiles.length > 0, "exercise actual published manifests and assembled tile bodies");
  const targets = productionHealthTargets();
  assert.deepEqual(targets.map(target => target.adapter.registry.sourceId).sort(),
    SOURCE_ADAPTERS.map(adapter => adapter.registry.sourceId).sort());

  for (const target of targets) {
    for (const [httpStatus, expected] of [[403, "accessBlocked"], [404, "unavailable"]] as const) {
      const result = await checkSourceHealth(target, {
        fetch: async () => new Response(null, { status: httpStatus }),
      });
      assert.equal(result.status, expected, target.adapter.registry.sourceId);
      assert.deepEqual(databaseContents(db), beforeDatabase);
      assert.equal(JSON.stringify(SOURCE_ADAPTERS.map(adapter => adapter.registry)), beforeRegistry);
    }
  }

  // A changed but schema-compatible response must remain advisory too; never ingest or publish it.
  const target = targets.find(item => item.adapter.registry.sourceId === "taito-public-smoking-areas")!;
  const original = reviewedFixtureBytes(REVIEWED_FIXTURES[target.adapter.registry.sourceId].file);
  // Change transport line endings without changing parsed cells or the original character encoding.
  const changed = original.filter((byte, index) => !(byte === 13 && original[index + 1] === 10));
  assert.notEqual(changed.length, original.length);
  const result = await checkSourceHealth(target, {
    fetch: async () => new Response(changed, { headers: { "content-type": "text/csv" } }),
  });
  assert.equal(result.status, "contentChanged");
  assert.equal(result.parserCompatible, true);
  assert.equal(result.schemaCompatible, true);
  assert.notEqual(result.payloadSha256, target.baselineSha256);
  assert.deepEqual(databaseContents(db), beforeDatabase);
  assert.equal(JSON.stringify(SOURCE_ADAPTERS.map(adapter => adapter.registry)), beforeRegistry);
  assert.deepEqual(v1TileRows(db), beforeTiles, "source and spot IDs, manifests, parts and assembled bodies stay unchanged");
});
