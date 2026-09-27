import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../src/db.ts";
import { buildPromotionBundle, verifyPromotionBundle } from "../src/pipeline/promotion.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const BODY = "-- promotion_bootstraps: refused unless the target is empty\n";

async function sample() {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return buildPromotionBundle(db);
}

async function rehash(sql: string): Promise<string> {
  const start = sql.indexOf(BODY);
  const body = sql.slice(start);
  const old = sql.match(/^-- contentSha256: ([0-9a-f]{64})$/m)?.[1];
  assert.ok(old);
  return sql.replace(`-- contentSha256: ${old}`, `-- contentSha256: ${await sha256Hex(body)}`);
}

test("verifier needs the exact external reviewed hash, even if attacker rehashes the body", async () => {
  const { sql, manifest } = await sample();
  assert.equal(await verifyPromotionBundle(sql, manifest.contentSha256), manifest.contentSha256);
  const changed = sql.replace("-- promotion_bootstrap_completions: the target", "-- promotion_bootstrap_completions: altered target");
  await assert.rejects(verifyPromotionBundle(changed, manifest.contentSha256));
  const rehashed = await rehash(changed);
  await assert.rejects(verifyPromotionBundle(rehashed, manifest.contentSha256), /reviewed record/);
  await assert.rejects(verifyPromotionBundle(sql, "f".repeat(64)), /reviewed record/);
  await assert.rejects(verifyPromotionBundle(sql, "not-a-hash"), /64 lowercase hex/);
  await assert.rejects(verifyPromotionBundle(sql.replace(/^-- contentSha256: .*\n/m, ""), manifest.contentSha256), /contentSha256 lines/);
  await assert.rejects(verifyPromotionBundle(sql.replace(/^-- contentSha256: .*\n/m, (line) => line + line), manifest.contentSha256), /contentSha256 lines/);
  await assert.rejects(verifyPromotionBundle(sql.replace(/^-- contentSha256: .*$/m, "-- contentSha256: bad"), manifest.contentSha256), /64 lowercase hex/);
  await assert.rejects(verifyPromotionBundle(`INSERT INTO report_rate_windows VALUES ('${"a".repeat(64)}', 'hour', 'x', 1, 'y');\n${sql}`,
    manifest.contentSha256), /unhashed header contains executable content/);
});

test("verification CLI exits 0 only with a required trusted expected hash", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { sql, manifest } = await sample();
  const dir = mkdtempSync(join(tmpdir(), "mannerpath-verify-"));
  try {
    const file = join(dir, "promotion.sql");
    writeFileSync(file, sql);
    const script = fileURLToPath(new URL("../scripts/verify-promotion.ts", import.meta.url));
    const run = (...args: string[]) => spawnSync(process.execPath,
      ["--experimental-strip-types", "--no-warnings", script, "--file", file, ...args], { encoding: "utf8" });
    assert.equal(run("--expected-content-sha256", manifest.contentSha256).status, 0);
    assert.notEqual(run().status, 0);
    assert.notEqual(run("--expected-content-sha256", "f".repeat(64)).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
