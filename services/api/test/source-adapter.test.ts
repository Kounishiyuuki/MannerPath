// SourceAdapter boundary (ADR-0008): the registry is derived from the reviewed adapters, resolve
// dispatches on the release's parser_version, and a release no adapter parses is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_ADAPTERS, adapterForParserVersion } from "../src/pipeline/adapters.ts";
import { REVIEWED_SOURCES, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_PARSER_VERSION, TAITO_REGISTRY } from "../src/pipeline/taito.ts";
import { NOW } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

test("the reviewed registry is exactly the adapters' registry entries, Taito first and only", () => {
  assert.deepEqual(REVIEWED_SOURCES, [TAITO_REGISTRY]);
  assert.deepEqual(SOURCE_ADAPTERS, [TAITO_ADAPTER]);
  assert.equal(new Set(SOURCE_ADAPTERS.map((a) => a.parserVersion)).size, SOURCE_ADAPTERS.length);
});

test("no adapter registers an OSM source (blocked until its own ADR)", () => {
  assert.equal(SOURCE_ADAPTERS.some((a) => a.registry.kind === "osm"), false);
});

test("resolve dispatches on parser_version and refuses a release no adapter parses", async () => {
  assert.equal(adapterForParserVersion(TAITO_PARSER_VERSION), TAITO_ADAPTER);
  assert.throws(() => adapterForParserVersion("unknown-csv.v1"), /no reviewed source adapter parses unknown-csv\.v1/);

  // Release metadata is immutable once records exist, so the unparseable release is a bare row.
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_REGISTRY.sourceId, NOW);
  db.raw.prepare(
    `INSERT INTO source_releases (source_id, observed_on, fetched_at, source_url, content_sha256, byte_length,
       header_json, record_count, parser_version)
     VALUES (?, '2026-08-18', ?, 'https://example.invalid/x.csv', ?, 1, '["#"]', 0, 'unknown-csv.v1')`,
  ).run(TAITO_REGISTRY.sourceId, NOW, "a".repeat(64));
  await assert.rejects(resolveFirstRelease(db, 1, { now: NOW }), /no reviewed source adapter parses unknown-csv\.v1/);
});
