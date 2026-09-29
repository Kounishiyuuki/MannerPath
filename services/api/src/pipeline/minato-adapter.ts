// Reviewed smoking-point subset of the publisher's mixed facility dataset. Ordinary facility
// existence is never smoking-location evidence; excluded rows remain immutable raw evidence.
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter } from "./source-adapter.ts";

export const MINATO_SOURCE_ID = "minato-designated-smoking-areas";
export const MINATO_DATASET_URL = "https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo";
export const MINATO_DATA_URL = "https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv";
export const MINATO_FIXTURE_SHA256 = "d11ad6a5c2c72bba114d58bc7cce9f84f54338c75ee37cdd275b7680c6314220";
export const MINATO_ATTRIBUTION_TEXT = `出典：港区オープンデータカタログサイト「複合施設・男女平等参画施設・その他の施設」 ${MINATO_DATASET_URL} 元データ ${MINATO_DATA_URL} （2026年9月30日に利用） CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ MannerPathが指定喫煙場所を抽出・正規化して作成。`;
export const MINATO_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: MINATO_DATA_URL, observedOn: null, fetchedAt: "2026-09-29T15:18:42.326Z", httpLastModified: "Thu, 16 Jul 2026 05:32:22 GMT",
};
export const MINATO_HEADER = ["最終更新日", "ページタイトル", "分類", "第1分類", "第2分類", "ファイルパス", "地区", "紹介文", "所在地", "連絡先", "開館時間", "休業日", "施設の概要", "受付時間", "電車", "バス", "駐車場", "駐輪場", "画像1", "画像キャプション1", "画像2", "画像キャプション2", "画像3", "画像キャプション3", "画像4", "画像キャプション4", "画像5", "画像キャプション5", "緯度", "経度", ""] as const;
const TRAILER = '\r\n"港区施設情報 複合施設・男女平等参画施設・その他の施設","Ver20260714"\r\n';
function includesRecord(v: readonly string[]): boolean {
  return v[2] === "009013004000" && v[4] === "指定喫煙場所"
    && v[5] !== "https://www.city.minato.tokyo.jp/shisetsu/sonota/kitsuen/109.html"
    && /^https:\/\/www\.city\.minato\.tokyo\.jp\/shisetsu\/sonota\/kitsuen\/[0-9]+\.html$/.test(v[5]);
}
function coordinate(v: string, min: number, max: number): number {
  if (!/^-?[0-9]{1,3}\.[0-9]+$/.test(v)) throw new Error("minato: invalid coordinate");
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error("minato: out-of-range coordinate");
  return n;
}
function assertSmokingRow(v: readonly string[]): void {
  if (v.length !== MINATO_HEADER.length) throw new Error("minato: unexpected record width");
  if (!includesRecord(v) || !v[1].trim()) throw new Error("minato: record is not an explicit designated smoking location");
  coordinate(v[28], -90, 90); coordinate(v[29], -180, 180);
}
export const MINATO_ADAPTER: SourceAdapter = {
  registry: { sourceId: MINATO_SOURCE_ID, displayName: "港区 指定喫煙場所（施設情報）", kind: "municipal",
    licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText: MINATO_ATTRIBUTION_TEXT, publicationStatus: "approved" },
  parserVersion: "minato-facility-csv.v1", mappingVersion: "minato-smoking-observation.v1", resolverVersion: "minato-smoking-resolver.v1",
  parse(bytes) {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!text.endsWith(TRAILER)) throw new Error("minato: unreviewed facility export trailer");
    const parsed = parseCsv(text.slice(0, -TRAILER.length));
    if (parsed.header.length !== MINATO_HEADER.length || parsed.header.some((h, i) => h !== MINATO_HEADER[i])) throw new Error("minato: unexpected header");
    if (parsed.rows.length !== 169) throw new Error("minato: unreviewed raw facility scope");
    parsed.rows.filter(includesRecord).forEach(assertSmokingRow);
    return parsed;
  },
  includesRecord,
  upstreamRowRef: (v) => v[5] || null,
  observe(v) {
    assertSmokingRow(v);
    // Preserve explicit operating-time statements verbatim. No schedule parsing or open-now
    // inference; free-text facility descriptions without a time marker contribute no hours.
    const hoursColumns = [ ...(v[10] ? ["開館時間"] : []), ...(/開設時間|利用時間/.test(v[12]) ? ["施設の概要"] : []) ];
    const rawHours = [ ...(v[10] ? [v[10]] : []), ...(/開設時間|利用時間/.test(v[12]) ? [v[12]] : []) ].join("\n");
    return { name: v[1], latitude: coordinate(v[28], -90, 90), longitude: coordinate(v[29], -180, 180),
      supportsPaper: "unknown", supportsHeated: "unknown", openingHours: rawHours ? { status: "unparsed", raw: rawHours, parsed: null } : { status: "none", raw: null, parsed: null }, lifecycle: "active",
      provenance: [
        ...(rawHours ? [{ field: "openingHours", columns: hoursColumns, rule: "minato.rawHours.v1" }] : []),
        { field: "existence", columns: ["分類", "第2分類", "ファイルパス"], rule: "minato.designatedSmokingPoint.v1" },
        { field: "lifecycle", columns: ["分類", "第2分類", "ファイルパス"], rule: "minato.designatedSmokingPoint.v1" },
        { field: "name", columns: ["ページタイトル"], rule: "minato.name.v1" },
        { field: "location", columns: ["緯度", "経度"], rule: "minato.suppliedLatLon.v1" },
      ] };
  },
  assertResolvable(release, observations) {
    if (release.contentSha256 !== MINATO_FIXTURE_SHA256 || release.sourceUrl !== MINATO_DATA_URL
      || release.observedOn !== null || observations.length !== 114) throw new Error("minato: release is not the reviewed first-release fingerprint/scope");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "minato-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: MINATO_DATASET_URL, checkedAt: "2026-09-30" },
  crossReleaseValidated: false, completeness: "partial",
};
