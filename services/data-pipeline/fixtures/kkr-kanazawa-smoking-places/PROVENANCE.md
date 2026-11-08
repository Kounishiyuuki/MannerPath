# KKRホテル金沢 — reviewed normalized page facts (ADR-0018)

`kkr-kanazawa-page-facts.csv` is MannerPath's **normalized fact sheet**, not an operator dataset. No HTML, expressive prose, photographs, floor plans, maps, screenshots or logos are redistributed. One hotel facility is one approximate spot; its two smoking places are not two address pins.

## Official existence and current operation

- First-party source: [KKRホテル金沢・館内施設](https://kanazawa.kkr.or.jp/facilities/), operated by 国家公務員共済組合連合会・KKRホテル金沢.
- Actual HTTP200 fetch `2026-11-07T18:59:18Z` (**2026-11-08 JST**), `text/html; charset=UTF-8`, 126,065 bytes, whole-page SHA-256 `7717c9ba2b2e4613f131347f0c9f0be67f94ff6204ad743916e15454f8cdeec8`. Raw HTML stays outside the repository. Metadata for the actual facilities/FAQ/privacy/home/parent-terms fetches is retained in `fetch-receipts.json`; volatile whole-page hashes are receipts, not licences or health baselines.
- Normalized existence fact: smoking places on **1階ロビー入口側 and 3階エレベーター側**. The official facility's existence alone is not the evidence; the explicit smoking-place statement is.
- Current-operation check: 2026-11-08 JST (**2026-11-07 UTC**). Machine `checked_at`/`observedOn` and adapter review dates use `2026-11-07`, the UTC date of the actual fetch, to match the existing quality gate; this is the same event, not backdating. Undated current official page (ADR-0018 D-C). This is a desk check, not an on-site visit. Current FAQ https://kanazawa.kkr.or.jp/faq/ and hotel navigation/footer were reviewed for contradictions; no current closure, relocation or removal of these two smoking places was found in the reviewed scope. A contradictory operator statement requires hold/re-review.
- Unknown and kept unknown: paper/heated support, smoking-place hours, general/non-customer access, smoking-place room/enclosure type and environment. A floor number or facility photo does not establish a canonical indoor/room classification; hotel, restaurant, shop and check-in hours are never smoking hours. The hotel welcomes various facility users, which does not prove that every non-customer may use either smoking place.

## Rights decision — normalized facts only

This is an engineering `factReference` classification under maintainer-approved ADR-0018 D-R, **not legal clearance, an open licence, operator permission or a promise that a different future use is allowed**. Registry licence name and URL remain null.

- The hotel facilities page and homepage footer reserve copyright to 国家公務員共済組合連合会. Hotel navigation/footer and bounded same-host terms/copyright searches disclosed no explicit information-use, data-acquisition or database-incorporation prohibition. The hotel's linked [privacy policy](https://kanazawa.kkr.or.jp/privacy/) concerns personal data; it does not grant a content licence.
- The parent [当サイトのご利用にあたって](https://www.kkr.or.jp/siteriyo.html) is material context and is **not ignored**. Its introduction says its conditions do not apply to other linked sites. Section 3 reserves individual works and compilation copyright and requires prior contact for commercial reproduction. These two statements do **not** establish an open licence or make the parent conditions legally certainly inapplicable to the hotel subdomain. No parent-site reproduction permission is relied on, and no inquiry has been sent.
- The narrowly reviewed use stores factual existence, location qualifiers and the operator's factual address in our own normalized form. It does not reproduce the hotel's descriptions, page compilation, images, floor plan, map or logo. D-R distinguishes fact reference from reproduction of expression; it does not override an explicit prohibition of information use or database incorporation.
- If the operator objects or an applicable additional information-use restriction appears, hold/re-review and withdraw the source as required. Any use involving copying expressive content would need separate rights work and, where applicable, the prior contact described by the parent terms. No such use is part of this release.
- Repository-only health monitors the hotel footer and privacy scope plus the parent terms' **scope introduction and commercial-reproduction clause**. This detects drift in the recorded scopes; it does not guarantee discovery of terms newly added elsewhere. Scheduled review rechecks policy links, FAQ and address consistency by 2027-02-08.

## Independent facility-address anchor

- Official address: **石川県金沢市大手町2-32**, stated in the same official facilities page footer; also monitored separately from the smoking statement. Embedded/linked Google maps are not used for coordinates or smoking existence.
- Reproduced locally with `@digital-go-jp/abr-geocoder@2.3.1` on Node23.3.0, no fuzzy flag, using the existing 15-ZIP Kanazawa/Nonoichi ABR download. `geocoder-run.json` records this task's reproduction receipt, not an operator observation date. Raw source ZIPs, CSVs and SQLite data are not committed.
- `abr-manifest.sha256` reproduces registered release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d`. No release registration, coordinate threshold or gate is changed.
- Input `listing-batch.json`, actual accepted output `abrg-output.json`, evaluator result `anchor-evaluation.json`: match and coordinate levels both `residential_detail`, score1, no remainder, **1/1 accepted** by unchanged `address-anchor-gate.v2`.
- Point `36.568729789, 136.660338131` is the official address's representative point, **not a smoking place, entrance or floor**. One `areaApproximate` spot with `locationArea.scope=facility`, name retaining 1階・3階; the same-anchor rule prevents stacked pins. The geocoder establishes location context only, never smoking permission.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, [公共データ利用規約 第1.0版](https://www.digital.go.jp/policies/base_registry_address_tos). Public attribution names both original smoking facts and government address source, with normalization/geocoding processing and the approximate meaning. No parcel-coordinate data is used.

## Pinned release and deployment boundary

CSV SHA-256 `dee2776a66e4e6c018684c7213b85366919377126482e999d49ba24ed23d65c8`, one record. Only this pinned reviewed release is approved for the existing local pipeline; any changed page or newer fact sheet needs review. Cross-release validation remains false and completeness partial.

`kkr-kanazawa-source.test.ts` verifies strict fixture tamper refusal, one approximate tile/detail, unknown fields, anchor-required resolution, smoking/address drift monitoring and rights context. `kkr-kanazawa-baseline.test.ts` verifies the fixed six-source production baseline and duplicate distances independently; existing 513 published spots/81 tiles are not replaced by a live-data claim. There is no production database, source deployment, public tile, Worker or configuration change. Production health inventory stays at the existing six deployed sources; repository onboarding does not promote this source.

## Scoped health fingerprints

- Smoking facts + official address: `9596f52fcdf6ec2331dfad3d3f1b22338b0b129e4c080d3d26f48fa9f9866a3a`.
- Hotel copyright footer: `a99b10dcd7105a60f0d447378e8603f17640c56f8e3722c02e7f1c4eec0e7cf3`.
- Hotel privacy scope: `5b2b04f858edebc933e3a26b85e0d2dd01ac2694a637f1605c6f5cdb0c3f67f7`.
- Parent terms scope introduction + section3: `80eed0fc07485e27bf19f1ee6a5dd1284fc161f66fe61e53d423bef10561e97a`.
