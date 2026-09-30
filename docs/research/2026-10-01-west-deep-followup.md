# Nationwide deep follow-up — west / operator lane (2026-10-01)

Follow-up to the #132 discovery run ([run](nationwide-discovery/2026-09-30-run.json)).
Branch `data/nationwide-deep-followup-west-operator`, reviewer Claude. Local research only:
no source-policy change, no community change (#124 stays open, community stays blocked),
no remote D1 and no production deployment.

## Result

Condition A reached: **all 31 west groups among the 73 truncated (deeper-follow-up) groups
were deep-reviewed**, plus the 18 west operator targets that #132 only probed at their homepages.
**Approved: 0. Implemented: 0. New published spots: 0.** No publisher-supplied smoking Point
with reuse permission was found in the assigned lane. Three keyword candidates were checked
at the raw-row level and rejected; attestations are in
[2026-10-01-west-reviews.json](nationwide-discovery/2026-10-01-west-reviews.json).

## Lane split with the east/national batch

The 73 truncated groups were split by `targets[].prefecture` / `kind` in the #132 run file.

- **West (this batch, 31):** `pref-shizuoka`, the 17 岐阜県 `historical-c21xxxx` groups,
  `pref-shiga`, `pref-kyoto`, `pref-osaka`, `city-kobe`, `pref-wakayama`, `pref-tottori`,
  `pref-shimane`, `pref-okayama`, `pref-yamaguchi`, `pref-tokushima`, `pref-kagawa`,
  `pref-ehime`, `pref-kochi`.
- **East/national (Codex, 42):** 北海道, 東北, 関東 (including all Tokyo wards and `operator-haneda`),
  新潟, 福井, 山梨, 長野, and `national-mlit-indoor`.
- **West operators (non-truncated, 18):** JR西日本, JR東海, JR四国, JR九州, 近鉄, 南海, 京阪, 阪急,
  阪神, 西鉄, 京都市交通局, 大阪メトロ, 福岡市交通局, 関西エアポート, 福岡空港, 那覇空港,
  大阪ステーションシティ, and the already blocked 名鉄 / 名古屋市交通局 / 神戸市交通局 /
  中部国際空港 / 富士山静岡空港 / JR東海ビルディング (stops kept, not retried).

## Method and network safety

The #132 cache was reused read-only by URL hash; new fetches used one request per host,
a 1.5-second host delay, a 20-second timeout and one retry. A 403/429 stops that host.
The #132 host stops (`data.bodik.jp`, `catalog.data.metro.tokyo.lg.jp`, `www.city.kobe.lg.jp`,
`www.centrair.jp`) were inherited and not retried. One new stop: `www.kansai-airports.co.jp`
returned 403 on its site-policy page. No bypass, proxy or UA change was used.

Each search was paired with a control query (`施設`/`公共施設`) that returned results, so zero
smoking hits are real zeros for that index rather than a broken search. Content scans
matched 喫煙 / 灰皿 / 煙草 / smok in raw rows. `たばこ` was used only for metadata search
because it matches unrelated names; `フタバコ` (e.g. ふたば こども園) was discarded.

## Per-group result

Group | Deep checks | Result | Blockers
--- | --- | --- | ---
岐阜県 17 municipal groups (大垣, 高山, 多治見, 関, 中津川, 瑞浪, 美濃, 羽島, 恵那, 可児, 各務原, 美濃加茂, 瑞穂, 飛騨, 本巣, 郡上, 下呂) | CKAN `package_search` on the whole portal (1,882 packages): 喫煙/灰皿/たばこ/禁煙/smoking = 0. `package_show` for every `-003` public-facility package (CC BY 2.1 JP); all 51 CSV-labelled resources read in full (XLSX duplicates of the same releases not re-read), and the 各務原 2025 resource (an XLSX served as `.csv`) read from its shared strings | blocked | noSmokingEvidence, hostPointOnly
静岡県 | SHIRASAGI keyword search. The only smoking datasets are 登録禁煙店, 路上喫煙率 and 喫煙所利用者数実態調査 (static 静岡市 survey). Facility-list content scan (96 datasets, 7 with direct CSV) found nothing else | blocked | coordinatesMissing (see review)
滋賀県, 京都府, 大阪府, 和歌山県 | odcs.bodik.jp org-site search (喫煙/灰皿) = 0; the datasets live on `data.bodik.jp`, host-stopped (403) since #132 | hold | accessBlocked
神戸市 | `catalog.city.kobe.lg.jp` CKAN: 喫煙/灰皿/たばこ = 0 (control 施設 = 18); `www.city.kobe.lg.jp` host-stopped | blocked | noSmokingEvidence, accessBlocked
鳥取県 | keyword search = 0 (control OK); 94 facility datasets, 66 raw files scanned, 0 hits | blocked | noSmokingEvidence
島根県 | dataeye CKAN-compatible API `ckan_api/package_search`: 喫煙/灰皿 = 0; 79 facility packages, 32 raw files scanned, 0 hits | blocked | noSmokingEvidence
岡山県 | dataeye API: only 岡山市 路上喫煙制限区域 SHP. おかやま全県統合型GIS: all 101 open-data layers listed. None is a smoking place; the SHP is prohibition-zone polygons (see review). 100 facility packages, 37 raw files scanned | blocked | noSmokingPoint, polygonOnly
山口県 | the portal is reachable at `/ckan/`, not the #132 `/www/` URL. CKAN: 喫煙/灰皿/たばこ = 0 of 788 packages; 157 facility packages, 98 raw files scanned. One row was a food-business permit (see review) | blocked | noSmokingPoint, hostPointOnly
徳島県 | keyword search: 喫煙/灰皿/禁煙 = 0; たばこ hits are tax statistics only. 88 facility datasets, 45 raw files scanned, 0 hits | blocked | noSmokingEvidence
香川県 | keyword search = 0 (control OK); 67 facility datasets, 56 raw files scanned, 0 hits | blocked | noSmokingEvidence
愛媛県 | keyword search = 0 (control 施設 OK); 109 facility datasets, 11 with direct CSV scanned, 0 hits | blocked | noSmokingEvidence
高知県 | all 7 category pages (the static catalog has no search): no smoking wording in titles; files are mostly XLS; the 2 CSV/GTFS files have no hits | blocked | noSmokingEvidence

## West operators

No operator publishes a machine-readable smoking-place source. Floor-map and web pages stay
ineligible. The site terms read on 2026-10-01 prohibit reuse without permission:

Operator | Terms page (SHA-256 prefix) | Finding
--- | --- | ---
JR西日本 | `guide/site_policy.html` (ac65793f) | 無断で複製…一切の利用・処分などを行うことを禁止
南海 | `terms.html` (2c0eaf10) | 無断で複製、配布、販売などの二次利用…を禁止
阪急 | `sitepolicy/` (5c169972) | 事前の許諾なく…利用…することを禁止
阪神 | `terms/` (345f8351) | 事前の許諾なく…利用…を禁止
京阪 | `terms.html` (a3efca9c) | 私的利用の範囲を超える複製…できません
大阪メトロ | `site_info.php` (81ae62c0) | 無断での使用や転載を禁じます
大阪ステーションシティ | `info/rule.php` (f4320d8f) | 権利者の許可なく、無断で複製、転載…
京都市交通局 | 京都市 `site_policy/0000000005.html` | 無断で複製・転用することはできません. City smoking data is already published through 京都市's CC BY facility list (`kyoto-public-smoking-places`)
JR九州 | `railway/facility/nosmoking/` | Policy text only; no location data
JR四国, JR東海, 近鉄, 西鉄, 福岡市交通局, 福岡空港, 那覇空港 | homepage/sitemap | no smoking-place data and no reuse grant found; JR四国 terms are PDF-only
関西エアポート | `site-policy/` | 403, host stopped

## Remaining west/operator candidates

- BODIK-hosted 滋賀/京都/大阪/和歌山 (and BODIK-hosted municipalities): wait for legitimate
  `data.bodik.jp` access (Issue #118). Do not bypass.
- 神戸市 web pages and 関西エアポート: host stops kept.
- 静岡市 3 station-plaza smoking areas: needs publisher-supplied coordinates. Ask the publisher;
  never geocode.
- Operator lane: needs an explicit written reuse grant plus a structured export (e.g. an
  operator-contributed open dataset). Until then, blocked.

## Validation

Documentation and research attestations only; no schema, registry, adapter, fixture or corpus
change. New-source onboarding and fresh-D1 re-runs are therefore inapplicable: the corpus is
unchanged at 6 reviewed sources / 515 canonical / 513 published / 81 tiles, as recorded by #132.
