# 京都市 公設喫煙場所（施設情報一覧） — reviewed first release

Retrieved unauthenticated from KYOTO OPEN DATA on 2026-09-29 (UTC). The portal serves the file only
through a POST form on the resource page https://data.city.kyoto.lg.jp/resource/?id=21432
(`upload_file=20260903182354_data（令和8年9月3日現在）.csv`); there is no GET file URL. Original bytes
are `20260903_shisetsu.csv` (843,922 bytes, UTF-8 with BOM, CRLF, no transcoding), SHA-256
`bd37bbcbc413751f8ae5e3e5c88b397a452f953aad1b330c326cbaba137715cc`. `fetch.json` keeps the retrieval
metadata; the response carried no Last-Modified header. No cookies or credentials are retained.

## Primary-source review (2026-09-30)

- Dataset: [京都市等の施設に関する情報（一覧表）](https://data.city.kyoto.lg.jp/dataset/00003/), dataset
  ID 00003, 著作権者 京都市, license **CC-BY 4.0（表示）**, last updated 2026-09-03. Its description lists
  「喫煙場所」 among the facility categories. The resource page for this file (ID 21432) repeats
  著作権者 京都市 and CC-BY 4.0.
- [京都市オープンデータ利用規約（第３版）](https://data.city.kyoto.lg.jp/contents.php?category=0) §1:
  the city licenses each dataset under the license shown on it. Users publishing a derived work are
  asked to state that they used 『京都市オープンデータ』.
- [CC BY 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode.ja) §2(a)(1) permits
  redistribution and adaptation, including commercial use. §3 requires credit, the license URI and an
  indication of changes. There is no share-alike obligation.
- Attribution (`KYOTO_ATTRIBUTION_TEXT`) names 京都市オープンデータ, the dataset and resource titles,
  the dataset URL, the copyright holder, the license, the change notice and a disclaimer.
- Current operation: the city's [公設喫煙場所 page](https://www.city.kyoto.lg.jp/bunshi/page/0000027498.html)
  (updated 2025-08-14) links each place to the city map as `map.city.kyoto.lg.jp/?lat=…&lng=…&id=<ID番号>`.
  17 of the 19 category-138 rows appear there by the same ID, at coordinates identical to the CSV.
  The page is used for this cross-check only; it is "All rights reserved" and contributes no values.

## Mapping and scope

| Column | Mapping |
|---|---|
| カテゴリ(cate_id) = `138` | The city's own 喫煙場所 category: existence and lifecycle evidence. Every selected row must also be named `…喫煙場所`, maintained by くらし安全推進課 and link to the smoking page, or the parse fails. |
| ID番号（id) | Verbatim publisher ID, kept as `upstream_row_ref`. The smoking page uses the same ID. |
| 公共施設の名称(name) | Verbatim name. |
| 緯度(lat) / 経度(lng) | Supplied decimal coordinates, used directly without geocoding. The publisher does not state datum, accuracy, entrance positioning or how the points were derived. The city's own map uses Google Maps as its base layer; the CSV coordinates are the city's published values under CC BY, not values taken from Google. |
| 開館時間 / 休館日 / 利用料 | Empty for every selected row. A non-empty value fails the parse until a new mapping is reviewed. |

All 1,777 raw rows are kept as immutable evidence. 19 rows carry category 138, and **17** become
observations, entities and published spots. Two are excluded because they conflict with the current
official page:

- `1000001781` ＪＲ西大路駅南側喫煙場所: the page shows this ID captioned 北側改札口前（2階）, at the older
  coordinate about 50 m from the CSV value.
- `1000002132` ＪＲ西大路駅北側喫煙場所: absent from the page.

Tobacco support, hours, access, fee, indoor/outdoor, host and entrance stay unknown.

`observedOn = 2026-09-03`: the publisher titles the resource 施設情報一覧（令和８年９月３日現在）, a
dataset-level as-of date, following the same convention as Taito's dated file. The fetch time and
the portal upload time are not used as observation dates.

The first release is pinned to hash, URL, observation date and 17 observations.
`crossReleaseValidated = false`, `completeness = partial` (the list is the city-run places only, and
西大路 is withheld), and there is no `refreshTarget`: the POST-only download is not an established
automated retrieval.
