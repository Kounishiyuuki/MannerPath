// Batch triage (bulk-intake.v1): per-row adoptable / needsReview / rejected with reasons and counts, over the reviewed
// registry and the address-anchor gate. The abr-geocoder items follow `abrg -f json` 2.3.1 output shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADDRESS_ANCHOR_DATASET_RELEASE, abrJsonRun, buildingSuffix, evaluateAddressAnchor } from "../src/pipeline/address-anchor.ts";
import { type IntakeBatch, type IntakeRow, evaluateIntakeBatch } from "../src/pipeline/bulk-intake.ts";
import type { ReviewedSource } from "../src/pipeline/registry.ts";
import { geocoderInput, geocodesByRow } from "../scripts/bulk-intake.ts";

const abr = (input: string, output: string, others: string[], level: string, lat: number, lon: number, score = 0.9) => ({
  query: { input }, result: { output, others, score, match_level: level, coordinate_level: level, lat, lon,
    lg_code: "131024", pref: "東京都", city: "中央区", ward: null } });
const run = (item: ReturnType<typeof abr>) => abrJsonRun(item, "2.3.1", ADDRESS_ANCHOR_DATASET_RELEASE);
const anchorOf = (item: ReturnType<typeof abr>) => evaluateAddressAnchor({ officialAddress: item.query.input,
  expectedPrefecture: "東京都", expectedMunicipality: "中央区", geocode: run(item) });

const FLOOR = abr("東京都中央区銀座6丁目9番5号 7階", "東京都中央区銀座6丁目9-5 7階", ["7階"], "residential_detail", 35.6702, 139.7639);
const BUILDING = abr("東京都中央区京橋1丁目14番6号 ガーデニアビル2階", "東京都中央区京橋1丁目14-6 ガーデニアビル2階", ["ガーデニアビル2階"], "residential_detail", 35.6776, 139.7703);
const LOT_LEFT = abr("東京都中央区銀座5丁目14-28 ニキビル1階", "東京都中央区銀座5丁目14", ["-28 ニキビル1階"], "residential_block", 35.668, 139.766);
const PARK = abr("東京都中央区明石町8-1都立公園A地区", "東京都中央区明石町8-1 都立公園A地区", ["都立公園A地区"], "residential_detail", 35.666, 139.778);
const SAKI = abr("東京都中央区銀座1丁目2番先", "東京都中央区銀座1丁目2 先", ["先"], "residential_block", 35.674, 139.767, 0.94);
const PLAIN = abr("東京都中央区京橋1丁目2番1号", "東京都中央区京橋1丁目2-1", [], "residential_detail", 35.6792, 139.7702, 0.87);

test("a trailing building name or floor on a residential_detail lot is split off; the lot point stays approximate", () => {
  for (const [item, suffix] of [[FLOOR, "7階"], [BUILDING, "ガーデニアビル2階"]] as const) {
    assert.equal(buildingSuffix(item.query.input, run(item)), suffix);
    const r = anchorOf(item);
    assert.equal(r.status, "anchor", JSON.stringify(r));
    if (r.status !== "anchor") continue;
    assert.deepEqual([r.latitude, r.longitude], [item.result.lat, item.result.lon]);
    assert.match(r.reference, new RegExp(`入力=${item.query.input.slice(0, -suffix.length).trimEnd()} 出力=.+ 除外=${suffix}$`));
  }
});

test("never split: a lot number left in the remainder, an area remainder, 番先 or several places", () => {
  assert.equal(buildingSuffix(LOT_LEFT.query.input, run(LOT_LEFT)), null);
  assert.equal(buildingSuffix(PARK.query.input, run(PARK)), null);
  const reasons = (item: ReturnType<typeof abr>) => { const r = anchorOf(item); return r.status === "reviewPending" ? r.reasons : ["ANCHOR"]; };
  assert.ok(reasons(LOT_LEFT).includes("unmatchedRemainder"));
  assert.ok(reasons(PARK).includes("unmatchedRemainder"));
  assert.deepEqual(reasons(SAKI), ["ambiguousLocationWording"]);
  for (const wording of ["東京都中央区銀座1-1他", "東京都中央区2か所", "東京都中央区銀座1-2付近", "東京都中央区銀座1丁目2番地先"]) {
    const item = abr(wording, wording, [], "residential_detail", 35.67, 139.76, 1);
    assert.deepEqual(reasons(item), ["ambiguousLocationWording"], wording);
  }
  // A geocoder input that is not the official address is never split into a match.
  assert.equal(buildingSuffix("東京都中央区銀座6丁目9番5号 8階", run(FLOOR)), null);
});

const SOURCE: ReviewedSource = { sourceId: "test-ward", displayName: "テスト区", kind: "municipal", licenseName: "CC BY 4.0",
  licenseUrl: "https://example.org/l", attributionText: "出典: テスト区", publicationStatus: "approved" };
const row = (id: string, address: string | null, extra: Partial<IntakeRow> = {}): IntakeRow => ({ id, name: `場所${id}`,
  officialAddress: address, prefecture: "東京都", municipality: "中央区", operation: "listed", sourceUrl: "https://example.org/list", ...extra });

test("a batch is triaged per row with reasons and counts; shared points count once", () => {
  const batch: IntakeBatch = { sourceId: "test-ward", checkedAt: "2026-10-18", rows: [
    row("a", PLAIN.query.input),
    row("b", FLOOR.query.input),
    row("c", FLOOR.query.input, { name: "同じビルの別フロア" }),
    row("d", SAKI.query.input),
    row("e", null),
    row("f", PLAIN.query.input, { operation: "suspended", name: "休止中" }),
    row("g", PLAIN.query.input, { operation: "unknown", name: "不明" }),
    row("h", FLOOR.query.input, { name: "場所b" }),
    row("i", PLAIN.query.input, { name: "無出典", sourceUrl: "" }),
  ] };
  assert.equal(geocoderInput(batch).split("\n").filter(Boolean).length, 8);
  const abrOut = [PLAIN, FLOOR, FLOOR, SAKI, PLAIN, PLAIN, FLOOR, PLAIN];
  const s = evaluateIntakeBatch(batch, geocodesByRow(batch, abrOut), [SOURCE]);
  const by = new Map(s.results.map((r) => [r.id, r]));
  assert.deepEqual(s.decisions, { adoptable: 3, needsReview: 3, rejected: 3 });
  assert.equal(s.adoptableSpots, 2, "b and c share the lot point: one spot");
  assert.equal(by.get("c")!.sameAnchorGroup, "b");
  for (const r of s.results) if (r.anchor) assert.equal(r.locationPrecision, "areaApproximate");
  assert.deepEqual(by.get("d")!.reasons, ["address:ambiguousLocationWording"]);
  assert.equal(by.get("d")!.anchor, null);
  assert.deepEqual(by.get("e")!.reasons, ["address:officialAddressMissing"]);
  assert.deepEqual([by.get("f")!.decision, by.get("f")!.reasons], ["rejected", ["operation:suspended"]]);
  assert.deepEqual([by.get("g")!.decision, by.get("g")!.reasons], ["needsReview", ["operationUnknown"]]);
  assert.deepEqual([by.get("h")!.decision, by.get("h")!.reasons], ["rejected", ["duplicateListing"]]);
  assert.deepEqual(by.get("i")!.reasons, ["sourceUrlMissing"]);
  assert.equal(s.reasons["address:ambiguousLocationWording"], 1);
});

test("source rights and publication come only from the reviewed registry", () => {
  const batch = (sourceId: string): IntakeBatch => ({ sourceId, checkedAt: "2026-10-18", rows: [row("a", PLAIN.query.input)] });
  const geocodes = geocodesByRow(batch("x"), [PLAIN]);
  assert.deepEqual(evaluateIntakeBatch(batch("unlisted"), geocodes, [SOURCE]).results[0].reasons, ["sourceNotReviewed"]);
  const blocked = evaluateIntakeBatch(batch("test-ward"), geocodes, [{ ...SOURCE, publicationStatus: "blocked" }]).results[0];
  assert.deepEqual([blocked.decision, blocked.reasons], ["rejected", ["sourceBlocked"]]);
  const osm = evaluateIntakeBatch(batch("test-ward"), geocodes, [{ ...SOURCE, kind: "osm" }]).results[0];
  assert.deepEqual([osm.decision, osm.reasons], ["rejected", ["notOfficialSource"]]);
  // The default registry has no such source: a batch can never approve itself.
  assert.equal(evaluateIntakeBatch(batch("test-ward"), geocodes).results[0].decision, "needsReview");
});

test("geocoder output is paired by order and any misalignment is refused", () => {
  const b: IntakeBatch = { sourceId: "test-ward", checkedAt: "2026-10-18", rows: [row("a", PLAIN.query.input), row("b", null), row("c", FLOOR.query.input)] };
  assert.equal(geocodesByRow(b, [PLAIN, FLOOR]).size, 2);
  assert.throws(() => geocodesByRow(b, [FLOOR, PLAIN]), /is not its official address/);
  assert.throws(() => geocodesByRow(b, [PLAIN]), /2 addressed rows but 1/);
  assert.throws(() => geocoderInput({ ...b, rows: [row("x", "東京都中央区\n銀座")] }), /spans lines/);
});
