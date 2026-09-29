import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTaitoQuality } from "../src/quality/taito-policy.ts";
import { buildPromotionBundle, buildMultiSourcePromotionBundle } from "../src/pipeline/promotion.ts";
import { TAITO_LIST_PAGE_CONFLICTS } from "../src/pipeline/taito-list-page.ts";
import { TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { importTaito, NOW, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, applyPromotionBundle } from "./support/sqlite-d1.ts";

async function original() {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return db;
}

const withheld = TAITO_LIST_PAGE_CONFLICTS.filter((c) =>
  c.effects.includes("withholdFromPublication") || c.effects.includes("temporarilyClosed"));
const hours = TAITO_LIST_PAGE_CONFLICTS.find((c) => c.effects.length === 1 && c.effects[0] === "hoursUnknown")!;
const failures = async (db: SqliteD1) => (await analyzeTaitoQuality(db, TAITO_SOURCE_ID)).checks.filter((c) => c.status === "fail");

// Fault injection only: production bootstrap seals correctly prohibit these changes.
function removeGuards(db: SqliteD1, table: string) {
  for (const row of db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table)) {
    db.raw.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
  }
}

for (const conflict of withheld) {
  test(`ordinary ingestion still requires withheld conflict row: ${conflict.csvName}`, async () => {
    const db = await original();
    db.raw.prepare("UPDATE spots SET name = 'TEST missing reviewed name' WHERE name = ?").run(conflict.csvName);
    assert.ok((await failures(db)).some((c) => c.detail.includes(`${conflict.csvName}: no canonical spot`)));
  });
}

test("a retained closure conflict must still be temporarily closed", async () => {
  const db = await original();
  const closed = withheld.find((c) => c.effects.includes("temporarilyClosed"))!;
  db.raw.prepare("UPDATE spots SET lifecycle = 'active' WHERE name = ?").run(closed.csvName);
  assert.ok((await failures(db)).some((c) => c.detail.includes("lifecycle active")));
});

for (const version of ["v2", "v3"] as const) {
  async function target() {
    const source = await original();
    const bundle = version === "v2" ? await buildPromotionBundle(source) : await buildMultiSourcePromotionBundle(source);
    const db = new SqliteD1();
    applyPromotionBundle(db.raw, bundle.sql);
    return db;
  }

  test(`${version} completed publication bootstrap permits only intentionally omitted conflict rows`, async () => {
    const db = await target();
    for (const conflict of withheld) assert.equal(db.raw.prepare("SELECT 1 FROM spots WHERE name = ?").get(conflict.csvName), undefined);
    assert.deepEqual(await failures(db), []);
    removeGuards(db, "spots");
    db.raw.prepare("UPDATE spots SET name = 'TEST missing reviewed name' WHERE name = ?").run(hours.csvName);
    assert.ok((await failures(db)).some((c) => c.detail.includes(`${hours.csvName}: no canonical spot`)));
  });

  test(`${version} completed bootstrap still rejects parsed hours on a carried conflict`, async () => {
    const db = await target();
    removeGuards(db, "spots");
    db.raw.prepare("UPDATE spots SET opening_hours_status = 'parsed', opening_hours_raw = '24/7', opening_hours_json = '{}' WHERE name = ?").run(hours.csvName);
    assert.ok((await failures(db)).some((c) => c.detail.includes("hours still parsed")));
  });

  test(`${version} completed bootstrap still requires carried attenuation evidence`, async () => {
    const db = await target();
    removeGuards(db, "spot_field_attenuations");
    db.raw.prepare("DELETE FROM spot_field_attenuations WHERE spot_id = (SELECT spot_id FROM spots WHERE name = ?)").run(hours.csvName);
    assert.ok((await failures(db)).some((c) => c.detail.includes("hoursUnknown: no attestation row")));
  });

  test(`${version} bootstrap declaration without completion cannot justify absent conflict rows`, async () => {
    const db = await target();
    const table = version === "v2" ? "promotion_bootstrap_completions" : "promotion_multi_bootstrap_completions";
    removeGuards(db, table);
    db.raw.exec(`DELETE FROM ${table}`);
    const failed = await failures(db);
    for (const conflict of withheld) assert.ok(failed.some((c) => c.detail.includes(`${conflict.csvName}: no canonical spot`)));
  });
}
