// 広島空港 喫煙場所: an ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact sheet
// for one official page (services/data-pipeline/fixtures/hiroshima-airport-smoking-places/PROVENANCE.md), not a publisher
// file. Existence comes from the page (factReference); the pin is a reviewed facility anchor from 国土数値情報, so the
// spot is areaApproximate with scope `facility` and is never presented as the smoking place's own point.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const HIROSHIMA_AIRPORT_SOURCE_ID = "hiroshima-airport-smoking-places";
export const HIROSHIMA_AIRPORT_PAGE_URL = "https://www.hij.airport.jp/news/2025/02/terminalinfo-smokingarea.html";
export const HIROSHIMA_AIRPORT_FIXTURE_SHA256 = "559617124dfa4b85f4439476c45165032be9bad8115cb1e352d97a9f16dfdb8b";
// ADR-0018 §5 (D-C): observedOn is the check day, not the page's publication/closure-notice date. It records when
// the current first-party scope was checked (checked_at). lastVerifiedAt shows that check, not a site visit.
export const HIROSHIMA_AIRPORT_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: HIROSHIMA_AIRPORT_PAGE_URL, observedOn: "2026-10-14", fetchedAt: "2026-10-13T17:59:57Z", httpLastModified: null,
};
const C28_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html";
export const HIROSHIMA_AIRPORT_ATTRIBUTION_TEXT = "出典：広島空港公式サイト https://www.hij.airport.jp/（2026-10-14確認）。"
  + `位置の目安：国土数値情報（空港データ）（国土交通省） ${C28_URL} 令和3年度のターミナルビル位置。`
  + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。各提供者による推奨・保証を意味しません。";

const HEADER = ["fact_id", "place_name", "area_name", "area_kind", "area_scope", "zones", "spot_type", "access_type", "environment",
  "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);

function row(values: readonly string[]): readonly string[] {
  if (values.length !== HEADER.length) throw new Error("hiroshima-airport: unexpected record shape");
  if (JSON.stringify(values) !== JSON.stringify(HIROSHIMA_FACT_VALUES)) {
    throw new Error("hiroshima-airport: record is not the reviewed fact shape");
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
  const p = areaPoint(HIROSHIMA_FACT_VALUES);
  return {
    anchorId: "aa_hiroshimaairportterminal", areaName: p.areaName, areaKind: "airport", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: HIROSHIMA_AIRPORT_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: "hiroshima-airport-terminal", originReference: "hiroshima-airport-page-facts.csv#hiroshima-airport-terminal",
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Codex source-review", reviewedOn: "2026-10-14",
    areaScope: "facility", anchorBasis: p.basis,
  };
}

// The reviewed row, kept here so the anchor registry entry is derived from exactly the pinned fact sheet.
const HIROSHIMA_FACT_VALUES: readonly string[] = [
  "hiroshima-airport-terminal",
  "広島空港 喫煙場所（施設代表点・利用条件未確認）",
  "広島空港 旅客ターミナル",
  "airport",
  "facility",
  "1F国際線到着ロビー外|2F国際線チェックイン前|3F展望デッキ前",
  "unknown",
  "unknown",
  "unknown",
  "airport",
  "https://www.hij.airport.jp/news/2025/02/terminalinfo-smokingarea.html",
  "2026-10-14",
  "34.43986100",
  "132.91925000",
  "referenceDatasetPoint",
  "国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00079 広島空港 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35",
];

function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const p = areaPoint(v);
  const factColumns = ["place_name", "zones", "page_url", "checked_at"];
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")],
    supportsPaper: "unknown", supportsHeated: "unknown",
    // The page states no hours for the smoking places; airport/facility hours are never transferred.
    openingHours: { status: "none", raw: null, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: factColumns, rule: "hiroshima-airport.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "hiroshima-airport.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "hiroshima-airport.normalizedName.v1" },
      // No evidence establishes unrestricted access for every zone; aggregate access remains unknown.
      { field: "accessType", columns: ["access_type", "zones"], rule: "hiroshima-airport.unverifiedZoneAccess.v1" },
      { field: "hostType", columns: ["host_type"], rule: "hiroshima-airport.airportHost.v1" },
    ],
    classification: {
      spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "airport", environment: "unknown",
    },
  };
  const anchor = anchorFor(HIROSHIMA_AIRPORT_FIXTURE_SHA256);
  if (anchor.latitude !== p.latitude || anchor.longitude !== p.longitude) throw new Error("hiroshima-airport: record does not state the reviewed anchor");
  return anchoredObservation(base, anchor, ["area_name", "area_scope"]);
}

// Explicit field order survives observation persistence; object insertion order carries no authority.
function observationFacts(o: SourceObservation | undefined): string {
  if (!o) return "missing";
  const c = o.classification;
  return JSON.stringify([o.name, o.latitude, o.longitude, o.supportsPaper, o.supportsHeated,
    o.openingHours.status, o.openingHours.raw, o.openingHours.parsed, o.lifecycle, o.provenance,
    c?.spotType, c?.spotSubtype, c?.accessType, c?.accessDetail, c?.hostType, c?.environment,
    o.existenceEvidence, o.communityConfirmations, o.locationAnchorId]);
}

export const HIROSHIMA_AIRPORT_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: HIROSHIMA_AIRPORT_SOURCE_ID, displayName: "広島空港 喫煙場所（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, attributionText: HIROSHIMA_AIRPORT_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [HIROSHIMA_AIRPORT_PAGE_URL],
      termsUrls: ["https://www.hij.airport.jp/about/index.html"],
      termsReading: "about/index.html §1; homepage links §2: 著作権・複製配信の表現保護を確認。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。公開リンクはホームページのみ。",
      prohibitsInformationUse: false, reviewedBy: "Codex source-review", reviewedOn: "2026-10-14",
    },
  },
  parserVersion: "hiroshima-airport-page-facts.v1", mappingVersion: "hiroshima-airport-page-facts.map.v1", resolverVersion: "hiroshima-airport-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("hiroshima-airport: unexpected fact sheet");
    rows.forEach(row);
    return { header, rows };
  },
  upstreamRowRef: (values) => row(values)[col("fact_id")],
  includesRecord: () => true,
  areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Codex source-review", reviewedOn: "2026-10-14" },
  reviewedAnchors: (releaseContentSha256) => [anchorFor(releaseContentSha256)],
  observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== HIROSHIMA_AIRPORT_FIXTURE_SHA256 || release.sourceUrl !== HIROSHIMA_AIRPORT_PAGE_URL
      || release.observedOn !== "2026-10-14" || observations.length !== 1
      || observationFacts(observations[0]) !== observationFacts(observe(HIROSHIMA_FACT_VALUES))) throw new Error("hiroshima-airport: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "hiroshima-airport-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: HIROSHIMA_AIRPORT_PAGE_URL, checkedAt: "2026-10-14" },
  completeness: "partial", crossReleaseValidated: false,
};
