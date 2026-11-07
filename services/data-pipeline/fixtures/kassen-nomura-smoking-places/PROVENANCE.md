# 割鮮のむら — reviewed normalized page facts (ADR-0018)

`kassen-nomura-page-facts.csv` is MannerPath's normalized fact sheet, **not a publisher dataset**. No HTML, expressive prose, photograph, map, screenshot, floor plan or logo is redistributed.

## Existence and current operation

- First-party operator page: https://www.kassen-nomura.com/about/. Site operator: 割鮮のむら (restaurant operator).
- HTTP 200, fetched `2026-11-07T13:20:36Z`, 16,252 bytes, whole-page SHA-256 `b5af99efed166bf925dbbdb85ed12ae4732c53d34bc8f139ae40884d3fe7247d`. Raw HTML stays outside the repository; volatile whole-page digest is an audit receipt, not the health baseline.
- Normalized smoking fact: 店外（店内禁煙）. The restaurant interior is smoke-free; this is not a smoking-permitted dining venue.
- Checked 2026-11-07 JST. No smoking-place observation date is stated: this is a current official-page desk check (D-C), **not an on-site verification**.
- Unknown: paper/heated support, smoking-place hours, standalone/general or non-customer access, enclosure/roof and equipment type. All corresponding canonical fields stay `unknown` / absent. Host business/grounds/gate hours are not smoking-place hours. Store-exterior wording does not establish a roof/enclosure and is not converted to canonical outdoor or ashtray.

## Rights reading — engineering classification

- Actual page and official homepage navigation/footer reviewed 2026-11-07; scoped same-domain search for website terms/copyright reviewed. The footer reserves copyright: `Copyright &copy; Kassen Nomura`. No separate website terms link or explicit prohibition of information use, data acquisition or database incorporation was found in that reviewed scope.
- Classified `factReference` under the maintainer-approved ADR-0018 D-R: **normalized factual existence/address only**, no expressive content reproduction. This is not an open licence, operator permission, comprehensive legal clearance or a guarantee that future terms will stay unchanged. Registry licence name/URL remain null.
- No Google embedded map/link is used as coordinate evidence.
- Publisher objection or contrary smoking restriction requires withdrawal/review under the existing source hold procedure; no rights gate is relaxed.
- Scoped copyright health fingerprint `de3b841ba250b46c0e0d7f78397a914cc65f71f0dcc7acc17b0d6fa63a7d5f41` and smoking-fact/address fingerprint `d3144059a13498d5ddac8c51ac4d4c07870963b22242a725d1faf3cf747583e2` are independently recorded in source-health metadata and code. They detect changes within their reviewed scopes, not terms newly added elsewhere; scheduled review rechecks navigation/policy links.

## Independent facility anchor

- Official address: `石川県金沢市泉野出町3-3-32`. Stated on the existence page itself.
- Actual abr-geocoder 2.3.1 local run, no fuzzy flag, over the 2026-11-07 Kanazawa/Nonoichi download (15 ZIPs). Digest exactly reproduces the already registered release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d`; no prior release is changed.
- `residential_detail` match and coordinate levels, no unmatched remainder, accepted by unchanged `address-anchor-gate.v2`. Input, raw accepted output, ZIP manifest and actual evaluation: `services/data-pipeline/research/official-source-intake/kanazawa-2026-11-07/`.
- Representative point `36.539788283, 136.649160875`, **one** `areaApproximate` / `locationArea.scope=facility` spot. It is neither the smoking place nor an entrance, room or garden-path position. An address geocode proves location context only; existence comes exclusively from the operator page.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, [公共データ利用規約 第1.0版](https://www.digital.go.jp/policies/base_registry_address_tos). Public attribution names the source, geocoding/normalization processing and approximate meaning; no parcel coordinate is used. ABR source ZIPs/SQLite are not committed.

## Release and deployment boundary

CSV SHA-256 `481566bb5f1d9973c3907edfacfe1c08f8353c28d2d3146d6215a3ce732d8b5c`, one pinned row. Checked by `kanazawa-operator-source.test.ts`: strict-row/digest tamper rejection, unknown values, one approximate tile/detail, missing-anchor refusal and page-drift monitoring. Existing 513-place duplicate/baseline comparison is recorded in the dated research report and its test. Repository approval is limited to this pinned local pipeline release; **no production promotion, source deployment, database or tile write**. New sources are excluded from production health inventory until a separately reviewed deployment expands it. Any newer page/release needs re-review.
