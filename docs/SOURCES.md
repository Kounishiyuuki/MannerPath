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
| License name | **none found**. The page sits outside the ward's open-data catalog, carries no CC BY notice and no link to a license; its footer states only `©台東区` |
| Redistribution to clients allowed | unreviewed — assume no |
| Modification/derivation allowed | unreviewed — assume no |
| Checked | 2026-09-21 (Issue #42), against the live page |
| Publication status | **not a source**: no value from this page is ever stored as canonical data or served to a client |

How it is used instead (ADR-0006, 2026-09 Issue #42 amendment): the page is a **conflict
reference**. Where it contradicts or qualifies the CC BY release we import, that contradiction is
recorded as a dated attestation in `services/api/src/pipeline/taito-list-page.ts`, and its only
permitted effect is **subtractive** — downgrade hours to `unparsed`, mark a spot
`temporarilyClosed`, or withhold a spot from publication. It can never add, raise or correct a
canonical value. Knowing that MannerPath must *not* assert something requires no redistribution
right; publishing the page's own wording or times would, and is not done.

Registry mechanics (ADR-0006, 2026-09 Issue #22 amendment): this entry is mirrored in code as a
reviewed registry constant (`services/api/src/pipeline/registry.ts`). A fresh or local database gets
the row with this status and attribution; a database that still holds the older `blocked` row is
upgraded deliberately with `npm run local:registry`. A source that is not in that list can be
neither registered nor approved by importer code — approval stays a repository change reviewed in a
PR, and the publish step plus the D1 publication trigger still gate on `sources.publication_status`.
