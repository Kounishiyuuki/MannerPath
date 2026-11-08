// ADR-0018 D-A/D-R/D-C: normalized first-party facts; the official address's ABR point is a facility
// representative point only. No smoking-place coordinate, opening hours or tobacco support is inferred.
// Standalone until the shared reviewed-facility adapter (#408) lands; not yet registered in SOURCE_ADAPTERS.
// Review: services/data-pipeline/fixtures/manten-kanazawa-ekimae-smoking-places/PROVENANCE.md.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const MANTEN_KANAZAWA_EKIMAE_SOURCE_ID = "manten-kanazawa-ekimae-smoking-places";
export const MANTEN_KANAZAWA_EKIMAE_PAGE_URL = "https://www.manten-hotel.com/kanazawa/faq/";
export const MANTEN_KANAZAWA_EKIMAE_FIXTURE_SHA256 = "74278ffe737cba22bf7286a5794bf53374ab94ad51bc42d706c9b0f6ab1339ca";
export const MANTEN_KANAZAWA_EKIMAE_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: MANTEN_KANAZAWA_EKIMAE_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:56:55Z", httpLastModified: null,
};
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const VALUES: readonly string[] = ["manten-kanazawa-ekimae", "マンテンホテル金沢駅前 喫煙室（1F・4F・7F）", "マンテンホテル金沢駅前", "facility", "1F駐車場入口横・4Fエレベーター付近・7Fエレベーター付近", "石川県金沢市北安江1-6-1", "other", "https://www.manten-hotel.com/kanazawa/faq/", "2026-11-08", "36.581441767", "136.649589106", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市北安江1-6-1 出力=石川県金沢市北安江1丁目6-1"];
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
function row(values: readonly string[]): readonly string[] {
  if (JSON.stringify(values) !== JSON.stringify(VALUES)) throw new Error("manten-kanazawa-ekimae: not the reviewed fact row");
  return values;
}
function areaPoint(values: readonly string[]) {
  const v = row(values);
  return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
}
function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(VALUES);
  return { anchorId: "aa_mantenkanazawaekimae", areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: MANTEN_KANAZAWA_EKIMAE_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: VALUES[0], originReference: "manten-kanazawa-ekimae-page-facts.csv#manten-kanazawa-ekimae",
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
      { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: "manten-kanazawa-ekimae.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "manten-kanazawa-ekimae.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "manten-kanazawa-ekimae.normalizedName.v1" },
      { field: "hostType", columns: ["host_type"], rule: "manten-kanazawa-ekimae.statedHost.v1" },
    ],
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "other", environment: "unknown" },
  };
  return anchoredObservation(base, anchorFor(MANTEN_KANAZAWA_EKIMAE_FIXTURE_SHA256), ["area_name", "area_scope"]);
}
export const MANTEN_KANAZAWA_EKIMAE_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: MANTEN_KANAZAWA_EKIMAE_SOURCE_ID, displayName: "マンテンホテル金沢駅前 喫煙室（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, publicationStatus: "approved",
    attributionText: `出典：マンテンホテル金沢駅前公式サイト ${MANTEN_KANAZAWA_EKIMAE_PAGE_URL}（2026-11-08確認）。`
      + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
      + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
    rightsBasis: { kind: "factReference", pageUrls: [MANTEN_KANAZAWA_EKIMAE_PAGE_URL],
      termsUrls: ["https://www.manten-hotel.com/kanazawa/faq/", "https://manten-hotel.co.jp/privacy/"],
      termsReading: "ホテル公式FAQのフッターは著作権留保（Copyright © Manten hotel Co.,Ltd）。FAQ・ナビゲーション・フッターとリンクされたプライバシーポリシーを確認し、情報利用・データ取得・DB化の明示禁止は確認されず。プライバシーポリシーは個人情報の扱いでコンテンツの利用許諾ではない。ADR-0018 D-Rによる正規化事実（喫煙室の有無・階・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。4F・7Fは客室階のエレベーター付近で、宿泊者以外の利用可否は未確認のまま扱う。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
      prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  },
  parserVersion: "manten-kanazawa-ekimae-page-facts.v1", mappingVersion: "manten-kanazawa-ekimae-page-facts.map.v1", resolverVersion: "manten-kanazawa-ekimae-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("manten-kanazawa-ekimae: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== MANTEN_KANAZAWA_EKIMAE_FIXTURE_SHA256 || release.sourceUrl !== MANTEN_KANAZAWA_EKIMAE_PAGE_URL
      || release.observedOn !== "2026-11-08" || observations.length !== 1) throw new Error("manten-kanazawa-ekimae: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "manten-kanazawa-ekimae-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: MANTEN_KANAZAWA_EKIMAE_PAGE_URL, checkedAt: "2026-11-08" },
  completeness: "partial", crossReleaseValidated: false,
};
