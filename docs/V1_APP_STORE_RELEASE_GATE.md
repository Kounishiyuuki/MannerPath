# v1.0 App Store Release Gate

**SUBMISSION: BLOCKED** — open P0 items remain (table below). Do not press *Submit for Review*, and do not upload a
build for this purpose, while any P0 row is `OPEN`. This page is the single go/no-go checklist; the detailed
evidence stays in the linked documents.

Audited 2026-10-15 against `origin/main` `3af79c7`; re-audited 2026-10-19 against `d88da06` for the Tokyo-focused
scope ([Tokyo release plan](release/V1_TOKYO_RELEASE_PLAN.md)). Docs-only audit: no submission, upload, build-number change,
production or Cloudflare change. `scripts/test-store-copy.py` (run by `make contract`) keeps this table and the
store copy consistent.

**2026-10-24 reconciliation (`origin/main` `eb4ed96`):** [final-assets packet](release/V1_APPSTORE_FINAL_ASSETS.md)
adds the submission-day/capture checklist. New data additions require separate approval; use only the
current production scope. No production API or ASC access occurred. Dated observations below remain
historical; no final RC/device/legal gate is closed. Photo scope remains P0 and requires an enabled,
approved-policy client as well as runtime activation; disabled copy is not a waiver.

**2026-10-31 Lane 4 re-audit (`origin/main` `112b919`):** submission remains blocked.
[Current audit and operator sequence](release/V1_APP_STORE_GATE_AUDIT_2026-10-31.md) reconciles TestFlight
1.0 (7) feedback, photos-enabled privacy answers and remaining physical-device evidence. Build 7 feedback
is not a matrix PASS; current main includes later UI changes. No ASC or production API access occurred.

**提出素材の実装（2026-10-31）**：[転記用素材と実機実行シート](release/submission-v1/README.md)
に説明/Review Notes全文、Privacy回答とmanifest候補、iPhone16Pro/Watch/Widgetの操作・期待・証拠を用意。
G2/G8/G10/G12の準備作業は完了したが、運営者承認/当日scope/署名RC/実環境証拠がないためP0はOPENを維持。

**D1/暗号化案の未決事項（2026-10-31）**：[方式別Privacy評価](release/submission-v1/D1_PHOTO_PRIVACY.md)
と日英policy/support候補を追加。初回監査時のmain `1e2d009`ではD1/暗号化PoCは未統合。
2026-11-01再照合：main `d3508d5`へ#357・#358・#360のPoCソースは統合済み。
通常の申請経路は未承認R2構成のまま。PoC統合を方式採用・本番有効化・消去検証済みとは扱わない。
G2/G3/G7/G16/G23はOPEN。Time Travel、全鍵copy、本文/pinの履歴、再install本人確認を含む
最終方式・期限・restore検証をLane 3/運営者が確定するまで、90日の物理消去/E2EE/削除ボタンを約束しない。

## 1. Release scope (2026-10-24 scope freeze; photo P0 decision retained)

| Decision | v1.0 |
| --- | --- |
| Covered areas | Current production only; **no data additions until separately approved** (2026-10-24 instruction supersedes the earlier expansion choice). Last bounded observation: **6 sources / 513 spots** — 東京都 台東区 32, 港区 114, 江東区 3, 武蔵野市 3; 大阪市 344; 京都市 17 ([data evidence](release/V1_DATA_AND_STORE_ASSETS.md)). Not a new/current global inventory. The 638 candidate, airports and Sendai are not assumed live; recheck approved deployment inventory and public evidence before entry/capture |
| Everywhere else | Honest empty state (`404 tileNotPublished` → 「この周辺に掲載中の場所はありません」) |
| Price / storefront | Free, Japan only ([entry sheet §9](APP_STORE_CONNECT_ENTRY.md#9-pricing-and-availability)) |
| Reports, App Attest registration, photos | **P0 since 2026-10-22** ([plan](release/V1_PHOTO_PLACE_SUBMISSION.md)): photo-backed new-place submission must work on the Release build. Production stays `reports.available:false` until that plan's gates (incl. #124 terms) are met and the maintainer activates it |
| External replies (モクログ, municipalities) | Not waited on (世田谷区 inquiry drafted, not sent). New source collection is paused until release; 47-prefecture coverage is not a release condition |
| Copy | Names the covered areas and precision limits; never implies spots can be found anywhere in Japan |

Not claimed anywhere (store, screenshots, notes): nationwide or complete coverage, current permission to smoke,
exact pins for `areaApproximate` places, offline walking routes, unactivated reports/photos, accessibility features not
verified on a device, Watch/widget behavior not verified on a device. Reports/photos can be described as
available only after verified activation and the photo P0 gates; never use enabled wording from a plan alone.

## 2. Gate

Status `DONE` needs the evidence named in the row; Simulator/CI evidence never closes a device row.
The Lane numbers below are historical ownership labels, not current assignments. Current handoff: Lane 1 iPhone UI,
Lane 3 photo backend/activation preparation, Lane 4 this document-only release audit. **User** = needs the maintainer (input,
legal decision, App Store Connect, device). **Ext** = waits on a third party.

| ID | Area | Sev | Status | Current state and evidence | Open work → done when | Lane | User | Ext |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | ASC record fields | P0 | OPEN | Values ready in [entry sheet §2–3](APP_STORE_CONNECT_ENTRY.md) (name, subtitle, categories, URLs); Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | SKU, copyright holder entered in ASC → entry sheet has no MAINTAINER marker left | 1 | yes | no |
| G2 | App Privacy labels | P0 | OPEN | Entry §0.2 covers the historically disabled composition only. Enabled reports/photos need [photo decision pack §3](legal/PHOTO_LEGAL_DECISION_PACK.md) and [data-flow review](legal/PHOTO_PRIVACY_REVIEW.md); provider retention remains unresolved | Maintainer approves labels for actual RC/runtime. If photos ship on (pack M1), add Photos or Videos + Other User Content + Device ID, all linked; include Precise Location for the explicitly selected current-location pin (#349; inventory audit 2026-10-30). Policy/manifest agree, ASC answers saved | 1 | yes | no |
| G3 | Privacy policy | P0 | OPEN | Live policy updated 2026-10-15 (#275): Cloudflare Workers in use, invocation logs off, Workers logs ≤ 7 days; consistent with both G2 options ([entry sheet §0.3](APP_STORE_CONNECT_ENTRY.md)) | Maintainer signs off legal sufficiency after the G2 choice. If photos ship on, §5 must be replaced with the photo text in the same release ([pack §4](legal/PHOTO_LEGAL_DECISION_PACK.md)) | 1 | yes | no |
| G4 | Terms / EULA | P1 | OPEN | Apple standard EULA recommended ([entry sheet §2](APP_STORE_CONNECT_ENTRY.md)); report + photo terms remain unapproved (#124); Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Maintainer confirms standard EULA (or approves a custom one) | 1 | yes | no |
| G5 | Content Rights | P0 | OPEN | Live 6-source corpus/licenses/API attribution match (2026-10-05); Taito notice and Watch license link implemented (#193). The 5 proposed Tokyo sources are factReference (ADR-0018 D-R): an engineering classification, not legal clearance, and not covered by the 2026-10-05 audit | Attribution/license links checked on the signed build (iPhone + Watch); maintainer legal signoff for the shipped corpus, **including factReference sources if they ship** → then answer the rights declaration | 1 | yes | no |
| G6 | Age rating | P0 | OPEN | Tobacco Frequent recommendation; older UGC=No draft assumes reports disabled. Photo-enabled proposals require reassessment against current questionnaire | Maintainer decides minimum-use-age/UGC answers for actual flow; questionnaire entered and Apple-calculated rating recorded | 1 | yes | no |
| G7 | Export compliance | P0 | OPEN | Proposed: uses encryption Yes, exempt (OS-only); `ITSAppUsesNonExemptEncryption` absent ([submission §4](APP_STORE_SUBMISSION.md)) | Answered in ASC for the submitted build after the linked-library check | 3 | yes | no |
| G8 | Description, subtitle, keywords | P0 | OPEN | Description names historically observed 6-source areas and partial coverage; limits/banned claims checked by `test-store-copy.py`. No fresh production observation. The 638 candidate remains not for entry; enabled/disabled photo wording is separated in the final-assets packet | Authorized entry-day scope evidence, area sentence/`AREAS`, and actual RC photo capability all agree; maintainer approves final copy | 1 | yes | no |
| G9 | Covered-area explanation outside the store | P1 | OPEN | App: 「掲載範囲は地域によって異なります」 + honest empty state; support page explains unlisted areas but not *which* areas are listed. Draft listing the areas: [V1_TOKYO_STORE_COPY.md](release/V1_TOKYO_STORE_COPY.md) §4, not published | Support page lists the §1 areas (public-site change, needs approval); in-app list is P2 for Lane 2 | 1 | yes | no |
| G10 | Screenshots iPhone + Watch | P0 | OPEN | None final; fixture captures are not store assets ([entry sheet §6](APP_STORE_CONNECT_ENTRY.md)). The entry sheet's "zero areaApproximate" note holds only for the 513 corpus | Final-build, production-data captures from a covered area (no synthetic data), Watch set one size; if Tokyo factReference sources ship, a captured approximate pin shows its 目安 label; approved by maintainer | 2/3 | yes | no |
| G11 | App Review contact | P0 | OPEN | Not in repo by design; Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Name, phone, email entered in ASC | 1 | yes | no |
| G12 | Review Notes / reviewer steps | P0 | OPEN | Draft with tested destination steps (「浅草駅 東京」) and covered areas ([entry sheet §5](APP_STORE_CONNECT_ENTRY.md)). 2026-10-19: the source sentence no longer says "published municipal open data". The 638 candidate notes are in [V1_TOKYO_STORE_COPY.md](release/V1_TOKYO_STORE_COPY.md) §3, and the Tokyo rights questions are in [V1_TOKYO_RIGHTS_REVIEW.md](release/V1_TOKYO_RIGHTS_REVIEW.md) | Text matches the shipped corpus; steps re-run on the submitted build; maintainer approves the text | 1 | yes | no |
| G13 | In-app support / privacy links | P1 | OPEN | Release-simulator navigation to both pages and contact verified (#179) | Links and mail compose checked on a physical device | 3 | yes | no |
| G14 | Signing, App Group, App Attest | P0 | OPEN | Distribution profiles ready; signed 1.0 (3) archive and IPA pass `apple-beta-preflight.sh` and `--distribution` (2026-10-15, #273): all four bundles Apple Distribution, App Group on all four, App Attest production | App Group proven on device (matrix G2/S1–S2, G3/G3b, WG2/S3–S4) on the build to be submitted | 3 | yes | no |
| G15 | Widget / Watch on device | P0 | OPEN | No Watch/widget device PASS recorded ([matrix §4](beta-e2e/device-release-matrix.md)) | Matrix P0 rows W1, W2, W3, W5, W5b and widget rows `PASS 1.0 (N)` on the submitted build | 3 | yes | no |
| G16 | Production runtime and intake truth | P0 | OPEN | Historical `GET /v1/config` 2026-10-14T15:47Z: reports/photos false. No API request in this reconciliation. Disabled intake is safe but does not complete the photo P0 | Separately authorized operator records submission-day runtime/config and actual RC flow evidence; copy/privacy/terms match. Activation requires its own approval; do not enable from this lane | 1 | yes | no |
| G17 | First launch, location permission, offline | P0 | OPEN | Simulator UI tests; build 7 feedback records usability issues, not first-launch/permission/offline matrix PASS | Matrix P1, P4, P8/P9b, AI1 plus the photo-enabled actual RC intake/recovery run `PASS 1.0 (N)`; historical R1 reports-off is only a negative-case check | 3 | yes | no |
| G18 | Accessibility / UI tests | P1 | OPEN | Simulator UI tests incl. visual audit pass (#265); Reduce Motion simulator (#191); VoiceOver/large text not observed on device | Matrix A1, A1W, P17, W9, W10 observed; ASC accessibility answers claim only observed support | 2/3 | yes | no |
| G19 | Published data and quality | P0 | OPEN | Historical bounded scan: 513 IDs / 81 tiles, 6/6 source notices; not a global index or fresh observation. Local 638 rehearsal is not production evidence | Data owner rechecks existing approved production scope with separately authorized public GET audit + deployment inventory; copy/rights/captures agree. No source/data addition, rebuild, re-ID or promotion without separate approval | 4 | yes | no |
| G20 | App Review risk | P1 | OPEN | Guideline 1.4.3 (tobacco), 2.1 (sparse data looks broken), 5.1.1 (privacy) — mitigations in [submission §7](APP_STORE_SUBMISSION.md) | Maintainer accepts residual risk; notes lead with compliance purpose and covered areas | 1 | yes | no |
| G21 | Build to submit | P0 | OPEN | `main` declares 1.0 build 7 (#348). #349 records TestFlight 1.0 (7) device feedback, followed by UI changes not proven present in that binary. Final RC archive/hash, processing, signed preflight and complete device matrix remain unverified; see [audit §1](release/V1_APP_STORE_GATE_AUDIT_2026-10-31.md#1-testflight-10-7の証拠) | One build passes G14/G15/G17 and the signed preflight; build number raised by Lane 3 only | 3 | yes | no |
| G22 | In-app covered-area list | P2 | OPEN | Not implemented | Optional covered-area list in the app (Lane 2 decision) | 2 | no | no |
| G23 | Photo submission terms and privacy (#124, v1.0 P7) | P0 | OPEN | Candidate terms, implementation consistency, App Privacy answer and activation steps in [photo decision pack](legal/PHOTO_LEGAL_DECISION_PACK.md); `REVIEWED_PHOTO_TERMS` empty, photos off | Maintainer records pack §1 steps 1–8 (counsel advised for L1–L4); then the §7 activation PRs, staging E2E and device run | 1 | yes | no |

P0 = blocks submission. P1 = must be closed or explicitly accepted by the maintainer before submission.
P2 = after release.

## 3. Submission rule

1. All P0 rows `DONE`; every P1 row `DONE` or recorded as accepted by the maintainer.
2. G8 and G16 re-checks run on the day of entry.
3. Only then: Add for Review → Submit (maintainer, manual release). Nothing in this repository performs it.

## 4. Lane 4 data and capture preparation (2026-10-15)

[Production observation and screenshot runbook](release/V1_DATA_AND_STORE_ASSETS.md) separates
public GET evidence from local fixture counts, freezes the existing corpus for v1, and records
current image sizes, privacy/rights checks and the Watch destination-sync limitation.
G5/G10 remain OPEN: no final RC images, signed-device attribution approval or Watch PASS is declared.
PR #263/#273 being merged is not a processed-build/device result. Other lane/device rows stay unchanged.
