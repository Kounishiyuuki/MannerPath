import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

// Isolate the readiness truth table from completion insertion guards: the exporter tests
// establish that real completion markers can only be created after full verification.
function ledger() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE promotion_bootstraps (id INTEGER);
    CREATE TABLE promotion_multi_bootstraps (id INTEGER);
    CREATE TABLE promotion_bootstrap_completions (id INTEGER);
    CREATE TABLE promotion_multi_bootstrap_completions (id INTEGER);
    CREATE TABLE promotion_v4_manifests (id INTEGER, manifest_sha256 TEXT);
    CREATE TABLE promotion_v4_completions (id INTEGER, manifest_sha256 TEXT);`);
  return new SqliteD1(raw);
}
async function readiness(db: SqliteD1) {
  const response = await app.request("/v1/readiness", {}, { DB: db });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return { status: response.status, body: await response.json() };
}

test("fresh migrated DATA_DB is explicitly incomplete for remote readiness", async () => {
  assert.deepEqual(await readiness(new SqliteD1()), {
    status: 503, body: { schemaVersion: 1, completed: false, state: "localPipeline" },
  });
});

for (const legacy of ["promotion_bootstrap_completions", "promotion_multi_bootstrap_completions"]) {
  test(`${legacy}: completed legacy bootstrap stays compatible; unfinished v4 overrides it`, async () => {
    const db = ledger();
    db.raw.exec(`INSERT INTO ${legacy} VALUES (1)`);
    assert.equal((await readiness(db)).status, 200);
    db.raw.exec("INSERT INTO promotion_v4_manifests VALUES (1, 'digest')");
    assert.deepEqual(await readiness(db), {
      status: 503, body: { schemaVersion: 1, completed: false, state: "promotionIncomplete" },
    });
    db.raw.exec("INSERT INTO promotion_v4_completions VALUES (1, 'wrong')");
    assert.equal((await readiness(db)).status, 503);
    db.raw.exec("UPDATE promotion_v4_completions SET manifest_sha256 = 'digest'");
    assert.equal((await readiness(db)).status, 200);
  });
}

test("v4 completion alone cannot replace underlying final verification", async () => {
  const db = ledger();
  db.raw.exec("INSERT INTO promotion_v4_manifests VALUES (1, 'digest'); INSERT INTO promotion_v4_completions VALUES (1, 'digest')");
  assert.equal((await readiness(db)).status, 503);
});

test("readiness database failure fails closed", async () => {
  const db = new SqliteD1(new DatabaseSync(":memory:"));
  const result = await readiness(db);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "promotionIncomplete");
});

test("legacy database without v4 tables retains completed readiness", async () => {
  const db = ledger();
  db.raw.exec("DROP TABLE promotion_v4_completions; DROP TABLE promotion_v4_manifests; INSERT INTO promotion_multi_bootstrap_completions VALUES (1)");
  assert.equal((await readiness(db)).status, 200);
});

test("open legacy bootstrap cannot use the local pipeline exception", async () => {
  const db = ledger();
  db.raw.exec("INSERT INTO promotion_multi_bootstraps VALUES (1)");
  assert.deepEqual(await readiness(db), {
    status: 503, body: { schemaVersion: 1, completed: false, state: "promotionIncomplete" },
  });
});
