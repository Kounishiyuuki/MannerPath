# Beta data quality gate (Issue #33, re-measured after Issue #42)

Measurement timestamp: **2026-09-21T00:00:00Z** (analysis) / **2026-09-21T01:49Z** (official-source
re-check, superseding the 2026-09-20T17:59Z check). Status: result document. It answers one question
— *where is the current real-data corpus trustworthy enough to put in front of beta users* — and
nothing about an App Store launch.

Every number below comes from the local publication state or from the ward's own pages on the dates
above. Claims are tagged **[measured]** (output of the commands in §1), **[verified]** (read from the
publisher's own page or file on 2026-09-21) or **[judgement]**.

**Result in one line:** after the Issue #42 reconciliation the corpus publishes **32 spots**, no
longer asserts anything the ward's own other publication contradicts, and the **external real-data
beta data blocker is cleared** — bounded to 台東区 and never called Tokyo coverage (§5a).
`DATA_TILE_ZOOM = 14` is unchanged.

## 1. How to reproduce

```sh
cd services/api
npx wrangler d1 migrations apply DB --local     # local D1 only; never a remote database
npm run local:pipeline                          # ingest -> resolve -> publish the committed fixture
npm run local:quality -- --now 2026-09-21T00:00:00Z
```

`npm run local:pipeline` now also applies the Issue #42 reconciliation, which is part of the
resolver. `npm run local:quality` is a read-only analysis of the local database
(`services/api/src/quality/analyze.ts`, covered by `services/api/test/data-quality.test.ts`). It
prints the JSON report and exits non-zero if any check in §4 fails. The report committed with this
document is `services/data-pipeline/research/beta-data-quality/2026-09-21.json`.

The official-source check is a separate, network-only script that touches no database:

```sh
node services/data-pipeline/research/beta-data-quality/spot-check.mjs
```

Its committed output is `services/data-pipeline/research/beta-data-quality/2026-09-21-spot-check.json`.

## 2. Corpus metrics **[measured]**

| Metric | Value |
|---|---|
| Approved sources | 1 of 1 registered (`taito-public-smoking-areas`) |
| Published spots | **32** of 34 canonical records. Two are deliberately withheld by the Issue #42 reconciliation (§3a); nothing else is withheld and nothing is extra |
| Published tiles | 5, all z14, all non-empty (0 empty snapshots) |
| Spots per occupied tile | min 1 / p50 9 / p90 11 / max 11 |
| Bounding box | 35.69849–35.727847 N, 139.76573–139.805037 E (≈3.3 km N–S × 3.6 km E–W) |
| Nearest-neighbour spacing | min 56 m / p50 209 m / p90 695 m / max 1,112 m (`corpus.nearestNeighbourMeters`, haversine, whole metres) |
| Applied releases | 1 (`observedOn` 2026-08-18, 34 records, sha256 `5123ee41…c6c74`) |
| Verification dates | 2026-08-18 for all 32 published spots (dataset-level 時点 date; 34 days old at measurement) |
| Evidence quality | `evidence-quality.v1:officialListing` for all 32 |

Unknown rates — what the source does not state and the resolver therefore refuses to guess:

| Field | Unknown | Rate |
|---|---|---|
| `spotType` | 32 / 32 | 100 % |
| `accessType` | 32 / 32 | 100 % |
| `environment` | 32 / 32 | 100 % |
| `supportsPaper` | 31 / 32 | 96.9 % |
| `supportsHeated` | 31 / 32 | 96.9 % |
| opening hours not usable for `openNow` | 12 / 32 | **37.5 %** (`parsed` 20, `unparsed` 12) |

The hours-unknown rate rose from 20.6 % to 37.5 % on purpose: six records that parsed cleanly from
the CSV alone lost their machine-readable hours because the ward's other current publication
contradicts or qualifies them (§3a). A higher unknown rate is the correct outcome — the alternative
was a confident `openNow` the publisher itself contradicts.

Largest tile **[measured]**: `14/14553/6449` with 11 spots, which is also the largest payload at
6,490 raw bytes / 1,472 gzip bytes. The corpus occupies exactly 5 z14 tiles — one contiguous 3×2
block minus one cell — and none of the 5 is empty. They are not uniformly dense: `14/14552/6449`
holds a **single** spot and `14/14554/6450` holds two, against 9–11 in the other three.

## 3. Manual official-source spot check

### Evidence chain

What is proved, and by what, in order. Each link is a different artifact; none of them stands in for
the next one.

| Link | Established by | Covers |
|---|---|---|
| The ward's live release file **is** the committed fixture, byte for byte | `spot-check.mjs` (`fixture.identicalToLiveRelease: true`) | the whole file, including coordinates |
| Canonical spot fields are derived from that fixture, by the pinned resolver rules | `services/api/test/pipeline.test.ts`, `schema.test.ts`, `migration-0002.test.ts` and the field-provenance rows | name, coordinates, hours, tobacco semantics, provenance |
| The published corpus is what those spots became in the tiles | `npm run local:quality` (reads `tile_snapshots`) | every published value and the tile payloads |
| Where a second official publication disagrees, MannerPath publishes nothing rather than a contradicted claim | `spot-check.mjs` census against the ward's list page, plus `test/taito-reconciliation.test.ts` and the `list-page-conflicts-resolved-conservatively` check | number, name, hours — **not** coordinates |

So the coordinates are traced to the ward's own bytes and to the resolver, **not** independently
confirmed: the ward's list page publishes addresses, not coordinates, and `spot-check.mjs` reads
neither the local database nor the tile snapshots. Nothing here is a physical check of any location.

- Date checked: **2026-09-21T01:49Z** (UTC), re-running the same script that produced the 2026-09-20 check.
- Source checked: the release file `shisethutizujouhou.files/20260818_koshukitsuenjo.csv` served by
  台東区 right now, its catalog page, and — as independent material — the ward's
  **公衆喫煙所ウェブマップ・一覧** page (`/kenchiku/machibika/kosyu/webmap.html`, 更新日 2026年9月4日,
  labelled 令和8年8月18日現在). This is a different publication of the same list by the same ward.
- Sample method: **census**, not a sample. All 34 CSV records compared with the ward's list page on
  the fields that page exposes — number, name and operating hours. The list page carries no
  coordinates, so no coordinate was independently verified.
- Sample size: 34 of 34.

Results **[verified]**:

- The live release file is **byte-identical** to the committed fixture (sha256
  `5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74`, 7,266 bytes,
  `Last-Modified: Fri, 11 Sep 2026 07:48:17 GMT`). The source still exists and has not been re-released.
- The catalog page still labels the file 「公衆喫煙所（令和8年8月18日時点）」 and still states CC BY 4.0.
- The list page is unchanged since the 2026-09-20 check: all 21 findings, including every conflict
  below, reproduce identically (only the `checkedAt` timestamp differs). **The 2026-09-20
  observations are still current** — including the renovation closure and the temporary relocation.
- The list page itself carries **no reuse license**: no CC BY notice, no license link, footer
  `©台東区`. It is therefore not a registered source; `docs/SOURCES.md` records what it may be used
  for instead.
- All 32 published spots reproduce their CSV record exactly on name, coordinates and the heated-only
  semantics. **No value published anywhere differs from the CSV.** Where the second publication
  contradicts the CSV, MannerPath now publishes *less* (§3a) — never a different value. This link is
  the pipeline and provenance tests plus the corpus measurement, not `spot-check.mjs`.

Discrepancies **between the two official publications of the same list** (the CSV we import and the
ward's list page), and what MannerPath now does about each (§3a):

| # | Place | Conflict as of 2026-09-21 | MannerPath now publishes |
|---|---|---|---|
| 12 | 清川清掃車庫(内) | the page states a one-hour-later opening and closing than the CSV | hours **unknown** (`unparsed`); no `openNow` |
| 15 | 金竜公園内 | the page closes 30 min later and warns of temporary crane-work closures | hours **unknown** |
| 16 | 隅田公園内 | the page closes 30 min later | hours **unknown** |
| 10 | 本庁舎駐車場出口横 | the page restricts the same range to 平日開庁日のみ | hours **unknown** |
| 30 | 佐竹公衆喫煙所 | times agree; the page excludes 年末年始・5月連休・お盆休み | hours **unknown** |
| 18 | ファミリーマート 台東一丁目店 | the page states an in-store refurbishment closure 2026-09-06 → 2026-09-22 (予定) | **not published at all** — lifecycle `temporarilyClosed` |
| 22 | smokers peace in ミマツ書房 | the two publications disagree on Sunday/holiday hours | hours **unknown** (already was, now recorded as a conflict) |
| 29 | 中小企業振興センター駐車場内 | the page states the location is temporarily relocated into the neighbouring park | **not published at all** — `publication_hold = locationSuperseded` |
| 14/15/16 | — | CSV row order differs from page row order | unchanged: `#` is not used as an identifier (research §7) |

Nothing in the table is corrected *to* the page's values: every resolution removes a claim. See §3a.

Typographic-only differences (not material): ①→（1）, セブン-イレブン→セブンイレブン,
paspa 上野→paspa上野, full-width/half-width digits and spaces. All are listed in the committed
spot-check JSON with `kind: name-differs`.

Not independently verified: whether any listed place physically exists or currently has an ashtray.
That needs a site visit or a third non-ward source; neither was used. Nothing here is a ground-truth
check — it is a check of one official publication against another.

## 3a. How the conflicts are resolved (Issue #42) **[measured]**

The full decision is ADR-0006's 2026-09 Issue #42 amendment; the short version:

- The ward's list page is **not a source**. It carries no reuse license (footer `©台東区`, outside the
  open-data catalog, re-read 2026-09-21), so it is not registered in `docs/SOURCES.md` and none of
  its text, times or names is stored or served. Its only role is to make MannerPath **withdraw** a
  claim — which needs no redistribution right, unlike publishing its content.
- Each conflict is a dated attestation in `services/api/src/pipeline/taito-list-page.ts`
  (`taito-list-page-conflicts.v1`, checked 2026-09-21T01:37Z), naming the CSV record, the effects it
  licenses and a written observation. **No corrected time is encoded anywhere** — a test fails the
  build if an attestation contains a clock time.
- The three permitted effects are all subtractive: hours → `unparsed`, lifecycle →
  `temporarilyClosed`, or a new `spots.publication_hold` (migration 0004). The CSV's own raw hours
  text is kept, so a human reader still sees what the source said; only the confident machine
  reading is withdrawn.
- Every weakened field says so in provenance: `taito.hours.listPageConflict.v1`,
  `taito.lifecycle.listPageTemporaryClosure.v1`, `taito.coordinates.listPageRelocation.v1`. `rule`
  is already part of the public provenance boundary, so this is visible to a client, not internal.
- **No calendar parser was written.** 「平日開庁日のみ」 and the Bon/new-year exclusions cannot be
  represented faithfully by `openingHours.v1`, so those records publish no machine-readable hours at
  all. That is the deliberate trade: less precision, no false precision.
- The relocated spot (#29) is **not** called closed or removed — the ward says it exists, elsewhere —
  and no coordinate is invented for it. It keeps the source's coordinate, stays `active`, and is held
  out of publication, so it is absent from tiles, from Nearby and from `GET /spots/{id}`. It is
  therefore **not a navigable destination**.
- Nothing about source approval, the publication gate, OSM's block or the convenience-store rule was
  loosened. All 34 records still cite `taito.listed.v1` for existence — including the withheld ones.

Remaining unresolved conflicts: **none of the eight**. What remains open is not a conflict but a
modelling gap and a freshness obligation, both in §5.

## 4. License, attribution and registry validation **[measured]**

All twelve checks in the analysis pass (`failedChecks: 0`):

| Check | Result |
|---|---|
| `published-sources-reviewed` | the only published source is in `REVIEWED_SOURCES` |
| `published-sources-approved` | its `sources.publication_status` is `approved` |
| `registry-row-matches-reviewed-entry` | the database row equals the reviewed entry (name, kind, license name, license URL, attribution, status) |
| `published-sources-carry-license-and-attribution` | license name, license URL and attribution text are all present |
| `published-tiles-carry-attribution` | all 5 non-empty tiles carry `sources[].attributionText` |
| `osm-blocked` | no `kind = 'osm'` source is approved or published |
| `taito-public-smoking-areas-unstated-fields-stay-unknown` | all 34 Taito-derived spots leave `spotType`, `hostType`, `accessType` and `environment` unknown/null with no provenance row, **because 台東区's file states none of them**. This is a per-source expectation, not a repository invariant: a future reviewed source that states a type resolves it with provenance and is untouched by this check (`test/data-quality.test.ts`) |
| `taito-public-smoking-areas-existence-evidence-is-the-municipal-listing` | all 34 cite `taito.listed.v1` for existence — the ward listing, never the convenience store or venue that hosts the spot |
| `taito-public-smoking-areas-list-page-conflicts-resolved-conservatively` | all 8 attested contradictions with the ward's list page are resolved subtractively, each with a named provenance rule. It **fails** if a reconciled record regains parsed hours or gets published (tested) |
| `published-spots-are-active-and-unheld` | no published spot is `temporarilyClosed`, `removed` or under a publication hold |
| `tiles-at-data-tile-zoom` | every tile is z14 |
| `tile-zoom-thresholds` | max 11 spots/tile and 1,472 gzip bytes/tile |

Coherence, re-read on 2026-09-21 **[verified]**: the license name (CC BY 4.0), the license URL
(`creativecommons.org/licenses/by/4.0/legalcode.ja`) and the 元データ URL inside the attribution text
all still match the ward's own page, and the 元データ URL is the exact file that was imported.

## 5. Recommended first beta geography **[judgement]**

**台東区 (Taito City, Tokyo) only — and within it, the Ueno–Asakusa corridor bounded by
35.6985–35.7279 N, 139.7657–139.8051 E.**

This is not "Tokyo coverage" and must never be described as such. Taito is 1 of Tokyo's 23 special
wards, about 10 km² of a 627 km² 23-ward area; 32 published spots is what one ward's own list
contains once the records its other publication contradicts are withheld (§3a).

Covered:

- Ward-designated public smoking locations in Taito, from the ward's own current release: 上野 (7),
  浅草 (6), 上野公園 (3), 東上野 (3), 台東 (3), 松が谷 (2), and one each in 池之端, 今戸, 清川, 根岸,
  西浅草, 花川戸, 柳橋, 寿, 雷門, 小島 **[measured]**.
- The dense core — Ueno and Asakusa stations — where median nearest-neighbour spacing is 209 m.

Not covered:

- Anything outside 台東区. Any adjacent ward (墨田, 荒川, 文京, 千代田, 中央, 江東) has **zero** spots.
  A user 300 m over the ward line sees an empty map with no explanation.
- Within Taito: 谷中, 入谷, 三ノ輪, 橋場, 日本堤, 千束 have no listed spot **[measured]**; the
  north-west and north-east of the ward is empty. Max nearest-neighbour distance is 1,112 m, and one
  z14 tile holds a single spot.
- Smoking locations that exist but the ward does not list (private venues that never applied,
  ashtrays inside facilities). The corpus is "what 台東区 designates", not "where you may smoke".

Known limitations to state in the beta UI:

1. **Freshness**: one dataset-level date for everything (2026-08-18, 34 days old at measurement).
   There is no per-record verification date and the ward states no update cadence, so `lastVerifiedAt`
   is the *list's* date, not a site check.
2. **Semantics**: `spotType`, `accessType` and `environment` are 100 % unknown, and
   paper/heated support is unknown for 31 of 32. The UI must render unknown as unknown.
3. **Hours**: 20 of 32 are parsed and **12 are unknown**. No published parsed value now disagrees
   with the ward's other publication (§3a) — but the price is that conditional hours (weekday-only,
   holiday and seasonal exclusions) are published as *no hours at all*, because `openingHours.v1`
   cannot express them. The UI must show "hours unknown", never "open".
4. **Location meaning**: coordinates are the ward's values, datum unstated (assumed JGD2011 ≈ WGS84).
   The temporarily relocated place (#29) is withheld rather than shown at its old point.
5. **Two listed places are not in the corpus at all** (#18, #29). The map is 32 of the ward's 34
   listed locations, by design; a user standing at either will find nothing there.
6. **The withheld records need re-checking, and nothing expires on its own.** #18's closure was
   announced to end 2026-09-22 (予定) and #29's relocation has no stated end. Both stay withheld
   until someone re-runs `spot-check.mjs` and re-reviews the attestations. A time-dependent resolver
   was deliberately not built: it would make tile bodies irreproducible.

## 5a. Beta gate verdict **[judgement]**

The geography question and the corpus measurement are settled. Readiness is not, and the two are
answered separately:

| Use | Verdict |
|---|---|
| Internal development and on-device testing | **Usable now.** The corpus is small, fully attributed, from one approved official source, and every unknown is published as unknown. |
| Bounded geography, whenever this corpus is used | **台東区 only.** Never described as Tokyo coverage. |
| External real-data beta — **data** blocker | **CLEARED by Issue #42.** Every known contradiction that could produce a false `openNow` or a stale navigation destination is now resolved conservatively (§3a), enforced by the database, the publisher, the resolver and two quality checks, and covered by regression tests. |

Why the data blocker is cleared, precisely: of the eight contradictions between the ward's two
current publications, **zero** remain capable of producing a confident claim the ward contradicts.
Six records publish no machine-readable hours instead of contradicted ones; one is not published
because the ward says it is closed; one is not published because the ward says it has moved and no
authoritative replacement coordinate exists. Nothing is corrected to the unlicensed page's values.

What this verdict does **not** say:

- It is not a statement that the corpus is complete, or that any listed place physically exists or
  currently has an ashtray. Neither was ever verified (§3), and Issue #42 did not change that.
- It is not permission to describe the corpus as Tokyo coverage, or to ship it outside 台東区.
- It does not cover any non-data beta gate (app readiness, support, privacy review, store rules).
  Those are decided elsewhere; this document only answers the data question.
- It expires with the check date. If `spot-check.mjs` returns different findings — a new release, an
  edited list page, a closure that ended — the attestations must be re-reviewed before the corpus is
  put in front of external users again. The importer already refuses a release whose records no
  longer match the attestations.

## 6. Candidate next sources — research only **[verified 2026-09-20]**

Nothing here is approved. Adding any of these means a separate review, a `docs/SOURCES.md` entry and
a `REVIEWED_SOURCES` change in a PR of its own. A census of the Tokyo open data catalog
(`package_search` for 喫煙所 / 喫煙 / たばこ, 2026-09-20) returned exactly **two** smoking-location
datasets among all publishers: Taito's and Koto's.

| # | Municipality | Official source | Format | License / terms status | Useful fields | Evidence explicit? | Ingestion risks |
|---|---|---|---|---|---|---|---|
| 1 | 江東区 | `opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv` and `…_park.csv` (catalog `t131083d0000000061`) | 2 CSVs, Shift_JIS, `last_modified` 2025-03-16 | CC BY in the **catalog metadata only**; the ward's own terms page was not checked | 緯度, 経度, 喫煙所名, 場所 (station file only) | Yes — ward-published 公共喫煙所 list | Only **6 records total**; no hours, no as-of date, no notes; encoding is cp932; 18 months old |
| 2 | 墨田区 | `city.sumida.lg.jp/kurashi/volunteer/rojyou_kinnen/suishintiku.html` | HTML tables on the ward site; no open-data CSV found | **No reuse license found**; page footer states "Copyright Sumida City. All rights reserved." | Facility name, address only | Yes — 指定喫煙所 designated by the ward | No coordinates, no hours; scraping HTML without terms is not acceptable under `docs/DATA_POLICY.md` |
| 3 | 文京区 | `city.bunkyo.lg.jp/b003/p006762.html` (施設案内: 指定喫煙所) | Map/facility-guide page; the ward's open-data portal lists no smoking dataset | unreviewed | Name, address | Yes — ward-designated | Not machine-readable; would need the ward to publish a dataset |

Not candidates, re-confirmed: 千代田区 (PDF, secondary use prohibited), 港区 / 渋谷区 (no usable
terms), OpenStreetMap (ODbL obligations unreviewed → blocked), Apple Maps / MapKit POIs
(non-canonical by ADR-0001 and the root contract). Note also that the Tokyo catalog's **台東区 entry
is stale**: it still points at `20230601_koshukitsuenjo.csv`, which returns HTTP 404. Always use the
ward's own page.

**Recommendation [judgement]:** adding 江東区 buys 6 spots in a non-adjacent ward with no hours and
no as-of date; it would make the map look broader while making freshness and hours *worse*. Do not
add it for the beta. The higher-value next work is a second Taito release (to settle the stable
record key, research §7) and reconciling the hours against the ward's list page.

## 7. Tile zoom threshold check **[measured]**

`DATA_TILE_ZOOM = 14` remains correct, and publication did change (34 → 32 spots), so these were
re-measured. ADR-0005 says to re-evaluate if any tile exceeds ~250 spots or
~16 KB gzip:

| Measure | Current maximum | Re-evaluation trigger | Headroom |
|---|---|---|---|
| Spots per tile | 11 (`14/14553/6449`) | 250 | 23× |
| gzip bytes per tile | 1,472 (`14/14553/6449`) | 16,384 | 11× |
| Raw bytes per tile | 6,490 | — | — |

The corpus is three orders of magnitude below the density at which the zoom decision changes, and the
whole corpus fits in one 3×3 fetch. **No zoom change is justified by these measurements**, and the
analysis fails its `tile-zoom-thresholds` check automatically if a future corpus crosses either line.

## 8. Recommended next source work **[judgement]**

1. ~~Issue #42 — the external-beta blocker.~~ Done (§3a): the list page is a conflict reference, not
   a source, and every contradiction is resolved subtractively. The follow-on work it leaves is a
   structured model for conditional hours (weekday-only, holiday and seasonal exclusions), which
   would return machine-readable hours to six records without asserting anything unsupported, and a
   re-check of the two withheld records.
2. Import a second Taito release when one appears, and settle the stable source record key. The row
   order already differs between the two publications of the same 時点, so `#` is confirmed unusable.
3. Only then survey a second municipality. The catalog census (§6) says the supply of machine-readable
   ward smoking datasets is two, so growth means asking wards to publish, not harvesting.
