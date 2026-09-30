// Kyoto City's CC BY 4.0 facility list (KYOTO OPEN DATA dataset 00003), reviewed in docs/SOURCES.md.
// The mixed dataset is kept intact as raw evidence; only the publisher's own 喫煙場所 category
// (cate_id 138) enters the observation layer, minus reviewed rows that conflict with the city's
// current smoking-place page. The ordinary city page contributes no values.
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const KYOTO_SOURCE_ID = "kyoto-public-smoking-places";
export const KYOTO_DATASET_URL = "https://data.city.kyoto.lg.jp/dataset/00003/";
// The portal serves the file from this resource page through a POST form; there is no GET file URL.
export const KYOTO_DATA_URL = "https://data.city.kyoto.lg.jp/resource/?id=21432";
export const KYOTO_SMOKING_PAGE_URL = "http://www.city.kyoto.lg.jp/bunshi/page/0000027498.html";
export const KYOTO_FIXTURE_SHA256 = "bd37bbcbc413751f8ae5e3e5c88b397a452f953aad1b330c326cbaba137715cc";
export const KYOTO_EXISTENCE_RULE = "kyoto.smokingPlaceCategory.v1";
export const KYOTO_ATTRIBUTION_TEXT =
  `出典：京都市オープンデータ「京都市等の施設に関する情報（一覧表）」施設情報一覧（令和８年９月３日現在） ${KYOTO_DATASET_URL} 著作権者 京都市 クリエイティブ・コモンズ・ライセンス 表示4.0国際 https://creativecommons.org/licenses/by/4.0/legalcode.ja MannerPathが喫煙場所カテゴリを抽出・正規化して作成。京都市は本データの利用により生じた結果について責任を負いません。`;
export const KYOTO_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: KYOTO_DATA_URL,
  // The publisher titles this resource 施設情報一覧（令和８年９月３日現在）: a dataset-level as-of date,
  // like Taito's. The fetch time and the portal upload time are provenance only.
  observedOn: "2026-09-03",
  fetchedAt: "2026-09-29T17:12:54Z",
  httpLastModified: null,
};
export const KYOTO_HEADER = [
  "所管局", "所管課", "ID番号（id)", "公共施設の名称(name)", "よみがな（kana）", "緯度(lat)", "経度(lng)",
  "カテゴリ(cate_id)", "行政区コード(dist_id)", "施設のご案内（利用目的・実施内容等）(note)", "郵便番号(zip)",
  "所在地(address)", "施設写真（外観等）１(pic)", "運営主体(subject)", "電話番号(tel)", "ＦＡＸ番号(fax)",
  "ＨＰリンク(url)", "主な設備(aim)", "開館時間（利用時間）(optime)", "休館日(holiday)", "利用料(fee)",
  "アクセス(access)", "利用方法（申込方法）(howto)", "利用上の注意(warning)", "愛称(nickname）",
  ...Array<string>(28).fill(""),
] as const;
const SMOKING_CATEGORY = "138";
// Both 西大路 rows disagree with the city's smoking page (2025-08-14): the page shows only ID
// 1000001781, captioned 北側改札口前（2階）, while the CSV names 1781 南側 at moved coordinates and adds
// 1000002132 北側. Until the publisher resolves it, neither row is published.
export const KYOTO_CONFLICT_EXCLUDED_IDS: readonly string[] = ["1000001781", "1000002132"];

function assertRow(values: readonly string[]): void {
  if (values.length !== KYOTO_HEADER.length) throw new Error("kyoto: unexpected record width");
}
function isSmokingCategory(values: readonly string[]): boolean {
  assertRow(values);
  if (values[7] !== SMOKING_CATEGORY) return false;
  // The category is the evidence; these checks make a drifted code or a re-used category fail
  // loudly instead of silently publishing a non-smoking facility.
  if (!/^[0-9]{10}$/.test(values[2]) || !values[3].endsWith("喫煙場所") || values[1] !== "くらし安全推進課" || values[16] !== KYOTO_SMOKING_PAGE_URL) {
    throw new Error("kyoto: category 138 row is not an explicit city smoking place");
  }
  // Reviewed rows carry no hours, fee or usage text; any such value needs a new mapping review.
  if (values[18] !== "" || values[19] !== "" || values[20] !== "") {
    throw new Error("kyoto: smoking-place row states hours/holidays/fee that this mapping does not review");
  }
  return true;
}
function includesRecord(values: readonly string[]): boolean {
  return isSmokingCategory(values) && !KYOTO_CONFLICT_EXCLUDED_IDS.includes(values[2]);
}
function coordinate(value: string, column: string, min: number, max: number): number {
  if (!/^-?[0-9]{1,3}\.[0-9]+$/.test(value)) throw new Error(`kyoto: invalid ${column}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`kyoto: out-of-range ${column}`);
  return n;
}
function observe(values: readonly string[]): SourceObservation {
  if (!includesRecord(values)) throw new Error("kyoto: record is not a reviewed city smoking place");
  return {
    name: values[3],
    // Supplied decimal lat/lng of each place. Datum, accuracy and how the city derived them are
    // unstated; used at map-display accuracy under the existing lat/lon convention, without geocoding.
    latitude: coordinate(values[5], "緯度", -90, 90),
    longitude: coordinate(values[6], "経度", -180, 180),
    supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: { status: "none", raw: null, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: ["カテゴリ(cate_id)", "公共施設の名称(name)"], rule: KYOTO_EXISTENCE_RULE },
      { field: "lifecycle", columns: ["カテゴリ(cate_id)"], rule: KYOTO_EXISTENCE_RULE },
      { field: "name", columns: ["公共施設の名称(name)"], rule: "kyoto.name.v1" },
      { field: "location", columns: ["緯度(lat)", "経度(lng)"], rule: "kyoto.suppliedLatLng.v1" },
    ],
  };
}

export const KYOTO_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: KYOTO_SOURCE_ID, displayName: "京都市 公設喫煙場所（施設情報一覧）", kind: "municipal",
    licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode.ja",
    attributionText: KYOTO_ATTRIBUTION_TEXT, publicationStatus: "approved",
  },
  parserVersion: "kyoto-shisetsu-csv.v1", mappingVersion: "kyoto-smoking-observation.v1", resolverVersion: "kyoto-resolver.v1",
  parse(bytes) {
    const parsed = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (parsed.header.length !== KYOTO_HEADER.length || parsed.header.some((h, i) => h !== KYOTO_HEADER[i])) {
      throw new Error("kyoto: unexpected header; reviewed parser expects the exact facility-list schema");
    }
    parsed.rows.forEach(assertRow);
    return parsed;
  },
  // The publisher's ID番号, verbatim (a few non-smoking rows carry trailing spaces), also the id in the
  // city's own map links from the smoking page.
  upstreamRowRef: (values) => (values[2] === "" ? null : values[2]),
  includesRecord,
  observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== KYOTO_FIXTURE_SHA256 || release.sourceUrl !== KYOTO_DATA_URL
      || release.observedOn !== "2026-09-03" || observations.length !== 17) {
      throw new Error("kyoto: release is not the reviewed first-release fingerprint/scope");
    }
  },
  attenuate: () => [],
  attenuationReference: {
    attestationVersion: "kyoto-no-attenuations.v1", referenceKind: "reviewedSource",
    referenceUrl: KYOTO_DATASET_URL, checkedAt: "2026-09-30",
  },
  crossReleaseValidated: false,
  completeness: "partial",
};
