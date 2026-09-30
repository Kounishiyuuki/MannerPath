# Address-only official smoking candidates — derived-coordinate impact (2026-10-01)

Input for ADR-0011. Mechanical replay of committed research only: no publisher page was re-fetched, no real
candidate address was geocoded, nothing was published. Candidate list:
`services/data-pipeline/derived-coordinates/address-only-candidates.json`; machine output:
`docs/research/nationwide-discovery/2026-10-01-derived-coordinate-replay.json`
(`cd services/api && npm run replay:derived-coordinates -- --json`).

## Classification

| Bucket | Candidates | Stated spots | Without stated count | Prefectures |
| --- | --- | --- | --- | --- |
| Total address-only smoking candidates | 26 | 51 | 15 | 北海道, 静岡県, 広島県, 岡山県, 愛知県, 神奈川県, 福島県, 東京都 |
| Exact address (street or parcel) | 10 | 34 | 4 | 北海道, 広島県, 神奈川県, 東京都 |
| Likely geocodable (street address) | 9 | 33 | 4 | 広島県, 神奈川県, 東京都 |
| Insufficient address (name/station/image/none) | 8 | 14 | 4 | 静岡県, 岡山県, 東京都 |
| Address form not stated in research | 8 | 3 | 7 | 愛知県, 福島県, 東京都 |
| Current operation not confirmed | 9 | 23 | 3 | 北海道, 広島県, 岡山県, 愛知県, 東京都 |
| License explicitly blocked | 6 | 3 | 5 | 愛知県, 東京都 |
| License unknown | 18 | 44 | 10 | 広島県, 岡山県, 神奈川県, 福島県, 東京都 |
| Exact address + operating + license not blocked | 5 | 21 | 2 | 神奈川県, 東京都 |

"Likely geocodable" is an upper bound: it assumes each street address reaches `residential_detail`, which
holds only inside 住居表示 areas and was not tested on these addresses.

## Gate replay

- Today: 0 of 26 pass (all sources unapproved; no geocode run).
- Simulated best case (policy approved, license-established sources approved, best precision per address form): **0 candidates, 0 review-required**.
- 札幌 大通公園: `currentOperationNotConfirmed` (asset register row); parcel precision would also need site evidence.
- 静岡市 3 station plazas: `noGeocodeResult` — the licensed CSV has names only.
- Every other candidate: `sourceNotApproved` + `addressReuseNotReviewed` (license).

## Potential unlock

Only if the publishers' reuse terms are resolved: 5 sources (川崎市, 新宿区, 文京区, 渋谷区, 板橋区), ≥21 spots, new prefecture: 神奈川県.
Widest possible reach (every candidate, all blockers cleared) is 7 new prefectures:
北海道, 静岡県, 広島県, 岡山県, 愛知県, 神奈川県, 福島県.

## Candidates

| id | Municipality | Address form | License | Operation | Spots |
| --- | --- | --- | --- | --- | --- |
| sapporo-odori-park | 北海道 札幌市 | parcelAddress | established | unknown | 1 |
| shizuoka-station-plazas | 静岡県 静岡市 | nameOnly | established | confirmed | 3 |
| hiroshima-park-booths | 広島県 広島市 | streetAddress | unknown | unknown | 6 |
| okayama-station | 岡山県 岡山市 | none | unknown | unknown | 2 |
| nagoya-smoking-places | 愛知県 名古屋市 | unverified | blocked | unknown | 3 |
| kawasaki-designated | 神奈川県 川崎市 | streetAddress | unknown | confirmed | 12 |
| fukushima-city | 福島県 福島市 | unverified | unknown | confirmed | — |
| chiyoda-free-smoking | 東京都 千代田区 | streetAddress | blocked | partial | — |
| shinjuku-public | 東京都 新宿区 | streetAddress | unknown | confirmed | 7 |
| bunkyo-designated | 東京都 文京区 | streetAddress | unknown | confirmed | — |
| shibuya-list | 東京都 渋谷区 | streetAddress | unknown | confirmed | — |
| sumida-sites | 東京都 墨田区 | unverified | unknown | unknown | — |
| koto-assisted | 東京都 江東区 | unverified | unknown | confirmed | — |
| shinagawa-pdf | 東京都 品川区 | imageOrPdf | unknown | confirmed | — |
| nakano-images | 東京都 中野区 | imageOrPdf | unknown | confirmed | — |
| toshima-designated | 東京都 豊島区 | streetAddress | unknown | partial | 6 |
| kita-stations | 東京都 北区 | imageOrPdf | blocked | confirmed | — |
| itabashi-public | 東京都 板橋区 | streetAddress | unknown | confirmed | 2 |
| nerima-stations | 東京都 練馬区 | imageOrPdf | unknown | unknown | 5 |
| adachi-stations | 東京都 足立区 | streetAddress | blocked | confirmed | — |
| katsushika-sites | 東京都 葛飾区 | imageOrPdf | blocked | confirmed | — |
| edogawa-stations | 東京都 江戸川区 | relativeOrStation | unknown | confirmed | 4 |
| ota-public | 東京都 大田区 | unverified | unknown | confirmed | — |
| arakawa-designated | 東京都 荒川区 | unverified | blocked | confirmed | — |
| meguro-list | 東京都 目黒区 | unverified | unknown | confirmed | — |
| setagaya-map | 東京都 世田谷区 | unverified | unknown | unknown | — |
