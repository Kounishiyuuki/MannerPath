// ADR-0018 §2 sources 4–5 (D-A): an official-address geocode as an APPROXIMATE anchor only.
//
// Existence comes from the reviewed page-fact source; this module only turns the publisher's own address into a
// representative point for the fact sheet's anchor cells (`anchor_basis = officialAddressGeocode`). The point is the
// address's ABR representative point, never the smoking place, an entrance or a floor, so the spot stays
// `areaApproximate` (scope `facility`). Anything the gate cannot accept is `reviewPending`: no point is invented.
//
// The geocoder runs outside the repository (abr-geocoder 2.3.1 does not run on Node 24; observed working on 23.3.0 and
// 22.23.3, see scripts/address-anchor-candidates.ts) with the ABR download; its JSON output is the
// input here, pinned by geocoder version and dataset release digest (scripts/address-anchor-candidates.ts).
import { type GeocodeRun, REVIEWED_GEOCODERS, evaluateDerivedCoordinate } from "./derived-coordinate.ts";

export const ADDRESS_ANCHOR_GATE_VERSION = "address-anchor-gate.v1";

/**
 * The reviewed ABR dataset release for anchors: `abrg download -c 131016 131024 131067 131041 131130 131164 --keep`
 * (千代田・中央・台東・新宿・渋谷・豊島), downloaded 2026-10-18; the digest is SHA-256 of the sorted
 * `shasum -a 256 *.zip` list (27 files). Pinned for this anchor lane only: ADR-0011's derived-coordinate lane keeps
 * its own (empty) release list and stays Proposed.
 */
export const ADDRESS_ANCHOR_DATASET_RELEASE = "abr-tokyo-6wards-2026-10-18:sha256:30b45f8ae8ee7ffa159d535d7dd420e06563d1c1bfb8f41704668f84c01e6ac2";
const ANCHOR_GEOCODERS = REVIEWED_GEOCODERS.map((g) => g.geocoderId === "abr-geocoder"
  ? { ...g, datasetReleases: [ADDRESS_ANCHOR_DATASET_RELEASE] } : g);

/** ABR coordinate levels accepted as an approximate facility anchor. Parcel points carry another licence and can sit
 * far from a building inside a large lot; coarser levels are a town or city, not a facility. */
const ANCHOR_LEVELS = ["residential_detail", "residential_block"] as const;

export interface AddressAnchorInput {
  /** The publisher's own address cell, verbatim. Empty/absent is never filled from another source. */
  officialAddress: string | null;
  expectedPrefecture: string;
  expectedMunicipality: string;
  geocode: GeocodeRun | null;
}

export type AddressAnchorResult =
  | { status: "anchor"; latitude: number; longitude: number; coordinateLevel: (typeof ANCHOR_LEVELS)[number]; reference: string }
  | { status: "reviewPending"; reasons: string[] };

const KANJI_DIGITS: Record<string, string> = { 〇: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };

function kanjiNumber(text: string): string {
  // 一〜九十九 only: 丁目 numbers. Anything else is left as is and so fails the comparison.
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
  if (m) return String(Number(KANJI_DIGITS[m[1] ?? "一"]) * 10 + Number(m[2] ? KANJI_DIGITS[m[2]] : 0));
  return [...text].map((c) => KANJI_DIGITS[c] ?? c).join("");
}

/**
 * The one reviewed notation rule: 丁目 numerals, 番(地)/号 and hyphen spellings of the same lot are the same address
 * (「京橋1丁目2番1号」 = 「京橋一丁目2-1」, 「渋谷1-23-21」 = 「渋谷1丁目23-21」). Nothing is dropped or added, so a building
 * name, floor, 「先」 or any other remainder still differs and is never matched away.
 */
export function canonicalAddress(address: string): string {
  return address.normalize("NFKC").replace(/\s+/g, "")
    .replace(/([〇一二三四五六七八九十]+)丁目/g, (_, n: string) => `${kanjiNumber(n)}丁目`)
    .replace(/[‐‑‒–—―−ー]/g, "-")
    .replace(/(\d+)番地?(\d+)号?/g, "$1-$2")
    .replace(/(\d+)番地?$/, "$1")
    .replace(/(\d+)号$/, "$1")
    .replace(/(\d+)丁目(?=\d)/g, "$1-");
}

const TOKYO_WARDS = ["千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区", "品川区", "目黒区", "大田区",
  "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区", "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区"];
const PREFECTURE_PREFIX = /^(北海道|東京都|京都府|大阪府|[^\s\d]{2,3}県)/;

/**
 * The one reviewed completion of a listing's address cell (F3). A municipality's own list often omits 「東京都○○区」; the
 * page's publisher IS that municipality, so its own name may be prefixed — nothing else. `scope` is the source's single
 * publishing municipality, never a guess from the address. A cell that names another prefecture or another Tokyo ward,
 * or the same prefecture with another municipality, is out of scope and returns null (never re-homed).
 */
export function completeOfficialAddress(cell: string, scope: { prefecture: string; municipality: string }):
  { address: string; completed: "none" | "prefecture" | "prefectureAndMunicipality" } | null {
  const text = cell.trim();
  const { prefecture, municipality } = scope;
  if (text === "") return null;
  if (text.startsWith(prefecture + municipality)) return { address: text, completed: "none" };
  if (PREFECTURE_PREFIX.test(text)) return null;
  if (text.startsWith(municipality)) return { address: prefecture + text, completed: "prefecture" };
  if (prefecture === "東京都" && TOKYO_WARDS.some((w) => text.startsWith(w))) return null;
  return { address: prefecture + municipality + text, completed: "prefectureAndMunicipality" };
}

export function evaluateAddressAnchor(input: AddressAnchorInput): AddressAnchorResult {
  const address = input.officialAddress?.trim() ?? "";
  if (address === "") return { status: "reviewPending", reasons: ["officialAddressMissing"] };
  if (input.geocode === null) return { status: "reviewPending", reasons: ["noGeocodeResult"] };
  const run = input.geocode;
  // Existence, current operation and rights belong to the page-fact source review; this gate decides the point only.
  const evaluation = evaluateDerivedCoordinate({
    source: { sourceId: "address-anchor", publicationStatus: "approved", existenceEvidence: "officialSmokingPlace",
      currentOperation: "confirmed", addressReuse: "reviewed" },
    record: { recordId: 0, addressColumn: "address", officialAddress: address, addressSuppliedBy: "publisher", inputRule: "verbatim",
      expectedPrefecture: input.expectedPrefecture, expectedMunicipality: input.expectedMunicipality },
    geocode: run,
  }, ANCHOR_GEOCODERS);
  const notationOnly = run.output !== null && canonicalAddress(run.output) === canonicalAddress(address);
  const reasons: string[] = evaluation.rejections.filter((r) => !(r === "normalizationChangedMeaning" && notationOnly));
  const level = ANCHOR_LEVELS.find((l) => l === run.coordinateLevel);
  if (level === undefined && !reasons.includes("precisionTooLow")) reasons.push("precisionTooLow");
  if (reasons.length > 0 || level === undefined || run.latitude === null || run.longitude === null) {
    return { status: "reviewPending", reasons: reasons.length > 0 ? reasons : ["noCoordinate"] };
  }
  return {
    status: "anchor", latitude: run.latitude, longitude: run.longitude, coordinateLevel: level,
    reference: `${run.geocoderId} ${run.geocoderVersion} ${run.datasetReleaseId} ${level} 入力=${address} 出力=${run.output}`,
  };
}

/** Parses one element of `abrg <file> -f json` output into the gate's run shape (one best result per input). */
export function abrJsonRun(item: unknown, geocoderVersion: string, datasetReleaseId: string): GeocodeRun {
  const { query, result } = item as { query: { input: string }; result: Record<string, unknown> };
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    geocoderId: "abr-geocoder", geocoderVersion, options: { target: "all", fuzzy: null }, datasetReleaseId,
    input: query.input, output: text(result.output), others: Array.isArray(result.others) ? result.others.map(String) : [],
    score: num(result.score), matchLevel: result.match_level as GeocodeRun["matchLevel"],
    coordinateLevel: result.coordinate_level as GeocodeRun["coordinateLevel"],
    latitude: num(result.lat), longitude: num(result.lon),
    // The CLI JSON states no SRID; ABR mixes JGD2011/JGD2000 by level (ADR-0011). Recorded as unknown.
    srid: null, lgCode: text(result.lg_code), pref: text(result.pref), city: text(result.city), ward: text(result.ward),
    candidateCount: text(result.output) === null ? 0 : 1,
  };
}
