# 金沢マンテンホテル駅前 — reviewed normalized page facts (ADR-0018)

`manten-kanazawa-ekimae-page-facts.csv` is MannerPath's **normalized fact sheet**, not an operator dataset. No HTML, expressive prose, photographs, floor plans, maps, screenshots or logos are redistributed. One hotel facility is one approximate spot.

## Official existence and current operation

- First-party source: [金沢マンテンホテル駅前・よくあるご質問](https://www.manten-hotel.com/kanazawa/faq/), operated by 株式会社マンテンホテル.
- Actual HTTP200 fetch `2026-11-08T04:56:55Z`; size and whole-page SHA-256 are in `fetch-receipts.json` (receipts, not licences). Raw HTML stays outside the repository.
- Normalized existence fact: 公式FAQが「1階の駐車場入り口横と館内4・7階EV近くに喫煙室を設置」と述べる（全客室禁煙の案内と同じページ）。 The facility's existence alone is not the evidence; the explicit smoking-place statement is.
- Current-operation check: 2026-11-08 (UTC date of the actual fetch). Undated current official page (ADR-0018 D-C). Desk check, not an on-site visit. No closure, relocation or removal was found in the reviewed page.
- Kept as stated or unknown: 4F・7Fは客室階のエレベーター付近。宿泊者以外の利用可否は公式に記載がなく unknown のまま。1施設1地点で3か所を別のピンにしない。 Paper/heated support and smoking-place hours are unknown; hotel and check-in hours are never smoking hours.

## Rights decision — normalized facts only

Engineering `factReference` classification under ADR-0018 D-R, **not legal clearance, an open licence or operator permission**. Registry licence name and URL remain null.

- フッターは著作権留保（Copyright © Manten hotel Co.,Ltd）。FAQ・ナビゲーション・フッターとリンクされたプライバシーポリシー（https://manten-hotel.co.jp/privacy/。ページ上のリンクは http、HTTPS で同内容を取得）を確認。情報利用・データ取得・DB化の明示禁止は確認されなかった。
- Only the factual existence, the location qualifiers and the operator's factual address are stored in our own normalized form. If the operator objects or an information-use restriction appears, hold/re-review and withdraw the source.

## Independent facility-address anchor

- Official address: **石川県金沢市北安江1-6-1**, stated on the same official page. Embedded or linked map services are not used for coordinates or smoking existence.
- Reproduced locally with `@digital-go-jp/abr-geocoder@2.3.1` on Node 23.3.0, no fuzzy flag, on a copy of the existing 15-ZIP Kanazawa/Nonoichi ABR download whose manifest equals `abr-manifest.sha256` (release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250…`). No release registration, threshold or gate is changed.
- Input `listing-batch.json`, geocoder output `abrg-output.json`, evaluator result `anchor-evaluation.json` (`npm run address:anchors -- evaluate … --release abr-kanazawa-nonoichi-2026-10-26:…`): `residential_detail`, **1/1 accepted** by the unchanged `address-anchor-gate.v2`.
- Point `36.581441767, 136.649589106` is the official address's representative point, **not a smoking place, entrance or floor**: one `areaApproximate` spot with `locationArea.scope=facility`.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, 公共データ利用規約 第1.0版. Public attribution names the operator page and the government address source and says the pin is not the smoking place itself.

## Pinned release and deployment boundary

CSV SHA-256 `65f0151bf8b26fc2938d35ea849137560bf6f904dfae115e11fd05ff9f67019a`, one record. Only this pinned reviewed release is approved; a changed page needs review. Cross-release validation false, completeness partial.

**Registered** through the shared reviewed-facility adapter (#409) like KKR: `SOURCE_ADAPTERS`, reviewed fixtures, onboarding pins, `docs/SOURCES.md`, discovery manifest, and repository-only source health (smoking/address scope and rights-page scopes with reviewed fingerprints; review due 2027-02-08). `test/kanazawa-hotel-facility-sources.test.ts` covers ingest → anchor → tile/detail. Production inventory is not expanded; no production database, tile, Worker or configuration change.
