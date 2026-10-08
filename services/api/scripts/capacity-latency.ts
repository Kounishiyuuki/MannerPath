// Real local Worker read-latency harness for the nationwide capacity validation
// (docs/research/2026-10-08-nationwide-capacity-validation.md). It measures the live `wrangler dev --local`
// Worker over HTTP — not the app handler in-process and not a mock — so the numbers include Hono routing,
// the real D1 point/range SELECTs, JSON serialisation and ETag hashing.
//
// LOCAL ONLY. It refuses any non-loopback target;
// --remote is categorically forbidden, and redirects are rejected. It is
// read-only (every probe is a GET) and writes nothing to any database.
//
// It picks real ids (a multi-part tile, a single-part tile, a published spot, and an empty z14 tile) out of
// the bootstrapped D1 the Worker serves. Point the DB at the promotion benchmark's `*-target.sqlite`, which
// is the real apply/finalize output — a D1 that already holds dense multi-part tiles at 10k/50k/100k scale.
//
//   npm run capacity:latency -- --base-url http://127.0.0.1:8799 \
//     --db /private/tmp/cap-promotion-stress-1048576-target.sqlite --warmup 50 --repeats 500 --out /private/tmp/cap-latency-stress.json
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { assembleTileV1 } from "../src/tiles/parts.ts";
import { promotionReadiness } from "../src/pipeline/promotion-readiness.ts";
import { SqliteD1 } from "../test/support/sqlite-d1.ts";
import { DATA_TILE_ZOOM } from "../src/geo/tile.ts";

interface Args { baseUrl: string; db: string; warmup: number; repeats: number; out: string; remote: boolean }
export function parseArgs(argv: string[]): Args {
  const a: Args = { baseUrl: "http://127.0.0.1:8799", db: "", warmup: 50, repeats: 500, out: "", remote: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--remote") throw new Error("--remote is forbidden: local only");
    else if (f === "--base-url") a.baseUrl = argv[++i] ?? "";
    else if (f === "--db") a.db = argv[++i] ?? "";
    else if (f === "--warmup") a.warmup = Number(argv[++i]);
    else if (f === "--repeats") a.repeats = Number(argv[++i]);
    else if (f === "--out") a.out = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${f}`);
  }
  const url = new URL(a.baseUrl);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (!loopback || !["http:", "https:"].includes(url.protocol)) throw new Error("local loopback HTTP target required");
  if (!Number.isSafeInteger(a.repeats) || a.repeats <= 0) throw new Error("--repeats must be a positive integer");
  if (!Number.isSafeInteger(a.warmup) || a.warmup < 0) throw new Error("--warmup must be a nonnegative integer");
  if (!a.db) throw new Error("--db <path to bootstrapped target sqlite> is required");
  a.baseUrl = url.origin;
  return a;
}

/** Pick real ids out of the D1 the Worker serves, read-only. */
function pickTargets(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const partsCount = db.prepare(
      "SELECT t.tile_id tileId, count(*) n FROM tile_snapshot_parts p JOIN tile_snapshots t USING(tile_id) GROUP BY t.tile_id ORDER BY n DESC, t.tile_id LIMIT 1",
    ).get() as { tileId: string; n: number } | undefined;
    const singlePart = db.prepare(
      "SELECT t.tile_id tileId FROM tile_snapshots t WHERE (SELECT count(*) FROM tile_snapshot_parts p WHERE p.tile_id=t.tile_id)=1 ORDER BY t.tile_id LIMIT 1",
    ).get() as { tileId: string } | undefined;
    const spot = db.prepare("SELECT spot_id spotId FROM tile_snapshot_spots ORDER BY CASE WHEN spot_id GLOB 'sp_Z*' THEN 0 ELSE 1 END, spot_id LIMIT 1").get() as { spotId: string } | undefined;
    return {
      multiPartTile: partsCount && partsCount.n > 1 ? partsCount.tileId : null,
      multiPartCount: partsCount?.n ?? 0,
      singlePartTile: singlePart?.tileId ?? null,
      spotId: spot?.spotId ?? null,
      emptyTile: `${DATA_TILE_ZOOM}/0/0`,
    };
  } finally {
    db.close();
  }
}

export function dist(values: number[]) {
  assert.ok(values.length > 0 && values.every((v) => Number.isFinite(v) && v >= 0), "nonempty finite nonnegative samples required");
  const v = [...values].sort((x, y) => x - y);
  const at = (q: number) => (v.length ? v[Math.min(v.length - 1, Math.ceil(v.length * q) - 1)] : 0);
  const mean = v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
  return { n: v.length, mean: Math.round(mean * 1000) / 1000, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(v.at(-1) ?? 0) };
}
const round = (x: number) => Math.round(x * 1000) / 1000;

export async function timeEndpoint(baseUrl: string, path: string, expectStatus: number, warmup: number, repeats: number, headers: Record<string, string> = {}) {
  let etag = "";
  for (let i = 0; i < warmup; i++) {
    const res = await fetch(`${baseUrl}${path}`, { headers, redirect: "error" });
    etag = res.headers.get("ETag") ?? etag;
    await res.arrayBuffer();
    assert.equal(res.status, expectStatus, `${path} warmup expected ${expectStatus} got ${res.status}`);
  }
  const samples: number[] = [];
  let bytes = 0;
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    const res = await fetch(`${baseUrl}${path}`, { headers, redirect: "error" });
    etag = res.headers.get("ETag") ?? etag;
    const buf = await res.arrayBuffer();
    samples.push(performance.now() - start);
    bytes = buf.byteLength;
    assert.equal(res.status, expectStatus, `${path} expected ${expectStatus} got ${res.status}`);
  }
  return { path, status: expectStatus, bodyBytes: bytes, etag, latencyMs: dist(samples) };
}

export async function verifyTargets(baseUrl: string, dbPath: string, targets: ReturnType<typeof pickTargets>) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const parityIssues: { tile: string; partIndex: number; status: number; body: string }[] = [];
    const expectedReadiness = await promotionReadiness(new SqliteD1(db));
    const readiness = await fetch(`${baseUrl}/v1/readiness`, { redirect: "error" });
    assert.equal(readiness.status, expectedReadiness.completed ? 200 : 503);
    assert.deepEqual(await readiness.json(), expectedReadiness, "Worker readiness does not match supplied SQLite");
    const tileIds = new Set([targets.multiPartTile, targets.singlePartTile].filter((v): v is string => !!v));
    assert.ok(tileIds.size && targets.spotId, "published tile and spot required");
    for (const tile of tileIds) {
      const expected = db.prepare("SELECT body_json FROM tile_snapshots WHERE tile_id=?").get(tile) as { body_json: string };
      const response = await fetch(`${baseUrl}/v1/tiles/${tile}/manifest`, { redirect: "error" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), JSON.parse(expected.body_json), "Worker manifest does not match supplied SQLite");
      const parts = db.prepare("SELECT part_index, content_sha256, spot_count FROM tile_snapshot_parts WHERE tile_id=? ORDER BY part_index").all(tile) as { part_index: number; content_sha256: string; spot_count: number }[];
      const partBodies: string[] = [];
      for (const part of parts) {
        const response = await fetch(`${baseUrl}/v1/tiles/${tile}/parts/${part.part_index}`, { redirect: "error" });
        const body = await response.text();
        assert.equal(response.status, 200, `part ${part.part_index} must be HTTP-readable`);
        assert.equal(createHash("sha256").update(body).digest("hex"), part.content_sha256, "Worker part SHA does not match supplied SQLite");
        assert.equal(JSON.parse(body).spots.length, part.spot_count, "Worker part count mismatch");
        partBodies.push(body);
      }
      const assembled = assembleTileV1(expected.body_json, partBodies);
      assert.equal(assembled.spots.length, parts.reduce((count, part) => count + part.spot_count, 0), "complete HTTP tile assembly count");
    }
    const detail = await fetch(`${baseUrl}/v1/spots/${targets.spotId}`, { redirect: "error" });
    assert.equal(detail.status, 200);
    const body = await detail.json() as { requestedId: string; spot: { id: string } };
    assert.equal(body.requestedId, targets.spotId);
    assert.equal(body.spot.id, targets.spotId);
    return { expectedReadiness, parityIssues };
  } finally { db.close(); }
}

export async function main(argv = process.argv.slice(2)) {
const args = parseArgs(argv);
const targets = pickTargets(args.db);
const { expectedReadiness, parityIssues } = await verifyTargets(args.baseUrl, args.db, targets);
process.stderr.write(`targets: ${JSON.stringify(targets)}\n`);

const probes: Record<string, unknown>[] = [];
const run = async (name: string, path: string, status: number, headers?: Record<string, string>) => {
  probes.push({ name, ...(await timeEndpoint(args.baseUrl, path, status, args.warmup, args.repeats, headers)) });
  const last = probes.at(-1) as { latencyMs: { p50: number; p99: number }; bodyBytes: number };
  process.stderr.write(`${name}: p50=${last.latencyMs.p50}ms p99=${last.latencyMs.p99}ms bytes=${last.bodyBytes}\n`);
};

await run("readiness", "/v1/readiness", expectedReadiness.completed ? 200 : 503);
await run("config", "/v1/config", 200);
await run("tileNotFound404", `/v1/tiles/${targets.emptyTile}`, 404);
if (targets.singlePartTile) {
  const single = await timeEndpoint(args.baseUrl, `/v1/tiles/${targets.singlePartTile}`, 200, args.warmup, args.repeats);
  probes.push({ name: "tileSinglePart200", ...single });
  process.stderr.write(`tileSinglePart200: p50=${single.latencyMs.p50}ms p99=${single.latencyMs.p99}ms\n`);
  await run("tileSinglePart304", `/v1/tiles/${targets.singlePartTile}`, 304, { "If-None-Match": single.etag });
}
if (targets.multiPartTile || targets.singlePartTile) {
  const tile = targets.multiPartTile ?? targets.singlePartTile;
  const manifest = await timeEndpoint(args.baseUrl, `/v1/tiles/${tile}/manifest`, 200, args.warmup, args.repeats);
  probes.push({ name: "tileManifest200", multiPartCount: targets.multiPartCount, ...manifest });
  process.stderr.write(`tileManifest200: p50=${manifest.latencyMs.p50}ms p99=${manifest.latencyMs.p99}ms parts=${targets.multiPartCount}\n`);
  await run("tileManifest304", `/v1/tiles/${tile}/manifest`, 304, { "If-None-Match": manifest.etag });
  await run("tilePart0_200", `/v1/tiles/${tile}/parts/0`, 200);
  if (targets.multiPartTile) await run("tileRequiresParts409", `/v1/tiles/${tile}`, 409);
}
if (targets.spotId) await run("spotDetail200", `/v1/spots/${targets.spotId}`, 200);

const report = {
  version: "capacity-latency.v1",
  environment: { runtime: process.version, baseUrl: args.baseUrl, db: args.db, warmup: args.warmup, repeats: args.repeats,
    note: "local wrangler dev --local over HTTP; NOT remote D1; latencies include local SQLite, not network RTT" },
  targets, expectedReadiness, parityIssues, probes,
};
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ out: args.out, probes: probes.map((p) => ({ name: p.name, p50: (p.latencyMs as { p50: number }).p50, p99: (p.latencyMs as { p99: number }).p99 })) }, null, 1) + "\n");

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
