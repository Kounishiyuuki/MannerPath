// Osaka City's own CC BY Mapnavi CSV, reviewed in docs/SOURCES.md. The mixed dataset is kept
// intact as raw evidence; only explicitly designated smoking locations enter the observation layer.
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const OSAKA_SOURCE_ID = "osaka-designated-smoking-areas";
export const OSAKA_DATASET_URL = "https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html";
export const OSAKA_DATA_URL = "https://www.mapnavi.city.osaka.lg.jp/osakacity/osakacity/opendatafile/map_1/CSV/opendata_1012.csv";
export const OSAKA_FIXTURE_SHA256 = "f58b62791396bc46ceca436a7c4ad598520a5c9dd4162b37723ef519399e69ce";
export const OSAKA_EXISTENCE_RULE = "osaka.designatedListing.v1";
// The dataset page's CC-BY image links directly to CC BY 2.1 JP (not the general site's 4.0).
// Preserve the publisher, dataset title, original URI, license and disclaimer on public responses.
export const OSAKA_ATTRIBUTION_TEXT =
  `出典：大阪市「マップナビおおさか 施設情報ポイントデータ（環境・リサイクル）」 ${OSAKA_DATASET_URL} 元データ ${OSAKA_DATA_URL} CC BY 2.1 JP https://creativecommons.org/licenses/by/2.1/jp/ 本ページに掲載しているデータの使用で生じた結果等については、大阪市は一切の責任を負いません。MannerPathが大阪市指定喫煙所を抽出・正規化して作成。`;
export const OSAKA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: OSAKA_DATA_URL,
  // Neither page modification time nor HTTP Last-Modified is evidence observation time.
  observedOn: null,
  fetchedAt: "2026-09-28T09:06:31Z",
  httpLastModified: "Sat, 26 Sep 2026 14:06:05 GMT",
};
export const OSAKA_HEADER = [
  "施設名称", "所在地", "施設名かな", "カテゴリ", "分類", "TEL", "FAX", "URL", "URL2",
  "バリアフリー情報", "詳細情報", "備考", "経度", "緯度", "分類",
] as const;
const DESIGNATED = "大阪市指定喫煙所";

function assertRow(values: readonly string[]): void {
  if (values.length !== OSAKA_HEADER.length) throw new Error("osaka: unexpected record width");
  // The publisher repeats 分類 at positions 5 and 15; never collapse duplicate headers into an object.
  if (values[3] !== "環境・リサイクル" || values[4] !== values[14]) {
    throw new Error("osaka: unexpected category or conflicting classification columns");
  }
}
function includesRecord(values: readonly string[]): boolean {
  assertRow(values);
  return values[4] === DESIGNATED;
}
function coordinate(value: string, column: string, min: number, max: number): number {
  if (!/^-?[0-9]{1,3}\.[0-9]+$/.test(value)) throw new Error(`osaka: invalid ${column}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`osaka: out-of-range ${column}`);
  return n;
}
function observe(values: readonly string[]): SourceObservation {
  if (!includesRecord(values)) throw new Error("osaka: record is not a designated smoking location");
  const name = values[0] === "" ? null : values[0];
  // Preserve the stated schedule without inferring daily hours, holidays, or overnight semantics.
  const hours = /(?:^|[，、])供用時間：([^，]*)/.exec(values[10])?.[1] ?? "";
  const provenance: SourceObservation["provenance"][number][] = [
    { field: "existence", columns: ["カテゴリ", "分類"], rule: OSAKA_EXISTENCE_RULE },
    { field: "lifecycle", columns: ["分類"], rule: OSAKA_EXISTENCE_RULE },
    { field: "location", columns: ["経度", "緯度"], rule: "osaka.jgd2011Coordinates.v1" },
  ];
  if (name !== null) provenance.push({ field: "name", columns: ["施設名称"], rule: "osaka.name.v1" });
  if (hours !== "") provenance.push({ field: "openingHours", columns: ["詳細情報"], rule: "osaka.hoursUnparsed.v1" });
  return {
    name,
    // Decimal degree JGD2011 map-icon positions, as specified by the publisher; no geocoding.
    latitude: coordinate(values[13], "緯度", -90, 90),
    longitude: coordinate(values[12], "経度", -180, 180),
    supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: hours === "" ? { status: "none", raw: null, parsed: null }
      : { status: "unparsed", raw: hours, parsed: null },
    lifecycle: "active",
    provenance,
  };
}

export const OSAKA_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: OSAKA_SOURCE_ID, displayName: "大阪市指定喫煙所（マップナビおおさか）", kind: "municipal",
    licenseName: "CC BY 2.1 JP", licenseUrl: "https://creativecommons.org/licenses/by/2.1/jp/",
    attributionText: OSAKA_ATTRIBUTION_TEXT, publicationStatus: "approved",
  },
  parserVersion: "osaka-mapnavi-csv.v1", mappingVersion: "osaka-observation.v1", resolverVersion: "osaka-resolver.v1",
  parse(bytes) {
    const parsed = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (parsed.header.length !== OSAKA_HEADER.length || parsed.header.some((h, i) => h !== OSAKA_HEADER[i])) {
      throw new Error("osaka: unexpected header; reviewed parser expects the exact Mapnavi CSV schema");
    }
    parsed.rows.forEach(assertRow);
    return parsed;
  },
  // No upstream identifier in the CSV. A name, address or ordinal is not a stable entity key.
  upstreamRowRef: () => null,
  includesRecord,
  observe,
  assertResolvable(release, observations) {
    // Only this reviewed fixture is publishable. A later fetch must be reviewed again, even if
    // its URL is unchanged. No automated refresh or cross-release identity claim is enabled.
    if (release.contentSha256 !== OSAKA_FIXTURE_SHA256 || release.sourceUrl !== OSAKA_DATA_URL
      || release.observedOn !== null || observations.length !== 344) {
      throw new Error("osaka: release is not the reviewed first-release fingerprint/scope");
    }
  },
  attenuate: () => [],
  // Required by the current interface, but unused: this source has no external attenuations.
  attenuationReference: {
    attestationVersion: "osaka-no-attenuations.v1", referenceKind: "reviewedSource",
    referenceUrl: OSAKA_DATASET_URL, checkedAt: "2026-09-28",
  },
  crossReleaseValidated: false,
  completeness: "partial",
};
