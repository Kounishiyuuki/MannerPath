import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPromotionBundle } from "../src/pipeline/promotion.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyPromotionBundle, migratedSqlite } from "./support/sqlite-d1.ts";

const SEALED = /promotion bootstrap is complete; promoted state is immutable/;

async function completed() {
  const origin = new SqliteD1();
  await importTaito(origin, { newSpotId: sequentialSpotIds() });
  await publishTiles(origin, { now: NOW });
  const target = migratedSqlite();
  applyPromotionBundle(target, (await buildPromotionBundle(origin)).sql);
  return target;
}

test("completion seals every promoted and derived table for INSERT, UPDATE and DELETE", async () => {
  const db = await completed();
  const tables = ["sources", "source_releases", "source_records", "source_record_match_keys", "source_entities",
    "promotion_review_match_attestations", "source_record_entities", "spots", "spot_source_entities",
    "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots", "source_observations"];
  for (const table of tables) {
    // A row trigger cannot fire on an empty carried table (source_observations never travels; match keys are
    // empty on a first release), so every seal trigger is also asserted structurally: a later migration cannot
    // drop one silently. Attestations are sealed by their own append-only and open-bootstrap triggers instead.
    if (table !== "promotion_review_match_attestations") {
      for (const op of ["insert", "update", "delete"]) {
        const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(`promotion_complete_seals_${table}_${op}`) as { sql: string } | undefined;
        assert.ok(trigger?.sql.includes(`BEFORE ${op.toUpperCase()} ON ${table}`) && trigger.sql.includes("promotion_bootstrap_completions"),
          `${table} ${op} seal missing`);
      }
    }
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    assert.throws(() => db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "1").join(", ")})`).run(),
      table === "promotion_review_match_attestations" ? /promotion_review_match_attestations: not a reviewed decision|promotion bootstrap is complete/ : SEALED, `${table} INSERT`);
    // Row triggers fire only when the table has at least one row.
    if ((db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n > 0) {
      assert.throws(() => db.prepare(`UPDATE ${table} SET ${columns[0]} = ${columns[0]}`).run(),
        SEALED, `${table} UPDATE`);
      assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), SEALED, `${table} DELETE`);
    }
  }
});

test("completion leaves report, moderation, rate window and App Attest writes available", async () => {
  const db = await completed();
  const reportId = `rp_${"0".repeat(26)}`;
  db.prepare(`INSERT INTO reports (report_id, schema_version, report_type, subject_spot_id, attestation_status, received_at, minimize_after)
    VALUES (?, 1, 'exists', ?, 'notProvided', '2026-09-01T00:00:00Z', '2026-11-30T00:00:00Z')`)
    .run(reportId, `sp_${"0".repeat(26)}`);
  db.prepare("INSERT INTO report_moderation (report_id, state, updated_at) VALUES (?, 'pending', '2026-09-01T00:00:00Z')").run(reportId);
  db.prepare("INSERT INTO report_rate_windows VALUES (?, 'hour', '2026-09-01T00:00:00Z', 1, '2026-09-01T01:00:00Z')")
    .run("a".repeat(64));
  db.prepare("INSERT INTO app_attest_keys VALUES (?, ?, 'production', 0, '2026-09-01T00:00:00Z')")
    .run(`${"A".repeat(43)}=`, `04${"a".repeat(128)}`);
  db.prepare("INSERT INTO app_attest_challenges (challenge, purpose, issued_at, expires_at) VALUES (?, 'registration', '2026-09-01T00:00:00Z', '2026-09-01T00:05:00Z')")
    .run(`${"B".repeat(43)}=`);
  for (const table of ["reports", "report_moderation", "report_rate_windows", "app_attest_keys", "app_attest_challenges"]) {
    assert.equal((db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n, 1, table);
  }

  // The runtime's own updates and purges, in the shapes src/ issues them, stay available too: no over-seal.
  const at = "2026-12-01T00:00:00Z";
  db.prepare(`INSERT INTO report_rate_windows (submitter_hash, window_kind, window_start, report_count, expires_at)
    VALUES (?, 'hour', '2026-09-01T00:00:00Z', 1, '2026-09-01T01:00:00Z')
    ON CONFLICT (submitter_hash, window_kind, window_start) DO UPDATE SET report_count = report_count + 1`).run("a".repeat(64));
  assert.equal((db.prepare("SELECT report_count n FROM report_rate_windows").get() as { n: number }).n, 2, "rate-limit upsert");
  db.prepare(`UPDATE report_moderation SET state = 'rejected', decided_at = ?, decided_by = 'moderator', decision_reason = 'unspecified', updated_at = ?
    WHERE report_id = ?`).run(at, at, reportId);
  db.prepare(`UPDATE reports SET note = NULL, proposed_latitude = NULL, proposed_longitude = NULL, observed_on = NULL,
    submitter_hash = NULL, redacted_at = ? WHERE report_id = ? AND redacted_at IS NULL`).run(at, reportId);
  db.prepare("UPDATE app_attest_challenges SET consumed_at = ? WHERE challenge = ? AND consumed_at IS NULL").run(at, `${"B".repeat(43)}=`);
  db.prepare("UPDATE app_attest_keys SET sign_count = 1 WHERE key_id = ?").run(`${"A".repeat(43)}=`);
  db.prepare("DELETE FROM report_rate_windows WHERE expires_at <= ?").run(at);
  db.prepare("DELETE FROM app_attest_challenges WHERE expires_at <= ?").run(at);
  assert.deepEqual(
    ["report_rate_windows", "app_attest_challenges"].map((t) => (db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n),
    [0, 0], "retention purges");
  assert.equal((db.prepare("SELECT redacted_at FROM reports").get() as { redacted_at: string }).redacted_at, at);
  assert.equal((db.prepare("SELECT sign_count FROM app_attest_keys").get() as { sign_count: number }).sign_count, 1);
});
