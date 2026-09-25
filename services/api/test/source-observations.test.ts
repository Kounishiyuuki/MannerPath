import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { ensureReleaseObservations } from "../src/pipeline/observations.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import type { NormalizedSourceObservation, SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_SOURCE_ID } from "../src/pipeline/taito.ts";
import { NOW, TAITO_BYTES, TEST_BLOCKED_TAITO_ADAPTER, addBlockedTestSource, importTaito } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const normalized = (o: any) => ({
  name: o.name, latitude: o.latitude, longitude: o.longitude,
  supportsPaper: o.supportsPaper, supportsHeated: o.supportsHeated,
  openingHours: o.openingHours, lifecycle: o.lifecycle, publicationHold: o.publicationHold,
  provenance: o.provenance, attenuations: o.attenuations,
});

test("Taito raw records deterministically materialize 34 immutable normalized observations", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  const first = await ensureReleaseObservations(db, TAITO_ADAPTER, releaseId);
  assert.equal(first.length, 34);
  assert.ok(first.every((o) => o.mappingVersion === TAITO_ADAPTER.mappingVersion));
  assert.ok(first.some((o) => o.supportsPaper === "unknown" && o.supportsHeated === "unknown"));
  assert.ok(first.some((o) => o.supportsPaper === "no" && o.supportsHeated === "yes"));

  const rows = db.raw.prepare("SELECT record_id, raw_values_json FROM source_records WHERE release_id = ? ORDER BY ordinal")
    .all(releaseId) as { record_id: number; raw_values_json: string }[];
  for (let i = 0; i < rows.length; i++) {
    assert.deepEqual(normalized(first[i]), normalized(TAITO_ADAPTER.mapRecord(JSON.parse(rows[i].raw_values_json))));
    assert.equal(first[i].recordId, rows[i].record_id);
  }
  assert.deepEqual(await ensureReleaseObservations(db, TAITO_ADAPTER, releaseId), first);
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM source_observations").get()!.n, 34);
  assert.throws(() => db.raw.prepare("UPDATE source_observations SET name = 'x' WHERE observation_id = ?").run(first[0].observationId), /immutable/);
  assert.throws(() => db.raw.prepare("DELETE FROM source_observations WHERE observation_id = ?").run(first[0].observationId), /immutable/);
});

test("same mapping version cannot silently change normalized output", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await ensureReleaseObservations(db, TAITO_ADAPTER, releaseId);
  const drift: SourceAdapter = {
    ...TAITO_ADAPTER,
    mapRecord(values): NormalizedSourceObservation {
      const mapped = TAITO_ADAPTER.mapRecord(values);
      return { ...mapped, name: mapped.name === null ? "changed" : mapped.name + "!" };
    },
  };
  await assert.rejects(ensureReleaseObservations(db, drift, releaseId), /mapping drift.*bump mappingVersion/);
});

test("observation generation fails closed on adapter/source identity mismatch", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_SOURCE_ID, NOW);
  addBlockedTestSource(db);
  const { releaseId } = await ingestRelease(db, TEST_BLOCKED_TAITO_ADAPTER, TAITO_BYTES, TAITO_FIXTURE_RELEASE);
  await assert.rejects(ensureReleaseObservations(db, TAITO_ADAPTER, releaseId), /not to adapter source taito-public-smoking-areas/);
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM source_observations").get()!.n, 0);
});

test("resolver source no longer reads raw source schema directly", async () => {
  const source = readFileSync(new URL("../src/pipeline/resolve.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /raw_values_json/);
  assert.doesNotMatch(source, /resolveRecord/);
  const db = new SqliteD1();
  const { resolved } = await importTaito(db);
  assert.equal(resolved.status, "resolved");
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM source_observations").get()!.n, 34);
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM spots").get()!.n, 34);
});
