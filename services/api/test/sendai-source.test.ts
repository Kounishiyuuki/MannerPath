import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SENDAI_ADAPTER as A, SENDAI_AREA_ANCHOR as ANCHOR, SENDAI_FIXTURE_RELEASE as META,
  SENDAI_FIXTURE_SHA256, SENDAI_SOURCE_ID } from "../src/pipeline/sendai-adapter.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { recordAreaAnchor } from "../src/pipeline/area-anchor.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { app } from "../src/app.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
const NOW = "2026-10-11T00:00:00Z";
const BYTES = new Uint8Array(readFileSync(new URL("../../data-pipeline/fixtures/sendai-kaigan-park-smoking-areas/041009_public_facility.csv", import.meta.url)));
const target = () => A.parse(BYTES).rows.find((v) => v[1] === ANCHOR.originUpstreamRowRef)!;
const csv = (header: readonly string[], rows: readonly (readonly string[])[]) => new TextEncoder().encode([header, ...rows]
  .map((v) => v.map((s) => `"${s.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n");
async function ingest(db: SqliteD1, bytes = BYTES, meta = META) {
  await ensureReviewedSource(db, SENDAI_SOURCE_ID, NOW);
  return (await ingestRelease(db, A, bytes, meta)).releaseId;
}
test("Sendai selects only one immutable explicitly stated smoking amenity, never a host inference", () => {
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), SENDAI_FIXTURE_SHA256);
  const { rows } = A.parse(BYTES); assert.equal(rows.length, 2844);
  assert.deepEqual(rows.filter((v) => A.includesRecord!(v)).map((v) => v[1]), [ANCHOR.originUpstreamRowRef]);
  assert.equal(A.includesRecord!(rows.find((v) => v[1] !== ANCHOR.originUpstreamRowRef)!), false);
  for (const [column, value] of [[3, "別の公園"], [34, "喫煙所なし"], [34, "喫煙所閉鎖"], [34, "駐車場、トイレ有"], [18, "38.2"], [19, "140.9"], [0, "999999"]] as const) {
    const v = target(); v[column] = value; assert.throws(() => A.includesRecord!(v), /scope\/anchor/);
  }
});
test("Sendai strict schema, UTF8, missing/duplicate target fail closed", () => {
  const { header, rows } = A.parse(BYTES); const renamed = [...header]; renamed[18] = "latitude";
  assert.throws(() => A.parse(csv(renamed, rows)), /header/);
  assert.throws(() => A.parse(new Uint8Array([0xff])), /encoded data/);
  assert.throws(() => A.parse(csv(header, rows.slice(1))), /row count/);
  const duplicated = rows.map((r) => [...r]); duplicated[0] = target();
  assert.throws(() => A.parse(csv(header, duplicated)), /ambiguous/);
  const missing = rows.map((r) => [...r]); missing.find((v) => v[1] === ANCHOR.originUpstreamRowRef)![1] = "different";
  assert.throws(() => A.parse(csv(header, missing)), /missing target/);
});
test("Sendai never uses park hours as smoking hours; attributes and actual observation date stay unknown", () => {
  const v = target(); assert.deepEqual([v[31], v[32]], ["00:00", "23:59"]);
  const o = A.observe(v); assert.deepEqual(o.openingHours, { status: "none", raw: null, parsed: null });
  assert.equal(o.supportsPaper, "unknown"); assert.equal(o.supportsHeated, "unknown");
  assert.equal(o.classification!.accessType, "unknown"); assert.equal(o.classification!.environment, "unknown");
  assert.equal(o.locationAnchorId, ANCHOR.anchorId);
  assert.equal(A.crossReleaseValidated, false); assert.equal(A.completeness, "partial"); assert.equal(A.refreshTarget, undefined);
  assert.equal(META.observedOn, null);
});
test("Sendai missing anchor and changed release metadata reject before canonical writes", async () => {
  const db = new SqliteD1(); const id = await ingest(db);
  await assert.rejects(() => resolveFirstRelease(db, A, id, { now: NOW }), /not recorded/);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM spots").get()!.n, 0);
  for (const meta of [{ ...META, observedOn: "2026-04-01" }, { ...META, sourceUrl: "https://example.invalid/other.csv" }]) {
    const db2 = new SqliteD1(); const release = await ingest(db2, BYTES, meta);
    await assert.rejects(() => resolveFirstRelease(db2, A, release, { now: NOW }), /fingerprint/);
    assert.equal(db2.raw.prepare("SELECT count(*) n FROM spots").get()!.n, 0);
  }
  const observed = [A.observe(target())];
  assert.throws(() => A.assertResolvable({ contentSha256: "0".repeat(64), sourceUrl: META.sourceUrl, observedOn: null }, observed), /fingerprint/);
  assert.throws(() => A.assertResolvable({ contentSha256: SENDAI_FIXTURE_SHA256, sourceUrl: META.sourceUrl, observedOn: null }, []), /scope/);
});
test("Sendai local pipeline emits official areaApproximate detail and tiles, never exact or 24h", async () => {
  const db = new SqliteD1(); const id = await ingest(db); await recordAreaAnchor(db, A, ANCHOR, NOW);
  const result = await resolveFirstRelease(db, A, id, { now: NOW, newSpotId: sequentialSpotIds("7") }); assert.equal(result.status, "resolved");
  await publishTiles(db, { now: NOW });
  const spots = (await readPublishedTiles(db)).flatMap((t) => t.spots); assert.equal(spots.length, 1);
  const s = spots[0]; assert.equal(s.verification.existence, "official"); assert.equal(s.verification.locationPrecision, "areaApproximate");
  assert.deepEqual(s.verification.locationArea, { name: ANCHOR.areaName, kind: "park" });
  assert.equal(s.lastVerifiedAt, null);
  const response = await app.request(`/v1/spots/${s.id}`, {}, { DB: db }); assert.equal(response.status, 200);
  const body = await response.json() as { spot: typeof s }; assert.deepEqual(body.spot.verification, s.verification);
  const row = db.raw.prepare("SELECT * FROM spots").get()!; assert.equal(row.opening_hours_raw, null); assert.equal(row.opening_hours_status, "none");
  const anchor = db.raw.prepare("SELECT * FROM area_location_anchors").get()!;
  assert.equal(anchor.origin_release_content_sha256, SENDAI_FIXTURE_SHA256);
  assert.equal(JSON.parse(anchor.origin_record_values_json as string)[1], ANCHOR.originUpstreamRowRef);
});

test("Sendai changed raw release bytes and unapproved source cannot reach publication", async () => {
  const { header, rows } = A.parse(BYTES);
  // Changing an unrelated host field preserves reviewed scope but still invalidates this whole release.
  rows[0][4] += "変更";
  const db = new SqliteD1(); const id = await ingest(db, csv(header, rows));
  await assert.rejects(() => resolveFirstRelease(db, A, id, { now: NOW }), /fingerprint/);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM spots").get()!.n, 0);
  const blocked = new SqliteD1(); await ingest(blocked);
  blocked.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(SENDAI_SOURCE_ID);
  await assert.rejects(() => recordAreaAnchor(blocked, A, ANCHOR, NOW), /approved/);
});
