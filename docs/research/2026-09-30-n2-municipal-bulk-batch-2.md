# N2 municipal bulk source batch 2 — east/north

Issue [#113](https://github.com/Kounishiyuuki/MannerPath/issues/113), child of #67.
Baseline origin/main; no dependency on draft #108/#111/#112. Codex implementation, 2026-09-30.

## Result and limits

One approved source, 武蔵野市, adds **3 published smoking-site Points** (25 raw Placemarks).
The requested 5–10 sources / hundreds of spots target is **not achieved**. Neither a favorable
license alone nor facility/park coordinates justify publication. No OSM, Google coordinates,
address geocoding or image-derived positions were used. No API/Apple deployment or remote DB.

A/B = directly usable smoking dataset / exact smoking facility category; C = license unresolved;
D = smoking-site coordinates unavailable; E = current-operation conflict; F = no usable source
found in the bounded scan. F does not assert that no dataset exists. Candidate-level blockers
are not publisher judgments. License gates for rejected datasets were not necessarily exhausted.

## Priority scan (18 municipalities)

| Municipality | Result | Primary evidence and stopping reason |
|---|---|---|
| 札幌市 | F | [official CKAN](https://ckan.pf-sapporo.jp/api/3/action/package_search?q=%E5%96%AB%E7%85%99) returns 0 smoking datasets; inspected facility resources provided no exact smoking category |
| 仙台市 | D | [official open data](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_example.html), [facility CSV](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/documents/041009_public_facility.csv): 2,844 rows, one park amenity smoking mention. Park host coordinates are not smoking-site coordinates; CKAN smoking search 0 |
| 新潟市 | D/E | [inventory](https://www.city.niigata.lg.jp/shisei/seisaku/it/open-data/index.html), [current locations](https://www.city.niigata.lg.jp/kurashi/gomi/gomi_recycl/seidoannai/poisuteindex/smoking/ekinan.html) HTML/maps only; [old station site closed 2024-08-05](https://www.city.niigata.lg.jp/kurashi/gomi/gomi_recycl/seidoannai/poisuteindex/seigen.html) |
| さいたま市 | D (C unresolved) | [current official page](https://www.city.saitama.lg.jp/001/009/014/p060591.html), [OD delegation](https://www.city.saitama.lg.jp/006/013/014/): images/PDF; no approved licensed smoking-site point resource established |
| 千葉市 | D | [current official page](https://www.city.chiba.jp/kankyo/junkan/haikibutsu/rojoukituenpoisue-boushi.html): map/PDF. [catalog API guide](https://www.city.chiba.jp/somu/joho/kaikaku/opsite_riyou.html); API retrieval certificate failed locally, not bypassed; catalog scan incomplete |
| 横浜市 | D/E | [current list](https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/gomi-recycle/seiketsu/kitsuen/kinshitiku.html): Google map excluded, current closure/new-site changes. [public-facility CSV](https://www.city.yokohama.lg.jp/city-info/zaisei/fmsuishin/facility-management/hakusyo/manejiment_hakusho.files/0058_20260408.csv) has no smoking rows; no coordinates borrowed |
| 川崎市 | D (C unresolved) | [official smoking inventory](https://www.city.kawasaki.jp/kurashi/category/262-2-4-0-0-0-0-0-0-0.html), [OD list](https://www.city.kawasaki.jp/main/opendata/opendata_list.html): no licensed machine-readable smoking-site points established |
| 相模原市 | D (C unresolved) | [eight current sites](https://www.city.sagamihara.kanagawa.jp/kurashi/1026529/1026549/1026557/1008486.html), HTML/images; no approved raw coordinate resource |
| 長野市 | F (C unresolved) | [official facility data/own terms](https://www.city.nagano.nagano.jp/n023500/contents/p006172.html), [March 2026 ZIP](https://www.city.nagano.nagano.jp/documents/14796/202603_koukyousisetumap.zip): 2,396 facility rows (236 prefecture/national, 213 finance, 1,947 municipal), no smoking text. Numeric classification has no verified smoking correspondence. Custom terms' derivation/redistribution not established |
| 甲府市 | F | [delegated catalog](https://catalog.dataplatform-yamanashi.jp/ja/dataset/a-01), [facility CSV](https://catalog.dataplatform-yamanashi.jp/dataset/8f25cf9b-f884-43e5-8443-4895ab2d4695/resource/5e44f15a-a265-42d9-904b-60d74ad2a8b6/download/koukyoushisetsu_20220228.csv): no smoking row; official CKAN smoking search 0 |
| 宇都宮市 | F/D | [official smoking page](https://www.city.utsunomiya.lg.jp/kurashi/anshin/kitsuen/index.html); [CKAN](https://catalog.city.utsunomiya.tochigi.jp/) smoking search 0; 12 facility datasets no usable smoking points |
| 前橋市 | F | Official delegated BODIK 25 datasets; [facility dataset](https://data.bodik.jp/dataset/102016_shisankeiei01), [raw CSV](https://data.bodik.jp/dataset/e71e330b-740b-4c60-8f99-06f5f561654f/resource/8c1114f5-ab1c-4bd5-a40a-83a6d7982ce2/download/koukyoushisetu.csv), 416 rows, no smoking name/description/notes/category. Map dataset is population polygons, not smoking facilities |
| 水戸市 | F | [official library](https://www.city.mito.lg.jp/site/open-data/3945.html): bounded environment/city-planning inventory has Eco shops and old-town markers, no dedicated smoking facility dataset |
| 福島市 | D/E | [current official page](https://www.city.fukushima.fukushima.jp/soshiki/9/1047/1/2/15352.html): station sites image/Google only, east site moved 2025-12-01; no point inference |
| 山形市 | F | Bounded official-domain/catalog discovery did not identify a usable resource; no source approval performed |
| 盛岡市 | F | [official regulation/grants](https://www.city.morioka.iwate.jp/kenkou/kenko/kenkojoho/1026571.html), no usable machine-readable smoking-site resource found |
| 秋田市 | D | [official smoking PDF](https://www.city.akita.lg.jp/_res/projects/default_project/_page_/001/006/447/kituenjo_r3.8.pdf): no licensed supplied point dataset established; no PDF coordinate estimation |
| 青森市 | F | [official facility dataset](https://www.city.aomori.aomori.jp/shisei/jouhokoukai/opendata/1006195/1008655.html) discovered; no usable smoking category established. Raw-content check incomplete |

## Expansion

Approved N2 exception: **武蔵野市 (A, implemented)**. Its three heavily used station locations
justify the exception; license applies to exact item, supplied KML is WGS1984, and current city
operation page corroborates three sites. [Full gate and immutable fixture provenance](../../services/data-pipeline/fixtures/musashino-public-smoking-areas/PROVENANCE.md).

Additional bounded discovery: 郡山市 (D/E; [official station ashtray relocation/consolidation](https://www.city.koriyama.lg.jp/site/minasannokoe/151864.html)),
函館市・旭川市 (D/F), 八戸市・船橋市・市川市・柏市・藤沢市・厚木市・町田市・松戸市・川口市・鎌倉市・高崎市・所沢市・横須賀市・三鷹市・立川市・松本市 (F, search-level only).
These 19 expansion municipalities received no full source approval review and are next-scan
candidates, not proven dataset absences. Expanded Tokyo catalog smoking search returned 20
packages: existing Taito/Koto plus policy/statistical datasets, not another publishable source.

Government cross-city pattern: [MLIT high-precision positioning open-data project](https://www.mlit.go.jp/kokudoseisaku/kokudoseisaku_tk1_000108.html)
explicitly delegates G-spatial. Official spec distinguishes F024 smoking **Point** from B015
smoking **area polygons**. Narita r2 Facility has 25 B015/0 F024; Tokyo r2 3 B015/0 F024;
Shin-Yokohama and stadium releases have 0 smoking features. Polygon coordinates do not establish
an actual smoking-site Point/entrance; no centroid was manufactured. Current operation also
unverified. Shinjuku download HTTP400: bounded stop. These remain D/F, despite usable government
standard terms 2.0. [Kanagawa park facility data](https://catalog.opendata.pref.kanagawa.jp/dataset/d1dd79afd3bcfe4ae56b139f5f7f7bb3/resource/2b416702-1a0e-4b89-b17f-42739ef5d580)
has smoking amenities but host-park coordinates, D.

## Implementation and reproduction

Dedicated pinned KML reader; only one new format/source, so no speculative generic framework.
No migration. Registry + local pipeline entry; immutable archive/member, SHA and scoped license
excerpt; invalid coordinates/categories/duplicates/fingerprint gates tested. Existing three
adapters unchanged. Taito quality now recognizes reviewed, completed v2/v3 publication bootstraps:
intentionally omitted withheld spots can be absent, ordinary ingestion missing rows still fail.

Combined ingestion baseline plus new source: 384 canonical / 382 published; 384 observations.
Current promotion v3 deliberately exports **published canonical state only**. Thus fresh DB has
382 canonical / 382 published, 4 sources/releases, source records/provenance/attribution/tile state,
and **0 source_observations**, under ADR-0008 and migration0018. The user's full ingestion-state
reproduction request conflicts with that existing contract. No unapproved schema/ADR change
is hidden in onboarding. This limitation remains explicit; production schema/observation backup
work requires its own decision. Re-export byte identity and quality are checked on fresh bootstrap.

See validation results appended below. No guarantee of exact entrance accuracy or unchanged
physical operation after the review. Next batch: prioritize publisher clarification / licensed
point exports for Yokohama, Sendai, Niigata, Kawasaki, and MLIT smoking Point datasets; rerun
Chiba catalog retrieval normally with a valid certificate chain. Do not reuse Google/OSM points.

## Validation (2026-09-30)

| Check | Result |
|---|---|
| `make contract` | pass |
| `make api-validate` | pass, TypeScript + 507 tests, zero fail/skip |
| `services/api: npx tsc -p .` | pass |
| Focused Musashino + Taito bootstrap tests | 16/16 pass; includes all new source gates and normal-ingest/bootstrapped quality regression |
| Fresh local D1 origin, migrations0001–0018 | pass via `wrangler d1 migrations apply DB --local`, isolated `/tmp/mannerpath-n2-validation/origin` |
| Local ingest → observe → resolve → publish, all4 sources sequentially | pass; Taito34/32, Osaka344/344, Koto3/3, Musashino3/3 canonical/published |
| Combined local quality | 14/14 pass,384 canonical,382 published,384 observations,586 raw records,1916 provenance rows,66 tiles |
| Promotion v3 export + external hash verifier | pass,4 sources/releases declared; SHA-256 `2a5be2639d612637f032fb44ee2df6ed7aa78a848a8920475acaabab9a44b8dd` |
| Fresh target migrations + `wrangler d1 execute DB --local --file promotion.sql` | pass,4 sources/releases,586 raw records,382 canonical/published,1906 provenance rows,66 tiles |
| Target quality / v3 re-export | 14/14 pass; SQL byte-identical; observations0 as explicit existing contract |
| `git diff --check`, `git diff origin/main --check` | pass |

The local D1 harness invoked the same public pipeline/export/quality functions as the existing
CLIs using `getPlatformProxy({remoteBindings:false})`, isolated config/persistence; it was temporary
and removed. GET/license discovery and local validation artifacts are under `/tmp`, not runtime
production data. Promotion SQL and manifest are `/tmp/mannerpath-n2-validation/promotion.sql` and
`manifest.json`; origin/target count+quality reports are `origin-result.json` / `target-result.json`.

Changed files: Musashino adapter/registry/local CLI; immutable ZIP/KML/metadata/license/provenance;
source gate, refresh-skip and combined tests; narrow Taito bootstrap quality + regression tests;
SOURCES, pipeline README and this survey. No dependency or schema change. Independent read-only
implementation review found no production correctness blocker; it did not independently refetch
license/current-operation references.
