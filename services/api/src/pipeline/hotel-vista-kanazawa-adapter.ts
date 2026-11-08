// ADR-0018 D-A/D-R/D-C: normalized first-party facts; the official address's ABR point is a facility
// representative point only. No smoking-place coordinate, opening hours or tobacco support is inferred.
// Standalone until the shared reviewed-facility adapter (#408) lands; not yet registered in SOURCE_ADAPTERS.
// Review: services/data-pipeline/fixtures/hotel-vista-kanazawa-smoking-places/PROVENANCE.md.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const HOTEL_VISTA_KANAZAWA_SOURCE_ID = "hotel-vista-kanazawa-smoking-places";
export const HOTEL_VISTA_KANAZAWA_PAGE_URL = "https://kanazawa.hotel-vista.jp/ja/facilities";
export const HOTEL_VISTA_KANAZAWA_FIXTURE_SHA256 = "88156dd6147a2c917584a746609d4e8285e3c6287a9fc8253f4250252c00c6a6";
export const HOTEL_VISTA_KANAZAWA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: HOTEL_VISTA_KANAZAWA_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:57:00Z", httpLastModified: null,
};
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const VALUES: readonly string[] = ["hotel-vista-kanazawa", "ホテルビスタ金沢 喫煙ブース（2F）", "ホテルビスタ金沢", "facility", "2F", "石川県金沢市広岡2-13-27", "other", "https://kanazawa.hotel-vista.jp/ja/facilities", "2026-11-08", "36.580329911", "136.643377003", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市広岡2-13-27 出力=石川県金沢市広岡2丁目13-27"];
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
function row(values: readonly string[]): readonly string[] {
  if (JSON.stringify(values) !== JSON.stringify(VALUES)) throw new Error("hotel-vista-kanazawa: not the reviewed fact row");
  return values;
}
function areaPoint(values: readonly string[]) {
  const v = row(values);
  return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
}
function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(VALUES);
  return { anchorId: "aa_hotelvistakanazawa", areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: HOTEL_VISTA_KANAZAWA_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: VALUES[0], originReference: "hotel-vista-kanazawa-page-facts.csv#hotel-vista-kanazawa",
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
    areaScope: "facility", anchorBasis: p.basis };
}
function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")], supportsPaper: "unknown", supportsHeated: "unknown",
    // Hotel and check-in hours are not smoking-place hours. Use by non-guests is not established.
    openingHours: { status: "none", raw: null, parsed: null }, lifecycle: "active",
    provenance: [
      { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: "hotel-vista-kanazawa.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "hotel-vista-kanazawa.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "hotel-vista-kanazawa.normalizedName.v1" },
      { field: "hostType", columns: ["host_type"], rule: "hotel-vista-kanazawa.statedHost.v1" },
    ],
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "other", environment: "unknown" },
  };
  return anchoredObservation(base, anchorFor(HOTEL_VISTA_KANAZAWA_FIXTURE_SHA256), ["area_name", "area_scope"]);
}
export const HOTEL_VISTA_KANAZAWA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: HOTEL_VISTA_KANAZAWA_SOURCE_ID, displayName: "ホテルビスタ金沢 喫煙ブース（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, publicationStatus: "approved",
    attributionText: `出典：ホテルビスタ金沢公式サイト ${HOTEL_VISTA_KANAZAWA_PAGE_URL}（2026-11-08確認）。`
      + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
      + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
    rightsBasis: { kind: "factReference", pageUrls: [HOTEL_VISTA_KANAZAWA_PAGE_URL],
      termsUrls: ["https://kanazawa.hotel-vista.jp/ja/facilities", "https://kanazawa.hotel-vista.jp/ja/terms"],
      termsReading: "ホテル公式ページのフッターは© VISTA HOTEL MANAGEMENT CO.,Ltd.。「規約/約款/ポリシー」ページはインターネット宿泊予約システム利用規約で、私的利用以外の目的での本システムの無断利用を禁じるが、これは予約システムの利用に関する条項で、公開施設ページの事実参照を対象とする記載はなく、情報利用・DB化の明示禁止は確認されず。適用範囲に法的確定判断はしない。ADR-0018 D-Rによる正規化事実（喫煙ブースの有無・階・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。公式ページは喫煙ブース以外の館内を禁煙とする。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
      prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  },
  parserVersion: "hotel-vista-kanazawa-page-facts.v1", mappingVersion: "hotel-vista-kanazawa-page-facts.map.v1", resolverVersion: "hotel-vista-kanazawa-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("hotel-vista-kanazawa: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== HOTEL_VISTA_KANAZAWA_FIXTURE_SHA256 || release.sourceUrl !== HOTEL_VISTA_KANAZAWA_PAGE_URL
      || release.observedOn !== "2026-11-08" || observations.length !== 1) throw new Error("hotel-vista-kanazawa: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "hotel-vista-kanazawa-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: HOTEL_VISTA_KANAZAWA_PAGE_URL, checkedAt: "2026-11-08" },
  completeness: "partial", crossReleaseValidated: false,
};
