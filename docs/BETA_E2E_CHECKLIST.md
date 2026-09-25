# Beta E2E checklist and smoke matrix (Issue #35)

The reproducible checklist for running MannerPath on a real iPhone and Apple Watch against a
production-like backend with real published data. It records what automation, the simulator and a
local backend have already proved, and leaves every physical-device row for a human to tick.

It is not an App Store submission checklist (Issue #25, "Explicitly deferred").

## Status legend

| Status | Meaning |
| --- | --- |
| `AUTO` | Passed in an automated suite (`make apple-validate`, Watch tests, `make api-validate`, `local:smoke`) |
| `SIM` | Observed in a fresh simulator, against a local `wrangler dev --local` Worker where the row involves data (screenshot or request-log evidence, not a test). Never a substitute for a physical device |
| `iPhone` | Requires a physical iPhone |
| `Watch` | Requires a physical Apple Watch paired with that iPhone |
| `BACKEND` | Requires a deployed staging/production-like backend or maintainer action (`OPERATIONS.md`) |
| `BLOCKED` | Cannot pass until the named issue is fixed. No row is currently blocked (the #52 blocker is fixed, see below) |

A row may carry more than one status: `AUTO` coverage never replaces the physical check it lists.

## API base URL blocker: found here, tracked in #52, fixed by PR #53

**Status: fixed in `main`** (PR #53, merge `436d9ba`). Physical-device confirmation against a
real/staging backend is **still unverified**.

History: this checklist's first run found that **a build never received an API base URL**.
`INFOPLIST_KEY_MannerPathAPIBaseURL` was a custom key, and Xcode's generated Info.plist
(`GENERATE_INFOPLIST_FILE = YES`) ignores `INFOPLIST_KEY_*` settings it does not recognise, so the
built app had no `MannerPathAPIBaseURL` key even though the build setting resolved. With no origin,
`NearbyComposition.apiBaseURL` returned `nil`: Nearby was cache-only (a clean install showed "No
saved places nearby — Live updates are unavailable"), and reports used `UnconfiguredReportClient`.
It was tracked as #52 (child of #35, now closed).

PR #53 moved the key into the explicit `MannerPath-Info.plist` as
`<key>MannerPathAPIBaseURL</key><string>$(MANNERPATH_API_BASE_URL)</string>`, removed the ineffective
build setting, added `NearbyConfigurationTests`, and added `scripts/check-iphone-api-base-url.sh`
(run by `make apple-validate`). That script builds the iPhone target twice and checks the built
`Info.plist`: configured (`MANNERPATH_API_BASE_URL=https://example.invalid`) contains exactly that
value; unconfigured (empty) contains an empty value, which the app treats as cache-only; the
generated system keys are still present; and `MannerPath-Info.plist` is not copied into the bundle
as a resource. In an `.xcconfig`, spell the origin `https:/$()/…` (`apps/apple/README.md`).

What the fix does **not** prove: that a signed device build reaches a real/staging backend, fetches
tiles, and populates the Nearby cache, widget glance and Watch snapshot. Rows that were
`BLOCKED (#52)` are therefore back to their physical-device/backend status, not `PASS`.

On a device, every row that needs published data depends on a build configured with a reachable
origin plus a deployed backend (B6): P1–P2, P7–P11, P13–P15, P17 with data, P19–P23, W2–W9 (the
Watch snapshot comes from the iPhone's tile cache), and the widget rows that need a saved place:
G2–G4, G7, WG2, WG3 and S2–S4. P2 and WG5 also need a previous beta that actually holds a tile
cache / Watch snapshot; a beta built before #53 could not download data (unless its plist was
patched), so it has none to migrate. G1, the "no snapshot" half of G5, G6, G8, G9, WG1, WG4, WG6 and S1 need no backend.

The `SIM` backend rows below were observed **before** #53, by adding the key to a scratch copy of
the built app (`PlistBuddy -c "Add :MannerPathAPIBaseURL string http://127.0.0.1:8787"`, then ad-hoc
re-signing) — a test-only workaround, never a build step. The iPhone usability pass below (#59,
PR #60) used a post-#53 build configured with the local Worker origin and repeated the list/detail,
map and Worker-stopped observations (P9a, P10); the 304 revalidation of P8/B1 was not repeated.

## Recorded run

Commit `85a0ec6` (origin/main after PR #49), 2026-09-23, Xcode 27.0, local Worker
(`wrangler dev --local`) with the published Taito fixture. The automated suites ran on the default
destinations named below (runtime not pinned; several are installed). The `SIM` observations used
freshly created iOS 26.5 and watchOS 11.5 simulators, deleted afterwards. No physical device and no
remote deployment was used.

| Command | Result |
| --- | --- |
| `make contract` | `MannerPath contract files present.` |
| `make api-validate` | typecheck clean; `tests 195 · pass 195 · fail 0` |
| `make apple-validate` | iOS `** TEST SUCCEEDED **` (116 passed, 0 failed); watchOS `** BUILD SUCCEEDED **` |
| Watch tests (command below) | `** TEST SUCCEEDED **` (14 passed) |
| `npm run local:quality` | `"failedChecks": 0` |
| `npm run local:smoke` (local env) | `7/7 checks passed`, report gate `400 invalidReport` (`disabled`) |
| `local:smoke --base-url http://127.0.0.1:8788` against `wrangler dev --local --env staging` | `7/7 checks passed`, report gate `503 attestationUnavailable`, `/v1/config` `reports.available:false`, `report=2..2` |

After rebasing onto `636641f` (origin/main with PR #51 / #32), same day and machine, only the
Apple suites were re-run; the `SIM` rows and the backend commands above were not repeated.

| Command | Result |
| --- | --- |
| `make apple-validate` | iOS `** TEST SUCCEEDED **` (121 passed, 0 failed); watchOS `** BUILD SUCCEEDED **` |
| Watch tests (command below) | `** TEST SUCCEEDED **` (17 passed, 0 failed) |
| `make contract` | `MannerPath contract files present.` |
| #52 reproduction (pre-#53 build) | `** BUILD SUCCEEDED **`; built `Info.plist` has `mannerpath` URL scheme, no `MannerPathAPIBaseURL` |

After rebasing onto `436d9ba` (origin/main with PR #53, which fixed #52), 2026-09-24, same
machine, only #53's built-plist check and the contract check were re-run; the app code is
unchanged by this branch, so the Apple/API suites and `SIM` rows were not repeated.

| Command | Result |
| --- | --- |
| `./scripts/check-iphone-api-base-url.sh` | exit 0 (both builds `-quiet`, no `error:`): configured value, empty unconfigured value, system keys and no copied `MannerPath-Info.plist` all checked; the script prints nothing on success |
| `make contract` | `MannerPath contract files present.` |

Watch tests are not part of `make apple-validate`; run them explicitly:

```sh
xcodebuild test -project apps/apple/MannerPath/MannerPath.xcodeproj \
  -scheme "MannerPathWatch Watch App" \
  -destination "platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)" \
  -only-testing:"MannerPathWatch Watch AppTests"
```

## iPhone usability pass (2026-09-24)

A simulator walk of the Japanese UI (fresh iOS 26.5 iPhone 17 simulator, local
`wrangler dev --local` Worker with the published Taito fixture, a post-#53 build configured with
`MANNERPATH_API_BASE_URL=http://127.0.0.1:8787`). Driven only with `simctl` (launch, `defaults`,
`privacy grant location`, `location set`, `ui appearance/content_size`); this machine has no
Simulator GUI or tap automation, so nothing was tapped.

Observed (screenshots): eligibility notice; Nearby before location permission; Nearby loaded with
live data; Nearby with the Worker stopped and a cache (partial-failure message, cached list);
clean install with the Worker stopped (empty state distinct from "no published places").

Fixed from those observations: the list row showed a bare "不明" for access, now labelled
"利用条件: 不明"; the bearing "北から時計回りに238°" now reads "南西（238°）"; the map is 240 pt
so the nearest result is visible without scrolling; the partial-failure banner no longer claims
saved results when there are none; the report-availability note no longer mentions a saved draft
that does not exist; the Data & Privacy "Location" section read "場所" and now reads "位置情報";
the destination map annotation had no Japanese string.

The first walk could not tap. The flows it missed are now driven by the iPhone UI-test target
`MannerPathUITests` (2026-09-25), run by `./scripts/run-iphone-ui-tests.sh`. The script makes a
fresh iOS 26.5 iPhone 17 simulator in Japanese at a fixed Taito location, starts the local Worker
with the published fixture, and runs 8 phases, each with the state set by `simctl` rather than
by app code. Result: `All iPhone UI test phases passed.`, 18 tests, 0 failed:

| Phase | Tests | What is driven |
| --- | --- | --- |
| `first-launch` (fresh install) | 1 | eligibility notice → "確認しました" → Nearby |
| `not-determined` | 1 | "現在地を使用" shown, no results, no prompt without the tap |
| `light` (Worker up, location granted) | 9 | map ≥ 200 pt and first result visible without scrolling; row → detail (type, distance, bearing, access, freshness, last verified, attribution link, Maps handoff, report) → back; map pin → detail; physical-type filter → empty state → "絞り込みを解除" → results return, reopen shows cleared state; paper filter hides only the heated-only booth (unknown stays); Data & Privacy "位置情報" → sources/licence → back; report: change type to moved, type a note, close, resume keeps the draft, discard, never submitted; destination search can be typed and submitted; icon-only toolbar actions have labels |
| `dark` | 2 | Nearby loaded, row → detail scrolled to the end |
| `large-text` (`accessibility-extra-extra-extra-large`) | 2 | same; first result reachable by scrolling, detail scrolls to the report action |
| `offline-cached` (Worker stopped) | 1 | cached rows stay, partial-failure message shown |
| `clean-offline` (reinstall, Worker stopped) | 1 | "読み込めませんでした" empty state; not "no published places"; no claim of saved results or drafts |
| `denied` (`simctl privacy revoke`) | 1 | denial message and "設定を開く" |

Screenshots are XCTest attachments in each phase's `.xcresult` (not committed). Not covered:
the system permission dialog itself (permission is set with `simctl`), the destination result
list and walking-detour ranking (live MapKit search is not deterministic here, so any honest
outcome is accepted), Apple Maps handoff, VoiceOver reading order, and everything that needs a
physical device or paid signing in the rows below.

"前回の現在地" in the simulator is the intended last-known fallback (`DeviceLocationService`):
it is shown when Core Location's fix is over 60 s old or a new fix is pending or failed, always
with the fix's own timestamp. A simulator with a fixed location keeps returning the same old
fix, so it shows this label more often than a moving device would. The detail footer claimed
"while nearby data updates" in that case even when nothing was updating; it now just says the
estimate is from a previous location.

## Watch usability pass (#58, PR #61, 2026-09-25)

Recorded from PR #61, not re-run here. The `MannerPathWatch Watch AppUITests` target (in the
`MannerPathWatch Watch App` scheme) drives six product flows on an Apple Watch Series 10 (46mm)
watchOS 11.5 simulator with a seeded snapshot and deterministic location scenarios, through a
launch flag and environment keys that exist only in `#if DEBUG` builds: 6/6 passed; Watch unit tests
20 passed. Flows: first use; saved results lead, top-three cap; stale detail keeps distance, bearing
and Directions ahead of sources; quick filters empty and clear; location states never show an old
distance as current; Japanese stale/no-location copy. Directions is verified reachable and
enabled only: the Maps handoff, Digital Crown, VoiceOver, real phone-to-Watch transfer and rendered
widgets (gallery, Smart Stack) are not covered and stay on the device rows below.

```sh
xcodebuild test -project apps/apple/MannerPath/MannerPath.xcodeproj \
  -scheme "MannerPathWatch Watch App" \
  -destination "platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)" \
  -only-testing:"MannerPathWatch Watch AppUITests"
```

## iPhone

| # | Case | Status | Evidence / how to check on device |
| --- | --- | --- | --- |
| P1 | Clean install, first launch | `SIM` · `iPhone` | Fresh simulator: eligibility notice shown first, in Japanese. On device: delete the app, install the beta build, launch |
| P2 | Local-schema upgrade (install new build over the previous beta) | `iPhone` | Install previous beta, open Nearby once, install new build over it; cached places still appear before any refresh |
| P3 | Eligibility notice | `AUTO` · `SIM` · `iPhone` | UI test `testEligibilityNoticeLeadsToNearby` (phase `first-launch`, #60): fresh install, tap "確認しました", Nearby shown. Device: tap it and confirm it is not shown again after relaunch |
| P4 | Location: not determined → allow While Using | `AUTO` · `iPhone` | `permissionIsRequestedOnlyByExplicitAction`. Device: prompt appears only after "現在地を使用" |
| P5 | Location: denied | `AUTO` · `SIM` · `iPhone` | UI test phase `denied` (#60, permission revoked with `simctl`): denial message and "設定を開く". Device: deny, confirm Settings opens the app's page, re-allow and return |
| P6 | Location: restricted (Screen Time) | `iPhone` | "Location access is restricted" message, no crash |
| P7 | Approximate vs precise | `AUTO` · `iPhone` | `usableLocationRetainsAccuracyFlagsAndReranksWithinOneNeighborhood`. Device: turn off Precise Location; the approximate warning appears and results still load (see limitation L2) |
| P8 | Cached-first startup | `AUTO` · `SIM` · `iPhone` | `cachedResultsAppearBeforeNetworkAndRefreshReranks`; simulator relaunch showed cached results and revalidated all five published tiles with `304` |
| P9a | Server unreachable (network failure) | `AUTO` · `SIM` | `partialRefreshFailureKeepsUsableCachedResults`; simulator with the Worker stopped (the simulator itself stayed online): cached map, list, distance and bearing shown with the "could not be loaded or refreshed" message |
| P9b | Airplane mode (no network at all) | `iPhone` | **Not verified.** P9a is not equivalent: it only makes one host unreachable. On device: load data, enable airplane mode, force-quit, relaunch |
| P10 | Map / list / detail | `AUTO` · `SIM` · `iPhone` | UI tests (#60, phases `light`/`dark`/`large-text`): map ≥ 200 pt with the first result visible, row → detail (type, distance, bearing, access, freshness, last verified, attribution, Maps handoff button, report) and map pin → detail. Device: the same with real location and data |
| P11 | Filters | `AUTO` · `iPhone` | `NearbyDomainTests`; UI tests (#60): physical-type filter → empty state → "絞り込みを解除", paper filter keeps unknown support. Device: each filter |
| P12 | Destination search | `iPhone` | Needs Apple Maps search; search failure message when offline |
| P13 | Walking detour ranking | `AUTO` · `iPhone` | `RouteSearchTests`; device: pick a destination, detour minutes appear, unconfirmed rows say so |
| P14 | Navigation handoff to Maps | `iPhone` | Detail → walking directions opens Apple Maps at the spot |
| P15 | Attribution | `AUTO` · `iPhone` | `local:smoke` attribution check (server side); UI tests (#60): detail shows the attribution link and Data & Privacy lists the source and licence. Device: the same against the deployed backend |
| P16 | Japanese localization | `AUTO` · `SIM` · `iPhone` | The #60 UI tests run in Japanese and drive eligibility, Nearby (loaded, empty, offline, denied), filters, detail, Data & Privacy and the report form by their Japanese labels; #61 `testJapaneseStaleAndLocationCopy` covers Watch stale/no-location copy. Device: read every screen |
| P17 | Dynamic Type / accessibility sizes | `AUTO` · `SIM` · `iPhone` | UI test phase `large-text` (#60, `accessibility-extra-extra-extra-large`): first result reachable by scrolling, detail scrolls to the report action. Scroll every screen on device |
| P18 | Report draft save / resume / discard | `AUTO` · `iPhone` | `ReportFlowTests`; UI test (#60): edit, close, resume keeps the draft, discard, never submitted. Device: draft survives relaunch |
| P19 | Report submission (unattested, local/`disabled`) | `AUTO` · `iPhone` · `BACKEND` | `ReportFlowTests`; device: a build configured with a reachable origin (#53) against a backend in the unattested/`disabled` mode |
| P20 | Report failure / retry | `AUTO` · `iPhone` | Ambiguous POST keeps the draft and never resends by itself; rate limit blocks immediate retry |
| P21 | App Attest: register → assert → `201` | `AUTO` · `iPhone` · `BACKEND` | Needs a signed device build, a deployment with the three App Attest values, and its `CFBundleVersion` listed |
| P22 | App Attest: unsupported device / unavailable config | `AUTO` · `iPhone` | `unsupportedDeviceNeverAttemptsAnything`, `appAttestDeploymentOnAnUnsupportedDeviceIsUnavailableNotDowngraded`, `unavailableConfigDisablesSubmission`. The simulator only showed the unrelated "availability unknown" state (config unreachable) |
| P23 | App Attest: bundle version not listed | `AUTO` · `iPhone` · `BACKEND` | "Update the app"; key kept |
| P24 | Launch / background / foreground | `iPhone` | Background 10+ min, return: location refresh, no duplicate requests, detail still open |

## Backend / data

| # | Case | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Tile `200` / `304` / `404` | `AUTO` · `SIM` · `BACKEND` | Local only: `local:smoke`, and the simulator app fetched the 3×3 neighbourhood (`200` + `404`) and revalidated with `304`. Against a production-like deployment: `OPERATIONS.md` step 5 |
| B2 | Publication / registry state | `AUTO` | `local:pipeline`: 5 tiles unchanged, `excluded: []`; `local:quality`: 0 failed |
| B3 | Production-like config | `AUTO` · `BACKEND` | `--env staging` locally: fail-closed `503`. Remote smoke is `OPERATIONS.md` step 5 |
| B4 | Contract compatibility | `AUTO` | `configChoosesTheProtocolAndRefusesUnsupportedRanges`, `configGatesAvailabilityAndSchema`; `SlippyTileContractTests` and `tile-vectors.test.ts` share `contracts/tiles/slippy-xyz-vectors.v1.json` |
| B5 | No raw location/history in logs | `AUTO` · `BACKEND` | `deploy-config.test.ts` (`invocation_logs: false` everywhere); no `console.*` in `services/api/src`. Remote: confirm in the dashboard that invocation logs stay off |
| B6 | Remote deployment with real published data | `BACKEND` | `OPERATIONS.md` steps 1–5 |

## Apple Watch

| # | Case | Status | Evidence / how to check on device |
| --- | --- | --- | --- |
| W1 | First-use notice | `AUTO` · `SIM` · `Watch` | UI test `testFirstUseReachesNearby` (#61): notice shown, Continue tapped, no-snapshot instruction shown. Device: the same with a real paired iPhone |
| W2 | Snapshot transfer from iPhone | `AUTO` · `Watch` | `WatchSyncTests`, codec tests. Device: open iPhone Nearby, then the Watch shows places |
| W3 | Cached / offline launch | `AUTO` · `Watch` | `cachedLaunchAndPreferencesNeedNoPhone`; device: iPhone off / out of range |
| W4 | Nearby results (top three) | `AUTO` · `Watch` | `watchLocationDeterminesTopThreeDistanceAndBearing`; UI test `testSavedResultsLeadAndOnlyTopThreeAppear` (#61, seeded snapshot) |
| W5 | Freshness | `AUTO` · `Watch` | `freshnessUsesCurrentTimeAndUnknownHoursAreNotOpen`; UI tests (#61): snapshot older than an hour is labelled old, and a failed, denied or old location fix never shows a distance as current |
| W6 | Filters | `AUTO` · `Watch` | quick-filter tests; UI test `testQuickFiltersCanEmptyAndClearResults` (#61): no-results state and Clear filters. Device: each control |
| W7 | Distance / bearing | `AUTO` · `Watch` | Walk and confirm the bearing turns |
| W8 | Navigation handoff | `AUTO` · `Watch` | `navigationKeepsStraightLineFallback`; device: Maps opens (watchOS 11.4+) |
| W9 | Full scroll, Digital Crown | `SIM` · `Watch` | #61 UI tests reach the last list action and detail source content by simulator swipe; that proves scrollability, not the Digital Crown. Device: every list and detail scrolls to its last row with the Crown |
| W10 | Large text | `Watch` | The watchOS simulator refuses content-size changes (`Runtime does not support dynamic text`) |

## iPhone widget (#32)

The widget reads only `nearby-glance-v1.json` from the App Group, written by the app when its
Nearby cache callback runs. States come from `NearbyGlance.state(at:)`: *stale* after one hour, or
when the location was last-known; *empty* when a fresh glance has no place; *unavailable* when
there is no readable file.

| # | Case | Status | Evidence / how to check on device |
| --- | --- | --- | --- |
| G1 | Widget can be added (small, medium, Lock Screen rectangular) | `iPhone` | Home Screen and Lock Screen gallery list "Nearby"; each family renders |
| G2 | App Group snapshot is readable by the widget | `AUTO` · `iPhone` · `BACKEND` | `freshStaleEmptyAndDecode`, `malformedAndUnavailable`. Device: after Nearby loads, the widget shows the same nearest place (not "Nearby data unavailable") — proves the signed group works for both processes |
| G3 | Fresh state | `AUTO` · `iPhone` · `BACKEND` | `freshStaleEmptyAndDecode`. Device: name, distance and "Verified …" / "Verification date unknown" match the app's first unfiltered result |
| G4 | Stale state | `AUTO` · `iPhone` · `BACKEND` | `freshStaleEmptyAndDecode`. Device: wait over an hour without opening the app (or use a last-known location); "Nearby data is old · Open app to refresh", no distance shown |
| G5 | Empty / no snapshot | `AUTO` · `iPhone` | `freshStaleEmptyAndDecode`, `malformedAndUnavailable`. Device, fresh install before opening Nearby: "Nearby data unavailable". Outside the Taito area after a completed load (needs a configured build and backend): "No saved nearby places" |
| G6 | Tap opens the app | `iPhone` | Every state opens MannerPath at Nearby (`mannerpath://nearby`) |
| G7 | Spot-specific deep link | `AUTO` · `iPhone` · `BACKEND` | `deepLinks`, `widgetLinkCanResolveCachedSpotHiddenByFilters`. Device: tap a fresh widget; the spot's detail opens, including with a filter that hides it; a spot no longer nearby opens plain Nearby |
| G8 | Widget does not request location or network | `iPhone` | Source: no `CoreLocation` / `URLSession` in `MannerPathWidgets`, `MannerPathGlanceShared`. Device: in airplane mode the widget still shows the saved state and reloads without a location prompt; Settings → Privacy → Location Services lists no separate widget entry |
| G9 | App Intent "Open Nearby" | `AUTO` · `iPhone` | `appIntentOpensApp`; device: widget configuration shows it and it opens the app |

## Watch widget / Smart Stack (#32)

The Watch widget reads the existing Watch snapshot from the App Group. It is *stale* one hour after
`generatedAt`, *unavailable* when there is no readable snapshot (including an unavailable group).

| # | Case | Status | Evidence / how to check on device |
| --- | --- | --- | --- |
| WG1 | Entry can be added (Smart Stack / rectangular complication) | `Watch` | Smart Stack suggests or allows adding "Nearby"; a face with a rectangular slot accepts it |
| WG2 | Existing Watch snapshot is shown | `AUTO` · `iPhone` · `Watch` · `BACKEND` | `widgetStatesUseSavedSnapshotOnly`. Device after W2: first place name, "From iPhone", verification age |
| WG3 | Stale / offline state is honest | `AUTO` · `iPhone` · `Watch` · `BACKEND` | `widgetStatesUseSavedSnapshotOnly`. Device: iPhone off / out of range for over an hour; "Old data from iPhone", never presented as current. No snapshot: "Open iPhone app to sync" |
| WG4 | Tap opens the Watch app | `Watch` | Tapping the entry launches MannerPath on Watch, which re-ranks with the Watch's location |
| WG5 | Upgrade migration from the private Watch store | `AUTO` · `Watch` | `groupMigrationKeepsNewestStateAndSurvivesMissingOrCorruptOldFiles`, `migrationReconcilesNewerPrivateSnapshotAndPreferences`. Device: with the previous beta (pre-#32) holding a snapshot and changed Watch filters, install the new build over it **before** opening iPhone Nearby; the Watch shows the old places and keeps the filters, and the widget shows them too |
| WG6 | Widget does not request location or network | `Watch` | Source: no `CoreLocation` / `URLSession` in `MannerPathWatchWidgets`, `MannerPathWatchShared`. Device: no location prompt from the widget |

## App Group and signing (#32)

`group.com.kounishiyuuki.MannerPath` must be registered in Apple Developer and enabled for all four
signing identifiers. A group missing from one identifier fails only on device, not in the simulator.

| # | Target | Status | How to check on device |
| --- | --- | --- | --- |
| S1 | iPhone app `com.kounishiyuuki.MannerPath` | `iPhone` · `BACKEND` | Development-signed install with the group entitlement succeeds (sharing itself is proved by S2) |
| S2 | iPhone widget `com.kounishiyuuki.MannerPath.widgets` | `iPhone` · `BACKEND` | G2 passes (widget is not stuck on "Nearby data unavailable" after a load) |
| S3 | Watch app `com.kounishiyuuki.MannerPath.watchkitapp` | `Watch` · `BACKEND` | W3 still works and WG2 shows the snapshot the Watch app saved |
| S4 | Watch widget `com.kounishiyuuki.MannerPath.watchkitapp.widgets` | `Watch` · `BACKEND` | WG2 passes (not stuck on "Open iPhone app to sync" while the Watch app shows places) |

## Accessibility

| # | Case | Status | Evidence |
| --- | --- | --- | --- |
| A1 | VoiceOver labels / values / hints on list rows, map pins, filters | `iPhone` · `Watch` | Source sets them (`NearbySpotRow` label + value, pin labels, hints); only VoiceOver on device proves reading order |
| A2 | Dynamic Type | `SIM` (iPhone) · `Watch` | P17, W10 |
| A3 | Accessibility-size layouts | `SIM` · `iPhone` | P17 |

## Physical-device procedure

### Beta artifact preflight (#54)

Before the device matrix, run `MANNERPATH_API_BASE_URL=https://<staging-host> make apple-beta-preflight`.
Save its output with the #35 evidence. This builds an unsigned Release **simulator** app and checks
the four embedded bundle IDs, source App Group and iPhone App Attest entitlements, HTTPS origin,
and build number. It cannot prove signing or device behavior. In Xcode, select a generic iOS device,
set the Release `MANNERPATH_API_BASE_URL` to the staging HTTPS origin, then use Product → Archive
with the team's development signing setup. For that actual device/archive artifact,
run `./scripts/apple-beta-preflight.sh /path/to/MannerPath.xcarchive` (or the signed
`MannerPath.app`) and save that output too. The signed inspection reads entitlements from each
embedded code signature and checks each embedded provisioning profile's team, application ID,
and App Group; correct source entitlements alone do not prove provisioned App Groups.
Use the printed `CFBundleVersion` in the backend App Attest allowlist and match its effective
development/production environment to the backend. Do not include certificates or profiles in
the evidence. If archive creation or signed inspection fails, fix signing before P1/W1. A passing
archive inspection still needs the physical S1–S4, P21–P23, widget, and Watch rows below.

1. Deploy a staging backend (`OPERATIONS.md` steps 1–5) and record the smoke output.
2. Build the iPhone app with the staging HTTPS origin (`MANNERPATH_API_BASE_URL`, fixed by #53;
   confirm the built `Info.plist` holds it) and a development
   signing identity whose four identifiers have the App Group (S1–S4). For P21/P23, set
   `REPORT_APP_ATTEST_ENVIRONMENT=development` and
   list the build's `CFBundleVersion` on the disposable E2E environment (`OPERATIONS.md`
   "Disposable App Attest E2E environment", #55), never on the long-lived staging database.
3. On a device that still has the previous beta, run P2 (upgrade) and WG5 (Watch migration). Then
   delete the app and walk P1, P3–P24, G1–G9, W1–W10, WG1–WG6, S1–S4 and A1–A3 in order,
   standing inside the published Taito area
   (tiles `14/14552–14554/6449–6450`).
4. For each row record: pass/fail, device + OS version, build number, and a screenshot for failures.
5. File every failure as its own issue referencing #35; do not widen #35.

## Known limitations for the beta

- **L1** Launch geography is the Taito fixture only: 32 published spots (of 34 canonical) in 5 z14 tiles. Elsewhere Nearby is
  empty by design.
- **L2** Approximate location can be kilometres off; the 3×3 z14 neighbourhood (~6 km across) may
  then miss the user's real surroundings. The app warns that the location is approximate.
- **L3** The client reads only the report block of `/v1/config`. It uses a fixed data zoom of 14
  and does not yet read `dataTileZoom` or the tile / spot-detail schema ranges (`OPERATIONS.md`
  "Apple beta build → API base URL"). Safe while the server stays at zoom 14 and tile schema 1.
- **L4** No offline turn-by-turn routing (ADR-0004): offline users get straight-line distance and bearing.
- **L5** Remote report acceptance stays closed until the App Attest values are set, which
  `OPERATIONS.md` step 6 makes conditional on deciding how reports survive a blue/green switch.
  P21/P23 run on the disposable E2E environment (#55) instead, so they do not wait for that decision.
- **L6** Widgets (#32) show only the single nearest cached place and refresh hourly at best; they
  never fetch or locate on their own, so they go stale until the app is opened.
