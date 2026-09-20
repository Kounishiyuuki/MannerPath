// 台東区 公衆喫煙所 (docs/SOURCES.md, research doc §2–§3): registry entry, file shape and the
// field-resolution rules of resolver `taito-resolver.v1`. Every rule is conservative: a value is
// resolved only when the source states it; everything else stays unknown and gets no provenance row.

export const TAITO_SOURCE_ID = "taito-public-smoking-areas";
export const TAITO_PARSER_VERSION = "taito-csv.v1";
export const TAITO_RESOLVER_VERSION = "taito-resolver.v1";

// Stable dataset page. It is the original-data URL in the attribution because it survives every
// 時点 release; the release CSV URL (TAITO_FIXTURE_RELEASE.sourceUrl) changes with each one and is
// release provenance, not the citation a client shows.
export const TAITO_DATASET_URL = "https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html";

// The four display elements 台東区's open-data terms require (docs/SOURCES.md, Issue #22): the
// publisher, the license label, the publisher's no-warranty sentence and the original-data URL.
// The wording is fixed here because it is what the tile/detail DTOs send as sources[].attributionText.
export const TAITO_ATTRIBUTION_TEXT =
  `台東区「公衆喫煙所」（CC-BY表示4.0国際）本作品の内容について、台東区は一切保証しないものとする。 ${TAITO_DATASET_URL}`;

// Registry mirror of the reviewed docs/SOURCES.md entry, including its publication status. This is
// a repository-controlled constant, not something an importer computes: it is the only way the
// Taito row becomes 'approved' (see src/pipeline/registry.ts). Unlisted sources stay blocked.
export const TAITO_REGISTRY = {
  sourceId: TAITO_SOURCE_ID,
  displayName: "台東区 公衆喫煙所",
  kind: "municipal",
  licenseName: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode.ja",
  attributionText: TAITO_ATTRIBUTION_TEXT,
  publicationStatus: "approved",
} as const;

// Release metadata of the committed fixture (services/data-pipeline/fixtures/.../PROVENANCE.md).
// observedOn is the 時点 date of the page label; fetchedAt is the retrieval date (date precision only).
export const TAITO_FIXTURE_RELEASE = {
  sourceUrl: "https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv",
  observedOn: "2026-08-18",
  fetchedAt: "2026-09-20T00:00:00Z",
  httpLastModified: "Fri, 11 Sep 2026 07:48:17 GMT",
} as const;

export const TAITO_HEADER = [
  "#", "市区町村コード", "自治体名称", "名称", "名称カナ", "設置位置", "方書",
  "利用開始時間", "利用終了時間", "緯度", "経度", "特記事項",
] as const;

const HEATED_ONLY_MARKER = "※加熱式たばこ専用";
const ALL_DAY = "終日利用可能";
const CLOCK = /^([0-9]|1[0-9]|2[0-3]):([0-5][0-9])$/;
const DECIMAL_DEGREES = /^-?[0-9]{1,3}\.[0-9]+$/;

export type TriState = "yes" | "no" | "unknown";
export type ProvenanceField = "existence" | "location" | "name" | "supportsPaper" | "supportsHeated" | "openingHours" | "lifecycle";

export interface FieldProvenance {
  field: ProvenanceField;
  columns: string[];
  rule: string;
}

export interface ResolvedTaitoRecord {
  name: string | null;
  latitude: number;
  longitude: number;
  supportsPaper: TriState;
  supportsHeated: TriState;
  openingHours:
    | { status: "parsed"; raw: string; parsed: OpeningHoursV1 }
    | { status: "unparsed"; raw: string; parsed: null };
  provenance: FieldProvenance[];
}

// Parsed hours, stored in spots.opening_hours_json and sent as-is in the tile DTO.
// "24:00" closes at midnight (Taito writes it as 0:00).
export type OpeningHoursV1 =
  | { v: 1; kind: "allDay" }
  | { v: 1; kind: "daily"; opens: string; closes: string };

export function assertTaitoHeader(header: string[]): void {
  if (header.length !== TAITO_HEADER.length || header.some((h, i) => h !== TAITO_HEADER[i])) {
    throw new Error(`taito: unexpected header ${JSON.stringify(header)}; parser ${TAITO_PARSER_VERSION} expects ${JSON.stringify(TAITO_HEADER)}`);
  }
}

function clock(value: string): string | null {
  const m = CLOCK.exec(value);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function parseHours(start: string, end: string): OpeningHoursV1 | null {
  if (start === ALL_DAY && end === ALL_DAY) return { v: 1, kind: "allDay" };
  const opens = clock(start);
  let closes = clock(end);
  if (opens === null || closes === null) return null;
  if (closes === "00:00") closes = "24:00";
  if (closes <= opens) return null;
  return { v: 1, kind: "daily", opens, closes };
}

function coordinate(value: string, column: string, row: string): number {
  if (!DECIMAL_DEGREES.test(value)) {
    throw new Error(`taito: record #${row} has a non-decimal ${column} value ${JSON.stringify(value)}`);
  }
  return Number(value);
}

/**
 * Resolves one raw Taito row (values in TAITO_HEADER order). Rules (docs/adr/0006, 2026-09 Issue #12 amendment):
 * - existence / lifecycle: being listed in an applied release is accepted existence evidence; active.
 * - location: 緯度/経度 verbatim decimal degrees (datum not stated; treated as WGS84).
 * - name: 名称 verbatim.
 * - tobacco: only 「※加熱式たばこ専用」 in 名称 or 特記事項 resolves anything (heated yes, paper no).
 * - hours: parsed only when 特記事項 is empty and both times are 終日利用可能 or H:MM; any note keeps
 *   the hours unparsed, so openNow stays unknown.
 * Not resolved (unknown, no provenance): spotType, hostType, accessType, environment, feeType, floor,
 * entranceNote. 設置位置 / 方書 / 名称カナ stay in raw evidence only.
 */
export function resolveTaitoRecord(values: string[]): ResolvedTaitoRecord {
  if (values.length !== TAITO_HEADER.length) {
    throw new Error(`taito: record has ${values.length} values, expected ${TAITO_HEADER.length}`);
  }
  const v = Object.fromEntries(TAITO_HEADER.map((h, i) => [h, values[i]])) as Record<(typeof TAITO_HEADER)[number], string>;
  const provenance: FieldProvenance[] = [
    { field: "existence", columns: [], rule: "taito.listed.v1" },
    { field: "lifecycle", columns: [], rule: "taito.listed.v1" },
    { field: "location", columns: ["緯度", "経度"], rule: "taito.coordinates.v1" },
  ];

  const name = v["名称"] === "" ? null : v["名称"];
  if (name !== null) provenance.push({ field: "name", columns: ["名称"], rule: "taito.name.v1" });

  let supportsPaper: TriState = "unknown";
  let supportsHeated: TriState = "unknown";
  const markerColumns = (["名称", "特記事項"] as const).filter((c) => v[c].includes(HEATED_ONLY_MARKER));
  if (markerColumns.length > 0) {
    supportsPaper = "no";
    supportsHeated = "yes";
    provenance.push({ field: "supportsPaper", columns: [...markerColumns], rule: "taito.heatedOnly.v1" });
    provenance.push({ field: "supportsHeated", columns: [...markerColumns], rule: "taito.heatedOnly.v1" });
  }

  const start = v["利用開始時間"];
  const end = v["利用終了時間"];
  const note = v["特記事項"];
  const range = start === ALL_DAY && end === ALL_DAY ? ALL_DAY : `${start}-${end}`;
  const raw = note === "" ? range : `${range}\n${note}`;
  const parsed = note.trim() === "" ? parseHours(start, end) : null;
  provenance.push({ field: "openingHours", columns: ["利用開始時間", "利用終了時間", "特記事項"], rule: "taito.hours.v1" });

  return {
    name,
    latitude: coordinate(v["緯度"], "緯度", v["#"]),
    longitude: coordinate(v["経度"], "経度", v["#"]),
    supportsPaper,
    supportsHeated,
    openingHours: parsed ? { status: "parsed", raw, parsed } : { status: "unparsed", raw, parsed: null },
    provenance,
  };
}
