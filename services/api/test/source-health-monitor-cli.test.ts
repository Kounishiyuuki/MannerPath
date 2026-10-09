import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../scripts/source-health-monitor.ts", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath,
  ["--experimental-strip-types", "--no-warnings", cli, ...args], { encoding: "utf8", timeout: 15000 });

test("CLI defaults to deterministic, parseable offline JSON with successful alert exit", () => {
  const first = run("--fail-on-review");
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.equal(report.modelVersion, "source-health.v1");
  assert.equal(report.checkedAt, null);
  assert.equal(report.results.length, 6);
  for (const result of report.results) {
    assert.equal(result.mode, "fixture");
    assert.equal(result.status, "healthy");
    assert.equal(result.httpStatus, null);
    assert.deepEqual(result.rights.fingerprints, []);
  }
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
});

test("CLI filters known sources and rejects malformed or excessive baseline reports offline", () => {
  const filtered = run("--source=taito-public-smoking-areas", "--checked-at=2026-10-09T00:00:00Z");
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.equal(JSON.parse(filtered.stdout).results.length, 1);
  assert.equal(JSON.parse(filtered.stdout).checkedAt, "2026-10-09T00:00:00Z");
  assert.notEqual(run("--source=unregistered").status, 0);
  const directory = mkdtempSync(join(tmpdir(), "mannerpath-health-cli-"));
  const path = join(directory, "baseline.json");
  try {
    writeFileSync(path, JSON.stringify({ modelVersion: "source-health.v1", results: [null] }));
    const invalid = run(`--baseline=${path}`);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid health baseline/);
    writeFileSync(path, " ".repeat(1024 * 1024 + 1));
    const large = run(`--baseline=${path}`);
    assert.notEqual(large.status, 0);
    assert.match(large.stderr, /baseline exceeds byte limit/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
