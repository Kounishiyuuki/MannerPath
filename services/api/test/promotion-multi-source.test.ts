// promotion-bundle.v3 (migration 0018): several reviewed sources' current releases in one all-or-nothing
// bootstrap. Taito and Osaka are the two real reviewed sources; every refusal here must leave the target empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, OSAKA_SOURCE_ID } from "../src/pipeline/osaka-adapter.ts";
import { MULTI_SOURCE_PROMOTION_BUNDLE_VERSION, PromotionError, buildMultiSourcePromotionBundle, buildPromotionBundle,
  verifyPromotionBundle } from "../src/pipeline/promotion.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { recordReviewDecision } from "../src/pipeline/review-queue.ts";
import { type SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { rehashed } from "./support/promotion-tamper.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite } from "./support/sqlite-d1.ts";

const OSAKA_BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/osaka-designated-smoking-areas/opendata_1012.csv", import.meta.url)));
type Row = Record<string, any>;
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
const CARRIED = ["promotion_multi_bootstraps", "promotion_multi_bootstrap_sources", "sources", "source_releases", "source_records",
  "source_entities", "promotion_review_match_attestations", "source_record_entities", "spots", "spot_field_provenance", "tile_snapshot_spots"];

async function importOsaka(db: SqliteD1): Promise<number> {
  await ensureReviewedSource(db, OSAKA_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, OSAKA_ADAPTER, OSAKA_BYTES, OSAKA_FIXTURE_RELEASE);
  assert.equal((await resolveFirstRelease(db, OSAKA_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("2") })).status, "resolved");
  return releaseId;
}

async function mixed(): Promise<SqliteD1> {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds("0") });
  await importOsaka(db);
  await publishTiles(db, { now: NOW });
  return db;
}

async function osakaOnly(): Promise<SqliteD1> {
  const db = new SqliteD1();
  await importOsaka(db);
  await publishTiles(db, { now: NOW });
  return db;
}

// Taito with a reviewed second release (a TEST-ONLY open adapter, as in promotion-reviewed-bootstrap.test.ts),
// plus Osaka: reviewed decisions and a second source in one bundle.
const TEST_TAITO: SourceAdapter = { ...TAITO_ADAPTER, assertResolvable: () => {}, attenuate: () => [], crossReleaseValidated: true };
const LINES = new TextDecoder().decode(TAITO_BYTES).split("\r\n");
const noRef = LINES[1].replace(/^[^,]*/, "");
const DUPLICATE = new TextEncoder().encode([LINES[0], noRef, noRef, ...LINES.slice(2)].join("\r\n"));
const LATER = "2026-09-26T03:00:00Z";

async function reviewedMixed() {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId: firstId } = await ingestRelease(db, TEST_TAITO, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await resolveFirstRelease(db, TEST_TAITO, firstId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  const prior = db.raw.prepare(`SELECT source_entity_id FROM source_record_entities WHERE record_id =
    (SELECT record_id FROM source_records WHERE release_id = ? AND ordinal = 1)`).get(firstId) as { source_entity_id: number };
  const { releaseId: secondId } = await ingestRelease(db, TEST_TAITO, DUPLICATE,
    { ...TAITO_FIXTURE_RELEASE, observedOn: "2026-09-18", fetchedAt: "2026-09-25T00:00:00Z" });
  const pending = await resolveFirstRelease(db, TEST_TAITO, secondId, { now: LATER, newSpotId: sequentialSpotIds("B") });
  assert.equal(pending.status, "needsReview");
  const items = pending.status === "needsReview" ? pending.reviewItemIds : [];
  const decisions = ["matchedToEntity", "confirmedNew"] as const;
  for (let i = 0; i < items.length; i++) {
    await recordReviewDecision(db, { reviewItemId: items[i], decision: decisions[i], decidedBy: "test-reviewer", decidedAt: LATER,
      sourceEntityId: decisions[i] === "matchedToEntity" ? prior.source_entity_id : undefined });
  }
  assert.equal((await resolveFirstRelease(db, TEST_TAITO, secondId, { now: LATER, newSpotId: sequentialSpotIds("B") })).status, "resolved");
  const osakaId = await importOsaka(db);
  await publishTiles(db, { now: LATER });
  return { db, secondId, osakaId };
}

const refuses = async (db: SqliteD1, pattern: RegExp, options = {}) =>
  await assert.rejects(() => buildMultiSourcePromotionBundle(db, options), (e: Error) => {
    assert.equal(e instanceof PromotionError, true, `expected a PromotionError, got ${e.message}`);
    assert.match(e.message, pattern);
    return true;
  });

/** Applies a tampered bundle to a fresh target and asserts the whole file was rolled back. */
function rejectedAndEmpty(sql: string, error: RegExp, name: string): void {
  const target = migratedSqlite();
  assert.throws(() => applyPromotionBundle(target, sql), error, name);
  for (const t of [...CARRIED, "promotion_multi_bootstrap_completions"]) assert.equal(count(target, t), 0, `${name}: ${t} rolled back`);
}

const lineOf = (sql: string, prefix: string, includes: string) =>
  sql.split("\n").find((l) => l.startsWith(prefix) && l.includes(includes)) ?? assert.fail(`no line ${prefix} … ${includes}`);

test("Taito only: v2 is unchanged and still refuses a database whose tiles span two sources", async () => {
  const taito = new SqliteD1();
  await importTaito(taito, { newSpotId: sequentialSpotIds("0") });
  await publishTiles(taito, { now: NOW });
  const v2 = await buildPromotionBundle(taito);
  assert.equal(v2.manifest.generator, "promotion-bundle.v2");
  assert.match(v2.sql, /^INSERT INTO promotion_bootstraps /m);
  assert.equal(v2.sql.includes("promotion_multi_"), false, "a v2 bundle writes no v3 table");
  const target = migratedSqlite();
  applyPromotionBundle(target, v2.sql);
  assert.equal(count(target, "promotion_bootstrap_completions"), 1);
  assert.equal(count(target, "promotion_multi_bootstraps"), 0);

  // v2 carries one release; on a two-source database it refuses rather than promoting one source partially.
  const both = await mixed();
  await assert.rejects(buildPromotionBundle(both, { releaseId: 1 }), /draw existence evidence from another release/);
});

test("Osaka only: v2 and v3 both bootstrap it, and v3 re-exports byte-identically", async () => {
  const db = await osakaOnly();
  const v2 = await buildPromotionBundle(db);
  applyPromotionBundle(migratedSqlite(), v2.sql);
  const v3 = await buildMultiSourcePromotionBundle(db);
  assert.deepEqual(v3.manifest.sources.map((s) => [s.sourceId, s.rows.spot_source_entities]), [[OSAKA_SOURCE_ID, 344]]);
  const target = new SqliteD1(migratedSqlite());
  applyPromotionBundle(target.raw, v3.sql);
  assert.equal(count(target.raw, "tile_snapshot_spots"), 344);
  assert.equal((await buildMultiSourcePromotionBundle(target)).sql, v3.sql);
});

test("Taito + Osaka: one v3 bundle declares both sources, applies, and re-exports deterministically", async () => {
  const db = await mixed();
  const bundle = await buildMultiSourcePromotionBundle(db);
  const { manifest, sql } = bundle;
  assert.equal(manifest.generator, MULTI_SOURCE_PROMOTION_BUNDLE_VERSION);
  assert.deepEqual(manifest.sources.map((s) => s.sourceId), [OSAKA_SOURCE_ID, TAITO_SOURCE_ID].sort());
  const bySource = Object.fromEntries(manifest.sources.map((s) => [s.sourceId, s]));
  assert.deepEqual([bySource[TAITO_SOURCE_ID].rows.spot_source_entities, bySource[OSAKA_SOURCE_ID].rows.spot_source_entities], [32, 344]);
  assert.deepEqual([bySource[TAITO_SOURCE_ID].rows.source_records, bySource[OSAKA_SOURCE_ID].rows.source_records], [34, 524]);
  for (const key of Object.keys(bySource[TAITO_SOURCE_ID].rows)) {
    assert.equal(manifest.sources.reduce((n, s) => n + s.rows[key], 0), manifest.rows[key], `${key}: per-source counts add up`);
  }
  for (const s of manifest.sources) {
    assert.ok(s.attributionText.length > 0 && s.licenseName !== null, `${s.sourceId}: license/attribution identity is declared`);
    assert.match(s.releaseContentSha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(manifest.rows.tile_snapshot_spots, 376);

  // Deterministic: same bytes on a rerun, for the releases named in any order, and from a second origin database.
  assert.equal((await buildMultiSourcePromotionBundle(db)).sql, sql);
  assert.equal((await buildMultiSourcePromotionBundle(db, { releaseIds: manifest.sources.map((s) => s.releaseId).reverse() })).sql, sql);
  assert.equal((await buildMultiSourcePromotionBundle(await mixed())).sql, sql);
  assert.equal(await verifyPromotionBundle(sql, manifest.contentSha256), manifest.contentSha256);

  const target = new SqliteD1(migratedSqlite());
  applyPromotionBundle(target.raw, sql);
  const tiles = (d: DatabaseSync) => d.prepare("SELECT tile_id, revision, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id").all();
  assert.deepEqual(tiles(target.raw), tiles(db.raw), "the published bytes, so ETags are unchanged");
  assert.equal(count(target.raw, "promotion_multi_bootstrap_completions"), 1);
  assert.equal(count(target.raw, "promotion_bootstraps"), 0);
  assert.equal((await buildMultiSourcePromotionBundle(target)).sql, sql, "re-export from the target is byte-identical");
});

test("the exporter refuses the whole bundle when one source fails or is left out", async () => {
  const db = await mixed();
  const taitoRelease = (db.raw.prepare("SELECT release_id FROM source_releases WHERE source_id = ?").get(TAITO_SOURCE_ID) as Row).release_id;
  // One source missing: Osaka's published spots would have no evidence in the bundle.
  await refuses(db, /draw existence evidence from another release/, { releaseIds: [taitoRelease] });
  await refuses(db, /release 99 does not exist/, { releaseIds: [taitoRelease, 99] });
  await refuses(db, /named twice/, { releaseIds: [taitoRelease, taitoRelease] });

  // Publication blocked, or a license/attribution identity that drifted from the registry, for either source.
  for (const [sourceId, set, error] of [
    [OSAKA_SOURCE_ID, "publication_status = 'blocked'", /is blocked; only an approved source may be promoted/],
    [TAITO_SOURCE_ID, "attribution_text = 'drifted'", /attribution_text does not match the reviewed registry entry/],
    [OSAKA_SOURCE_ID, "license_url = 'https://example.invalid/'", /license_url does not match the reviewed registry entry/],
  ] as const) {
    const drifted = await mixed();
    drifted.raw.prepare(`UPDATE sources SET ${set} WHERE source_id = ?`).run(sourceId);
    await refuses(drifted, error);
  }

  // Cross-source evidence in the origin: a Taito spot's provenance pointing at an Osaka record.
  const crossed = await mixed();
  const osakaRecord = (crossed.raw.prepare(`SELECT record_id FROM source_records r JOIN source_releases s USING (release_id)
    WHERE s.source_id = ? ORDER BY record_id LIMIT 1`).get(OSAKA_SOURCE_ID) as Row).record_id;
  const taitoSpot = (crossed.raw.prepare(`SELECT l.spot_id FROM spot_source_entities l JOIN source_entities e USING (source_entity_id)
    JOIN tile_snapshot_spots t ON t.spot_id = l.spot_id WHERE e.source_id = ? ORDER BY l.spot_id LIMIT 1`).get(TAITO_SOURCE_ID) as Row).spot_id;
  crossed.raw.prepare("UPDATE spot_field_provenance SET record_id = ? WHERE spot_id = ? AND field = 'name'").run(osakaRecord, taitoSpot);
  await refuses(crossed, /crosses a source boundary/);
});

test("source 1 (Taito) tamper: a fingerprint or row mismatch aborts the whole bundle", async () => {
  const { sql } = await buildMultiSourcePromotionBundle(await mixed());
  const release = lineOf(sql, "INSERT INTO source_releases ", `'${TAITO_SOURCE_ID}'`);
  const hash = /'([0-9a-f]{64})'/.exec(release)![1];
  const cases: [string, string, RegExp][] = [
    ["declared fingerprint", await rehashed(sql, (b) => b.replace(lineOf(b, "INSERT INTO promotion_multi_bootstrap_sources ", `'${TAITO_SOURCE_ID}'`),
      (l) => l.replace(hash, "e".repeat(64)))), /only a declared release with its declared fingerprint/],
    ["release fingerprint", await rehashed(sql, (b) => b.replace(release, release.replace(hash, "e".repeat(64)))), /only a declared release with its declared fingerprint/],
    ["missing record", await rehashed(sql, (b) => {
      const link = lineOf(b, "INSERT INTO source_record_entities ", "'new'");
      // Dropping a record's decision keeps every foreign key intact; only the declared counts notice.
      return b.replace(`${link}\n`, "");
    }), /promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources/],
  ];
  for (const [name, tampered, error] of cases) {
    assert.notEqual(tampered, sql, `${name}: fixture edit applies`);
    rejectedAndEmpty(tampered, error, `Taito ${name}`);
  }
});

test("source 2 (Osaka) tamper: per-source counts, publication and attribution are re-checked on the target", async () => {
  const { sql } = await buildMultiSourcePromotionBundle(await mixed());
  const osakaSource = lineOf(sql, "INSERT INTO sources ", `'${OSAKA_SOURCE_ID}'`);
  const osakaDeclaration = lineOf(sql, "INSERT INTO promotion_multi_bootstrap_sources ", `'${OSAKA_SOURCE_ID}'`);
  const osakaProvenance = sql.split("\n").filter((l) => l.startsWith("INSERT INTO spot_field_provenance ") && l.includes("'sp_2") && !l.includes("'existence'"))[0];
  const provenanceTotal = Number(/"spot_field_provenance":(\d+)/.exec(sql)![1]);
  const cases: [string, string, RegExp][] = [
    ["publication blocked", await rehashed(sql, (b) => b.replace(osakaSource, osakaSource.replace("'approved'", "'blocked'"))),
      /only a declared, approved source with its declared identity/],
    ["display name and attribution changed", await rehashed(sql, (b) => b.replace(osakaSource, osakaSource.replaceAll("大阪市", "某市"))),
      /only a declared, approved source with its declared identity/],
    // The bundle-wide count is edited to match, so only the per-source declaration can notice the missing row.
    ["provenance row missing, bundle-wide count rewritten", await rehashed(sql, (b) => b.replace(`${osakaProvenance}\n`, "")
      .replace(`"spot_field_provenance":${provenanceTotal},`, `"spot_field_provenance":${provenanceTotal - 1},`)),
      /promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources/],
    ["declaration count shifted between sources", await rehashed(sql, (b) => b.replace(osakaDeclaration,
      osakaDeclaration.replace(/"spot_source_entities":(\d+)/, (_, n) => `"spot_source_entities":${Number(n) - 1}`))),
      /promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources/],
  ];
  assert.ok(osakaSource.includes("大阪市"), "fixture: Osaka attribution names the publisher");
  for (const [name, tampered, error] of cases) {
    assert.notEqual(tampered, sql, `${name}: fixture edit applies`);
    rejectedAndEmpty(tampered, error, `Osaka ${name}`);
  }
});

test("one source missing: an undeclared or absent source aborts the bundle", async () => {
  const both = await buildMultiSourcePromotionBundle(await mixed());
  const osakaDeclaration = lineOf(both.sql, "INSERT INTO promotion_multi_bootstrap_sources ", `'${OSAKA_SOURCE_ID}'`);
  // Declaration removed, source_count kept: the data cannot start before every source is declared.
  rejectedAndEmpty(await rehashed(both.sql, (b) => b.replace(`${osakaDeclaration}\n`, "")),
    /only a declared, approved source with its declared identity/, "declaration missing");

  // A Taito-only v3 bundle that declares a second source it does not carry.
  const taito = new SqliteD1();
  await importTaito(taito, { newSpotId: sequentialSpotIds("0") });
  await publishTiles(taito, { now: NOW });
  const single = await buildMultiSourcePromotionBundle(taito);
  const declaration = lineOf(single.sql, "INSERT INTO promotion_multi_bootstrap_sources ", `'${TAITO_SOURCE_ID}'`);
  rejectedAndEmpty(await rehashed(single.sql, (b) => b
    .replace("'promotion-bundle.v3', 1,", "'promotion-bundle.v3', 2,")
    .replace(declaration, `${declaration}\n${osakaDeclaration}`)),
  /promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources/, "source declared, data absent");
});

test("cross-source record/entity and evidence references are refused on the target", async () => {
  const db = await mixed();
  const { sql } = await buildMultiSourcePromotionBundle(db);
  const osakaEntity = (db.raw.prepare("SELECT source_entity_id FROM source_entities WHERE source_id = ? ORDER BY 1 DESC LIMIT 1").get(OSAKA_SOURCE_ID) as Row).source_entity_id;
  const osakaRecord = (db.raw.prepare(`SELECT record_id FROM source_records JOIN source_releases USING (release_id) WHERE source_id = ?
    ORDER BY record_id LIMIT 1`).get(OSAKA_SOURCE_ID) as Row).record_id;
  const taitoLink = lineOf(sql, "INSERT INTO source_record_entities ", "'new'");
  const taitoProvenance = lineOf(sql, "INSERT INTO spot_field_provenance ", "'sp_0");
  const taitoSpotLink = lineOf(sql, "INSERT INTO spot_source_entities ", "'sp_0");
  const cases: [string, string, string, RegExp][] = [
    ["Taito record decided to an Osaka entity", taitoLink, taitoLink.replace(/^(.*VALUES \(\d+, \d+, )\d+,/, `$1${osakaEntity},`),
      /record and entity belong to different sources|UNIQUE constraint failed/],
    ["Taito spot evidence from an Osaka record", taitoProvenance, taitoProvenance.replace(/'(existence|location|name|[a-zA-Z]+)', \d+,/, (_m, f) => `'${f}', ${osakaRecord},`),
      /spot_field_provenance: evidence crosses a source boundary/],
    ["Taito spot linked to an Osaka entity", taitoSpotLink, taitoSpotLink.replace(/VALUES \(\d+,/, `VALUES (${osakaEntity},`),
      /UNIQUE constraint failed|PRIMARY KEY|crosses a source boundary|does not hold exactly/],
  ];
  for (const [name, from, to, error] of cases) {
    assert.notEqual(to, from, `${name}: fixture edit applies`);
    rejectedAndEmpty(await rehashed(sql, (b) => b.replace(from, to)), error, name);
  }
});

test("reviewed decisions: attestations travel per source, and a tampered or cross-source attestation is refused", async () => {
  const { db, secondId, osakaId } = await reviewedMixed();
  const { sql, manifest } = await buildMultiSourcePromotionBundle(db);
  const taito = manifest.sources.find((s) => s.sourceId === TAITO_SOURCE_ID)!;
  const osaka = manifest.sources.find((s) => s.sourceId === OSAKA_SOURCE_ID)!;
  assert.deepEqual([taito.releaseId, osaka.releaseId], [secondId, osakaId]);
  assert.equal(taito.rows.promotion_review_match_attestations, 2);
  assert.deepEqual(taito.reviewDependencies.map((d) => d.previousReleaseId), [1, 1]);
  assert.equal(osaka.rows.promotion_review_match_attestations, 0);

  const target = new SqliteD1(migratedSqlite());
  applyPromotionBundle(target.raw, sql);
  assert.deepEqual(target.raw.prepare("SELECT decision, source_entity_id FROM promotion_review_match_attestations ORDER BY record_id").all(),
    db.raw.prepare("SELECT decision, source_entity_id FROM review_match_applications ORDER BY record_id").all());
  assert.equal(count(target.raw, "review_items"), 0, "the runtime review chain never travels");
  assert.equal((await buildMultiSourcePromotionBundle(target)).sql, sql, "re-export preserves the reviewed bytes");

  const matched = lineOf(sql, "INSERT INTO promotion_review_match_attestations ", "'matchedToEntity'");
  const confirmed = lineOf(sql, "INSERT INTO promotion_review_match_attestations ", "'confirmedNew'");
  const entity = Number(/'matchedToEntity', (\d+),/.exec(matched)![1]);
  const osakaEntity = (db.raw.prepare("SELECT source_entity_id FROM source_entities WHERE source_id = ? LIMIT 1").get(OSAKA_SOURCE_ID) as Row).source_entity_id;
  const previousHash = (db.raw.prepare("SELECT content_sha256 FROM source_releases WHERE release_id = 1").get() as Row).content_sha256;
  const cases: [string, (b: string) => string, RegExp][] = [
    // The chosen entity and the candidate list both moved to Osaka's entity: still refused, by source.
    ["attested entity of the other source", (b) => b.replace(matched, matched.replace(`'matchedToEntity', ${entity},`, `'matchedToEntity', ${osakaEntity},`)
      .replace(/'\[[\d,]+\]'/, `'[${osakaEntity}]'`)), /promotion_review_match_attestations: not a reviewed decision/],
    ["previous-release fingerprint", (b) => b.replace(matched, matched.replace(`'${previousHash}'`, `'${"f".repeat(64)}'`)),
      /promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources/],
    ["confirmedNew attestation missing", (b) => b.replace(`${confirmed}\n`, ""),
      /promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources/],
    ["matchedToEntity attestation missing", (b) => b.replace(`${matched}\n`, ""),
      /source_record_entities: a manual decision requires a review_match_application/],
  ];
  for (const [name, edit, error] of cases) {
    const tampered = await rehashed(sql, edit);
    assert.notEqual(tampered, sql, `${name}: fixture edit applies`);
    rejectedAndEmpty(tampered, error, name);
  }
});

test("the external reviewed hash stays the only authenticity check, for v3 as for v2", async () => {
  const { sql, manifest } = await buildMultiSourcePromotionBundle(await mixed());
  const osakaSource = lineOf(sql, "INSERT INTO sources ", `'${OSAKA_SOURCE_ID}'`);
  // A consistent edit: the attribution of Osaka's source AND its declaration rewritten together, header rehashed.
  const tampered = await rehashed(sql, (b) => b.replaceAll("大阪市", "某市"));
  assert.notEqual(tampered, sql);
  assert.ok(osakaSource.includes("大阪市"));
  const selfHash = /^-- contentSha256: ([0-9a-f]{64})$/m.exec(tampered)![1];
  assert.equal(await verifyPromotionBundle(tampered, selfHash), selfHash, "the file agrees with itself");
  await assert.rejects(verifyPromotionBundle(tampered, manifest.contentSha256), /the reviewed record says /);
  await assert.rejects(verifyPromotionBundle(sql, "f".repeat(64)), /the reviewed record says /);
  // Two body starts (a v2 body appended after a v3 one) are never accepted.
  const v2Start = "\n-- promotion_bootstraps: refused unless the target is empty\n";
  await assert.rejects(verifyPromotionBundle(`${sql}${v2Start}`, manifest.contentSha256), /no single bundle body start/);
  await assert.rejects(verifyPromotionBundle(`INSERT INTO report_rate_windows VALUES ('${"a".repeat(64)}', 'hour', 'x', 1, 'y');\n${sql}`,
    manifest.contentSha256), /unhashed header contains executable content/);
});

test("v3 completion seals promoted state; runtime report, App Attest and source-refresh tables stay writable", async () => {
  const target = migratedSqlite();
  applyPromotionBundle(target, (await buildMultiSourcePromotionBundle(await mixed())).sql);
  const SEALED = /promotion bootstrap is complete; promoted state is immutable/;
  for (const table of ["sources", "source_releases", "source_records", "source_record_match_keys", "source_entities", "source_record_entities",
    "spots", "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots", "source_observations"]) {
    for (const op of ["insert", "update", "delete"]) {
      const trigger = target.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get(`promotion_multi_complete_seals_${table}_${op}`) as { sql: string } | undefined;
      assert.ok(trigger?.sql.includes(`BEFORE ${op.toUpperCase()} ON ${table}`), `${table} ${op} seal missing`);
    }
    const columns = (target.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    assert.throws(() => target.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "1").join(", ")})`).run(), SEALED, `${table} INSERT`);
    if (count(target, table) > 0) {
      assert.throws(() => target.prepare(`UPDATE ${table} SET ${columns[0]} = ${columns[0]}`).run(), SEALED, `${table} UPDATE`);
      assert.throws(() => target.prepare(`DELETE FROM ${table}`).run(), SEALED, `${table} DELETE`);
    }
  }
  for (const table of ["promotion_multi_bootstraps", "promotion_multi_bootstrap_sources", "promotion_multi_bootstrap_completions"]) {
    assert.throws(() => target.exec(`DELETE FROM ${table}`), /immutable/, table);
  }
  assert.throws(() => target.exec("INSERT INTO promotion_multi_bootstrap_sources SELECT * FROM promotion_multi_bootstrap_sources LIMIT 1"),
    /declarations precede the data|UNIQUE|PRIMARY KEY/);

  // Runtime tables: a report and an App Attest challenge, and a source check with its retained artifact (0017).
  target.prepare(`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status, received_at, minimize_after)
    VALUES (?, 1, 'exists', ?, 'notProvided', '2026-09-01T00:00:00Z', '2026-11-30T00:00:00Z')`).run(`rp_${"0".repeat(26)}`, `sp_${"0".repeat(26)}`);
  target.prepare("INSERT INTO app_attest_challenges (challenge, purpose, issued_at, expires_at) VALUES (?, 'registration', '2026-09-01T00:00:00Z', '2026-09-01T00:05:00Z')")
    .run(`${"B".repeat(43)}=`);
  const artifact = "c".repeat(64);
  target.prepare("INSERT INTO raw_artifacts VALUES (?, ?, 1, '2026-10-01T00:00:00Z')").run(artifact, `raw/sha256/${artifact}`);
  target.prepare(`INSERT INTO source_checks (check_key, source_id, trigger_kind, policy_version, request_url, started_at, finished_at,
    content_sha256, byte_length, artifact_sha256, outcome) VALUES ('run:1', ?, 'manual', 'p1', 'https://example.invalid/', 'a', 'b', ?, 1, ?, 'changed')`)
    .run(OSAKA_SOURCE_ID, artifact, artifact);
  for (const t of ["reports", "app_attest_challenges", "raw_artifacts", "source_checks"]) assert.equal(count(target, t), 1, t);
});

test("while a v3 bootstrap is open, pipeline, review and source-check writes are refused", () => {
  const target = migratedSqlite();
  target.exec(`INSERT INTO promotion_multi_bootstraps VALUES (1, 'promotion-bundle.v3', 1, '{}')`);
  const artifact = "d".repeat(64);
  for (const statement of [
    `INSERT INTO raw_artifacts VALUES ('${artifact}', 'raw/sha256/${artifact}', 1, 'x')`,
    `INSERT INTO sources (source_id, display_name, kind, publication_status, created_at, updated_at) VALUES ('${TAITO_SOURCE_ID}', 'x', 'municipal', 'approved', 'x', 'x')`,
    "INSERT INTO promotion_bootstraps VALUES (1, 'promotion-bundle.v2', 'x', 1, '" + "a".repeat(64) + "', '[]', '{}')",
  ]) {
    assert.throws(() => target.exec(statement), /promotion v3 bootstrap is open|bootstraps only an empty/, statement.slice(0, 40));
  }
});

// D1 caps SQLite's expression tree depth at 100; node:sqlite keeps the default 1000, so the tests above cannot see
// a trigger that D1 refuses to compile. Wrangler's local D1 (a pinned devDependency) enforces the same cap, so the
// real migrations and each bundle run there, the same commands an operator runs, in a throwaway --persist-to
// directory: the repository's own .wrangler state and every remote database stay untouched.
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

function wrangler(dir: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [WRANGLER, "d1", ...args, "DB", "--local", "--config", join(dir, "wrangler.json"),
    "--persist-to", join(dir, "state")], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(dir, "logs") } });
  if (run.error) throw new Error(`wrangler d1 ${args[0]} could not start: ${run.error.message}`);
  return { ok: run.status === 0, out: `${run.stdout}${run.stderr}`, stdout: run.stdout };
}

/** A fresh local D1 with migrations 0001..latest; `fn` gets its directory, which is removed afterwards. */
function withLocalD1<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mannerpath-d1-depth-"));
  try {
    cpSync(fileURLToPath(new URL("../migrations/", import.meta.url)), join(dir, "migrations"), { recursive: true });
    writeFileSync(join(dir, "wrangler.json"), JSON.stringify({ name: "d1-depth-probe", compatibility_date: "2026-09-01",
      d1_databases: [{ binding: "DB", database_name: "probe", database_id: "00000000-0000-0000-0000-000000000000", migrations_dir: "migrations" }] }));
    const migrated = wrangler(dir, "migrations", "apply");
    assert.equal(migrated.ok, true, migrated.out.slice(-500));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function localCounts(dir: string, tables: string[]): Row {
  const run = wrangler(dir, "execute", "--json", "--command", `SELECT ${tables.map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`).join(", ")}`);
  assert.equal(run.ok, true, run.out.slice(-500));
  // stdout only: Wrangler may log to stderr after the JSON (e.g. behind a proxy), which is not part of the result.
  return JSON.parse(run.stdout.slice(run.stdout.indexOf("[")))[0].results[0];
}

function applyLocally(dir: string, bundle: string) {
  writeFileSync(join(dir, "bundle.sql"), bundle);
  return wrangler(dir, "execute", "--file", join(dir, "bundle.sql"));
}

test("D1 expression depth: v2 and v3 bundles apply, and a tampered v3 is refused by its check, on Wrangler's local D1", async () => {
  const taito = new SqliteD1();
  await importTaito(taito, { newSpotId: sequentialSpotIds("0") });
  await publishTiles(taito, { now: NOW });
  const { db: reviewed } = await reviewedMixed();
  const { sql } = await buildMultiSourcePromotionBundle(await mixed());
  const tampered = await rehashed(sql, (b) => b.replace(/("tile_snapshot_spots":)(\d+)/, (_, k, n) => `${k}${Number(n) + 1}`));
  assert.notEqual(tampered, sql);
  const COMPLETIONS = ["promotion_multi_bootstrap_completions", "promotion_bootstrap_completions"];

  withLocalD1((dir) => {
    // Without the cap this whole test would pass vacuously, so first show the engine enforces it.
    const deep = wrangler(dir, "execute", "--command", `SELECT 1${" + 1".repeat(101)}`);
    assert.equal(deep.ok, false);
    assert.match(deep.out, /Expression tree is too large \(maximum depth 100\)/);
  });
  for (const [name, bundle] of [
    ["v2 Taito", (await buildPromotionBundle(taito)).sql],
    ["v3 Taito + Osaka", sql],
    ["v3 reviewed Taito + Osaka", (await buildMultiSourcePromotionBundle(reviewed)).sql],
  ]) {
    withLocalD1((dir) => {
      const run = applyLocally(dir, bundle);
      assert.doesNotMatch(run.out, /Expression tree is too large/, name);
      assert.equal(run.ok, true, `${name}: ${run.out.slice(-500)}`);
      const n = localCounts(dir, COMPLETIONS);
      assert.equal(n.promotion_multi_bootstrap_completions + n.promotion_bootstrap_completions, 1, name);
    });
  }
  withLocalD1((dir) => {
    const run = applyLocally(dir, tampered);
    assert.equal(run.ok, false);
    assert.match(run.out, /promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources/);
    const left = localCounts(dir, [...CARRIED, ...COMPLETIONS]);
    for (const t of [...CARRIED, ...COMPLETIONS]) assert.equal(left[t], 0, `${t} rolled back`);
  });
});
