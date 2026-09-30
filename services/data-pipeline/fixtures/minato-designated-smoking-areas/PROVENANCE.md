# 港区 指定喫煙場所（施設情報） — reviewed first release

Codex review, 2026-09-30, Issue #109 (child #67). Full discovery and blocked-source evidence:
[batch 2](../../../../docs/research/2026-09-30-tokyo-n1-source-batch-2.md).

## Publisher, resource and original terms

- Publisher 港区; catalog author 企画経営部区長室. [Dataset](https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo), original title 複合施設・男女平等参画施設・その他の施設.
- [Original raw CSV](https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv); immutable `minatokushisetsujoho_fukugo.csv`, 96,869 bytes UTF-8, SHA-256 `d11ad6a5c2c72bba114d58bc7cce9f84f54338c75ee37cdd275b7680c6314220`. `fetch.json` records actual retrieval/HTTP metadata, never observations.
- `catalog.json` records publisher package/resource metadata from its [package API](https://opendata.city.minato.tokyo.jp/api/3/action/package_show?id=minatokushisetsujoho_fukugo).
- [Catalog terms](https://opendata.city.minato.tokyo.jp/about) explicitly cover same-host published content and permit redistribution/public transmission, adaptation and commercial use. They permit CC BY 4.0 use; this establishes the license version beyond the catalog's generic `cc-by` metadata. [Exception annex](https://opendata.city.minato.tokyo.jp/pages/exhibit) lists only ちぃばすGTFS / 赤ちゃんの駅; this resource is not excluded. Separate-site linked content/third-party rights are not automatically licensed.
- [CC BY 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode.ja) §2 grants sharing/adaptation; §3 requires attribution/license URI/modification disclosure. No share-alike. Retain notices and do not imply publisher endorsement.
- Attribution uses publisher/dataset URL/use date plus extraction/normalization notice. Exact `MINATO_ATTRIBUTION_TEXT` is mirrored in `docs/SOURCES.md`. Images, image captions, linked map content and business promotion are not published as fields; raw source bytes are retained without alteration.

## Exact scope and mapping

169 raw facility records remain immutable. The terminal blank line and exact publisher trailer
`港区施設情報 複合施設・男女平等参画施設・その他の施設,Ver20260714` are validated separately
from the 31-column records. Blank separators/trailer are not invented facility observations.

Only exact `分類=009013004000`, `第2分類=指定喫煙場所`, and publisher smoking facility URL
`https://www.city.minato.tokyo.jp/shisetsu/sonota/kitsuen/<number>.html` qualify, excluding
`109.html`. 115 classified smoking rows → **114 observations**, 55 records raw-only (54 other
facilities plus the omitted smoking point). Coverage is partial for 港区, not a complete claim
about its 116 ordinary-list locations. Ordinary facilities/bridges/housing are not smoking evidence.
Convenience-store results require this exact independent publisher smoking classification.

| Field | Mapping / uncertainty |
|---|---|
| ページタイトル | Verbatim name; smoking classification and dedicated URL provide existence evidence. |
| 緯度 / 経度 | Publisher decimal latitude/longitude, direct smoking-point display location. [GeoJSON sibling](https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/305a0d9f-38bd-41cc-9ca6-fdda6dd3662a/download/minatokushisetsujoho_fukugo.json) has corresponding Point longitude/latitude/zero values. Datum/precision/entrance semantics undeclared; WGS84-compatible display is an implementation assumption, not a surveyed-entrance claim. |
| ファイルパス | Publisher upstream row reference; no cross-release validation or cross-source merge. |
| 所在地 | Raw only; no geocoding, host-coordinate substitution or correction from ordinary HTML. |
| 開館時間 / 施設の概要 | Explicit hours retained unparsed when supplied in the reviewed mapping; no schedules/openNow inferred. Other descriptive fields stay raw only. |
| 最終更新日 | Page modification, never smoking observation. `observedOn=null`, published `lastVerifiedAt=null`. |

Multiple floors sharing coordinates remain separate publisher smoking locations (114 URL refs,
107 distinct coordinate pairs). No claim of separate surveyed entrances. Indoor/outdoor, access,
fees, host, tobacco support and other unsupported attributes stay unknown.

## Current operation and conservative exclusion

[Current aggregate](https://www.city.minato.tokyo.jp/kankyouseisaku/shiteikitsuenbasyo.html)
(updated 2026-07-10, 116 as of 2026-06-01) supports 114 included locations: 111 normalized-name
matches and three identifiable typography/name variants (71/81/86). Every one of the 115
publisher facility pages returned 200 with its explicit smoking title and no closure/relocation
notice in the inspected body on 2026-09-30. `operation-checks.json` retains URLs, retrieval times,
status/hash and check results, not redistributed ordinary-page content.

`109.html` (エコロパーク芝大門第3駐車場内指定喫煙場所) remains listed in raw and its individual
page, but is absent from current aggregate. Exclude conservatively; closure unknown. Aggregate-only
locations have no reviewed CSV coordinates and are not added. No HTML values/schedules override CSV.

## Release policy

Stable unauthenticated named raw GET succeeds. Publisher describes automatic facility CSV conversion,
but update frequency/SLA and observation semantics are unspecified. HTTP/resource modification and
trailer dates remain fetch metadata. Exact SHA/URL/NULL observed date/114-count pins resolution.
`crossReleaseValidated=false`, `completeness=partial`, no `refreshTarget`; changed bytes require
another repository review. No migration, remote D1, PR #108 dependency or automatic publication.
