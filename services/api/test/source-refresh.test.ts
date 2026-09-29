// Source refresh foundation (migration 0017; ADR-0008 decision 9 amendment): fetch -> fingerprint -> retain in
// R2 -> compare -> record. Network and R2 are injected; nothing here leaves the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { TAITO_FIXTURE_SHA256, TAITO_ORIGINAL_DATA_URL, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { type RawArtifactStore, rawArtifactKey } from "../src/refresh/artifact-store.ts";
import { type CheckResult, type FetchLike, checkSource } from "../src/refresh/check.ts";
import { runSourceChecks, scheduled } from "../src/refresh/scheduled.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, TAITO_BYTES, importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1, migratedSqlite } from "./support/sqlite-d1.ts";

const TEXT = new TextDecoder().decode(TAITO_BYTES);
const bytesOf = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// Variants of the real fixture, each a different kind of change.
const RENAMED = bytesOf(TEXT.replace("上野公園前交番裏", "上野公園前交番裏（改）"));
const HEADER_DRIFT = bytesOf(TEXT.replace(",特記事項", ",備考"));
const TRUNCATED = bytesOf(TEXT.split(/(?<=\n)/).slice(0, 11).join("")); // header + records 1-10
const SWAPPED_COORDINATE = bytesOf(TEXT.replace("35.7112,139.77377", "139.77377,35.7112"));

function memoryStore(opts: { failPut?: boolean; failHead?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  const puts: { key: string; sha256: string }[] = [];
  const store: RawArtifactStore = {
    async head(key) {
      if (opts.failHead) throw new Error("R2 head unavailable");
      const o = objects.get(key);
      return o ? { byteLength: o.byteLength } : null;
    },
    async put(key, bytes, sha256) {
      if (opts.failPut) throw new Error("R2 put unavailable");
      assert.equal(sha(bytes), sha256, "the store is asked to verify the bytes' own hash");
      if (objects.has(key)) throw new Error(`overwrite of ${key}`);
      objects.set(key, bytes.slice());
      puts.push({ key, sha256 });
    },
  };
  return { store, objects, puts };
}

type Reply = Uint8Array | { status: number } | { error: string } | { body: Uint8Array; url: string };

function fakeFetch(...replies: Reply[]) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if ("error" in reply) throw new TypeError(reply.error);
    if ("status" in reply) return new Response("unavailable", { status: reply.status });
    const body = reply instanceof Uint8Array ? reply : reply.body;
    const res = new Response(body, { status: 200, headers: { "Content-Type": "text/csv", "Last-Modified": "Fri, 11 Sep 2026 07:48:17 GMT", ETag: '"v1"' } });
    Object.defineProperty(res, "url", { value: reply instanceof Uint8Array ? url : reply.url });
    return res;
  };
  return { fetch, calls };
}

let clock = 0;
const now = () => new Date(Date.parse("2026-09-28T00:00:00Z") + (clock++) * 1000);

async function check(db: SqliteD1, store: RawArtifactStore, fetch: FetchLike, runKey: string): Promise<Extract<CheckResult, { status: "recorded" }>> {
  const result = await checkSource({ db, store, fetch, now }, TAITO_ADAPTER, { runKey, trigger: "manual" });
  assert.equal(result.status, "recorded");
  return result as Extract<CheckResult, { status: "recorded" }>;
}

const count = (db: SqliteD1, table: string) => (db.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
const checkRow = (db: SqliteD1, id: number) => db.raw.prepare("SELECT * FROM source_checks WHERE check_id = ?").get(id) as Record<string, any>;
const findingIds = (db: SqliteD1, id: number) => (JSON.parse(checkRow(db, id).findings_json) as { id: string }[]).map((f) => f.id);

/** Every table a check must never write, as a comparable dump. */
const CANONICAL_TABLES = [
  "sources", "source_releases", "source_records", "source_observations", "source_entities", "source_record_entities",
  "spots", "spot_source_entities", "spot_field_provenance", "spot_field_attenuations", "tile_snapshots", "tile_snapshot_spots",
  "review_items", "review_decisions", "promotion_bootstraps",
];
const canonicalDump = (db: SqliteD1) => JSON.stringify(CANONICAL_TABLES.map((t) => db.raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));

async function withTaitoRelease() {
  const db = new SqliteD1();
  await importTaito(db, { newSpotId: sequentialSpotIds() });
  await publishTiles(db, { now: NOW });
  return db;
}

async function withRegisteredSource() {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  return db;
}

test("deterministic fingerprint: the key is the fixture's documented sha256", () => {
  assert.equal(sha(TAITO_BYTES), TAITO_FIXTURE_SHA256);
  assert.equal(rawArtifactKey(TAITO_FIXTURE_SHA256), `raw/sha256/${TAITO_FIXTURE_SHA256}`);
  assert.throws(() => rawArtifactKey("ABC"), /not a sha256/);
  assert.equal(TAITO_ADAPTER.refreshTarget?.url, TAITO_ORIGINAL_DATA_URL);
});

test("first successful fetch: retains the bytes, records metadata, raises a candidate, creates no release", async () => {
  const db = await withRegisteredSource();
  const { store, puts } = memoryStore();
  const { fetch, calls } = fakeFetch(TAITO_BYTES);
  const r = await check(db, store, fetch, "run-1");
  assert.equal(r.outcome, "changed");
  assert.equal(r.contentSha256, TAITO_FIXTURE_SHA256);
  assert.ok(r.candidateId);
  assert.deepEqual(calls, [TAITO_ORIGINAL_DATA_URL]);
  assert.deepEqual(puts, [{ key: `raw/sha256/${TAITO_FIXTURE_SHA256}`, sha256: TAITO_FIXTURE_SHA256 }]);
  const row = checkRow(db, r.checkId);
  assert.equal(row.http_status, 200);
  assert.equal(row.http_last_modified, "Fri, 11 Sep 2026 07:48:17 GMT");
  assert.equal(row.byte_length, TAITO_BYTES.byteLength);
  assert.equal(row.record_count, 34);
  assert.equal(row.baseline_check_id, null);
  assert.equal(row.baseline_release_id, null);
  assert.deepEqual(db.raw.prepare("SELECT storage_key, byte_length FROM raw_artifacts").all().map((x) => ({ ...x })),
    [{ storage_key: `raw/sha256/${TAITO_FIXTURE_SHA256}`, byte_length: TAITO_BYTES.byteLength }]);
  assert.equal(count(db, "source_releases"), 0);
  assert.equal(count(db, "source_records"), 0);
});

test("unchanged: same hash as the applied release writes only the check row; lastVerifiedAt and tiles stay", async () => {
  const db = await withTaitoRelease();
  const before = canonicalDump(db);
  const verified = db.raw.prepare("SELECT DISTINCT last_verified_at FROM spots").all();
  const { store } = memoryStore();
  const r = await check(db, store, fakeFetch(TAITO_BYTES).fetch, "run-1");
  assert.equal(r.outcome, "unchanged");
  assert.equal(r.candidateId, null);
  assert.equal(count(db, "source_refresh_candidates"), 0);
  assert.equal(count(db, "source_releases"), 1);
  assert.equal(checkRow(db, r.checkId).baseline_release_id, 1);
  assert.deepEqual(db.raw.prepare("SELECT DISTINCT last_verified_at FROM spots").all(), verified);
  assert.equal(canonicalDump(db), before);
});

test("changed: a different hash raises one candidate and applies nothing", async () => {
  const db = await withTaitoRelease();
  const before = canonicalDump(db);
  const { store } = memoryStore();
  const r = await check(db, store, fakeFetch(RENAMED).fetch, "run-1");
  assert.equal(r.outcome, "changed");
  assert.deepEqual(findingIds(db, r.checkId), []);
  const candidate = db.raw.prepare("SELECT * FROM source_refresh_candidates").get() as Record<string, unknown>;
  assert.equal(candidate.artifact_sha256, sha(RENAMED));
  assert.equal(candidate.review_state, "changed");
  assert.equal(canonicalDump(db), before, "no release, spot, provenance or tile row changes");
});

test("artifact dedupe: the same bytes on later runs are stored once and queued once", async () => {
  const db = await withTaitoRelease();
  const { store, puts } = memoryStore();
  const a = await check(db, store, fakeFetch(RENAMED).fetch, "run-1");
  const b = await check(db, store, fakeFetch(RENAMED).fetch, "run-2");
  const c = await check(db, store, fakeFetch(TAITO_BYTES).fetch, "run-3");
  const d = await check(db, store, fakeFetch(TAITO_BYTES).fetch, "run-4");
  assert.deepEqual([a.outcome, b.outcome, c.outcome, d.outcome], ["changed", "unchanged", "changed", "unchanged"]);
  assert.equal(puts.length, 2);
  assert.equal(count(db, "raw_artifacts"), 2);
  // Reverting to the applied release's bytes is a change against the last check, but not a new candidate.
  assert.equal(count(db, "source_refresh_candidates"), 1);
  assert.equal(c.candidateId, null);
  assert.equal(checkRow(db, b.checkId).baseline_check_id, a.checkId);
  assert.equal(count(db, "source_checks"), 4);
});

test("retry idempotence: the same run key fetches and writes nothing again, whatever the first outcome", async () => {
  for (const reply of [RENAMED, { status: 503 }] as Reply[]) {
    const db = await withTaitoRelease();
    const { store, puts } = memoryStore();
    const { fetch, calls } = fakeFetch(reply, RENAMED);
    const first = await check(db, store, fetch, "cron:2026-09-28T00:00:00.000Z");
    const snapshot = ["source_checks", "raw_artifacts", "source_refresh_candidates"].map((t) => count(db, t));
    const retry = await check(db, store, fetch, "cron:2026-09-28T00:00:00.000Z");
    assert.equal(retry.reused, true);
    assert.equal(retry.checkId, first.checkId);
    assert.equal(retry.outcome, first.outcome);
    assert.equal(calls.length, 1);
    assert.ok(puts.length <= 1);
    assert.deepEqual(["source_checks", "raw_artifacts", "source_refresh_candidates"].map((t) => count(db, t)), snapshot);
  }
});

test("HTTP and network failures are recorded as failed checks with no artifact or candidate", async () => {
  const db = await withTaitoRelease();
  const { store, puts } = memoryStore();
  const http = await check(db, store, fakeFetch({ status: 503 }).fetch, "run-1");
  const net = await check(db, store, fakeFetch({ error: "connection reset" }).fetch, "run-2");
  assert.deepEqual([http.outcome, net.outcome], ["failed", "failed"]);
  assert.equal(checkRow(db, http.checkId).failure_stage, "http");
  assert.equal(checkRow(db, http.checkId).http_status, 503);
  assert.equal(checkRow(db, net.checkId).failure_stage, "fetch");
  assert.match(checkRow(db, net.checkId).detail, /connection reset/);
  assert.equal(puts.length, 0);
  assert.equal(count(db, "raw_artifacts"), 0);
  assert.equal(count(db, "source_refresh_candidates"), 0);
  // A failed check is never a baseline: the next good fetch compares against the applied release.
  const next = await check(db, store, fakeFetch(TAITO_BYTES).fetch, "run-3");
  assert.equal(next.outcome, "unchanged");
  assert.equal(checkRow(db, next.checkId).baseline_check_id, null);
});

test("storage failure keeps the fingerprint but no artifact, and a mismatched stored object fails closed", async () => {
  const db = await withTaitoRelease();
  const r = await check(db, memoryStore({ failPut: true }).store, fakeFetch(RENAMED).fetch, "run-1");
  assert.equal(r.outcome, "failed");
  const row = checkRow(db, r.checkId);
  assert.equal(row.failure_stage, "storage");
  assert.equal(row.content_sha256, sha(RENAMED));
  assert.equal(row.artifact_sha256, null);
  assert.equal(count(db, "raw_artifacts"), 0);
  assert.equal(count(db, "source_refresh_candidates"), 0);

  const corrupt = memoryStore();
  corrupt.objects.set(rawArtifactKey(sha(RENAMED)), new Uint8Array(3));
  const c = await check(db, corrupt.store, fakeFetch(RENAMED).fetch, "run-2");
  assert.equal(c.outcome, "failed");
  assert.match(checkRow(db, c.checkId).detail, /holds 3 bytes/);
});

test("oversized bodies fail as tooLarge without being stored", async () => {
  const db = await withTaitoRelease();
  const { store, puts } = memoryStore();
  const huge = new Uint8Array(16 * 1024 * 1024 + 1);
  const r = await check(db, store, fakeFetch(huge).fetch, "run-1");
  assert.equal(r.outcome, "failed");
  assert.equal(checkRow(db, r.checkId).failure_stage, "tooLarge");
  assert.equal(puts.length, 0);
});

test("parser/schema drift: a header the adapter refuses is needsReview, retained for the reviewer", async () => {
  const db = await withTaitoRelease();
  const { store, puts } = memoryStore();
  const r = await check(db, store, fakeFetch(HEADER_DRIFT).fetch, "run-1");
  assert.equal(r.outcome, "needsReview");
  assert.deepEqual(findingIds(db, r.checkId), ["parseFailed"]);
  assert.equal(checkRow(db, r.checkId).header_json, null);
  assert.equal(puts.length, 1);
  assert.equal((db.raw.prepare("SELECT review_state FROM source_refresh_candidates").get() as { review_state: string }).review_state, "needsReview");
});

test("a header change the parser accepts is still drift against the reviewed release", async () => {
  const db = await withTaitoRelease();
  const lenient = { ...TAITO_ADAPTER, parse: (b: Uint8Array) => {
    const parsed = TAITO_ADAPTER.parse(bytesOf(new TextDecoder().decode(b).replace(",備考", ",特記事項")));
    return { header: parsed.header.map((h) => (h === "特記事項" ? "備考" : h)), rows: parsed.rows };
  } };
  const r = await checkSource({ db, store: memoryStore().store, fetch: fakeFetch(HEADER_DRIFT).fetch, now }, lenient, { runKey: "run-1", trigger: "manual" });
  assert.equal(r.status === "recorded" && r.outcome, "needsReview");
  assert.deepEqual(findingIds(db, (r as { checkId: number }).checkId), ["headerChanged"]);
});

test("a large record drop is needsReview", async () => {
  const db = await withTaitoRelease();
  const r = await check(db, memoryStore().store, fakeFetch(TRUNCATED).fetch, "run-1");
  assert.equal(r.outcome, "needsReview");
  assert.deepEqual(findingIds(db, r.checkId), ["recordCountDecreased"]);
  assert.match(JSON.parse(checkRow(db, r.checkId).findings_json)[0].detail, /34 -> 10 records/);
});

test("a suspicious coordinate change is needsReview", async () => {
  const db = await withTaitoRelease();
  const r = await check(db, memoryStore().store, fakeFetch(SWAPPED_COORDINATE).fetch, "run-1");
  assert.equal(r.outcome, "needsReview");
  const ids = findingIds(db, r.checkId);
  assert.equal(ids.length, 1);
  assert.ok(["coordinatesOutsideExtent", "recordsUnobservable"].includes(ids[0]), ids[0]);
});

test("source identity mismatch: a redirect to another origin is needsReview", async () => {
  const db = await withTaitoRelease();
  const r = await check(db, memoryStore().store, fakeFetch({ body: RENAMED, url: "https://mirror.example.com/x.csv" }).fetch, "run-1");
  assert.equal(r.outcome, "needsReview");
  assert.deepEqual(findingIds(db, r.checkId), ["sourceIdentityMismatch"]);
  assert.equal(checkRow(db, r.checkId).final_url, "https://mirror.example.com/x.csv");
});

test("previous good release is preserved through changed, drifting and failed checks", async () => {
  const db = await withTaitoRelease();
  const before = canonicalDump(db);
  const tiles = db.raw.prepare("SELECT tile_id, revision, content_sha256 FROM tile_snapshots ORDER BY tile_id").all();
  const { store } = memoryStore();
  let n = 0;
  for (const reply of [RENAMED, HEADER_DRIFT, TRUNCATED, SWAPPED_COORDINATE, { status: 500 }, { error: "dns" }] as Reply[]) {
    await check(db, store, fakeFetch(reply).fetch, `run-${++n}`);
  }
  assert.equal(canonicalDump(db), before);
  assert.deepEqual(db.raw.prepare("SELECT tile_id, revision, content_sha256 FROM tile_snapshots ORDER BY tile_id").all(), tiles);
  assert.deepEqual(db.raw.prepare("SELECT release_id, status, is_current FROM source_releases").all().map((r) => ({ ...r })),
    [{ release_id: 1, status: "applied", is_current: 1 }]);
});

test("a source with no registry row is skipped without writing", async () => {
  const db = new SqliteD1();
  const { fetch, calls } = fakeFetch(TAITO_BYTES);
  const r = await checkSource({ db, store: memoryStore().store, fetch, now }, TAITO_ADAPTER, { runKey: "run-1", trigger: "manual" });
  assert.equal(r.status, "skipped");
  assert.equal(calls.length, 0);
  assert.equal(count(db, "source_checks"), 0);
});

test("Cron path: checks every refreshable source, is idempotent per scheduled time and publishes nothing", async () => {
  const db = await withTaitoRelease();
  const before = canonicalDump(db);
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async head(key: string) { return objects.has(key) ? { size: objects.get(key)!.byteLength } : null; },
    async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); return {}; },
  } as unknown as R2Bucket;
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    const res = new Response(RENAMED, { status: 200 });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as typeof fetch;
  const log = console.log;
  console.log = () => {};
  try {
    const controller = { scheduledTime: Date.parse("2026-09-28T03:00:00Z"), cron: "0 3 * * *", noRetry() {} };
    await scheduled(controller, { DB: db, RAW_ARTIFACTS: bucket });
    await scheduled(controller, { DB: db, RAW_ARTIFACTS: bucket });
    await assert.rejects(scheduled(controller, { DB: db }), /RAW_ARTIFACTS R2 binding is not configured/);
  } finally {
    globalThis.fetch = realFetch;
    console.log = log;
  }
  assert.deepEqual(calls, [TAITO_ORIGINAL_DATA_URL]);
  assert.equal(count(db, "source_checks"), 1);
  assert.equal((db.raw.prepare("SELECT check_key, trigger_kind FROM source_checks").get() as Record<string, string>).check_key,
    `cron:2026-09-28T03:00:00.000Z:${TAITO_SOURCE_ID}`);
  assert.equal(count(db, "source_refresh_candidates"), 1);
  assert.equal(canonicalDump(db), before, "the Cron path creates no release, spot, provenance, review item or tile");
});

test("runSourceChecks: a source that cannot be checked does not stop the others", async () => {
  const db = await withTaitoRelease();
  const broken = { ...TAITO_ADAPTER, registry: { ...TAITO_ADAPTER.registry, sourceId: "test-broken" }, refreshTarget: { url: "not a url" } };
  const results = await runSourceChecks(
    { db, store: memoryStore().store, fetch: fakeFetch(TAITO_BYTES).fetch, now, adapters: [broken, TAITO_ADAPTER] }, "run-1", "manual");
  assert.equal(results[0].result.status, "skipped");
  assert.equal(results[1].result.status, "recorded");
});

test("the refresh code cannot reach resolve, publish, removal, relocation or promotion", () => {
  const dir = new URL("../src/refresh/", import.meta.url);
  for (const file of readdirSync(dir)) {
    const src = readFileSync(new URL(file, dir), "utf8");
    for (const [, spec] of src.matchAll(/from "([^"]+)"/g)) {
      assert.ok(!/(ingest|observe|resolve|publish|promotion|removal|relocation|reviewed-match|review-queue|match)\.ts$/.test(spec),
        `${file} imports ${spec}`);
    }
  }
});

test("fresh migration: refresh tables exist, are append-only, and candidates must cite their check", async () => {
  const raw = migratedSqlite();
  for (const t of ["raw_artifacts", "source_checks", "source_refresh_candidates"]) {
    assert.equal((raw.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n, 0);
  }
  assert.equal(raw.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");

  const db = await withTaitoRelease();
  const r = await check(db, memoryStore().store, fakeFetch(RENAMED).fetch, "run-1");
  assert.throws(() => db.raw.prepare("UPDATE source_checks SET outcome = 'unchanged' WHERE check_id = ?").run(r.checkId), /append-only/);
  assert.throws(() => db.raw.prepare("DELETE FROM source_checks").run(), /append-only/);
  assert.throws(() => db.raw.prepare("UPDATE raw_artifacts SET byte_length = 0").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM raw_artifacts").run(), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM source_refresh_candidates").run(), /immutable/);
  assert.throws(() => db.raw.prepare("INSERT INTO raw_artifacts VALUES (?, 'raw/sha256/other', 1, ?)").run("a".repeat(64), NOW), /CHECK/);
  // A candidate for an unchanged check, or for another artifact than its check's, is refused.
  const unchanged = await check(db, memoryStore().store, fakeFetch(RENAMED).fetch, "run-2");
  assert.throws(() => db.raw.prepare(
    "INSERT INTO source_refresh_candidates (source_id, artifact_sha256, check_id, review_state, created_at) VALUES (?, ?, ?, 'changed', ?)",
  ).run(TAITO_SOURCE_ID, sha(RENAMED), unchanged.checkId, NOW), /must cite/);
  // A failed check can never be a baseline.
  const failed = await check(db, memoryStore().store, fakeFetch({ status: 500 }).fetch, "run-3");
  assert.throws(() => db.raw.prepare(
    `INSERT INTO source_checks (check_key, source_id, trigger_kind, policy_version, request_url, started_at, finished_at, outcome, failure_stage, baseline_check_id)
     VALUES ('x', ?, 'manual', 'p', 'u', ?, ?, 'failed', 'http', ?)`,
  ).run(TAITO_SOURCE_ID, NOW, NOW, failed.checkId), /baseline must be/);
});

// Blocker 2 (review of 79a0561): the body limit holds while streaming, whatever Content-Length says.
function endlessProducer(chunkBytes: number, maxChunks: number) {
  const state = { produced: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.produced >= maxChunks) return controller.close();
      state.produced++;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state };
}

for (const contentLength of [null, "1024"]) {
  test(`an oversized streamed body stops at the limit (Content-Length ${contentLength ?? "absent"})`, async () => {
    const db = await withTaitoRelease();
    const { store, puts } = memoryStore();
    const MiB = 1024 * 1024;
    const { stream, state } = endlessProducer(MiB, 64); // could produce 64 MiB
    const fetch: FetchLike = async (url) => {
      const res = new Response(stream, { status: 200, headers: contentLength ? { "Content-Length": contentLength } : {} });
      Object.defineProperty(res, "url", { value: url });
      return res;
    };
    const r = await check(db, store, fetch, "run-1");
    assert.equal(r.outcome, "failed");
    const row = checkRow(db, r.checkId);
    assert.equal(row.failure_stage, "tooLarge");
    assert.equal(row.content_sha256, null);
    assert.equal(row.artifact_sha256, null);
    assert.match(row.detail, /reading stopped/);
    // 16 MiB is 16 chunks; the 17th crosses the limit and reading stops there (a pull or two of lookahead at most).
    assert.ok(state.produced >= 17 && state.produced <= 19, `produced ${state.produced} chunks`);
    assert.ok(state.produced < 64, "the producer never generated the whole body");
    assert.equal(state.cancelled, true);
    assert.equal(puts.length, 0);
    assert.equal(count(db, "raw_artifacts"), 0);
    assert.equal(count(db, "source_refresh_candidates"), 0);
  });
}

test("a streamed body at the limit is read completely and checked as usual", async () => {
  const db = await withTaitoRelease();
  const chunks = [TAITO_BYTES.slice(0, 1000), TAITO_BYTES.slice(1000)];
  const fetch: FetchLike = async (url) => {
    const res = new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } }), { status: 200 });
    Object.defineProperty(res, "url", { value: url });
    return res;
  };
  const r = await check(db, memoryStore().store, fetch, "run-1");
  assert.equal(r.outcome, "unchanged");
  assert.equal(r.contentSha256, TAITO_FIXTURE_SHA256);
});

// Blocker 1 (review of 79a0561): a non-failed check must name its retained artifact in the schema itself.
test("a non-failed check row without an artifact is refused by the schema", async () => {
  const db = await withTaitoRelease();
  const insert = (outcome: string, findings: string) => db.raw.prepare(
    `INSERT INTO source_checks (check_key, source_id, trigger_kind, policy_version, request_url, started_at, finished_at,
       content_sha256, byte_length, artifact_sha256, outcome, findings_json)
     VALUES (?, ?, 'manual', 'p', 'u', ?, ?, ?, 7, NULL, ?, ?)`,
  ).run(`probe-${outcome}`, TAITO_SOURCE_ID, NOW, NOW, TAITO_FIXTURE_SHA256, outcome, findings);
  assert.throws(() => insert("unchanged", "[]"), /CHECK/);
  assert.throws(() => insert("changed", "[]"), /CHECK/);
  assert.throws(() => insert("needsReview", '[{"id":"x","detail":"y"}]'), /CHECK/);
  assert.equal(count(db, "source_checks"), 0);
  // The ordinary path still records a successful check with its artifact.
  const r = await check(db, memoryStore().store, fakeFetch(TAITO_BYTES).fetch, "run-1");
  assert.equal(r.outcome, "unchanged");
  assert.equal(checkRow(db, r.checkId).artifact_sha256, TAITO_FIXTURE_SHA256);
});
