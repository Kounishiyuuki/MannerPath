// 台東区's *second* publication of the same list, and what it is allowed to do (Issue #42,
// ADR-0006 amendment "reconciling a second official publication").
//
// 台東区 publishes its public smoking locations twice: as the CC BY 4.0 open-data CSV this
// repository imports (docs/SOURCES.md, the only registered source), and as an ordinary ward web
// page, 公衆喫煙所ウェブマップ・一覧 (`TAITO_LIST_PAGE_URL`). The page carries qualifiers the CSV does not
// — weekday-only opening, holiday exclusions, a temporary renovation closure, a temporary
// relocation — and in three places a different closing time.
//
// **License position.** The list page is *not* open data. It sits outside the ward's open-data
// catalog, carries no CC BY notice and its footer states only `©台東区` (re-read 2026-09-21, see
// CHECKED_AT). MannerPath therefore has no reviewed right to redistribute its content, and it is
// deliberately **not** registered in docs/SOURCES.md.
//
// **What it may do.** Exactly one thing: remove a claim. An attestation below can downgrade hours
// to `unparsed`, mark a spot `temporarilyClosed`, or withhold a spot from publication. It can never
// add, raise or correct a canonical value, and no text from the page is ever stored or published —
// the canonical record keeps the CSV's own values, and the raw CSV evidence is untouched. Knowing
// that we must *not* assert something requires no redistribution right, which is why this is the
// only model the page's terms support.
//
// **Why it is a constant.** Each entry is a dated, reviewable statement of a contradiction a human
// verified against the live page, not a hard-coded correction: the effects are all subtractive, the
// rule names reach the canonical record through `spot_field_provenance`, and re-running
// `services/data-pipeline/research/beta-data-quality/spot-check.mjs` reproduces the observations.

export const TAITO_LIST_PAGE_URL = "https://www.city.taito.lg.jp/kenchiku/machibika/kosyu/webmap.html";
export const TAITO_LIST_PAGE_ATTESTATION_VERSION = "taito-list-page-conflicts.v1";
/** When the live page was last read for this list. A new release or a page edit invalidates it. */
export const TAITO_LIST_PAGE_CHECKED_AT = "2026-09-21T01:37:19Z";
/** 更新日 printed on the page itself at CHECKED_AT; it labels the list 令和8年8月18日現在. */
export const TAITO_LIST_PAGE_UPDATED_ON = "2026-09-04";

/**
 * The effects an attestation may have. All three are subtractive; there is deliberately no effect
 * that writes a value, so the unlicensed page can never become a published value.
 */
export type TaitoListPageEffect = "hoursUnknown" | "temporarilyClosed" | "withholdFromPublication";

export interface TaitoListPageConflict {
  /** 名称 of the CSV record this is about, verbatim. Matched exactly; see assertListPageConflictsMatch. */
  csvName: string;
  effects: readonly TaitoListPageEffect[];
  /**
   * What the second publication states, in our own words. It is a factual summary written for a
   * reviewer — never a copy of the page's prose, which is not licensed for redistribution.
   */
  observation: string;
}

/** Named derivation rules written into spot_field_provenance when an effect is applied. */
export const TAITO_HOURS_CONFLICT_RULE = "taito.hours.listPageConflict.v1";
export const TAITO_TEMPORARY_CLOSURE_RULE = "taito.lifecycle.listPageTemporaryClosure.v1";
export const TAITO_RELOCATION_RULE = "taito.coordinates.listPageRelocation.v1";

/** The canonical `publication_hold` value used for a superseded coordinate (migration 0004). */
export const HOLD_LOCATION_SUPERSEDED = "locationSuperseded";

/**
 * Every contradiction between the two current official publications, as read on CHECKED_AT.
 * Typographic-only differences (①/（1）, セブン-イレブン/セブンイレブン, full/half-width digits) are
 * not conflicts and are absent: they change no claim MannerPath makes.
 */
export const TAITO_LIST_PAGE_CONFLICTS: readonly TaitoListPageConflict[] = [
  {
    csvName: "本庁舎駐車場出口横",
    effects: ["hoursUnknown"],
    observation:
      "the list page restricts the same opening range to weekday office-opening days; the CSV states no restriction, so the parsed hours would claim it is open at weekends and on holidays",
  },
  {
    csvName: "清川清掃車庫内",
    effects: ["hoursUnknown"],
    observation: "the list page states a one-hour-later opening and a one-hour-later closing time than the CSV",
  },
  {
    csvName: "金竜公園内",
    effects: ["hoursUnknown"],
    observation:
      "the list page states a closing time 30 minutes later than the CSV and adds that the location can be closed temporarily for crane work in the park",
  },
  {
    csvName: "隅田公園内",
    effects: ["hoursUnknown"],
    observation: "the list page states a closing time 30 minutes later than the CSV",
  },
  {
    csvName: "ファミリーマート　台東一丁目店",
    effects: ["hoursUnknown", "temporarilyClosed"],
    observation:
      "the list page states the location is closed for in-store refurbishment from 2026-09-06 to a planned 2026-09-22, while the CSV publishes it as open all day",
  },
  {
    csvName: "smokers peace in ミマツ書房",
    effects: ["hoursUnknown"],
    observation:
      "the two publications state different opening hours for Sundays and public holidays; the CSV's own closure note already keeps this record unparsed, and the conflict is recorded so it stays that way",
  },
  {
    csvName: "中小企業振興センター駐車場内",
    effects: ["withholdFromPublication"],
    observation:
      "the list page states the location is temporarily relocated into the neighbouring park while the CSV carries the permanent coordinate; no authoritative coordinate for the current location is published anywhere, so no replacement exists to import",
  },
  {
    csvName: "佐竹公衆喫煙所",
    effects: ["hoursUnknown"],
    observation:
      "the clock times agree, but the list page excludes the new-year, May-holiday and Bon periods, which the CSV does not state",
  },
];

const byName = new Map(TAITO_LIST_PAGE_CONFLICTS.map((c) => [c.csvName, c]));
if (byName.size !== TAITO_LIST_PAGE_CONFLICTS.length) {
  throw new Error("taito-list-page: two attestations name the same CSV record");
}

export function listPageConflictFor(csvName: string): TaitoListPageConflict | undefined {
  return byName.get(csvName);
}

/**
 * Fails loudly when the attestations no longer describe the records being imported. Every
 * attestation must match exactly one record of the release: a renamed or dropped record means the
 * ward has re-published, and the contradictions must be re-checked against the live page rather
 * than silently losing an effect. Called by the resolver before it writes anything.
 */
export function assertListPageConflictsMatch(csvNames: readonly string[]): void {
  const counts = new Map<string, number>();
  for (const n of csvNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  const bad = TAITO_LIST_PAGE_CONFLICTS
    .map((c) => ({ name: c.csvName, matched: counts.get(c.csvName) ?? 0 }))
    .filter((c) => c.matched !== 1);
  if (bad.length > 0) {
    throw new Error(
      `taito-list-page: ${TAITO_LIST_PAGE_ATTESTATION_VERSION} expects exactly one record per attestation, but ` +
        bad.map((b) => `${JSON.stringify(b.name)} matched ${b.matched}`).join("; ") +
        `. Re-check ${TAITO_LIST_PAGE_URL} and update the attestations before importing this release.`,
    );
  }
}
