# 金沢市民芸術村 — reviewed normalized page facts (ADR-0018)

`kanazawa-artvillage-page-facts.csv` is MannerPath's normalized fact sheet, **not a publisher dataset**. No HTML, expressive prose, photograph, map, screenshot, floor plan or logo is redistributed.

## Existence and current operation

- First-party operator page: https://www.artvillage.gr.jp/facilities/square. Site operator: 金沢市民芸術村 (official facility site, linked by 金沢芸術創造財団 https://www.kanazawa-arts.or.jp/).
- HTTP 200, fetched `2026-11-07T13:20:37Z`, 16,164 bytes, whole-page SHA-256 `49789c02ba16346d86c891636d77f3abe41d93c59973c6cf181cdd76c613f2a7`. Raw HTML stays outside the repository; volatile whole-page digest is an audit receipt, not the health baseline.
- Normalized smoking fact: 大和町広場の園路. The current square facilities page explicitly lists a smoking place along the garden path. Its general-use page https://www.artvillage.gr.jp/info/ permits smoking only at designated places; indoor no-smoking notices do not license smoking elsewhere.
- Checked 2026-11-07 JST. No smoking-place observation date is stated: this is a current official-page desk check (D-C), **not an on-site verification**.
- Unknown: paper/heated support, smoking-place hours, standalone/general or non-customer access, enclosure/roof and equipment type. All corresponding canonical fields stay `unknown` / absent. Host business/grounds/gate hours are not smoking-place hours. The grounds page includes both reservation-use hours and all-day/gate-access qualifications; none is converted to smoking hours or a public-access claim.

## Rights reading — engineering classification

- Actual page and official homepage navigation/footer reviewed 2026-11-07; scoped same-domain search for website terms/copyright reviewed. The footer reserves copyright: `Copyright © KANAZAWA CITIZEN'S ART CENTER. All Rights Reserved.`. No separate website terms link or explicit prohibition of information use, data acquisition or database incorporation was found in that reviewed scope.
- Classified `factReference` under the maintainer-approved ADR-0018 D-R: **normalized factual existence/address only**, no expressive content reproduction. This is not an open licence, operator permission, comprehensive legal clearance or a guarantee that future terms will stay unchanged. Registry licence name/URL remain null.
- The foundation event-data CC BY terms https://www.kanazawa-arts.or.jp/info/opendata apply to event information only and are NOT extended to this facility page. The access page Google map is not coordinate evidence.
- Publisher objection or contrary smoking restriction requires withdrawal/review under the existing source hold procedure; no rights gate is relaxed.
- Scoped copyright health fingerprint `006afd731e64a4c33861028c349dc239c591092fcce6322bfc32137e24bfa1f3` and smoking-fact/footer-address fingerprint `954412b24dc56490db1e41a9c36c69b11aff108f25710bdae2962039c51f7347` are independently recorded in source-health metadata and code. They detect changes within their reviewed scopes, not terms newly added elsewhere. The same official address is also stated in the square page footer and is now included in the fact health scope; scheduled review additionally rechecks the separate access page and navigation/policy links.

## Independent facility anchor

- Official address: `石川県金沢市大和町1-1`. Also stated in the square page footer (independently health-monitored), and on the operator access page https://www.artvillage.gr.jp/access/ (HTTP200, 12,921 bytes, SHA-256 756e3377212477baef10ac761d1da585829959c1dac0ef1b91253b49319115a4).
- Actual abr-geocoder 2.3.1 local run, no fuzzy flag, over the 2026-11-07 Kanazawa/Nonoichi download (15 ZIPs). Digest exactly reproduces the already registered release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d`; no prior release is changed.
- `residential_detail` match and coordinate levels, no unmatched remainder, accepted by unchanged `address-anchor-gate.v2`. Input, raw accepted output, ZIP manifest and actual evaluation: `services/data-pipeline/research/official-source-intake/kanazawa-2026-11-07/`.
- Representative point `36.569565872, 136.641441103`, **one** `areaApproximate` / `locationArea.scope=facility` spot. It is neither the smoking place nor an entrance, room or garden-path position. An address geocode proves location context only; existence comes exclusively from the operator page.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, [公共データ利用規約 第1.0版](https://www.digital.go.jp/policies/base_registry_address_tos). Public attribution names the source, geocoding/normalization processing and approximate meaning; no parcel coordinate is used. ABR source ZIPs/SQLite are not committed.

## Release and deployment boundary

CSV SHA-256 `20636c742d1d0e272af054d28c13f58ea85415f85ff9b91ee521337299ba757f`, one pinned row. Checked by `kanazawa-operator-source.test.ts`: strict-row/digest tamper rejection, unknown values, one approximate tile/detail, missing-anchor refusal and page-drift monitoring. Existing 513-place duplicate/baseline comparison is recorded in the dated research report and its test. Repository approval is limited to this pinned local pipeline release; **no production promotion, source deployment, database or tile write**. New sources are excluded from production health inventory until a separately reviewed deployment expands it. Any newer page/release needs re-review.
