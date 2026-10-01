# Source Registry

Every data source must be registered here before its data is published (`DATA_POLICY.md`, ADR-0006).

Rules:

- Do not fill in license details from memory or assumption. Copy them from the source's own published terms and link to them.
- Any field not yet reviewed is written `unreviewed`. A source with any `unreviewed` license field is not published.
- OSM-derived data is not published until ODbL obligations are reviewed (`DATA_POLICY.md`).

## Template

| Field | Value |
|---|---|
| Source ID | |
| Name | |
| Kind | municipal / operator / osm / userReport |
| Dataset URL | |
| License name | unreviewed |
| License URL | unreviewed |
| Required attribution text | unreviewed |
| Redistribution to clients allowed | unreviewed |
| Modification/derivation allowed | unreviewed |
| Share-alike obligations | unreviewed |
| Observation date available | per-record / dataset-level / none |
| Reviewed by / date | |
| Publication status | blocked / approved |

## Registered sources

### OpenStreetMap

| Field | Value |
|---|---|
| Source ID | `osm` |
| Kind | osm |
| License name | ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/) |
| Redistribution to clients allowed | unreviewed — requires legal review (ADR-0010 decision 1); tiles/API assumed to be databases |
| Share-alike obligations | unreviewed — ODbL §4.4/§4.6 apply to any published Derivative Database; reach into the canonical DB is why architecture A is rejected (ADR-0010) |
| Allowed use now | reference-only (ADR-0010 decision 3): no OSM value is stored, published or used as attenuation |
| Publication status | blocked (ADR-0010: legal review required before adoption) |

### MannerPath 利用者報告（審査済み） — community reconciliation (Issue #123)

| Field | Value |
| --- | --- |
| Source ID | `mannerpath-community-reports` |
| Kind | userReport |
| Dataset URL | none: each release is the sanitized artifact of one applied community reconciliation application (`services/api/src/pipeline/community-adapter.ts`, migration 0020) |
| License name | none yet. Consent is now recorded per report against a reviewed terms version (`docs/legal/REPORT_TERMS_DRAFT.md`, migration 0021), but that document is a **draft** awaiting legal/maintainer approval (Issue #124) |
| Required attribution text | none reviewed |
| Redistribution to clients allowed | **no**: not until Issue #124 is resolved |
| Observation date available | none. Report dates are personal and minimized after 90 days (ADR-0007 §4), so `lastVerifiedAt` stays unknown |
| Completeness | partial, additive: each release is one application, no release supersedes another, and none is current |
| Reviewed by / date | Issue #123, 2026-09-30 |
| Publication status | **blocked**. It is resolved into canonical spots and visible to cross-source review once approved, but it is excluded from tiles, spot detail and promotion. Even once approved, a community spot publishes only on reports consented under a `granted` terms version (ADR-0006 amendment 2026-09-30) |
| Evidence tiers (ADR-0012) | `communityReported` (one moderated, consented report with an explicit known spot type) and `communityVerified` (≥ 2 independent submitters, or an independent `exists` confirmation). Artifact v3 (`community-artifact-csv.v3`) also carries the agreed structured claims (type, subtype, access, host, environment, tobacco); free text never. When Issue #124 is granted this entry needs its license name/URL (the granted terms) and attribution wording, like every published source |


#### Approval candidate — NOT in effect (Issue #124, Issue #150)

What this entry becomes when a maintainer approves `docs/legal/COMMUNITY_PUBLICATION_DECISION.md`. The values are
derived in code from `COMMUNITY_PUBLICATION` (`services/api/src/reports/community-publication.ts`); the activation PR
replaces the rows above with these and records the reviewer and date. Until then the status above (**blocked**) holds.

| Field | Candidate value |
| --- | --- |
| License name | `MannerPath 利用者報告規約 (<approved version>)` — the approved report terms, `docs/legal/report-terms/<version>.md` (candidate text: `docs/legal/REPORT_TERMS_CANDIDATE.md`) |
| License URL | the public URL of the approved terms (`COMMUNITY_PUBLICATION.termsUrl`; maintainer input) |
| Required attribution text | `MannerPath 利用者報告（審査済み）` — no contributor names or IDs. Sent as `sources[].attributionText`, so tiles, spot detail, iPhone and Watch show the same text |
| Redistribution to clients allowed | yes, for reviewed facts from reports consented to the approved version only (terms §4.1). Third-party reuse: per terms §4.2, maintainer input |
| Modification/derivation allowed | yes: normalization, structured claims, merging, format conversion (terms §2, §4.1) |
| Share-alike obligations | none (MannerPath's own terms, not a share-alike license) |
| Observation date | none. `lastVerifiedAt` stays unknown; `lastReviewedMonth` is the month the review applied (ADR-0012) |
| Evidence tiers | `communityReported` (one moderated report) / `communityVerified` (≥ 2 independent submitters, or a reviewed independent confirmation; shown as visited-confirmed), always distinct from official/operator |
| Not covered | reports without consent, reports consented to `report-terms.2026-09-30.draft`, notes and every personal field (terms §5) |
| Publication status | approved — **only** after the maintainer decision; reversible by `state: "suspended"` (rollback) |

### 台東区 公衆喫煙所 (Taito City public smoking areas)

Research and evidence: `docs/research/2026-09-launch-dataset-and-tile-zoom.md`. Fixture and provenance: `services/data-pipeline/fixtures/taito-public-smoking-areas/`.

| Field | Value |
|---|---|
| Source ID | `taito-public-smoking-areas` |
| Name | 台東区 公衆喫煙所 |
| Kind | municipal |
| Dataset URL | https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html (file reviewed: `shisethutizujouhou.files/20260818_koshukitsuenjo.csv`, 令和8年8月18日時点) |
| License name | クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0), as stated on the dataset page |
| License URL | https://creativecommons.org/licenses/by/4.0/legalcode.ja (linked from the dataset page) |
| Required attribution text | The open-data terms page prescribes four display elements, in this order, joined by spaces or punctuation: 1. `台東区` (「「台東区」と表示してください。」) 2. `CC-BY表示4.0国際` (「「CC-BY表示4.0国際」と表示してください。」) 3. `本作品の内容について、台東区は一切保証しないものとする。` 4. `元データ` + the original-data URL. No dataset title is prescribed, and none is added. CC BY 4.0 §3(a) also applies. **Approved wording**, sent verbatim as `sources[].attributionText`: `台東区 CC-BY表示4.0国際 本作品の内容について、台東区は一切保証しないものとする。 元データ https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv` |
| Original-data URL used in the attribution | The release file the data was imported from (`shisethutizujouhou.files/20260818_koshukitsuenjo.csv`) — 元データ means the data itself. The landing page above stays catalog/dataset metadata. A new release changes this URL together with the imported file |
| Redistribution to clients allowed | Page: 「自由に利用・改変できます」. CC BY 4.0 §2(a)(1) grants the right to share |
| Modification/derivation allowed | Page: 「二次著作物を自由に作成可能です」 |
| Share-alike obligations | None in the CC BY 4.0 license text |
| Observation date available | dataset-level (時点 date in the page label and file name); none per record |
| Reviewed by / date | Claude Code (AI-assisted research), 2026-09-20; terms and display example re-verified against the official pages 2026-09-20 (Issue #22). Approved by the maintainer's merge of the Issue #22 PR |
| Publication status | approved |

### 台東区 公衆喫煙所ウェブマップ・一覧 — **not a registered source** (conflict reference only)

台東区 publishes the same list a second time as an ordinary ward web page,
`https://www.city.taito.lg.jp/kenchiku/machibika/kosyu/webmap.html` (更新日 2026年9月4日, labelled
令和8年8月18日現在). It is **not** registered above and never will be under these terms.

| Field | Value |
|---|---|
| License name | **no reviewed reuse permission found**. The page sits outside the ward's open-data catalog, carries no CC BY notice and no link to a license; its footer states only `©台東区` |
| Redistribution to clients allowed | unreviewed |
| Modification/derivation allowed | unreviewed |
| Checked | 2026-09-21 (Issue #42), against the live page |
| Publication status | **not a source**: no value from this page is stored as canonical data or served to a client |

This repository draws no conclusion about what this page's terms permit; that review has not been
done. Under the rule above ("a source with any `unreviewed` license field is not published") and
`docs/DATA_POLICY.md`, MannerPath therefore does not redistribute content from this page.

How it is used instead (ADR-0006, 2026-09 Issue #42 amendment): the page is a reviewed **conflict
reference**. Where it contradicts or qualifies the CC BY release we import, that contradiction is
recorded as a dated attestation in `services/api/src/pipeline/taito-list-page.ts`, bound to one
exact release fingerprint, and its only permitted effect is **subtractive** — downgrade hours to
`unparsed`, mark a spot `temporarilyClosed`, or withhold a spot from publication. It can never add,
raise or correct a canonical value, and the page's own wording, times and coordinates are neither
stored nor published. Each applied weakening is recorded in `spot_field_attenuations` with the
attestation version, the reference, the check date and the reviewed release fingerprint.

Registry mechanics (ADR-0006, 2026-09 Issue #22 amendment): this entry is mirrored in code as a
reviewed registry constant (`services/api/src/pipeline/registry.ts`). A fresh or local database gets
the row with this status and attribution; a database that still holds the older `blocked` row is
upgraded deliberately with `npm run local:registry`. A source that is not in that list can be
neither registered nor approved by importer code — approval stays a repository change reviewed in a
PR, and the publish step plus the D1 publication trigger still gate on `sources.publication_status`.

### 大阪市指定喫煙所（マップナビおおさか）

Reviewed directly against the publisher's dataset page, its actual CC-BY image link and the
linked legal code on 2026-09-28. Neither search snippets nor third-party catalog metadata approve
this source. Raw fixture and detailed mapping: `services/data-pipeline/fixtures/osaka-designated-smoking-areas/PROVENANCE.md`.

| Field | Value |
|---|---|
| Source ID | `osaka-designated-smoking-areas` |
| Name / publisher | 大阪市指定喫煙所（マップナビおおさか） / 大阪市、計画調整局 企画振興部 統計調査担当 (dataset-page owner); smoking-location listing: 環境局 |
| Kind | municipal |
| Dataset URL | https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html — item 14, 施設情報ポイントデータ（環境・リサイクル） |
| Original-data URL | https://www.mapnavi.city.osaka.lg.jp/osakacity/osakacity/opendatafile/map_1/CSV/opendata_1012.csv |
| License name | CC BY 2.1 JP (表示 2.1 日本). The page says CC-BY; its license image links to `http://creativecommons.org/licenses/by/2.1/jp/`. This source-specific link controls; do not substitute the general site's CC BY 4.0-compatible terms |
| License URL / original terms | https://creativecommons.org/licenses/by/2.1/jp/ ; https://creativecommons.org/licenses/by/2.1/jp/legalcode |
| Redistribution to clients allowed | Yes, legal code §3(1), §3(3), §3 final paragraph: reproduction, distribution and public transmission in present/future formats, subject to §5 |
| Modification/derivation allowed | Yes, §3(2); extraction and normalization disclosed in attribution. No implication that Osaka City authored or endorses the derived output |
| Share-alike obligations | No share-alike requirement. §4 directly licenses source content to recipients; §5(3), (6), (7) retain the source's rights and forbid conflicting restrictions/technical protection. This does not relicense the entire combined database |
| Required attribution text | §5(2), (5), (8): license URI, notices, original author, supplied title and source URI, and credit for use in derivatives. Publisher disclaimer is retained verbatim. **Approved wording**: `出典：大阪市「マップナビおおさか 施設情報ポイントデータ（環境・リサイクル）」 https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html 元データ https://www.mapnavi.city.osaka.lg.jp/osakacity/osakacity/opendatafile/map_1/CSV/opendata_1012.csv CC BY 2.1 JP https://creativecommons.org/licenses/by/2.1/jp/ 本ページに掲載しているデータの使用で生じた結果等については、大阪市は一切の責任を負いません。MannerPathが大阪市指定喫煙所を抽出・正規化して作成。` |
| Geographic scope | Osaka City; only rows whose category is 環境・リサイクル and both 分類 columns equal 大阪市指定喫煙所. Partial coverage, not an exhaustive claim |
| Update date/frequency | Dataset-page update 2026-03-31; CSV category first listed 2014-01-17, updated 随時. The publisher says CSVs regenerate the day after Mapnavi information changes. Retrieved file HTTP Last-Modified: 2026-09-26 14:06:05 GMT; none of these dates establishes observation time |
| Observation date available | none. `observedOn` and published `lastVerifiedAt` are NULL; fetch and HTTP metadata remain separate |
| Coordinate availability | CSV 経度/緯度, decimal degree JGD2011, map-icon positions (publisher's note for items 1–30). Used directly at map-display accuracy; not a surveyed entrance or geocoded host coordinate |
| Automation suitability | Machine-readable UTF-8 CSV, no login, stable official download URL, automatic upstream regeneration. Suitable for deterministic ingest. Publication is restricted to the reviewed SHA/URL/NULL date and 344 selected records; no scheduled refresh and no cross-release matching enabled |
| Reviewed release | SHA-256 `f58b62791396bc46ceca436a7c4ad598520a5c9dd4162b37723ef519399e69ce`, 242493 bytes; 524 raw rows → 344 designated-smoking observations/spots. Other 126 information-provided smoking venues and 54 recycling businesses remain raw only |
| Reviewed by / date | Codex, AI-assisted primary-source review, 2026-09-28, under the maintainer's second-source implementation instruction. Repository approval is reviewable in this branch; no remote database or deployment is changed |
| Publication status | approved for the pinned first release and selected scope; changed content requires another review |

The City's separate [smoking-location page](https://www.city.osaka.lg.jp/kankyo/page/0000607135.html)
(2026-09-08) distinguishes designated locations from information-provided venues and explains that
designated locations are free and usable without patronizing the host. It supports the scope
review; no values or schedules are copied from that page. Its map infrastructure and linked
third-party business URLs are not ingested. The raw CC BY CSV is the sole value source.

### 江東区 公共喫煙所一覧（駅前）

Reviewed 2026-09-29 after the [23-ward survey](research/2026-09-29-tokyo-n1-source-survey.md).
Raw evidence and detailed mapping: `services/data-pipeline/fixtures/koto-station-smoking-areas/PROVENANCE.md`.

| Field | Value |
|---|---|
| Source ID | `koto-station-smoking-areas` |
| Name / publisher | 公共喫煙所一覧（駅前） / 江東区、環境保全課 |
| Kind | municipal |
| Official source URL | https://www.city.koto.lg.jp/380301/machizukuri/sekatsu/undo/45122.html — ordinary current-operation reference only; no values imported from it |
| Dataset URL | https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000061 |
| Raw data URL | https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv |
| License name / applicability | CC BY 4.0. The ward's https://www.city.koto.lg.jp/012107/koto_opendata.html explicitly publishes via Tokyo catalog and requires its terms. The publisher's scoped package API https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t131083d0000000061 declares CC-BY-4.0 and binds this exact resource. Catalog HTML returned 403, so original publisher API evidence is retained. This does not extend a license to ordinary ward HTML |
| License URL / original terms | https://creativecommons.org/licenses/by/4.0/legalcode.ja ; https://portal.data.metro.tokyo.lg.jp/terms/ §2 |
| Redistribution to clients allowed | Yes, Tokyo terms §2 and CC BY 4.0 §2(a)(1)(A), subject to attribution and notices |
| Modification/derivation allowed | Yes, Tokyo terms §2(1)(イ), CC BY 4.0 §2(a)(1)(B); disclose changes and do not imply government authorship/endorsement |
| Share-alike obligations | None; retain source rights and do not impose conflicting downstream restrictions (CC BY §2(a)(5), §3) |
| Required attribution text | Tokyo's modified-work example plus source/license URI and change disclosure: `このデータベースは、以下の著作物を改変して利用しています。公共喫煙所一覧（駅前）、東京都・江東区、クリエイティブ・コモンズ・ライセンス 表示4.0国際 https://creativecommons.org/licenses/by/4.0/ 元データ https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv MannerPathが抽出・正規化して作成。コンテンツ提供者は内容を保証せず、利用により生じた損害について責任を負いません。利用規約 https://portal.data.metro.tokyo.lg.jp/terms/` |
| Geographic scope / completeness | 江東区の駅前公衆喫煙所3地点のみ。Partial, not all ward smoking places; excludes park resource, designated private locations and cooperation venues |
| Update cadence | Official package 更新頻度: 随時; no SLA. Resource metadata date 2025-03-17 JST, HTTP Last-Modified 2026-01-15. These are not observation dates |
| Observation date available | none; `observedOn` and `lastVerifiedAt` NULL. Fetch/check date never substitutes |
| Coordinate semantics | Explicit 緯度/経度 decimal site points paired with smoking names, not inferred host/business locations. Datum, accuracy and entrance positioning **unstated** in publisher CSV/catalog/spec. Supplied values used directly under the existing WGS84-compatible display-lat/lon convention; compatibility is an implementation assumption, not verified publisher CRS or entrance precision. No geocoding |
| Automation suitability | Stable named official CSV URL, unauthenticated GET succeeds, 314 bytes CP932/Shift_JIS. Exact header decoder/parser and pinned first-release gate. No `refreshTarget`; automatic checks and repeated-release behavior require further review |
| Current operation | 2026-02-04 ordinary official page identifies all three CSV sites; no station conflict found in 2026-09-29 review. No ordinary-page wording, hours or coordinates enter canonical data |
| Reviewed release | SHA-256 `e36e81d58348db6607a374f18a77ae54801eb55b810fba2849cf49c14318126d`, 314 bytes; 3 raw rows → 3 observations → 3 published spots |
| Reviewed by / date | Codex, AI-assisted primary-source review, 2026-09-29; repository approval reviewable on this branch, local DB only |
| Publication status | approved only for pinned station first release; `crossReleaseValidated=false`, `completeness=partial` |

### 京都市 公設喫煙場所（施設情報一覧）

Reviewed 2026-09-30 in the [N2 west/central survey](research/2026-09-30-n2-west-central-municipal-survey.md).
Raw evidence and detailed mapping: `services/data-pipeline/fixtures/kyoto-public-smoking-places/PROVENANCE.md`.

| Field | Value |
|---|---|
| Source ID | `kyoto-public-smoking-places` |
| Name / publisher | 京都市等の施設に関する情報（一覧表） / 京都市 (著作権者); rows maintained by 文化市民局くらし安全推進課 |
| Kind | municipal |
| Official source URL | https://www.city.kyoto.lg.jp/bunshi/page/0000027498.html: current-operation cross-check only ("All rights reserved"); no values imported |
| Dataset URL | https://data.city.kyoto.lg.jp/dataset/00003/ |
| Raw data URL | https://data.city.kyoto.lg.jp/resource/?id=21432, a POST form download of `20260903182354_data（令和8年9月3日現在）.csv`; no GET file URL exists |
| License name / applicability | CC BY 4.0, shown on the dataset and on this exact resource (著作権者 京都市); 京都市オープンデータ利用規約（第３版）§1 applies the per-dataset license |
| License URL / original terms | https://creativecommons.org/licenses/by/4.0/legalcode.ja ; https://data.city.kyoto.lg.jp/contents.php?category=0 |
| Redistribution to clients allowed | Yes, CC BY 4.0 §2(a)(1)(A), with attribution |
| Modification/derivation allowed | Yes, CC BY 4.0 §2(a)(1)(B); changes are indicated |
| Share-alike obligations | None |
| Required attribution text | `出典：京都市オープンデータ「京都市等の施設に関する情報（一覧表）」施設情報一覧（令和８年９月３日現在） https://data.city.kyoto.lg.jp/dataset/00003/ 著作権者 京都市 クリエイティブ・コモンズ・ライセンス 表示4.0国際 https://creativecommons.org/licenses/by/4.0/legalcode.ja MannerPathが喫煙場所カテゴリを抽出・正規化して作成。京都市は本データの利用により生じた結果について責任を負いません。` (the portal asks derived works to credit 『京都市オープンデータ』) |
| Geographic scope / completeness | City-run 公設喫煙場所 in 京都市 (category 138). Partial: 17 of 19 category rows; the two 西大路 rows conflict with the official page and are withheld |
| Update cadence | Irregular; the portal has republished the file about quarterly (2025-11-14, 2025-12-22, 2026-01-09, 2026-03-10, 2026-06-18, 2026-09-03). No SLA |
| Observation date available | Yes, dataset-level: the resource is titled 令和８年９月３日現在 → `observedOn = 2026-09-03`. Fetch and upload times are not used |
| Coordinate semantics | Explicit 緯度/経度 decimal points of each named place, identical to the city's own map links for the same IDs. Datum, accuracy, entrance position and derivation method are **unstated**; used under the existing display-lat/lon convention without geocoding |
| Automation suitability | Deterministic bytes, exact header, 53 columns, UTF-8 with BOM. Download is a POST form per resource ID; each release has a new resource ID, so no `refreshTarget` |
| Current operation | The 2025-08-14 official page links 17 selected IDs at identical coordinates. Conflicts: ID 1781 is shown there as 北側改札口前（2階） at the old point (CSV: 南側, moved about 50 m) and ID 2132 is absent, so both are excluded |
| Reviewed release | SHA-256 `bd37bbcbc413751f8ae5e3e5c88b397a452f953aad1b330c326cbaba137715cc`, 843,922 bytes; 1,777 raw rows → 17 observations → 17 published spots |
| Reviewed by / date | Claude Code, AI-assisted primary-source review, 2026-09-30; local DB only |
| Publication status | approved only for the pinned first release; `crossReleaseValidated=false`, `completeness=partial` |

### 江東区 公共喫煙所一覧（公園） — blocked candidate

Same package's raw https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_park.csv
has clear CC BY 4.0 applicability but a current-operation conflict: the
[official park prohibition](https://www.city.koto.lg.jp/470601/machizukuri/kasenkoen/sebi/jidouyuenkinen.html)
states all ward parks became smoke-free on 2022-01-01. No applicable exception was established.
Publication status: **blocked**; no adapter, ingest or canonical values. Do not equate a later
catalog timestamp with current smoking permission. Remaining surveyed candidates with unresolved
license/raw coordinates are also blocked, with per-ward reasons in the survey linked above.

### 武蔵野市 公衆喫煙所（地域生活環境指標）

Approved pinned first release, Codex primary-source review 2026-09-30, Issue #113.
The complete approval gate, exact resource-level license applicability, retrieval hashes,
current-operation check and field semantics are in
[PROVENANCE.md](../services/data-pipeline/fixtures/musashino-public-smoking-areas/PROVENANCE.md).

| Field | Value |
|---|---|
| Source ID / publisher | `musashino-public-smoking-areas` / 武蔵野市 |
| Dataset | [4(2)トイレおよび路上禁煙エリア・公衆喫煙所 令和4年版地域生活環境指標](https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html) |
| Raw resource | https://www.city.musashino.lg.jp/_res/common/opendata_kikaku/toilet.zip ; exact KML/KMZ member, not projected CSV |
| License | Exact item explicitly CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; sharing/adaptation allowed with attribution/change notices, no share-alike |
| Attribution | `出典：武蔵野市「4(2)トイレおよび路上禁煙エリア・公衆喫煙所 令和4年版地域生活環境指標」 https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html 元データ https://www.city.musashino.lg.jp/_res/common/opendata_kikaku/toilet.zip CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ MannerPathが公衆喫煙所のKML Pointを抽出・正規化して作成。武蔵野市による推奨・保証を意味しません。` |
| Reviewed hash / count | KML SHA-256 `fc6986b986ec315691299a12583f14a8fd942e34075fd1e9e44837dc72c57a7c`; 25 raw Placemarks → 3 exact public-smoking Points → 3 published spots |
| Scope | 吉祥寺・三鷹・武蔵境 station sites; `partial`. Toilets and prohibited-area polygons excluded. Newer fourth official site lacks coordinates in this fixture and is excluded |
| Coordinate semantics | Publisher-supplied WGS1984 KML smoking-site Points; positional/entrance accuracy unstated; no geocoding |
| Dates / cadence | Exact observation date unstated: `observedOn`/`lastVerifiedAt` NULL. Annual edition, no update SLA. Fetch/HTTP/page dates retained separately |
| Publication / refresh | First reviewed SHA/URL/NULL date only; `crossReleaseValidated=false`; no refresh target |

No canonical attributes come from the ordinary current-operation page. Field uncertainty and
excluded categories are enforced in the dedicated pinned reader; existing SourceAdapter contracts
and schema remain unchanged.

### 港区 指定喫煙場所（施設情報）

Targeted [batch 2 review](research/2026-09-30-tokyo-n1-source-batch-2.md), Issue #109.
Immutable fixture, publisher metadata and exact mapping: `services/data-pipeline/fixtures/minato-designated-smoking-areas/PROVENANCE.md`.

| Field | Value |
|---|---|
| Source ID | `minato-designated-smoking-areas` |
| Name / publisher | 港区 指定喫煙場所（施設情報） / 港区; catalog author 企画経営部区長室 |
| Kind | municipal |
| Original dataset URL | https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo — 複合施設・男女平等参画施設・その他の施設 |
| Raw resource URL | https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv |
| License / exact applicability | CC BY 4.0, permitted by original same-host catalog terms https://opendata.city.minato.tokyo.jp/about . Exact resource is hosted catalog content, not an external-site link. https://opendata.city.minato.tokyo.jp/pages/exhibit excludes only ちぃばすGTFS and 赤ちゃんの駅; not this resource. Ordinary website/map content is not approved as a value source |
| License URL / original terms | https://creativecommons.org/licenses/by/4.0/ ; https://creativecommons.org/licenses/by/4.0/legalcode.ja ; https://opendata.city.minato.tokyo.jp/about |
| Redistribution to clients allowed | Yes: catalog terms allow copying/public transmission/commercial use; CC BY §2(a)(1) |
| Modification/derivation allowed | Yes: catalog terms allow adaptation; credit source/use date and disclose extraction/normalization, no false publisher authorship; CC BY §2/§3 |
| Share-alike obligations | None; preserve attribution/notices and avoid conflicting downstream restrictions |
| Required attribution text | `出典：港区オープンデータカタログサイト「複合施設・男女平等参画施設・その他の施設」 https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo 元データ https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv （2026年9月30日に利用） CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ MannerPathが指定喫煙場所を抽出・正規化して作成。` |
| Geographic scope / completeness | Partial 港区 designated smoking points: exact classification `009013004000`, `第2分類=指定喫煙場所`, publisher smoking-facility URL; exclude 109.html. 169 raw records, 115 smoking-classified, 114 published; 54 other facilities and one uncertain point raw-only. Not a claim of all 116 current aggregate sites |
| Current operation evidence | https://www.city.minato.tokyo.jp/kankyouseisaku/shiteikitsuenbasyo.html (updated 2026-07-10, list as of 2026-06-01) and 115 publisher smoking facility pages reviewed 2026-09-30. Included names correspond to current aggregate; 109 omitted there, closure unknown, excluded conservatively. No HTML value import |
| Coordinates | Explicit decimal 緯度/経度 for smoking locations, corroborated by publisher GeoJSON Point features. CRS/accuracy/entrance semantics undeclared; supplied display points only. No geocoding/map-vendor supplementation. Co-located floors preserve separate publisher identities |
| Observation date | none; `observedOn` and `lastVerifiedAt` NULL. 最終更新日 is page modification, not observation |
| Update frequency | Unspecified; official catalog describes automatic CSV conversion but no guaranteed interval/SLA. Resource modified 2026-07-16, export trailer Ver20260714, not observation time |
| Stable automated fetch | Unauthenticated GET, stable named official raw URL; immutable pinned release only, no `refreshTarget` |
| Reviewed release / policy | SHA-256 `d11ad6a5c2c72bba114d58bc7cce9f84f54338c75ee37cdd275b7680c6314220`, 96,869 bytes, exact URL/NULL date/114 observations; `crossReleaseValidated=false`, `completeness=partial`. Any changed content needs another review |
| Uncertain fields | Hours retained unparsed where supplied; no openNow inference. Tobacco support, physical type, access, fee, host and other unsupported fields unknown; address raw-only |
| Reviewed by / date | Codex, AI-assisted primary-source review, 2026-09-30, Issue #109; repository approval reviewable in this branch |
| Publication status | approved for pinned first release and exact scoped extraction only |

### 鹿児島市 路上禁煙区マナー灰皿 — blocked candidate

Surveyed 2026-09-30 in the [N2 west/central survey](research/2026-09-30-n2-west-central-municipal-survey.md).
The raw CSV https://data.bodik.jp/dataset/e7b3a67c-b67d-41ad-9808-6f9a11696c85/resource/947f79ad-91c7-4b4d-bace-744eac2b726f/download/3-15_haizara.csv
(4 rows) has clear CC BY 4.0 applicability through the city's BODIK catalog terms and explicit
経度/緯度, but conflicts with current official evidence. The city states that the 路上禁煙地区
prohibits all smoking, including portable-ashtray use, with no exception for these ashtrays. Three
of the four points fall inside the publisher's own zone polygons. An ashtray's existence does not
establish smoking permission. Publication status: **blocked**, with no adapter, ingest or canonical
values, until the publisher states what the ashtrays are for.
