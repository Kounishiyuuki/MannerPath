# Ishikawa / Kanazawa — re-evaluation under proposed ADR-0018 (2026-10-11)

Baseline origin/main `53b124d`. Inputs: operator review (commit `3c8a44a`, branch `data/ishikawa-operator-coverage`,
not merged), [approximate replay](2026-10-02-approximate-location-replay.md) (`city-kanazawa`: C-rightsBlocked,
E-currentOperation), and fresh searches for 小松駅 / 野々市市 / 白山市. No data stored, no message sent.

Columns: evidence = explicit first-party existence; rights = proposed `rightsStatus`; anchor = best ADR-0018 §2
source available **today**; result "if D-A/D-R/D-C approved" assumes all three are approved and an airport anchor
dataset licence passes review.

| Target | First-party evidence | Rights (proposed) | Precision / scope | Anchor today | Now | If D-A/D-R/D-C approved |
|---|---|---|---|---|---|---|
| 小松空港 ターミナル (4 zones: 国際線2F出発ロビー, 国内線搭乗待合室 ANAラウンジ横, 国際線搭乗待合室, 屋外バス乗り場付近) | Yes — [FAQ q85](https://www.komatsuairport.jp/faq/q85.html) | `factReference` (copyright page: 無断で複製・転用不可; information use not prohibited) | facility (4 zones share one terminal anchor) | None (needs §2 item 3: government airport reference point) | Blocked | **1 spot**, `areaApproximate`/`facility`, detail lists 4 zones; airside zones marked 搭乗者のみ; hours unknown |
| 金沢駅 西口 屋外喫煙所 | Referral on [百番街 館内サービス](https://www.100bangai.co.jp/info/); manager likely 金沢市 | `factReference` (All rights reserved) for the referral; city source C-rightsBlocked | namedZone (西口) | None | Blocked | Still blocked: referral by a neighbouring operator is not the manager's statement; city source needed |
| 金沢駅 東口 屋外喫煙所 (石川県立音楽堂向かい) | Same as above | Same | namedZone | None | Blocked | Same as 西口 |
| 金沢百番街 / あんと (館内) | FAQ 「あんと西1階」 vs 館内サービス 「館外の喫煙所をご利用ください」 | `factReference` | — | — | Blocked (contradiction → withdrawn) | Blocked: contradiction resolves subtractively |
| 金沢フォーラス | None found | `prohibited` (利用規約 第7条) | — | — | Blocked | Blocked |
| 香林坊 (大和 / アトリオ) | None on operator sites | `factReference` / unreviewed | — | — | Blocked | Blocked (no existence) |
| 片町 (きらら) | Site unreachable | unreviewed | — | — | Blocked | Re-check needed |
| 小松駅 | None found (search) | — | — | — | Blocked | Blocked (no existence) |
| 野々市市 | None found (search) | — | — | — | Blocked | Blocked |
| 白山市 (松任駅 ほか) | None found (search) | — | — | — | Blocked | Blocked |

## Result

- **Kanazawa publishable now: 0.** Ishikawa publishable now: 0. Implemented spots/sources: 0.
- Expected delta if D-A, D-R and D-C are approved and an airport anchor dataset passes licence review: **+1 spot**
  (小松空港ターミナル, facility scope, 小松市 — new municipality). The four zones are not four spots (same-anchor
  rule). 金沢市 itself stays 0 until the city source's rights and current operation are resolved.
- The binding constraint for Kanazawa is not precision: the station-exit places are managed by a party whose own
  publication is rights-blocked, and in-building claims are absent or contradictory.
