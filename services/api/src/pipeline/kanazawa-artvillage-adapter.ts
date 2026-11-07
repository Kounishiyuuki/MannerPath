// ADR-0018 D-A/D-R/D-C: normalized first-party facts; the official address's ABR point is a facility
// representative point only. No smoking-place coordinate, opening hours or tobacco support is inferred.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const KANAZAWA_ARTVILLAGE_SOURCE_ID = "kanazawa-artvillage-smoking-places";
export const KANAZAWA_ARTVILLAGE_PAGE_URL = "https://www.artvillage.gr.jp/facilities/square";
export const KANAZAWA_ARTVILLAGE_FIXTURE_SHA256 = "20636c742d1d0e272af054d28c13f58ea85415f85ff9b91ee521337299ba757f";
export const KANAZAWA_ARTVILLAGE_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: KANAZAWA_ARTVILLAGE_PAGE_URL, observedOn: "2026-11-07", fetchedAt: "2026-11-07T13:20:37Z", httpLastModified: null,
};
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const VALUES: readonly string[] = ["artvillage", "金沢市民芸術村 大和町広場 園路喫煙場所", "金沢市民芸術村", "facility", "大和町広場の園路", "石川県金沢市大和町1-1", "other", "https://www.artvillage.gr.jp/facilities/square", "2026-11-07", "36.569565872", "136.641441103", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市大和町1-1 出力=石川県金沢市大和町1-1"];
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
function row(values: readonly string[]): readonly string[] {
  if (JSON.stringify(values) !== JSON.stringify(VALUES)) throw new Error("kanazawa-artvillage: not the reviewed fact row");
  return values;
}
function areaPoint(values: readonly string[]) {
  const v = row(values);
  return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
}
function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(VALUES);
  return { anchorId: "aa_kanazawaartvillage", areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: KANAZAWA_ARTVILLAGE_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: VALUES[0], originReference: "kanazawa-artvillage-page-facts.csv#artvillage",
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
      { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: "kanazawa-artvillage.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "kanazawa-artvillage.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "kanazawa-artvillage.normalizedName.v1" },
      { field: "hostType", columns: ["host_type"], rule: "kanazawa-artvillage.statedHost.v1" },
    ],
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "other", environment: "unknown" },
  };
  return anchoredObservation(base, anchorFor(KANAZAWA_ARTVILLAGE_FIXTURE_SHA256), ["area_name", "area_scope"]);
}
export const KANAZAWA_ARTVILLAGE_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: KANAZAWA_ARTVILLAGE_SOURCE_ID, displayName: "金沢市民芸術村 喫煙場所（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, publicationStatus: "approved",
    attributionText: `出典：金沢市民芸術村公式サイト ${KANAZAWA_ARTVILLAGE_PAGE_URL}（2026-11-07確認）。`
      + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
      + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
    rightsBasis: { kind: "factReference", pageUrls: ["https://www.artvillage.gr.jp/facilities/square", "https://www.artvillage.gr.jp/access/"],
      termsUrls: [KANAZAWA_ARTVILLAGE_PAGE_URL],
      termsReading: "公式ページのフッターは著作権留保（Copyright © KANAZAWA CITIZEN'S ART CENTER. All Rights Reserved.）。当該ページ・公式トップのナビゲーションとフッターを確認し、情報利用・データ取得・データベース化を明示的に禁止する条項や別のサイト利用規約へのリンクは確認されず。正規化事実のみ参照し、文章・写真・地図は転載しない。オープンライセンスの付与を意味しない。",
      prohibitsInformationUse: false, reviewedBy: "Codex source-review", reviewedOn: "2026-11-07" },
  },
  parserVersion: "kanazawa-artvillage-page-facts.v1", mappingVersion: "kanazawa-artvillage-page-facts.map.v1", resolverVersion: "kanazawa-artvillage-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("kanazawa-artvillage: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Codex source-review", reviewedOn: "2026-11-07" },
  reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== KANAZAWA_ARTVILLAGE_FIXTURE_SHA256 || release.sourceUrl !== KANAZAWA_ARTVILLAGE_PAGE_URL
      || release.observedOn !== "2026-11-07" || observations.length !== 1) throw new Error("kanazawa-artvillage: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "kanazawa-artvillage-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: KANAZAWA_ARTVILLAGE_PAGE_URL, checkedAt: "2026-11-07" },
  completeness: "partial", crossReleaseValidated: false,
};
