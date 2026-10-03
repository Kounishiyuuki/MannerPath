// The promotion v4 CLI itself (scripts/promotion-v4.ts), run as the maintainer runs it on Node >= 24: build from a
// file database, verify the bundle, and apply-local into a NEW target file. The library functions are covered by
// promotion-v4*.test.ts; this guards the command-line wiring (a Node 24 `DatabaseSync(path, undefined)` crash once
// made `apply-local` unusable while every library test passed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, migratedSqlite } from "./support/sqlite-d1.ts";

const cli = (...args: string[]) => spawnSync(process.execPath,
  ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", "scripts/promotion-v4.ts", ...args],
  { cwd: new URL("..", import.meta.url), encoding: "utf8" });

test("promotion v4 CLI: build -> verify -> apply-local into a new file database", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "promotion-v4-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // A source database on disk, as the maintainer passes it.
  const sourcePath = join(root, "source.sqlite");
  const memory = migratedSqlite();
  const db = new SqliteD1(memory);
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  memory.exec(`VACUUM INTO '${sourcePath}'`);

  const build = cli("build", "--database", sourcePath, "--dir", join(root, "bundle"), "--chunk-bytes", "4194304");
  assert.equal(build.status, 0, build.stderr);
  const digest = JSON.parse(await readFile(join(root, "bundle", "manifest.json"), "utf8")).wholeBundleSha256 as string;
  const verify = cli("verify", "--dir", join(root, "bundle"), "--expected-digest", digest);
  assert.equal(verify.status, 0, verify.stderr);
  const target = join(root, "green.sqlite");
  const apply = cli("apply-local", "--database", target, "--dir", join(root, "bundle"), "--expected-digest", digest);
  assert.equal(apply.status, 0, apply.stderr);
  assert.match(apply.stdout, /"status": "completed"/);
  const green = new DatabaseSync(target, { readOnly: true });
  try {
    const published = (green.prepare("SELECT count(*) n FROM tile_snapshot_spots").get() as { n: number }).n;
    assert.equal(published, (memory.prepare("SELECT count(*) n FROM tile_snapshot_spots").get() as { n: number }).n);
    assert.equal((green.prepare("SELECT count(*) n FROM promotion_multi_bootstrap_completions").get() as { n: number }).n, 1, "sealed");
  } finally {
    green.close();
  }
});
