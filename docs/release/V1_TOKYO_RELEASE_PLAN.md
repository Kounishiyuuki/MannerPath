# v1.0 Tokyo-focused release plan (2026-10-19)

Audit of `origin/main` `d88da06` after the maintainer's 2026-10-19 decision. Docs and local evidence only: no
production D1, Cloudflare, Pages, TestFlight or App Store Connect action was taken, and no device row is closed.
The go/no-go table remains [V1_APP_STORE_RELEASE_GATE.md](../V1_APP_STORE_RELEASE_GATE.md).

## 1. Decision and conflict with the 2026-10-15 scope

| | 2026-10-15 gate (superseded) | 2026-10-19 decision |
| --- | --- | --- |
| v1 data | Freeze at production 6 sources / 513 spots; new data after release (old G19) | Tokyo-focused; non-Tokyo data already published stays; rights-unknown municipalities stay unpublished |
| Data work | Continues after release | New source collection paused; release blockers first |
| 47 prefectures | Not claimed | Still not a release condition and never claimed |

Consequence: the store copy (G8), Review Notes (G12), screenshots (G10), Content Rights (G5) and published data
(G19) were written for the 513-spot corpus and must be re-done for whichever corpus production serves at submission.
Production still serves 513 (2026-10-15 GET evidence); the Tokyo additions are local only.

## 2. Proposed v1.0 data scope (needs maintainer approval; not approved by this document)

Candidate **11 sources / 638 published spots** = production's 6 sources (513) + 5 Tokyo factReference sources (125).
The 8 airport sources and Sendai (9 spots, all outside Tokyo, never in production) are **deferred**: the decision
keeps existing *published* non-Tokyo data, and these were never published.

| Source | Spots | Rights basis | Production | Location precision |
| --- | --- | --- | --- | --- |
| taito-public-smoking-areas | 32 | CC BY (open data) | yes | exact publisher point |
| minato-designated-smoking-areas | 114 | CC BY 4.0 | yes | exact publisher point |
| koto-station-smoking-areas | 3 | CC BY | yes | exact publisher point |
| musashino-public-smoking-areas | 3 | CC BY 4.0 | yes | exact publisher point |
| osaka-designated-smoking-areas | 344 | CC BY 2.1 JP | yes | exact publisher point |
| kyoto-public-smoking-places | 17 | CC BY 4.0 | yes | exact publisher point |
| chiyoda-smoking-places | 30 | factReference (D-R) | no | areaApproximate (ABR address point) |
| chuo-park-smoking-places | 14 | factReference (D-R) | no | areaApproximate |
| chuo-private-smoking-places | 47 | factReference (D-R) | no | areaApproximate |
| shibuya-smoking-places | 30 | factReference (D-R) | no | areaApproximate (ABR address point) |
| toshima-smoking-places | 4 | factReference (D-R) | no | areaApproximate (ABR address point) |

factReference is an engineering classification (ADR-0018), **not legal clearance**: the App Store Content Rights
answer for these 125 spots needs the maintainer's own sign-off (G5). In the 5 Tokyo sources, hours stay `unparsed`
text except an explicit 24-hour statement in the two Chuo sources, which parses as allDay. openNow is never guessed,
and tobacco type is unknown. chuo-private's access type is unknown.

Held, and not in v1: 世田谷区 (an inquiry has been drafted; terms forbid 二次利用), 目黒・文京・大田・中野 (the same class of terms),
新宿区 (personal/non-commercial clause), 荒川区 (terms ambiguous) and 板橋区 (2 places; deferred).

## 3. Station usefulness (local corpus, not production)

[Evidence JSON](v1-tokyo-station-coverage-2026-10-19.json). The measurement used all 20 sources. Every spot within 1 km of these stations is in
the 11-source candidate. Distances are measured from approximate station points, and approximate pins are counted at their address point.

| Station | ≤500 m | of which approx. | ≤1 km | of which approx. | Notes |
| --- | --- | --- | --- | --- | --- |
| 東京 | 7 | 7 | 17 | 17 | 千代田/中央 page facts only |
| 新宿 | 3 | 3 | 6 | 6 | all are 渋谷区 places; **0 新宿区 data** (blocked) |
| 渋谷 | 10 | 10 | 17 | 17 | 8 frontage-only 区設置 places held |
| 池袋 | 4 | 4 | 4 | 4 | 東口/北口 held (frontage only) |
| 上野 | 7 | 0 | 17 | 0 | Taito open data, exact |
| 秋葉原 | 2 | 2 | 20 | 17 | |
| 品川 | 5 | 0 | 11 | 0 | Minato open data, exact |
| 新橋 | 10 | 1 | 29 | 11 | |
| 有楽町 | 4 | 4 | 23 | 19 | |
| 恵比寿 | 0 | 0 | 1 | 1 | 恵比寿駅西口/東口 held (frontage only) |

Weak points to state honestly in the copy and screenshots: 新宿 (no 新宿区 data), 恵比寿, and 池袋 (thin). Near
東京/有楽町/渋谷 most pins are approximate, so the precision label must be visible in those screenshots.

## 4. Production D1 update plan (procedure only; executing it needs separate maintainer authorization)

Local rehearsal (2026-10-19, local files only): the 11-source DB had 640 spots, 638 published and 94 tiles.
- `promotion:v4:build` → `wholeBundleSha256 00cf7ecb…3cb2`, 2 chunks.
- `promotion:v4:verify` → `verified`.
- `apply-local` to a fresh GREEN → `completed`, with GREEN 11 sources / 638 spots / 638 published / 94 tiles and 1 `promotion_v4_completions`.
- `prepare-import` and `verify-import-plan` → `verified`, 4 files.

**Blocker found: spot ID continuity.** Production spot IDs are random ULIDs (e.g. `sp_218ZG8A5YV74SCKXVKKC5ETHD8`
in the 2026-10-15 evidence). The local pipeline issues new IDs on every run. The original production source DB
(`/tmp/mannerpath-production-rc`) no longer exists, so a GREEN rebuilt from fixtures would re-ID all 513 live spots. The
app has no favourites: its caches are keyed per tile and replaced, so the client impact is limited to cached
selection state. Even so, the canonical history changes, and that must be a deliberate choice.

Update (2026-10-19, after the 11-source target was set): the target is option (a), and it is implemented by
`npm run promotion:id-preserving`. The live GREEN is sealed, so the tool rebuilds from the reviewed fixtures,
reuses each live record's spot ID, and refuses anything that would change a live published spot. See the
[runbook](ID_PRESERVING_PROMOTION_RUNBOOK.md), which also lists the read-only export and secret handling.

Steps:
1. Maintainer: take the read-only export and convert it to SQLite locally (runbook). Then run
   `promotion:id-preserving --expect-added 125` on it. Option (b), accepting re-ID'd spots, is no longer needed.
2. Build, verify and apply-local to a fresh local GREEN. Run `local:quality`, `release:data-audit` (local) and an
   independent digest review. Compare per-source counts against §2: 638 published, and the 513 existing rows
   unchanged in content.
3. `prepare-import`, then `verify-import-plan` with independently recorded digests.
4. Remote, by the maintainer only: create a **fresh GREEN** D1, migrate it, then import the initialization files and
   chunks in plan order, then finalize (runbook steps 1–5). Keep BLUE untouched. REPORTS_DB is never touched.
5. Point a staging Worker or readiness check at GREEN. `GET /v1/readiness` must report completed v4 and the smoke checks must pass.
   Then switch the DATA_DB binding (a deploy, maintainer only).
6. Rollback: rebind DATA_DB to BLUE (unchanged) and redeploy. Keep BLUE until the release has been accepted.
7. Re-run the public GET scan (old G19 method), source notices 11/11, and `GET /v1/config` (G16).

## 5. P0 / P1 / P2 for submission

| Sev | Item | Who |
| --- | --- | --- |
| P0 | Approve the §2 data scope, or ship the 513 corpus unchanged (fastest; then the copy can stay) | Maintainer |
| P0 | factReference legal sign-off for 125 Tokyo spots → Content Rights answer (G5) | Maintainer |
| P0 | Production promotion (§4), including the spot-ID decision | Maintainer runs; Claude prepares |
| P0 | Store description, Review Notes and support page updated to the shipped areas (G8/G9/G12) | Claude drafts; maintainer enters |
| P0 | Signed build on device: App Group, widget, Watch, first launch, location, offline (G14/G15/G17/G21) | Maintainer (device) |
| P0 | Final screenshots from production data, including a visibly approximate pin in Tokyo (G10) | Maintainer captures; Claude checks |
| P0 | ASC fields, App Privacy, age rating, export compliance, review contact (G1/G2/G3/G6/G7/G11) | Maintainer (ASC) |
| P1 | Physical-device links/mail, accessibility, review-risk acceptance (G4/G13/G18/G20) | Maintainer |
| P2 | In-app covered-area list (G22); airports/Sendai; 世田谷 and other held wards after replies | Later |

## 6. Shortest order

1. Maintainer: decide the §2 scope and the §4 ID option, and give the G5 sign-off. This unblocks everything else.
2. Claude, **PR 1**: build an ID-preserving promotion input. A local tool or runbook applies reviewed sources onto an
   exported production snapshot. It is tested with a synthetic "production" DB carrying random IDs, so that the
   513 IDs and bytes are unchanged and the 125 rows are added.
3. Claude, **PR 2**: store copy, Review Notes and support-page text for the chosen scope. Update
   `scripts/test-store-copy.py` AREAS to the shipped areas. The text says 東京都の一部 and names the wards, and says
   目安位置 for approximate pins. Pages publication stays the maintainer's.
4. Maintainer: production promotion (§4 steps 4–7), then the RC build, the device matrix §9 run sheet and screenshots.
5. Claude, **PR 3**: record the device/ASC/production evidence in the gate and close the rows that have evidence.
6. Maintainer: ASC entry, then Add for Review → Submit, with manual release.

If the maintainer prefers the fastest path, ship the 513 corpus: skip PR 1 and the promotion. The current copy
and Content Rights audit then remain valid, and the Tokyo additions become version 1.1.

## 7. Draft covered-area sentence (for PR 2; not entered anywhere)

```text
現在の掲載地域は、東京都の一部（千代田区、中央区、港区、台東区、渋谷区、豊島区、江東区、武蔵野市）、大阪市、京都市です。自治体が公開する情報をもとに、利用条件を確認できた場所のみを掲載しており、すべての喫煙場所を網羅するものではありません。住所から求めた目安の位置は「目安」と表示し、正確な喫煙場所の位置とは区別します。
```

The Review Notes sentence "places listed in published municipal open data" is no longer true for the 5
factReference sources. It becomes "places published by municipalities (open data and official web pages)".
