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
| `BLOCKED` | Cannot pass until the named issue is fixed |

A row may carry more than one status: `AUTO` coverage never replaces the physical check it lists.

## Release blocker found by this checklist

**A build never receives an API base URL.** `INFOPLIST_KEY_MannerPathAPIBaseURL` is a custom key,
and Xcode's generated Info.plist (`GENERATE_INFOPLIST_FILE = YES`, no `INFOPLIST_FILE`) ignores
`INFOPLIST_KEY_*` settings it does not recognise. The build setting itself resolves correctly
(`-showBuildSettings` prints `INFOPLIST_KEY_MannerPathAPIBaseURL = https://…`), both through a
command-line override and through an uncommitted `.xcconfig` using the `https:/$()/` escape, yet
the built app has no `MannerPathAPIBaseURL` key. `NearbyComposition.apiBaseURL` is the only reader
of the origin, so:

- no tile refresher is created: Nearby is cache-only, and a clean install shows
  "No saved places nearby — Live updates are unavailable";
- the report model gets `UnconfiguredReportClient`: availability stays "unknown" and
  "Check reporting again" can never succeed;
- an existing tile cache still works offline, but nothing can populate one.

Reproduce with:

```sh
xcodebuild build -project apps/apple/MannerPath/MannerPath.xcodeproj -scheme MannerPath \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/mp-dd \
  MANNERPATH_API_BASE_URL=https://example.invalid
plutil -p /tmp/mp-dd/Build/Products/Debug-iphonesimulator/MannerPath.app/Info.plist | grep MannerPathAPIBaseURL
# expected: one line; observed: nothing
```

On a physical device this blocks **every row that needs published data**, not only the rows tagged
`BLOCKED (base URL)`: P1–P2, P7–P11, P13–P15, P17 with data, P19–P23, and W2–W9 (the Watch snapshot
comes from the iPhone's tile cache). The `BLOCKED` tag marks rows whose *automated or simulator*
evidence cannot be completed either. The `SIM` backend rows were observed
by adding the key to a scratch copy of the built app (`PlistBuddy -c "Add :MannerPathAPIBaseURL
string http://127.0.0.1:8787"`, then ad-hoc re-signing) — a test-only workaround, never a build step.

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

Watch tests are not part of `make apple-validate`; run them explicitly:

```sh
xcodebuild test -project apps/apple/MannerPath/MannerPath.xcodeproj \
  -scheme "MannerPathWatch Watch App" \
  -destination "platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)" \
  -only-testing:"MannerPathWatch Watch AppTests"
```

## iPhone

| # | Case | Status | Evidence / how to check on device |
| --- | --- | --- | --- |
| P1 | Clean install, first launch | `SIM` · `iPhone` | Fresh simulator: eligibility notice shown first, in Japanese. On device: delete the app, install the beta build, launch |
| P2 | Local-schema upgrade (install new build over the previous beta) | `iPhone` | Install previous beta, open Nearby once, install new build over it; cached places still appear before any refresh |
| P3 | Eligibility notice | `SIM` · `iPhone` | Simulator: shown on first launch. Acceptance was simulated by writing `eligibilityNoticeAccepted`, not by tapping — tap "確認しました" on device and confirm it is not shown again |
| P4 | Location: not determined → allow While Using | `AUTO` · `iPhone` | `permissionIsRequestedOnlyByExplicitAction`. Device: prompt appears only after "現在地を使用" |
| P5 | Location: denied | `SIM` · `iPhone` | Simulator: denial message and "設定を開く". Device: deny, confirm Settings opens the app's page, re-allow and return |
| P6 | Location: restricted (Screen Time) | `iPhone` | "Location access is restricted" message, no crash |
| P7 | Approximate vs precise | `AUTO` · `iPhone` | `usableLocationRetainsAccuracyFlagsAndReranksWithinOneNeighborhood`. Device: turn off Precise Location; the approximate warning appears and results still load (see limitation L2) |
| P8 | Cached-first startup | `AUTO` · `SIM` · `iPhone` | `cachedResultsAppearBeforeNetworkAndRefreshReranks`; simulator relaunch showed cached results and revalidated all five published tiles with `304` |
| P9a | Server unreachable (network failure) | `AUTO` · `SIM` | `partialRefreshFailureKeepsUsableCachedResults`; simulator with the Worker stopped (the simulator itself stayed online): cached map, list, distance and bearing shown with the "could not be loaded or refreshed" message |
| P9b | Airplane mode (no network at all) | `iPhone` | **Not verified.** P9a is not equivalent: it only makes one host unreachable. On device: load data, enable airplane mode, force-quit, relaunch |
| P10 | Map / list / detail | `SIM` · `iPhone` | Map pins, ranked list rows (type, access, straight-line distance, bearing, last verified, evidence). Detail on device |
| P11 | Filters | `AUTO` · `iPhone` | `NearbyDomainTests`; device: each filter, "Clear filters" on an empty result |
| P12 | Destination search | `iPhone` | Needs Apple Maps search; search failure message when offline |
| P13 | Walking detour ranking | `AUTO` · `iPhone` | `RouteSearchTests`; device: pick a destination, detour minutes appear, unconfirmed rows say so |
| P14 | Navigation handoff to Maps | `iPhone` | Detail → walking directions opens Apple Maps at the spot |
| P15 | Attribution | `AUTO` · `iPhone` | `local:smoke` attribution check (server side). Not observed in the simulator: on device, check Data & Privacy lists the source and spot detail shows it |
| P16 | Japanese localization | `SIM` · `iPhone` | Simulator (Japanese system language): eligibility notice, Nearby (loaded, empty, location denied), Watch first-use and location sections. Not observed: filters, detail, Data & Privacy, report form |
| P17 | Dynamic Type / accessibility sizes | `SIM` · `iPhone` | Largest accessibility size: header row stacks vertically, no clipping at top. Scroll every screen on device |
| P18 | Report draft save / resume / discard | `AUTO` · `iPhone` | `ReportFlowTests`; device: draft survives relaunch |
| P19 | Report submission (unattested, local/`disabled`) | `AUTO` · `BLOCKED (base URL)` | `ReportFlowTests`; device needs a reachable origin |
| P20 | Report failure / retry | `AUTO` · `iPhone` | Ambiguous POST keeps the draft and never resends by itself; rate limit blocks immediate retry |
| P21 | App Attest: register → assert → `201` | `AUTO` · `iPhone` · `BACKEND` · `BLOCKED (base URL)` | Needs a signed device build, a deployment with the three App Attest values, and its `CFBundleVersion` listed |
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
| W1 | First-use notice | `SIM` · `Watch` | Fresh watch simulator: notice shown first, in Japanese. The location section was seen after acceptance was simulated by writing `watchEligibilityNoticeAccepted`; tap "Continue" on device |
| W2 | Snapshot transfer from iPhone | `AUTO` · `Watch` | `WatchSyncTests`, codec tests. Device: open iPhone Nearby, then the Watch shows places |
| W3 | Cached / offline launch | `AUTO` · `Watch` | `cachedLaunchAndPreferencesNeedNoPhone`; device: iPhone off / out of range |
| W4 | Nearby results (top three) | `AUTO` · `Watch` | `watchLocationDeterminesTopThreeDistanceAndBearing` |
| W5 | Freshness | `AUTO` · `Watch` | `freshnessUsesCurrentTimeAndUnknownHoursAreNotOpen` |
| W6 | Filters | `AUTO` · `Watch` | quick-filter tests; device: each control, "Clear Watch filters" |
| W7 | Distance / bearing | `AUTO` · `Watch` | Walk and confirm the bearing turns |
| W8 | Navigation handoff | `AUTO` · `Watch` | `navigationKeepsStraightLineFallback`; device: Maps opens (watchOS 11.4+) |
| W9 | Full scroll, Digital Crown | `Watch` | Every list and detail scrolls to its last row |
| W10 | Large text | `Watch` | The watchOS simulator refuses content-size changes (`Runtime does not support dynamic text`) |

## Accessibility

| # | Case | Status | Evidence |
| --- | --- | --- | --- |
| A1 | VoiceOver labels / values / hints on list rows, map pins, filters | `iPhone` · `Watch` | Source sets them (`NearbySpotRow` label + value, pin labels, hints); only VoiceOver on device proves reading order |
| A2 | Dynamic Type | `SIM` (iPhone) · `Watch` | P17, W10 |
| A3 | Accessibility-size layouts | `SIM` · `iPhone` | P17 |

## Physical-device procedure

1. Deploy a staging backend (`OPERATIONS.md` steps 1–5) and record the smoke output.
2. Build the iPhone app with the staging HTTPS origin (after the base-URL blocker is fixed) and a
   development signing identity. For P21/P23, set `REPORT_APP_ATTEST_ENVIRONMENT=development` and
   list the build's `CFBundleVersion` — but `OPERATIONS.md` requires the blue/green report carry-over
   decision before App Attest values are set on any remote environment, so use a disposable
   environment or settle that decision first.
3. On a device that still has the previous beta, run P2 (upgrade). Then delete the app and walk
   P1, P3–P24, W1–W10 and A1–A3 in order, standing inside the published Taito area
   (tiles `14/14552–14554/6449–6450`).
4. For each row record: pass/fail, device + OS version, build number, and a screenshot for failures.
5. File every failure as its own issue referencing #35; do not widen #35.

## Known limitations for the beta

- **L1** Launch geography is the Taito fixture only: 34 spots in 5 z14 tiles. Elsewhere Nearby is
  empty by design.
- **L2** Approximate location can be kilometres off; the 3×3 z14 neighbourhood (~6 km across) may
  then miss the user's real surroundings. The app warns that the location is approximate.
- **L3** The client uses a fixed data zoom of 14 and does not yet read `dataTileZoom` from
  `/v1/config` (`OPERATIONS.md` "Apple beta build"). Safe while the server stays at 14.
- **L4** No offline turn-by-turn routing (ADR-0004): offline users get straight-line distance and bearing.
- **L5** Remote report acceptance stays closed until the App Attest values are set, which
  `OPERATIONS.md` step 6 makes conditional on deciding how reports survive a blue/green switch.
- **L6** Widgets / complications (#32) are outside this beta.
