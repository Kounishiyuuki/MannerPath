// A reviewed current release must bootstrap through the real migrated schema. These artificial
// second releases use a TEST-ONLY open Taito adapter; production Taito cross-release gates stay closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { PromotionError, buildPromotionBundle, verifyPromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { type SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, sequentialSpotIds } from "./support/fixture.ts";
import { rehashed } from "./support/promotion-tamper.ts";
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

// The known trust boundary (Issue #100): dropping a confirmedNew attestation together with its declared
// count and dependency leaves a bundle the target cannot tell from a genuine one, because the previous
// release and the origin review queue do not travel. Only the reviewed hash, checked before apply, stops it.
test("coordinated confirmedNew tamper with a rewritten header hash applies, and only the reviewed hash stops it", async () => {
  const { db } = await reviewedRelease(duplicate, ["matchedToEntity", "confirmedNew"]);
  const { sql, manifest } = await buildPromotionBundle(db);
  const confirmedNew = sql.split("\n").find((l) => l.startsWith("INSERT INTO promotion_review_match_attestations ") && l.includes("'confirmedNew'"))!;
  const recordId = /VALUES \((\d+),/.exec(confirmedNew)![1];
  const tampered = await rehashed(sql, (body) => body
    .replace(`${confirmedNew}\n`, "")
    .replace('"promotion_review_match_attestations":2', '"promotion_review_match_attestations":1')
    .replace(new RegExp(`,?\\{"recordId":${recordId},[^}]*\\}`), ""));
  assert.equal(tampered.split("\n").filter((l) => l.includes("'confirmedNew'")).length, 0);

  const target = migratedSqlite();
  applyPromotionBundle(target, tampered);
  assert.equal((target.prepare("SELECT count(*) n FROM promotion_review_match_attestations").get() as any).n, 1,
    "the database alone accepts the consistent edit: this is the boundary the verifier exists for");

  const tamperedHash = /^-- contentSha256: ([0-9a-f]{64})$/m.exec(tampered)![1];
  assert.equal(await verifyPromotionBundle(tampered, tamperedHash), tamperedHash, "the file agrees with itself");
  await assert.rejects(() => verifyPromotionBundle(tampered, manifest.contentSha256), (e: Error) =>
    e instanceof PromotionError && /the reviewed record says /.test(e.message));
  assert.equal(await verifyPromotionBundle(sql, manifest.contentSha256), manifest.contentSha256);
});

// Single-row edits of a reviewed bundle, each refused by the target's schema with nothing left behind. (A
// coordinated edit that also rewrites the declarations is the verifier's boundary, above.)
test("reviewed bundle adversarial edits: missing attestations and invalid links are refused and rolled back", async () => {
  const { db } = await reviewedRelease(duplicate, ["matchedToEntity", "confirmedNew"]);
  const { sql } = await buildPromotionBundle(db);
  const lines = sql.split("\n");
  const attestation = (decision: string) => lines.find((l) => l.startsWith("INSERT INTO promotion_review_match_attestations ") && l.includes(`'${decision}'`))!;
  const recordOf = (line: string) => Number(/VALUES \((\d+),/.exec(line)![1]);
  const linkOf = (recordId: number) => lines.find((l) => l.startsWith("INSERT INTO source_record_entities ") && l.includes(`VALUES (${recordId}, `))!;
  const matched = attestation("matchedToEntity");
  const confirmed = attestation("confirmedNew");
  const entity = Number(/'matchedToEntity', (\d+),/.exec(matched)![1]);
  const other = (db.raw.prepare("SELECT source_entity_id FROM source_entities WHERE source_entity_id <> ? ORDER BY 1 DESC LIMIT 1").get(entity) as any).source_entity_id;
  const manualLink = linkOf(recordOf(matched));
  const newLink = linkOf(recordOf(confirmed));
  const cases: [string, string, string, RegExp][] = [
    ["matchedToEntity attestation missing", `${matched}\n`, "", /source_record_entities: a manual decision requires a review_match_application/],
    ["confirmedNew attestation missing", `${confirmed}\n`, "", /promotion_bootstrap_completions: the database does not hold exactly the declared, complete release/],
    ["attested entity outside the candidates", matched, matched.replace(`'matchedToEntity', ${entity},`, `'matchedToEntity', ${other},`),
      /promotion_review_match_attestations: not a reviewed decision/],
    ["manual link to another entity than attested", manualLink, manualLink.replace(`, ${entity}, 'manual'`, `, ${other}, 'manual'`),
      /a manual decision requires a review_match_application|does not follow its promoted review attestation/],
    ["confirmedNew record written as a manual link", newLink, newLink.replace(/, 'new', /, ", 'manual', "),
      /a manual decision requires a review_match_application|does not follow its promoted review attestation/],
  ];
  for (const [name, from, to, error] of cases) {
    const tampered = sql.replace(from, to);
    assert.notEqual(tampered, sql, `${name}: fixture edit applies`);
    const target = migratedSqlite();
    assert.throws(() => applyPromotionBundle(target, tampered), error, name);
    for (const t of ["promotion_bootstraps", "sources", "source_records", "promotion_review_match_attestations", "source_record_entities", "spots", "tile_snapshot_spots"]) {
      assert.equal((target.prepare(`SELECT count(*) n FROM ${t}`).get() as any).n, 0, `${name}: ${t} rolled back`);
    }
  }
});

test("completion seals a reviewed target's attestations and match keys against UPDATE and DELETE", async () => {
  const { db } = await reviewedRelease(duplicate, ["matchedToEntity", "confirmedNew"]);
  const target = migratedSqlite();
  applyPromotionBundle(target, (await buildPromotionBundle(db)).sql);
  const count = (t: string) => (target.prepare(`SELECT count(*) n FROM ${t}`).get() as any).n;
  assert.equal(count("promotion_review_match_attestations"), 2);
  assert.ok(count("source_record_match_keys") > 0, "fixture: a cross-release release carries match keys");
  for (const [table, set] of [["promotion_review_match_attestations", "decided_by = 'someone else'"], ["source_record_match_keys", "match_key = 'x'"]]) {
    assert.throws(() => target.exec(`UPDATE ${table} SET ${set}`), /immutable/, `${table} UPDATE`);
    assert.throws(() => target.exec(`DELETE FROM ${table}`), /immutable/, `${table} DELETE`);
    assert.throws(() => target.exec(`INSERT INTO ${table} SELECT * FROM ${table} LIMIT 1`),
      /promotion bootstrap is complete|not a reviewed decision|UNIQUE|PRIMARY KEY/, `${table} INSERT`);
  }
  assert.equal(count("promotion_review_match_attestations"), 2);
});
