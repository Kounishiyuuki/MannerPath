// 千代田区 無料喫煙所（公衆喫煙所）: an ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact
// sheet for the ward's current list (services/data-pipeline/fixtures/chiyoda-smoking-places/PROVENANCE.md), not a
// publisher file. Existence and hours come from that page (factReference); each pin is the ABR representative point of
// the page's own address (ADR-0018 item 5, src/pipeline/address-anchor.ts), so every spot is areaApproximate with scope
// `facility` and never the smoking room's own point.
import { ADDRESS_ANCHOR_DATASET_RELEASE } from "./address-anchor.ts";
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const CHIYODA_SOURCE_ID = "chiyoda-smoking-places";
export const CHIYODA_PAGE_URL = "https://www.city.chiyoda.lg.jp/koho/machizukuri/sekatsu/jore/muryokitsuenjo.html";
export const CHIYODA_FIXTURE_SHA256 = "535f8940d3551c3a218c4c8c500ad28bfe30a6536b074e5b6b10c595994a5d61";
// ADR-0018 §5 (D-C): observedOn is the check day. lastVerifiedAt shows that desk check, not a site visit.
export const CHIYODA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: CHIYODA_PAGE_URL, observedOn: "2026-10-19", fetchedAt: "2026-10-18T18:21:16Z", httpLastModified: null,
};
// 千代田区ホームページ利用規約 2.(1)(2): source credit, and a statement that the information was edited/processed.
export const CHIYODA_ATTRIBUTION_TEXT = `出典：千代田区ホームページ「無料喫煙所（公衆喫煙所）のご案内」（${CHIYODA_PAGE_URL}）を加工して作成`
  + "（2026-10-19確認）。位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約 第1.0版）の住所代表点をabr-geocoderで求めたもので、"
  + "喫煙所そのものの位置ではありません。MannerPathが事実のみを正規化して作成。千代田区による推奨・保証を意味しません。";

const HEADER = ["fact_id", "place_name", "area_name", "area_kind", "area_scope", "zones", "hours", "hours_note", "spot_type",
  "access_type", "environment", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis",
  "anchor_reference"] as const;
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
// The reviewed rows: [fact_id, place_name, address lot, zones, hours, hours_note, lat, lon, ABR level, gate input/output].
// Generated from the bulk-intake dry run over the page's 78 listings (PROVENANCE.md); only `adoptable` rows are here.
// Rooms the ward lists at one address share its point and are one row (same-anchor rule); their names stay in zones.
type Reviewed = readonly [string, string, string, string, string, string, string, string, string, string];
const REVIEWED: readonly Reviewed[] = [
  ["chiyoda-02", "Smoking Place 木倉食品", "外神田1-3-9", "", "午前8時30分～午後8時（水曜日・年末年始を除く）", "", "35.698159517", "139.770318256", "residential_detail", "入力=東京都千代田区外神田1-3-9 出力=東京都千代田区外神田一丁目3-9 除外=木倉ビル1階"],
  ["chiyoda-08", "paspa秋葉原高架下", "外神田1-4-11", "", "午前7時～午前0時（12月31日～1月3日除く）", "", "35.698590289", "139.770832983", "residential_detail", "入力=東京都千代田区外神田1-4-11 出力=東京都千代田区外神田一丁目4-11"],
  ["chiyoda-12", "AKIBA BREATH", "外神田5-6-4", "", "午前8時～午後6時（平日）、午前10時～午後5時（土曜日・日曜日・祝日）（年末年始・お盆を除く）", "", "35.703501864", "139.772583578", "residential_detail", "入力=東京都千代田区外神田5-6-4 出力=東京都千代田区外神田五丁目6-4 除外=メトロビル2階"],
  ["chiyoda-14", "スモーキングプレイス・マツイ", "内神田3-23-5", "", "午前6時30分～午後4時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.692566289", "139.769511744", "residential_detail", "入力=東京都千代田区内神田3-23-5 出力=東京都千代田区内神田三丁目23-5"],
  ["chiyoda-15", "paspa内神田", "内神田3-22-5", "", "午前7時～午後11時（土曜日・日曜日・祝日・お盆・年末年始を除く）", "", "35.692576558", "139.769944514", "residential_detail", "入力=東京都千代田区内神田3-22-5 出力=東京都千代田区内神田三丁目22-5"],
  ["chiyoda-16", "smoking room ohira", "鍛冶町2-7-10", "", "午前8時～午後4時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.692651492", "139.771948644", "residential_detail", "入力=東京都千代田区鍛冶町2-7-10 出力=東京都千代田区鍛冶町二丁目7-10 除外=中西ビル1階"],
  ["chiyoda-19", "神田駅西口商店街喫煙所", "内神田2-12-1", "", "午前9時～午後5時（土曜日・日曜日・祝日・お盆・年末年始を除く）", "", "35.691261131", "139.768023831", "residential_detail", "入力=東京都千代田区内神田2-12-1 出力=東京都千代田区内神田二丁目12-1"],
  ["chiyoda-20", "セブン-イレブン神田駅西口通り店内喫煙所", "内神田2-9-9", "", "午前7時～午後10時", "", "35.691158947", "139.768459333", "residential_detail", "入力=東京都千代田区内神田2-9-9 出力=東京都千代田区内神田二丁目9-9 除外=神田西口ビル"],
  ["chiyoda-21", "スモーキングスペース TeeTime", "内神田3-10-5", "", "午前9時～午後5時（土曜日・日曜日・年末年始を除く）", "", "35.691466819", "139.769111933", "residential_detail", "入力=東京都千代田区内神田3-10-5 出力=東京都千代田区内神田三丁目10-5 除外=満留賀ビル2階A号室"],
  ["chiyoda-22", "paspa鍛冶町", "鍛冶町1-10-7", "", "午前7時～午後8時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.690531147", "139.773279339", "residential_detail", "入力=東京都千代田区鍛冶町1-10-7 出力=東京都千代田区鍛冶町一丁目10-7 除外=KT鍛冶町"],
  ["chiyoda-23", "paspa小伝馬町", "岩本町1-13-5", "", "午前7時～午後8時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.693519022", "139.778986639", "residential_detail", "入力=東京都千代田区岩本町1-13-5 出力=東京都千代田区岩本町一丁目13-5 除外=TRUST VALUE 1階"],
  ["chiyoda-24", "THE TOBACCO IWAMOTOCHO", "岩本町3-5-14", "", "午前7時～午後7時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.694990803", "139.777517503", "residential_detail", "入力=東京都千代田区岩本町3-5-14 出力=東京都千代田区岩本町三丁目5-14 除外=リベラ岩本町1階"],
  ["chiyoda-25", "paspa東神田", "東神田1-11-5", "", "午前7時～午後8時（土曜日・日曜日・祝日を除く）", "", "35.695189614", "139.780187158", "residential_detail", "入力=東京都千代田区東神田1-11-5 出力=東京都千代田区東神田一丁目11-5 除外=石田ビル東神田1階"],
  ["chiyoda-30", "朝陽ビル無料公衆喫煙所", "内神田3-4-14", "", "午前9時～午後9時（土曜日・日曜日・祝日・お盆・年末年始を除く）", "", "35.689924264", "139.769192425", "residential_detail", "入力=東京都千代田区内神田3-4-14 出力=東京都千代田区内神田三丁目4-14 除外=朝陽ビル"],
  ["chiyoda-33", "ヒライ商会", "九段南1-5-9", "", "午前8時～午後6時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.695314019", "139.751783667", "residential_detail", "入力=東京都千代田区九段南1-5-9 出力=東京都千代田区九段南一丁目5-9"],
  ["chiyoda-35", "Smo9 o2", "西神田3-3-12", "", "午前9時～午後6時（土曜日・日曜日・祝日を除く）", "", "35.697493025", "139.753007389", "residential_detail", "入力=東京都千代田区西神田3-3-12 出力=東京都千代田区西神田三丁目3-12 除外=西神田YSビル1階"],
  ["chiyoda-37", "Smoking Room 九段北店", "九段北1-8-4", "", "午前7時30分～午後6時（土曜日・日曜日・祝日を除く）", "", "35.697357931", "139.751493497", "residential_detail", "入力=東京都千代田区九段北1-8-4 出力=東京都千代田区九段北一丁目8-4 除外=市橋ビル1階"],
  ["chiyoda-39", "九段会館テラス地下1階喫煙所", "九段南1-6-5", "", "午前7時～午後10時", "", "35.694708522", "139.751506872", "residential_detail", "入力=東京都千代田区九段南1-6-5 出力=東京都千代田区九段南一丁目6-5 除外=九段会館テラス地下1階"],
  ["chiyoda-40", "paspa飯田橋西口", "富士見1-7-7", "", "午前7時～午後8時（土曜日・日曜日・祝日を除く）", "", "35.69883685", "139.745685156", "residential_detail", "入力=東京都千代田区富士見1-7-7 出力=東京都千代田区富士見一丁目7-7 除外=女部田ビル1階"],
  ["chiyoda-41", "paspa飯田橋東口", "飯田橋1-8-10", "", "午前7時～午後8時（土曜日・日曜日・祝日を除く）", "", "35.699477567", "139.748593028", "residential_detail", "入力=東京都千代田区飯田橋1-8-10 出力=東京都千代田区飯田橋一丁目8-10 除外=クリエイトビル1階"],
  ["chiyoda-42", "ピュアウッドガーデン", "飯田橋2-14-5", "", "午前9時～午後2時（土曜日・日曜日・祝日・お盆・年末年始を除く）", "", "35.698795903", "139.750077206", "residential_detail", "入力=東京都千代田区飯田橋2-14-5 出力=東京都千代田区飯田橋二丁目14-5"],
  ["chiyoda-43", "THE TOBACCO IIDABASHI", "飯田橋4-9-11", "", "午前7時～午後9時（土曜日・日曜日・祝日を除く）", "", "35.701710467", "139.745712347", "residential_detail", "入力=東京都千代田区飯田橋4-9-11 出力=東京都千代田区飯田橋四丁目9-11"],
  ["chiyoda-49", "一服（Ippuku）平河町店", "平河町2-2-1", "", "午前9時～午後7時（土曜日・日曜日・祝日・年末年始・お盆・ゴールデンウィークを除く）", "", "35.681668389", "139.741325231", "residential_detail", "入力=東京都千代田区平河町2-2-1 出力=東京都千代田区平河町二丁目2-1 除外=山口ビル1階"],
  ["chiyoda-50", "paspa 永田町", "平河町2-12-2", "", "午前7時～午後8時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.680645267", "139.741834264", "residential_detail", "入力=東京都千代田区平河町2-12-2 出力=東京都千代田区平河町二丁目12-2 除外=ニュー福井ビル"],
  ["chiyoda-53-57", "三久ビル喫煙所・paspa霞が関", "霞が関3-6-14", "三久ビル喫煙所|paspa霞が関", "三久ビル喫煙所 午前9時～午後5時（土曜日・日曜日・祝日・年末年始を除く）|paspa霞が関 午前7時～午後8時（土曜日・日曜日・祝日を除く）", "", "35.671925478", "139.745683319", "residential_detail", "入力=東京都千代田区霞が関3-6-14 出力=東京都千代田区霞が関三丁目6-14 除外=三久ビル1階"],
  ["chiyoda-56", "THE TABACCO 2:50.76", "丸の内3-7-15", "", "午前9時～午後9時（土曜日・日曜日・祝日・お盆・年末年始を除く）", "", "35.677054442", "139.765077894", "residential_detail", "入力=東京都千代田区丸の内3-7-15 出力=東京都千代田区丸の内三丁目7-15"],
  ["chiyoda-58", "THE TOBACCO HIBIYA", "内幸町1-7-1", "", "午前9時～午後9時（休み：土曜日・日曜日・祝日）", "", "35.669588375", "139.758950847", "residential_detail", "入力=東京都千代田区内幸町1-7-1 出力=東京都千代田区内幸町一丁目7-1 除外=日比谷OKUROJI"],
  ["chiyoda-61", "paspa市ヶ谷", "九段南4-8-30", "", "午前7時～午後8時（土曜日・日曜日・祝日を除く）", "", "35.691500631", "139.738312706", "residential_detail", "入力=東京都千代田区九段南4-8-30 出力=東京都千代田区九段南四丁目8-30 除外=藤山ビル1階"],
  ["chiyoda-66", "喜助お茶の水ビル喫煙所", "外神田2-2-17", "", "午前10時～午後6時（土曜日・日曜日・祝日・年末年始を除く）", "", "35.699448886", "139.767605042", "residential_detail", "入力=東京都千代田区外神田2-2-17 出力=東京都千代田区外神田二丁目2-17 除外=喜助お茶の水ビル地下1階"],
  ["chiyoda-76", "paspa西神田", "西神田2-1-8", "", "午前7時～午後8時（土曜日・日曜日・祝日を除く）", "", "35.698929264", "139.756017597", "residential_detail", "入力=東京都千代田区西神田2-1-8 出力=東京都千代田区西神田二丁目1-8 除外=フルールセゾン神保町1階"],
];

// Every row shares these reviewed values. 助成施設 are the ward's public smoking places, defined on the page as indoor
// rooms (屋内喫煙所) in private buildings; none of the rows here is ward-run (区営).
function reviewedValues(r: Reviewed): readonly string[] {
  const [factId, placeName, lot, zones, hours, hoursNote, lat, lon, level, io] = r;
  return [factId, placeName, lot, "facility", "facility", zones, hours, hoursNote, "publicSmokingRoom", "public", "indoor", "unknown",
    CHIYODA_PAGE_URL, "2026-10-19", lat, lon, "officialAddressGeocode", `abr-geocoder 2.3.1 ${ADDRESS_ANCHOR_DATASET_RELEASE} ${level} ${io}`];
}
const REVIEWED_VALUES = new Map(REVIEWED.map((r) => [r[0], reviewedValues(r)]));

function row(values: readonly string[]): readonly string[] {
  if (values.length !== HEADER.length) throw new Error("chiyoda: unexpected record shape");
  const reviewed = REVIEWED_VALUES.get(values[col("fact_id")]);
  if (!reviewed || JSON.stringify(values) !== JSON.stringify(reviewed)) throw new Error("chiyoda: record is not a reviewed fact row");
  return values;
}

function areaPoint(values: readonly string[]) {
  const v = row(values);
  return {
    areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] },
  };
}

function anchorFor(values: readonly string[], releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(values);
  const factId = values[col("fact_id")];
  return {
    anchorId: `aa_chiyoda${factId.slice("chiyoda-".length).replaceAll("-", "")}`, areaName: p.areaName, areaKind: "facility",
    latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: CHIYODA_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: factId, originReference: `chiyoda-page-facts.csv#${factId}`,
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-19",
    areaScope: "facility", anchorBasis: p.basis,
  };
}

function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const factColumns = ["place_name", "zones", "page_url", "checked_at"];
  const hours = v[col("hours")];
  const note = v[col("hours_note")];
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")],
    supportsPaper: "unknown", supportsHeated: "unknown",
    // The page's 開放時間 carry closed days and holidays in prose; kept verbatim so openNow is never asserted from them.
    openingHours: { status: "unparsed", raw: note === "" ? hours : `${hours}\n${note}`, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: factColumns, rule: "chiyoda.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "chiyoda.listedWithoutSuspension.v1" },
      { field: "name", columns: ["place_name"], rule: "chiyoda.normalizedName.v1" },
      { field: "openingHours", columns: ["hours", "hours_note"], rule: "chiyoda.statedHours.v1" },
      // 公衆喫煙所 open to anyone free of charge; 助成施設 are defined by the page as indoor smoking rooms.
      { field: "accessType", columns: ["access_type"], rule: "chiyoda.publicSmokingPlace.v1" },
      { field: "spotType", columns: ["spot_type", "environment"], rule: "chiyoda.subsidizedIndoorRoom.v1" },
    ],
    classification: {
      spotType: "publicSmokingRoom", spotSubtype: null, accessType: "public", accessDetail: null, hostType: "unknown", environment: "indoor",
    },
  };
  return anchoredObservation(base, anchorFor(v, CHIYODA_FIXTURE_SHA256), ["area_name", "area_scope"]);
}

// Explicit field order survives observation persistence; object insertion order carries no authority.
function observationFacts(o: SourceObservation | undefined): string {
  if (!o) return "missing";
  const c = o.classification;
  return JSON.stringify([o.name, o.latitude, o.longitude, o.supportsPaper, o.supportsHeated,
    o.openingHours.status, o.openingHours.raw, o.openingHours.parsed, o.lifecycle, o.provenance,
    c?.spotType, c?.spotSubtype, c?.accessType, c?.accessDetail, c?.hostType, c?.environment,
    o.existenceEvidence, o.communityConfirmations, o.locationAnchorId]);
}

export const CHIYODA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: CHIYODA_SOURCE_ID, displayName: "千代田区 無料喫煙所（公衆喫煙所）", kind: "municipal",
    licenseName: null, licenseUrl: null, attributionText: CHIYODA_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [CHIYODA_PAGE_URL],
      termsUrls: ["https://www.city.chiyoda.lg.jp/koho/kuse/homepage/riyokiyaku/index.html"],
      termsReading: "千代田区ホームページ利用規約: 区が指定するもの（写真・動画・イラスト等）を除き、出典の記載を条件に複製・翻案等の自由な利用を認め、商用利用も可。編集・加工時はその旨を記載。SMOKING AREA MAPの地図画像は二次利用不可とされ使用しない。正規化事実のみ参照。",
      prohibitsInformationUse: false, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-19",
    },
  },
  parserVersion: "chiyoda-page-facts.v1", mappingVersion: "chiyoda-page-facts.map.v1", resolverVersion: "chiyoda-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== REVIEWED.length) throw new Error("chiyoda: unexpected fact sheet");
    rows.forEach(row);
    if (new Set(rows.map((v) => v[col("fact_id")])).size !== REVIEWED.length) throw new Error("chiyoda: duplicate fact row");
    // Same-anchor rule: rooms the ward lists at one address share its point and are one row.
    if (new Set(rows.map((v) => `${v[col("anchor_latitude")]},${v[col("anchor_longitude")]}`)).size !== REVIEWED.length) throw new Error("chiyoda: two rows share one anchor");
    return { header, rows };
  },
  upstreamRowRef: (values) => row(values)[col("fact_id")],
  includesRecord: () => true,
  areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-19" },
  reviewedAnchors: (releaseContentSha256) => [...REVIEWED_VALUES.values()].map((v) => anchorFor(v, releaseContentSha256)),
  observe,
  assertResolvable(release, observations) {
    const expected = [...REVIEWED_VALUES.values()].map((v) => observationFacts(observe(v))).sort();
    const actual = observations.map(observationFacts).sort();
    if (release.contentSha256 !== CHIYODA_FIXTURE_SHA256 || release.sourceUrl !== CHIYODA_PAGE_URL
      || release.observedOn !== "2026-10-19" || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("chiyoda: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "chiyoda-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: CHIYODA_PAGE_URL, checkedAt: "2026-10-19" },
  completeness: "partial", crossReleaseValidated: false,
};
