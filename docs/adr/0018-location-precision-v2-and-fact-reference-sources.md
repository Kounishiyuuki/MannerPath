# ADR-0018 — Location precision v2: facility scope, cross-publication anchors and fact-reference sources

Status: **Proposed** (2026-10-11). Not implemented. Three maintainer decisions (D-A, D-R, D-C below) are required
before any code, schema, source or publication change. Until then ADR-0006, ADR-0011, ADR-0017 and
`docs/DATA_POLICY.md` apply unchanged.

Amends (if accepted): ADR-0017 (anchor policy v1 → v2, area scope), DATA_POLICY §Source priority 2 (operator usage
terms). Does not change ADR-0011's status.

This ADR is an engineering decision, not legal advice.

## Context

Official and operator publications often prove that a smoking place exists without publishing its coordinate:
「金沢駅西口に喫煙所」「国際線2F出発ロビーに1ヶ所」「施設内に喫煙室あり」. Two Ishikawa reviews
(operator sources: commit `3c8a44a` on unmerged branch `data/ishikawa-operator-coverage`; [re-evaluation](../research/2026-10-11-ishikawa-location-precision-reevaluation.md))
found explicit first-party existence for 7 places and **0 publishable**. The blockers were not the precision
vocabulary:

1. **Anchor source.** ADR-0017 already models "inside a station/facility/airport" as `areaApproximate` with
   `locationArea.kind ∈ {park, station, facility, airport, commercialBuilding, other}` and UI 「この付近へ案内」. But
   anchor policy v1 accepts only a point stated in **the same publication** as the existence record. HTML pages and
   FAQ answers state no point at all, so no anchor can exist.
2. **Rights.** DATA_POLICY requires "compatible, reviewed usage terms" for operator information. Operator sites carry
   "All rights reserved" or clauses against 複製・転用; the reviews treated that as a block.
3. **Evidence form.** The pipeline ingests publisher **files** (release digest, raw records). A fact stated on an HTML
   page has no ingestion path.

## Decision (proposed)

### 1. Location model — no new precision value

The wire `locationPrecision` stays `publisherPoint | reviewedDerived | communityPinned | areaApproximate | unknown`.
The requested three levels map as follows:

| Requested level | Representation | Anchor | Navigation |
|---|---|---|---|
| exact | `publisherPoint` (or `communityPinned`) | The smoking place's own published point | 「この場所へ案内」 |
| areaApproximate | `areaApproximate` + `locationArea.scope = "namedZone"` | Representative point of the named zone (e.g. 西口広場) | 「この付近へ案内」 |
| facilityApproximate | `areaApproximate` + `locationArea.scope = "facility"` | Representative point of the host facility | 「この施設内へ案内」 + 「施設内の詳しい位置は確認できていません」 |

`scope` is a new **optional** field of `locationArea` (absent = today's behaviour, read as `facility`-or-zone
unknown → existing wording). Reason: a new precision value would break the DB authority chain, promotion v2–v4,
`location-state.ts` and every client switch; a sub-field keeps one approximate path with one authority model.
Old clients ignore the field and keep 「この付近へ案内」, which is still honest.

The facility's own name and the zone text are **normalized** (e.g. 「国際線出発ロビー 2F」), never copied prose.

### 2. Anchor policy v2 — cross-publication reviewed anchors

Existence and anchor stay separate. Allowed anchor sources, in order:

1. A point the existence publication itself states (v1, unchanged).
2. A point the same publisher states in another publication (ADR-0017 follow-up "same-publisher separate dataset").
3. **A reviewed government reference dataset point for the host** — e.g. 国土数値情報 airport reference points,
   station data. Each dataset's licence is reviewed and registered as an *anchor source* in `docs/SOURCES.md`;
   its attribution travels with the anchor. An anchor source can never create existence.
4. ADR-0011 geocode of the official facility address — **only if** D-A additionally approves "approximate anchor
   only" use of a reviewed derived point; otherwise excluded. Never `publisherPoint`, never `reviewedDerived` on the
   spot (the spot stays `areaApproximate`).

Still forbidden: Google/Apple/MapKit POI coordinates, OSM (ADR-0010), positions read off floor maps or screenshots,
manual pins, a facility point used as `namedZone`, and a zone point used as exact.

**Same-anchor rule.** Several smoking places the publisher distinguishes but that resolve to **one** anchor are
published as **one** spot whose detail lists the normalized zones and their access conditions; separate spots need
separate anchors. No stacked pins at a facility centre.

### 3. Rights — `rightsStatus` per source

Distinguish three uses (from the task brief):

- A. referencing a first-party page as **existence evidence** and storing normalized facts;
- B. reproducing its text, images, floor maps, screenshots or logos;
- C. redistributing its dataset/raw file.

MannerPath stores only: normalized name, existence fact, location precision and scope, normalized access
conditions, source URL, `checkedAt`, an independently sourced anchor, provenance. B is never done. C needs a licence.

| `rightsStatus` | Meaning | Publishable |
|---|---|---|
| `openLicence` | Reviewed open licence (today's approved sources) | Yes |
| `factReference` | Terms reserve copyright in expression (e.g. "All rights reserved", 「無断で複製・転用することはできません」) but do not prohibit using the information; only use A | **Only if D-R is approved**, per source, with a recorded review note |
| `prohibited` | Terms prohibit using the information itself, database incorporation or third-party provision (e.g. 金沢フォーラス 利用規約 第7条; CLUB JT 第33条第2項) | No — fail closed |
| `unreviewed` | Terms not read | No |

The classification is an engineering reading recorded with the quoted clause and reviewer, not a legal conclusion.
A publisher objection moves the source to `prohibited` and withdraws its spots (same rollback as any source).

### 4. Fact-reference evidence form

A new evidence kind `reviewedPageFact`: a reviewer-recorded, append-only observation of one page (URL, `checkedAt`,
HTTP status, content digest of the fetched HTML kept outside the repo, the normalized fact set, the quoted clause
location for rights). It is existence evidence of the same tier as the publisher (official / operator). It never
carries hours unless the page states hours **for the smoking place**; facility hours are never transferred.

### 5. Current operation

A `reviewedPageFact` counts as current only while its page is re-observed live with the same fact within the
source-health window; an undated page is "listed as of `checkedAt`", shown with that date. Closure, relocation,
indoor-ban or contradicting statements by the same publisher withdraw the claim (DATA_POLICY §Contradicting
official publications). `openNow` stays unknown when smoking-place hours are unknown.

## Maintainer decisions required

- **D-A (anchor):** approve anchor policy v2 items 2–3, and say whether item 4 (address geocode as approximate-only
  anchor) is in or out.
- **D-R (rights):** approve or reject the `factReference` publication class. Rejecting keeps today's rule; the
  Ishikawa delta then stays 0 without licences.
- **D-C (current operation):** approve "listed as of checkedAt + live re-observation" as current-operation evidence
  for pages without dates.

## Implementation plan (after decisions; one PR each)

1. Docs: accept this ADR; amend ADR-0017, DATA_POLICY, SPECIFICATION, SOURCES (anchor sources, rightsStatus).
2. Schema: migration for `rightsStatus`, anchor-source registry and `reviewedPageFact` observations; extend the
   append-only guards and `location-state.ts`; promotion v2–v4 carry the new rows. Tests per ADR-0017's round-trip list.
3. Anchor-source adapter for the first reviewed government dataset (airports first); quality check
   `facility-anchor-never-exact`.
4. Wire: optional `locationArea.scope` (DTO zod, contract fixture, schema version check); Apple shared
   `ApproximateLocation` wording for `facility` on iPhone, Watch, widgets, VoiceOver; tests.
5. Ishikawa onboarding of whatever passes (see re-evaluation), with promotion reproduction locally.

## Consequences

- Coverage from HTML-only first-party sources becomes possible without contacting every publisher, at the cost of a
  new rights class that the maintainer owns.
- Facility-level pins are honest but coarse; ranking keeps ADR-0017's "no new factor" and shows 「約」.
- Nothing changes until D-A, D-R and D-C are recorded.
