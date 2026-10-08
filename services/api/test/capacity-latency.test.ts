import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { parseArgs, dist, timeEndpoint } from "../scripts/capacity-latency.ts";

test("latency arguments categorically restrict targets and valid sample counts", () => {
  for (const extra of [["--remote"], ["--base-url", "https://example.com"], ["--base-url", "ftp://localhost"], ["--repeats", "0"], ["--repeats", "1.5"], ["--repeats", "NaN"], ["--warmup", "-1"]]) {
    assert.throws(() => parseArgs(["--db", "/tmp/example.sqlite", ...extra]));
  }
  assert.equal(parseArgs(["--db", "/tmp/example.sqlite", "--warmup", "0", "--repeats", "1"]).warmup, 0);
});
test("nearest rank quantiles reject invalid samples", () => {
  assert.deepEqual(dist([1, 2, 3, 4]), { n: 4, mean: 2.5, p50: 2, p95: 4, p99: 4, max: 4 });
  for (const sample of [[], [NaN], [Infinity], [-1]]) assert.throws(() => dist(sample));
});
test("zero warmup retains measured ETag and refuses redirects", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { Location: "https://example.com" }); res.end(); }
    else if (req.headers["if-none-match"] === '"test"') { res.writeHead(304); res.end(); }
    else { res.writeHead(200, { ETag: '"test"' }); res.end("ok"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const result = await timeEndpoint(url, "/", 200, 0, 1);
    assert.equal(result.etag, '"test"');
    assert.equal((await timeEndpoint(url, "/", 304, 0, 1, { "If-None-Match": result.etag })).status, 304);
    await assert.rejects(timeEndpoint(url, "/redirect", 200, 0, 1));
  } finally { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
});

test("single-part preflight verifies live manifest and rejects a different database body", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { verifyTargets } = await import("../scripts/capacity-latency.ts");
  const directory = mkdtempSync(join(tmpdir(), "capacity-latency-test-"));
  const path = join(directory, "fixture.sqlite");
  const db = new DatabaseSync(path);
  const part = JSON.stringify({ spots: [{ id: "sp_Zfixture" }] });
  const manifest = { tile: "14/1/1", revision: 1, parts: [{ index: 0, spotCount: 1, sha256: createHash("sha256").update(part).digest("hex") }] };
  db.exec("CREATE TABLE tile_snapshots(tile_id TEXT, body_json TEXT); CREATE TABLE tile_snapshot_parts(tile_id TEXT, part_index INTEGER, content_sha256 TEXT, spot_count INTEGER);");
  db.exec("CREATE TABLE promotion_bootstraps(id); CREATE TABLE promotion_multi_bootstraps(id); CREATE TABLE promotion_bootstrap_completions(id); CREATE TABLE promotion_multi_bootstrap_completions(id);");
  db.prepare("INSERT INTO tile_snapshots VALUES (?, ?)").run(manifest.tile, JSON.stringify(manifest));
  db.prepare("INSERT INTO tile_snapshot_parts VALUES (?, 0, ?, 1)").run(manifest.tile, manifest.parts[0].sha256);
  db.close();
  let wrong = false;
  let refuse = false;
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    if (refuse && req.url!.endsWith("/parts/100")) { res.statusCode = 400; res.end(JSON.stringify({ error: "invalidTilePart", detail: "part must be a canonical decimal index" })); return; }
    if (req.url === "/v1/readiness") { res.statusCode = 503; res.end(JSON.stringify({ schemaVersion: 1, completed: false, state: "localPipeline" })); return; }
    res.end(req.url!.endsWith("/manifest") ? JSON.stringify({ ...manifest, revision: wrong ? 2 : 1 }) : req.url!.includes("/parts/") ? part : JSON.stringify({ requestedId: "sp_Zfixture", spot: { id: "sp_Zfixture" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const targets = { multiPartTile: null, multiPartCount: 1, singlePartTile: manifest.tile, spotId: "sp_Zfixture", emptyTile: "14/0/0" };
  try {
    assert.deepEqual(await verifyTargets(url, path, targets), { expectedReadiness: { schemaVersion: 1, completed: false, state: "localPipeline" }, parityIssues: [] });
    assert.ok(paths.includes("/v1/tiles/14/1/1/parts/0"));
    assert.ok(paths.includes("/v1/spots/sp_Zfixture"));
    const fixture = new DatabaseSync(path);
    fixture.prepare("INSERT INTO tile_snapshot_parts VALUES (?, 100, ?, 1)").run(manifest.tile, manifest.parts[0].sha256);
    fixture.close();
    refuse = true;
    const refused = await verifyTargets(url, path, targets);
    assert.deepEqual(refused.parityIssues, [{ tile: manifest.tile, partIndex: 100, status: 400,
      body: JSON.stringify({ error: "invalidTilePart", detail: "part must be a canonical decimal index" }) }]);
    wrong = true;
    await assert.rejects(verifyTargets(url, path, targets), /does not match supplied SQLite/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    rmSync(directory, { recursive: true });
  }
});
