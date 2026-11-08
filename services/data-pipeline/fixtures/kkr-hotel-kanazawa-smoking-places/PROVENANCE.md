# KKRホテル金沢 — reviewed normalized page facts (ADR-0018)

`kkr-hotel-kanazawa-page-facts.csv` is MannerPath's normalized fact sheet, **not a publisher dataset**. No HTML, expressive prose, photograph, map, floor plan or logo is redistributed.

## Existence and current operation

- First-party operator page: https://kanazawa.kkr.or.jp/facilities/ (館内施設). Operator: 国家公務員共済組合連合会 (KKR).
- HTTP 200, fetched `2026-11-08T04:28:47Z`, 126,065 bytes, whole-page SHA-256 `7717c9ba2b2e4613f131347f0c9f0be67f94ff6204ad743916e15454f8cdeec8`. Raw HTML stays outside the repository.
- Smoking fact (normalized): 喫煙所, 1Fロビー入口側・3Fエレベーター側. Two rooms in one facility are **one** facility spot, not two exact pins.
- The top page (https://kanazawa.kkr.or.jp/) shows no closure or suspension notice (read 2026-11-08). Desk check of the current official page (D-C), **not an on-site verification**.
- Unknown: paper/heated support, smoking hours, whether non-guests may use it, indoor/outdoor. Canonical fields stay `unknown`. Hotel hours are not smoking hours.

## Rights reading — engineering classification

- Page footer: `© 国家公務員共済組合連合会 All Rights Reserved.`. The hotel site links only to プライバシーポリシー (no content-use condition found) and 特定商取引法.
- The operator's site-use terms (https://www.kkr.or.jp/siteriyo.html, 3.著作権について, read 2026-11-08) allow 引用・転載・複製 with 出所の明示. They ask for contact before **commercial 複製**, and state they do not apply to sites linked from that homepage. Whether they cover kanazawa.kkr.or.jp is not stated.
- MannerPath copies none of the site's expression. It stores normalized facts only (a smoking room exists on 1F/3F; the address), credited to the page. Classified `factReference` under ADR-0018 D-R. This is not an open licence or operator permission. The maintainer decides whether to contact 広報課 anyway (no message has been sent).
- No Google/Apple map, embedded map or third-party listing is used.
- An operator objection or a contrary smoking restriction requires withdrawal/review under the existing hold procedure.

## Independent facility anchor

- Official address: `石川県金沢市大手町2-32` (stated on the existence page's footer and on the top page).
- abr-geocoder 2.3.1, no fuzzy, run locally on 2026-11-08 (Node 23.3.0) over the registered release `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250…014d`. Result: output `石川県金沢市大手町2-32`, match and coordinate level `residential_detail`, score 1, no remainder, lg_code 172014. It is accepted by `address-anchor-gate.v3` under the unchanged residential rules.
- Representative point `36.568729789, 136.660338131`. This is **one** `areaApproximate` / `locationArea.scope=facility` spot: the address's point, not the smoking room, lobby or entrance.
- Anchor rights: アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）. The adapter checks at load time that its attribution carries the credit the anchor level requires (`requiredAttributionForReference`).

## Release and deployment boundary

CSV SHA-256 `a98489eaf55f133b45b8e62746bbd9b66a883fd6055c22b846714eba8d67a38a`, one pinned row. Repository review covers only this pinned local pipeline release. **No production promotion, database or tile write.**
