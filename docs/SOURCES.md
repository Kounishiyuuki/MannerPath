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
| License name | ODbL (obligations for MannerPath's combined dataset: unreviewed) |
| Redistribution to clients allowed | unreviewed |
| Share-alike obligations | unreviewed |
| Publication status | blocked |

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
