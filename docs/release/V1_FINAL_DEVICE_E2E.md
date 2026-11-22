# v1.0 final physical-device E2E — Lane 3

Audit base: `origin/main` `eb4ed96` (after #321 admin web, #328, #329, #330), 2026-10-24. Project version **1.0 (6)**.
This page adds what changed since the Build 3 run sheet ([device matrix §9](../beta-e2e/device-release-matrix.md)) and
Lane 4's audit at `b5f7d91` ([Apple readiness](V1_APPLE_RELEASE_READINESS.md)): live search completion (#318), the photo
form (#319/#320), interrupted-upload recovery (#330), and the release decisions that made photo submission P0 at the
time. **Superseded 2026-11-02** ([release gate](../V1_APP_STORE_RELEASE_GATE.md) header): v1.0 ships text-only new-place
reports without photos; photos are v1.1. Photo items below are kept as v1.1 preparation, not v1.0 submission conditions.

Sections 1, 2, 4 and 5 hold Simulator/unit evidence only; it never fills a device cell. The only device observations
are the **DEV results** tables in §3.4 and §3.5 (dev-signed Debug photo build, 2026-11-21/22), which are DEV notes, not
matrix PASS. No TestFlight upload, App Store action, signing change, production or
staging operation, real photo upload or build-number change was made.

## 1. Simulator / repo evidence on `eb4ed96` (not device evidence)

Owned simulators only (iPhone 16 Pro iOS 18.6 `5E40ACED…`, Watch Series 10 watchOS 11.5 `B367637F…`; the UI runner
creates and deletes its own iPhone 17 iOS 26.5). One Xcode workload at a time, checked with `pgrep -x xcodebuild`.

| Command | Result |
| --- | --- |
| `make apple-validate` | PASS — iPhone `297 tests in 31 suites`, Watch `32 tests in 2 suites`, Watch build, built-plist origin checks |
| `scripts/run-iphone-ui-tests.sh` (port 9187) | first-launch 1, not-determined 1, denied 1, light 16, dark 3, large-text 4, offline-cached 1, clean-offline 1, destination-search 6: all PASS. photo-report 10/11 — see §5 |
| photo-report reruns (§5) | 3 + 5 isolated runs of the failing test: 7 PASS, 1 FAIL (different line) |
| `make apple-beta-preflight` (unsigned Release archive) | PASS — `CFBundleVersion for App Attest server: 6`, archived with `-configuration Release`, artifact scan `files=36 suspects=0` |
| `make contract` | PASS |
| `make security-validate` | exit 2 only from a **local-only** old branch outside this PR (`45a4301`, closed #325 history, not on any remote); tracked-files scan of this branch `suspects=0` |

The first runner attempt exited 127 before any test (`wrangler: command not found`: the fresh worktree had no
`services/api/node_modules`); after `npm ci` the run above executed. Recorded, not counted.

## 2. What only a device can prove vs what is automated

| Area | Automated (Simulator/unit) | Device only |
| --- | --- | --- |
| Destination search, completion | `RouteSearchTests` (nationwide retry, debounce, stale answers), `DestinationSearchUITests` (local fixture) | Real MapKit from Kanazawa (§3.1), keyboard timing, network loss |
| Place detail, directions | `B_OnlineUITests`, visual audit, exact/approximate handoff tests | Apple Maps actually opening at the spot |
| Watch sync, 0 places, distance/direction | Watch unit tests, `WatchSyncRefreshTests`, Watch UI fixture states | WatchConnectivity between paired devices, real compass bearing outdoors |
| Widgets | `NearbyGlanceTests`, shared-file tests | Signed App Group read on device (iPhone + Watch widgets) |
| Offline, location denied, relaunch | `C_`/`D_`/`E_`/`F_` UI phases | Airplane mode, system permission sheets, Settings round trip |
| Photo form + PhotosPicker | `I_PhotoReportFlowUITests` (fixture photos, picker open/cancel), `ReportPhotoFormFlowTests`, `ReportPhotoRecoveryTests` | Choosing 1–3 real library photos; real upload (staging only, §3.4) |
| #330 interrupted upload | UI `testRelaunch…`, `testStoppingTheFollowUp…`, `testResumeExplains…`, `testExpiredFollowUp…`, `testUnsavedFollowUp…`, `testResumeScreenWorksAtLargestTextSize…` | App killed from the app switcher mid-upload on hardware |
| VoiceOver, Dynamic Type, Reduce Motion | large-text phase, label assertions, `M_MapFirstAccessibilityUITests` (outside runner) | VoiceOver traversal and activation, AX5 on both devices, Reduce Motion on device |

## 3. Device procedures (operator)

Record per row: device model + OS, build (`1.0 (N)`), signing type, local time, PASS/FAIL/PARTIAL, screenshot on
failure — in the [device matrix](../beta-e2e/device-release-matrix.md) rows named below.

Two kinds of build are used and never mixed in a result:

- **RC build** — signed Release from TestFlight (or an Xcode Release run on the device). Production API, reports and
  photos **unavailable** (production `reports.available:false`). All matrix rows are recorded on this build.
- **Developer photo build** — Debug, run from Xcode on the iPhone 16 Pro, with *Edit Scheme → Run → Arguments Passed On
  Launch* `-uiTestPhotoReport <scenario>`. It uses the DEBUG-only photo stack: the **real PhotosPicker** with a scripted
  uploader that sends nothing anywhere. Results are recorded as `DEV` notes, never as a matrix `PASS 1.0 (N)`.
  `#if DEBUG` keeps this stack out of Release; the unsigned preflight rejects its hook strings in a Release binary.

### 3.1 Kanazawa → 「上野」「上野駅」 (RC build; D1–D3, L1, L2, L5)

1. Stand in Kanazawa (or anywhere far from Tokyo), online, location allowed. Note the time.
2. Open search; type 「上」, then 「野」 one character at a time without pressing search. Expect suggestions while
   typing that include a Tokyo 上野 entry (台東区); the keyboard stays up (L1). Screenshot.
3. Continue to 「上野駅」 quickly, pause. Earlier suggestions stay until replaced; no older list returns (L2).
4. Tap the Tokyo 上野駅 suggestion (not a local station). Expect the destination row 「上野駅」, search dismissed (L5, D2).
5. Map and list show published Taito places around Ueno (D3); open one: distance/bearing are from the destination (D4).
6. Repeat from step 2 with the full query 「上野」 then pressing search: a Tokyo 上野 result can be chosen (D1).
7. If only local results appear: FAIL D1 with a screenshot of the list. The app retries with a nationwide required
   region when no answer names the query (`MapKitNavigation.swift`), so a miss is a defect, not expected behaviour.
A simulated location (Xcode GPX) on a Debug build is not evidence for these rows.

### 3.2 Watch, widgets (RC build) — matrix §9 B and C unchanged

Run §9 B (App Group widget), C (W1–W3, WG2, W5b) and D3 (W5). Add: **0 places** — set the iPhone destination to an
area with no published places (e.g. Kanazawa station), open the Watch app: expect the empty state, not stale places
from the previous area and not an error. Record as a note on W2 until a row exists.

### 3.3 Offline, permission, relaunch (RC build)

Matrix §9 A (P1, P4, R1, AI1), D (P8/P9b), and P5 (deny → Settings → allow), P7 (Precise off), P9c (fresh install
offline), P24 (background ≥10 min). Relaunch = force-quit from the app switcher.

### 3.4 Photo form and PhotosPicker (developer photo build; no real upload)

Real uploads wait for Lane 2's staging and a separate approval. Until then:

1. Scenario `success`: 「喫煙所を報告」 → pin → choose **1, then 2, then 3 real photos** in PhotosPicker; remove one;
   re-add; confirm a 4th cannot be added; consent; submit. Expect one report reference and 「写真を受け付けました（審査待ち）」.
   Check the picker shows only the selection UI (no full-library permission prompt).
2. Scenario `retry`: the first attempt of each photo fails; 「未送信の写真を再送信」 sends photos only; the report is not resent.
3. Scenario `closed` (photo intake off, reporting open, as in the v1.0 deployment): a new place starts with no photo
   section and no paused notice (`acceptsNewSpotProposals` depends only on reporting availability; UI test
   `testClosedIntakeHidesRestoredFollowUpAndConnectionFailureKeepsIt` asserts the same); existing-place reports still open.
4. Large text (AX5) and VoiceOver through steps 1–3; Reduce Motion on.

**DEV results, 1.0 (8)** (Debug build of `main` `159bee8`, development signed, `MannerPathAPIBaseURL` empty so nothing
leaves the device; iPhone 16 Pro, iOS 27.2; reported by the maintainer on 2026-11-21; local times not recorded). These
are DEV notes, not matrix PASS:

| Step | Result |
| --- | --- |
| 1 `success`: 1→2→3 real photos, remove, re-add, no 4th, consent and submit with one reference and 「写真を受け付けました（審査待ち）」, picker without a full-library prompt | DEV OK (all six checks reported fine) |
| 2 `retry`: 2 real photos; both first uploads failed; 「未送信の写真を再送信」 → receipt | DEV OK with a UX finding. Device files: before retry the follow-up showed `rp_UITEST1`, `uploadedCount 0`; after retry the follow-up was deleted and the report count stayed 1, so there was no second report and the reference was kept. "Both photos sent" is inferred from the deletion plus the on-screen receipt, because the mock keeps no upload log. **The failure and the retry button were not noticed after submitting until the form was scrolled: #447** |
| 3 `closed` | DEV OK for what was checked: no paused notice (expected, see step 3), no photo section, existing-place detail shown, 「保存済みの報告を再開」 opened the form. New report (2026-11-22, fresh launch without Persistent): DEV OK, the new-place form opened, had no photo section, and reached the receipt without photos |
| 4 AX5, VoiceOver, Reduce Motion | AX5 + Reduce Motion (2026-11-22, `success`): DEV OK, two photos added, one removed, consent, submit and receipt all operable; no clipped or overlapping text. **Not verified**: failure text and retry button at AX5, and all of VoiceOver (device checks ended 2026-11-22); carried to the v1.1 list below §3.5 |

### 3.5 #330 interrupted upload and relaunch (developer photo build)

1. Scenario `hang` with `-uiTestReportPersistent YES -uiTestReportReset YES`: submit a new place with one photo;
   while 「写真を送信中」 shows, swipe the app away in the app switcher.
2. Change the argument to `success` (keep `-uiTestReportPersistent YES`, remove Reset); run.
3. Tap 「喫煙所を報告」: the form opens on 「前回の報告が残っています」 with the reference `rp_UITEST1` and two choices;
   nothing is started. Close: the choice stays available (「受け付け済みの報告に写真を送る」 entry).
4. 「前の報告に写真を追加する」 → choose a real photo → send: received; no `rp_UITEST2` appears.
5. Repeat 1–2, then 「新しい喫煙所を報告する」 → confirmation says the previous report is not deleted → new report gets
   `rp_UITEST2`.
6. Scenarios `closed` (paused intake text), `offline` (connection failure, retry), `old` (expired: no send button),
   `unsaved` (warning to keep the app open). VoiceOver reads each warning as one element (icon + text).

**DEV results, 1.0 (8)** (same build and device as §3.4; DEV notes, not matrix PASS):

| Step | Result |
| --- | --- |
| 1 `hang` + Persistent + Reset: one photo, app swiped away while sending | DEV OK. Device files after the kill: `ui-test-report-count` 1; `photo-follow-up.json` `reportId` `rp_UITEST1`, `uploadedCount 0` |
| 2–4 `success` + Persistent: 「受け付け済みの報告に写真を送る」 → add a photo → receipt | DEV OK. Device files after: count still 1 (unchanged since the `hang` submit), follow-up file deleted, so no second report, reference stays `rp_UITEST1`, and the unsent-photo state was cleared. The individual screens of step 3 (two choices, closing keeps the entry) were not reported one by one |
| 5 new report from the choice (2026-11-22) | DEV OK: after `hang` kill (device files `rp_UITEST1`, `uploadedCount 0`, count 1) and `success` relaunch, 「新しい喫煙所を報告する」 led to a new report received as `rp_UITEST2`. Device files after: count 2, follow-up for `rp_UITEST1` deleted (a new report gives up that report's photo chance, `ReportModel.swift:208`). The confirmation text about the previous report was not reported |
| Repeat of 1–4 after relaunch, 5 rounds (2026-11-22, 3:07–3:20; each round `hang` with Reset, kill while sending, then `success`) | DEV OK 5/5. After each kill the device files showed `rp_UITEST1`, `uploadedCount 0`, count 1; after each resume the follow-up file was deleted and the count stayed 1. The maintainer reported the form opened right after every relaunch (no #367-type "sheet not presented") and every photo was received. Files are unreadable while the iPhone is locked (data protection: `openat` EPERM), so each read was done unlocked |
| 6 `offline` (2026-11-22): `offline` + Persistent + Reset, new place with one photo, then 「未送信の写真を再送信」 | DEV OK: connection-failure text shown, retry showed the same error. Device files after the retry: `rp_UITEST1`, `uploadedCount 0`, count 1, so no second report and the photo stays unsent for a later retry. Whether the text was noticed without scrolling was not reported (#447) |
| 6 `unsaved` (2026-11-22): `unsaved` + Persistent + Reset, new place with one photo | DEV OK: 「アプリを閉じないでください」 warning on screen right after the receipt without scrolling, and the photo connection error shown. Device files: no follow-up file (the store is unwritable by design), count 1 |
| 6 `old` (2026-11-22): `old` + Persistent + Reset, one photo, killed while sending, then `success` + Persistent; entered through 「受け付け済みの報告に写真を送る」 in the Nearby sheet | DEV OK for what was checked: expired notice shown, no add-photo or send button. Device files after the kill: `rp_UITEST1`, `uploadedCount 0`, `uploadDeadline` 2020-03-30, count 1; after relaunch the follow-up file was deleted and the count stayed 1. The end button was not reported. A first attempt never showed the notice: the map entry reads 「喫煙所を追加」 once expired and a new draft hid the sheet button, see #448 |

**Not verified on device; check before photo intake is enabled (v1.1).** None of these is a 1.0 blocker, because photo
evidence is off in the 1.0 Release (matrix §4 rows unchanged):

- VoiceOver through §3.4 steps 1–3 and the §3.5 warnings (each read as one element, icon + text).
- AX5: photo failure text and 「未送信の写真を再送信」 reachable and operable (scenario `retry`).
- §3.5 step 3 screens one by one (two choices; closing keeps the entry), step 5 confirmation that the previous report
  is not deleted, and the `old` end button.
- UX findings to resolve or accept first: #447 (failure and retry button off screen after submitting), #448 (expired
  notice reachable only from the Nearby sheet on the first launch).

### 3.6 Accessibility (RC build; A1, A1W, P17, W9/W10, L7, L8, U5, U7)

VoiceOver on: Nearby list rows, pins, filters, detail, search suggestions, Watch list/detail. AX5 text: every screen
reachable by scrolling. Reduce Motion and Reduce Transparency: sheet and map transitions readable, no lost controls.

## 4. Open P0 items (2026-10-24; row 1 and row 4 updated 2026-11-22 for the text-only v1.0 scope)

| # | Item | Blocks | Owner | Why open |
| --- | --- | --- | --- | --- |
| 1 | Text-only new-place submission on the **Release** RC (gate G16, G17, G23); photo-backed submission moved to v1.1 on 2026-11-02 | submission | maintainer approval, Lane 1 legal | #124 terms not approved; production intake stays paused until ready (the 1.0 (8) Release build showed 「受付停止」 on iPhone, matrix 1.0 (8) section). §3.4–3.5 DEV results are v1.1 preparation and do not close it |
| 2 | Signed RC chosen and preflighted (G14, G21) | TestFlight | maintainer | No build 4–6 upload/processing recorded; signing untouched by this lane |
| 3 | Watch / widget device rows W1, W2, W2c, W3, W5, W5b, G2/S1–S2, G3/G3b, WG2/S3–S4 (G15) | TestFlight testers | maintainer device run | Never observed on a device |
| 4 | First launch, permission, offline rows P1, P4, P10, P14, P8/P9b, AI1, and text-only report acceptance and resend (G17) on the RC; R1 only as the paused negative case | submission | maintainer device run | Build 2 partial results do not carry forward |
| 5 | Search P0 rows D1–D5, L1, L2, L5, U1–U3 on the RC (§3.1) | submission | maintainer device run | Build 3 rows never filled; #318 completion changed since |
| 6 | G1–G3, G5–G8, G10–G12, G19 (store record, privacy, rights, screenshots, data) | submission | Lanes 1/4, maintainer | Unchanged by this run; see [release gate](../V1_APP_STORE_RELEASE_GATE.md) |

No app defect was confirmed in this run; the intermittent photo-form UI test failure was traced to the test (§5).

## 5. Findings of this run

- **Intermittent UI test, `I_PhotoReportFlowUITests/testNewPlaceRequiresPhotosThenSendsReportAndPhotos` — cause
  found 2026-10-24, test-side.** The `submit.isEnabled` failure was not caused by photo remove/re-add: the
  `60-photo-required` screenshot of the failed run, taken right after `choosePinAndAgree()`, already shows the consent
  toggle OFF. The single consent tap landed while the Form was still moving (pin-sheet dismissal reflow, then a drag
  scroll), which only stops the motion, and the test never checked the toggle. The `:16` failure (form not opening)
  is the same class: the map entry is tapped as soon as it exists, which can be during the Nearby sheet's launch
  presentation. Fix (`fix/v1-photo-report-ui-reliability`): tap only after the pin sheet is gone / the Nearby sheet is
  up and the element's frame is unchanged between two reads, and assert the toggle reads ON. No fixed sleeps, no
  repeated taps. The same wait now guards the "add test photo" and follow-up "resume" taps (a run with the first fix
  lost one add tap: `:132` "no fourth photo can be added"). Separately, `testResumeScreenWorksAtLargestTextSizeWithLabels`
  failed 2/2 on unmodified `main` at `:328`: the resumed form opens at the top at AX5, so `report.photo.endFollowUp`
  is below the fold and absent from the tree; the test now scrolls to it instead of assuming a retained offset. No app
  state machine defect found; **device check** §3.4 step 1 still applies.
- **Still open (simulator, iOS 26.5 runner):** `B_OnlineUITests/testMapPinOpensDetail` ("Spot Detail did not open")
  fails on unmodified `main` and on the fix branch; `testNativePhotosPickerCancelReturnsToUnchangedForm` failed once in
  a full runner (system picker still present after Cancel, `:112`) and passed 3/3 in isolation. Neither is touched
  by this fix.
- Fresh worktrees need `npm ci` in `services/api` before `run-iphone-ui-tests.sh`; the runner fails with exit 127.

## 6. Final checklist before TestFlight and App Store

TestFlight (internal):
- [ ] RC commit chosen on `main`; build number raised by a reviewed PR (Lane 3), all 16 configurations equal.
- [ ] `make apple-validate`, `run-iphone-ui-tests.sh` (all phases), `make contract`, `make security-validate` green on the RC commit.
- [ ] Signed archive → `apple-beta-preflight.sh <archive>` and `check-apple-beta-artifact.py --distribution` exit 0 (G14).
- [ ] Production `/v1/config` read-only GET on the day: values match the release decision for reports/photos.
- [ ] Upload, processing done, export compliance answered (T5). Internal group only.
- [ ] Device run: §3.1–3.3, 3.6 on the RC; results in the matrix. (§3.4–3.5 are v1.1 photo preparation, not required for v1.0.)

App Store submission:
- [ ] Every P0 in §4 closed with device evidence on the submitted build; P1 rows closed or accepted by the maintainer.
- [ ] Text-only report scope confirmed on the submitted build (decision of 2026-11-02: no photos in v1.0); production
      intake opened only under separate approval. Store copy and Review Notes match what actually ships.
- [ ] G1–G13, G19–G21 per [release gate](../V1_APP_STORE_RELEASE_GATE.md); screenshots from the RC (G10).
- [ ] Maintainer sign-off. Submission is a maintainer action; no lane submits.

## 7. Non-destructive device connection check (operator)

Read-only checks; never unpair, reset trust, erase, or change signing. State on 2026-10-24
(`xcrun devicectl list devices --json-output`): iPhone 16 Pro `yk` iOS 26.6.1 `paired / connected / wired`,
Developer Mode enabled, DDI available. Apple Watch Series 9 watchOS 26.6 `paired / unavailable`, **Developer Mode
disabled** — the likely reason it is unavailable.

1. Mac: `xcrun devicectl list devices` and `xcrun xctrace list devices`. iPhone must be under `== Devices ==`.
2. iPhone shows Offline: unlock it, keep it on the screen, connect by cable, answer any "Trust this computer" prompt
   (answering Trust is fine; do not use Reset Location & Privacy). Reopen Xcode → Window → Devices and Simulators and
   wait for "Preparing" to finish.
3. Watch unavailable: on the Watch, Settings → Privacy & Security → Developer Mode → On (Watch restarts and asks to
   confirm). Keep the Watch unlocked, on the wrist or charger, near the unlocked iPhone with Bluetooth and Wi-Fi on.
   In Devices and Simulators, select the Watch under the iPhone and wait for it to finish preparing (can take minutes).
4. Re-run step 1. Record the four states (pairing, tunnel, Developer Mode, DDI) in the device matrix before §3.
