# 中央区 民間指定喫煙場所 — reviewed normalized page facts (ADR-0018)

This CSV is MannerPath's normalized fact sheet, not a publisher file. No page HTML, prose, image, map, PDF, screenshot or logo is redistributed.

- Existence page: https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html (中央区内指定喫煙場所一覧, section 民間指定喫煙場所, 58 entries).
- Checked: 2026-10-18 JST; fetched 2026-10-18T10:56:21Z, HTTP 200, 43670 bytes, whole-page SHA-256 `11e4797882ee96ee8d181d8cc69d33b484616675146831cb1298a27d2f853e50` (identical to the 05:20Z fetch reviewed for 区営指定喫煙場所). HTML remains outside the repository.
- Excluded (8): suspended per the page's 備考 — 8 paspa京橋, 10 paspa西銀座, 22 ファミリーマート築地本願寺前店, 24 paspa八丁堀トレーラー, 55 東京消防庁臨港消防署; 31 paspa小舟町 (紙巻きたばこ利用休止: a partial suspension that would need a reviewed tobacco-type statement); 40 THE TOBACCO NIHOMBASHI MK-238 (address remainder 「FORYOU東京駅前ビル地下1階」 not split by gate v2); 58 晴海客船ターミナル (still listed, but the facility closed on 2022-02-20 per 東京都港湾局; contradicted current operation, held for maintainer review).
- Same-anchor rule: 1–3 八重洲地下街（サウステラス／イーストテラス／ノーステラス） share 八重洲2丁目1番, and 9/15 GSパーク銀座5丁目駐車場内（昭和通り側／三原橋側） share 銀座5丁目12番: one spot each, places kept in `zones`. 4 東京ミッドタウン八重洲 lists two floors at one address: one spot, floors in `zones`. 50 listed places → 47 rows.
- Hours: the page's 供用時間 verbatim with its 注記 (days excluded, building closures) and 定員 notes in `hours_note`. Only an unqualified 午前0時から午後12時 would be all day; none qualifies, so every row stays unparsed and openNow is never asserted. 9's relocation-and-reopening on 令和8年7月10日 had passed at checkedAt.
- Not stated, so `unknown`: tobacco types, physical type, environment, access (who may use a private place) and host type.
- Rights: `factReference`, maintainer D-R, as for chuo-park-smoking-places. 「著作権について」 (https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/thissite.html, re-fetched 2026-10-18, SHA-256 `84a2dd309de8aeb7696ffe9a7977c9ec56b27fd8a9cf666ae7763fcf5a4cc62c`, unchanged) reserves copyright and forbids unauthorized 転載・改変; no prohibition of information use, data acquisition or database incorporation was found. Engineering classification, not legal clearance. A publisher objection fails closed.
- Anchor: `officialAddressGeocode` (address-anchor-gate.v2). The page's 所在地, prefixed with 東京都中央区 where the page omits it, through abr-geocoder 2.3.1 (no --fuzzy) over ABR release `abr-tokyo-6wards-2026-10-18:sha256:30b45f8a…6ac2`; raw output pinned in `abrg-output.json`, input rows in `listing-batch.json`. `areaApproximate`, scope `facility`: the address's representative point, never the smoking place, an entrance or a floor. ABR: 公共データ利用規約 1.0 (ADR-0011). No SRID is stated by the CLI.
- Duplicates: no other reviewed source covers 中央区 private places. The nearest other points are 区営 park places (chuo-park-smoking-places, 47–147 m), which the page lists as separate designated places.
- CSV SHA-256: `464673d8e558c1bc9f9429fd58b5762d8a123f70fd9eb9285294248056ef1442`; 47 rows; first pinned release only.

Live review: Claude Code source-review, 2026-10-18 JST.
