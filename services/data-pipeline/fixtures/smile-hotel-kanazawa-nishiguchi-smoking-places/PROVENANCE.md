# スマイルホテル金沢西口駅前 — reviewed normalized page facts (ADR-0018)

`smile-hotel-kanazawa-nishiguchi-page-facts.csv` is MannerPath's **normalized fact sheet**, not an operator dataset. No HTML, expressive prose, photographs, floor plans, maps, screenshots or logos are redistributed. One hotel facility is one approximate spot.

## Official existence and current operation

- First-party source: [スマイルホテル金沢西口駅前・公式ページ](https://smile-hotels.com/hotels/kanazawanishiguchiekimae/), operated by ホスピタリティパートナーズグループ（責任者：株式会社ホスピタリティオペレーションズ）.
- Actual HTTP200 fetch `2026-11-08T11:20:13Z`; sizes and whole-page SHA-256 in `fetch-receipts.json` (receipts, not licences). Raw HTML stays outside the repository.
- Normalized existence fact: 公式ページの館内設備に「愛煙家の方のために指定の喫煙スペースを設けております」とある。場所・階・屋内外は記載がなく、推測しない。 The facility's existence alone is not the evidence; the explicit smoking-place statement is.
- Current-operation check: 2026-11-08 (UTC date of the actual fetch). Undated current official page (ADR-0018 D-C). Desk check, not an on-site visit. No closure, relocation or removal found in the reviewed pages.
- Unknown and kept unknown: paper/heated support, smoking-place hours, use by non-guests, room/enclosure type and environment. Hotel and check-in hours are never smoking hours.

## Rights decision — normalized facts only

Engineering `factReference` classification under ADR-0018 D-R, **not legal clearance, an open licence or operator permission**. Registry licence name and URL remain null.

- フッターは「Copyright © 2026 smile hotel」。施設別の個人情報保護方針・特定商取引法に基づく表記（https://smile-hotels.com/privacy-policies/show/kanazawanishiguchiekimae）は個人情報の取扱いについての内容で、コンテンツの利用許諾でも制限でもない。著作権・転載・情報利用・DB化に関する明示禁止は見つからなかった。
- Only the factual existence, the location qualifier and the operator's factual address are stored in our own normalized form. If the operator objects or an information-use restriction appears, hold/re-review and withdraw the source.

## Independent facility-address anchor

- Official address source: 同じ公式ページの住所欄にある「〒920-0031 石川県金沢市広岡3丁目2番37号」。 Map services are not used for coordinates or smoking existence.
- Reproduced locally with `@digital-go-jp/abr-geocoder@2.3.1` on Node 23.3.0, no fuzzy flag, on a copy of the existing 15-ZIP Kanazawa/Nonoichi ABR download whose manifest equals `abr-manifest.sha256` (release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250…`). No release registration, threshold or gate is changed.
- `listing-batch.json` → `abrg-output.json` → `anchor-evaluation.json`: `residential_detail`, **1/1 accepted** by the unchanged `address-anchor-gate.v2`.
- Point `36.580760028, 136.644971769` is the official address's representative point, **not a smoking place, entrance or floor**: one `areaApproximate` spot with `locationArea.scope=facility`.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, 公共データ利用規約 第1.0版, credited in the attribution together with the operator page.

## Pinned release and deployment boundary

CSV SHA-256 `0f3e4ab9eac6ac41dca97482a7c01a768addcaa2dd4269926d58a9cd2f8d0b0d`, one record. Only this pinned reviewed release is approved; a changed page needs review. Cross-release validation false, completeness partial.

Registered through the shared reviewed-facility adapter like KKR (`SOURCE_ADAPTERS`, reviewed fixtures, onboarding pins, `docs/SOURCES.md`, discovery manifest, repository-only source health; review due 2027-02-08). `test/kanazawa-hotel-batch2-sources.test.ts` covers ingest → anchor → tile/detail. No production database, tile, Worker or configuration change.
