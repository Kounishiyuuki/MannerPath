// 台東区's *second* publication of the same list, and what it is allowed to do (Issue #42,
// ADR-0006 amendment "reconciling a second official publication").
//
// 台東区 publishes its public smoking locations twice: as the CC BY 4.0 open-data CSV this
// repository imports (docs/SOURCES.md, the only registered source), and as an ordinary ward web
// page, 公衆喫煙所ウェブマップ・一覧 (`TAITO_LIST_PAGE_URL`). The page carries qualifiers the CSV
// does not — weekday-only opening, holiday exclusions, a temporary renovation closure, a temporary
// relocation — and in three places a different closing time.
//
// **Reuse status (engineering policy, not a legal conclusion).** No reviewed redistribution
// permission was found for this page: it sits outside the ward's open-data catalog, carries no CC BY
// notice and no license link, and its footer states only `©台東区` (re-read 2026-09-21, see
// TAITO_LIST_PAGE_CHECKED_AT). Under `docs/DATA_POLICY.md` an unreviewed reference is not published,
// so MannerPath does not redistribute content from this page and does not register it as a source.
// It is used only as a reviewed **conflict reference**. Nothing here concludes what the page's terms
// permit; that review has not been done, which is why the conservative path is taken.
//
// **What it may do.** Exactly one thing: remove a claim. An attestation below can downgrade hours
// to `unparsed`, mark a spot `temporarilyClosed`, or withhold a spot from publication. It can never
// add, raise or correct a canonical value, and no text, time or coordinate from the page is stored
// or published — the canonical record keeps the CSV's own values.
//
// **How a weakening is recorded.** Not by rewriting the CSV's field provenance, which would imply
// the CSV had observed a conflict published later somewhere else. The CSV provenance row keeps
// saying what the CSV stated and by which rule; a separate `spot_field_attenuations` row records
// that the claim was weakened, under which attestation version, from which reference, when it was
// read, and against which exact source release (migration 0005).
//
// **Why the attestations are constants.** Each entry is a dated, reviewable statement of a
// contradiction a human verified against the live page, not a hard-coded correction: the effects are
// all subtractive, and re-running
// `services/data-pipeline/research/beta-data-quality/spot-check.mjs` reproduces the observations.

export const TAITO_LIST_PAGE_URL = "https://www.city.taito.lg.jp/kenchiku/machibika/kosyu/webmap.html";
export const TAITO_LIST_PAGE_REFERENCE_KIND = "publisherWebPage";
export const TAITO_LIST_PAGE_ATTESTATION_VERSION = "taito-list-page-conflicts.v1";
/** When the live page was last read for this list. A new release or a page edit invalidates it. */
export const TAITO_LIST_PAGE_CHECKED_AT = "2026-09-21T01:37:19Z";
/** 更新日 printed on the page itself at CHECKED_AT; it labels the list 令和8年8月18日現在. */
export const TAITO_LIST_PAGE_UPDATED_ON = "2026-09-04";

/**
 * The exact source release these attestations were reviewed against. The conflicts were established
 * by comparing *this* release's records with the page, so they describe no other release: a new file
 * can renumber, rename, re-time or drop any of them. Matching the eight names is not enough, so the
 * resolver checks this whole fingerprint and fails closed on any difference
 * (`assertReviewedReleaseForAttenuation`). A new release therefore requires a fresh page review and
 * a new attestation version before its records can be resolved.
 */
export const TAITO_REVIEWED_RELEASE = {
  contentSha256: "5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74",
  observedOn: "2026-08-18",
  sourceUrl:
    "https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv",
} as const;

/**
 * The effects an attestation may have. All three are subtractive; there is deliberately no effect
 * that writes a value, so a reference with no reviewed reuse permission can never become a
 * published value.
 */
export type TaitoListPageEffect = "hoursUnknown" | "temporarilyClosed" | "withholdFromPublication";

/** The canonical field each effect attenuates, in `spot_field_provenance.field` vocabulary. */
export const ATTENUATED_FIELD: Readonly<Record<TaitoListPageEffect, "openingHours" | "lifecycle" | "location">> = {
  hoursUnknown: "openingHours",
  temporarilyClosed: "lifecycle",
  withholdFromPublication: "location",
};

export interface TaitoListPageConflict {
  /** 名称 of the CSV record this is about, verbatim. Matched exactly; see assertListPageConflictsMatch. */
  csvName: string;
  effects: readonly TaitoListPageEffect[];
  /**
   * What the second publication states, in our own words. It is a factual summary written for a
   * reviewer — never a copy of the page's prose, and never a replacement value. It is not stored in
   * the database and never reaches a client.
   */
  observation: string;
}

/** The canonical `publication_hold` value used for a superseded coordinate (migration 0004). */
export const HOLD_LOCATION_SUPERSEDED = "locationSuperseded";

/**
 * Every contradiction between the two current official publications, as read on CHECKED_AT against
 * the release fingerprinted in TAITO_REVIEWED_RELEASE.
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

export interface ReleaseFingerprint {
  contentSha256: string;
  observedOn: string | null;
  sourceUrl: string;
}

/**
 * Fails closed unless the release being resolved is exactly the one these attestations were
 * reviewed against. Content hash, observation date and source URL are all checked: the same eight
 * names in a different file prove nothing about that file's hours or locations, and reusing the
 * decisions would either attenuate the wrong records or silently miss new conflicts.
 *
 * Recovery is a deliberate repository change, never a runtime fallback: re-read the page, re-review
 * the conflicts, and bump TAITO_LIST_PAGE_ATTESTATION_VERSION and TAITO_REVIEWED_RELEASE together.
 */
export function assertReviewedReleaseForAttenuation(actual: ReleaseFingerprint): void {
  const differences = [
    actual.contentSha256 === TAITO_REVIEWED_RELEASE.contentSha256
      ? null : `content_sha256 ${actual.contentSha256} != ${TAITO_REVIEWED_RELEASE.contentSha256}`,
    actual.observedOn === TAITO_REVIEWED_RELEASE.observedOn
      ? null : `observed_on ${actual.observedOn ?? "(null)"} != ${TAITO_REVIEWED_RELEASE.observedOn}`,
    actual.sourceUrl === TAITO_REVIEWED_RELEASE.sourceUrl
      ? null : `source_url ${actual.sourceUrl} != ${TAITO_REVIEWED_RELEASE.sourceUrl}`,
  ].filter((d): d is string => d !== null);
  if (differences.length > 0) {
    throw new Error(
      `taito-list-page: ${TAITO_LIST_PAGE_ATTESTATION_VERSION} was reviewed against a different release (${differences.join("; ")}). ` +
        `Re-read ${TAITO_LIST_PAGE_URL}, re-review the conflicts, and bump the attestation version and the reviewed release together before resolving this release.`,
    );
  }
}

/**
 * Fails loudly when the attestations no longer describe the records being imported. Every
 * attestation must match exactly one record of the release: a renamed or dropped record means the
 * ward has re-published, and the contradictions must be re-checked against the live page rather
 * than silently losing an effect. Called by the resolver before it writes anything, after the
 * release fingerprint check above.
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
