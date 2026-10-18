// 中央区 民間指定喫煙場所: an ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact sheet for
// the ward's current list (services/data-pipeline/fixtures/chuo-private-smoking-places/PROVENANCE.md), not a publisher
// file. Existence and stated hours come from that page (factReference); each pin is the official address's ABR
// representative point (address-anchor.ts, `officialAddressGeocode`), so every spot is areaApproximate with scope
// `facility` and never the smoking place's point. Access, tobacco types, spot type and environment are not stated.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import { CHUO_PRIVATE_REVIEWED_ROWS } from "./chuo-private-facts.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const CHUO_PRIVATE_SOURCE_ID = "chuo-private-smoking-places";
export const CHUO_PRIVATE_PAGE_URL = "https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html";
export const CHUO_PRIVATE_FIXTURE_SHA256 = "464673d8e558c1bc9f9429fd58b5762d8a123f70fd9eb9285294248056ef1442";
// ADR-0018 §5 (D-C): observedOn is the check day. lastVerifiedAt shows that desk check, not a site visit.
export const CHUO_PRIVATE_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: CHUO_PRIVATE_PAGE_URL, observedOn: "2026-10-18", fetchedAt: "2026-10-18T10:56:21Z", httpLastModified: null,
};
export const CHUO_PRIVATE_ATTRIBUTION_TEXT = "出典：中央区ホームページ「中央区内指定喫煙場所一覧」"
  + `${CHUO_PRIVATE_PAGE_URL}（2026-10-18確認）。`
  + "位置の目安：アドレス・ベース・レジストリ（デジタル庁）を abr-geocoder で照合した所在地の代表点。"
  + "MannerPathが事実のみを正規化して作成。ピンは所在地の代表点で喫煙場所そのものの位置ではありません。中央区による推奨・保証を意味しません。";

export const CHUO_PRIVATE_HEADER = ["fact_id", "place_name", "zones", "area_scope", "hours", "hours_note", "official_address", "page_url", "checked_at",
  "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;
const col = (name: (typeof CHUO_PRIVATE_HEADER)[number]) => CHUO_PRIVATE_HEADER.indexOf(name);
const REFERENCE = /^abr-geocoder 2\.3\.1 abr-tokyo-6wards-2026-10-18:sha256:[0-9a-f]{64} residential_(detail|block) 入力=東京都中央区\S+ 出力=東京都中央区\S+( 除外=.+)?$/;

const REVIEWED = new Map(CHUO_PRIVATE_REVIEWED_ROWS.map((r) => [r[0], JSON.stringify(r)]));

function row(values: readonly string[]): readonly string[] {
  if (values.length !== CHUO_PRIVATE_HEADER.length) throw new Error("chuo-private: unexpected record shape");
  if (REVIEWED.get(values[col("fact_id")]) !== JSON.stringify(values) || values[col("anchor_basis")] !== "officialAddressGeocode"
    || !REFERENCE.test(values[col("anchor_reference")])) throw new Error("chuo-private: record is not a reviewed fact row");
  return values;
}

function areaPoint(values: readonly string[]) {
  const v = row(values);
  return {
    areaName: v[col("place_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] },
  };
}

function anchorFor(values: readonly string[], releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(values);
  const factId = values[col("fact_id")];
  return {
    anchorId: `aa_chuopriv${factId}`, areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: CHUO_PRIVATE_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: factId, originReference: `chuo-private-page-facts.csv#${factId}`,
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-18",
    areaScope: "facility", anchorBasis: p.basis,
  };
}

// Only an unqualified 午前0時から午後12時 is all day; every other stated range keeps its day/closure qualifiers (土日祝・
// 年末年始・休館日を除く, per-floor or per-weekday ranges), so it stays unparsed and openNow is never asserted from it.
function openingHours(v: readonly string[]): SourceObservation["openingHours"] {
  const hours = v[col("hours")];
  const note = v[col("hours_note")];
  if (hours === "午前0時から午後12時" && note === "") return { status: "parsed", raw: hours, parsed: { v: 1, kind: "allDay" } };
  return { status: "unparsed", raw: note === "" ? hours : `${hours}\n${note}`, parsed: null };
}

function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const factColumns = ["place_name", "zones", "official_address", "page_url", "checked_at"];
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")],
    supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: openingHours(v),
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: factColumns, rule: "chuo-private.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "chuo-private.listedWithoutSuspension.v1" },
      { field: "name", columns: ["place_name"], rule: "chuo-private.normalizedName.v1" },
      { field: "openingHours", columns: ["hours", "hours_note"], rule: "chuo-private.statedHours.v1" },
    ],
    // 民間指定喫煙場所: who may use each place is not stated on the page, so nothing is classified.
    classification: {
      spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: "unknown", environment: "unknown",
    },
  };
  return anchoredObservation(base, anchorFor(v, CHUO_PRIVATE_FIXTURE_SHA256), ["place_name", "area_scope"]);
}

export const CHUO_PRIVATE_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: CHUO_PRIVATE_SOURCE_ID, displayName: "中央区 民間指定喫煙場所", kind: "municipal",
    licenseName: null, licenseUrl: null, attributionText: CHUO_PRIVATE_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [CHUO_PRIVATE_PAGE_URL],
      termsUrls: ["https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/thissite.html"],
      termsReading: "このホームページの詳細情報「著作権について」: 掲載内容の著作権は区に帰属し、無断の転載・改変を不可とする表現保護。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。位置の目安はアドレス・ベース・レジストリ（公共データ利用規約1.0）。",
      prohibitsInformationUse: false, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-18",
    },
  },
  parserVersion: "chuo-private-page-facts.v1", mappingVersion: "chuo-private-page-facts.map.v1", resolverVersion: "chuo-private-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(CHUO_PRIVATE_HEADER) || rows.length !== CHUO_PRIVATE_REVIEWED_ROWS.length) throw new Error("chuo-private: unexpected fact sheet");
    rows.forEach(row);
    if (new Set(rows.map((v) => v[col("fact_id")])).size !== rows.length) throw new Error("chuo-private: duplicate fact row");
    if (new Set(rows.map((v) => `${v[col("anchor_latitude")]},${v[col("anchor_longitude")]}`)).size !== rows.length) throw new Error("chuo-private: two rows share an anchor");
    return { header, rows };
  },
  upstreamRowRef: (values) => row(values)[col("fact_id")],
  includesRecord: () => true,
  areaPoint,
  areaPointColumns: { name: "place_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-18" },
  reviewedAnchors: (releaseContentSha256) => CHUO_PRIVATE_REVIEWED_ROWS.map((v) => anchorFor(v, releaseContentSha256)),
  observe,
  assertResolvable(release) {
    if (release.contentSha256 !== CHUO_PRIVATE_FIXTURE_SHA256 || release.sourceUrl !== CHUO_PRIVATE_PAGE_URL
      || release.observedOn !== "2026-10-18") throw new Error("chuo-private: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "chuo-private-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: CHUO_PRIVATE_PAGE_URL, checkedAt: "2026-10-18" },
  completeness: "partial", crossReleaseValidated: false,
};
