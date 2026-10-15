# v1.0 App Store Release Gate

**SUBMISSION: BLOCKED** — open P0 items remain (table below). Do not press *Submit for Review*, and do not upload a
build for this purpose, while any P0 row is `OPEN`. This page is the single go/no-go checklist; the detailed
evidence stays in the linked documents.

Audited 2026-10-15 against `origin/main` `3af79c7`. Docs-only audit: no submission, upload, build-number change,
production or Cloudflare change. `scripts/test-store-copy.py` (run by `make contract`) keeps this table and the
store copy consistent.

## 1. Release scope (maintainer decision 2026-10-15)

| Decision | v1.0 |
| --- | --- |
| Covered areas | What production publishes at submission. Today: **6 sources / 513 spots** — 東京都 台東区 32, 港区 114, 江東区 3, 武蔵野市 3; 大阪市 344; 京都市 17 ([rights audit](PRODUCTION_CONTENT_RIGHTS_AUDIT.md)). Sources approved in the repository but not deployed (airports etc., `SOURCES.md`) are **not** in v1.0; new production data waits until after release (G19) |
| Everywhere else | Honest empty state (`404 tileNotPublished` → 「この周辺に掲載中の場所はありません」) |
| Price / storefront | Free, Japan only ([entry sheet §9](APP_STORE_CONNECT_ENTRY.md#9-pricing-and-availability)) |
| Reports, App Attest registration, photos | Unavailable (`reports.available:false`) |
| External replies (モクログ, municipalities) | Not waited on; nationwide data work continues after release |
| Copy | Names the covered areas and precision limits; never implies spots can be found anywhere in Japan |

Not claimed anywhere (store, screenshots, notes): nationwide or complete coverage, current permission to smoke,
exact pins for `areaApproximate` places, offline walking routes, reports/photos, accessibility features not
verified on a device, Watch/widget behavior not verified on a device.

## 2. Gate

Status `DONE` needs the evidence named in the row; Simulator/CI evidence never closes a device row.
Lane: 1 docs/compliance, 2 search/UI, 3 build/distribution, 4 data. **User** = needs the maintainer (input,
legal decision, App Store Connect, device). **Ext** = waits on a third party.

| ID | Area | Sev | Status | Current state and evidence | Open work → done when | Lane | User | Ext |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | ASC record fields | P0 | OPEN | Values ready in [entry sheet §2–3](APP_STORE_CONNECT_ENTRY.md) (name, subtitle, categories, URLs); Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | SKU, copyright holder entered in ASC → entry sheet has no MAINTAINER marker left | 1 | yes | no |
| G2 | App Privacy labels | P0 | OPEN | Recommendation from Apple's current definitions plus the 2026-10-15 Cloudflare API/dashboard check ([entry sheet §0.2](APP_STORE_CONNECT_ENTRY.md)): declare Customer Support + Email Address; conservative alternative adds Coarse Location + Other Diagnostic Data. Account Logpush jobs and platform retention unproven | Maintainer chooses recommended or conservative answer and enters it in ASC → answers saved with the release record | 1 | yes | no |
| G3 | Privacy policy | P0 | OPEN | Live policy updated 2026-10-15 (#275): Cloudflare Workers in use, invocation logs off, Workers logs ≤ 7 days; consistent with both G2 options ([entry sheet §0.3](APP_STORE_CONNECT_ENTRY.md)) | Maintainer signs off legal sufficiency after the G2 choice | 1 | yes | no |
| G4 | Terms / EULA | P1 | OPEN | Apple standard EULA recommended ([entry sheet §2](APP_STORE_CONNECT_ENTRY.md)); report terms are draft and unused while reports are off; Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Maintainer confirms standard EULA (or approves a custom one) | 1 | yes | no |
| G5 | Content Rights | P0 | OPEN | Live corpus/licenses/API attribution match (2026-10-05); Taito notice and Watch license link implemented (#193); Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Attribution/license links checked on the signed build (iPhone + Watch); maintainer legal signoff → then answer the rights declaration | 1 | yes | no |
| G6 | Age rating | P0 | OPEN | Answers ready (tobacco references Frequent → expected 18+), [entry sheet §4](APP_STORE_CONNECT_ENTRY.md); Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Maintainer decides minimum-use-age policy; questionnaire entered and calculated rating recorded | 1 | yes | no |
| G7 | Export compliance | P0 | OPEN | Proposed: uses encryption Yes, exempt (OS-only); `ITSAppUsesNonExemptEncryption` absent ([submission §4](APP_STORE_SUBMISSION.md)) | Answered in ASC for the submitted build after the linked-library check | 3 | yes | no |
| G8 | Description, subtitle, keywords | P0 | DONE | Description names the covered areas and partial coverage (this audit); limits and banned claims checked by `test-store-copy.py` | Re-check: area sentence equals §1 production inventory on the day of entry | 1 | no | no |
| G9 | Covered-area explanation outside the store | P1 | OPEN | App: 「掲載範囲は地域によって異なります」 + honest empty state; support page explains unlisted areas but not *which* areas are listed | Support page lists the §1 areas (public-site change, needs approval); in-app list is P2 for Lane 2 | 1 | yes | no |
| G10 | Screenshots iPhone + Watch | P0 | OPEN | None final; fixture captures are not store assets ([entry sheet §6](APP_STORE_CONNECT_ENTRY.md)) | Final-build, production-data captures from a covered area (no synthetic data), Watch set one size; approved by maintainer | 2/3 | yes | no |
| G11 | App Review contact | P0 | OPEN | Not in repo by design; Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Name, phone, email entered in ASC | 1 | yes | no |
| G12 | Review Notes / reviewer steps | P0 | OPEN | Draft with tested destination steps (「浅草駅 東京」) and covered areas ([entry sheet §5](APP_STORE_CONNECT_ENTRY.md)); Japanese entry values: [entry sheet §0](APP_STORE_CONNECT_ENTRY.md#0-v10-最終入力チェック表日本語2026-10-15) | Steps re-run on the submitted build; maintainer approves the text | 1 | yes | no |
| G13 | In-app support / privacy links | P1 | OPEN | Release-simulator navigation to both pages and contact verified (#179) | Links and mail compose checked on a physical device | 3 | yes | no |
| G14 | Signing, App Group, App Attest | P0 | OPEN | Distribution profiles ready; signed 1.0 (3) archive and IPA pass `apple-beta-preflight.sh` and `--distribution` (2026-10-15, #273): all four bundles Apple Distribution, App Group on all four, App Attest production | App Group proven on device (matrix G2/S1–S2, G3/G3b, WG2/S3–S4) on the build to be submitted | 3 | yes | no |
| G15 | Widget / Watch on device | P0 | OPEN | Nothing observed on device ([matrix §4](beta-e2e/device-release-matrix.md)) | Matrix P0 rows W1, W2, W3, W5, W5b and widget rows `PASS 1.0 (N)` on the submitted build | 3 | yes | no |
| G16 | Production API, reports off | P0 | DONE | `GET /v1/config` 2026-10-14T15:47Z: `reports.available:false`, `photoEvidenceEnabled:false`; route gates #185 | Re-run the same read-only GET on submission day | 1 | no | no |
| G17 | First launch, location permission, offline | P0 | OPEN | Simulator UI tests; device rows not observed | Matrix P1, P4, P8/P9b, R1, AI1 `PASS 1.0 (N)` on the submitted build | 3 | yes | no |
| G18 | Accessibility / UI tests | P1 | OPEN | Simulator UI tests incl. visual audit pass (#265); Reduce Motion simulator (#191); VoiceOver/large text not observed on device | Matrix A1, A1W, P17, W9, W10 observed; ASC accessibility answers claim only observed support | 2/3 | yes | no |
| G19 | Published data and quality | P1 | DONE | Maintainer freezes v1 at the existing 6-source corpus; 2026-10-15 public GET scan observes 513 IDs in 81 explicit tiles, source notices match 6/6; local six-source quality checks pass ([Lane 4 evidence](release/V1_DATA_AND_STORE_ASSETS.md)) | Recheck public data before submission; bounded GET evidence is not a global tile inventory or remote D1 audit. New data waits until after release | 4 | yes | no |
| G20 | App Review risk | P1 | OPEN | Guideline 1.4.3 (tobacco), 2.1 (sparse data looks broken), 5.1.1 (privacy) — mitigations in [submission §7](APP_STORE_SUBMISSION.md) | Maintainer accepts residual risk; notes lead with compliance purpose and covered areas | 1 | yes | no |
| G21 | Build to submit | P0 | OPEN | 1.0 (3) from `main` `e7a4654` (#259, #263) uploaded 2026-10-15; App Store Connect processing/compliance pending; device run sheet [matrix §9](beta-e2e/device-release-matrix.md) not run | One build passes G14/G15/G17 and the signed preflight; build number raised by Lane 3 only | 3 | yes | no |
| G22 | In-app covered-area list | P2 | OPEN | Not implemented | Optional covered-area list in the app (Lane 2 decision) | 2 | no | no |

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
