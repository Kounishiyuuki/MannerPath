# 天然温泉 加賀の湧泉 ドーミーイン金沢 — reviewed normalized page facts (ADR-0018)

`dormy-inn-kanazawa-page-facts.csv` is MannerPath's **normalized fact sheet**, not an operator dataset. No HTML, expressive prose, photographs, floor plans, maps, screenshots or logos are redistributed. One hotel facility is one approximate spot.

## Official existence and current operation

- First-party source: [ドーミーイン金沢・客室](https://dormy-hotels.com/dormyinn/hotels/kanazawa/rooms/), operated by 株式会社共立メンテナンス.
- Actual HTTP200 fetch `2026-11-08T11:20:09Z`; sizes and whole-page SHA-256 in `fetch-receipts.json` (receipts, not licences). Raw HTML stays outside the repository.
- Normalized existence fact: 公式客室ページが「7F喫煙フロアー/1Ｆに液晶TV付喫煙ブースがございます」と述べる。登録するのは1Fの喫煙ブースだけで、7Fの喫煙フロアーは客室なので登録しない。 The facility's existence alone is not the evidence; the explicit smoking-place statement is.
- Current-operation check: 2026-11-08 (UTC date of the actual fetch). Undated current official page (ADR-0018 D-C). Desk check, not an on-site visit. No closure, relocation or removal found in the reviewed pages.
- Unknown and kept unknown: paper/heated support, smoking-place hours, use by non-guests, room/enclosure type and environment. Hotel and check-in hours are never smoking hours.

## Rights decision — normalized facts only

Engineering `factReference` classification under ADR-0018 D-R, **not legal clearance, an open licence or operator permission**. Registry licence name and URL remain null.

- フッターは「© kyoritsugroup.co.jp All rights reserved.」。ご利用規約（https://dormy-hotels.com/terms/）の対象は共立メンテナンスの「本サービス」。第12条は当社が本サービスを通じて提供する**著作物**の利用を原則として私的使用の範囲に限り、第11条は当社の承諾なく本サービスを通じて（または関連して）営利を目的とした行為を禁じる。事実の参照や情報利用・DB化を明示的に禁止する条項はない。両条項は context として記録し、監視する。
- Only the factual existence, the location qualifier and the operator's factual address are stored in our own normalized form. If the operator objects or an information-use restriction appears, hold/re-review and withdraw the source.

## Independent facility-address anchor

- Official address source: 公式アクセスページ（https://dormy-hotels.com/dormyinn/hotels/kanazawa/access/）の「〒920-0849 石川県 金沢市堀川新町2-25」。ジオコーダには、既存の住所補完規則で県名を付けた「石川県金沢市堀川新町2-25」を入力した。アクセスページの住所は、source health の別スコープとして監視する。 Map services are not used for coordinates or smoking existence.
- Reproduced locally with `@digital-go-jp/abr-geocoder@2.3.1` on Node 23.3.0, no fuzzy flag, on a copy of the existing 15-ZIP Kanazawa/Nonoichi ABR download whose manifest equals `abr-manifest.sha256` (release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250…`). No release registration, threshold or gate is changed.
- `listing-batch.json` → `abrg-output.json` → `anchor-evaluation.json`: `residential_detail`, **1/1 accepted** by the unchanged `address-anchor-gate.v2`.
- Point `36.579348656, 136.650432875` is the official address's representative point, **not a smoking place, entrance or floor**: one `areaApproximate` spot with `locationArea.scope=facility`.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁）, 公共データ利用規約 第1.0版, credited in the attribution together with the operator page.

## Pinned release and deployment boundary

CSV SHA-256 `9703a8b70e8b84d955af6cb01f64a13f54a1ce40908f46011cabbcaac0bca864`, one record. Only this pinned reviewed release is approved; a changed page needs review. Cross-release validation false, completeness partial.

Registered through the shared reviewed-facility adapter like KKR (`SOURCE_ADAPTERS`, reviewed fixtures, onboarding pins, `docs/SOURCES.md`, discovery manifest, repository-only source health; review due 2027-02-08). `test/kanazawa-hotel-batch2-sources.test.ts` covers ingest → anchor → tile/detail. No production database, tile, Worker or configuration change.
