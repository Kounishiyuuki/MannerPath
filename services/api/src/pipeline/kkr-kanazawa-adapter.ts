// ADR-0018 D-A/D-R/D-C: normalized first-party facts; the official address's ABR point is a facility
// representative point only. No smoking-place coordinate, opening hours or tobacco support is inferred.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const KKR_KANAZAWA_SOURCE_ID = "kkr-kanazawa-smoking-places";
export const KKR_KANAZAWA_PAGE_URL = "https://kanazawa.kkr.or.jp/facilities/";
export const KKR_KANAZAWA_FIXTURE_SHA256 = "dee2776a66e4e6c018684c7213b85366919377126482e999d49ba24ed23d65c8";
export const KKR_KANAZAWA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: KKR_KANAZAWA_PAGE_URL, observedOn: "2026-11-07", fetchedAt: "2026-11-07T18:59:18Z", httpLastModified: null,
};
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const VALUES: readonly string[] = ["kkr", "KKRホテル金沢 喫煙所（1階・3階）", "KKRホテル金沢", "facility", "1階ロビー入口側|3階エレベーター側", "石川県金沢市大手町2-32", "other", "https://kanazawa.kkr.or.jp/facilities/", "2026-11-07", "36.568729789", "136.660338131", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市大手町2-32 出力=石川県金沢市大手町2-32"];
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
function row(values: readonly string[]): readonly string[] {
  if (JSON.stringify(values) !== JSON.stringify(VALUES)) throw new Error("kkr-kanazawa: not the reviewed fact row");
  return values;
}
function areaPoint(values: readonly string[]) {
  const v = row(values);
  return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
}
function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(VALUES);
  return { anchorId: "aa_kkrkanazawa", areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: KKR_KANAZAWA_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: VALUES[0], originReference: "kkr-kanazawa-page-facts.csv#kkr",
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Codex source-review", reviewedOn: "2026-11-07",
    areaScope: "facility", anchorBasis: p.basis };
}
function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")], supportsPaper: "unknown", supportsHeated: "unknown",
    // Host hours and grounds gate hours are not smoking-place hours. Non-customer access is not established.
    openingHours: { status: "none", raw: null, parsed: null }, lifecycle: "active",
    provenance: [
      { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: "kkr-kanazawa.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "kkr-kanazawa.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "kkr-kanazawa.normalizedName.v1" },
      { field: "hostType", columns: ["host_type"], rule: "kkr-kanazawa.statedHost.v1" },
    ],
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "other", environment: "unknown" },
  };
  return anchoredObservation(base, anchorFor(KKR_KANAZAWA_FIXTURE_SHA256), ["area_name", "area_scope"]);
}
export const KKR_KANAZAWA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: KKR_KANAZAWA_SOURCE_ID, displayName: "KKRホテル金沢 喫煙場所（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, publicationStatus: "approved",
    attributionText: `出典：KKRホテル金沢公式サイト ${KKR_KANAZAWA_PAGE_URL}（2026-11-07確認）。`
      + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
      + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
    rightsBasis: { kind: "factReference", pageUrls: [KKR_KANAZAWA_PAGE_URL],
      termsUrls: [KKR_KANAZAWA_PAGE_URL, "https://kanazawa.kkr.or.jp/privacy/", "https://www.kkr.or.jp/siteriyo.html"],
      termsReading: "ホテル公式ページは国家公務員共済組合連合会の著作権留保。ホテルのナビゲーション・フッター・プライバシーポリシーと同一ホスト内の限定検索を確認し、情報利用・データ取得・DB化の明示禁止は確認されず。親サイト利用条件の冒頭はリンク先の他サイトへの非適用を述べ、§3は商用目的の複製に事前連絡を要求する。ホテルへの適用範囲に法的確定判断はせず、親サイトの許諾・転載許可には依拠しない。ADR-0018 D-Rによる正規化事実のみの参照で文章・写真・図面・ロゴは複製しない。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
      prohibitsInformationUse: false, reviewedBy: "Codex source-review", reviewedOn: "2026-11-07" },
  },
  parserVersion: "kkr-kanazawa-page-facts.v1", mappingVersion: "kkr-kanazawa-page-facts.map.v1", resolverVersion: "kkr-kanazawa-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("kkr-kanazawa: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Codex source-review", reviewedOn: "2026-11-07" },
  reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== KKR_KANAZAWA_FIXTURE_SHA256 || release.sourceUrl !== KKR_KANAZAWA_PAGE_URL
      || release.observedOn !== "2026-11-07" || observations.length !== 1) throw new Error("kkr-kanazawa: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "kkr-kanazawa-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: KKR_KANAZAWA_PAGE_URL, checkedAt: "2026-11-07" },
  completeness: "partial", crossReleaseValidated: false,
};
