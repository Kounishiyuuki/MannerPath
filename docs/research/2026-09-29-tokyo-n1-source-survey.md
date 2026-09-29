# Tokyo N1 west/central 12-ward survey (2026-09-29)

Read-only primary-source survey. No west/central source meets all requested implementation gates in this batch. A failure to discover a licensed dataset is not a claim none exists; candidates below remain blocked pending explicit applicability and coordinate semantics review.

| Ward | Primary official source | Result / blocker |
|---|---|---|
| 千代田 | https://www.city.chiyoda.lg.jp/koho/machizukuri/sekatsu/jore/muryokitsuenjo.html | Current direct evidence, addresses/hours and PDF maps; licensed machine-readable smoking-location resource not found. Page explicitly includes mobile trailer and temporary closure; do not geocode/infer coordinates or treat PDF as licensed open data. |
| 中央 | https://www.city.chuo.lg.jp/kenkouiryou/kenkou/tobacco/kitsuenbasho/index.html ; https://www.city.chuo.lg.jp/documents/3260/20241213_mapura.pdf | Official designated-location/map evidence; normal web/PDF data reuse license and source coordinates not established. |
| 港 | https://www.city.minato.tokyo.jp/kankyouseisaku/shiteikitsuenbasyo.html ; https://opendata.city.minato.tokyo.jp/ | Official list updated 2026-07-10 says 116 places at 2026-06-01. Catalog API q=喫煙 returns five statistical survey datasets, no location dataset. Do not extend catalog CC BY license to normal list. |
| 新宿 | https://www.city.shinjuku.lg.jp/seikatsu/file11_01_00003.html ; https://www.city.shinjuku.lg.jp/opendata/opendata_top.html | Smoking page gives public facilities but open-data license explicitly applies only listed datasets. Downloaded current catalog https://www.city.shinjuku.lg.jp/content/000428573.csv (2026-06-01) and searched 喫煙/たばこ: no matches. No licensed coordinate candidate. |
| 文京 | https://www.city.bunkyo.lg.jp/b003/p006762.html ; https://www.city.bunkyo.lg.jp/b037/p005122.html | Official designated and assisted indoor smoking lists; GoogleMap links/addresses, not established reusable coordinate data. Normal page license applicability unresolved. |
| 渋谷 | https://www.city.shibuya.tokyo.jp/kankyo/machi-seiso/kitsuen/smokingplace.html | Current 2026-07-23 official list distinguishes ward, assisted, building ordinance and other facilities. Addresses/hours direct evidence but no licensed machine-readable coordinates found. Open-data terms https://www.city.shibuya.tokyo.jp/assets/data/contents/open-data/opendata_kiyaku.pdf do not by themselves show applicability to this normal page. |
| 中野 | https://www.city.tokyo-nakano.lg.jp/machizukuri/douro/kitsuenjyo.html | Current 2026-07-24 direct smoking evidence; images/PDF rather than reusable coordinate dataset. Separate 2026-03-26 official opening https://www.city.tokyo-nakano.lg.jp/kurashi/kankyo/kitsuenjo_kaisyu.html confirms operating container. License unresolved. |
| 杉並 | https://www.city.suginami.tokyo.jp/s102/688.html ; https://catalog.data.metro.tokyo.lg.jp/dataset/t131156d0000000038 | Official page gives smoking places. Tokyo catalog CC-BY-4.0 dataset is 路上禁煙地区, not established smoking points. Raw link https://www2.wagmap.jp/suginami/OpenDataDetail?lid=205&mids=35 returns HTTP 404; cannot confirm payload/coordinate semantics/license applicability. Blocked. |
| 豊島 | https://www.city.toshima.lg.jp/152/machizukuri/sumai/bika/taisaku/025701.html | Direct official designated locations, including 2025-09-01 opening; no licensed coordinate dataset discovered. |
| 世田谷 | https://www.city.setagaya.lg.jp/01101/31285.html | Official designated map page updated 2026-02-27 delegates GoogleMap; no source-controlled licensed raw coordinates/cadence reviewed. |
| 目黒 | https://www.city.meguro.tokyo.jp/kankyouhozen/kurashi/kankyou/tabako.html | Direct official list with hours and GoogleMap. No licensed raw coordinate candidate; page states forthcoming 2026-10-01 rule change. Normal webpage cannot be assumed open data. |
| 品川 | https://www.city.shinagawa.tokyo.jp/PC/kankyo/kankyo-kankyo/hpg000011438.html | Direct official list; licensed coordinate machine-readable payload not discovered. Ordinary page alone insufficient reuse review. |

## Cross-catalog verification

Official Tokyo CKAN endpoint https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_search queried 喫煙 (20 datasets), 喫煙所, 指定喫煙, smoking. Japanese search tokenization is broad for compound queries; title/organization filtering identifies location candidates 江東 公共喫煙所一覧 and 台東 公衆喫煙所（区設置分） plus 杉並 路上禁煙地区. Other returned items are statistical reports/non-location facilities. This does not license the ordinary ward web pages above.

Official Minato API https://opendata.city.minato.tokyo.jp/api/3/action/package_search?q=%E5%96%AB%E7%85%99&rows=100 returns five public opinion/environment survey tables, unsuitable for spots. Its official catalog explanation https://www.city.minato.tokyo.jp/ictsuishintan/opendata/cataloguesite.html specifies CC BY 4.0 compatible terms for published catalog data and UTF-8 CSV; this is not proof its normal smoking list is included.

## Next value

1. 港: high direct official coverage (116), catalog infrastructure with machine-readable geo facility support; request/locate explicit smoking-location resource/license scope before adapter work.
2. 千代田 / 渋谷: large official lists and current operational evidence; obtaining explicitly licensed publisher coordinates unlocks substantial central Tokyo coverage.
3. 杉並: repair/find replacement officially linked GIS raw resource; ascertain whether only prohibition polygons or actual smoking points are licensed before proceeding.

No spot count is claimed for blocked sources, and no coordinate extraction from Google/MapKit/OSM is authorized by this survey.

# Tokyo east/north 11-ward primary-source survey (2026-09-29)

Survey method: official ward smoking pages, ward open-data portals and Tokyo official CKAN `package_search?q=喫煙&rows=100`. Search absence is a survey finding, not proof no dataset exists. No normal HTML/PDF was presumed licensed merely because its publisher also offers open data.

| Ward | Official evidence URL | Decision / blocker |
|---|---|---|
| 台東 | https://www.city.taito.lg.jp/kenchiku/machibika/kosyu/webmap.html ; https://catalog.data.metro.tokyo.lg.jp/dataset/t131067d0000000255 | Existing reviewed source; do not duplicate. Normal page updated 2026-09-28 and wider than licensed 区設置分 dataset. |
| 墨田 | https://www.city.sumida.lg.jp/kurashi/volunteer/rojyou_kinnen/suishintiku.html ; https://www.city.sumida.lg.jp/kuseijoho/sumida_info/opendata/index.html | Current designated smoking sites HTML; no licensed smoking CSV located. Portal explicitly distinguishes non-open-data website files from reusable open data. Block pending dataset-specific license. |
| 江東 | https://www.city.koto.lg.jp/380301/machizukuri/sekatsu/undo/45122.html ; https://www.city.koto.lg.jp/012107/koto_opendata.html ; https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000061 | Select station CSV (3 rows), block park CSV (3 rows) for current-operation conflict; details below. |
| 大田 | https://www.city.ota.tokyo.jp/seikatsu/sumaimachinami/kankyou/bika/kitsuenjoseibi.html | Current detailed public smoking HTML (2025-06-23); no dataset-specific reusable machine-readable smoking data located. HTML license/coordinates unresolved. |
| 北 | https://www.city.kita.lg.jp/dev-environment/environment/1010084/1018912.html ; https://www.city.kita.lg.jp/opendata/index.html | Current improvements/operation announcements (2026-08-26), station smoking diagrams; no smoking dataset license/CSV located. Other portal datasets' CC licenses do not extend to smoking page. |
| 荒川 | https://www.city.arakawa.tokyo.jp/a024/kankyou/kankyoubika/shiteikitsuenbasyo.html | Current specific smoking areas HTML (2026-09-18), operating hours and maintenance notices. No explicitly licensed raw coordinate dataset located. Map PDF https://www.city.arakawa.tokyo.jp/documents/3097/tabako.pdf contains ZENRIN copyright/禁無断複写複製; do not extract copyrighted map coordinates. |
| 板橋 | https://www.city.itabashi.tokyo.jp/bousai/kougai/bika/kitsuen/1019824.html ; https://www.city.itabashi.tokyo.jp/kusei/joho/sisetsu/index.html | Official 2-site public smoking page, address/time/diagrams; general GIS open-data presence alone does not establish reusable smoking layer. Dataset license/coordinates unresolved. |
| 練馬 | https://www.city.nerima.tokyo.jp/kurashi/sumai/kitsuentaisaku/smokingarea.html ; https://www.city.nerima.tokyo.jp/category/opendata/index.html | Official smoking location/diagram page; portal lists other datasets, no smoking CSV found. Dataset-specific reuse/raw coordinates unresolved. |
| 足立 | https://www.city.adachi.tokyo.jp/chiiki/kituenjo-seibi.html ; https://www.city.adachi.tokyo.jp/shisetsu/index.html | Extensive current station smoking sites and addresses; listed open-data KML categories omit smoking sites. Normal HTML license unresolved; no licensed smoking coordinate raw resource found. High value if scoped reuse permission obtained. |
| 葛飾 | https://www.city.katsushika.lg.jp/information/1000084/1030260/1025304.html ; https://www.city.katsushika.lg.jp/kenkou/1030183/1001793/1038719.html | Official smoking prohibition areas and subsidized public smoking site guide; no smoking dataset-specific license/raw coordinates found. |
| 江戸川 | https://www.city.edogawa.tokyo.jp/e024/toshikeikaku/kankyo/arukitabako/juutennkuiki.html ; https://www.city.edogawa.tokyo.jp/e004/kuseijoho/opendata/map_data.html | Official station outdoor smoking existence evidence; licensed coordinate CSV catalog lists other categories, no smoking CSV found. Do not transfer general map-data licensing to ordinary smoking page. |

## Koto scoped candidate

- Publisher: 江東区; maintainer 環境保全課, directly stated by official CKAN package API https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t131083d0000000061 (captured in `services/data-pipeline/fixtures/koto-station-smoking-areas/catalog-evidence.json`).
- Official source URL: https://www.city.koto.lg.jp/380301/machizukuri/sekatsu/undo/45122.html (2026-02-04); explicitly identifies current 潮見駅前, 辰巳駅前, 新木場駅前 sites and describes their physical locations. All 3 match CSV names/location strings.
- License applicability: ward's https://www.city.koto.lg.jp/012107/koto_opendata.html (2025-03-14) explicitly names Tokyo catalogue as its current publishing site and links its own organization-filtered datasets. This establishes publication delegation; CKAN package's scoped `license_id=CC-BY-4.0`, `license_url=https://creativecommons.org/licenses/by/4.0/deed.ja` applies to package resources, not ordinary HTML. Official API catalog also binds exact raw resource to 江東区 and CC BY: https://spec.api.metro.tokyo.lg.jp/spec/t131083d0000000061-92c2953f65301ce61a07fc513ab38f15-0
- Raw station URL: https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv ; automated urllib/curl succeeds without auth (314 bytes CP932 (decoded with fatal Shift_JIS); headers 緯度,経度,喫煙所名,場所; 3 rows).
- License rights: CC BY 4.0 permits redistribution and modification including commercial reuse, subject to attribution and marking modifications; normative primary terms https://creativecommons.org/licenses/by/4.0/legalcode.ja . Attribution recommendation: 江東区「公共喫煙所一覧（駅前）」, source URL, CC BY 4.0 license link, processing/change notice. No bespoke attribution string found in metadata.
- Geographic scope: 江東区 station-front public smoking sites only; CSV covers 3, not all ward smoking places. completeness partial.
- Update cadence: official CKAN extras 更新頻度=随時. Raw resources created/last_modified 2025-03-16T15:00:00 UTC (=2025-03-17 JST). Package metadata_modified 2025-12-12T08:21:17.548628; do not treat metadata modification as raw data update.
- Coordinate semantics: explicitly named 緯度/経度 columns, decimal numeric lat/lon paired with named smoking sites; site point coordinates, not merely host-business coordinates. No declared CRS/datum/accuracy/entrance semantics found in raw CSV/catalog; record absence rather than claiming WGS84 or entrance precision. Values: 辰巳 35.64690292565758,139.80896821475952; 新木場 35.644906006161605,139.82577457083127; 潮見 35.658706397598436,139.81676671431978.
- Automated retrieval: stable named raw URL, unauthenticated GET works; no evidence of guaranteed cadence or update SLA. No refreshTarget in this batch; repeated-release and automatic check review deferred.
- Current operation: current official 2026 page matches all 3; no closure flag or opening hours in CSV. Do not manufacture indoor/tobacco/access/openNow attributes.

## Koto park resource blocked

Raw https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_park.csv contains 3 rows: 区立油堀川公園内指定喫煙所, 区立南砂三丁目公園内指定喫煙所, 区立亀戸駅前公園内指定喫煙所. Same clear CC-BY licensing and coordinates, but current official source linked by smoking page https://www.city.koto.lg.jp/470601/machizukuri/kasenkoen/sebi/jidouyuenkinen.html (2024-11-01) states all ward parks became smoke-free 2022-01-01 with no exception described. CSV resource timestamp alone cannot resolve conflict. Block park implementation/publication pending explicit publisher clarification or current authoritative exemption evidence.
