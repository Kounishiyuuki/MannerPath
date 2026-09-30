// The publisher's KML member, retained byte-for-byte from its licensed ZIP/KMZ.
// This is a pinned, source-specific reader, not a general XML or GIS importer.
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const MUSASHINO_SOURCE_ID = "musashino-public-smoking-areas";
export const MUSASHINO_DATASET_URL = "https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html";
export const MUSASHINO_DATA_URL = "https://www.city.musashino.lg.jp/_res/common/opendata_kikaku/toilet.zip";
export const MUSASHINO_FIXTURE_SHA256 = "fc6986b986ec315691299a12583f14a8fd942e34075fd1e9e44837dc72c57a7c";
export const MUSASHINO_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: MUSASHINO_DATA_URL, observedOn: null, fetchedAt: "2026-09-29T16:10:07Z",
  httpLastModified: "Tue, 18 Apr 2023 04:43:38 GMT",
};
export const MUSASHINO_ATTRIBUTION_TEXT = `出典：武蔵野市「4(2)トイレおよび路上禁煙エリア・公衆喫煙所 令和4年版地域生活環境指標」 ${MUSASHINO_DATASET_URL} 元データ ${MUSASHINO_DATA_URL} CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ MannerPathが公衆喫煙所のKML Pointを抽出・正規化して作成。武蔵野市による推奨・保証を意味しません。`;

function xmlRecord(values: readonly string[]): string {
  if (values.length !== 1 || !/^<Placemark>[\s\S]*<\/Placemark>$/.test(values[0])) throw new Error("musashino: unexpected record shape");
  return values[0];
}
function text(xml: string, pattern: RegExp): string {
  const matches = [...xml.matchAll(pattern)];
  if (matches.length !== 1 || /[<&]/.test(matches[0][1])) throw new Error("musashino: missing, duplicated or unsupported XML field");
  return matches[0][1];
}
function field(xml: string, name: string): string {
  return text(xml, new RegExp(`<SimpleData name="${name}">([^<]*)<\\/SimpleData>`, "g"));
}
function includesRecord(values: readonly string[]): boolean {
  const xml = xmlRecord(values);
  const style = text(xml, /<styleUrl>([^<]*)<\/styleUrl>/g);
  if (!["#inline0", "#inline1", "#inline2", "#inline3"].includes(style)) throw new Error("musashino: unreviewed category");
  // The reviewed smoking layer is inline3. Toilets and prohibited-area polygons remain raw only.
  if (style !== "#inline3") return false;
  if (!field(xml, "名称").endsWith("喫煙所")) throw new Error("musashino: missing explicit smoking-location name");
  return true;
}
function observe(values: readonly string[]): SourceObservation {
  const xml = xmlRecord(values);
  if (!includesRecord(values)) throw new Error("musashino: excluded category");
  if ((xml.match(/<Point>/g) ?? []).length !== 1 || /<(Polygon|LineString|MultiGeometry)>/.test(xml)) throw new Error("musashino: expected one Point");
  const coords = text(xml, /<coordinates>([^<]*)<\/coordinates>/g).split(",");
  if (coords.length !== 3 || coords[2] !== "0.0" || !coords.slice(0, 2).every((v) => /^-?\d+\.\d+$/.test(v))) throw new Error("musashino: invalid coordinates");
  const [longitude, latitude] = coords.map(Number);
  // Municipality extent, in addition to global ranges, refuses axes swapped and foreign locations.
  if (latitude < 35.68 || latitude > 35.74 || longitude < 139.50 || longitude > 139.61) throw new Error("musashino: out-of-range coordinates");
  if (!/^[1-3]$/.test(field(xml, "番号")) || !field(xml, "所在地").trim()) throw new Error("musashino: invalid row identity/address");
  return {
    name: field(xml, "名称"), latitude, longitude,
    supportsPaper: "unknown", supportsHeated: "unknown",
    openingHours: { status: "none", raw: null, parsed: null }, lifecycle: "active",
    provenance: [
      { field: "existence", columns: ["Placemark/styleUrl", "Placemark/ExtendedData/名称"], rule: "musashino.publicSmokingLayer.v1" },
      { field: "lifecycle", columns: ["Placemark/styleUrl", "Placemark/ExtendedData/名称"], rule: "musashino.publicSmokingLayer.v1" },
      { field: "name", columns: ["Placemark/ExtendedData/名称"], rule: "musashino.name.v1" },
      { field: "location", columns: ["Placemark/Point/coordinates"], rule: "musashino.suppliedWgs84Point.v1" },
    ],
  };
}

export const MUSASHINO_ADAPTER: SourceAdapter = {
  registry: {
    sourceId: MUSASHINO_SOURCE_ID, displayName: "武蔵野市 公衆喫煙所（地域生活環境指標）", kind: "municipal",
    licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText: MUSASHINO_ATTRIBUTION_TEXT, publicationStatus: "approved",
  },
  parserVersion: "musashino-kml-member.v1", mappingVersion: "musashino-smoking-layer.v1", resolverVersion: "musashino-resolver.v1",
  parse(bytes) {
    const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
      || !xml.includes('xmlns="http://www.opengis.net/kml/2.2"') || !xml.trimEnd().endsWith("</kml>")
      || /<!|&/.test(xml)) throw new Error("musashino: unsupported KML schema");
    const rows = [...xml.matchAll(/<Placemark>[\s\S]*?<\/Placemark>/g)].map((m) => [m[0]]);
    if (rows.length !== (xml.match(/<Placemark>/g) ?? []).length || rows.length !== 25) throw new Error("musashino: unexpected raw row count/shape");
    const selected = rows.filter(includesRecord);
    const seen = new Set<string>();
    const locations = new Set<string>();
    for (const row of selected) {
      const o = observe(row);
      const ref = field(row[0], "番号");
      const point = `${o.latitude},${o.longitude}`;
      if (seen.has(ref) || locations.has(point)) throw new Error("musashino: duplicate smoking record");
      seen.add(ref); locations.add(point);
    }
    if (selected.length !== 3) throw new Error("musashino: unexpected selected count");
    return { header: ["Placemark XML"], rows };
  },
  includesRecord, observe,
  upstreamRowRef: (values) => includesRecord(values) ? field(xmlRecord(values), "番号") : null,
  assertResolvable(release, observations) {
    if (release.contentSha256 !== MUSASHINO_FIXTURE_SHA256 || release.sourceUrl !== MUSASHINO_DATA_URL
      || release.observedOn !== null || observations.length !== 3) throw new Error("musashino: not the reviewed first-release fingerprint/scope");
  },
  attenuate: () => [],
  attenuationReference: { attestationVersion: "musashino-no-attenuations.v1", referenceKind: "reviewedSource", referenceUrl: MUSASHINO_DATASET_URL, checkedAt: "2026-09-30" },
  completeness: "partial", crossReleaseValidated: false,
};
