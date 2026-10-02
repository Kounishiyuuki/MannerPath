import { test } from "node:test";
import assert from "node:assert/strict";
import { migratedSqlite } from "./support/sqlite-d1.ts";

test("promotion completion searches release links instead of repeating a growing declared-release set per link", () => {
  const db = migratedSqlite();
  try {
    const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE name='promotion_multi_bootstrap_completions_valid_source_rows_b'").get() as { sql: string };
    const predicate = trigger.sql.match(/WHEN ([\s\S]*?)\nBEGIN/)![1].replaceAll("NEW.promotion_bootstrap_id", "1");
    const plan = (db.prepare(`EXPLAIN QUERY PLAN SELECT (${predicate})`).all() as { detail: string }[]).map((r) => r.detail).join("\n");
    assert.match(plan, /SEARCH e USING COVERING INDEX source_record_entities_release \(release_id=\?\)/);
    assert.match(plan, /SEARCH a USING COVERING INDEX promotion_review_match_attestations_release \(release_id=\?\)/);
    assert.match(plan, /promotion_multi_additive_source/);
    assert.doesNotMatch(plan, /SCAN e USING COVERING INDEX sqlite_autoindex_source_record_entities/);
  } finally { db.close(); }
});
