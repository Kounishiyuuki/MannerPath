// Promotion bundle: determinism, completeness for the selected release, and the refusals
// (docs/OPERATIONS.md, src/pipeline/promotion.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PROMOTION_BUNDLE_VERSION, PromotionError, buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TEST_BLOCKED_SOURCE, addBlockedTestSource, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, migratedSqlite } from "./support/sqlite-d1.ts";

async function publishedDb(): Promise<SqliteD1> {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return db;
}

const rejects = async (db: SqliteD1, pattern: RegExp, options = {}) =>
  await assert.rejects(() => buildPromotionBundle(db, options), (e: Error) => {
    assert.equal(e instanceof PromotionError, true, `expected a PromotionError, got ${e.message}`);
    assert.match(e.message, pattern);
    return true;
  });

test("the bundle carries the whole evidence-to-publication chain for the current release", async () => {
  const { sql, manifest } = await buildPromotionBundle(await publishedDb());

  assert.equal(manifest.generator, PROMOTION_BUNDLE_VERSION);
  assert.equal(manifest.sourceId, TAITO_SOURCE_ID);
  assert.equal(manifest.releaseId, 1);
  assert.equal(manifest.tiles.length, 5);
  assert.equal(manifest.tiles.reduce((n, t) => n + t.spotCount, 0), 34);
  assert.deepEqual(manifest.rows, {
    sources: 1,
    source_releases: 1,
    source_records: 34,
    // The first-release resolver records no match keys: there is no previous release to match
    // against. The table is carried anyway, so a later release's matcher decisions travel too.
    source_record_match_keys: 0,
    source_entities: 34,
    source_record_entities: 34,
    spots: 34,
    spot_source_entities: 34,
    spot_field_provenance: manifest.rows.spot_field_provenance,
    tile_snapshots: 5,
    tile_snapshot_spots: 34,
  });
  assert.equal(manifest.rows.spot_field_provenance > 34, true, "every spot has at least existence provenance");

  // Foreign-key-safe order: a parent table's inserts precede every child that references it.
  const order = ["sources", "source_releases", "source_records", "source_record_match_keys",
    "source_entities", "source_record_entities", "spots", "spot_source_entities",
    "spot_field_provenance", "tile_snapshots", "tile_snapshot_spots"];
  // source_record_match_keys is empty on a first release, so it contributes no statement block.
  const nonEmpty = order.filter((t) => manifest.rows[t] > 0);
  assert.equal(nonEmpty.length, order.length - 1);
  const positions = nonEmpty.map((t) => sql.indexOf(`INSERT INTO ${t} (`));
  assert.equal(positions.every((p) => p > 0), true, "every non-empty table is present");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "tables are emitted in dependency order");

  // The artifact is the thing a human applies, so it says so, and identifies itself by hash.
  assert.match(sql, /^-- MannerPath promotion bundle\./);
  // The apply instruction names the target database rather than an --env binding, which during a
  // blue/green promotion would resolve to the live database (docs/OPERATIONS.md step 6).
  assert.match(sql, /wrangler d1 execute <new-database-name> --remote --file <this file>/);
  assert.equal(sql.includes("--env <environment>"), false);
  assert.equal(sql.includes(`-- contentSha256: ${manifest.contentSha256}`), true);
  const body = sql.slice(sql.indexOf("-- sources ("));
  assert.equal(createHash("sha256").update(body).digest("hex"), manifest.contentSha256);
});

test("the bundle is byte-identical across runs and carries no report data", async () => {
  const db = await publishedDb();
  const first = await buildPromotionBundle(db);
  const second = await buildPromotionBundle(db, { releaseId: 1 });
  assert.equal(first.sql, second.sql);
  assert.deepEqual(first.manifest, second.manifest);

  // A second database built the same way resolves the same spot IDs and must serialise identically.
  assert.equal((await buildPromotionBundle(await publishedDb())).sql, first.sql);

  // User-submitted content never leaves a database through this path (ADR-0007).
  for (const table of ["reports", "report_rate_counters", "report_moderation", "d1_migrations"]) {
    assert.equal(first.sql.includes(table), false, `${table} must not appear in the bundle`);
  }
  assert.equal(/pepper|submitter|install/i.test(first.sql), false);
});

test("attribution and publication state travel with the data", async () => {
  const db = await publishedDb();
  const { sql } = await buildPromotionBundle(db);
  const spot = db.raw.prepare("SELECT spot_id, tile_id FROM tile_snapshot_spots ORDER BY spot_id LIMIT 1").get() as any;
  const tile = db.raw.prepare("SELECT tile_id, revision FROM tile_snapshots ORDER BY tile_id LIMIT 1").get() as any;
  assert.equal(sql.includes("'approved'"), true);
  assert.equal(sql.includes("台東区 CC-BY表示4.0国際"), true, "the approved attribution text is carried");
  assert.equal(sql.includes("https://creativecommons.org/licenses/by/4.0/legalcode.ja"), true);
  // Opaque IDs and tile revisions are preserved verbatim, not regenerated.
  assert.equal(sql.includes(`INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES ('${spot.spot_id}', '${spot.tile_id}');`), true);
  assert.equal(sql.includes(`VALUES ('${tile.tile_id}', 14, `), true);
  assert.match(sql, new RegExp(`VALUES \\('${tile.tile_id}', 14, \\d+, \\d+, ${tile.revision}, 1, '[0-9a-f]{64}'`));
});

test("the bundle applies to a freshly migrated database and reproduces the published state", async () => {
  const source = await publishedDb();
  const { sql } = await buildPromotionBundle(source);

  // Nothing but the real migrations, then the artifact exactly as a maintainer would apply it. The
  // publication trigger re-checks every tile_snapshot_spots row here, so this also proves the
  // bundle's ordering satisfies the ADR-0006 invariant on the receiving side.
  const target = migratedSqlite();
  target.exec("PRAGMA foreign_keys = ON;");
  target.exec(sql);

  const count = (db: any, q: string) => (db.prepare(q).get() as any).n;
  for (const q of [
    "SELECT count(*) n FROM tile_snapshots",
    "SELECT count(*) n FROM tile_snapshot_spots",
    "SELECT count(*) n FROM spots",
    "SELECT count(*) n FROM spot_field_provenance",
    "SELECT count(*) n FROM sources WHERE publication_status = 'approved'",
  ]) {
    assert.equal(count(target, q), count(source.raw, q), q);
  }
  // The published bytes, not a re-derivation: same body and same hash, so the ETag is unchanged.
  const tileOf = (db: any) => db.prepare("SELECT tile_id, revision, content_sha256, body_json FROM tile_snapshots ORDER BY tile_id").all();
  assert.deepEqual(tileOf(target), tileOf(source.raw));

  // A second export from the receiving database is byte-identical to the bundle it was built from.
  assert.equal((await buildPromotionBundle(new SqliteD1(target))).sql, sql);
});

test("the bundle is a bootstrap artifact: INSERT-only, and it refuses a populated database", async () => {
  const { sql, manifest } = await buildPromotionBundle(await publishedDb());

  // INSERT-only by construction. An UPDATE, DELETE or upsert would be an in-place remote update
  // path, which this slice deliberately does not have (docs/OPERATIONS.md: blue/green promotion).
  // One statement per `);` terminator. A few source values (opening-hours text) contain newlines and
  // stay inside their quoted literal, so statements are not split on line breaks.
  const withoutComments = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
  const statements = withoutComments.split(");\n").map((s) => s.trim()).filter((s) => s !== "");
  assert.equal(statements.length, Object.values(manifest.rows).reduce((a, b) => a + b, 0), "one statement per exported row");
  assert.equal(statements.every((s) => s.startsWith("INSERT INTO ")), true, "every statement is an INSERT");
  for (const forbidden of ["UPDATE ", "DELETE ", "ON CONFLICT", "INSERT OR ", "REPLACE INTO", "BEGIN;", "COMMIT;", "PRAGMA ", "DROP "]) {
    assert.equal(sql.includes(forbidden), false, `${forbidden} must not appear`);
  }
  // The artifact says what it targets, so a maintainer reading it cannot mistake it for an update.
  assert.match(sql, /TARGET: an EMPTY, freshly migrated database/);
  assert.match(sql, /cannot update a populated one/);

  // Applying it to a database that already holds the data fails outright rather than half-updating:
  // that failure is what makes the blue/green procedure the only path for corrected data.
  const target = migratedSqlite();
  target.exec("PRAGMA foreign_keys = ON;");
  target.exec(sql);
  assert.throws(() => target.exec(sql), /UNIQUE constraint failed|constraint failed/);
});

test("an unapproved source is never exported", async () => {
  const db = new SqliteD1();
  addBlockedTestSource(db);
  await importTaito(db, { sourceId: TEST_BLOCKED_SOURCE });
  await publishTiles(db, { now: NOW });
  // Nothing was published, and the blocked source is not in the reviewed registry either.
  await rejects(db, /not a reviewed source|no tile snapshot has been published/);
});

test("a source row that drifted from the reviewed registry fails the export", async () => {
  const db = await publishedDb();
  db.raw.prepare("UPDATE sources SET attribution_text = ? WHERE source_id = ?")
    .run("台東区（改変）", TAITO_SOURCE_ID);
  await rejects(db, /attribution_text does not match the reviewed registry entry/);
});

test("a database with no applied release, or an unknown release, fails the export", async () => {
  const empty = new SqliteD1();
  await rejects(empty, /no current applied release exists/);
  await rejects(empty, /release 7 does not exist/, { releaseId: 7 });
  await rejects(empty, /release id must be a positive integer/, { releaseId: 0 });
});

test("a tile whose stored body drifted from its hash fails the export", async () => {
  const db = await publishedDb();
  const tile = db.raw.prepare("SELECT tile_id, body_json FROM tile_snapshots ORDER BY tile_id LIMIT 1").get() as any;
  const tampered = JSON.parse(tile.body_json);
  tampered.revision = 99;
  // The revision must rise for the schema's republish trigger to allow the write at all; the stored
  // content hash is deliberately left describing the old bytes.
  db.raw.prepare("UPDATE tile_snapshots SET body_json = ?, revision = revision + 1 WHERE tile_id = ?")
    .run(JSON.stringify(tampered), tile.tile_id);
  await rejects(db, /body does not match its stored content hash/);
});

test("published state that outruns the selected release fails the export", async () => {
  const db = await publishedDb();
  // A second release of the same source exists, but the published tiles still describe the first:
  // exporting that second release would carry tiles whose evidence the bundle does not contain.
  db.raw.prepare(
    `INSERT INTO source_releases (release_id, source_id, observed_on, fetched_at, source_url, content_sha256,
       byte_length, header_json, record_count, parser_version, status, is_current, applied_at)
     VALUES (2, ?, '2026-09-01', ?, 'https://example.invalid/next.csv', ?, 1, '["a"]', 0, 'taito.v1', 'applied', 0, ?)`,
  ).run(TAITO_SOURCE_ID, NOW, "b".repeat(64), NOW);
  await rejects(db, /draw existence evidence from another release/, { releaseId: 2 });
});
