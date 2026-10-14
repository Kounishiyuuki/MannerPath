// 松山空港 喫煙場所: an ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact sheet
// for one official page (services/data-pipeline/fixtures/matsuyama-airport-smoking-places/PROVENANCE.md), not a publisher
// file. Existence comes from the page (factReference); the pin is a reviewed facility anchor from 国土数値情報, so the
// spot is areaApproximate with scope `facility` and is never presented as the smoking place's own point.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const MATSUYAMA_AIRPORT_SOURCE_ID = "matsuyama-airport-smoking-places";
export const MATSUYAMA_AIRPORT_PAGE_URL = "https://www.matsuyama-airport.co.jp/service/smoking.html";
export const MATSUYAMA_AIRPORT_FIXTURE_SHA256 = "fdb3471cd4880b47d698f2dc0480c8523d1f490f33f7815f8ad4a072831e918e";
// ADR-0018 §5 (D-C): observedOn is the check day, not the page's publication/closure-notice date. It records when
// the current first-party scope was checked (checked_at). lastVerifiedAt shows that check, not a site visit.
export const MATSUYAMA_AIRPORT_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: MATSUYAMA_AIRPORT_PAGE_URL, observedOn: "2026-10-14", fetchedAt: "2026-10-13T17:59:58Z", httpLastModified: null,
};
const C28_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html";
export const MATSUYAMA_AIRPORT_ATTRIBUTION_TEXT = "出典：松山空港公式サイト https://www.matsuyama-airport.co.jp/（2026-10-14確認）。"
  + `位置の目安：国土数値情報（空港データ）（国土交通省） ${C28_URL} 令和3年度のターミナルビル位置。`
  + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。各提供者による推奨・保証を意味しません。";

const HEADER = ["fact_id", "place_name", "area_name", "area_kind", "area_scope", "zones", "spot_type", "access_type", "environment",
  "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);

function row(values: readonly string[]): readonly string[] {
  if (values.length !== HEADER.length) throw new Error("matsuyama-airport: unexpected record shape");
  if (JSON.stringify(values) !== JSON.stringify(MATSUYAMA_FACT_VALUES)) {
    throw new Error("matsuyama-airport: record is not the reviewed fact shape");
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
  const p = areaPoint(MATSUYAMA_FACT_VALUES);
  return {
    anchorId: "aa_matsuyamaairportterminal", areaName: p.areaName, areaKind: "airport", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: MATSUYAMA_AIRPORT_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: "matsuyama-airport-terminal", originReference: "matsuyama-airport-page-facts.csv#matsuyama-airport-terminal",
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Codex source-review", reviewedOn: "2026-10-14",
    areaScope: "facility", anchorBasis: p.basis,
  };
}

// The reviewed row, kept here so the anchor registry entry is derived from exactly the pinned fact sheet.
const MATSUYAMA_FACT_VALUES: readonly string[] = [
  "matsuyama-airport-terminal",
  "松山空港 喫煙場所（施設内外5か所・一部は保安検査後）",
  "松山空港 旅客ターミナル",
  "airport",
  "facility",
  "国内線2F出発ロビー|国内線2F搭乗待合室|国際線2F搭乗待合室|屋外ジェットスターカウンター東側|屋外国際線到着口側",
  "unknown",
  "unknown",
  "unknown",
  "airport",
  "https://www.matsuyama-airport.co.jp/service/smoking.html",
  "2026-10-14",
  "33.82877800",
  "132.70411100",
  "referenceDatasetPoint",
  "国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00053 松山空港 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35",
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
      { field: "existence", columns: factColumns, rule: "matsuyama-airport.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "matsuyama-airport.listedOnCurrentPage.v1" },
      { field: "name", columns: ["place_name"], rule: "matsuyama-airport.normalizedName.v1" },
      // The aggregate includes security-restricted and unspecified zones; access remains unknown.
      { field: "accessType", columns: ["access_type", "zones"], rule: "matsuyama-airport.mixedZoneAccess.v1" },
      { field: "hostType", columns: ["host_type"], rule: "matsuyama-airport.airportHost.v1" },
    ],
    classification: {
      spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "airport", environment: "unknown",
    },
  };
  const anchor = anchorFor(MATSUYAMA_AIRPORT_FIXTURE_SHA256);
  if (anchor.latitude !== p.latitude || anchor.longitude !== p.longitude) throw new Error("matsuyama-airport: record does not state the reviewed anchor");
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

export const MATSUYAMA_AIRPORT_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: MATSUYAMA_AIRPORT_SOURCE_ID, displayName: "松山空港 喫煙場所（公式サイト）", kind: "operator",
    licenseName: null, licenseUrl: null, attributionText: MATSUYAMA_AIRPORT_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [MATSUYAMA_AIRPORT_PAGE_URL],
      termsUrls: ["https://www.matsuyama-airport.co.jp/links.html"],
      termsReading: "links.html: リンクについて: 著作権・複製配信の表現保護を確認。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。公開リンクはホームページのみ。",
      prohibitsInformationUse: false, reviewedBy: "Codex source-review", reviewedOn: "2026-10-14",
    },
  },
  parserVersion: "matsuyama-airport-page-facts.v1", mappingVersion: "matsuyama-airport-page-facts.map.v1", resolverVersion: "matsuyama-airport-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== 1) throw new Error("matsuyama-airport: unexpected fact sheet");
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
    if (release.contentSha256 !== MATSUYAMA_AIRPORT_FIXTURE_SHA256 || release.sourceUrl !== MATSUYAMA_AIRPORT_PAGE_URL
      || release.observedOn !== "2026-10-14" || observations.length !== 1
      || observationFacts(observations[0]) !== observationFacts(observe(MATSUYAMA_FACT_VALUES))) throw new Error("matsuyama-airport: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "matsuyama-airport-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: MATSUYAMA_AIRPORT_PAGE_URL, checkedAt: "2026-10-14" },
  completeness: "partial", crossReleaseValidated: false,
};
