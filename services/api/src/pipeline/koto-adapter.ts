// Only the licensed station resource is approved. The sibling park CSV is blocked by a
// current-operation conflict (docs/SOURCES.md); ordinary ward HTML contributes no values.
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const KOTO_SOURCE_ID = "koto-station-smoking-areas";
export const KOTO_DATASET_URL = "https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000061";
export const KOTO_DATA_URL = "https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv";
export const KOTO_FIXTURE_SHA256 = "e36e81d58348db6607a374f18a77ae54801eb55b810fba2849cf49c14318126d";
export const KOTO_EXISTENCE_RULE = "koto.stationSmokingListing.v1";
export const KOTO_ATTRIBUTION_TEXT =
  `このデータベースは、以下の著作物を改変して利用しています。公共喫煙所一覧（駅前）、東京都・江東区、クリエイティブ・コモンズ・ライセンス 表示4.0国際 https://creativecommons.org/licenses/by/4.0/ 元データ ${KOTO_DATA_URL} MannerPathが抽出・正規化して作成。コンテンツ提供者は内容を保証せず、利用により生じた損害について責任を負いません。利用規約 https://portal.data.metro.tokyo.lg.jp/terms/`;
export const KOTO_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: KOTO_DATA_URL,
  observedOn: null,
  fetchedAt: "2026-09-29T04:56:43Z",
  httpLastModified: "Thu, 15 Jan 2026 02:59:37 GMT",
};
export const KOTO_HEADER = ["緯度", "経度", "喫煙所名", "場所"] as const;

function coordinate(value: string, column: string, min: number, max: number): number {
  if (!/^-?[0-9]{1,3}\.[0-9]+$/.test(value)) throw new Error(`koto: invalid ${column}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`koto: out-of-range ${column}`);
  return n;
}
function assertRow(values: readonly string[]): void {
  if (values.length !== KOTO_HEADER.length) throw new Error("koto: unexpected record width");
  if (values[2].trim() === "" || !values[2].endsWith("駅前公衆喫煙所")) {
    throw new Error("koto: missing explicit station smoking-location name");
  }
  coordinate(values[0], "緯度", -90, 90);
  coordinate(values[1], "経度", -180, 180);
}
function observe(values: readonly string[]): SourceObservation {
  assertRow(values);
  return {
    name: values[2],
    // Supplied decimal latitude/longitude site points. Datum/accuracy/entrance are unstated;
    // used at map-display accuracy under the existing lat/lon convention, without geocoding.
    latitude: Number(values[0]), longitude: Number(values[1]),
    supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: { status: "none", raw: null, parsed: null },
    lifecycle: "active",
    provenance: [
      { field: "existence", columns: ["喫煙所名"], rule: KOTO_EXISTENCE_RULE },
      { field: "lifecycle", columns: ["喫煙所名"], rule: KOTO_EXISTENCE_RULE },
      { field: "name", columns: ["喫煙所名"], rule: "koto.name.v1" },
      { field: "location", columns: ["緯度", "経度"], rule: "koto.suppliedLatLon.v1" },
    ],
  };
}

export const KOTO_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: KOTO_SOURCE_ID, displayName: "江東区 公共喫煙所一覧（駅前）", kind: "municipal",
    licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText: KOTO_ATTRIBUTION_TEXT, publicationStatus: "approved",
  },
  parserVersion: "koto-station-csv.v1", mappingVersion: "koto-station-observation.v1", resolverVersion: "koto-station-resolver.v1",
  parse(bytes) {
    const parsed = parseCsv(new TextDecoder("shift_jis", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (parsed.header.length !== KOTO_HEADER.length || parsed.header.some((h, i) => h !== KOTO_HEADER[i])) {
      throw new Error("koto: unexpected header; only the reviewed station CSV is supported");
    }
    parsed.rows.forEach(assertRow);
    return parsed;
  },
  upstreamRowRef: () => null,
  observe,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== KOTO_FIXTURE_SHA256 || release.sourceUrl !== KOTO_DATA_URL
      || release.observedOn !== null || observations.length !== 3) {
      throw new Error("koto: release is not the reviewed first-release fingerprint/scope");
    }
  },
  attenuate: () => [],
  attenuationReference: {
    attestationVersion: "koto-no-attenuations.v1", referenceKind: "reviewedSource",
    referenceUrl: KOTO_DATASET_URL, checkedAt: "2026-09-29",
  },
  crossReleaseValidated: false,
  completeness: "partial",
};
