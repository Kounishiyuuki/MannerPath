// ADR-0018 municipal page-fact source (中央区 民間指定喫煙場所): existence and stated hours from the ward's current list,
// each pin the official address's ABR representative point (officialAddressGeocode). One spot per point, never exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import {
  CHUO_PRIVATE_ADAPTER, CHUO_PRIVATE_FIXTURE_RELEASE, CHUO_PRIVATE_FIXTURE_SHA256, CHUO_PRIVATE_SOURCE_ID,
} from "../src/pipeline/chuo-private-adapter.ts";
import { evaluateIntakeBatch, type IntakeBatch } from "../src/pipeline/bulk-intake.ts";
import { assertRightsBasis, ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { geocodesByRow } from "../scripts/bulk-intake.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const NOW = "2026-10-18T12:00:00Z";
const DIR = "../../data-pipeline/fixtures/chuo-private-smoking-places/";
const BYTES = new Uint8Array(readFileSync(new URL(`${DIR}chuo-private-page-facts.csv`, import.meta.url)));
const json = (f: string) => JSON.parse(readFileSync(new URL(DIR + f, import.meta.url), "utf8"));
// Rows the review keeps out of this release, with the reason (PROVENANCE.md).
const EXCLUDED: Record<string, string> = { 8: "suspended", 10: "suspended", 22: "suspended", 24: "suspended", 55: "suspended",
  31: "paperSuspended", 40: "addressRemainder", 58: "facilityClosed" };

test("every anchor is exactly the gate's result for the listing's official address in the pinned geocoder output", () => {
  assert.equal(createHash("sha256").update(BYTES).digest("hex"), CHUO_PRIVATE_FIXTURE_SHA256);
  const batch = json("listing-batch.json") as IntakeBatch;
  const triage = evaluateIntakeBatch(batch, geocodesByRow(batch, json("abrg-output.json")), [CHUO_PRIVATE_ADAPTER.registry]);
  assert.deepEqual([triage.rows, triage.decisions, triage.adoptableSpots], [59, { adoptable: 53, needsReview: 1, rejected: 5 }, 49]);
  const byListing = new Map(triage.results.map((r) => [r.id.replace(/^chuo-private:/, "").replace(/\.1$/, ""), r]));
  const { rows } = CHUO_PRIVATE_ADAPTER.parse(BYTES);
  assert.equal(rows.length, 47);
  const anchors = CHUO_PRIVATE_ADAPTER.reviewedAnchors!(CHUO_PRIVATE_FIXTURE_SHA256);
  for (const [i, a] of anchors.entries()) {
    const listing = String(Number(rows[i][0].slice(1)));
    assert.ok(!(listing in EXCLUDED), listing);
    const t = byListing.get(listing)!;
    assert.equal(t.decision, "adoptable", listing);
    assert.equal(t.sameAnchorGroup, t.id, `${listing} is the first listing at its point`);
    assert.deepEqual([a.latitude, a.longitude, a.anchorBasis!.reference], [t.anchor!.latitude, t.anchor!.longitude, t.anchor!.reference]);
    assert.deepEqual([a.areaScope, a.anchorBasis!.basis], ["facility", "officialAddressGeocode"]);
  }
  for (const [listing, why] of Object.entries(EXCLUDED)) assert.ok(why === "facilityClosed" || why === "paperSuspended" || byListing.get(listing)!.decision !== "adoptable", listing);
  assert.doesNotThrow(() => assertRightsBasis(CHUO_PRIVATE_ADAPTER.registry));
});

test("a changed, extra or missing row is refused", () => {
  const text = new TextDecoder().decode(BYTES);
  const changed = text.replace("午前6時から午後11時", "午前5時から午後11時");
  assert.notEqual(changed, text);
  assert.throws(() => CHUO_PRIVATE_ADAPTER.parse(new TextEncoder().encode(changed)), /not a reviewed fact row/);
  const lines = text.trimEnd().split("\n");
  assert.throws(() => CHUO_PRIVATE_ADAPTER.parse(new TextEncoder().encode(lines.slice(0, -1).join("\n") + "\n")), /unexpected fact sheet/);
  assert.throws(() => CHUO_PRIVATE_ADAPTER.parse(new TextEncoder().encode([...lines, lines[1]].join("\n") + "\n")), /unexpected fact sheet/);
});

test("47 places publish locally as official, facility-level areaApproximate spots with only the page's stated facts", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, CHUO_PRIVATE_SOURCE_ID, NOW);
  const { releaseId } = await ingestRelease(db, CHUO_PRIVATE_ADAPTER, BYTES, CHUO_PRIVATE_FIXTURE_RELEASE);
  assert.equal(await recordReviewedAnchors(db, CHUO_PRIVATE_ADAPTER, CHUO_PRIVATE_FIXTURE_SHA256, NOW), 47);
  const basis = db.raw.prepare("SELECT DISTINCT anchor_basis FROM area_location_anchors").all() as { anchor_basis: string }[];
  assert.deepEqual(basis.map((b) => b.anchor_basis), ["officialAddressGeocode"]);
  assert.equal((await resolveFirstRelease(db, CHUO_PRIVATE_ADAPTER, releaseId, { now: NOW, newSpotId: sequentialSpotIds("P") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  const spots = v1TileRows(db).flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
  assert.equal(spots.length, 47);
  for (const s of spots) {
    assert.deepEqual(s.sourceIds, [CHUO_PRIVATE_SOURCE_ID]);
    assert.equal(s.verification.locationPrecision, "areaApproximate");
    assert.deepEqual([s.verification.existence, s.verification.locationArea?.kind, s.verification.locationArea?.scope], ["official", "facility", "facility"]);
    assert.deepEqual([s.supportsPaper, s.supportsHeated, s.spotType, s.environment, s.accessType, s.hostType],
      ["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"], s.name);
    assert.equal(s.lastVerifiedAt, "2026-10-18");
  }
  const byName = new Map(spots.map((s) => [s.name, s]));
  assert.equal(spots.filter((s) => s.openingHours.status === "parsed").length, 0, "every stated range carries a qualifier");
  assert.equal(byName.get("THE TOBACCO YAESU")!.openingHours.raw, "午前7時から午後9時\n土曜日・日曜日・祝日・年末年始を除く");
  assert.ok(byName.has("八重洲地下街（サウステラス・イーストテラス・ノーステラスの3か所）"));
  for (const excluded of ["paspa京橋", "paspa西銀座", "ファミリーマート築地本願寺前店", "paspa八丁堀トレーラー", "東京消防庁臨港消防署", "paspa小舟町", "THE TOBACCO NIHOMBASHI MK-238", "晴海客船ターミナル"]) {
    assert.ok(!byName.has(excluded), excluded);
  }
});
