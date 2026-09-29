# N2 west/central municipal bulk survey, batch 1 (2026-09-30)

Primary-source survey for N2 (ordinance-designated cities + prefectural capitals), western Japan to
Chubu. The first pass searched only for smoking-specific datasets and found none that passes the gate.
The second pass (below) looked for a smoking category inside general facility datasets and found one:
**京都市 (class B, approved, 17 spots)**. A failure to discover a licensed dataset is a survey finding,
not proof none exists.

Classification: **A** machine-readable smoking dataset · **B** official facility dataset with an
extractable smoking category · **C** license blocker · **D** coordinate blocker · **E** no usable
source found.

## Catalog sweep

Most target cities publish open data on BODIK ODCS (data.bodik.jp) or their own CKAN, which the
cross-catalog index `https://search.ckan.jp/backend/api/package_search` aggregates. Phrase queries
(2026-09-30) `"喫煙所"`, `"喫煙場所"`, `"灰皿"`, `"喫煙"`, `"禁煙"`, `"分煙"`, `"たばこ"`, filtered by
title, return only these point-location candidates nationwide: 江東区 公共喫煙所一覧 (reviewed),
台東区 公衆喫煙所（区設置分） (reviewed) and 鹿児島市 路上禁煙区マナー灰皿 (below). Everything else is
statistics, prohibition zones (府中, 市川, 杉並, 横須賀, 鹿児島 polygons/lines), non-smoking
restaurant lists or health surveys. Direct CKAN API queries on data.bodik.jp (喫煙/喫煙所/灰皿/禁煙/
たばこ), catalog.city.kobe.lg.jp (喫煙/灰皿: 0) and catalog-data.city.kanazawa.ishikawa.jp (喫煙/禁煙: 0)
agree. Kyoto (data.city.kyoto.lg.jp) and Hamamatsu (odpf) portals are not CKAN and render search
client-side; a site-restricted web search found no smoking dataset on either.

## Per-municipality result

| City | Official evidence | Class | Blocker |
|---|---|---|---|
| 京都市 | https://www.city.kyoto.lg.jp/bunshi/page/0000027498.html (2025-08-14) ; https://data.city.kyoto.lg.jp/dataset/00003/ | ~~C~~ → **B, approved** | First pass: the smoking page is all rights reserved. Second pass: the city's CC BY 4.0 facility list has category 138 = 喫煙場所. 17 of 19 rows are approved; see `docs/SOURCES.md`. |
| 神戸市 | https://www.city.kobe.lg.jp/a84526/kurashi/activate/project/eco/outsmoking.html (2026-04-13) | E | Enforcement page and PDFs only; no location list or coordinates; Kobe CKAN has no smoking dataset. |
| 名古屋市 | https://www.city.nagoya.jp/bousai/anzen/1034530/1014489/1014490/1014491.html (2026-04-23) | C/D | 3 喫煙所 as text, no coordinates, "All rights reserved". Nagoya's BODIK organization has no smoking dataset. |
| 広島市 | https://www.city.hiroshima.lg.jp/living/gomi-kankyo/1021281/1037470/1024206.html (2025-02-16) | D | 6 park smoking booths by address only; do not geocode. |
| 福岡市 | https://www.city.fukuoka.lg.jp/shimin/jigyochosei/shisei/rojoukinnenntiku_2.html (2024-07-26) | E | Zone PDFs only; no smoking-place list or dataset. |
| 静岡市 | https://www.city.shizuoka.lg.jp/s9623/s000042.html ; https://data.bodik.jp/dataset/221007_1590018309 | D | 3 公衆喫煙所 named in HTML; CC BY usage-survey CSV has names and counts but no coordinates. Do not geocode. |
| 岡山市 | https://www.city.okayama.jp/kurashi/0000005170.html | D | States 2 permitted places near 岡山駅 without list/coordinates. |
| 熊本市 | https://www.city.kumamoto.jp/list04205.html | E | 分煙施設 map category page; no dataset or coordinates found. |
| 北九州市 | (web search; no official smoking-location page located) | E | Nothing located on BODIK/official site in the time box. |
| 浜松市 | https://www.city.hamamatsu.shizuoka.jp/zaisek/budget/budget07/detail/d_102.html | E | Budget item for outdoor smoking places only; no dataset found. |
| 金沢市 | Kanazawa CKAN API (0 hits) | E | No official location dataset located. |
| 大津市 | BODIK (Otsu publishes there; 0 hits) | E | None located. |
| 鹿児島市 (capital, outside the priority list) | https://data.bodik.jp/dataset/462012_haizara | A → **blocked** | Current-operation conflict; see below. |
| 草津市 (not N2) | https://data.bodik.jp/dataset/252069_00003 | E | XLSX is マナースペース usage counts only; no coordinates. |

## 鹿児島市 路上禁煙区マナー灰皿 — blocked

- Publisher 鹿児島市 (maintainer 環境衛生課). The city's https://www.city.kagoshima.lg.jp/ict/opendata.html
  (2025-12-12) names the ISIT-operated BODIK catalog as its publishing site; its terms
  https://odcs.bodik.jp/462012/tos/ §1 license catalog content under CC BY 4.0. Package license
  `cc-by-40-intl`, frequency 不定期.
- Raw https://data.bodik.jp/dataset/e7b3a67c-b67d-41ad-9808-6f9a11696c85/resource/947f79ad-91c7-4b4d-bace-744eac2b726f/download/3-15_haizara.csv
  — 205 bytes CP932, SHA-256 `0348cef2957a8ae6c97bd84d286f3448216f659ae77c827e007ba34d69eb4541`,
  header `名称,分類,経度,緯度`, 4 rows all `マナー灰皿`. License and coordinates are clear.
- **Conflict.** The dataset describes ashtrays *in* the 路上禁煙地区. The city's FAQ
  https://www.city.kagoshima.lg.jp/faq-kankyomachizukuri/eisei/q8.html (2023-11-16) and ordinance page
  https://www.city.kagoshima.lg.jp/kankyo/kankyo/eisei/machizukuri/ese/machiwokireni/jore.html
  (2025-02-14) state that all smoking, including standing smoking and portable-ashtray use, is
  prohibited in the zone, with no exception for these ashtrays. Testing the four points against the
  same publisher's zone polygons (https://www.geospatial.jp/ckan/dataset/46201-016, SHP in JGD2000,
  zip SHA-256 `c9a7628ef8253380454e995956591c2387ab66ddb566c823e39dd9d9d05edd95`): 3 of 4 lie inside a
  zone polygon, all 4 within 0.6–2.0 m of an edge, which suggests extinguishing points at arcade
  entrances. Official evidence does not establish that smoking is permitted at any of them.
  Publication status: **blocked** until the publisher states the ashtrays' purpose.

## Next value

The N2 bottleneck is licensing, not discovery: western/central cities publish smoking places as
ordinary HTML (Kyoto 17, Hiroshima 6, Nagoya 3, Shizuoka 3) with no open-data resource. The most
valuable next step is a publisher request rather than more scanning:

1. 京都市: 17 places with coordinates already maintained, so ask for a CC BY resource on KYOTO OPEN DATA.
2. 広島市 / 名古屋市 / 静岡市: small, stable official lists; ask for a CSV with publisher coordinates.
3. 鹿児島市: ask the city whether the マナー灰皿 are smoking points or extinguishing points only.
4. East Japan N2 cities (Sapporo, Sendai, Yokohama, Kawasaki, Chiba, Saitama, Sagamihara, Niigata)
   were not in this batch's scope.

No spot count is claimed for blocked sources, and no coordinates were taken from Google, MapKit,
OSM or embedded web maps.
