# 小松空港 喫煙場所 — reviewed page-fact sheet (ADR-0018)

`komatsu-airport-page-facts.csv` is **not a publisher file**. It is MannerPath's reviewed, normalized record of the
facts one official page states, plus an independently sourced facility anchor. No publisher text, image, floor map,
screenshot or logo is reproduced; the page HTML is not committed.

## Existence evidence (factReference, ADR-0018 §3 / D-R)

| Item | Value |
| --- | --- |
| Page | https://www.komatsuairport.jp/faq/q85.html (「喫煙場所はどこですか。」) |
| Site operator | 小松空港協議会 (Komatsu Airport Association), the airport's official website |
| Checked | 2026-10-11, HTTP 200 `text/html`, 16,170 bytes, SHA-256 `735d976a5bd361b95e85819d2a23286b1d66455b8ecea102e447ec9bbc19b0a6` (whole page; volatile) |
| Normalized facts | Four smoking places: 国際線2F出発ロビー, 国内線搭乗待合室（ANAラウンジ横）, 国際線搭乗待合室, 屋外（バス乗り場付近） |
| Page date | None stated. Current operation per ADR-0018 §5 / D-C: listed on the publisher's current page at `checked_at`; not site-verified |
| Fact fingerprint | Scoped text 「[img:] 喫煙場所はどこですか。」…「関連リンク」, SHA-256 `e5fc9afb22df6e75a9d3b721c20b34d268443d073bc3d7df4f3223bb5b1f91c6` (source health re-checks it) |

Not stated by the page, therefore unknown: hours, paper/heated support, indoor/outdoor per zone, room type.
Access: two zones are after security (搭乗者のみ); the other two are in public areas. The one facility spot is
therefore `access_type = unknown` (neither `public` nor `facilityOnly` holds for all four), and its name keeps
「一部は保安検査後」. A per-zone access model is not part of ADR-0018.

## Rights reading (engineering classification, not legal advice)

- [著作権について](https://www.komatsuairport.jp/cmn/copyright.html): individual items (文字、写真、イラスト等) and the
  site as a compilation are copyright works; 「著作権法上認められた場合を除き、許可なく無断で複製・転用することはできません」.
  Scoped fingerprint `3f2d56eb9236edb9d80be188c11faba2e0de3f96216613a9b08c95b8dff4430d`.
- [免責事項](https://www.komatsuairport.jp/cmn/disclaimer.html): accuracy disclaimer; linking is 「原則フリー」, with a
  prior notice requested from corporations / for-profit individuals.
- No clause prohibits using the information, acquiring data or building a database. The clause above reserves the
  expression (copying/diversion of the works). Classified `factReference`: only the normalized facts above are stored.
  Any objection from the publisher moves the source to blocked and withdraws the spot.

## Location anchor (ADR-0018 §2 item 3 / D-A)

| Item | Value |
| --- | --- |
| Dataset | 国土数値情報 空港データ (C28) 令和3年度, https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html |
| File | `C28-21_GML.zip`, SHA-256 `07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35` (not committed) |
| Feature | `TerminalBuilding` `cf04_00071`, referenced by the `Airport` feature 小松飛行場 (C28_102) |
| Point | 36.401889, 136.413528 (JGD2011 geographic), copied as stated |
| Licence | 「商用可」; [利用約款](https://nlftp.mlit.go.jp/ksj/other/agreement_02.html): use with 出典 and a processing notice; one extracted point is not a redistributed database |
| Meaning | Representative point of the passenger terminal **facility** (`area_scope = facility`), never a smoking point. Data as of 2021-12-31 |

The four zones resolve to this one anchor, so they are published as **one** facility-level spot (same-anchor rule).
