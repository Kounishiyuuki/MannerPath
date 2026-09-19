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
| Required attribution text | No verbatim text is prescribed. The page states 「オープンデータ一覧のデータをもとに作成したものに、台東区のデータを利用していることを表示してください。」 and CC BY 4.0 §3(a) applies. The in-app wording is not yet approved (see research doc §7) |
| Redistribution to clients allowed | Page: 「自由に利用・改変できます」. CC BY 4.0 §2(a)(1) grants the right to share |
| Modification/derivation allowed | Page: 「二次著作物を自由に作成可能です」 |
| Share-alike obligations | None in the CC BY 4.0 license text |
| Observation date available | dataset-level (時点 date in the page label and file name); none per record |
| Reviewed by / date | Claude Code (AI-assisted research), 2026-09-20. Pending maintainer confirmation |
| Publication status | blocked (pending maintainer confirmation of this entry and approval of the attribution wording) |
