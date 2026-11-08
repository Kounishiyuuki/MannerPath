// ADR-0018 D-A/D-R/D-C: normalized first-party facts; the official address's ABR point is a facility
// representative point only. No smoking-place coordinate, opening hours or tobacco support is inferred.
// Standalone until the shared reviewed-facility adapter (#408) lands; not yet registered in SOURCE_ADAPTERS.
// Review: services/data-pipeline/fixtures/hotel-sanraku-kanazawa-smoking-places/PROVENANCE.md.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const HOTEL_SANRAKU_KANAZAWA_SOURCE_ID = "hotel-sanraku-kanazawa-smoking-places";
export const HOTEL_SANRAKU_KANAZAWA_PAGE_URL = "https://sanraku.kenhotels.com/hakuchoro/faq/";
export const HOTEL_SANRAKU_KANAZAWA_FIXTURE_SHA256 = "5a86fa29639fa2968de9ba92b3773bbf2acf7d9bd150b254b8bab8dea0f54384";
export const HOTEL_SANRAKU_KANAZAWA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: HOTEL_SANRAKU_KANAZAWA_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:56:57Z", httpLastModified: null,
};
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const VALUES: readonly string[] = ["hotel-sanraku-kanazawa", "金沢白鳥路 ホテル山楽 喫煙スペース（エントランス付近屋外・地下駐車場）", "金沢白鳥路 ホテル山楽", "facility", "ロビーエントランス付近の屋外・地下駐車場", "石川県金沢市丸の内6-3", "other", "https://sanraku.kenhotels.com/hakuchoro/faq/", "2026-11-08", "36.568208225", "136.662038903", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市丸の内6-3 出力=石川県金沢市丸の内6-3"];
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
function row(values: readonly string[]): readonly string[] {
  if (JSON.stringify(values) !== JSON.stringify(VALUES)) throw new Error("hotel-sanraku-kanazawa: not the reviewed fact row");
  return values;
}
function areaPoint(values: readonly string[]) {
  const v = row(values);
  return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
}
function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(VALUES);
  return { anchorId: "aa_hotelsanrakukanazawa", areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: HOTEL_SANRAKU_KANAZAWA_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: VALUES[0], originReference: "hotel-sanraku-kanazawa-page-facts.csv#hotel-sanraku-kanazawa",
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
      { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: "hotel-sanraku-kanazawa.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "hotel-sanraku-kanazawa.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "hotel-sanraku-kanazawa.normalizedName.v1" },
      { field: "hostType", columns: ["host_type"], rule: "hotel-sanraku-kanazawa.statedHost.v1" },
    ],
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "other", environment: "unknown" },
  };
  return anchoredObservation(base, anchorFor(HOTEL_SANRAKU_KANAZAWA_FIXTURE_SHA256), ["area_name", "area_scope"]);
}
export const HOTEL_SANRAKU_KANAZAWA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: HOTEL_SANRAKU_KANAZAWA_SOURCE_ID, displayName: "金沢白鳥路 ホテル山楽 喫煙スペース（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, publicationStatus: "approved",
    attributionText: `出典：金沢白鳥路 ホテル山楽公式サイト ${HOTEL_SANRAKU_KANAZAWA_PAGE_URL}（2026-11-08確認）。`
      + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
      + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
    rightsBasis: { kind: "factReference", pageUrls: [HOTEL_SANRAKU_KANAZAWA_PAGE_URL],
      termsUrls: ["https://sanraku.kenhotels.com/hakuchoro/faq/", "https://kenhotels.com/privacy/"],
      termsReading: "ホテル公式FAQのフッターは© Ken Hotels & Resorts Holdings Ltd.。FAQ・ナビゲーション・フッターとリンクされたプライバシーポリシーを確認し、情報利用・データ取得・DB化の明示禁止は確認されず。プライバシーポリシーは個人情報の扱いでコンテンツの利用許諾ではない。ADR-0018 D-Rによる正規化事実（喫煙スペースの有無・場所の区分・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。館内は全館禁煙で喫煙ルームはないと公式FAQが述べるため、館内喫煙室としては扱わない。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
      prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  },
  parserVersion: "hotel-sanraku-kanazawa-page-facts.v1", mappingVersion: "hotel-sanraku-kanazawa-page-facts.map.v1", resolverVersion: "hotel-sanraku-kanazawa-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("hotel-sanraku-kanazawa: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== HOTEL_SANRAKU_KANAZAWA_FIXTURE_SHA256 || release.sourceUrl !== HOTEL_SANRAKU_KANAZAWA_PAGE_URL
      || release.observedOn !== "2026-11-08" || observations.length !== 1) throw new Error("hotel-sanraku-kanazawa: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "hotel-sanraku-kanazawa-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: HOTEL_SANRAKU_KANAZAWA_PAGE_URL, checkedAt: "2026-11-08" },
  completeness: "partial", crossReleaseValidated: false,
};
