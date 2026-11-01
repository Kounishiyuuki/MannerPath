# v1.0 App Store Release Gate

**SUBMISSION: BLOCKED** — P0は実装・実機E2E・運営者承認・ASC反映の証拠が揃うまでOPEN。

**2026-11-02仕様変更（main `1fdf89a`基準）**：v1.0は写真なしの新規喫煙場所申請を提供する。
写真添付は提供せず、v1.1以降の計画。以前の申請全面停止/写真必須P0を上書きする。
申請の自動掲載はなく、審査・source/rights/位置/品質ゲートは維持する。
[現在の提出素材・実装差分・実機手順](release/submission-v1/text-reports/README.md)が現行スコープ。
mainのiPhone写真必須判定とreview/exportの写真制約はまだ残っており、文書更新で動作済みとは扱わない。
公開Web・ASC・本番API・iOSコードはこのPRで変更しない。

過去の写真有効版監査（2026-10-15〜11-01）とD1/暗号PoCの検討は
[写真v1.1索引](release/submission-v1/PHOTO_V1_1_README.md)に保持する。
#357/#358/#360はソース統合済みだが通常申請へ未組込・本番未有効化。
写真の実環境検証/写真条項はv1.0の提出条件から除き、実施済みと認定しない。

## 1. Release scope (2026-11-02: reports on, photos unavailable)

| Decision | v1.0 |
| --- | --- |
| Covered areas | Current production only; **no data additions until separately approved** (2026-10-24 instruction supersedes the earlier expansion choice). Last bounded observation: **6 sources / 513 spots** — 東京都 台東区 32, 港区 114, 江東区 3, 武蔵野市 3; 大阪市 344; 京都市 17 ([data evidence](release/V1_DATA_AND_STORE_ASSETS.md)). Not a new/current global inventory. The 638 candidate, airports and Sendai are not assumed live; recheck approved deployment inventory and public evidence before entry/capture |
| Everywhere else | Honest empty state (`404 tileNotPublished` → 「この周辺に掲載中の場所はありません」) |
| Price / storefront | Free, Japan only ([entry sheet §9](APP_STORE_CONNECT_ENTRY.md#9-pricing-and-availability)) |
| Reports, App Attest registration, photos | v1.0は**写真なし新規地点申請あり**。写真の選択/upload/retryは提供しない。実装・規約・App Attest・審査ゲートとruntime照合はOPEN。写真はv1.1以降 |
| External replies (モクログ, municipalities) | Not waited on (世田谷区 inquiry drafted, not sent). New source collection is paused until release; 47-prefecture coverage is not a release condition |
| Copy | Names the covered areas and precision limits; never implies spots can be found anywhere in Japan |

Not claimed anywhere (store, screenshots, notes): nationwide or complete coverage, current permission to smoke,
exact pins for `areaApproximate` places, offline walking routes, unactivated reports/photos, accessibility features not
verified on a device, Watch/widget behavior not verified on a device. 写真なし申請の利用可能表現は実装・規約・runtime/実機が一致した後のみ。写真はv1.0で提供すると記載しない。

## 2. Gate

Status `DONE` needs the evidence named in the row; Simulator/CI evidence never closes a device row.
The Lane numbers below are historical ownership labels, not current assignments. Current handoff: Lane 1 iPhone UI,
Lane 3 report backend/activation preparation, Lane 4 this document-only release audit. **User** = needs the maintainer (input,
legal decision, App Store Connect, device). **Ext** = waits on a third party.

| ID | Area | Sev | Status | Current state and evidence | Open work → done when | Lane | User | Ext |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | ASC record fields | P0 | OPEN | Values ready in [entry sheet §2–3](APP_STORE_CONNECT_ENTRY.md) (name, subtitle, categories, URLs); Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | SKU, copyright holder entered in ASC → entry sheet has no MAINTAINER marker left | 1 | yes | no |
| G2 | App Privacy labels | P0 | OPEN | 写真なし申請の[Privacy候補](release/submission-v1/text-reports/app-privacy-candidate.json)。写真型除外はsupport/providerを含む非収集の確認条件付き。本文/pin/端末IDはCollected/Linked案 | 運営者が実RCの収集・関連付け・目的・ログ/保持を承認し、manifest/Privacy Report/policy/ASCを一致させる | 1 | yes | no |
| G3 | Privacy policy | P0 | OPEN | 現公開policyは申請停止時の記述を含む。写真なし申請の保持/削除/再install候補は[現行素材](release/submission-v1/text-reports/README.md) | 通常申請の保存・最小化/Time Travel・認証登録・supportの保持を運営者/法務が確定し公開policyとRCを一致。公開Webは別作業 | 1 | yes | no |
| G4 | Terms / EULA | P1 | OPEN | 標準EULA推奨。#124通常申請規約は未承認。写真条項はv1.1以降 | 運営者がEULAを決定。通常申請の同意・再利用規約はG23で承認 | 1 | yes | no |
| G5 | Content Rights | P0 | OPEN | Live 6-source corpus/licenses/API attribution match (2026-10-05); Taito notice and Watch license link implemented (#193). The 5 proposed Tokyo sources are factReference (ADR-0018 D-R): an engineering classification, not legal clearance, and not covered by the 2026-10-05 audit | Attribution/license links checked on the signed build (iPhone + Watch); maintainer legal signoff for the shipped corpus, **including factReference sources if they ship** → then answer the rights declaration | 1 | yes | no |
| G6 | Age rating | P0 | OPEN | 申請は写真なしでもUGCを含む。過去のreports-off UGC=No案は使用不可 | 運営者が現質問票のUGC/たばこ/最低利用年齢を決定しApple算出ratingを記録 | 1 | yes | no |
| G7 | Export compliance | P0 | OPEN | Proposed: uses encryption Yes, exempt (OS-only); `ITSAppUsesNonExemptEncryption` absent ([submission §4](APP_STORE_SUBMISSION.md)) | Answered in ASC for the submitted build after the linked-library check | 3 | yes | no |
| G8 | Description, subtitle, keywords | P0 | OPEN | 写真なし申請ありの[説明全文](release/submission-v1/text-reports/description-ja.txt)を準備。地域文は履歴由来で当日照合待ち | 当日の承認済み公開範囲と実RCの写真なし申請能力が文面と一致し、運営者が承認 | 1 | yes | no |
| G9 | Covered-area explanation outside the store | P1 | OPEN | App: 「掲載範囲は地域によって異なります」 + honest empty state; support page explains unlisted areas but not *which* areas are listed. Draft listing the areas: [V1_TOKYO_STORE_COPY.md](release/V1_TOKYO_STORE_COPY.md) §4, not published | Support page lists the §1 areas (public-site change, needs approval); in-app list is P2 for Lane 2 | 1 | yes | no |
| G10 | Screenshots iPhone + Watch | P0 | OPEN | None final; fixture captures are not store assets ([entry sheet §6](APP_STORE_CONNECT_ENTRY.md)). The entry sheet's "zero areaApproximate" note holds only for the 513 corpus | Final-build, production-data captures from a covered area (no synthetic data), Watch set one size; if Tokyo factReference sources ship, a captured approximate pin shows its 目安 label; approved by maintainer | 2/3 | yes | no |
| G11 | App Review contact | P0 | OPEN | Not in repo by design; Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Name, phone, email entered in ASC | 1 | yes | no |
| G12 | Review Notes / reviewer steps | P0 | OPEN | 写真なし申請の[Review Notes](release/submission-v1/text-reports/review-notes.txt)とWatch/Widget手順を準備 | 提出RCで位置/重複/条件/規約/実App Attest受付・再送を再実行。写真UIなし、公開は審査後。運営者承認 | 1 | yes | no |
| G13 | In-app support / privacy links | P1 | OPEN | Release-simulator navigation to both pages and contact verified (#179) | Links and mail compose checked on a physical device | 3 | yes | no |
| G14 | Signing, App Group, App Attest | P0 | OPEN | 過去1.0(3)署名preflightは履歴。最終RCのApp Group/実App Attestは未検証 | 最終署名preflightとiPhone/Watch/Widget共有、写真なし実申請のApp Attestを証明 | 3 | yes | no |
| G15 | Widget / Watch on device | P0 | OPEN | No Watch/widget device PASS recorded ([matrix §4](beta-e2e/device-release-matrix.md)) | Matrix P0 rows W1, W2, W3, W5, W5b and widget rows `PASS 1.0 (N)` on the submitted build | 3 | yes | no |
| G16 | Production runtime and intake truth | P0 | OPEN | 以前の公開config観測は履歴。現mainには新規申請の写真依存が残る。写真なしruntime未確認 | 別途許可された担当がreports available・写真無効を当日確認。通常規約/RC/実受付と一致。今回有効化しない | 1 | yes | no |
| G17 | First launch, location permission, offline | P0 | OPEN | 初回/位置/オフラインと写真なし新規申請の最終RC実機証拠なし | matrix P1/P4/P8/P9b/AI1と写真なし受付・同一reportの再送/再起動をPASS。旧R1は停止時の負例のみ | 3 | yes | no |
| G18 | Accessibility / UI tests | P1 | OPEN | Simulator UI tests incl. visual audit pass (#265); Reduce Motion simulator (#191); VoiceOver/large text not observed on device | Matrix A1, A1W, P17, W9, W10 observed; ASC accessibility answers claim only observed support | 2/3 | yes | no |
| G19 | Published data and quality | P0 | OPEN | Historical bounded scan: 513 IDs / 81 tiles, 6/6 source notices; not a global index or fresh observation. Local 638 rehearsal is not production evidence | Data owner rechecks existing approved production scope with separately authorized public GET audit + deployment inventory; copy/rights/captures agree. No source/data addition, rebuild, re-ID or promotion without separate approval | 4 | yes | no |
| G20 | App Review risk | P1 | OPEN | Guideline 1.4.3 (tobacco), 2.1 (sparse data looks broken), 5.1.1 (privacy) — mitigations in [submission §7](APP_STORE_SUBMISSION.md) | Maintainer accepts residual risk; notes lead with compliance purpose and covered areas | 1 | yes | no |
| G21 | Build to submit | P0 | OPEN | `main` declares 1.0 build 7 (#348). #349 records TestFlight 1.0 (7) device feedback, followed by UI changes not proven present in that binary. Final RC archive/hash, processing, signed preflight and complete device matrix remain unverified; see [audit §1](release/V1_APP_STORE_GATE_AUDIT_2026-10-31.md#1-testflight-10-7の証拠) | One build passes G14/G15/G17 and the signed preflight; build number raised by Lane 3 only | 3 | yes | no |
| G22 | In-app covered-area list | P2 | OPEN | Not implemented | Optional covered-area list in the app (Lane 2 decision) | 2 | no | no |
| G23 | Text-only new-place report terms and review (#124) | P0 | OPEN | 通常申請の規約・権利と写真なし審査/export実装が未完了。写真条項/消去暗号はv1.1以降の別条件 | #124の通常申請規約を新versionで運営者承認、client/server同意一致。Lane1の写真不要UI、Lane3のreview/export/DB制約と証拠審査を整合。実機E2E後に閉じる | 1 | yes | no |

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
