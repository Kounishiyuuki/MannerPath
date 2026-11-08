// ADR-0018 D-A/D-R/D-C: normalized first-party facts; the official address's ABR point is a facility
// representative point only. No smoking-place coordinate, opening hours or tobacco support is inferred.
// Standalone until the shared reviewed-facility adapter (#408) lands; not yet registered in SOURCE_ADAPTERS.
// Review: services/data-pipeline/fixtures/route-inn-kanazawa-ekimae-smoking-places/PROVENANCE.md.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const ROUTE_INN_KANAZAWA_EKIMAE_SOURCE_ID = "route-inn-kanazawa-ekimae-smoking-places";
export const ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL = "https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/";
export const ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_SHA256 = "4c3b9f32a145371b2bd45a38d9a0ccfba3ad05609886a264d02c60f1ac29035f";
export const ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:56:58Z", httpLastModified: null,
};
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const VALUES: readonly string[] = ["route-inn-kanazawa-ekimae", "ホテルルートイン金沢駅前 喫煙スペース（1F）", "ホテルルートイン金沢駅前", "facility", "1F", "石川県金沢市昭和町22番5号", "other", "https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/", "2026-11-08", "36.574896175", "136.646092219", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市昭和町22番5号 出力=石川県金沢市昭和町22-5"];
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
function row(values: readonly string[]): readonly string[] {
  if (JSON.stringify(values) !== JSON.stringify(VALUES)) throw new Error("route-inn-kanazawa-ekimae: not the reviewed fact row");
  return values;
}
function areaPoint(values: readonly string[]) {
  const v = row(values);
  return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
}
function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(VALUES);
  return { anchorId: "aa_routeinnkanazawaekimae", areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: ROUTE_INN_KANAZAWA_EKIMAE_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: VALUES[0], originReference: "route-inn-kanazawa-ekimae-page-facts.csv#route-inn-kanazawa-ekimae",
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
      { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: "route-inn-kanazawa-ekimae.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "route-inn-kanazawa-ekimae.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "route-inn-kanazawa-ekimae.normalizedName.v1" },
      { field: "hostType", columns: ["host_type"], rule: "route-inn-kanazawa-ekimae.statedHost.v1" },
    ],
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "other", environment: "unknown" },
  };
  return anchoredObservation(base, anchorFor(ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_SHA256), ["area_name", "area_scope"]);
}
export const ROUTE_INN_KANAZAWA_EKIMAE_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: ROUTE_INN_KANAZAWA_EKIMAE_SOURCE_ID, displayName: "ホテルルートイン金沢駅前 喫煙スペース（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, publicationStatus: "approved",
    attributionText: `出典：ホテルルートイン金沢駅前公式サイト ${ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL}（2026-11-08確認）。`
      + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
      + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
    rightsBasis: { kind: "factReference", pageUrls: [ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL],
      termsUrls: ["https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/", "https://www.route-inn.co.jp/reserve_rules/kiyaku/", "https://www.route-inn.co.jp/company/privacy/"],
      termsReading: "ホテル公式ページのフッターは著作権留保（Copyright © Route Inn Japan co., Ltd.）。フッターからリンクされたインターネット会員利用規約は会員サービスの利用に関する規約で、著作権等の権利侵害行為を禁止するが、公開ページの情報利用・データ取得・DB化の明示禁止は確認されず。プライバシーポリシーは個人情報の扱い。ADR-0018 D-Rによる正規化事実（喫煙スペースの有無・階・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。加熱式たばこ専用の客室は客室であり、この共用喫煙スペースの情報に含めない。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
      prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  },
  parserVersion: "route-inn-kanazawa-ekimae-page-facts.v1", mappingVersion: "route-inn-kanazawa-ekimae-page-facts.map.v1", resolverVersion: "route-inn-kanazawa-ekimae-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("route-inn-kanazawa-ekimae: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_SHA256 || release.sourceUrl !== ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL
      || release.observedOn !== "2026-11-08" || observations.length !== 1) throw new Error("route-inn-kanazawa-ekimae: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "route-inn-kanazawa-ekimae-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL, checkedAt: "2026-11-08" },
  completeness: "partial", crossReleaseValidated: false,
};
