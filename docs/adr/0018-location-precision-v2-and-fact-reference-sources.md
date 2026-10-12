# ADR-0018 — Location precision v2: facility scope, cross-publication anchors and fact-reference sources

Status: **Accepted — maintainer decisions D-A, D-R and D-C approved 2026-10-11.** Implemented (migration 0032) —
see "Implementation" below. Not deployed: no production D1, Cloudflare or publication change was made.

Amends: ADR-0017 (anchor policy v1 → v2, area scope), DATA_POLICY §Source priority 2 (operator usage terms).
Does not change ADR-0011's status: its publication lane stays Proposed; D-A allows an official-address geocode only as
an **approximate anchor**, never as `reviewedDerived` or exact.

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
4. The facility's own official address, and 5. a geocode of that address (D-A approved both) — as an
   **approximate anchor only**. Never `publisherPoint`, never `reviewedDerived` on the spot (it stays `areaApproximate`);
   the geocoder is an anchor-making tool, never existence evidence. No geocoder is wired yet: the schema accepts
   `anchor_basis = officialAddressGeocode`, and the first such source must pin its geocoder/version in its provenance.

Still forbidden: Google/Apple/MapKit POI coordinates, OSM (ADR-0010), positions read off floor maps or screenshots,
manual pins, a facility point used as `namedZone`, and a zone point used as exact.

**Same-anchor rule.** Several smoking places the publisher distinguishes but that resolve to **one** anchor are
published as **one** spot; separate spots need separate anchors. No stacked pins at a facility centre. The zones are
kept in the reviewed fact record (evidence); the published name summarises them (e.g. 「ターミナル内外4か所・一部は保安
検査後」). A per-zone list on the wire is a later, separate change.

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

## Maintainer decisions (approved 2026-10-11)

- **D-A (anchor): APPROVED** — sources 1–5 of §2, with the conditions there (never exact; `facility` vs `namedZone`
  scope by what the point represents; provenance stored; Google/MapKit/OSM never existence; geocoder never evidence).
- **D-R (rights): APPROVED** — first-party official pages (municipal, railway, airport, commercial and other facility
  operators) as `factReference`; normalized facts only; no long verbatim text, floor maps, screenshots, logos or
  expressive descriptions; explicit prohibition of information use, data acquisition or database incorporation fails
  closed; downloadable datasets keep resource-level rights review. An internal policy, not a legal clearance.
- **D-C (current operation): APPROVED** — an undated first-party page counts when, at `checkedAt`, the publisher's
  current page lists the place with no closure/abolition/relocation/ban contradiction. Not treated as site-verified;
  `checkedAt`/`lastVerifiedAt` kept; contradictions fail closed; a page change or loss triggers re-review.

## Implementation (2026-10-11)

Reuses ADR-0017's authority model unchanged; no new precision value or publication path. One new table, the evidence
hold below (migration 0033).

- **reviewedPageFact = a reviewed fact sheet release.** A factReference source's release is MannerPath's normalized
  CSV for one page (fixture + `PROVENANCE.md`; the page HTML is never committed). Ingest, observations, provenance,
  resolve, publication and promotion are the ordinary ones. `observedOn` is the page's `checkedAt` (D-C), so
  `lastVerifiedAt` shows the check date; the PROVENANCE file says it is not a site visit.
- **Anchors (migration 0032).** `area_location_anchors` gains nullable `area_scope`, `anchor_basis`
  (`referenceDatasetPoint` | `officialAddressGeocode`) and `anchor_reference`. Triggers require them together, match
  scope to `origin_kind` (facility ↔ `publisherFacilityPoint`, zone ↔ `publisherAreaPoint`), read each value out of the
  cited record's own cells (columns `area_scope`, `anchor_basis`, `anchor_reference`), and refuse map-vendor/OSM/
  screenshot references. The point itself is still read through the reviewed area-point mapping (0030). Existing
  anchors keep NULL and the v1 digest input. `policy_version`/`reuse_basis` keep their 0030 values (`v1`,
  `sameReviewedPublication`: the fact sheet is the publication); `anchor_basis` names the true upstream.
- **Rights.** `ReviewedSource.rightsBasis` (`factReference`, page/terms URLs, the terms reading, reviewer/date,
  `prohibitsInformationUse: false` as a literal type). `assertRightsBasis` fails at module load for a licence on a
  factReference source, missing attribution, a non first-party kind or an incomplete record. The quality check,
  onboarding inspection and source health accept factReference instead of a licence; nothing else changes.
- **Current operation (D-C).** Source health fetches the page and fingerprints only a scoped fact range (the rights
  scope mechanism): unchanged → healthy; changed → `contentChanged` advisory (re-review); scope missing → blocking.
  Offline replay says `pageFactNotChecked`. Health never edits data. Until a source is deployed it stays out of
  the production health inventory (as Sendai does); its page is checked with `npm run source:health -- (--live |
  --offline) --repository-reviewed`, and review metadata still lists it exactly once.
- **Evidence hold (migration 0033, maintainer decision 2026-10-12).** A live report showing the fact range gone
  (`pageFactScopeMissing`) or the page gone (`resourceMissing`) lets a maintainer run `npm run source:hold -- hold`,
  which records an append-only `spot_evidence_holds` row per spot (reason `sourceEvidenceMissing`, report SHA-256 and
  date, who/when) and unpublishes it. The membership deletes, hold rows and every tile rewrite run in one `db.batch`
  (D1's transaction), as does a clear with its republish: all of it commits or none of it does. `publishTiles`
  excludes active holds and a `tile_snapshot_spots` trigger refuses them. `contentChanged`, 5xx/timeouts and offline
  reports are refused as hold reasons (no automatic or bulk unpublication). Only an explicit `clear`
  (`factsReReviewed` | `healthFalsePositive`) ends a hold; rows are never deleted. Not chosen:
  widening `spots.publication_hold` (a 0004 CHECK, which would need a table rebuild).
- **Wire.** `locationArea.scope` optional (zod, docs/API.md); absent for v1 anchors, so their bytes are unchanged.
- **First source.** `komatsu-airport-smoking-places`: one facility-level spot (4 zones, one 国土数値情報 C28
  TerminalBuilding anchor), `existence = operator`, hours/tobacco support/room type unknown. `accessType = unknown`
  (maintainer decision 2026-10-12): two zones are after security, so neither `public` nor `facilityOnly` is true of
  the facility spot as a whole; the name keeps 「一部は保安検査後」.

## Future work (not decided)

- Mixed or per-zone access (e.g. some zones after security). Today such a facility spot is `accessType = unknown` and
  the name carries the qualifier; a `mixed`/conditional access value or a per-zone list on the wire would be a
  separate ADR covering the tile contract, DB and clients.

## Consequences

- Coverage from HTML-only first-party sources becomes possible without contacting every publisher, at the cost of a
  new rights class that the maintainer owns.
- Facility-level pins are honest but coarse; ranking keeps ADR-0017's "no new factor" and shows 「約」.
- Nothing changes until D-A, D-R and D-C are recorded.
