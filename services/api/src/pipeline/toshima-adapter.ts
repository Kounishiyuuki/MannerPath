// 豊島区 区指定喫煙所: an ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact sheet for
// the ward's current list (services/data-pipeline/fixtures/toshima-smoking-places/PROVENANCE.md), not a publisher file. Existence and hours come from that page (factReference); each pin is the ABR representative point of
// the page's own address (ADR-0018 item 5, src/pipeline/address-anchor.ts), so every spot is areaApproximate with scope
// `facility` and never the smoking place's own point.
import { ADDRESS_ANCHOR_DATASET_RELEASE } from "./address-anchor.ts";
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const TOSHIMA_SOURCE_ID = "toshima-smoking-places";
export const TOSHIMA_PAGE_URL = "https://www.city.toshima.lg.jp/152/machizukuri/sumai/bika/taisaku/025701.html";
export const TOSHIMA_FIXTURE_SHA256 = "feb1e8201a0839a3f24d61769da8fc5968aeca3c62062ec6a761fac901ddc31c";
// ADR-0018 §5 (D-C): observedOn is the check day. lastVerifiedAt shows that desk check, not a site visit.
export const TOSHIMA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: TOSHIMA_PAGE_URL, observedOn: "2026-10-19", fetchedAt: "2026-10-18T20:56:32Z", httpLastModified: null,
};
// サイトポリシー「著作権について」 forbids 無断の複製・転用 of the site's documents and images; only facts are used.
export const TOSHIMA_ATTRIBUTION_TEXT = `出典：豊島区ホームページ「区指定喫煙所」（${TOSHIMA_PAGE_URL}）（2026-10-19確認）。`
  + "MannerPathが事実のみを正規化して作成。位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約 第1.0版）の住所代表点を"
  + "abr-geocoderで求めたもので、喫煙所そのものの位置ではありません。豊島区による推奨・保証を意味しません。";

const HEADER = ["fact_id", "place_name", "area_name", "area_kind", "area_scope", "zones", "hours", "hours_note", "spot_type",
  "access_type", "environment", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis",
  "anchor_reference"] as const;
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
// The reviewed rows: [fact_id, place_name, address lot, zones, hours, hours_note, host_type, lat, lon, ABR level, gate
// input/output]. Generated from the bulk-intake dry run over the page's 7 listings (PROVENANCE.md); only `adoptable` rows
// are here, and no two share an address point.
type Reviewed = readonly [string, string, string, string, string, string, string, string, string, string, string];
const REVIEWED: readonly Reviewed[] = [
  ["toshima-03", "池袋駅西口東京芸術劇場前喫煙所", "西池袋1丁目8番9号", "", "7時00分から24時00分まで", "", "municipality", "35.72957285", "139.707475597", "residential_detail", "入力=東京都豊島区西池袋1丁目8番9号 出力=東京都豊島区西池袋1丁目8-9"],
  ["toshima-04", "THETOBACCOIKEBUKURO", "東池袋1丁目8番1号", "", "10時00分から23時00分まで", "", "unknown", "35.731372194", "139.714591239", "residential_detail", "入力=東京都豊島区東池袋1丁目8番1号 出力=東京都豊島区東池袋1丁目8-1 除外=WACCA池袋5階"],
  ["toshima-05", "ファミリーマート立教通り店", "西池袋3丁目29番7号", "", "6時00分から20時00分まで", "", "unknown", "35.731210539", "139.706188772", "residential_detail", "入力=東京都豊島区西池袋3丁目29番7号 出力=東京都豊島区西池袋3丁目29-7"],
  ["toshima-06", "THETOBACCOIKEBUKUROSECOND", "南池袋1丁目28番2号", "", "11時00分から21時00分まで", "", "unknown", "35.727123275", "139.710337442", "residential_detail", "入力=東京都豊島区南池袋1丁目28番2号 出力=東京都豊島区南池袋1丁目28-2 除外=池袋パルコ8階"],
];

// Every row shares these reviewed values. The page states neither room type nor environment; host is the municipality
// only for 区営 places, unknown for 助成金活用 ones.
function reviewedValues(r: Reviewed): readonly string[] {
  const [factId, placeName, lot, zones, hours, hoursNote, host, lat, lon, level, io] = r;
  return [factId, placeName, lot, "facility", "facility", zones, hours, hoursNote, "unknown", "public", "unknown", host,
    TOSHIMA_PAGE_URL, "2026-10-19", lat, lon, "officialAddressGeocode", `abr-geocoder 2.3.1 ${ADDRESS_ANCHOR_DATASET_RELEASE} ${level} ${io}`];
}
const REVIEWED_VALUES = new Map(REVIEWED.map((r) => [r[0], reviewedValues(r)]));

function row(values: readonly string[]): readonly string[] {
  if (values.length !== HEADER.length) throw new Error("toshima: unexpected record shape");
  const reviewed = REVIEWED_VALUES.get(values[col("fact_id")]);
  if (!reviewed || JSON.stringify(values) !== JSON.stringify(reviewed)) throw new Error("toshima: record is not a reviewed fact row");
  return values;
}

function areaPoint(values: readonly string[]) {
  const v = row(values);
  return {
    areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] },
  };
}

function anchorFor(values: readonly string[], releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(values);
  const factId = values[col("fact_id")];
  return {
    anchorId: `aa_toshima${factId.slice("toshima-".length).replaceAll("-", "")}`, areaName: p.areaName, areaKind: "facility",
    latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: TOSHIMA_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: factId, originReference: `toshima-page-facts.csv#${factId}`,
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-19",
    areaScope: "facility", anchorBasis: p.basis,
  };
}

function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const factColumns = ["place_name", "zones", "page_url", "checked_at"];
  const hours = v[col("hours")];
  const note = v[col("hours_note")];
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")],
    supportsPaper: "unknown", supportsHeated: "unknown",
    // The page's hours are kept verbatim and unparsed, so openNow is never asserted from them.
    openingHours: { status: "unparsed", raw: note === "" ? hours : `${hours}\n${note}`, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: factColumns, rule: "toshima.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "toshima.listedWithoutSuspension.v1" },
      { field: "name", columns: ["place_name"], rule: "toshima.normalizedName.v1" },
      { field: "openingHours", columns: ["hours", "hours_note"], rule: "toshima.statedHours.v1" },
      // 区指定喫煙所: the ward's places 一般に開放する (open to the public).
      { field: "accessType", columns: ["access_type"], rule: "toshima.publicSmokingPlace.v1" },
      { field: "hostType", columns: ["host_type"], rule: "toshima.wardRunOrUnknown.v1" },
    ],
    classification: {
      spotType: "unknown", spotSubtype: null, accessType: "public", accessDetail: null,
      hostType: v[col("host_type")] === "municipality" ? "municipality" : "unknown", environment: "unknown",
    },
  };
  return anchoredObservation(base, anchorFor(v, TOSHIMA_FIXTURE_SHA256), ["area_name", "area_scope"]);
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

export const TOSHIMA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: TOSHIMA_SOURCE_ID, displayName: "豊島区 区指定喫煙所", kind: "municipal",
    licenseName: null, licenseUrl: null, attributionText: TOSHIMA_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [TOSHIMA_PAGE_URL],
      termsUrls: ["https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html"],
      termsReading: "サイトポリシー「著作権について」: 文書・画像等の諸権利は原則として豊島区に帰属し、私的使用・引用など著作権法上認められた場合を除き無断で複製・転用できないとする表現保護。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照（ページの文章・画像は保存しない）。",
      prohibitsInformationUse: false, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-19",
    },
  },
  parserVersion: "toshima-page-facts.v1", mappingVersion: "toshima-page-facts.map.v1", resolverVersion: "toshima-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== REVIEWED.length) throw new Error("toshima: unexpected fact sheet");
    rows.forEach(row);
    if (new Set(rows.map((v) => v[col("fact_id")])).size !== REVIEWED.length) throw new Error("toshima: duplicate fact row");
    // Same-anchor rule: rooms the ward lists at one address share its point and are one row.
    if (new Set(rows.map((v) => `${v[col("anchor_latitude")]},${v[col("anchor_longitude")]}`)).size !== REVIEWED.length) throw new Error("toshima: two rows share one anchor");
    return { header, rows };
  },
  upstreamRowRef: (values) => row(values)[col("fact_id")],
  includesRecord: () => true,
  areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-19" },
  reviewedAnchors: (releaseContentSha256) => [...REVIEWED_VALUES.values()].map((v) => anchorFor(v, releaseContentSha256)),
  observe,
  assertResolvable(release, observations) {
    const expected = [...REVIEWED_VALUES.values()].map((v) => observationFacts(observe(v))).sort();
    const actual = observations.map(observationFacts).sort();
    if (release.contentSha256 !== TOSHIMA_FIXTURE_SHA256 || release.sourceUrl !== TOSHIMA_PAGE_URL
      || release.observedOn !== "2026-10-19" || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("toshima: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "toshima-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: TOSHIMA_PAGE_URL, checkedAt: "2026-10-19" },
  completeness: "partial", crossReleaseValidated: false,
};
