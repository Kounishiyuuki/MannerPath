// 渋谷区 区内公共喫煙所一覧: an ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact sheet for
// the ward's current list (services/data-pipeline/fixtures/shibuya-smoking-places/PROVENANCE.md), not a publisher file. Existence and hours come from that page (factReference); each pin is the ABR representative point of
// the page's own address (ADR-0018 item 5, src/pipeline/address-anchor.ts), so every spot is areaApproximate with scope
// `facility` and never the smoking place's own point.
import { ADDRESS_ANCHOR_DATASET_RELEASE } from "./address-anchor.ts";
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const SHIBUYA_SOURCE_ID = "shibuya-smoking-places";
export const SHIBUYA_PAGE_URL = "https://www.city.shibuya.tokyo.jp/kankyo/machi-seiso/kitsuen/smokingplace.html";
export const SHIBUYA_FIXTURE_SHA256 = "68e26b09a7928b16264c178441b6a5bd40af7ac94fd1f8031beadfd5be03dbef";
// ADR-0018 §5 (D-C): observedOn is the check day. lastVerifiedAt shows that desk check, not a site visit.
export const SHIBUYA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: SHIBUYA_PAGE_URL, observedOn: "2026-10-19", fetchedAt: "2026-10-18T20:03:11Z", httpLastModified: null,
};
// サイトポリシー「著作権について」 reserves copyright and forbids 転載・複製 of the site's expression; only facts are used.
export const SHIBUYA_ATTRIBUTION_TEXT = `出典：渋谷区ポータル「区内公共喫煙所一覧」（${SHIBUYA_PAGE_URL}）（2026-10-19確認）。`
  + "MannerPathが事実のみを正規化して作成。位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約 第1.0版）の住所代表点を"
  + "abr-geocoderで求めたもので、喫煙所そのものの位置ではありません。渋谷区による推奨・保証を意味しません。";

const HEADER = ["fact_id", "place_name", "area_name", "area_kind", "area_scope", "zones", "hours", "hours_note", "spot_type",
  "access_type", "environment", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis",
  "anchor_reference"] as const;
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
// The reviewed rows: [fact_id, place_name, address lot, zones, hours, hours_note, host_type, lat, lon, ABR level, gate
// input/output]. Generated from the bulk-intake dry run over the page's 45 listings (PROVENANCE.md); only reviewed
// `adoptable` rows are here. Places the ward lists at one address share its point and are one row (same-anchor rule).
type Reviewed = readonly [string, string, string, string, string, string, string, string, string, string, string];
const REVIEWED: readonly Reviewed[] = [
  ["shibuya-09", "代々木駅東口喫煙所", "千駄ヶ谷5-20-17", "", "平日7時～20時、土曜日7時～17時", "年末年始閉鎖、気象状況により一時閉鎖する場合あり", "municipality", "35.683425072", "139.703163247", "residential_detail", "入力=東京都渋谷区千駄ヶ谷5-20-17 出力=東京都渋谷区千駄ヶ谷5丁目20-17"],
  ["shibuya-10", "代々木駅西口喫煙所", "代々木1-32-13", "", "7時～21時", "年末年始閉鎖、気象状況により一時閉鎖する場合あり", "municipality", "35.682690678", "139.702125094", "residential_detail", "入力=東京都渋谷区代々木1-32-13 出力=東京都渋谷区代々木1丁目32-13"],
  ["shibuya-11", "代々木二丁目あおい公園喫煙所", "代々木2-13-3", "", "終日", "気象状況により一時閉鎖する場合あり", "municipality", "35.687127206", "139.696049119", "residential_detail", "入力=東京都渋谷区代々木2-13-3 出力=東京都渋谷区代々木2丁目13-3"],
  ["shibuya-12", "神南1丁目香取屋ビル西側喫煙所", "神南1-12-15", "", "平日8時～17時30分", "", "unknown", "35.662715025", "139.700657664", "residential_detail", "入力=東京都渋谷区神南1-12-15 出力=東京都渋谷区神南1丁目12-15"],
  ["shibuya-13", "paspa宮益坂", "渋谷1-13-7", "", "7時～22時", "1階:加熱式専用、2階:紙巻き専用", "unknown", "35.659843736", "139.703540722", "residential_detail", "入力=東京都渋谷区渋谷1-13-7 出力=東京都渋谷区渋谷1丁目13-7 除外=ヒューリック渋谷第二ビル"],
  ["shibuya-14", "クランクストリート加熱式たばこ喫煙所", "宇田川町26-7", "", "12時～20時", "加熱式専用", "unknown", "35.660150322", "139.698728878", "residential_detail", "入力=東京都渋谷区宇田川町26-7 出力=東京都渋谷区宇田川町26-7 除外=AN宇田川町"],
  ["shibuya-15-27", "THE TOBACCO SHIBUYA SECOND・渋谷パルコ（1階）", "宇田川町15-1", "THE TOBACCO SHIBUYA SECOND|渋谷パルコ（1階）", "THE TOBACCO SHIBUYA SECOND 11時30分～29時|渋谷パルコ（1階） 11時～21時", "THE TOBACCO SHIBUYA SECOND 施設の営業時間に準ずる", "unknown", "35.662213944", "139.699199517", "residential_detail", "入力=東京都渋谷区宇田川町15-1 出力=東京都渋谷区宇田川町15-1 除外=渋谷パルコ地下1階"],
  ["shibuya-16", "THE TOBACCO DOGENZAKA", "道玄坂2-6-17", "", "7時30分～22時", "", "unknown", "35.659227394", "139.698809111", "residential_detail", "入力=東京都渋谷区道玄坂2-6-17 出力=東京都渋谷区道玄坂2丁目6-17 除外=渋東シネタワー別館"],
  ["shibuya-17", "THE TOBACCO DOGENZAKA SECOND", "道玄坂1-6-3", "", "8時～21時", "土曜日、日曜日、祝日を除く", "unknown", "35.657847947", "139.699355275", "residential_detail", "入力=東京都渋谷区道玄坂1-6-3 出力=東京都渋谷区道玄坂1丁目6-3 除外=山路ビル地下1階"],
  ["shibuya-18", "THE TOBACCO AOYAMA", "神宮前5-51-8", "", "11時～20時", "", "unknown", "35.662743489", "139.709665489", "residential_detail", "入力=東京都渋谷区神宮前5-51-8 出力=東京都渋谷区神宮前5丁目51-8 除外=ラ・ポルト青山地下1階"],
  ["shibuya-19", "ファミリーマート神宮前三丁目店喫煙所", "神宮前3-7-7", "", "0時～23時59分", "", "unknown", "35.670515878", "139.713620244", "residential_detail", "入力=東京都渋谷区神宮前3-7-7 出力=東京都渋谷区神宮前3丁目7-7"],
  ["shibuya-20", "もこのたばこ（旧瀧島たばこ店）喫煙所", "本町1-52-1", "", "月曜日・水曜日～金曜日10時～21時、火曜日10時～15時、16時30分～21時", "土曜日、日曜日、祝日の営業時間はGoogleビジネスプロフィールをご確認ください。", "unknown", "35.682756633", "139.684549814", "residential_detail", "入力=東京都渋谷区本町1-52-1 出力=東京都渋谷区本町1丁目52-1 除外=イルカスケード"],
  ["shibuya-23", "渋谷キャスト（地下1階）", "渋谷1-23-21", "", "7時～23時", "", "unknown", "35.662680389", "139.702419339", "residential_detail", "入力=東京都渋谷区渋谷1-23-21 出力=東京都渋谷区渋谷1丁目23-21"],
  ["shibuya-24", "渋谷ストリーム（1、2、4階）", "渋谷3-21-3", "", "6時15分～24時、3階:11時～23時30分", "", "unknown", "35.657471972", "139.702855028", "residential_detail", "入力=東京都渋谷区渋谷3-21-3 出力=東京都渋谷区渋谷3丁目21-3"],
  ["shibuya-25", "渋谷ソラスタ（1、2階）", "道玄坂1-21-1", "", "8時～20時", "", "unknown", "35.656587822", "139.696936961", "residential_detail", "入力=東京都渋谷区道玄坂1-21-1 出力=東京都渋谷区道玄坂1丁目21-1"],
  ["shibuya-26", "ラ・トゥール渋谷宇田川Abema Towers（1階）", "宇田川町40-1", "", "9時～21時", "", "unknown", "35.662330811", "139.696072425", "residential_detail", "入力=東京都渋谷区宇田川町40-1 出力=東京都渋谷区宇田川町40-1"],
  ["shibuya-28", "渋谷フクラス（5、6階）", "道玄坂1-2-3", "", "11時～23時", "", "unknown", "35.657675042", "139.700525444", "residential_detail", "入力=東京都渋谷区道玄坂1-2-3 出力=東京都渋谷区道玄坂1丁目2-3"],
  ["shibuya-29", "MIYASHITA PARK（1、3階（2か所））", "渋谷1-26-5", "", "11時～23時", "", "unknown", "35.661621922", "139.702067089", "residential_detail", "入力=東京都渋谷区渋谷1-26-5 出力=東京都渋谷区渋谷1丁目26-5"],
  ["shibuya-30", "道玄坂通 dogenzaka-dori（3階）", "道玄坂2-25-12", "", "7時～23時", "", "unknown", "35.660219519", "139.697481358", "residential_detail", "入力=東京都渋谷区道玄坂2-25-12 出力=東京都渋谷区道玄坂2丁目25-12"],
  ["shibuya-32", "渋谷アクシュ（1階、3階）", "渋谷2-17-1", "", "5時～25時", "毎年元日は3階喫煙所のみ利用可", "unknown", "35.65947055", "139.705035325", "residential_detail", "入力=東京都渋谷区渋谷2-17-1 出力=東京都渋谷区渋谷2丁目17-1"],
  ["shibuya-33", "関電不動産渋谷ビル（1階）", "渋谷3-26-20", "", "平日9時～18時", "", "unknown", "35.654518786", "139.705127828", "residential_detail", "入力=東京都渋谷区渋谷3-26-20 出力=東京都渋谷区渋谷3丁目26-20"],
  ["shibuya-34", "BASE 1（1階）", "宇田川町41-1", "", "平日9時～18時", "", "unknown", "35.663395975", "139.695560475", "residential_detail", "入力=東京都渋谷区宇田川町41-1 出力=東京都渋谷区宇田川町41-1"],
  ["shibuya-35", "表参道ヒルズ（地下3階）", "神宮前4-12-10", "", "11時～23時", "", "unknown", "35.667230139", "139.708554906", "residential_detail", "入力=東京都渋谷区神宮前4-12-10 出力=東京都渋谷区神宮前4丁目12-10"],
  ["shibuya-36", "WITH HARAJUKU（地下1階）", "神宮前1-14-30", "", "11時～20時", "", "unknown", "35.670567097", "139.702991039", "residential_detail", "入力=東京都渋谷区神宮前1-14-30 出力=東京都渋谷区神宮前1丁目14-30"],
  ["shibuya-37", "東急プラザ原宿「ハラカド」（G階）", "神宮前6-31-21", "", "11時～21時", "", "unknown", "35.6685229", "139.704965556", "residential_detail", "入力=東京都渋谷区神宮前6-31-21 出力=東京都渋谷区神宮前6丁目31-21"],
  ["shibuya-38", "アパホテル&リゾート西新宿五丁目タワー（1階）", "本町3-14-1", "", "7時～26時", "", "unknown", "35.689527042", "139.683545714", "residential_detail", "入力=東京都渋谷区本町3-14-1 出力=東京都渋谷区本町3丁目14-1"],
  ["shibuya-39", "タイムズスクエアビル（5、13、14階）", "千駄ヶ谷5-24-2", "", "日曜日~木曜日10時～20時、金曜日~土曜日10時～20時30分（13、14階は11時～23時）", "", "unknown", "35.684647517", "139.703351633", "residential_detail", "入力=東京都渋谷区千駄ヶ谷5-24-2 出力=東京都渋谷区千駄ヶ谷5丁目24-2"],
  ["shibuya-40", "リンクスクエア新宿（1、3階）", "千駄ヶ谷5-27-5", "", "7時～23時", "", "unknown", "35.686499289", "139.703093908", "residential_detail", "入力=東京都渋谷区千駄ヶ谷5-27-5 出力=東京都渋谷区千駄ヶ谷5丁目27-5"],
  ["shibuya-41", "住友不動産新宿南口ビル（1階）", "千駄ヶ谷5-31-11", "", "7時～21時", "16時30分～16時50分は利用不可", "unknown", "35.686897903", "139.703548119", "residential_detail", "入力=東京都渋谷区千駄ヶ谷5-31-11 出力=東京都渋谷区千駄ヶ谷5丁目31-11"],
  ["shibuya-42", "ヒューリック将棋会館千駄ヶ谷ビル（1階）", "千駄ヶ谷1-18-5", "", "8時30分～19時", "土曜日、日曜日、祝日、年末年始を除く", "unknown", "35.679973694", "139.711060775", "residential_detail", "入力=東京都渋谷区千駄ヶ谷1-18-5 出力=東京都渋谷区千駄ヶ谷1丁目18-5"],
];

// Every row shares these reviewed values. The page states neither room type nor environment; host is the municipality
// only for 区設置喫煙所 (区が設置・運営), unknown otherwise.
function reviewedValues(r: Reviewed): readonly string[] {
  const [factId, placeName, lot, zones, hours, hoursNote, host, lat, lon, level, io] = r;
  return [factId, placeName, lot, "facility", "facility", zones, hours, hoursNote, "unknown", "public", "unknown", host,
    SHIBUYA_PAGE_URL, "2026-10-19", lat, lon, "officialAddressGeocode", `abr-geocoder 2.3.1 ${ADDRESS_ANCHOR_DATASET_RELEASE} ${level} ${io}`];
}
const REVIEWED_VALUES = new Map(REVIEWED.map((r) => [r[0], reviewedValues(r)]));

function row(values: readonly string[]): readonly string[] {
  if (values.length !== HEADER.length) throw new Error("shibuya: unexpected record shape");
  const reviewed = REVIEWED_VALUES.get(values[col("fact_id")]);
  if (!reviewed || JSON.stringify(values) !== JSON.stringify(reviewed)) throw new Error("shibuya: record is not a reviewed fact row");
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
    anchorId: `aa_shibuya${factId.slice("shibuya-".length).replaceAll("-", "")}`, areaName: p.areaName, areaKind: "facility",
    latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: SHIBUYA_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: factId, originReference: `shibuya-page-facts.csv#${factId}`,
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
    // The page's hours carry closures, holidays and per-floor ranges in prose; kept verbatim so openNow is never asserted.
    openingHours: { status: "unparsed", raw: note === "" ? hours : `${hours}\n${note}`, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: factColumns, rule: "shibuya.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "shibuya.listedWithoutSuspension.v1" },
      { field: "name", columns: ["place_name"], rule: "shibuya.normalizedName.v1" },
      { field: "openingHours", columns: ["hours", "hours_note"], rule: "shibuya.statedHours.v1" },
      // Every row is listed by the ward as a 公共喫煙所.
      { field: "accessType", columns: ["access_type"], rule: "shibuya.publicSmokingPlace.v1" },
      { field: "hostType", columns: ["host_type"], rule: "shibuya.wardRunOrUnknown.v1" },
    ],
    classification: {
      spotType: "unknown", spotSubtype: null, accessType: "public", accessDetail: null,
      hostType: v[col("host_type")] === "municipality" ? "municipality" : "unknown", environment: "unknown",
    },
  };
  return anchoredObservation(base, anchorFor(v, SHIBUYA_FIXTURE_SHA256), ["area_name", "area_scope"]);
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

export const SHIBUYA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: SHIBUYA_SOURCE_ID, displayName: "渋谷区 区内公共喫煙所", kind: "municipal",
    licenseName: null, licenseUrl: null, attributionText: SHIBUYA_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [SHIBUYA_PAGE_URL],
      termsUrls: ["https://www.city.shibuya.tokyo.jp/guide/website/list/site_policy.html"],
      termsReading: "サイトポリシー「著作権について」: 情報・画像・図表の著作権は渋谷区に帰属し、転載・複製を禁じ、希望時は連絡とする表現保護。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照（ページの文章・画像は保存しない）。",
      prohibitsInformationUse: false, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-19",
    },
  },
  parserVersion: "shibuya-page-facts.v1", mappingVersion: "shibuya-page-facts.map.v1", resolverVersion: "shibuya-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== REVIEWED.length) throw new Error("shibuya: unexpected fact sheet");
    rows.forEach(row);
    if (new Set(rows.map((v) => v[col("fact_id")])).size !== REVIEWED.length) throw new Error("shibuya: duplicate fact row");
    // Same-anchor rule: rooms the ward lists at one address share its point and are one row.
    if (new Set(rows.map((v) => `${v[col("anchor_latitude")]},${v[col("anchor_longitude")]}`)).size !== REVIEWED.length) throw new Error("shibuya: two rows share one anchor");
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
    if (release.contentSha256 !== SHIBUYA_FIXTURE_SHA256 || release.sourceUrl !== SHIBUYA_PAGE_URL
      || release.observedOn !== "2026-10-19" || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("shibuya: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "shibuya-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: SHIBUYA_PAGE_URL, checkedAt: "2026-10-19" },
  completeness: "partial", crossReleaseValidated: false,
};
