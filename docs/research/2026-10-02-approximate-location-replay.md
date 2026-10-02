# ADR-0017 approximate-location replay (2026-10-02)

Generator `approximate-location-replay.v1` (`npm run replay:approximate`), machine-readable output
`2026-10-02-approximate-location-replay.json`. Read-only over committed research: nothing was fetched, approved,
published or rescued automatically. A target is **A** only when every other gate is already met.

Inputs: the official reverse review (190 discovery targets, `nationwide-discovery/2026-10-01-official-reverse-reviews.json`,
the latest bounded review of each) and 12 older dataset-level reviews not keyed by a target. For the 52 targets with
explicit smoking-place evidence, a hand annotation (in the script, each citing the committed review text) records how
the places are located (inside a named area/host, street address only, an exact publisher point, or not established),
the place count the record states, and whether an anchor exists under anchor policy v1 — a point stated by the **same
publication (release file)** as the existence evidence.

Precedence (strongest current blocker wins): F prohibition/conflict, B existence insufficient, H review pending/access,
C rights, E current operation (closure/suspension/abolition evidence not reconciled per place), G address only, D no
reusable anchor, A. Location eligibility (`adr0017RemovesLocationBlocker`) and current operation are independent axes:
closure evidence keeps a target out of A whatever its location form (review fix P2-2, 2026-10-02).

## Result

| | Count |
|---|---|
| Candidates replayed | 202 |
| Sources rescued now (A) | **0** |
| Targets whose location blocker ADR-0017 removes | 21 |
| Places those records state (potential spots) | 39 (+9 targets without a stated count) |
| Actually onboardable spots today | **0** |
| New prefectures today | **0** |
| Prefectures those targets would add once rights are granted | 11: 北海道, 千葉県, 宮城県, 広島県, 新潟県, 栃木県, 石川県, 福井県, 福岡県, 福島県, 青森県 |

Primary category (the strongest current blocker) vs. the category if reuse rights were granted:

| Category | Now | If rights granted |
|---|---|---|
| A-rescuedByAreaApproximate | 0 | 1 |
| B-existenceInsufficient | 135 | 135 |
| C-rightsBlocked | 46 | 0 |
| D-noReusableAnchor | 0 | 18 |
| E-currentOperation | 0 | 5 |
| F-prohibitionOrConflict | 14 | 14 |
| G-geocodingNeeded | 0 | 7 |
| H-other | 7 | 22 |

Blocker reasons (a target can have several): addressOnly 8, closureEvidencePresent 7, conflictNeedsReconciliation 3, existenceNotExplicit 149, noReusableAnchor 20, prohibition 11, reviewPendingOrAccess 61, rightsUnreviewed 162.

Targets that would stop at E once rights are granted (closure/suspension evidence to reconcile per place):
city-takamatsu, city-yokohama, ward-katsushika, ward-shibuya, ward-shinagawa.

**Reading.** ADR-0017 is not what keeps the explicit official/operator listings out: unreviewed reuse rights are.
Once rights are granted, ADR-0017 turns 仙台市 into a publishable `areaApproximate` source (海岸公園（井土地区）: the
park dataset row itself states smoking among the park's amenities at the park's own point — one record, one release,
so policy v1's same-publication rule holds) and leaves 18 targets needing an anchor from their own publication (a
same-publisher separate dataset such as 新潟市's park GIS needs a future anchor policy v2), 7 address-only
targets needing ADR-0011 (Proposed) and 5 with closure evidence to reconcile first.

## Named cities

| Target | Jurisdiction | Prefecture | Places stated | Now | If rights granted |
|---|---|---|---|---|---|
| city-sendai | 仙台市 | 宮城県 | 1 | C-rightsBlocked | A-rescuedByAreaApproximate |
| city-niigata | 新潟市 | 新潟県 | 2 | C-rightsBlocked | D-noReusableAnchor |
| city-kawasaki | 川崎市 | 神奈川県 | 12 | C-rightsBlocked | G-geocodingNeeded |
| city-chiba | 千葉市 | 千葉県 | 1 | C-rightsBlocked | D-noReusableAnchor |
| city-yokohama | 横浜市 | 神奈川県 | — | C-rightsBlocked | E-currentOperation |

- 仙台市: the reverse review found no smoking inventory, but the east-deep review records the park raw's 海岸公園（井土地区）
  row with smoking among its amenities — explicit existence inside a park at the park's own point (same record, same
  release: a policy v1 anchor). Blocked by unreviewed resource rights.
- 新潟市: 新潟駅南口 and 石宮公園 sites are explicit on the city's page; the park/GIS points (CC BY 2.1 JP) are separate
  publications → D under policy v1. The former station-front site closed 2024-08-05 and stays excluded.
- 川崎市: 12 designated sites by address and relative description; station/building coordinates must not substitute →
  G (ADR-0011), not ADR-0017.
- 千葉市: Kaihin-Makuhari under-track facility; the CC BY 4.0 host-facility CSV is a separate publication with zero
  smoking rows → D.
- 横浜市: new facilities and a closed former station site; the closure must be reconciled per place → E after rights
  (the location form is not established either).

## All location-eligible targets

| Target | Jurisdiction | Prefecture | Places stated | Now | If rights granted |
|---|---|---|---|---|---|
| city-chiba | 千葉市 | 千葉県 | 1 | C-rightsBlocked | D-noReusableAnchor |
| city-fukui | 福井市 | 福井県 | 1 | C-rightsBlocked | D-noReusableAnchor |
| city-fukushima | 福島市 | 福島県 | 2 | C-rightsBlocked | D-noReusableAnchor |
| city-hiroshima | 広島市 | 広島県 | 6 | C-rightsBlocked | D-noReusableAnchor |
| city-kanazawa | 金沢市 | 石川県 | — | C-rightsBlocked | D-noReusableAnchor |
| city-niigata | 新潟市 | 新潟県 | 2 | C-rightsBlocked | D-noReusableAnchor |
| city-sendai | 仙台市 | 宮城県 | 1 | C-rightsBlocked | A-rescuedByAreaApproximate |
| city-utsunomiya | 宇都宮市 | 栃木県 | 1 | C-rightsBlocked | D-noReusableAnchor |
| operator-aomori-airport | 青森空港 | 青森県 | 4 | C-rightsBlocked | D-noReusableAnchor |
| operator-fukuoka-airport | 福岡国際空港株式会社 | 福岡県 | — | F-prohibitionOrConflict | F-prohibitionOrConflict |
| operator-haneda | 日本空港ビルデング（羽田空港） | 東京都 | — | C-rightsBlocked | D-noReusableAnchor |
| operator-hokkaido-airports | 北海道エアポート | 北海道 | — | C-rightsBlocked | D-noReusableAnchor |
| operator-jr-central-building | JR東海ビルディング | — | 2 | C-rightsBlocked | D-noReusableAnchor |
| operator-jr-hokkaido | JR北海道 | 北海道 | 10 | C-rightsBlocked | D-noReusableAnchor |
| operator-jr-kyushu | JR九州 | — | 4 | C-rightsBlocked | D-noReusableAnchor |
| operator-jr-west | JR西日本 | — | — | C-rightsBlocked | D-noReusableAnchor |
| operator-kansai-airports | 関西エアポート | — | — | C-rightsBlocked | D-noReusableAnchor |
| operator-narita | 成田国際空港株式会社 | 千葉県 | — | C-rightsBlocked | D-noReusableAnchor |
| operator-sendai-airport | 仙台国際空港株式会社 | 宮城県 | 5 | F-prohibitionOrConflict | F-prohibitionOrConflict |
| ward-edogawa | 江戸川区 | 東京都 | — | C-rightsBlocked | D-noReusableAnchor |
| ward-nerima | 練馬区 | 東京都 | — | C-rightsBlocked | D-noReusableAnchor |

## Source onboarding

None. No replayed target meets every gate today; the rights review comes first (`docs/SOURCES.md` process). Negative
result recorded so the same scan is not repeated: "not rescued" here means "blocked by another gate", not "no place
exists".
