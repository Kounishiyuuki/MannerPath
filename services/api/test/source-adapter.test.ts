// SourceAdapter boundary (ADR-0008): the registry is derived from the reviewed adapters, and a
// source's identity is its adapter's registry.sourceId — ingest cannot file bytes under another
// source, and resolve fails closed on a release whose source or parser is not the adapter's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { REVIEWED_SOURCES, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_REGISTRY, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import {
  NOW, TAITO_BYTES, importTaito, TEST_BLOCKED_SOURCE, TEST_BLOCKED_TAITO_ADAPTER, addBlockedTestSource,
} from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as Row).n;

function insertBareRelease(db: SqliteD1, sourceId: string, parserVersion: string): number {
  // Release metadata is immutable once records exist, so a mismatched release is a bare row — the
  // shape an older ingest or a hand-written INSERT could have left behind.
  return Number(db.raw.prepare(
    `INSERT INTO source_releases (source_id, observed_on, fetched_at, source_url, content_sha256, byte_length,
       header_json, record_count, parser_version)
     VALUES (?, '2026-08-18', ?, 'https://example.invalid/x.csv', ?, 1, '["#"]', 0, ?)`,
  ).run(sourceId, NOW, "a".repeat(64), parserVersion).lastInsertRowid);
}

test("the reviewed registry is exactly the adapters' registry entries, Taito first and only", () => {
  assert.deepEqual(REVIEWED_SOURCES, [TAITO_REGISTRY]);
  assert.deepEqual(SOURCE_ADAPTERS, [TAITO_ADAPTER]);
  assert.equal(new Set(SOURCE_ADAPTERS.map((a) => a.registry.sourceId)).size, SOURCE_ADAPTERS.length);
  assert.equal(SOURCE_ADAPTERS.includes(TEST_BLOCKED_TAITO_ADAPTER), false, "the test-only adapter is never reviewed");
});

test("no adapter registers an OSM source (blocked until its own ADR)", () => {
  assert.equal(SOURCE_ADAPTERS.some((a) => a.registry.kind === "osm"), false);
});

test("ingest takes no source id: the Taito adapter always creates a Taito release", async () => {
  // Arity is the API contract: (db, adapter, bytes, meta). A source id argument would reopen the gap.
  assert.equal(ingestRelease.length, 4);
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  addBlockedTestSource(db);
  const { releaseId } = await ingestRelease(db, TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.deepEqual(
    db.raw.prepare("SELECT source_id, parser_version FROM source_releases").all().map((r) => ({ ...r })),
    [{ source_id: TAITO_SOURCE_ID, parser_version: TAITO_ADAPTER.parserVersion }],
  );
  assert.equal((db.raw.prepare("SELECT count(*) AS n FROM source_records WHERE release_id = ?").get(releaseId) as Row).n, 34);
});

test("an adapter cannot be combined with another source: the release follows the adapter, not the caller", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  addBlockedTestSource(db);
  // The same bytes through the test adapter land under *its* source, never under Taito's.
  await ingestRelease(db, TEST_BLOCKED_TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.deepEqual(
    db.raw.prepare("SELECT source_id FROM source_releases").all().map((r) => (r as Row).source_id),
    [TEST_BLOCKED_SOURCE],
  );
  assert.equal(count(db, "source_releases"), 1);
});

test("resolve fails closed when the release belongs to another source than the adapter", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  addBlockedTestSource(db);
  const foreign = insertBareRelease(db, TEST_BLOCKED_SOURCE, TAITO_ADAPTER.parserVersion);
  await assert.rejects(resolveFirstRelease(db, TAITO_ADAPTER, foreign, { now: NOW }),
    new RegExp(`belongs to ${TEST_BLOCKED_SOURCE}, not to adapter source ${TAITO_SOURCE_ID}`));

  // A real, fully ingested test-source release is refused by the Taito adapter too.
  const { releaseId } = await ingestRelease(db, TEST_BLOCKED_TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await assert.rejects(resolveFirstRelease(db, TAITO_ADAPTER, releaseId, { now: NOW }), /not to adapter source/);
  assert.equal(count(db, "spots"), 0);
  assert.equal(count(db, "source_record_entities"), 0);
});

test("resolve fails closed when the release was parsed by another parser than the adapter's", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const release = insertBareRelease(db, TAITO_SOURCE_ID, "unknown-csv.v1");
  await assert.rejects(resolveFirstRelease(db, TAITO_ADAPTER, release, { now: NOW }),
    new RegExp(`was parsed by unknown-csv\\.v1, not ${TAITO_ADAPTER.parserVersion.replace(".", "\\.")}`));
  assert.equal(count(db, "spots"), 0);
});

test("identity is checked before status: an applied Taito release is refused to another source's adapter", async () => {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  const { releaseId } = await importTaito(db);
  await assert.rejects(resolveFirstRelease(db, TEST_BLOCKED_TAITO_ADAPTER, releaseId, { now: NOW }),
    new RegExp(`belongs to ${TAITO_SOURCE_ID}, not to adapter source ${TEST_BLOCKED_SOURCE}`));
  // The right adapter still sees the applied release as already applied.
  assert.deepEqual(await resolveFirstRelease(db, TAITO_ADAPTER, releaseId, { now: NOW }), { status: "alreadyApplied" });
});
