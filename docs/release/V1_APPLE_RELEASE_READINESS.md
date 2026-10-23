# v1 Apple release readiness — Lane 4

Audit base: `origin/main` `b5f7d91`, 2026-10-23. App version/build in the project: **1.0 (6)**.
No version increment, signing/account change, upload, submission or production API/D1/R2 operation.
This is an Apple validation supplement to [the release gate](../V1_APP_STORE_RELEASE_GATE.md),
[the device matrix](../beta-e2e/device-release-matrix.md) and [the photo plan](V1_PHOTO_PLACE_SUBMISSION.md).
It does not close their gates or replace Lane 1's legal answers, Lane 2's admin Web, or Lane 3's API/E2E.

## Evidence boundaries and local run order

Run one Xcode workload at a time. Check `pgrep -x xcodebuild` before each command; coordinate with
other lanes if it finds a process, and leave that process running. Use dedicated simulator UUIDs and
this worktree's build/output paths. Never erase/delete someone else's simulator, reuse their derived
data, globally `pkill` Workers, or run the production-API UI classes in this lane.

```sh
# Run from this worktree; destination UUIDs belong to this lane.
MANNERPATH_IOS_DESTINATION='platform=iOS Simulator,id=<owned-iphone-uuid>' \
MANNERPATH_WATCH_DESTINATION='platform=watchOS Simulator,id=<owned-watch-uuid>' make apple-validate
make contract
make apple-beta-preflight
# Only after the previous Xcode command finishes; fixtures stay local and synthetic.
MANNERPATH_UI_PORT=9087 MANNERPATH_UI_RESULTS=<absolute-private-results-dir> \
  ./scripts/run-iphone-ui-tests.sh
# Watch fixture UI only (never StoreWatchCaptureUITests), after all prior Xcode work ends:
xcodebuild test -project apps/apple/MannerPath/MannerPath.xcodeproj \
  -scheme 'MannerPathWatch Watch App' \
  -destination 'platform=watchOS Simulator,id=<owned-watch-uuid>' \
  -parallel-testing-enabled NO \
  '-only-testing:MannerPathWatch Watch AppTests' \
  '-only-testing:MannerPathWatch Watch AppUITests/MannerPathWatch_Watch_AppUITests'
```

The UI runner refuses an occupied port or active Xcode process. It stops only its own tracked Worker
process tree. It creates/deletes only its own simulator and writes local fixture data only in its own
worktree; never point it at another checkout. `make apple-validate` builds/tests iPhone and Watch plus
widgets and checks built-plist origins; it is principally **Debug Simulator evidence**.
The unsigned preflight archives all four shipping bundles with **Release**, checks bundle relationships,
App Group source entitlements, App Attest declaration, icons, privacy manifests, production origins,
DEBUG-hook absence and embedded-artifact secret scan. It launches no production client and is **not
distribution signing or device evidence**. The checker now rejects photo fixture hooks as well as Watch hooks.

Record exact command, source SHA/tree, Xcode/SDK, simulator OS, log/xcresult path, exit status and test
counts. Keep xcresults, archive/IPA, profiles, real photos and screenshots outside Git. A failed or skipped
stage is not a pass. Do not enable reports/photos merely to make a test pass.

| Validation on this branch | Result / artifact |
| --- | --- |
| Xcode version | Xcode 27.0 / 27A266a |
| `make apple-validate` | Final full rerun PASS (`apple-validate-final.log`): iPhone 285 tests / 30 suites, Watch 32 tests / 2 suites, Watch build and all built-plist origin checks. Initial installation-stalled attempts were interrupted and remain recorded below |
| Photo picker / fixture UI | PASS: all 5 cases on iPhone 16 / iOS 18.6, localhost-only origin (`photo-ui-verified.log` / xcresult). Includes real native picker open/cancel, fixture 1–3 photos/remove/re-add/fourth blocked, closed intake, expiry and photo-only retry; not real library selection/upload proof |
| Other iPhone fixture UI phases | NOT RUN in this audit; existing runner and coverage are listed below, not assumed PASS |
| Watch unit / UI fixture states | 32 unit tests PASS; first UI run 6/8 PASS, 2 lazy-scroll assertions FAIL; test-only reachability fix, both affected cases PASS on retry. `watch-tests.log` / `watch-scroll-retry.log` and xcresults; not hardware sync proof |
| `make apple-beta-preflight` unsigned Release | PASS; all four bundles, version/build 1.0 (6), source App Groups/App Attest declaration, production origins, no DEBUG hooks; artifact scan 36 files / 0 suspects |
| `make contract` / Apple failure fixtures | PASS; 57 artifact/preflight fixtures, 7 runner/orchestration safety tests, 4 UI inventory tests plus the existing document/store checks |
| `make security-validate` | PASS; local fixtures and history scan; no production operation |
| PR CI | Record the required job result on the PR's exact HEAD; CI runs contract/API/security, not the Simulator/device suite |

Local evidence is retained under this worktree's ignored `.wrangler/release-readiness/`, not committed.
The first attempts used dedicated iOS 26.5 iPhone 17 `837B2C63-9768-4045-8A39-305E5097E5AE`
and watchOS 11.5 destination `80E787AD-E6A3-4D9C-92DC-324F263BA2FE`. The Xcode session log
stopped at `Installing app at path` before XCTest execution; the serial retry ended after deliberate
interruption with `make: *** [apple-validate] Error 75`. This is an installation-blocked run (root cause unresolved), not
evidence that the app's tests passed or failed. No global Simulator service/cache reset was attempted.
An independent iPhone 16 / iOS 18.6 destination `70C0B000-7EA2-45DC-9FDD-915FEFC0DEEF`
initially reproduced the same pre-test installation stall (`apple-validate-ios18.log`). After focused UI
execution, the final full rerun on this owned iOS 18.6 / watchOS 11.5 pair completed successfully; this
does not establish the cause of the earlier stalls or validate iOS 26.5 execution. The optional local API regression run was also interrupted
to reduce host contention; it is not recorded as PASS (the PR CI runs API validation independently).
The unsigned checker reports App Attest `development` from the source entitlement; only the exact
distribution-signed artifact/profile plus device evidence can establish the required production environment.

Photo UI diagnostics first exposed the old entry-copy selector and then an off-screen submit hit point:
XCTest reported the last row hittable at y=836/847 with height 44 on an 852-point screen. The test now
uses existing `mapReportButton`, returns to the photo section in its real order, moves the entire submit
button inside the screen before **one** tap, and witnesses draft→receipt before inspecting photo outcomes.
No blind resubmission or weakened assertion was used. Earlier failed/interrupted logs remain alongside the
final five-case PASS. Watch tests likewise use bounded reachability for lazy rows rather than one-swipe assumptions.

## Coverage audit

| Area | Existing automated evidence | Still needs the final signed RC |
| --- | --- | --- |
| First launch / location | `A_FirstLaunchUITests`, `F_LocationNotDeterminedUITests`, `E_LocationDeniedUITests`; `NearbyLocationModelTests` explicit permission gating | Native permission allow/deny/re-enable, reduced accuracy, real location; no Always permission |
| Nearby / details / routes | `B_OnlineUITests`, `G_VisualAuditUITests`; exact versus approximate handoff tests | Current area and distant destination, details/attribution, system Maps at correct point/approximate area |
| Search while typing | `RouteSearchTests` debounce, completion, stale-answer/cancellation; `NativeSearchSheetUITests` live 上野 test exists | Type 上 → 上野 without submit, keep keyboard, pick concrete 上野駅 from a distant region, clear/cancel and recover after network loss |
| Offline | `C_OfflineWithCacheUITests`, `D_CleanOfflineUITests`, `NearbyPersistenceE2ETests`, distance/bearing model tests | Airplane-mode restart with and without cache; honest freshness/error state; no offline turn-by-turn promise |
| Watch | Watch unit location/direction tests, `WatchSyncRefreshTests`, `WatchRefreshPublicationTests`; Watch UI fixture no-snapshot/populated/empty/stale cases | Actual pairing/WatchConnectivity, iPhone away, reconnect, real bearing, sync failure, stale fix and Maps handoff |
| Widgets | `NearbyGlanceTests`, Watch `widgetStatesUseSavedSnapshotOnly`, shared-file/migration tests | Install iPhone small/medium/Lock Screen and Watch Smart Stack/complication; real signed App Group, refresh delay/deep links/offline |
| Photo report | `ReportPhotoFormFlowTests`, `I_PhotoReportFlowUITests` pin, required 1–3, remove/re-add, fourth blocked, retry and closed intake; native picker open/cancel smoke | Real PhotosPicker selection of 1/2/3 images, library access, metadata/privacy and Release App Attest upload/retry on separately authorized staging |
| Accessibility | Existing large-text, labels, contrast/Reduce Transparency/Reduce Motion UI tests | VoiceOver/Voice Control, largest text, Focus order and scrolling on both devices; do not claim an unobserved accessibility label in ASC |

`I_ProductionAPIUITests`, `J_ProductionDestinationUITests` and live production-backed search/capture
classes are deliberately **not run** under this lane's production-API prohibition. Their existence is
not current execution evidence. Native MapKit responses and physical hardware observations remain open.
The new native picker smoke cancels without selecting or changing the photo library; injected-photo
tests prove the form logic, not actual system-library 1–3 selection or device upload.

## Final signed-device record — leave unobserved cells NOT RUN

RC SHA/tree: **NOT SELECTED**. Archive/export SHA-256: **NOT RECORDED**. Version/build: **NOT RECORDED**.
Operator/date/time/zone: **NOT RECORDED**. iPhone model/iOS: **NOT RECORDED**.
Watch model/watchOS/pairing: **NOT RECORDED**. Network / approved environment: **NOT RECORDED**.
Every result needs `PASS/FAIL/PARTIAL + version(build) + evidence path + observer/time`.
The old build 2 observations and build 3 screenshots do not carry forward to build 6 or a future RC.

| Gate / matrix references | Procedure / required evidence | Device result |
| --- | --- | --- |
| G14 / AI1, G2/S1/S2, WG2/S3/S4 | Operator runs existing signed preflight and distribution checker on the exact exported RC; all four IDs/versions/groups match, iPhone App Attest is production. Then prove actual app→widget / iPhone→Watch→widget reads. No profile/key material in Git | NOT RUN |
| G17 / P1, P3–P5, P7 | Fresh install: eligibility first; no permission before explicit tap; Allow While Using, denied→Settings→allow, approximate location warning | NOT RUN |
| G17 / P10, P14, D1–D6, L1–L8, U1–U7 | Current area; distant 上野; typing completion; list/pin details; Maps; delete query; text/keyboard/sheet; recover from network loss. Mark rows separately | NOT RUN |
| G17 / P8/P9b, P9c/P9d | Populate cache, airplane mode, force quit/reopen; then clean offline install; distinguish unavailable backend from no published coverage | NOT RUN |
| G15 / W1–W3, W5/W5b, W8 | Watch clean launch; actual sync incl. empty snapshot; away/offline restart; >1h old state; exact/approximate/unknown detail; refresh failure and recovery; distance/direction outdoors | NOT RUN |
| G15 / G1–G8, WG1–WG4/WG6 | No saved data, data present, >1h stale; same unfiltered first place; no old distance; offline render; app/spot deep links; no widget location prompt | NOT RUN |
| G18 / A1/A1W, P17, W9/W10 | VoiceOver traverse/read/activate all actions; largest text/Crown to last action, light/dark, Reduce Motion/Transparency; record defects rather than an overall assumed PASS | NOT RUN |
| Photo R14 | Disabled: explanation + submit blocked. Only after separate legal/staging authorization: pin, native picker 1/2/3, remove/re-add, fourth blocked, consent, one report then uploads, interrupted photo retry only, received/pending. No production activation by this lane | NOT RUN |
| G10 | Execute the capture procedure below on the selected RC; operator approves exact image hashes, sizes, attribution and claims | NOT RUN |
| G21 | Same RC passes G14/G15/G17, signed distribution preflight and remaining release gates. Operator handles future build increment/upload/submission; none authorized here | NOT RUN |

## G10 RC capture procedure

Rechecked 2026-10-23 against [Apple's screenshot table](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/):
provide the required medium Dynamic Island iPhone set (1206×2622 or 1179×2556 portrait); large options
include 1320×2868, 1260×2736 and 1290×2796. A Watch set uses one supported native size consistently
across locales, e.g. 416×496 for Series 10 or 396×484 for Series 9. PNG/JPEG, no alpha, 1–10 per size.
Confirm actual Media Manager wells on capture day; this document does not authorize opening/submitting ASC.

1. Freeze the exact signed RC identity above. Use a clean release install, Japanese locale and a dedicated
   capture session. Disable personal notifications; no private library images, location history or identifiers.
2. The **operator**, under a separate production-read authorization, chooses an actually published area
   (for example Ueno/Asakusa after checking that RC's served corpus). If physically outside coverage,
   use the app's public destination search. Destination-relative distance must stay labelled as such.
   A destination/host is not evidence of a smoking place. Never inject fixture pins or fake a live GPS fix.
3. Capture native UI: map + list with freshness; typing 上野 → concrete destination; populated destination
   list; place details with uncertainty/access and source/license; Maps handoff entry. Capture approximate
   positions with their 目安 label. Watch: real synchronized nearby top-three and detail; optionally widget
   views after real App Group evidence. No empty/unavailable state posed as working coverage.
4. Keep offline/stale/denied/empty and disabled-report evidence in a **review/testing** folder. Only market
   the actually shipping behavior. Photo-flow fixture screenshots and all DEBUG attachments are synthetic
   test evidence, never store assets. Do not depict photo intake as live while it is disabled.
5. Preserve unedited originals, native pixels, SHA-256, RC/version/build, device/OS, locale, scene,
   capture method, served source/spot IDs and actual-versus-destination location context. Never upscale,
   composite, replace map backgrounds, remove Apple/provider credits or infer image rights from data rights.
6. Use the existing `validate-store-screenshots.py` candidate manifest/checker for technical checks;
   technical PASS deliberately leaves `submissionReady:false`, rights/device approval separate. Keep
   images/private evidence outside Git. Existing build 3 candidates are historical, not final RC assets.
7. Operator reviews the exact final files for readable text, uncertainty, map credits, no tobacco promotion
   or identifiers and truthful feature claims, then records approval/hashes. Final G10/G5/G21 remain open
   until that review and the signed-device checks pass. This lane performs no upload or submission.

## Remaining Apple/App Store blockers

G10 final RC images/approval, G14 signed distribution + actual groups/App Attest, G15 Watch/widget hardware,
G17 device permissions/offline, G18 device accessibility and G21 selected final RC remain open. Photo R14
needs separately authorized staging/device evidence. Lane 1's legal/privacy/terms, Lane 2's operator Web
and Lane 3's API/submission E2E remain independent prerequisites, not waived by a green Apple test suite.
