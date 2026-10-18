// 中央区 区営指定喫煙場所（公園）: an ADR-0018 page-fact source. The release is MannerPath's reviewed, normalized fact
// sheet for the ward's current smoking-place list (services/data-pipeline/fixtures/chuo-park-smoking-places/PROVENANCE.md),
// not a publisher file. Existence and hours come from that page (factReference); each pin is the park's own point in the
// ward's CC BY 4.0 park list, so every spot is areaApproximate with scope `facility` and never the smoking place's point.
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const CHUO_PARK_SOURCE_ID = "chuo-park-smoking-places";
export const CHUO_PARK_PAGE_URL = "https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html";
export const CHUO_PARK_FIXTURE_SHA256 = "be67c5505848afc9dd1ae4c4194b10a99f04f6363b0f6e43b0c197488be06d9c";
// ADR-0018 §5 (D-C): observedOn is the check day. lastVerifiedAt shows that desk check, not a site visit.
export const CHUO_PARK_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: CHUO_PARK_PAGE_URL, observedOn: "2026-10-18", fetchedAt: "2026-10-18T05:20:36Z", httpLastModified: null,
};
const PARK_LIST_URL = "https://www.city.chuo.lg.jp/documents/984/koenichiran.csv";
const PARK_LIST_SHA256 = "4afdc6462d1186f0a24efd2f20cdd0e4620bb57ea0f0f858570f17acc7f66979";
export const CHUO_PARK_ATTRIBUTION_TEXT = "出典：中央区ホームページ「中央区内指定喫煙場所一覧」"
  + `${CHUO_PARK_PAGE_URL}（2026-10-18確認）。`
  + "位置の目安：このデータベースは以下の著作物を改変して利用しています。区内の公園一覧、中央区、"
  + `クリエイティブ・コモンズ・ライセンス 表示 4.0 国際 https://creativecommons.org/licenses/by/4.0/deed.ja 元データ ${PARK_LIST_URL}。`
  + "MannerPathが事実のみを正規化して作成。ピンは公園の代表点で喫煙場所そのものの位置ではありません。中央区による推奨・保証を意味しません。";

const HEADER = ["fact_id", "place_name", "area_name", "area_kind", "area_scope", "zones", "hours", "hours_note", "spot_type",
  "access_type", "environment", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis",
  "anchor_reference"] as const;
const col = (name: (typeof HEADER)[number]) => HEADER.indexOf(name);
const CLEANING = "清掃作業中は利用不可";

// The reviewed rows: [fact_id, place_name, park name (= park list 名称), zones, hours, hours_note, park list 緯度, 経度].
// Two places the ward lists separately in one park share that park's single point, so they are one spot (same-anchor rule).
const REVIEWED: readonly (readonly [string, string, string, string, string, string, string, string])[] = [
  ["kaedegawa-kyuanbashi", "楓川久安橋公園", "楓川久安橋公園", "", "0:00-24:00", "", "35.677891", "139.774431"],
  ["sukiyabashi", "数寄屋橋公園", "数寄屋橋公園", "", "7:00-22:30", CLEANING, "35.672735", "139.76327"],
  ["kaedegawa-shintomibashi", "楓川新富橋公園", "楓川新富橋公園", "", "0:00-24:00", "", "35.672285", "139.772227"],
  ["tsukijigawa", "築地川公園", "築地川公園", "", "7:00-20:00", CLEANING, "35.668686", "139.774921"],
  ["tsukijigawa-kameibashi", "築地川亀井橋公園", "築地川亀井橋公園", "", "0:00-24:00", "", "35.670426", "139.77099"],
  ["tsukijigawa-ginza", "築地川銀座公園", "築地川銀座公園", "", "0:00-24:00", "", "35.668597", "139.76877"],
  ["tsukijigawa-chiyobashi", "築地川千代橋公園（東側・西側の2か所）", "築地川千代橋公園", "東側|西側", "0:00-24:00", "", "35.665634", "139.766235"],
  ["kaedegawa-danjobashi", "楓川弾正橋公園", "楓川弾正橋公園", "", "0:00-24:00", "", "35.675", "139.773124"],
  ["jizobashi", "地蔵橋公園", "地蔵橋公園", "", "7:00-20:00", CLEANING, "35.690741", "139.774806"],
  ["kakigaracho", "蛎殻町公園", "蛎殻町公園", "", "7:00-20:00", CLEANING, "35.683282", "139.787407"],
  ["hamacho", "浜町公園", "浜町公園", "", "7:00-20:00", CLEANING, "35.688108", "139.788839"],
  ["tsukuda", "佃公園", "佃公園", "", "0:00-24:00", "", "35.670168", "139.783568"],
  ["ishikawajima", "石川島公園（中央大橋側・相生橋側の2か所）", "石川島公園", "中央大橋側|相生橋側",
    "中央大橋側 7:00-19:00|相生橋側 0:00-24:00", `${CLEANING}（中央大橋側）`, "35.671012", "139.785552"],
  ["shintsukishima", "新月島公園", "新月島公園", "", "7:00-19:00", CLEANING, "35.659431", "139.787104"],
];

function reviewedValues(r: (typeof REVIEWED)[number]): readonly string[] {
  const [factId, placeName, park, zones, hours, hoursNote, lat, lon] = r;
  return [factId, placeName, park, "park", "facility", zones, hours, hoursNote, "unknown", "public", "unknown", "municipality",
    CHUO_PARK_PAGE_URL, "2026-10-18", lat, lon, "referenceDatasetPoint",
    `中央区オープンデータ 区内の公園一覧 koenichiran.csv sha256:${PARK_LIST_SHA256} 名称=${park}`];
}
const REVIEWED_VALUES = new Map(REVIEWED.map((r) => [r[0], reviewedValues(r)]));

function row(values: readonly string[]): readonly string[] {
  if (values.length !== HEADER.length) throw new Error("chuo-park: unexpected record shape");
  const reviewed = REVIEWED_VALUES.get(values[col("fact_id")]);
  if (!reviewed || JSON.stringify(values) !== JSON.stringify(reviewed)) throw new Error("chuo-park: record is not a reviewed fact row");
  return values;
}

function areaPoint(values: readonly string[]) {
  const v = row(values);
  return {
    areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
    scope: "facility" as const, basis: { basis: "referenceDatasetPoint" as const, reference: v[col("anchor_reference")] },
  };
}

function anchorFor(values: readonly string[], releaseContentSha256: string): ReviewedAreaAnchor {
  const p = areaPoint(values);
  const factId = values[col("fact_id")];
  return {
    anchorId: `aa_chuopark${factId.replaceAll("-", "")}`, areaName: p.areaName, areaKind: "park", latitude: p.latitude, longitude: p.longitude,
    originKind: "publisherFacilityPoint", originSourceId: CHUO_PARK_SOURCE_ID, originReleaseContentSha256: releaseContentSha256,
    originUpstreamRowRef: factId, originReference: `chuo-park-page-facts.csv#${factId}`,
    reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-18",
    areaScope: "facility", anchorBasis: p.basis,
  };
}

// Smoking-place hours stated by the page. A single unqualified 0:00-24:00 range is all day; a range with the ward's
// cleaning qualifier, or a park whose two places differ, stays unparsed so openNow is never asserted from it.
function openingHours(v: readonly string[]): SourceObservation["openingHours"] {
  const hours = v[col("hours")];
  const note = v[col("hours_note")];
  if (hours === "0:00-24:00" && note === "") return { status: "parsed", raw: hours, parsed: { v: 1, kind: "allDay" } };
  return { status: "unparsed", raw: note === "" ? hours : `${hours}\n${note}`, parsed: null };
}

function observe(values: readonly string[]): SourceObservation {
  const v = row(values);
  const factColumns = ["place_name", "zones", "page_url", "checked_at"];
  const base: Omit<SourceObservation, "latitude" | "longitude"> = {
    name: v[col("place_name")],
    supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: openingHours(v),
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: factColumns, rule: "chuo-park.pageFact.v1" },
      { field: "lifecycle", columns: ["page_url", "checked_at"], rule: "chuo-park.listedWithoutSuspension.v1" },
      { field: "name", columns: ["place_name"], rule: "chuo-park.normalizedName.v1" },
      { field: "openingHours", columns: ["hours", "hours_note"], rule: "chuo-park.statedHours.v1" },
      // 区営指定喫煙場所: a ward-run designated place in a public park.
      { field: "accessType", columns: ["access_type", "host_type"], rule: "chuo-park.wardDesignatedPublic.v1" },
      { field: "hostType", columns: ["host_type"], rule: "chuo-park.municipalPark.v1" },
    ],
    classification: {
      spotType: "unknown", spotSubtype: null, accessType: "public", accessDetail: null, hostType: "municipality", environment: "unknown",
    },
  };
  return anchoredObservation(base, anchorFor(v, CHUO_PARK_FIXTURE_SHA256), ["area_name", "area_scope"]);
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

export const CHUO_PARK_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: CHUO_PARK_SOURCE_ID, displayName: "中央区 区営指定喫煙場所（公園）", kind: "municipal",
    licenseName: null, licenseUrl: null, attributionText: CHUO_PARK_ATTRIBUTION_TEXT, publicationStatus: "approved",
    rightsBasis: {
      kind: "factReference", pageUrls: [CHUO_PARK_PAGE_URL],
      termsUrls: ["https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/thissite.html"],
      termsReading: "このホームページの詳細情報「著作権について」: 掲載内容の著作権は区に帰属し、無断の転載・改変を不可とする表現保護。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。位置の目安は別資源の公園一覧（CC BY 4.0）。",
      prohibitsInformationUse: false, reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-18",
    },
  },
  parserVersion: "chuo-park-page-facts.v1", mappingVersion: "chuo-park-page-facts.map.v1", resolverVersion: "chuo-park-resolver.v1",
  parse(bytes) {
    const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (JSON.stringify(header) !== JSON.stringify(HEADER) || rows.length !== REVIEWED.length) throw new Error("chuo-park: unexpected fact sheet");
    rows.forEach(row);
    if (new Set(rows.map((v) => v[col("fact_id")])).size !== REVIEWED.length) throw new Error("chuo-park: duplicate fact row");
    return { header, rows };
  },
  upstreamRowRef: (values) => row(values)[col("fact_id")],
  includesRecord: () => true,
  areaPoint,
  areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: "Claude Code source-review", reviewedOn: "2026-10-18" },
  reviewedAnchors: (releaseContentSha256) => [...REVIEWED_VALUES.values()].map((v) => anchorFor(v, releaseContentSha256)),
  observe,
  assertResolvable(release, observations) {
    const expected = [...REVIEWED_VALUES.values()].map((v) => observationFacts(observe(v))).sort();
    const actual = observations.map(observationFacts).sort();
    if (release.contentSha256 !== CHUO_PARK_FIXTURE_SHA256 || release.sourceUrl !== CHUO_PARK_PAGE_URL
      || release.observedOn !== "2026-10-18" || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("chuo-park: not the reviewed fact sheet");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "chuo-park-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: CHUO_PARK_PAGE_URL, checkedAt: "2026-10-18" },
  completeness: "partial", crossReleaseValidated: false,
};
