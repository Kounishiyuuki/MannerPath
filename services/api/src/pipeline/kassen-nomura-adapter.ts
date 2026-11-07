// ADR-0018 D-A/D-R/D-C: normalized first-party facts; the official address's ABR point is a facility
// representative point only. No smoking-place coordinate, opening hours or tobacco support is inferred.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const KASSEN_NOMURA_SOURCE_ID = "kassen-nomura-smoking-places";
export const KASSEN_NOMURA_PAGE_URL = "https://www.kassen-nomura.com/about/";
export const KASSEN_NOMURA_FIXTURE_SHA256 = "481566bb5f1d9973c3907edfacfe1c08f8353c28d2d3146d6215a3ce732d8b5c";
export const KASSEN_NOMURA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: KASSEN_NOMURA_PAGE_URL, observedOn: "2026-11-07", fetchedAt: "2026-11-07T13:20:36Z", httpLastModified: null,
};
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const VALUES: readonly string[] = ["nomura", "割鮮のむら 店外喫煙スペース", "割鮮のむら", "facility", "店外（店内禁煙）", "石川県金沢市泉野出町3-3-32", "restaurantOrCafe", "https://www.kassen-nomura.com/about/", "2026-11-07", "36.539788283", "136.649160875", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市泉野出町3-3-32 出力=石川県金沢市泉野出町3丁目3-32"];
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
function row(values: readonly string[]): readonly string[] {
  if (JSON.stringify(values) !== JSON.stringify(VALUES)) throw new Error("kassen-nomura: not the reviewed fact row");
  return values;
}
function areaPoint(values: readonly string[]) {
  const v = row(values);
  return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
}
function anchorFor(releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(VALUES);
  return { anchorId: "aa_kassennomura", areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: KASSEN_NOMURA_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: VALUES[0], originReference: "kassen-nomura-page-facts.csv#nomura",
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
      { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: "kassen-nomura.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "kassen-nomura.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "kassen-nomura.normalizedName.v1" },
      { field: "hostType", columns: ["host_type"], rule: "kassen-nomura.statedHost.v1" },
    ],
    classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "restaurantOrCafe", environment: "unknown" },
  };
  return anchoredObservation(base, anchorFor(KASSEN_NOMURA_FIXTURE_SHA256), ["area_name", "area_scope"]);
}
export const KASSEN_NOMURA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: KASSEN_NOMURA_SOURCE_ID, displayName: "割鮮のむら 喫煙場所（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, publicationStatus: "approved",
    attributionText: `出典：割鮮のむら公式サイト ${KASSEN_NOMURA_PAGE_URL}（2026-11-07確認）。`
      + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
      + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
    rightsBasis: { kind: "factReference", pageUrls: ["https://www.kassen-nomura.com/about/"],
      termsUrls: [KASSEN_NOMURA_PAGE_URL],
      termsReading: "公式ページのフッターは著作権留保（Copyright &copy; Kassen Nomura）。当該ページ・公式トップのナビゲーションとフッターを確認し、情報利用・データ取得・データベース化を明示的に禁止する条項や別のサイト利用規約へのリンクは確認されず。正規化事実のみ参照し、文章・写真・地図は転載しない。オープンライセンスの付与を意味しない。",
      prohibitsInformationUse: false, reviewedBy: "Codex source-review", reviewedOn: "2026-11-07" },
  },
  parserVersion: "kassen-nomura-page-facts.v1", mappingVersion: "kassen-nomura-page-facts.map.v1", resolverVersion: "kassen-nomura-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("kassen-nomura: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Codex source-review", reviewedOn: "2026-11-07" },
  reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== KASSEN_NOMURA_FIXTURE_SHA256 || release.sourceUrl !== KASSEN_NOMURA_PAGE_URL
      || release.observedOn !== "2026-11-07" || observations.length !== 1) throw new Error("kassen-nomura: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "kassen-nomura-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: KASSEN_NOMURA_PAGE_URL, checkedAt: "2026-11-07" },
  completeness: "partial", crossReleaseValidated: false,
};
