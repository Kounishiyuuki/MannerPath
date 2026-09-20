# Beta data quality gate (Issue #33)

Measurement timestamp: **2026-09-21T00:00:00Z** (analysis) / **2026-09-20T17:59Z** (official-source
spot check). Status: result document. It answers one question — *where is the current real-data
corpus trustworthy enough to put in front of beta users* — and nothing about an App Store launch.

Every number below comes from the local publication state or from the ward's own pages on the dates
above. Claims are tagged **[measured]** (output of the commands in §1), **[verified]** (read from the
publisher's own page or file on 2026-09-20) or **[judgement]**.

**Result in one line:** the corpus is usable for internal development and device testing, bounded to
台東区 and never called Tokyo coverage; the **external real-data beta is blocked on Issue #42**
(§5a). `DATA_TILE_ZOOM = 14` is unchanged.

## 1. How to reproduce

```sh
cd services/api
npx wrangler d1 migrations apply DB --local     # local D1 only; never a remote database
npm run local:pipeline                          # ingest -> resolve -> publish the committed fixture
npm run local:quality -- --now 2026-09-21T00:00:00Z
```

`npm run local:quality` is a read-only analysis of the local database
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
| Published spots | 34 (equal to the active spots in the database — nothing is withheld or extra) |
| Published tiles | 5, all z14, all non-empty (0 empty snapshots) |
| Spots per occupied tile | min 1 / p50 9 / p90 11 / max 11 |
| Bounding box | 35.69849–35.727847 N, 139.76573–139.805037 E (≈3.3 km N–S × 3.6 km E–W) |
| Nearest-neighbour spacing | min 56 m / p50 209 m / p90 695 m / max 1,112 m (`corpus.nearestNeighbourMeters`, haversine, whole metres) |
| Applied releases | 1 (`observedOn` 2026-08-18, 34 records, sha256 `5123ee41…c6c74`) |
| Verification dates | 2026-08-18 for all 34 spots (dataset-level 時点 date; 34 days old at measurement) |
| Evidence quality | `evidence-quality.v1:officialListing` for all 34 |

Unknown rates — what the source does not state and the resolver therefore refuses to guess:

| Field | Unknown | Rate |
|---|---|---|
| `spotType` | 34 / 34 | 100 % |
| `accessType` | 34 / 34 | 100 % |
| `environment` | 34 / 34 | 100 % |
| `supportsPaper` | 33 / 34 | 97.1 % |
| `supportsHeated` | 33 / 34 | 97.1 % |
| opening hours not usable for `openNow` | 7 / 34 | 20.6 % (`parsed` 27, `unparsed` 7) |

Largest tile **[measured]**: `14/14553/6449` with 11 spots; `14/14553/6450` is the largest payload at
6,689 raw bytes / 1,593 gzip bytes. The corpus occupies exactly 5 z14 tiles — one contiguous 3×2
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
| The published corpus is what those spots became in the tiles | `npm run local:quality` (reads `tile_snapshots`; `publishedSpots` equals `activeSpotsInDatabase`) | every published value and the tile payloads |
| A second official publication agrees, on the fields it exposes | `spot-check.mjs` census against the ward's list page | number, name, hours — **not** coordinates |

So the coordinates are traced to the ward's own bytes and to the resolver, **not** independently
confirmed: the ward's list page publishes addresses, not coordinates, and `spot-check.mjs` reads
neither the local database nor the tile snapshots. Nothing here is a physical check of any location.

- Date checked: **2026-09-20** (UTC).
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
- All 34 published spots reproduce their CSV record exactly: name, coordinates, hours status and the
  heated-only semantics. **No discrepancy between the CSV and what MannerPath publishes.** This link
  is the pipeline and provenance tests plus the corpus measurement, not `spot-check.mjs`.

Discrepancies **between the two official publications of the same list** (the CSV we publish and the
ward's list page) — these are the ones that matter for a beta:

| # | Place | CSV (published) | Ward list page | Effect |
|---|---|---|---|---|
| 12 | 清川清掃車庫(内) | 7:00–19:00, parsed | 8:00–20:00 | **`openNow` can be wrong by an hour at each end** |
| 15 | 金竜公園内 | 7:00–19:00, parsed | 7:00–19:30 + 「クレーン作業に伴い一時的に閉鎖することがあります」 | wrong closing time; unannounced closures |
| 16 | 隅田公園内 | 7:00–19:00, parsed | 7:00–19:30 | closing time 30 min early |
| 10 | 本庁舎駐車場出口横 | 8:00–19:00, parsed | 8:00–19:00 **（平日開庁日のみ）** | published as open on weekends/holidays |
| 30 | 佐竹公衆喫煙所 | 7:00–0:00, parsed | 7:00–24:00（年末年始・5月連休・お盆休みを除く） | times agree; the exception days are not published |
| 18 | ファミリーマート 台東一丁目店 | 終日, parsed | 終日 ※2026-09-06〜09-22 店舗内改修のため閉鎖 | **currently closed, published as open all day** |
| 22 | smokers peace in ミマツ書房 | 8:00–21:00 + 「日祝日・元旦は休業」 → unparsed | 平日・土 8:00–21:00、日・祝 9:00–17:00 | the two official sources contradict each other; MannerPath claims nothing (correct) |
| 29 | 中小企業振興センター駐車場内 | name and coordinates of the centre | 「(小島公園北側隣接)※小島公園内へ仮移転中」 | **the published coordinate may not be where the ashtray currently is** |
| 14/15/16 | — | CSV row order | page row order | `#` is not a stable identifier, now confirmed against a second publication (research §7) |

Typographic-only differences (not material): ①→（1）, セブン-イレブン→セブンイレブン,
paspa 上野→paspa上野, full-width/half-width digits and spaces. All are listed in the committed
spot-check JSON with `kind: name-differs`.

Not independently verified: whether any listed place physically exists or currently has an ashtray.
That needs a site visit or a third non-ward source; neither was used. Nothing here is a ground-truth
check — it is a check of one official publication against another.

## 4. License, attribution and registry validation **[measured]**

All ten checks in the analysis pass (`failedChecks: 0`):

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
| `tiles-at-data-tile-zoom` | every tile is z14 |
| `tile-zoom-thresholds` | max 11 spots/tile and 1,593 gzip bytes/tile |

Coherence, re-read on 2026-09-20 **[verified]**: the license name (CC BY 4.0), the license URL
(`creativecommons.org/licenses/by/4.0/legalcode.ja`) and the 元データ URL inside the attribution text
all still match the ward's own page, and the 元データ URL is the exact file that was imported.

## 5. Recommended first beta geography **[judgement]**

**台東区 (Taito City, Tokyo) only — and within it, the Ueno–Asakusa corridor bounded by
35.6985–35.7279 N, 139.7657–139.8051 E.**

This is not "Tokyo coverage" and must never be described as such. Taito is 1 of Tokyo's 23 special
wards, about 10 km² of a 627 km² 23-ward area; 34 spots is what one ward's own list contains.

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
   paper/heated support is unknown for 33 of 34. The UI must render unknown as unknown.
3. **Hours**: 27 of 34 are parsed, but §3 shows at least 3 of those parsed values disagree with the
   ward's own list page and 3 more omit qualifiers it states. **`openNow` from this corpus is
   indicative, not authoritative** — and one place (#18) is closed for renovation until 2026-09-22
   while publishing 終日.
4. **Location meaning**: coordinates are the ward's values, datum unstated (assumed JGD2011 ≈ WGS84),
   and #29 is temporarily relocated in a way the CSV does not express.

## 5a. Beta gate verdict **[judgement]**

The geography question and the corpus measurement are settled. Readiness is not, and the two are
answered separately:

| Use | Verdict |
|---|---|
| Internal development and on-device testing | **Usable now.** The corpus is small, fully attributed, from one approved official source, and every unknown is published as unknown. |
| Bounded geography, whenever this corpus is used | **台東区 only.** Never described as Tokyo coverage. |
| External real-data beta | **BLOCKED on Issue #42** — *"Taito data reconciliation: conservative hours and temporary-location handling"*. |

The block is not about coverage; it is about the corpus asserting things the ward's own other
publication contradicts (§3):

- parsed hours can produce a confirmed `openNow` that a second official Taito publication contradicts
  (清川清掃車庫, 金竜公園内, 隅田公園内);
- temporary-closure and restricted-day qualifiers the ward states are absent from what we publish
  (本庁舎 「平日開庁日のみ」, 佐竹's exception days, ファミリーマート台東一丁目店's renovation closure);
- one location is documented as temporarily relocated while the published coordinate is still the
  permanent one (中小企業振興センター駐車場内).

Telling an external user a place is open when the ward says it is closed is a core-behaviour failure,
not a data-completeness gap, so it gates the external beta rather than being listed as a caveat.

**No correction is hard-coded here.** Issue #33 is a measurement and decision gate; the reconciliation
belongs to #42 and is deliberately not implemented in this change. **After #42 lands, rerun this gate**
(§1) and re-decide external readiness against the regenerated artifacts.

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

`DATA_TILE_ZOOM = 14` remains correct. ADR-0005 says to re-evaluate if any tile exceeds ~250 spots or
~16 KB gzip:

| Measure | Current maximum | Re-evaluation trigger | Headroom |
|---|---|---|---|
| Spots per tile | 11 (`14/14553/6449`) | 250 | 23× |
| gzip bytes per tile | 1,593 (`14/14553/6450`) | 16,384 | 10× |
| Raw bytes per tile | 6,689 | — | — |

The corpus is three orders of magnitude below the density at which the zoom decision changes, and the
whole corpus fits in one 3×3 fetch. **No zoom change is justified by these measurements**, and the
analysis fails its `tile-zoom-thresholds` check automatically if a future corpus crosses either line.

## 8. Recommended next source work **[judgement]**

1. **Issue #42 — the external-beta blocker.** Reconcile published hours against the ward's
   公衆喫煙所ウェブマップ・一覧 page (§3) and decide the temporary-location handling: whether the list
   page becomes a second evidence input, or whether the CSV's parsed hours are downgraded to
   `unparsed` wherever the page adds a qualifier. Three records currently publish a closing time the
   ward's other page contradicts, and one publishes a location the ward says is temporarily vacated.
2. Import a second Taito release when one appears, and settle the stable source record key. The row
   order already differs between the two publications of the same 時点, so `#` is confirmed unusable.
3. Only then survey a second municipality. The catalog census (§6) says the supply of machine-readable
   ward smoking datasets is two, so growth means asking wards to publish, not harvesting.
