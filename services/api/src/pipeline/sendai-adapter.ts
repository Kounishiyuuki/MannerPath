// Reviewed Sendai public-facility release: one explicit smoking amenity inside a park.
// The same row supplies only the PARK anchor, never the smoking place's exact point.
import { parseCsv } from "./csv.ts";
import { AREA_ANCHOR_POLICY_VERSION, anchoredObservation, type ReviewedAreaAnchor } from "./area-anchor.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const SENDAI_SOURCE_ID = "sendai-kaigan-park-smoking-areas";
export const SENDAI_DATA_URL = "https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/documents/041009_public_facility.csv";
export const SENDAI_DATASET_URL = "https://www.city.sendai.jp/opendata/index.php";
export const SENDAI_FIXTURE_SHA256 = "c6bf5395eed995773e3b74b6d3ba6ea3868940f45a6293b8d37330f2bdd72c8b";
export const SENDAI_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: SENDAI_DATA_URL, observedOn: null, fetchedAt: "2026-10-10T16:37:01Z", httpLastModified: "Wed, 13 May 2026 06:00:09 GMT",
};
export const SENDAI_HEADER = [
  "全国地方公共団体コード", "ID", "地方公共団体名", "名称", "名称_カナ",
  "名称_英語", "名称_通称", "POIコード", "外部識別子", "外部識別子の値",
  "所在地_全国地方公共団体コード", "町字ID", "所在地_連結表記", "所在地_都道府県", "所在地_市区町村",
  "所在地_町字", "所在地_番地以下", "建物名等(方書)", "緯度", "経度",
  "高度の種別", "高度の値", "電話番号", "内線番号", "連絡先メールアドレス",
  "連絡先FormURL", "連絡先備考（その他、SNSなど）", "郵便番号", "法人番号", "団体名",
  "利用可能曜日", "開始時間", "終了時間", "利用可能日時特記事項", "説明",
  "車椅子可", "車椅子貸出", "ツエ貸出", "バリアフリートイレ", "スロープ、エレベータ、エスカレータ",
  "点字ブロック等の移動支援", "点字や読上による支援", "盲導犬・介助犬同伴", "字幕", "筆談対応",
  "優先駐車場", "オストメイト対応トイレ", "授乳室", "おむつ替えコーナー", "飲食可否",
  "ベビーカー貸出", "ベビーカー利用", "URL", "画像", "画像_ライセンス",
  "備考",
] as const;
const REVIEWED_DESCRIPTION = "冒険遊び場、大型遊具広場、幼児遊具広場、有料デイキャンプ場、有料馬術場、避難の丘、管理事務所、プレリーダーハウス、駐車場、喫煙所、トイレ有";
export const SENDAI_AREA_ANCHOR: ReviewedAreaAnchor = {
  anchorId: "aa_sendaiido", areaName: "海岸公園（井土地区）", areaKind: "park",
  latitude: 38.20541, longitude: 140.967528, originKind: "publisherAreaPoint",
  originSourceId: SENDAI_SOURCE_ID, originReleaseContentSha256: SENDAI_FIXTURE_SHA256,
  originUpstreamRowRef: "000000001388", originReference: `${SENDAI_DATA_URL}#ID=000000001388`,
  reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION,
  reviewedBy: "Codex", reviewedOn: "2026-10-11",
};
export const SENDAI_ATTRIBUTION_TEXT = `出典：仙台市オープンデータ「公共施設一覧」 ${SENDAI_DATA_URL} CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ MannerPathが喫煙所の記載を抽出・正規化して作成。ピンは海岸公園（井土地区）の目安であり、喫煙所の正確な位置ではありません。`;
function assertRow(v: readonly string[]): void {
  if (v.length !== SENDAI_HEADER.length) throw new Error("sendai: unexpected record width");
}
function includesRecord(v: readonly string[]): boolean {
  assertRow(v);
  if (v[1] !== SENDAI_AREA_ANCHOR.originUpstreamRowRef) return false;
  if (v[0] !== "041009" || v[2] !== "宮城県仙台市" || v[3] !== SENDAI_AREA_ANCHOR.areaName
    || v[34] !== REVIEWED_DESCRIPTION || v[18] !== "38.20541" || v[19] !== "140.967528") {
    throw new Error("sendai: reviewed smoking-amenity scope/anchor has changed");
  }
  return true;
}
function observe(v: readonly string[]): SourceObservation {
  if (!includesRecord(v)) throw new Error("sendai: record is outside the reviewed smoking-amenity scope");
  return anchoredObservation({
    name: `${v[3]}内の喫煙所`, supportsPaper: "unknown", supportsHeated: "unknown",
    // 公園の利用可能曜日/開始時間/終了時間 are not smoking-place hours.
    openingHours: { status: "none", raw: null, parsed: null }, lifecycle: "active",
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null,
      hostType: "municipality", environment: "unknown" },
    provenance: [
      { field: "existence", columns: ["説明"], rule: "sendai.explicitSmokingAmenity.v1" },
      { field: "lifecycle", columns: ["説明"], rule: "sendai.listedSmokingAmenity.v1" },
      { field: "name", columns: ["名称", "説明"], rule: "sendai.parkSmokingAmenityName.v1" },
      { field: "hostType", columns: ["地方公共団体名", "名称"], rule: "sendai.municipalPark.v1" },
    ],
  }, SENDAI_AREA_ANCHOR, ["名称", "緯度", "経度"]);
}
export const SENDAI_ADAPTER: SourceAdapter = {
  registry: { sourceId: SENDAI_SOURCE_ID, displayName: "仙台市 海岸公園（井土地区）内の喫煙所", kind: "municipal",
    licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText: SENDAI_ATTRIBUTION_TEXT, publicationStatus: "approved" },
  parserVersion: "sendai-public-facility-csv.v1", mappingVersion: "sendai-ido-smoking-observation.v1", resolverVersion: "sendai-ido-resolver.v1",
  parse(bytes) {
    const parsed = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (parsed.header.length !== SENDAI_HEADER.length || parsed.header.some((h, i) => h !== SENDAI_HEADER[i])) throw new Error("sendai: unexpected header");
    parsed.rows.forEach(assertRow);
    if (parsed.rows.length !== 2844 || parsed.rows.filter((v) => v[1] === SENDAI_AREA_ANCHOR.originUpstreamRowRef).length !== 1) {
      throw new Error("sendai: unexpected reviewed row count or ambiguous/missing target");
    }
    parsed.rows.filter(includesRecord);
    return parsed;
  },
  upstreamRowRef: (v) => v[1] === "" ? null : v[1], includesRecord, observe,
  areaPoint(v) { return includesRecord(v) ? { areaName: v[3], latitude: Number(v[18]), longitude: Number(v[19]) } : null; },
  areaPointColumns: { name: "名称", latitude: "緯度", longitude: "経度", reviewedBy: "Codex", reviewedOn: "2026-10-11" },
  assertResolvable(release, observations) {
    if (release.contentSha256 !== SENDAI_FIXTURE_SHA256 || release.sourceUrl !== SENDAI_DATA_URL || release.observedOn !== null
      || observations.length !== 1 || observations[0].locationAnchorId !== SENDAI_AREA_ANCHOR.anchorId
      || observations[0].name !== "海岸公園（井土地区）内の喫煙所" || observations[0].latitude !== SENDAI_AREA_ANCHOR.latitude
      || observations[0].longitude !== SENDAI_AREA_ANCHOR.longitude) throw new Error("sendai: release is not the reviewed first-release fingerprint/scope");
  },
  attenuate: () => [], attenuationReference: { attestationVersion: "sendai-no-attenuations.v1", referenceKind: "reviewedSource",
    referenceUrl: SENDAI_DATASET_URL, checkedAt: "2026-10-11" },
  crossReleaseValidated: false, completeness: "partial",
};
