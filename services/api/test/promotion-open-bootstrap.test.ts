// Open-bootstrap runtime bypass (PR #102 review B1): a promotion_bootstraps row inserted by hand and never
// completed must not turn a pipeline database into one that accepts promotion attestations, and so manual
// links without a review chain (migration 0011's rule). Two independent guards in 0016 are fixed here: the
// open bootstrap refuses any pipeline write, and the attestation itself needs the single applied release state
// of a bundle being applied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

type Row = Record<string, any>;
const ADAPTER: SourceAdapter = { ...TAITO_ADAPTER, assertResolvable: () => {}, attenuate: () => [], crossReleaseValidated: true };
const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n");
const CHANGED = new TextEncoder().encode([LINES[0], LINES[1].replace(/^[^,]*/, "901"), ...LINES.slice(2)].join("\r\n"));
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };
const OPEN = /promotion bootstrap is open/;

const openBootstrap = (db: SqliteD1, releaseId: number) => db.raw.prepare(
  `INSERT INTO promotion_bootstraps (promotion_bootstrap_id, bundle_version, source_id, release_id, release_content_sha256,
     review_dependencies_json, expected_rows_json) VALUES (1, 'promotion-bundle.v2', ?, ?, ?, '[]', '{}')`,
).run(TAITO_SOURCE_ID, releaseId, "a".repeat(64));

/** The forged pair: a self-declared attestation, then a manual link onto the attested entity, with no review. */
function forge(db: SqliteD1, recordId: number, releaseId: number, entityId: number, previousReleaseId: number) {
  db.raw.prepare(
    `INSERT INTO promotion_review_match_attestations (record_id, release_id, decision, source_entity_id, origin_review_item_id,
       origin_review_decision_id, origin_review_match_application_id, previous_release_id, previous_release_content_sha256,
       matcher_version, candidate_entity_ids_json, decision_version, decided_by, decided_at, decision_note, executor_version, applied_at)
     VALUES (?, ?, 'matchedToEntity', ?, 1, 1, 1, ?, ?, 'forged', ?, 'review-decision.v1', 'nobody', ?, NULL, 'review-match-application.v1', ?)`,
  ).run(recordId, releaseId, entityId, previousReleaseId, "b".repeat(64), `[${entityId}]`, NOW, NOW);
  db.raw.prepare(
    `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at, note)
     VALUES (?, ?, ?, 'manual', 'forged', ?, 'forged')`,
  ).run(recordId, releaseId, entityId, NOW);
}

const unreviewedManualLinks = (db: SqliteD1) => (db.raw.prepare(
  `SELECT count(*) AS n FROM source_record_entities WHERE method = 'manual'
   AND NOT EXISTS (SELECT 1 FROM review_items)`).get() as Row).n;

test("B1 probe: a hand-opened bootstrap cannot be followed by a pipeline run", async () => {
  const db = new SqliteD1();
  openBootstrap(db, 2);
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW); // the declared source is what a bundle writes
  // The pipeline's first release is `ingested`, not the declared applied release: refused before any record.
  await assert.rejects(ingestRelease(db, ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE), OPEN);
  assert.equal((db.raw.prepare("SELECT count(*) AS n FROM source_releases").get() as Row).n, 0);
  assert.throws(() => db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES ('other', 'x', 'municipal', 'x', 'x', NULL, 'blocked', ?, ?)`).run(NOW, NOW), OPEN);
  assert.equal(unreviewedManualLinks(db), 0);
});

test("B1 probe, open-bootstrap guards removed: the attestation premise alone refuses a pipeline database", async () => {
  const db = new SqliteD1();
  openBootstrap(db, 2);
  // Drop the open-bootstrap guards so the reviewer's whole sequence (A resolved, B ingested) can run; the
  // attestation trigger must still refuse. The dropped triggers are restored before the forge.
  const guards = ["promotion_open_bootstrap_source_releases_insert", "promotion_open_bootstrap_source_releases_update",
    "promotion_open_bootstrap_source_observations"];
  const saved = guards.map((name) => (db.raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) as Row).sql);
  for (const name of guards) db.raw.exec(`DROP TRIGGER ${name}`);
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId: firstId } = await ingestRelease(db, ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.equal((await resolveFirstRelease(db, ADAPTER, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") })).status, "resolved");
  const { releaseId: secondId } = await ingestRelease(db, ADAPTER, CHANGED, SECOND);
  assert.equal(secondId, 2, "fixture: B is the declared release id");
  for (const sql of saved) db.raw.exec(sql);

  const record = (db.raw.prepare("SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = 1").get(secondId) as Row).record_id;
  const entity = (db.raw.prepare("SELECT source_entity_id FROM source_record_entities WHERE release_id = ? ORDER BY 1 DESC LIMIT 1").get(firstId) as Row).source_entity_id;
  assert.throws(() => forge(db, record, secondId, entity, firstId), /promotion_review_match_attestations: not a reviewed decision/);
  assert.equal((db.raw.prepare("SELECT count(*) AS n FROM review_items").get() as Row).n, 0);
  assert.equal(unreviewedManualLinks(db), 0, "no manual link without a review chain");
});

test("a normal pipeline database: a direct attestation or completion insert is refused", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId: firstId } = await ingestRelease(db, ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, ADAPTER, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  const { releaseId: secondId } = await ingestRelease(db, ADAPTER, CHANGED, SECOND);
  const record = (db.raw.prepare("SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = 1").get(secondId) as Row).record_id;
  const entity = (db.raw.prepare("SELECT source_entity_id FROM source_record_entities WHERE release_id = ? ORDER BY 1 LIMIT 1").get(firstId) as Row).source_entity_id;
  assert.throws(() => forge(db, record, secondId, entity, firstId), /promotion_review_match_attestations: not a reviewed decision/);
  assert.throws(() => db.raw.prepare("INSERT INTO promotion_bootstrap_completions (promotion_bootstrap_id) VALUES (1)").run(),
    /FOREIGN KEY|promotion_bootstrap_completions/);
  // Without its application, a manual link is refused as in 0011.
  assert.throws(() => db.raw.prepare(
    `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at, note)
     VALUES (?, ?, ?, 'manual', 'm', ?, NULL)`).run(record, secondId, entity, NOW), /a manual decision requires a review_match_application/);
  for (const t of ["promotion_bootstraps", "promotion_review_match_attestations", "promotion_bootstrap_completions"]) {
    assert.equal((db.raw.prepare(`SELECT count(*) AS n FROM ${t}`).get() as Row).n, 0, t);
  }
});
