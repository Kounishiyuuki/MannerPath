# ホテルルートイン金沢駅前 — reviewed normalized page facts (ADR-0018)

`route-inn-kanazawa-ekimae-page-facts.csv` is MannerPath's **normalized fact sheet**, not an operator dataset. No HTML, expressive prose, photographs, floor plans, maps, screenshots or logos are redistributed. One hotel facility is one approximate spot.

## Official existence and current operation

- First-party source: [ホテルルートイン金沢駅前・その他施設](https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/), operated by ルートインジャパン株式会社.
- Actual HTTP200 fetch `2026-11-08T04:56:58Z`; size and whole-page SHA-256 are in `fetch-receipts.json` (receipts, not licences). Raw HTML stays outside the repository.
- Normalized existence fact: 公式施設ページが「喫煙スペースは1階です」と述べる。 The facility's existence alone is not the evidence; the explicit smoking-place statement is.
- Current-operation check: 2026-11-08 (UTC date of the actual fetch). Undated current official page (ADR-0018 D-C). Desk check, not an on-site visit. No closure, relocation or removal was found in the reviewed page.
- Kept as stated or unknown: 加熱式たばこ専用の客室は客室で、共用の喫煙スペースとしては登録しない。宿泊者以外の利用可否・たばこ種別は unknown。 Paper/heated support and smoking-place hours are unknown; hotel and check-in hours are never smoking hours.

## Rights decision — normalized facts only

Engineering `factReference` classification under ADR-0018 D-R, **not legal clearance, an open licence or operator permission**. Registry licence name and URL remain null.

- フッターは著作権留保（Copyright © Route Inn Japan co., Ltd.）。フッターの「インターネット会員利用規約」は会員サービスの規約で、権利侵害行為を禁じるが、公開ページの情報利用・DB化の明示禁止はない。プライバシーポリシーは個人情報の扱い。
- Only the factual existence, the location qualifiers and the operator's factual address are stored in our own normalized form. If the operator objects or an information-use restriction appears, hold/re-review and withdraw the source.

## Independent facility-address anchor

- Official address: **石川県金沢市昭和町22番5号**, stated on the same official page. Embedded or linked map services are not used for coordinates or smoking existence.
- Reproduced locally with `@digital-go-jp/abr-geocoder@2.3.1` on Node 23.3.0, no fuzzy flag, on a copy of the existing 15-ZIP Kanazawa/Nonoichi ABR download whose manifest equals `abr-manifest.sha256` (release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250…`). No release registration, threshold or gate is changed.
- Input `listing-batch.json`, geocoder output `abrg-output.json`, evaluator result `anchor-evaluation.json` (`npm run address:anchors -- evaluate … --release abr-kanazawa-nonoichi-2026-10-26:…`): `residential_detail`, **1/1 accepted** by the unchanged `address-anchor-gate.v2`.
- Point `36.574896175, 136.646092219` is the official address's representative point, **not a smoking place, entrance or floor**: one `areaApproximate` spot with `locationArea.scope=facility`.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, 公共データ利用規約 第1.0版. Public attribution names the operator page and the government address source and says the pin is not the smoking place itself.

## Pinned release and deployment boundary

CSV SHA-256 `4c3b9f32a145371b2bd45a38d9a0ccfba3ad05609886a264d02c60f1ac29035f`, one record. Only this pinned reviewed release is approved; a changed page needs review. Cross-release validation false, completeness partial.

**Not yet registered**: the adapter is standalone until the shared reviewed-facility adapter (#408) lands; `SOURCE_ADAPTERS`, `REVIEWED_SOURCES`, `docs/SOURCES.md`, source-health and onboarding are untouched, so nothing is published by the pipeline yet. `test/kanazawa-hotel-facility-sources.test.ts` rehearses ingest → anchor → tile/detail in an in-memory database. No production database, tile, Worker or configuration change.
