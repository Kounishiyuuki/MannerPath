// A reviewed current release must bootstrap through the real migrated schema. These artificial
// second releases use a TEST-ONLY open Taito adapter; production Taito cross-release gates stay closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { type SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite } from "./support/sqlite-d1.ts";

const ADAPTER: SourceAdapter = { ...TAITO_ADAPTER, assertResolvable: () => {}, attenuate: () => [], crossReleaseValidated: true };
const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n");
const bytes = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));
const changedRef = bytes([LINES[0], LINES[1].replace(/^[^,]*/, "901"), ...LINES.slice(2)]);
const noRef = LINES[1].replace(/^[^,]*/, "");
const duplicate = bytes([LINES[0], noRef, noRef, ...LINES.slice(2)]);
const SECOND = { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" };
const LATER = "2026-09-26T03:00:00Z";

async function reviewedRelease(nextBytes: Uint8Array, decisions: ("matchedToEntity" | "confirmedNew")[]) {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId: firstId } = await ingestRelease(db, ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  assert.equal((await resolveFirstRelease(db, ADAPTER, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  const prior = db.raw.prepare(`SELECT source_entity_id FROM source_record_entities WHERE release_id = ? AND record_id =
    (SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = 1)`).get(firstId, firstId) as { source_entity_id: number };
  const { releaseId: secondId } = await ingestRelease(db, ADAPTER, nextBytes, SECOND);
  const initial = await resolveFirstRelease(db, ADAPTER, secondId, { now: LATER, newSpotId: sequentialSpotIds("B") });
  assert.equal(initial.status, "needsReview");
  const itemIds = initial.status === "needsReview" ? initial.reviewItemIds : [];
  assert.equal(itemIds.length, decisions.length);
  for (let i = 0; i < decisions.length; i++) {
    await recordReviewDecision(db, { reviewItemId: itemIds[i], decision: decisions[i],
      sourceEntityId: decisions[i] === "matchedToEntity" ? prior.source_entity_id : undefined,
      decidedBy: "test-reviewer", decidedAt: LATER });
  }
  assert.equal((await resolveFirstRelease(db, ADAPTER, secondId, { now: LATER, newSpotId: sequentialSpotIds("B") })).status, "resolved");
  await publishTiles(db, { now: LATER });
  return { db, secondId, firstId };
}

for (const [name, nextBytes, decisions] of [
  ["matchedToEntity", changedRef, ["matchedToEntity"]],
  ["matchedToEntity and confirmedNew", duplicate, ["matchedToEntity", "confirmedNew"]],
] as const) {
  test(`${name}: the current release and review attestation bootstrap deterministically`, async () => {
    const { db, secondId, firstId } = await reviewedRelease(nextBytes, [...decisions]);
    const bundle = await buildPromotionBundle(db);
    assert.equal(bundle.manifest.releaseId, secondId);
    assert.equal(bundle.manifest.rows.source_releases, 1);
    assert.equal(bundle.manifest.rows.promotion_review_match_attestations, decisions.length);
    assert.equal(bundle.sql, (await buildPromotionBundle(db)).sql);
    const target = migratedSqlite();
    applyPromotionBundle(target, bundle.sql);
    const imported = new SqliteD1(target);
    const rows = (sql: string) => imported.raw.prepare(sql).all();
    assert.deepEqual(rows("SELECT decision, source_entity_id FROM promotion_review_match_attestations ORDER BY record_id"),
      db.raw.prepare("SELECT decision, source_entity_id FROM review_match_applications ORDER BY record_id").all());
    assert.equal((target.prepare("SELECT count(*) n FROM source_releases WHERE release_id = ? AND status = 'applied' AND is_current = 1").get(secondId) as any).n, 1);
    assert.equal((target.prepare("SELECT count(*) n FROM source_releases WHERE release_id = ?").get(firstId) as any).n, 0);
    assert.deepEqual(rows("SELECT tile_id, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id"),
      db.raw.prepare("SELECT tile_id, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id").all());
    assert.equal((await buildPromotionBundle(imported)).sql, bundle.sql, "re-export preserves the reviewed bundle bytes");
  });
}

test("tampered reviewed dependency fails closed at the receiving schema guard", async () => {
  const { db } = await reviewedRelease(changedRef, ["matchedToEntity"]);
  const { sql } = await buildPromotionBundle(db);
  const attestation = sql.split("\n").find((line) => line.startsWith("INSERT INTO promotion_review_match_attestations "))!;
  assert.ok(attestation.includes("'["), "candidate list is present");
  const tampered = sql.replace(attestation, attestation.replace(/'\[\d+\]'/, "'[]'"));
  assert.notEqual(tampered, sql);
  const target = migratedSqlite();
  assert.throws(() => applyPromotionBundle(target, tampered),
    /promotion_review_match_attestations: not a reviewed decision of an open bootstrap's release \(record, entity, candidates or order\)/);
  assert.equal((target.prepare("SELECT count(*) n FROM promotion_bootstrap_completions").get() as any).n, 0);
  assert.equal((target.prepare("SELECT count(*) n FROM sources").get() as any).n, 0, "failed import rolls back earlier rows");
});

test("changed previous-release fingerprint fails at completion and rolls back", async () => {
  const { db } = await reviewedRelease(changedRef, ["matchedToEntity"]);
  const { sql } = await buildPromotionBundle(db);
  const attestation = sql.split("\n").find((line) => line.startsWith("INSERT INTO promotion_review_match_attestations "))!;
  const previousHash = (db.raw.prepare("SELECT content_sha256 FROM source_releases WHERE is_current = 0").get() as { content_sha256: string }).content_sha256;
  const tampered = sql.replace(attestation, attestation.replace(`'${previousHash}'`, `'${"f".repeat(64)}'`));
  assert.notEqual(tampered, sql);
  const target = migratedSqlite();
  assert.throws(() => applyPromotionBundle(target, tampered),
    /promotion_bootstrap_completions: the database does not hold exactly the declared, complete release/);
  assert.equal((target.prepare("SELECT count(*) n FROM sources").get() as any).n, 0);
});
