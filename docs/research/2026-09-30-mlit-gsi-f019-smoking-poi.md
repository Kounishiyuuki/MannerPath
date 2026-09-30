# MLIT / GSI indoor POI: F019 targeted follow-up

Codex primary-source research, 2026-09-30, from `origin/main` after PR #121.
**Approved sources: 0; new spots: 0. Actual F019 feature count: 0 in four recovered
local datasets; Shinjuku remains unknown.** No fresh authenticated ZIP was obtained.
Prior batch 2 extracted payloads were recovered and scanned directly. Their original
ZIP fingerprints and acquisition metadata are unavailable, so they cannot approve a
source or establish present publisher-download success. There is also a category-code version mismatch:
the specification attached to the Tokyo/Narita releases defines F019 as a police box.

## Access evidence and inspected datasets

The [current MLIT project page](https://www.mlit.go.jp/tochi_fudousan_kensetsugyo/tochi_fudousan_kensetsugyo_tk17_000001_00009.html)
links the five datasets below. Their live publisher HTML returned HTTP 200 via ordinary
unauthenticated GET. Web search's page reader returned 403 for Tokyo/Narita; that alone
does not establish publisher unavailability. Each dataset explicitly requires user
registration and login to download. The Tokyo and Narita Shapefile resource detail
pages also returned 200, describe ZIP-compressed Shapefiles, and expose no download
link to the anonymous reader. Connected-browser discovery returned no available browser.
No credentials, session stores, private APIs, guessed download URLs or authentication
workarounds were used. A registered publisher path exists in principle; successful
authenticated raw acquisition in this environment is **not established**.

| Dataset title / official dataset URL | Published release date in page history | Shapefile resource ID | Inspection extent |
|---|---|---|---|
| [東京駅周辺屋内地図オープンデータ（令和２年度更新版）](https://www.geospatial.jp/ckan/dataset/mlit-indoor-tokyo-r2) | 2021-01-27 | `d441c885-6a15-476b-836d-cddd9a5fa006` | Dataset, Shapefile detail, terms/specification PDFs, recovered local Shapefiles scanned |
| [成田国際空港屋内地図オープンデータ（令和２年度更新版）](https://www.geospatial.jp/ckan/dataset/mlit-indoor-narita-airport-r2) | 2021-03-10 | `fd298023-506b-42b2-a567-03be4cc0a4d6` | Dataset, Shapefile detail, terms/specification PDFs, recovered local Shapefiles scanned |
| [新宿駅周辺屋内地図オープンデータ（令和２年度更新版）](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2) | 2020-10-27 | `f78d039e-7bb6-4b6a-9f5f-2b5a39e309d6`; integrated ZIP `33e78a35-c16a-4746-b451-47c6122ed51b` | Dataset/resource inventory only; raw/terms not inspected |
| [横浜国際総合競技場屋内地図オープンデータ](https://www.geospatial.jp/ckan/dataset/mlit-indoor-yokohama-arena) | 2019-01-18 | `9fb2efbf-776d-4d3a-aee0-ef058e123aea` | Dataset/resource inventory; recovered local Shapefiles scanned; terms not reviewed this session |
| [新横浜駅屋内地図オープンデータ](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shin-yokohama) | 2019-11-15 | `3e4802ba-df95-4efd-87aa-47e0a70fce0b` | Dataset/resource inventory; recovered local Shapefiles scanned; terms not reviewed this session |

Resource detail URLs are the dataset URL followed by `/resource/<resource ID>`.
Raw ZIP URLs remain **unavailable through the inspected anonymous UI**, not inferred
from those IDs. F019 counts below are scoped to recovered local members; Shinjuku remains unknown. The five are a
bounded inventory of MLIT's own links, not another national broad scan.

## Actual recovered payload inspection

[Batch 2's earlier report](2026-09-30-n2-municipal-bulk-batch-2.md) already recorded
Narita 25 and Tokyo 3 smoking polygons, with no F024 Points. During review, its
extracted files were found under `/tmp/mannerpath-mlit-discovery/`. This session
independently read **every recovered `.shp` and DBF record**, not merely the prior
report. No fresh authentication bypass or ZIP download was attempted.

| Recovered dataset | Shapefiles | Shape/record pairs scanned | Facility Points | F019 (all geometries) | F024 (all geometries) | B015 smoking polygons |
|---|---:|---:|---:|---:|---:|---:|
| Narita R2 | 130 | 11422 | 398 | 0 | 0 | 25 |
| Tokyo R2 | 345 | 19283 | 1271 | 0 | 0 | 3 |
| Shin-Yokohama | 36 | 1859 | 130 | 0 | 0 | 0 |
| Yokohama stadium | 53 | 7048 | 262 | 0 | 0 | 0 |
| Shinjuku | unavailable | unscanned | unknown | unknown | unknown | unknown |

The only category field encountered is `category`. All decoded record fields were
also checked for exact F019/F024/F029/B015 values. None of the four datasets contains
F019, F024 or F029. Narita/Tokyo's B015 records are in **Space** layers and actual
Shapefile geometry type 5 (POLYGON), not Facility Points. No centroid is generated.
All recovered `.prj` values specify `GCS_JGD_2011`, GRS80, Greenwich and Degree units.
Point layers also include routing nodes and tactile guidance; their existence does
not supply a smoking Point. The scan read 11422/19283/1859/7048 records respectively
with no remaining decode or read errors. Narita/Tokyo use UTF-8; Shin-Yokohama/stadium
have UTF-8 and CP932 members. Initial CP932-only decoding failed on UTF-8 members;
closing each reader and trying strict UTF-8 then CP932 resolved that issue.

Extracted-member manifest SHA-256 fingerprints (not original ZIP fingerprints):

| Dataset | Manifest SHA-256 |
|---|---|
| Narita R2 | `bad6f1103f21cf7e61b8a4596259b35f7e6770b12e334e889bc4f173e26fbb41` |
| Tokyo R2 | `c81a99c38bc6016eaf56bb62705ff9882d979f199cc372fa613854864ed34dec` |
| Shin-Yokohama | `077bd877cd612c2bfa8acd1975c38d57c4adb0162bbc9bbd62a67e6b67f6e5e5` |
| Yokohama stadium | `f723e6bc8a1b00c79d354ac83389b9067f0e98913f557effd5f3e3daac47b8eb` |

Fingerprint method: for each recovered `.shp`, include its present `.shp/.shx/.dbf/.prj`
companions. Form `relative POSIX path + TAB + member SHA-256 + LF` per file, sort all
lines lexically, UTF-8 encode their concatenation, then SHA-256. Paths retain the
previous extraction's filename encoding, so re-extracting Japanese ZIP names with
another filename codec may change this manifest. Acquisition dates, raw ZIP URLs,
archive completeness and authenticated chain of custody are **unverified**. These
are actual local payload results, not a claim that current official ZIPs are identical.
No blocked raw data or publisher binary is added to the repository.

## Category semantics depend on the specification version

| Primary specification | F019 | F024 | Postal box | Geometry / CRS |
|---|---|---|---|---|
| [GSI 平成29年3月改訂版（暫定）](https://www.gsi.go.jp/common/000192202.pdf), PDF p.35 / printed p.32 | 喫煙エリア; representative Point of a smoking area/room | 郵便ポスト | F024 | POI Point; §5 JGD2011 latitude/longitude |
| 平成30年3月 specification **attached to both Tokyo/Narita releases**, PDF p.39 / printed p.36 | 交番 (Policebox) | 喫煙エリア (Smoking Area) | F029 | Smoking area/room representative Point; §5 JGD2011 latitude/longitude |

Attached specification resource pages:
[Tokyo](https://www.geospatial.jp/ckan/dataset/mlit-indoor-tokyo-r2/resource/f9d93724-b0d8-45c0-831b-8f8a153fe54a),
[Narita](https://www.geospatial.jp/ckan/dataset/mlit-indoor-narita-airport-r2/resource/16c94a99-5fe3-4be4-a4db-7d251c76c787).
Both render the same public embedded PDF, 714043 bytes, SHA-256
`0741cfd6de43df0e9a313f3de7d72af93faccc7461eaac0bca190169c3cecc80`.
This fingerprint identifies the inspected **specification**, never a raw POI release.

The previous survey's F019/F024 statement applies to the 2017 document and must not
be generalized to these 2018-specification releases. F019-only extraction could
misclassify police boxes. Per the task instruction, **no F024 smoking source is adopted**.
Reconsidering the 2018 smoking code requires an explicit scope correction plus actual
payload inspection; this research does not silently change the requested selector.
Specification geometry is not proof of a downloaded feature's geometry. No host,
building, floor, entrance or polygon centroid is accepted as a smoking coordinate.

## Exact reuse terms reviewed for Tokyo and Narita

Public terms resource pages:
[Tokyo](https://www.geospatial.jp/ckan/dataset/mlit-indoor-tokyo-r2/resource/8428e025-d4db-4d30-917e-fc0bc4d1b866),
[Narita](https://www.geospatial.jp/ckan/dataset/mlit-indoor-narita-airport-r2/resource/7648fde8-244d-438e-b32f-f7226faa6f0c).
Their rendered `<object>` PDF preview URLs were followed exactly as exposed by the
publisher, without inventing a preview parameter for any ZIP. Both returned HTTP 200
and `application/pdf`. Expiring redirect signatures are not retained in this report.

| Gate field | Tokyo | Narita |
|---|---|---|
| Publisher / author | 国土交通省; 国土交通省不動産・建設経済局情報活用推進課; CKAN 政策統括官 organization | Same |
| Exact license title | 東京駅周辺屋内地図オープンデータ利用規約 | 成田国際空港屋内地図オープンデータ利用規約 |
| Established date / version | 2021-01-27; §6(b), Government Standard Terms of Use 2.0 conformant | 2021-03-10; §6(b), same version |
| Applicability | §1 applies to this dataset's published contents, subject to §2 third-party rights and §3 exclusions | Same scoped structure, for Narita contents |
| Redistribution | §1 permits reproduction/public transmission and commercial use, subject to §§1–6 | Same |
| Derivation | §1 permits translation/adaptation; §1(1)(b) requires edit disclosure and forbids implying government authorship | Same |
| Attribution | §1(1)(a) requires MLIT high-precision positioning project credit; §1(1)(b) gives a dataset-title/MLIT/dataset-URL processed-work example | Same requirements, Narita-specific title and URL |
| Share-alike | No share-alike clause in the inspected terms; §6(c) also permits CC BY 4.0 use for contents to which the rules apply | Same |
| Exceptions / remaining license gate | Third-party permission may be necessary; unmarked third-party rights may exist. Logos and expressly separate terms are excluded. Archive notices and reproducible release applicability remain unverified | Same |
| Terms PDF bytes / SHA-256 | 73507 / `b7ee685282912b971656490f51df9ac2d2b7d204fab10933833344fec977d89e` | 85521 / `b89f13ba49683211cd42c30f15ded3e6f389dd4bd6d93a75949d8f361090a205` |

The generic GSI site's reuse terms cannot replace these dataset-specific terms or
resolve archive-specific rights. Favorable general reuse clauses do not approve
features without a reproducible release/access chain. No approved attribution constant or runtime source is created.
Exact terms for the other three datasets remain unreviewed in this session; a matching catalog
license label does not establish identical per-resource permissions.

## Remaining approval fields and current operation

| Gate field | Tokyo R2 | Narita R2 |
|---|---|---|
| Dataset URL | Linked above | Linked above |
| Raw URL / actual F019 count | Fresh raw URL unavailable / 0 in recovered local members | Same |
| Actual geometry / CRS / coordinate identity | Recovered smoking records are POLYGON, `.prj` JGD2011; no smoking Point | Same |
| F019 semantics | Attached 2018 schema says police box; 0 in recovered payload | Same |
| Geographic scope | [MLIT 2021 release](https://www.mlit.go.jp/report/press/tochi_fudousan_kensetsugyo17_hh_000001_00007.html): Tokyo Station surrounding underground space, approximately 1 km east-west / 2 km north-south | [MLIT 2021 release](https://www.mlit.go.jp/report/press/tochi_fudousan_kensetsugyo17_hh_000001_00008.html): terminal floors from railway gates to before departure processing; T3 extension update |
| Observation/update date | Release 2021-01-27; catalog modified 2024-10-05 02:18 UTC, not a feature observation | Release 2021-03-10; catalog modified 2024-10-05 02:26 UTC, not a feature observation |
| Current operation | [JR East's current article](https://media.jreast.co.jp/articles/652), updated 2025-12-05, describes station/nearby smoking places. No individual raw record can be matched; platform entries also must not be assumed inside the indoor release scope | [Airport's live official smoking page](https://www.narita-airport.jp/ja/service/other/smoking/) confirms smoking rooms exist across terminals; no feature-by-feature correspondence to the 2021 release is established |
| Completeness | Unverified; no complete-smoking inventory claim | Unverified; no complete-smoking inventory claim |

Current official pages are investigation references only, not imported value or
coordinate sources. Their presence in 2026 does not confirm any particular 2021 Point.
No page-update, catalog-update, fetch date or release date is substituted for `observedOn`.

## Blocker classification and resume conditions

| Requested outcome / blocker | Finding |
|---|---|
| Raw data acquisition | Blocked in this session by required registered access and no connected browser; not a claim that legitimate publisher acquisition is impossible |
| Actual F019 feature absent | 0 actual F019 in four recovered payloads; Shinjuku count unknown; present official ZIP equality unverified |
| License blocker | General Tokyo/Narita terms inspected, but exact selected-feature applicability/third-party/archive notices remain unresolved; other three terms unreviewed |
| Current-operation blocker | No eligible smoking Point to match; current individual polygon correspondence unverified; generic facility existence insufficient |
| Geometry blocker | Narita/Tokyo recovered smoking features are polygons only; no smoking Points in the four scanned datasets; no centroid permitted |
| Category-version blocker | Attached 2018 specification contradicts an F019=smoking assumption; F024 remains excluded in this task |

Highest-value remaining candidate: **Shinjuku R2**, whose standard and integrated
Shapefile resources have not been scanned here (batch 2 reported HTTP400). Use its
registered publisher download with acquisition metadata and archive notices. Recover
the earlier acquisition trail before repeating Narita/Tokyo; a re-download of unchanged
polygon-only releases cannot satisfy the Point gate. Resolve category version explicitly.
Do not repeat catalog discovery as a substitute. Inspect all floor
POI Shapefiles/DBFs, enumerate category values and actual Point counts, bind geometry
to feature identifiers, validate `.prj` and axis order, and match each eligible smoking
record to current official facility evidence. Reject unmatched/contradicted Points.
Validate latitude -90…90 and longitude -180…180; do not geocode or infer PDF/image
coordinates. No polygon centroid, MapKit/Google or OSM coordinate fallback is allowed.

If a source eventually passes, first-release defaults remain `crossReleaseValidated=false`,
`completeness=partial`, unknown unsupported fields, publisher-explicit `observedOn` only,
and no `refreshTarget` until safety is established. That future implementation requires
the immutable raw fixture/SHA/fetch metadata/provenance, registry/adapter/observations,
attribution/tests, local combined quality, promotion v3 and fresh bootstrap gates.

## Validation and corpus impact

Only this research document is added. No architecture or source contract changes.
Current reviewed runtime source count and previous corpus measurements are reported
separately from this investigation; no new local D1 measurement is claimed.
No new source means the source-addition-only fresh D1/promotion/bootstrap workflow is
not run. Required repository/API/type/diff checks are recorded after execution below.

Runtime registry currently contains **6 reviewed sources** (Taito, Osaka, Koto,
Musashino, Minato, Kyoto), inspected in `services/api/src/pipeline/adapters.ts`.
The [last six-source measurement](2026-09-30-n2-west-central-municipal-survey.md)
reports 515 canonical / 513 published / 81 tiles, quality 14/14, and promotion v3
fresh target 513 canonical/published / 81 tiles. These are prior measurements,
not rerun results from this document-only task.

| Command | Result |
|---|---|
| `make contract` | pass |
| `make api-validate` | pass; typecheck and 549/549 tests, no fail/skip |
| `services/api: npx tsc -p .` | pass |
| `git diff --check` | pass |
| `git diff origin/main --check` | pass |

Independent read-only review identified the omitted batch 2 payload history;
this report now reconciles it and adds a direct recovered-member scan. No new
behavior tests are added because runtime behavior is unchanged.
