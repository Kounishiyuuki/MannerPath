# ホテルビスタ金沢 — reviewed normalized page facts (ADR-0018)

`hotel-vista-kanazawa-page-facts.csv` is MannerPath's **normalized fact sheet**, not an operator dataset. No HTML, expressive prose, photographs, floor plans, maps, screenshots or logos are redistributed. One hotel facility is one approximate spot.

## Official existence and current operation

- First-party source: [ホテルビスタ金沢・館内施設](https://kanazawa.hotel-vista.jp/ja/facilities), operated by 株式会社ビスタホテルマネジメント.
- Actual HTTP200 fetch `2026-11-08T04:57:00Z`; size and whole-page SHA-256 are in `fetch-receipts.json` (receipts, not licences). Raw HTML stays outside the repository.
- Normalized existence fact: 公式施設ページが「喫煙ブース（2F）」「喫煙ブースを除き、館内は禁煙です」と述べる。 The facility's existence alone is not the evidence; the explicit smoking-place statement is.
- Current-operation check: 2026-11-08 (UTC date of the actual fetch). Undated current official page (ADR-0018 D-C). Desk check, not an on-site visit. No closure, relocation or removal was found in the reviewed page.
- Kept as stated or unknown: 宿泊者以外の利用可否・たばこ種別は unknown。 Paper/heated support and smoking-place hours are unknown; hotel and check-in hours are never smoking hours.

## Rights decision — normalized facts only

Engineering `factReference` classification under ADR-0018 D-R, **not legal clearance, an open licence or operator permission**. Registry licence name and URL remain null.

- フッターは © VISTA HOTEL MANAGEMENT CO.,Ltd.。「規約/約款/ポリシー」ページはインターネット宿泊予約システム利用規約で、私的利用以外の目的での「本システム」の無断利用を禁じる。これは予約システムの利用に関する条項で、公開施設ページの事実参照を対象とする記載はないと読んだ。適用範囲について法的確定判断はしていない（メンテナー確認推奨）。情報利用・DB化の明示禁止は確認されなかった。
- Only the factual existence, the location qualifiers and the operator's factual address are stored in our own normalized form. If the operator objects or an information-use restriction appears, hold/re-review and withdraw the source.

## Independent facility-address anchor

- Official address: **石川県金沢市広岡2-13-27**, stated on the same official page. Embedded or linked map services are not used for coordinates or smoking existence.
- Reproduced locally with `@digital-go-jp/abr-geocoder@2.3.1` on Node 23.3.0, no fuzzy flag, on a copy of the existing 15-ZIP Kanazawa/Nonoichi ABR download whose manifest equals `abr-manifest.sha256` (release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250…`). No release registration, threshold or gate is changed.
- Input `listing-batch.json`, geocoder output `abrg-output.json`, evaluator result `anchor-evaluation.json` (`npm run address:anchors -- evaluate … --release abr-kanazawa-nonoichi-2026-10-26:…`): `residential_detail`, **1/1 accepted** by the unchanged `address-anchor-gate.v2`.
- Point `36.580329911, 136.643377003` is the official address's representative point, **not a smoking place, entrance or floor**: one `areaApproximate` spot with `locationArea.scope=facility`.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, 公共データ利用規約 第1.0版. Public attribution names the operator page and the government address source and says the pin is not the smoking place itself.

## Pinned release and deployment boundary

CSV SHA-256 `88156dd6147a2c917584a746609d4e8285e3c6287a9fc8253f4250252c00c6a6`, one record. Only this pinned reviewed release is approved; a changed page needs review. Cross-release validation false, completeness partial.

**Not yet registered**: the adapter is standalone until the shared reviewed-facility adapter (#408) lands; `SOURCE_ADAPTERS`, `REVIEWED_SOURCES`, `docs/SOURCES.md`, source-health and onboarding are untouched, so nothing is published by the pipeline yet. `test/kanazawa-hotel-facility-sources.test.ts` rehearses ingest → anchor → tile/detail in an in-memory database. No production database, tile, Worker or configuration change.
