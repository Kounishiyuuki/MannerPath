# Launch dataset selection and `DATA_TILE_ZOOM` benchmark (Issue #4)

Date: 2026-09-20. Status: research result. The decision it supports is recorded in ADR-0005.

Every statement below is tagged as **[verified]** (read from the publisher's own page or file),
**[measured]** (output of `services/data-pipeline/research/launch-benchmark/benchmark.mjs`),
**[recommendation]** (engineering judgement), or **[unresolved]**.

## 1. Candidate sources

Candidates surveyed on 2026-09-20. Sources: the Tokyo open data catalog (CKAN `package_search` for
喫煙 / 喫煙所 / 喫煙場所 / たばこ), the Minato ward catalog, and the smoking-area pages of individual wards.

| Candidate | Machine-readable? | Terms found on the publisher's own page | Records | Outcome |
|---|---|---|---|---|
| **台東区 公衆喫煙所** | CSV, standard municipal dataset columns | CC BY 4.0, stated on the dataset page **[verified]** | 34 | **Selected** |
| 江東区 公共喫煙所一覧 (station + park) | CSV (lat, lon, name, location) | CC-BY-4.0 in the Tokyo catalog metadata only; the ward's own terms were not checked | 6 | Second candidate; too small, and has no hours |
| 台東区 old catalog link (`20230601_…csv`) | — | — | — | Returns HTTP 404 (catalog metadata is stale) |
| 千代田区 SMOKING AREA MAP | PDF only | 「上記の地図の画像は、ホームページ利用規約に関わらず、コンテンツの二次利用はできません」 **[verified]** | — | Rejected: secondary use is prohibited |
| 港区 喫煙場所マップ | PDF / map only | No reuse license found; the page shows "All rights reserved" | — | Rejected: no usable terms, not machine-readable |
| 渋谷区 喫煙所マップ | Google Maps link | No reuse license found | — | Rejected: no terms; data is hosted by a third party |
| 新宿区 / 中央区 catalogs | — | No smoking-location dataset listed | — | Not available |
| OpenStreetMap | Overpass | ODbL; obligations for MannerPath are unreviewed | 190 `amenity=smoking_area` in the 23 wards | Density proxy only, never published (DATA_POLICY) |

Why Taito: it is the only surveyed launch-area source that has all of the following. A machine-readable
location file published by the ward itself. An explicit open license on the ward's own page. A recent
as-of date. Operational attributes (hours, closure notes, a heated-tobacco-only marker) that exercise
the evidence model. It also includes ward-listed convenience-store and private smoking locations. That
makes it a real test of the "a host is not evidence; the ward listing is" rule (ADR-0006).

## 2. Verified facts about the selected source

- The dataset page is https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html. It labels the file「公衆喫煙所（令和8年8月18日時点）【更新日：令和8年9月11日】」 **[verified]**
- License text on the page **[verified]**: 「このページで公開されているデータは、クリエイティブ・コモンズ 表示 4.0 国際 ライセンスの下、オープンデータとして提供されています。オープンデータ一覧に掲載しているデータは、自由に利用・改変できます。オープンデータ一覧に掲載しているデータをもとに、二次著作物を自由に作成可能です。オープンデータ一覧のデータをもとに作成したものに、台東区のデータを利用していることを表示してください。…台東区はいかなる責任も負いません。」 It links to https://creativecommons.org/licenses/by/4.0/legalcode.ja.
- CC BY 4.0 legal code **[verified, license text only]**: §2(a)(1) grants the right to reproduce, share and adapt. §3(a)(1) requires attribution: the creator and other items if supplied, a license notice and URI, and an indication of modifications. §3(a)(2) allows this "in any reasonable manner based on the medium". The license contains no ShareAlike condition.
- File **[verified]**: 34 records, 7,266 bytes, UTF-8 with BOM, CRLF line endings, one quoted field with an embedded line break. SHA-256 `5123ee41…c6c74`. A byte copy is at `services/data-pipeline/fixtures/taito-public-smoking-areas/`.

### Field inventory (all 34 records inspected)

| Column | Observed content | Notes |
|---|---|---|
| `#` | 1..34 | Row number. **Not shown to be a stable ID** (see §7) |
| `市区町村コード` | `131067` for every record | Municipality code |
| `自治体名称` | `台東区` | |
| `名称` | Free text; 12 records (#17–26, 28, 32) name a convenience store, private venue or building (e.g. ファミリーマート…, セブン-イレブン…, paspa…) | Record 32's name carries 「※加熱式たばこ専用」 |
| `名称カナ` | Katakana | |
| `設置位置` | Address using full-width numerals; some have trailing spaces | |
| `方書` | Building/floor details; often empty | |
| `利用開始時間` / `利用終了時間` | `終日利用可能` (all day), or `H:MM`; one record ends at `0:00` (midnight) | There is no weekday structure in these columns |
| `緯度` / `経度` | Decimal degrees, 3–6 decimal places | Geodetic datum is not stated (§7) |
| `特記事項` | Free-text closures (土日祝日、年末年始は休業, 毎月第3水曜日は休業…) and 「※加熱式たばこ専用」 | Affects open-now and tobacco-type logic |

No per-record observation date, no per-record status, and no tobacco-type column beyond the free text.

## 3. Conceptual mapping into MannerPath evidence (input to the ADR-0006 schema)

| MannerPath concept | Taito source | Rule |
|---|---|---|
| Source registry ID | `taito-public-smoking-areas` | `docs/SOURCES.md` |
| Source record ID | see §7 | Candidate natural key: `名称` + `設置位置`. Needs a stability check across two releases |
| Existence evidence | Presence of the record in the ward list | Accepted existence evidence from an official source. For convenience stores and private venues, **the ward listing is the evidence, not the host** **[recommendation]** |
| Observation time → `lastVerifiedAt` | Dataset-level 時点 date `2026-08-18` (from the page label / file name) | ADR-0006: a dataset-level date is used when there is no per-record date. Never the fetch time |
| Fetch time | Recorded by the importer, plus HTTP `Last-Modified` and the file SHA-256 | Provenance, not freshness |
| Coordinates | `緯度`, `経度` | Store as source values plus canonical WGS84 |
| Name / address | `名称`, `名称カナ`, `設置位置`, `方書` | Keep raw values. Normalise full-width text only in derived fields |
| Hours | `利用開始時間`, `利用終了時間`, `特記事項` | `終日利用可能` means all day. Closure rules exist only as free text, so **`openNow` must be unknown when `特記事項` has a closure note** unless it is parsed and reviewed |
| Heated tobacco | 「※加熱式たばこ専用」 in `名称`/`特記事項` | heated=yes, paper=no for that record only. Every other record: **unknown** (never inferred) |
| Host context | None as a column | Must not be inferred from the name for publication decisions |
| Access type | None | unknown |
| Attribution | Dataset-level | Attribution goes in the tile `sources[]` array, not per-spot text |

Evidence-schema implications:

1. The raw record must be stored as all 12 columns verbatim. Tobacco type and closure rules are only
   in free text, so a typed-column-only schema would lose information.
2. Observation time is a property of a **source release** (dataset snapshot), not of a record. A
   `source_release` entity (source ID, as-of date, fetch time, Last-Modified, SHA-256, URL) that
   evidence rows reference avoids repeating these values.
3. Removal is detected by absence from a newer release. That needs a stable source record key (§7).

## 4. Benchmark method **[measured]**

Reproduce with `services/data-pipeline/research/launch-benchmark/` (see its README).
Output: `results/2026-09-20.json`. It is deterministic (fixed seed; identical SHA-1 over two runs).

- Tiles: Web Mercator slippy tiles, z13–z16. Tile width at 35.7°N: z13 3,973 m, z14 1,986 m, z15 993 m, z16 497 m.
- Payload: each tile is serialised in the `docs/API.md` envelope. Each spot is an estimated DTO whose string
  contents come from the real Taito records, so Japanese name and address lengths are realistic. It is
  gzip-compressed with Node's zlib default level. **The DTO schema is not final**, so bytes are indicative.
- Nearest-k search: 1,000 origins. From the origin's tile, the client fetches rings of tiles until the
  k-th nearest spot is within the distance the fetched rings guarantee (r × tile width). The ring limit is 8.
  Every tile fetched costs one request, and an empty tile still costs its 112-byte gzipped envelope.
- Scenarios:
  1. **taito-official**: the 34 real records. Origins are uniform over the dataset's bounding box.
  2. **osm-smoking-area-23wards**: 190 OSM `amenity=smoking_area` in the 23 wards (snapshot 2026-09-19T18:19:35Z), used as a density proxy for an eventual multi-ward official dataset. Origins are OSM convenience-store positions jittered by up to ±250 m, as a proxy for street locations.
  3. **stress**: those 190 plus all 5,633 OSM `shop=convenience` in the 23 wards. This is a hypothetical upper bound in which every konbini had a confirmed ashtray. It is **not** a claim about real ashtrays.

OSM data is used only locally for these counts. No OSM records are committed or published.

## 5. Results **[measured]**

`3x3` is the fixed neighbourhood from ARCHITECTURE.md §4 (always 9 requests). `k=…` is ring-expansion
search. Byte values are gzip bytes. "unresolved" means the k-th nearest spot was not proven within 8 rings.

taito-official (34 spots)

| z | occupied tiles | spots/tile p50/p90/max | tile gzip p50/max | tile raw max | 3x3 gzip p50/p90 | k=1 req p50/p90 | k=3 req p50/p90 | k=3 gzip p50/p90 |
|---|---|---|---|---|---|---|---|---|
| 13 | 4 | 11/12/12 | 1048/1093 | 5274 | 4106/4106 | 9/9 | 9/9 | 4106/4106 |
| 14 | 5 | 9/11/11 | 873/1095 | 5057 | 4375/4375 | 9/9 | 9/9 | 4375/4375 |
| 15 | 11 | 2/6/7 | 569/854 | 3115 | 3184/4773 | 9/9 | 9/25 | 4078/6879 |
| 16 | 21 | 1/2/5 | 466/736 | 2456 | 2186/3519 | 9/25 | 25/49 | 5426/9087 |

osm-smoking-area-23wards (190 spots, density proxy)

| z | occupied tiles | spots/tile p50/p90/max | tile gzip p50/max | tile raw max | 3x3 gzip p50/p90 | k=1 req p50/p90 | k=3 req p50/p90 | k=3 gzip p50/p90 | k=3 unresolved |
|---|---|---|---|---|---|---|---|---|---|
| 13 | 31 | 4/15/27 | 661/1637 | 11776 | 6226/10010 | 9/25 | 9/25 | 7359/11259 | 77 |
| 14 | 65 | 2/7/23 | 503/1531 | 10065 | 2875/5685 | 9/49 | 9/81 | 5554/14249 | 77 |
| 15 | 99 | 1/4/14 | 485/1169 | 6181 | 1428/3560 | 25/121 | 25/289 | 7059/32368 | 88 |
| 16 | 126 | 1/2/13 | 464/1113 | 5760 | 1008/2083 | 49/289 | 81/289 | 12549/33098 | 234 |

stress (5,823 spots, hypothetical upper bound)

| z | occupied tiles | spots/tile p50/p90/max | tile gzip p50/max | tile raw max | 3x3 gzip p50/p90 | k=3 req p50/p90 | k=3 gzip p50/p90 |
|---|---|---|---|---|---|---|---|
| 13 | 191 | 3/104/416 | 603/9433 | 178136 | 34930/55059 | 9/9 | 34930/55059 |
| 14 | 377 | 4/41/151 | 694/4325 | 64752 | 17188/25504 | 9/9 | 17256/25504 |
| 15 | 888 | 4/15/53 | 681/2388 | 22741 | 8470/13359 | 9/9 | 8672/13913 |
| 16 | 2142 | 2/6/25 | 521/1644 | 11034 | 4685/7672 | 9/9 | 5082/8384 |

Density **[measured]**: Taito has a median of 9 official spots per occupied z14 tile (mean 6.8; 34 spots in 5 tiles). For sparse,
official-only data (the realistic v1 case), finding the nearest 1–3 spots takes 9 requests at z14 at the
median in both the Taito and OSM-proxy scenarios. At z15 it takes 25 requests at p90 in Taito. In the OSM
proxy it takes 25 at the median and 121–289 at p90. Under the dense
upper bound, the worst z14 tile is 4.3 KB gzip (65 KB raw), and a 3x3 fetch is 25.5 KB gzip at p90.

## 6. Recommendation **[recommendation]**

**`DATA_TILE_ZOOM = 14`.**

- In the realistic case (official data, a few spots per km²), z14 answers "nearest 1–3" in the minimum 9
  requests for the median origin. In the OSM proxy, z15 needs about 2.8× more requests at the median and much
  more at p90. In Taito, it needs 25 instead of 9 at p90 for k=3.
  Request count dominates latency on a mobile connection much more than a few KB of payload does.
- In the hypothetical dense upper bound, z14 stays within small payloads: max tile 4.3 KB gzip / 65 KB raw,
  3x3 p90 25.5 KB gzip. z15 halves the bytes, but saves only about 12 KB per search.
- z13 is rejected. Its worst raw tile (178 KB) and coarse invalidation (one change re-sends a ~4 km tile)
  cost more than the few requests it saves.
- A 3x3 neighbourhood at z14 guarantees coverage of about 1.99 km around the user. That is well beyond
  walking distance, so the fixed 3x3 contract in ARCHITECTURE.md §4 holds without ring expansion in most areas.

Re-evaluate before release if a source makes any z14 tile exceed about 250 spots or 16 KB gzip. Changing
the zoom after release is a contract change (ADR-0005).

## 7. Unresolved

- **Stable source record ID [unresolved]:** `#` is a row number. No previous release was available to check
  whether rows or IDs are stable (the Wayback Machine has no captures; the 2023 link returns 404). Decide the
  key after comparing two real releases, or ask 台東区.
- **Observation-date semantics [unresolved]:** 「令和8年8月18日時点」 is interpreted as the date the list
  reflects. It is not stated to be a per-site physical verification date.
- **Geodetic datum [unresolved]:** not stated. Assumed JGD2011 ≈ WGS84 (sub-metre difference); unverified.
- **Exact attribution wording [resolved by Issue #22]:** the ward's open-data terms prescribe four
  display elements joined by spaces or punctuation (author, license label, no-warranty sentence,
  元データ + original-data URL) and no dataset title. The approved wording is in `docs/SOURCES.md`
  and fixed in code as `TAITO_ATTRIBUTION_TEXT`; it is what the API sends as
  `sources[].attributionText`.
- **Database rights / combination with other sources [unresolved, no legal conclusion]:** not analysed.
  ODbL obligations for combining with OSM remain unreviewed (DATA_POLICY.md).
- **Kōtō terms [unresolved]:** only the catalog's metadata was checked, not the ward's own terms.
- **Multi-ward density [unresolved]:** the 23-ward numbers come from OSM, which is incomplete and not official.
  Repeat the benchmark when a second official ward source is added.
- **DTO size [unresolved]:** the spot DTO is not final. Re-run the benchmark when it is fixed.
- **Update cadence [unresolved]:** the publisher states no update frequency.
