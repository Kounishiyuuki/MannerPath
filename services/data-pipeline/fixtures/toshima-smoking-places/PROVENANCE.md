# 豊島区 区指定喫煙所 — reviewed normalized page facts (ADR-0018)

This CSV is MannerPath's normalized fact sheet, not a publisher file. No page HTML, prose, image, map, PDF, screenshot or logo is redistributed.

- Existence page: https://www.city.toshima.lg.jp/152/machizukuri/sumai/bika/taisaku/025701.html (区指定喫煙所; the ward's places 一般に開放する).
- Checked: 2026-10-19 JST; fetched 2026-10-18T20:56:32Z, HTTP 200, 18245 bytes, whole-page SHA-256 `fb9791143199d770f491241f4eaac8d6809e5ee19f92f6faa4b1b26152346109`. HTML remains outside the repository. The ward's separate opening notice for 池袋駅西口東京芸術劇場前喫煙所 (https://www.city.toshima.lg.jp/152/2507221634.html) gives the same address and hours.
- Listed: 7 places — 区営 3, 助成金活用 4.
- Batch triage: `bulk-intake.v1` over all 7 rows (each cell already names 豊島区; only 東京都 is prefixed by `completeOfficialAddress`), geocoded with abr-geocoder 2.3.1 (no `--fuzzy`) against the pinned ABR release `abr-tokyo-6wards-2026-10-18:sha256:30b45f8a…6ac2`, whose zip digest was recomputed 2026-10-19 and matched (`verifyDatasetDir`). Result: 4 adoptable, 2 needs review, 1 rejected.
- Selected: the 4 adoptable rows → **4** spots (池袋駅西口東京芸術劇場前喫煙所, THETOBACCOIKEBUKURO, ファミリーマート立教通り店, THETOBACCOIKEBUKUROSECOND). No two share an address point.
- Not published (3): 池袋駅東口喫煙所 and 池袋駅北口喫煙所 (区営, given only as a frontage 「…番先」, needs review); サンカクスクエア喫煙所 (the page says 8月26日より当面の間休止, rejected).
- Hours: the page's 時間 verbatim, always unparsed, so openNow is never asserted. Tobacco types are not stated on the list and remain unknown (the opening notice describes separate heated/paper areas for one place; not recorded).
- Classification: `accessType = public` (一般に開放する喫煙所); `hostType = municipality` only for the 区営 place, otherwise unknown; spot type and environment unknown.
- Current operation: listed without a suspension note on the current first-party page as of checkedAt; not a site visit.
- Rights: `factReference`, maintainer D-R. 豊島区ホームページ サイトポリシー「著作権について」 (https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html, fetched 2026-10-18T20:56:37Z, SHA-256 `92d295e46837fbbdddfbe1cef8939b7b145f1b709bc54269c4d8830f6992edd0`) states the ward holds the rights in its documents and images and that they may not be 無断で複製・転用 outside private use or quotation; no prohibition of information use, data acquisition or database incorporation was found. Only normalized facts are stored. Engineering classification, not legal clearance. A publisher objection fails closed.
- Anchor: the ABR representative point of each row's own address lot (ADR-0018 item 5, `anchor_basis = officialAddressGeocode`, gate `address-anchor-gate.v2`), all `residential_detail`, with a trailing building name/floor kept in the reference as 除外=…. `areaApproximate`, scope `facility`: an address point, never the smoking place, an entrance or a floor. No SRID is stated; acceptable for an approximate pin only. ABR data: デジタル庁 アドレス・ベース・レジストリ (公共データ利用規約 第1.0版), credited in the adapter's attribution.
- Existing data: no other approved source covers 豊島区; cross-source recall over all reviewed sources finds no candidate within 100 m.
- CSV SHA-256: `feb1e8201a0839a3f24d61769da8fc5968aeca3c62062ec6a761fac901ddc31c`; 4 rows; first pinned release only, no automatic refresh or cross-release approval.

Live review: Claude Code source-review, 2026-10-19 JST. Fact scope fingerprint: `39bf9e59d9bf09c1618cdbfeff97a2e0dfa4ff92b15a0bfebf950a2aeb8a30be` (range 区指定喫煙所設置場所 … お問い合わせ). Recheck URLs and scopes are pinned in `services/data-pipeline/source-health/review-metadata.json` and `services/api/scripts/source-health.ts`. Source health is advisory/read-only; only a maintainer-reviewed hold/clear changes publication.
