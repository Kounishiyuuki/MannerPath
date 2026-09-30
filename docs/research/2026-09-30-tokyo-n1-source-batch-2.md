# N1 Tokyo source batch 2 — 2026-09-30

Issue #109, child of #67; Codex. Starts from the [previous survey](2026-09-29-tokyo-n1-source-survey.md), targeting five concrete blockers. Independent of PR #108; no cross-source merge or migration 0019. Discovery metadata never substitutes for original terms.

## Approved: 港区, hidden mixed-facility resource

Publisher: 港区; catalog author 企画経営部区長室. Dataset: [複合施設・男女平等参画施設・その他の施設](https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo).

The [official catalog API](https://opendata.city.minato.tokyo.jp/api/3/action/package_search?rows=1000) returned all **560 packages**. Only five metadata matches for 喫煙 were statistical surveys. All 43 geospatial packages were identified, then all 12 `minatokushisetsujoho_*` packages' CSV/GeoJSON payloads inspected. The generic `fukugo` payload contains actual smoking locations despite its generic catalog title. A smoking-keyword catalog search alone misses it.

- [Raw CSV](https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv): 96,869 original UTF-8 bytes; SHA-256 `d11ad6a5c2c72bba114d58bc7cce9f84f54338c75ee37cdd275b7680c6314220`. 169 facility records, blank separator and publisher version trailer. Preserve the original bytes; validate trailer before parsing records.
- [Official package API](https://opendata.city.minato.tokyo.jp/api/3/action/package_show?id=minatokushisetsujoho_fukugo) binds the exact resources to 港区; resource modified 2026-07-16, trailer `Ver20260714`. Neither is observation time.
- [GeoJSON sibling](https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/305a0d9f-38bd-41cc-9ca6-fdda6dd3662a/download/minatokushisetsujoho_fukugo.json): 169 features, 115 explicit designated-smoking Point features, publisher longitude/latitude matching CSV. Not imported as another source.
- License applicability: [catalog terms](https://opendata.city.minato.tokyo.jp/about) govern same-host CSV/GeoJSON, explicitly permit copying, public transmission, adaptation and commercial use and permit use under **CC BY 4.0**. The [exception annex](https://opendata.city.minato.tokyo.jp/pages/exhibit) lists ちぃばすGTFS and 赤ちゃんの駅, not this dataset. Ordinary HTML does not inherit this approval. Catalog `license_id=cc-by` by itself is insufficient; version comes from original terms.
- Redistribution/modification: yes; source, URL, use date and processing disclosure required. [CC BY legal code](https://creativecommons.org/licenses/by/4.0/legalcode.ja) §2/§3; no share-alike. Attribution identifies 港区, dataset/raw URLs, 2026-09-30 use, license and extraction/normalization; see exact registry wording in `docs/SOURCES.md`. Images and third-party linked maps are not served.
- Coordinate semantics: explicit 緯度/経度 for classified smoking places, backed by publisher Point features. CRS, accuracy and entrance precision are undeclared. Direct display coordinates only; no geocoding or Google/MapKit/OSM supplementation. Same coordinates for multiple floors do not authorize merging them.
- Scope: rows with exact designated-smoking classification/code/path; **114 included**, 54 other facilities and one uncertain smoking point excluded. This is partial 港区 coverage, not all 116 locations of the current ordinary list. Convenience-store names are included only because the publisher explicitly classifies that particular smoking location, never because a store exists.
- Current-operation check: [official aggregate](https://www.city.minato.tokyo.jp/kankyouseisaku/shiteikitsuenbasyo.html), updated 2026-07-10, states 116 as of 2026-06-01. 111 raw names match after typography normalization; three naming variants (facility pages 71, 81, 86) match identifiable venues. All 115 publisher facility pages fetched successfully, exact smoking titles present, no closure/relocation notices found in their body. URL/status/hash review metadata retained in fixture `operation-checks.json`; HTML values are not imported.
- Exclusion: [facility 109](https://www.city.minato.tokyo.jp/shisetsu/sonota/kitsuen/109.html), エコロパーク芝大門第3駐車場内指定喫煙場所, is absent from current aggregate. Its own page remains available, so closure is **unknown**; conservative omission is not a claim it closed. No ordinary-page coordinates/hours are substituted. Additional aggregate-only sites cannot be geocoded or added.
- Observation date: none; `observedOn=null`, `lastVerifiedAt=null`. Per-row 最終更新日 is page modification, not field observation. Update frequency unspecified; [official catalog description](https://www.city.minato.tokyo.jp/ictsuishintan/opendata/cataloguesite.html) describes automatic HTML-to-CSV conversion but guarantees no interval/SLA.
- Automated fetch: unauthenticated GET of stable named official resources succeeds. First reviewed release pinned; `crossReleaseValidated=false`, completeness `partial`, no `refreshTarget`.

Third-party BODIK discovery points to an older dedicated smoking CSV/GeoJSON package `29ded576-f3a0-4bf9-83a3-a51d6954d458`. Its official package API and both raw URLs return 403; slug returns 404 and it is absent from the current catalog. That metadata is not licensing evidence and those bytes are not imported. The replacement candidate above is independently reviewed on publisher infrastructure.

## Blocked: four municipalities

All checks below were performed 2026-09-30. Retrieval dates and page update dates are not smoking observation dates. For every blocked source: no approved raw smoking coordinate resource, no stable licensed automated smoking-point fetch, completeness unknown, no included records (all excluded), no adapter or refresh target. Attribution, redistribution/modification and share-alike of unavailable datasets stay **unreviewed**, rather than borrowing another dataset's license.

| Publisher / original source and scope | Deep review / exact blocker |
|---|---|
| 千代田区 [無料喫煙所一覧](https://www.city.chiyoda.lg.jp/koho/machizukuri/sekatsu/jore/muryokitsuenjo.html), ward/assisted public locations; updated 2026-09-11 | [Official catalog](https://www.city.chiyoda.lg.jp/koho/kuse/shisaku/johosesaku/opendata-catalog.html) has no discovered smoking point resource. Normal list has addresses, no explicit coordinate/map payload. [Website terms](https://www.city.chiyoda.lg.jp/koho/kuse/homepage/riyokiyaku/index.html) permit redistribution/adaptation/commercial use for non-excluded content, require source URL and changes; [secondary-use guide](https://www.city.chiyoda.lg.jp/koho/kuse/homepage/open-data.html) names CC BY 2.1 JP (no share-alike). But [SMOKING AREA MAP](https://www.city.chiyoda.lg.jp/koho/machizukuri/sekatsu/jore/kitsuenjo.html) specifically prohibits secondary use of map images. Coordinates therefore blocked. Current list marks 神田橋公園 unavailable from 2026-05-18 and trailer mobile. Cadence/observation unknown; no fixed coordinates inferred. |
| 渋谷区 [区内公共喫煙所一覧](https://www.city.shibuya.tokyo.jp/kankyo/machi-seiso/kitsuen/smokingplace.html), ward/assisted/building-ordinance/other sites; updated 2026-07-23 | [Official open-data entrance](https://www.city.shibuya.tokyo.jp/kusei/tokei_shibuya/kusei/open-data.html) delegates to ArcGIS Hub. Pagination of [organization API](https://www.arcgis.com/sharing/rest/search?f=json&q=orgid%3AUtdeFTavkHfI94t2&num=100) (172 public items) and [catalog group](https://www.arcgis.com/sharing/rest/search?f=json&q=group%3A7af50d2b0ca547f698edf7370ff2337d&num=100) (122 items) found no smoking point layer. [Facility layer](https://services3.arcgis.com/UtdeFTavkHfI94t2/arcgis/rest/services/131130_facilities_offices/FeatureServer/0?f=json) has 527 host facility rows but zero 喫煙/禁煙/smok matches. `c4550fb966f34335abbc28207f638980` is enforcement statistics, not geometry. [Site policy](https://www.city.shibuya.tokyo.jp/guide/website/list/site_policy.html) prohibits ordinary content reproduction; open-data terms applicability to smoking HTML unestablished. Coordinates and permission blocked; cadence/observation unknown. |
| 杉並区 [official smoking places](https://www.city.suginami.tokyo.jp/s102/688.html), six station-front and two indoor places | [2026-04-01 renewal notice](https://www.city.suginami.tokyo.jp/s097/news/24721.html) moves GIS to [suginami.geocloud.jp](https://suginami.geocloud.jp/). [Official open-data guide](https://www.city.suginami.tokyo.jp/s005/8444.html) directs map exports there; new GIS returns 403 in this environment. [Official list CSV](https://www.city.suginami.tokyo.jp/documents/8444/open-data-list.csv) and [Tokyo package](https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t131156d0000000038) still identify only 路上禁煙地区 (six station prohibition areas, 2019-11-01, 随時), old `OpenDataDetail?lid=205&mids=35` 404. Not actual smoking points. [Open-data terms](https://www.city.suginami.tokyo.jp/documents/8444/opdata-riyoukiyaku.pdf) CC BY 4.0 apply to designated data, not established for [ordinary content](https://www.city.suginami.tokyo.jp/about/17.html), whose unauthorized reproduction/modification is prohibited. New point payload/license/coordinates unavailable. |
| 足立区 [station smoking facilities](https://www.city.adachi.tokyo.jp/chiiki/kituenjo-seibi.html), updated 2026-03-05 | [Catalog 喫煙 search](https://www.city.adachi.tokyo.jp/opendata/index.php?keyword=%E5%96%AB%E7%85%99) GET/POST zero results. [KML facility categories](https://www.city.adachi.tokyo.jp/shisetsu/index.html) (17) and [GIS map categories](https://www.city.adachi.tokyo.jp/josys/20141027.html) (seven) expose no discovered smoking layer. Environment/cleaning KML contains only cleaning office/recycling hall. [GIS terms](https://www.sonicweb-asp.jp/adachi2/agreement?confirm=false) personal use only, commercial use prohibited. [Website policy](https://www.city.adachi.tokyo.jp/hodo/kangae/index.html) prohibits unauthorized reproduction/modification; [open-data terms](https://www.city.adachi.tokyo.jp/documents/29609/opendata-kiyaku.pdf) explicitly exclude blanket application to all website information. Ordinary text says 18 facilities but lists 19 including March 2026 竹ノ塚西口: no complete inference. Coordinates/permission blocked; cadence/observation unknown. |

## Next targeted candidates

1. N1 杉並: obtain current geocloud high-function open-data layer index; verify actual smoking points rather than prohibition polygons, and exact resource terms. No claim the layer exists.
2. N1 港区: clarify omitted facility 109 and aggregate-only points before widening this pinned scope; ask publisher for cadence/datum/observation semantics. No automatic update approved.
3. N1 足立: seek specifically licensed coordinate CSV for the 19 named station facilities; GIS personal-use terms cannot unlock publication.
4. Next nationwide tranche candidate 京都市: [publisher dataset 00003](https://data.city.kyoto.lg.jp/dataset/00003/) explicitly includes 喫煙場所 among facility categories, declares CC BY 4.0 and lists a 2026-09-03 release. [Current public smoking page](https://www.city.kyoto.lg.jp/bunshi/page/0000027498.html) offers operation crosscheck. Promising machine-readable facility-scope review, but raw coordinate semantics/current row scope/terms review not complete and no source approved here. Confirm strategy tranche before implementation.

No new municipal source beyond Minato meets the full gate in this batch. No maps were geocoded, no host records promoted, no restricted page/PDF payload redistributed.

## Local validation after rebasing onto #115 (2026-09-30)

The published main baseline now includes Musashino and the completed-bootstrap Taito quality fix.
Numbers below are from a fresh five-source local D1, not the earlier four-source branch.

| Pipeline | Raw | Canonical | Published | Tiles |
|---|---:|---:|---:|---:|
| Taito | 34 | 34 | 32 | 5 |
| Osaka | 524 | 344 | 344 | 55 |
| Koto | 3 | 3 | 3 | 3 |
| Musashino | 25 | 3 | 3 | 3 |
| Minato | 169 | 114 | 114 | 9 |
| Combined | 755 | 498 | 496 | 75 |

Fresh Wrangler local D1 migrations 0001–0018, each source ingest/observation/resolution,
combined publish, quality, promotion-bundle.v3 export, fresh-target bootstrap and deterministic
re-export all pass. The origin contains 498 source observations; both origin and target quality
pass all 14 checks. The target carries five sources/releases, 755 raw records, 496 published
canonical spots and 75 tiles. The prior promoted-target Taito quality failure is resolved by
#115: only intentionally withheld conflict rows may be absent in a completed, matching
bootstrap; ordinary ingestion and incomplete bootstrap remain strict.

The target has zero source_observations and omits two withheld Taito canonical rows under the
unchanged ADR-0008/migration0018 publication-state bundle contract. This is not a full ingestion
backup. No remote D1, field visit, automatic refresh, repeated-release or cross-source merge
validation is claimed.

Final checks: `make contract`, `make api-validate` (511/511 tests), API `npx tsc -p .`,
`git diff --check` and `git diff origin/main --check` pass. Fresh local D1 used an isolated
Wrangler config and `--persist-to`; no default user state. Verified v3 content hash:
`e97f29748bce69746148308efed179cb29add0ce1eb02dc90ec130646a97db1b`.
Temporary validation artifacts under `/tmp/mannerpath-integration-112/` are not source
fixtures or deployment artifacts.
