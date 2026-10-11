// 小松空港 喫煙場所: the first ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact sheet
// for one official page (services/data-pipeline/fixtures/komatsu-airport-smoking-places/PROVENANCE.md), not a publisher
// file. Existence comes from the page (factReference); the pin is a reviewed facility anchor from 国土数値情報, so the
// spot is areaApproximate with scope `facility` and is never presented as the smoking place's own point.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const KOMATSU_AIRPORT_SOURCE_ID = "komatsu-airport-smoking-places";
export const KOMATSU_AIRPORT_PAGE_URL = "https://www.komatsuairport.jp/faq/q85.html";
export const KOMATSU_AIRPORT_FIXTURE_SHA256 = "d6ea235279d6a83e3b605c67f98b4d7b593c8ca80703d367ddb8444604a168a3";
// ADR-0018 §5 (D-C): the page states no date. observedOn is the day the publisher's CURRENT page was checked to list
// the places (checked_at), which is what lastVerifiedAt then shows; it is not a site visit and not a publisher date claim.
export const KOMATSU_AIRPORT_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: KOMATSU_AIRPORT_PAGE_URL, observedOn: "2026-10-11", fetchedAt: "2026-10-11T00:00:00Z", httpLastModified: null,
};
const C28_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html";
export const KOMATSU_AIRPORT_ATTRIBUTION_TEXT = `出典：小松空港ホームページ「喫煙場所はどこですか。」 ${KOMATSU_AIRPORT_PAGE_URL}（2026-10-11確認）。`
  + `位置の目安：国土数値情報（空港データ）（国土交通省） ${C28_URL}（2026-10-11取得）のターミナルビル位置。`
  + "MannerPathが事実のみを正規化して作成し、ピンは施設の代表点で喫煙場所そのものの位置ではありません。小松空港協議会・国土交通省による推奨・保証を意味しません。";

const HEADER = ["fact_id", "place_name", "area_name", "area_kind", "area_scope", "zones", "spot_type", "access_type", "environment",
  "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
const DECIMAL = /^[0-9]+\.[0-9]+$/;

function row(values: readonly string[]): readonly string[] {
  if (values.length !== HEADER.length) throw new Error("komatsu-airport: unexpected record shape");
  if (values[col("fact_id")] !== "komatsu-airport-terminal" || values[col("page_url")] !== KOMATSU_AIRPORT_PAGE_URL
    || values[col("area_kind")] !== "airport" || values[col("area_scope")] !== "facility"
    || values[col("anchor_basis")] !== "referenceDatasetPoint" || !/^\d{4}-\d{2}-\d{2}$/.test(values[col("checked_at")])
    || !DECIMAL.test(values[col("anchor_latitude")]) || !DECIMAL.test(values[col("anchor_longitude")])) {
    throw new Error("komatsu-airport: record is not the reviewed fact shape");
  }
  return values;
}

function areaPoint(values: readonly string[]) {
  const v = row(values);
  return {
    areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "referenceDatasetPoint" as const, reference: v[col("anchor_reference")] },
  };
}

function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(KOMATSU_FACT_VALUES);
  return {
    anchorId: "aa_komatsuairportterminal", areaName: p.areaName, areaKind: "airport", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: KOMATSU_AIRPORT_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: "komatsu-airport-terminal", originReference: "komatsu-airport-page-facts.csv#komatsu-airport-terminal",
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "maintainer", reviewedOn: "2026-10-11",
    areaScope: "facility", anchorBasis: p.basis,
  };
}

// The reviewed row, kept here so the anchor registry entry is derived from exactly the pinned fact sheet.
const KOMATSU_FACT_VALUES: readonly string[] = [
  "komatsu-airport-terminal", "小松空港 喫煙場所（ターミナル内外4か所・一部は保安検査後）", "小松空港 旅客ターミナル", "airport", "facility",
  "国際線2F出発ロビー|国内線搭乗待合室（ANAラウンジ横）|国際線搭乗待合室|屋外（バス乗り場付近）", "unknown", "public", "unknown", "airport",
  KOMATSU_AIRPORT_PAGE_URL, "2026-10-11", "36.401889", "136.413528", "referenceDatasetPoint",
  "国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00071 小松飛行場 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35",
];

function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const p = areaPoint(v);
  // Komatsu city extent, in addition to global ranges: refuses swapped axes and a point outside the airport's city.
  if (p.latitude < 36.33 || p.latitude > 36.46 || p.longitude < 136.35 || p.longitude > 136.55) throw new Error("komatsu-airport: anchor out of range");
  const factColumns = ["place_name", "zones", "page_url", "checked_at"];
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")],
    supportsPaper: "unknown", supportsHeated: "unknown",
    // The page states no hours for the smoking places; airport/facility hours are never transferred.
    openingHours: { status: "none", raw: null, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: factColumns, rule: "komatsu-airport.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "komatsu-airport.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "komatsu-airport.normalizedName.v1" },
      { field: "accessType", columns: ["access_type", "zones"], rule: "komatsu-airport.publicZonesListed.v1" },
      { field: "hostType", columns: ["host_type"], rule: "komatsu-airport.airportHost.v1" },
    ],
    classification: {
      spotType: "unknown", spotSubtype: null, accessType: "public", accessDetail: null, hostType: "airport", environment: "unknown",
    },
  };
  const anchor = anchorFor(KOMATSU_AIRPORT_FIXTURE_SHA256);
  if (anchor.latitude !== p.latitude || anchor.longitude !== p.longitude) throw new Error("komatsu-airport: record does not state the reviewed anchor");
  return anchoredObservation(base, anchor, ["area_name", "area_scope"]);
}

export const KOMATSU_AIRPORT_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: KOMATSU_AIRPORT_SOURCE_ID, displayName: "小松空港 喫煙場所（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, attributionText: KOMATSU_AIRPORT_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [KOMATSU_AIRPORT_PAGE_URL],
      termsUrls: ["https://www.komatsuairport.jp/cmn/copyright.html", "https://www.komatsuairport.jp/cmn/disclaimer.html"],
      termsReading: "著作権について: 個々の情報（文字、写真、イラスト等）は著作権の対象、著作権法上認められた場合を除き無断で複製・転用不可。"
        + "免責事項: 正確性の不保証、リンクは原則フリー。情報の利用・データ取得・データベース化を禁止する条項なし。",
      prohibitsInformationUse: false, reviewedBy: "maintainer", reviewedOn: "2026-10-11",
    },
  },
  parserVersion: "komatsu-airport-page-facts.v1", mappingVersion: "komatsu-airport-page-facts.map.v1", resolverVersion: "komatsu-airport-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("komatsu-airport: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: (values) => row(values)[col("fact_id")],
  includesRecord: () => true,
  areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "maintainer", reviewedOn: "2026-10-11" },
  reviewedAnchors: (releaseContentSha256) => [anchorFor(releaseContentSha256)],
  observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== KOMATSU_AIRPORT_FIXTURE_SHA256 || release.sourceUrl !== KOMATSU_AIRPORT_PAGE_URL
      || release.observedOn !== "2026-10-11" || observations.length !== 1) throw new Error("komatsu-airport: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "komatsu-airport-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: KOMATSU_AIRPORT_PAGE_URL, checkedAt: "2026-10-11" },
  completeness: "partial", crossReleaseValidated: false,
};
