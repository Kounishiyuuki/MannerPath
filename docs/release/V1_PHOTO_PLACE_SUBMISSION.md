# v1.0 P0 — Photo-backed new place submission

Status: **Plan (PR 1 of the series below).** Product decision 2026-10-22: proposing a new smoking place with
photos is a v1.0 P0 feature, not deferred to v1.1. This document makes that decision executable: requirements,
UI specification, the audited gap list, the PR breakdown and the verification that closes each gate.

This decision changes **product scope only**. It grants no legal approval (Issue #124), enables no production
intake and changes no Cloudflare, D1, R2 or API configuration. ADR-0007/0013/0014/0016/0021 stay authoritative;
where a step below needs one of them amended, that PR amends it.

## 1. Goal and non-goals

Goal: a user on the v1.0 Release build taps an always-visible 「＋ 喫煙所を追加する」 button, pins a place, attaches
1–3 photos, describes it (unknown stays unknown), accepts the terms, and sends it. A moderator reviews the report
and its private photos, approves, holds or rejects it, and only approved information reaches the public map
through the existing community publication pipeline and gates.

Non-goals (unchanged rules):

- A submission never publishes itself. No auto-acceptance (ADR-0013 §12).
- A photo never proves that smoking is permitted, never raises existence confidence by itself, never supplies
  coordinates (ADR-0016). An ashtray in a photo is not permission to smoke.
- Photos, submitter identifiers and moderator notes never enter `DB`, promotion bundles, community artifacts or
  tiles (ADR-0014, ADR-0016).
- No public photo retrieval and no photo display in the app's public UI.

## 2. Release requirements (all must hold for v1.0)

| ID | Requirement | Owner of the decision |
| --- | --- | --- |
| R1 | Standalone report button on the map screen, coexisting with search and the Nearby sheet (§3.1) | Code |
| R2 | Empty-state invitation with the approved copy and entry point (§3.2) | Code |
| R3 | Seven-step flow: pin → duplicate check → 1–3 photos → claim → consent → send → received/pending (§3.3) | Code |
| R4 | Attested photo upload from iPhone (real `EvidencePhotoUploading` adapter, App Attest bound) | Code |
| R5 | Production photo storage adapter: private, fenced delete, expiry at `minimize_after`, backup/version cleanup, failure recovery (ADR-0016 "Storage and lifecycle") | Code + maintainer (bucket creation) |
| R6 | Metadata removal (EXIF/GPS/device/time) — already server-side (ADR-0016); verified on device photos | Code (verify) |
| R7 | Privacy care for faces/plates: picker reminder, reviewer rejection reason, no automatic redaction claim | Code + moderation policy |
| R8 | App Attest required, per-key application limits, edge IP rate-limit rule, bounded photo bytes per key | Code + maintainer (edge rule) |
| R9 | Terms covering photo processing, rights and publication of derived facts; explicit consent per version | **Maintainer/legal (#124)** |
| R10 | App Privacy answers and privacy policy updated for photos (User Content → Photos: collected, **linked** — the photo reaches a device-key-derived submitter hash through its report for 90 days — not tracking; [decision pack §3](../legal/PHOTO_LEGAL_DECISION_PACK.md)) | **Maintainer** (+ doc PR) |
| R11 | Moderator can view private photos, decide approve / hold / reject for report and photos, review duplicates, location precision and conditions | Code |
| R12 | Approved facts only go through existing activation, quality and promotion gates (`COMMUNITY_LAUNCH_CHECKLIST.md`) | Existing process |
| R13 | E2E: intake → moderation → export/import → pipeline → promotion → tile, on staging | Code + maintainer (staging) |
| R14 | Physical-device Release build: photo selection, upload, retry, received state | Maintainer device run |

## 3. UI specification (iPhone)

### 3.1 Standalone map button

- `.medium` (and whenever the map is visible): a floating, labelled button 「＋ 喫煙所を追加する」 (SF Symbol
  `plus.circle.fill`) at the map's top leading corner — the search field lives in the sheet, the compass sits top
  trailing and the sheet covers the bottom half. It never overlaps the search field and does not move with the keyboard.
- `.large` (the sheet covers the map): the map button leaves the screen and the accessibility tree, and a fixed,
  full-width labelled bar 「＋ 喫煙所を追加する」 (`sheetReportButton`) sits at the bottom of the sheet (a bottom-bar
  `ToolbarItem` would collapse to the bare symbol). It steps aside while the search field is focused or shows
  suggestions, and when the empty state shows its own button. Every entry shows visible text, never a bare icon.
- The in-list section keeps the explanatory text only; the empty-state button (§3.2) opens the same flow.
- Visible only when `reportModel.availability == .available`; when reports are unavailable every entry is hidden
  (no dead control).
- ≥44 pt hit area on the map button, VoiceOver label 「＋ 喫煙所を追加する」, hint 「地図にない喫煙所を運営に提案します。確認後に掲載されます。」
- At the largest Dynamic Type sizes the empty-state invitation may sit below the medium detent; raising the sheet
  shows it, and the map button stays reachable throughout.

### 3.2 Empty state

When no published place is in the area (`.refreshed` with no results), the `ContentUnavailableView` shows:

- Title (unchanged): the existing 「この周辺に掲載中の場所はありません」 (exact current ja string)
- 「まだ掲載されていない喫煙所を知っていますか？」
- 「場所と写真を送ってください。運営が確認し、承認された情報を地図に追加します。」
- Button 「＋ 喫煙所を追加する」 → the same flow as §3.1.

Copy must not promise publication or timing.

### 3.3 Submission flow

Reuses `ReportFormView` / `ReportModel` / `ReportPinPicker` / `DuplicateCandidates` / `ReportPhotos`; no new
report type (it is `missing` with a `NewSpotClaim`).

1. **Location** — `ReportPinPicker` starts at the visible map centre; the user moves the pin. No EXIF location.
2. **Duplicate check** — listed places within 50 m (ADR-0013 §7) shown as 「この場所ですか？」; choosing one turns
   the flow into a confirmation of that place, not a new place.
3. **Photos** — `PhotosPicker`, 1–3 images, in-memory previews, remove/re-add. Reminder: 「人の顔や車のナンバーが
   写らないようにしてください。位置情報などのメタデータは送信時に削除されます。」 Minimum count: see §7 Q1.
4. **Details** — kind of place (required, 「わからない」 allowed), access, indoor/outdoor, paper/heated, hours, note.
   Every field keeps an explicit unknown; nothing is pre-filled as yes.
5. **Consent** — the approved terms version, including the photo clause, accepted explicitly; acceptance is
   remembered per version only.
6. **Send** — one 「送信」 action: report first, then each photo (attested). Photo failure keeps the accepted report
   and offers 「写真を再送信」; it never creates a second report.
7. **Received** — 「受け付けました。運営が確認中です。」 with the state 「審査待ち」 and no promise of listing.

Required states: offline, reports unavailable, attestation unavailable, report rejected by server, partial photo
upload, rate limited, large text, VoiceOver, dark mode.

## 4. Moderation specification

- `reports:moderate` remains the publication/reconciliation tool (maintainer terminal, `--remote`).
  The optional [MannerPath Admin](../LOCAL_MODERATION_ADMIN.md) wraps existing moderation states behind
  an authenticated loopback-only UI and preserves the same explicit remote startup guards.
- P6 private viewing is provided by bounded, authenticated in-memory photo previews in that UI, not
  temporary photo files. No public or signed URL is produced; real R2/staging readiness remains a maintainer gate.
- Report decisions: `accepted` / `needsInfo` (保留) / `rejected` / `duplicate` (existing `ModerationState`).
  Photo decisions: `approved` / `rejected` (existing); pending is the hold state.
- Review checklist per submission: duplicate candidates (`duplicates`), location precision (exact vs
  `areaApproximate`, ADR-0017), stated conditions, photo relevance and sensitivity (faces/plates → reject photo).
- Approved photos only strengthen the reviewer's decision (`photo-summary`); publication still needs the
  existing reconciliation and the community activation gate.
- Admin displays the viewing/review cutoff (`delete_after - 24h`) separately from the retention ceiling.
  The PR #322 proposal/export gate is retained, but its current `delete_after` comparison does not yet
  match early erasure or deletion fences. A separate additive gate fix is required before publication;
  see [the integration HOLD](../LOCAL_MODERATION_ADMIN.md#pr-322-integration-and-early-erasure-finding).

## 5. Audit — what exists and what is missing

Exists (reuse):

| Asset | State |
| --- | --- |
| `ReportFormView`, `ReportModel`, `ReportPinPicker`, `NewSpotClaimSection`, `DuplicateCandidates` | Implemented, used for `missing` reports |
| `ReportPhotos` + `EvidencePhotoUploading` protocol, `PhotoEvidencePolicy` (default off) | Foundation |
| `AttestedEvidencePhotoUploader` (P4): schema-2 envelope, report-domain assertion per attempt, attachment UUID as idempotency key, `photoEvidenceEnabled` checked before signing, typed retryable/final failures; payload pinned by `contracts/app-attest/photo-upload-vectors.v1.json` | Implemented, wired by `ReportComposition` with the report's `AppAttestReportAuthorizer` (P3) |
| App Attest (client + server), report-purpose challenge, schema-2 envelope | Implemented |
| `POST /v1/reports/:id/photos`, sanitizer (re-encode to PNG, metadata dropped), `EvidencePhotoStorage` interface, memory double | Implemented, route returns 503 unless injected in tests |
| `migrations-reports/0003_evidence_photos.sql`, deletion tracking, retention (`retain`) | Implemented |
| `reports:moderate` incl. `photo-summary`, `photo-decide`, triage, duplicates, export/import | Implemented |
| Community activation/publication pipeline, `COMMUNITY_LAUNCH_CHECKLIST.md` | Implemented, HOLD on #124 |
| Map button (medium), labelled sheet bar (large) and empty-state 「＋ 喫煙所を追加する」 entries | Implemented in P2, only when reports available |
| New-spot photo publication gate: a `missing` report backs a new-spot review only with a ready, approved, unexpired photo (`newSpotPhotoGate`, checked at propose/export and by REPORTS_DB migration 0009); photo-less reports are held and minimize normally | Implemented; 0009 not applied to any remote store |
| Photo step in `ReportFormView` (P3): 1–3 photos chosen before consent and submit, required for a new place; a new place is not sent unless `photoEvidenceEnabled` and the photo policy's terms match (`ReportModel.acceptsNewSpotProposals`); photos upload after acceptance, retry only photos (`canRetry`), per-photo reasons, no "all sent" copy while any photo is unsent | Implemented; closed in production (`PhotoEvidencePolicy` default off, config false) |

Missing (this plan):

| Gap | Blocks | PR |
| --- | --- | --- |
| Standalone map button, empty-state copy | R1, R2 | P2 |
| Production fenced storage adapter (R2 + durable fence) and expiry/backup cleanup, config wiring behind a reviewed switch | R5 | P5 |
| `photoEvidenceEnabled` config path that is true only with storage + covered terms version | R5, R9 | P5 |
| Moderator photo viewing (`photo-view`) | R11 | P6 |
| Photo clause in terms; App Privacy and privacy policy text | R9, R10 | P7 (text) + maintainer approval |
| Staging E2E runbook and evidence | R13 | P8 |
| Device verification record | R14 | P8 |
| Edge IP rate-limit rule, R2 bucket, REPORTS_DB, App Attest secrets in production | R5, R8 | Maintainer operations only |

## 6. PR breakdown (each small, independently reviewable; none enables production)

| PR | Scope | Verification |
| --- | --- | --- |
| P1 | This document; PRD/release-gate scope update | `make contract` |
| P2 | Map button + empty-state copy, ja strings | unit + UI tests (button visible/hidden, coexists with search and sheet), screenshots |
| P3 | Flow order and received/pending state; photo step in form | `ReportModel` tests (photo failure keeps report, no duplicate report), UI test with fixture uploader |
| P4 | `AttestedEvidencePhotoUploader` (App Attest bound) | client tests against local Worker with injected memory storage |
| P5 | R2 fenced adapter + expiry + enablement guard (still off in every deployed env) | API tests: fence, expiry, failure recovery, guard refuses without terms coverage |
| P6 | local Admin private photo preview and review checklist | local domain/server/photo tests; real R2 E2E still required; no URL/bytes in logs |
| P7 | Terms photo clause candidate, App Privacy inventory, privacy policy draft — candidate in [PHOTO_TERMS_CANDIDATE](../legal/PHOTO_TERMS_CANDIDATE.md), review/decisions in [PHOTO_PRIVACY_REVIEW](../legal/PHOTO_PRIVACY_REVIEW.md) (not approved) | `make contract`; maintainer approval recorded on #124 |
| P8 | Staging E2E runbook + evidence; device checklist | staging run log, device run record |

Activation (switching production on) is **not** one of these PRs; it follows `COMMUNITY_LAUNCH_CHECKLIST.md` and is
performed by the maintainer.

## 7. Open decisions (maintainer)

- Q1. Is at least one photo **required** for a new-place proposal, or optional (0–3)? Recommendation: required (1–3)
  for new places, since the release goal is photo-backed submission; confirmations stay photo-free.
- Q2. Terms: who approves the photo clause, and is counsel review needed (#124)?
- Q3. Edge IP rate limit values for `POST /v1/reports` and `/photos`.
- Q4. Staging environment for E2E (existing staging Worker + separate REPORTS_DB and bucket?).
- Q5. Release order: v1.0 ships only after R9/R10 are approved, or v1.0 ships with the button hidden
  (`reports.available:false`) and is switched on later by config? The completion condition requires the former.

## 8. Completion condition

On a v1.0 Release build on a physical device, a user submits a new place with photos from the standalone button;
a moderator reviews the private photos, approves; the approved facts appear in a published tile only after the
existing activation, quality and promotion gates. Each step's command and decisive output is recorded in P8.
UI alone is not completion.
