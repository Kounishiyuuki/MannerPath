// ADR-0018 D-A sources 4–5: an official-address geocode as an approximate facility anchor. The abr-geocoder outputs below
// are verbatim results of `abrg -f json` 2.3.1 over the pinned dataset release (2026-10-18).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADDRESS_ANCHOR_DATASET_RELEASE, ADDRESS_ANCHOR_DATASET_RELEASES, type AddressAnchorDatasetRelease, abrJsonRun,
  addressAnchorDatasetRelease, canonicalAddress, completeOfficialAddress, evaluateAddressAnchor,
} from "../src/pipeline/address-anchor.ts";
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation, recordReviewedAnchors } from "../src/pipeline/area-anchor.ts";
import { parseCsv } from "../src/pipeline/csv.ts";
import { evaluateDerivedCoordinate } from "../src/pipeline/derived-coordinate.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { candidateAddresses, evaluateCandidates } from "../scripts/address-anchor-candidates.ts";
import { datasetManifest, verifyDatasetDir, verifyRegisteredDatasetDir } from "../scripts/address-anchor-dataset.ts";
import { CHIYODA_ADAPTER, CHIYODA_FIXTURE_SHA256 } from "../src/pipeline/chiyoda-adapter.ts";
import { SHIBUYA_ADAPTER, SHIBUYA_FIXTURE_SHA256 } from "../src/pipeline/shibuya-adapter.ts";
import { TOSHIMA_ADAPTER, TOSHIMA_FIXTURE_SHA256 } from "../src/pipeline/toshima-adapter.ts";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/db.ts";
import { sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { v1TileRows } from "./support/tiles.ts";

const KYOBASHI = { query: { input: "東京都中央区京橋1丁目2番1号" }, result: { output: "東京都中央区京橋1丁目2-1", others: [], score: 0.87,
  match_level: "residential_detail", coordinate_level: "residential_detail", lat: 35.679262662, lon: 139.770217411, lg_code: "131024",
  pref: "東京都", city: "中央区", ward: null } };
const DOGENZAKA = { query: { input: "東京都渋谷区道玄坂1-2-3" }, result: { output: "東京都渋谷区道玄坂1丁目2-3", others: [], score: 0.87,
  match_level: "residential_detail", coordinate_level: "residential_detail", lat: 35.658, lon: 139.699, lg_code: "131130",
  pref: "東京都", city: "渋谷区", ward: null } };
const SAKI = { query: { input: "東京都豊島区南池袋1丁目29番先" }, result: { output: "東京都豊島区南池袋1丁目29 先", others: ["先"], score: 0.94,
  match_level: "residential_block", coordinate_level: "residential_block", lat: 35.73, lon: 139.71, lg_code: "131164",
  pref: "東京都", city: "豊島区", ward: null } };
const FLOOR = { query: { input: "東京都中央区銀座6丁目9番5号 7階" }, result: { output: "東京都中央区銀座6丁目9-5 7階", others: ["7階"], score: 0.9,
  match_level: "residential_detail", coordinate_level: "residential_detail", lat: 35.67, lon: 139.76, lg_code: "131024",
  pref: "東京都", city: "中央区", ward: null } };
const TOWN = { query: { input: "東京都千代田区丸の内" }, result: { output: "東京都千代田区丸の内", others: [], score: 1,
  match_level: "machiaza", coordinate_level: "city", lat: 35.69, lon: 139.75, lg_code: "131016", pref: "東京都", city: "千代田区", ward: null } };

const run = (item: unknown, release = ADDRESS_ANCHOR_DATASET_RELEASE, version = "2.3.1") => abrJsonRun(item, version, release);
const evaluate = (item: typeof KYOBASHI, municipality: string, overrides: Partial<ReturnType<typeof run>> = {}) =>
  evaluateAddressAnchor({ officialAddress: item.query.input, expectedPrefecture: "東京都", expectedMunicipality: municipality, geocode: { ...run(item), ...overrides } });

test("the only notation rule: 丁目 numerals, 番/号 and hyphen spellings of one lot compare equal; remainders never do", () => {
  assert.equal(canonicalAddress("東京都中央区京橋1丁目2番1号"), canonicalAddress("東京都中央区京橋一丁目2-1"));
  assert.equal(canonicalAddress("東京都渋谷区渋谷1-23-21"), canonicalAddress("東京都渋谷区渋谷1丁目23-21"));
  assert.equal(canonicalAddress("東京都中央区銀座5丁目12番"), canonicalAddress("東京都中央区銀座5丁目12"));
  for (const [a, b] of [["南池袋1丁目29番先", "南池袋1丁目29"], ["銀座6丁目9番5号 7階", "銀座6丁目9-5"], ["京橋1丁目2番1号", "京橋1丁目2-2"]]) {
    assert.notEqual(canonicalAddress(a), canonicalAddress(b), `${a} ≠ ${b}`);
  }
});

test("a verbatim official address at residential precision becomes an approximate anchor naming geocoder, dataset and input", () => {
  for (const [item, ward] of [[KYOBASHI, "中央区"], [DOGENZAKA, "渋谷区"]] as const) {
    const r = evaluate(item, ward);
    assert.equal(r.status, "anchor", JSON.stringify(r));
    if (r.status !== "anchor") continue;
    assert.deepEqual([r.latitude, r.longitude], [item.result.lat, item.result.lon]);
    assert.equal(r.reference, `abr-geocoder 2.3.1 ${ADDRESS_ANCHOR_DATASET_RELEASE} residential_detail 入力=${item.query.input} 出力=${item.result.output}`);
    assert.ok(r.reference.length <= 500, "fits area_location_anchors.anchor_reference");
  }
});

test("anything else is reviewPending with reasons, never a guessed point", () => {
  const pending = (r: ReturnType<typeof evaluateAddressAnchor>) => (r.status === "reviewPending" ? r.reasons : ["ANCHOR"]);
  assert.deepEqual(pending(evaluateAddressAnchor({ officialAddress: null, expectedPrefecture: "東京都", expectedMunicipality: "中央区", geocode: null })), ["officialAddressMissing"]);
  assert.deepEqual(pending(evaluateAddressAnchor({ officialAddress: "  ", expectedPrefecture: "東京都", expectedMunicipality: "中央区", geocode: run(KYOBASHI) })), ["officialAddressMissing"]);
  assert.deepEqual(pending(evaluateAddressAnchor({ officialAddress: KYOBASHI.query.input, expectedPrefecture: "東京都", expectedMunicipality: "中央区", geocode: null })), ["noGeocodeResult"]);
  // 「先」, a floor or a building name is an unmatched remainder: the point would be a guess about what was dropped.
  assert.deepEqual(pending(evaluate(SAKI, "豊島区")), ["ambiguousLocationWording"], "a 番先 frontage is never a point");
  // A floor whose lot sits only at block level is not split (bulk-intake.test.ts covers the reviewed split).
  assert.ok(pending(evaluate(FLOOR, "中央区", { matchLevel: "residential_block", coordinateLevel: "residential_block" })).includes("unmatchedRemainder"));
  // A town or city point is not a facility.
  assert.ok(pending(evaluate(TOWN, "千代田区")).includes("precisionTooLow"));
  assert.ok(pending(evaluate(KYOBASHI, "中央区", { coordinateLevel: "parcel", matchLevel: "parcel" })).includes("precisionTooLow"));
  assert.ok(pending(evaluate(KYOBASHI, "渋谷区")).includes("jurisdictionMismatch"));
  assert.ok(pending(evaluate(KYOBASHI, "中央区", { input: "東京都中央区京橋1-2-1" })).includes("verbatimInputMismatch"));
  assert.ok(pending(evaluate(KYOBASHI, "中央区", { output: "東京都中央区京橋1丁目2-2" })).includes("normalizationChangedMeaning"));
  assert.ok(pending(evaluate(KYOBASHI, "中央区", { options: { target: "all", fuzzy: "?" } })).includes("fuzzyMatching"));
  assert.ok(pending(evaluateAddressAnchor({ officialAddress: KYOBASHI.query.input, expectedPrefecture: "東京都", expectedMunicipality: "中央区",
    geocode: run(KYOBASHI, "abr-other-release") })).includes("datasetReleaseNotPinned"));
  assert.ok(pending(evaluateAddressAnchor({ officialAddress: KYOBASHI.query.input, expectedPrefecture: "東京都", expectedMunicipality: "中央区",
    geocode: run(KYOBASHI, ADDRESS_ANCHOR_DATASET_RELEASE, "3.0.0") })).includes("geocoderVersionNotReviewed"));
});

test("ADR-0011's derived-coordinate lane is unchanged: no dataset is pinned there, so the same run still fails closed", () => {
  const evaluation = evaluateDerivedCoordinate({
    source: { sourceId: "s", publicationStatus: "approved", existenceEvidence: "officialSmokingPlace", currentOperation: "confirmed", addressReuse: "reviewed" },
    record: { recordId: 1, addressColumn: "a", officialAddress: KYOBASHI.query.input, addressSuppliedBy: "publisher", inputRule: "verbatim",
      expectedPrefecture: "東京都", expectedMunicipality: "中央区" },
    geocode: run(KYOBASHI),
  });
  assert.ok(evaluation.rejections.includes("datasetReleaseNotPinned"));
  assert.equal(evaluation.publishable, false);
});

test("the candidate script pairs geocoder results with candidates in order and refuses a misaligned file", () => {
  const candidates = [
    { id: "a", officialAddress: "京橋1丁目2番1号", prefecture: "東京都", municipality: "中央区" },
    { id: "b", officialAddress: null, prefecture: "東京都", municipality: "中央区" },
    { id: "c", officialAddress: SAKI.query.input, prefecture: "東京都", municipality: "豊島区" },
    { id: "d", officialAddress: "千代田区丸の内1-1", prefecture: "東京都", municipality: "中央区" },
  ];
  assert.equal(candidateAddresses(candidates), `${KYOBASHI.query.input}\n${SAKI.query.input}\n`);
  const R = ADDRESS_ANCHOR_DATASET_RELEASE;
  assert.deepEqual(evaluateCandidates(candidates, [KYOBASHI, SAKI], R).map((r) => [r.id, r.status]),
    [["a", "anchor"], ["b", "reviewPending"], ["c", "reviewPending"], ["d", "reviewPending"]]);
  assert.deepEqual(evaluateCandidates(candidates, [KYOBASHI, SAKI], R)[3], { id: "d", status: "reviewPending", reasons: ["outsideSourceScope"] });
  assert.throws(() => evaluateCandidates(candidates, [SAKI, KYOBASHI], R), /is not its official address/);
  assert.throws(() => evaluateCandidates(candidates, [KYOBASHI, SAKI, FLOOR], R), /have no candidate/);
  // A release id that the dataset check did not return is not pinned: everything stays pending.
  assert.equal(evaluateCandidates(candidates, [KYOBASHI, SAKI], "abr-unverified").filter((r) => r.status === "anchor").length, 0);
});

test("F3: only the source's own prefecture and municipality may be prefixed to an address cell", () => {
  const chuo = { prefecture: "東京都", municipality: "中央区" };
  assert.deepEqual(completeOfficialAddress("東京都中央区京橋1丁目2番1号", chuo), { address: "東京都中央区京橋1丁目2番1号", completed: "none" });
  assert.deepEqual(completeOfficialAddress("中央区京橋1丁目2番1号", chuo), { address: "東京都中央区京橋1丁目2番1号", completed: "prefecture" });
  assert.deepEqual(completeOfficialAddress(" 京橋1丁目2番1号 ", chuo), { address: "東京都中央区京橋1丁目2番1号", completed: "prefectureAndMunicipality" });
  // A town name ending in 町 is not a municipality: 日本橋小伝馬町 is completed as 中央区.
  assert.equal(completeOfficialAddress("日本橋小伝馬町15番18号", chuo)?.address, "東京都中央区日本橋小伝馬町15番18号");
  for (const outside of ["東京都千代田区丸の内1-1", "千代田区丸の内1-1", "港区新橋1-1", "神奈川県川崎市1-1", "大阪府大阪市北区1-1", ""]) {
    assert.equal(completeOfficialAddress(outside, chuo), null, outside);
  }
});

test("F1: the dataset directory must reproduce the pinned release digest from its own zip files", () => {
  const dir = mkdtempSync(join(tmpdir(), "abr-"));
  mkdirSync(join(dir, "download"));
  const files = [{ name: "b.csv.zip", bytes: new Uint8Array([2]) }, { name: "a.csv.zip", bytes: new Uint8Array([1]) }];
  for (const f of files) writeFileSync(join(dir, "download", f.name), f.bytes);
  const manifest = datasetManifest(files);
  assert.match(manifest, /^[0-9a-f]{64} {2}a\.csv\.zip\n[0-9a-f]{64} {2}b\.csv\.zip\n$/, "shasum -a 256 *.zip format, sorted");
  const pinned = `abr-test:sha256:${createHash("sha256").update(manifest).digest("hex")}`;
  assert.equal(verifyDatasetDir(dir, pinned), pinned);
  writeFileSync(join(dir, "download", "b.csv.zip"), new Uint8Array([3]));
  assert.throws(() => verifyDatasetDir(dir, pinned), /is not the pinned release/);
  writeFileSync(join(dir, "download", "b.csv.zip"), new Uint8Array([2]));
  writeFileSync(join(dir, "download", "c.csv.zip"), new Uint8Array([4]));
  assert.throws(() => verifyDatasetDir(dir, pinned), /is not the pinned release/, "an extra file changes the digest");
  assert.throws(() => verifyDatasetDir(dir, "abr-test-without-digest"), /carries no digest/);
  assert.throws(() => verifyDatasetDir(mkdtempSync(join(tmpdir(), "abr-")), pinned));
});

// Several reviewed ABR releases side by side (append-only registry). TEST ONLY second release: a synthetic digest for
// 世田谷区 (131121); no such download is registered in the repository.
const SETAGAYA_TEST: AddressAnchorDatasetRelease = { releaseId: `abr-test-setagaya:sha256:${"cd".repeat(32)}`, fileCount: 2, lgCodes: ["131121"] };
const BOTH = [...ADDRESS_ANCHOR_DATASET_RELEASES, SETAGAYA_TEST];
const SANGENJAYA = { query: { input: "東京都世田谷区太子堂4丁目20番10号" }, result: { output: "東京都世田谷区太子堂4丁目20-10", others: [], score: 0.87,
  match_level: "residential_detail", coordinate_level: "residential_detail", lat: 35.643, lon: 139.669, lg_code: "131121",
  pref: "東京都", city: "世田谷区", ward: null } };
const gate = (item: typeof KYOBASHI, municipality: string, release: string, releases: readonly AddressAnchorDatasetRelease[], lgCode?: string | null) =>
  evaluateAddressAnchor({ officialAddress: item.query.input, expectedPrefecture: "東京都", expectedMunicipality: municipality,
    geocode: { ...run(item, release), ...(lgCode === undefined ? {} : { lgCode }) } }, releases);

test("registry: release ids are unique, carry a digest, and the first release is the one existing anchors name", () => {
  assert.equal(ADDRESS_ANCHOR_DATASET_RELEASES[0].releaseId, ADDRESS_ANCHOR_DATASET_RELEASE);
  assert.equal(new Set(ADDRESS_ANCHOR_DATASET_RELEASES.map((r) => r.releaseId)).size, ADDRESS_ANCHOR_DATASET_RELEASES.length);
  for (const r of ADDRESS_ANCHOR_DATASET_RELEASES) assert.match(r.releaseId, /:sha256:[0-9a-f]{64}$/);
  assert.equal(addressAnchorDatasetRelease(ADDRESS_ANCHOR_DATASET_RELEASE).fileCount, 27);
  assert.throws(() => addressAnchorDatasetRelease(SETAGAYA_TEST.releaseId), /is not a registered ABR dataset release/);
  assert.throws(() => addressAnchorDatasetRelease(SETAGAYA_TEST.releaseId, [SETAGAYA_TEST, SETAGAYA_TEST]), /not a registered/, "a duplicate id is ambiguous");
});

test("old and new releases in one environment: each answers only under its own id and for its own municipalities", () => {
  // The existing release keeps giving the same anchor, with or without a second release registered.
  const before = gate(KYOBASHI, "中央区", ADDRESS_ANCHOR_DATASET_RELEASE, ADDRESS_ANCHOR_DATASET_RELEASES);
  assert.equal(before.status, "anchor");
  assert.deepEqual(gate(KYOBASHI, "中央区", ADDRESS_ANCHOR_DATASET_RELEASE, BOTH), before);
  const setagaya = gate(SANGENJAYA, "世田谷区", SETAGAYA_TEST.releaseId, BOTH);
  assert.equal(setagaya.status, "anchor", JSON.stringify(setagaya));
  if (setagaya.status === "anchor") assert.ok(setagaya.reference.startsWith(`abr-geocoder 2.3.1 ${SETAGAYA_TEST.releaseId} residential_detail`));
  // Unregistered release: the default registry does not know the second release.
  assert.deepEqual(gate(SANGENJAYA, "世田谷区", SETAGAYA_TEST.releaseId, ADDRESS_ANCHOR_DATASET_RELEASES),
    { status: "reviewPending", reasons: ["datasetReleaseNotPinned"] });
  // Mixed releases: a run labelled with the other release is outside that release's municipalities.
  assert.deepEqual(gate(SANGENJAYA, "世田谷区", ADDRESS_ANCHOR_DATASET_RELEASE, BOTH), { status: "reviewPending", reasons: ["datasetReleaseOutOfScope"] });
  assert.deepEqual(gate(KYOBASHI, "中央区", SETAGAYA_TEST.releaseId, BOTH), { status: "reviewPending", reasons: ["datasetReleaseOutOfScope"] });
  // A run without lg_code is never in any release's scope.
  assert.deepEqual(gate(KYOBASHI, "中央区", ADDRESS_ANCHOR_DATASET_RELEASE, BOTH, null), { status: "reviewPending", reasons: ["datasetReleaseOutOfScope"] });
});

test("every existing address anchor names the first release exactly once and a municipality it covers (no re-geocode)", () => {
  const first = ADDRESS_ANCHOR_DATASET_RELEASES[0];
  for (const [adapter, sha, lgCode, count] of [[CHIYODA_ADAPTER, CHIYODA_FIXTURE_SHA256, "131016", 30], [SHIBUYA_ADAPTER, SHIBUYA_FIXTURE_SHA256, "131130", 30],
    [TOSHIMA_ADAPTER, TOSHIMA_FIXTURE_SHA256, "131164", 4]] as const) {
    const anchors = adapter.reviewedAnchors!(sha);
    assert.equal(anchors.length, count);
    assert.ok(first.lgCodes.includes(lgCode));
    for (const a of anchors) {
      const named = ADDRESS_ANCHOR_DATASET_RELEASES.filter((r) => a.anchorBasis!.reference.includes(r.releaseId));
      assert.deepEqual(named.map((r) => r.releaseId), [first.releaseId], a.anchorId);
    }
  }
});

test("a dataset directory is verified against the registered release: unknown id, wrong file count or wrong digest is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "abr-"));
  mkdirSync(join(dir, "download"));
  writeFileSync(join(dir, "download", "a.csv.zip"), new Uint8Array([1]));
  assert.throws(() => verifyRegisteredDatasetDir(dir, SETAGAYA_TEST.releaseId), /not a registered ABR dataset release/);
  assert.throws(() => verifyRegisteredDatasetDir(dir), /has 1 ABR zip files, release .* has 27/);
});

// A TEST ONLY page-fact sheet whose one row carries a geocoded anchor, through the ordinary pipeline in a local DB.
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"];
async function geocodedSheet() {
  const anchor = evaluate(KYOBASHI, "中央区");
  assert.equal(anchor.status, "anchor");
  if (anchor.status !== "anchor") throw new Error("unreachable");
  const row = ["kyobashi", "テスト喫煙所", "テストビル", "facility", String(anchor.latitude), String(anchor.longitude), "officialAddressGeocode", anchor.reference];
  const bytes = new TextEncoder().encode([HEADER.join(","), row.join(",")].join("\n") + "\n");
  return { bytes, row, digest: await sha256Hex(bytes) };
}

function geocodedAdapter(row: readonly string[]): SourceAdapter {
  const point = (v: readonly string[]) => ({ areaName: v[2], latitude: Number(v[4]), longitude: Number(v[5]), scope: "facility" as const,
    basis: { basis: "officialAddressGeocode" as const, reference: v[7] } });
  const anchorFor = (digest: string): ReviewedAreaAnchor => ({
    anchorId: "aa_testkyobashi", areaName: row[2], areaKind: "facility", latitude: Number(row[4]), longitude: Number(row[5]),
    originKind: "publisherFacilityPoint", originSourceId: "test-address-anchor", originReleaseContentSha256: digest, originUpstreamRowRef: row[0],
    originReference: "test.csv#kyobashi", reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION,
    reviewedBy: "test", reviewedOn: "2026-10-18", areaScope: "facility", anchorBasis: point(row).basis,
  });
  let digest = "";
  return {
    registry: { sourceId: "test-address-anchor", displayName: "TEST address anchor", kind: "municipal", licenseName: "CC BY 4.0",
      licenseUrl: "https://example.invalid/l", attributionText: "© test", publicationStatus: "approved" },
    parserVersion: "t.v1", mappingVersion: "t.map.v1", resolverVersion: "t.r.v1",
    parse: (bytes) => parseCsv(new TextDecoder().decode(bytes)),
    upstreamRowRef: (v) => v[0], includesRecord: () => true, assertResolvable: (release) => { digest = release.contentSha256; },
    areaPoint: point,
    areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "test", reviewedOn: "2026-10-18" },
    reviewedAnchors: (d) => { digest = d; return [anchorFor(d)]; },
    observe: (v) => anchoredObservation({
      name: v[1], supportsPaper: "unknown", supportsHeated: "unknown", openingHours: { status: "none", raw: null, parsed: null }, lifecycle: "active",
      provenance: [{ field: "existence", columns: ["place_name"], rule: "test.pageFact.v1" }],
    }, anchorFor(digest), ["area_name", "area_scope"]),
    attenuate: () => [],
  } as SourceAdapter;
}

test("a geocoded anchor travels as officialAddressGeocode and publishes areaApproximate, never as the smoking place's point", async () => {
  const { bytes, row, digest } = await geocodedSheet();
  const adapter = geocodedAdapter(row);
  const db = new SqliteD1();
  const NOW = "2026-10-18T12:00:00Z";
  await db.prepare(`INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
    VALUES (?, ?, 'municipal', 'CC BY 4.0', 'https://example.invalid/l', '© test', 'approved', ?, ?)`).bind("test-address-anchor", "TEST", NOW, NOW).run();
  const { releaseId } = await ingestRelease(db, adapter, bytes, { sourceUrl: "https://example.invalid/page", observedOn: "2026-10-18", fetchedAt: NOW, httpLastModified: null });
  assert.equal(await recordReviewedAnchors(db, adapter, digest, NOW), 1);
  const stored = db.raw.prepare("SELECT area_scope, anchor_basis, anchor_reference FROM area_location_anchors").get() as Record<string, string>;
  assert.deepEqual({ ...stored }, { area_scope: "facility", anchor_basis: "officialAddressGeocode", anchor_reference: row[7] });
  assert.equal((await resolveFirstRelease(db, adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds("G") })).status, "resolved");
  await publishTiles(db, { now: NOW });
  const spots = v1TileRows(db).flatMap((t) => TileBodyV1.parse(JSON.parse(t.body_json)).spots);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].verification.locationPrecision, "areaApproximate");
  assert.deepEqual(spots[0].verification.locationArea, { name: "テストビル", kind: "facility", scope: "facility" });
});
