// System refresh + Data mixed-dataset integration. Refresh targets below are test-only;
// the reviewed Osaka, Koto and Minato adapters deliberately have no automated refresh approval.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MUSASHINO_ADAPTER, MUSASHINO_SOURCE_ID } from "../src/pipeline/musashino-adapter.ts";
import { MINATO_ADAPTER, MINATO_SOURCE_ID } from "../src/pipeline/minato-adapter.ts";
import { KOTO_ADAPTER, KOTO_SOURCE_ID } from "../src/pipeline/koto-adapter.ts";
import { KYOTO_ADAPTER, KYOTO_SOURCE_ID } from "../src/pipeline/kyoto-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_DATA_URL, OSAKA_SOURCE_ID } from "../src/pipeline/osaka-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { checkSource } from "../src/refresh/check.ts";
import { runSourceChecks } from "../src/refresh/scheduled.ts";
import { type RawArtifactStore, rawArtifactKey } from "../src/refresh/artifact-store.ts";
import { NOW, TAITO_BYTES, importTaito } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const OSAKA_BYTES = new Uint8Array(readFileSync(new URL(
  "../../data-pipeline/fixtures/osaka-designated-smoking-areas/opendata_1012.csv", import.meta.url,
)));
const now = () => new Date(NOW);
const count = (db: SqliteD1, table: string) =>
  (db.raw.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
function memoryStore() {
  const objects = new Map<string, Uint8Array>();
  const store: RawArtifactStore = {
    async head(key) { return objects.has(key) ? { byteLength: objects.get(key)!.byteLength } : null; },
    async put(key, bytes) { objects.set(key, bytes.slice()); },
  };
  return { store, objects };
}
const fetchOsaka = async () => new Response(OSAKA_BYTES);

test("scheduled registry checks Taito but skips five sources without refresh targets or fetches", async () => {
  const db = new SqliteD1();
  await importTaito(db);
  await ensureReviewedSource(db, OSAKA_SOURCE_ID, NOW);
  await ensureReviewedSource(db, KOTO_SOURCE_ID, NOW);
  await ensureReviewedSource(db, MUSASHINO_SOURCE_ID, NOW);
  await ensureReviewedSource(db, MINATO_SOURCE_ID, NOW);
  await ensureReviewedSource(db, KYOTO_SOURCE_ID, NOW);
  assert.equal(OSAKA_ADAPTER.refreshTarget, undefined);
  assert.equal(KOTO_ADAPTER.refreshTarget, undefined);
  assert.equal(MUSASHINO_ADAPTER.refreshTarget, undefined);
  assert.equal(MINATO_ADAPTER.refreshTarget, undefined);
  assert.equal(KYOTO_ADAPTER.refreshTarget, undefined);
  let fetches = 0;
  const results = await runSourceChecks({ db, store: memoryStore().store, now,
    fetch: async () => { fetches++; return new Response(TAITO_BYTES); },
  }, "scope-scheduled", "scheduled");
  assert.equal(results.length, 6);
  assert.equal(results[0].result.status === "recorded" && results[0].result.outcome, "unchanged");
  assert.deepEqual(results[1], { sourceId: OSAKA_SOURCE_ID,
    result: { status: "skipped", reason: `${OSAKA_SOURCE_ID} has no refresh target` },
  });
  assert.deepEqual(results[2], { sourceId: KOTO_SOURCE_ID,
    result: { status: "skipped", reason: `${KOTO_SOURCE_ID} has no refresh target` },
  });
  assert.deepEqual(results[3], { sourceId: MUSASHINO_SOURCE_ID,
    result: { status: "skipped", reason: `${MUSASHINO_SOURCE_ID} has no refresh target` },
  });
  assert.deepEqual(results[4], { sourceId: MINATO_SOURCE_ID,
    result: { status: "skipped", reason: `${MINATO_SOURCE_ID} has no refresh target` },
  });
  assert.deepEqual(results[5], { sourceId: KYOTO_SOURCE_ID,
    result: { status: "skipped", reason: `${KYOTO_SOURCE_ID} has no refresh target` },
  });
  assert.equal(fetches, 1);
  assert.equal(count(db, "source_checks"), 1);
  assert.equal(count(db, "source_refresh_candidates"), 0);
});

test("mixed refresh probes all 524 raw rows but maps only 344 in-scope rows, retaining every byte", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, OSAKA_SOURCE_ID, NOW);
  const { store, objects } = memoryStore();
  let scoped = 0;
  let observed = 0;
  const result = await checkSource({ db, store, now, fetch: fetchOsaka }, {
    ...OSAKA_ADAPTER, refreshTarget: { url: OSAKA_DATA_URL },
    includesRecord(values) { scoped++; return OSAKA_ADAPTER.includesRecord!(values); },
    observe(values) { observed++; return OSAKA_ADAPTER.observe(values); },
  }, { runKey: "scope-mixed", trigger: "manual" });
  assert.equal(result.status, "recorded");
  if (result.status !== "recorded") throw new Error("check was not recorded");
  assert.equal(result.outcome, "changed");
  assert.ok(result.candidateId);
  assert.equal(scoped, 524);
  assert.equal(observed, 344);
  const row = db.raw.prepare("SELECT record_count, findings_json FROM source_checks WHERE check_id = ?")
    .get(result.checkId)!;
  assert.equal(row.record_count, 524);
  assert.equal(row.findings_json, "[]");
  assert.deepEqual(objects.get(rawArtifactKey(result.contentSha256!)), OSAKA_BYTES);
  for (const table of ["source_releases", "source_records", "source_observations", "spots", "tile_snapshots"]) {
    assert.equal(count(db, table), 0, `a refresh must not write ${table}`);
  }
});

test("a throwing mixed-dataset scope predicate is drift, even on an otherwise excluded row", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, OSAKA_SOURCE_ID, NOW);
  let threw = false;
  const result = await checkSource({ db, store: memoryStore().store, now, fetch: fetchOsaka }, {
    ...OSAKA_ADAPTER, refreshTarget: { url: OSAKA_DATA_URL },
    includesRecord(values) {
      const included = OSAKA_ADAPTER.includesRecord!(values);
      if (!included && !threw) { threw = true; throw new Error("scope classification drift"); }
      return included;
    },
  }, { runKey: "scope-error", trigger: "manual" });
  assert.equal(result.status, "recorded");
  if (result.status !== "recorded") throw new Error("check was not recorded");
  assert.equal(result.outcome, "needsReview");
  const row = db.raw.prepare("SELECT record_count, findings_json FROM source_checks WHERE check_id = ?")
    .get(result.checkId)!;
  assert.equal(row.record_count, 524);
  const findings = JSON.parse(row.findings_json as string);
  assert.deepEqual(findings.map((f: { id: string }) => f.id), ["recordsUnobservable"]);
  assert.match(findings[0].detail, /^1 record\(s\)/);
  assert.equal((db.raw.prepare("SELECT review_state FROM source_refresh_candidates").get()!).review_state, "needsReview");
  assert.equal(count(db, "source_observations"), 0);
  assert.equal(count(db, "spots"), 0);
});
