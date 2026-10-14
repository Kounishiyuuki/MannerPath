# v1 physical-device, signing and TestFlight readiness matrix

The run sheet for the first signed build: what the repository already proves, what only a
physical device or a signed/TestFlight build can prove, and what only the maintainer's Apple account
can do. Row IDs (P*, W*, G*, WG*, S*, A*) are the ones in [`BETA_E2E_CHECKLIST.md`](../BETA_E2E_CHECKLIST.md),
which keeps the simulator/automation history. This file supersedes its "Physical-device procedure"
for v1 (production, nationwide, read-only; reports unavailable).

Audited 2026-10-09 on `main` `a37fdcf`; device results for TestFlight 1.0 (2) recorded 2026-10-14 (§0).
Writing this file ran nothing on a device and changed nothing in Apple Developer / App Store Connect / Cloudflare.

**Result column.** Only `PASS 1.0 (N)`, `FAIL 1.0 (N)`, `PARTIAL 1.0 (N)` (some expectations observed; the
note says which are still open) or empty (not run). A result always names the build it was observed on, and a
row is never filled from simulator, unit-test or source evidence. `python3 scripts/test-device-release-matrix.py`
(run by `make contract`) enforces this.

## 0. Build history and observed device results

| Build | Source | Uploaded | Device result |
| --- | --- | --- | --- |
| 1.0 (1) | `main` after #252 | yes | superseded by 1.0 (2); no device rows recorded |
| 1.0 (2) | `main` `2c133ba` (#254, #255; **not** #259) | 2026-10-14, signed preflight passed | rows marked `1.0 (2)` below |
| 1.0 (3) | not built | — | §8 checklist; first build carrying #259 live search |

Observed by the maintainer on an iPhone with TestFlight 1.0 (2), production API, standing in Kanazawa
(device model, iOS version and time were not recorded; record them from Build 3 on):

| Observation | Row |
| --- | --- |
| "上野駅" found from Kanazawa | D1 |
| 上野駅 set as destination | D2 |
| Smoking places around Ueno shown | D3 |
| Place detail opened from the list | P10 (partial) |
| Distance, bearing and official confirmation shown in the detail | P10 (partial), D4 |
| Apple Maps directions opened | P14 |
| Distant destination shows the "no walking detour" message instead of a routing failure | D5 |

Everything else in §4 is **not yet observed on a device**, including every Watch, widget, VoiceOver,
large-text, offline/cache, location-permission and first-launch row.

## 1. Target inventory (from `xcodebuild -showBuildSettings`, Debug and Release identical unless noted)

| Target | Bundle ID | Min OS | Family | Entitlements (source) | Signing |
| --- | --- | --- | --- | --- | --- |
| `MannerPath` (iPhone app) | `com.kounishiyuuki.MannerPath` | iOS 18.0 | 1 | App Group `group.com.kounishiyuuki.MannerPath`; `devicecheck.appattest-environment = development` | Automatic, team `58A7G4U27M` (project level, Personal team — provisional) |
| `MannerPathWidgets` | `com.kounishiyuuki.MannerPath.widgets` | iOS 18.0 | 1 | App Group | Automatic, inherited team |
| `MannerPathWatch Watch App` | `com.kounishiyuuki.MannerPath.watchkitapp` | watchOS 11.0 | 4 | App Group | Automatic, inherited team; `WKCompanionAppBundleIdentifier = com.kounishiyuuki.MannerPath` |
| `MannerPathWatchWidgets` | `com.kounishiyuuki.MannerPath.watchkitapp.widgets` | watchOS 11.0 | 4 | App Group | Automatic, inherited team |

Version `MARKETING_VERSION 1.0`, build `CURRENT_PROJECT_VERSION 2` on all four (raise per upload; Build 3 is §8).
No `PROVISIONING_PROFILE_SPECIFIER` pinned. App Attest environment: TestFlight/App Store builds use
production regardless of the `development` value in the source file (Apple behavior; observed in the signed
1.0 (2) export: `appattest-environment = production` on the iPhone app).

### Debug vs Release

| Item | Debug | Release |
| --- | --- | --- |
| `MANNERPATH_API_BASE_URL` | unset (cache-only Nearby; tests pass an override) | `https://mannerpath-api-production.happywestyuki.workers.dev` |
| `MANNERPATH_PUBLIC_SITE_URL` | unset (links hidden) | `https://kounishiyuuki.github.io/MannerPath/` |
| `SWIFT_ACTIVE_COMPILATION_CONDITIONS` | `DEBUG` | none |
| Watch UI-test hooks (`--mannerpath-watch-ui-test`, `MANNERPATH_WATCH_UI_TEST_*`) | compiled in (`#if DEBUG`) | compiled out; the preflight fails if the strings are in a binary |
| Entitlements | same files | same files |
| localhost / `http://` | none in app sources/plists (UI-test scripts pass `http://127.0.0.1:8787` only to Debug test builds) | rejected by the preflight in every embedded Info.plist, nested values included |

## 2. Automated release gate (repo side, no account needed)

`make apple-beta-preflight` → `scripts/apple-beta-preflight.sh` (no argument): unsigned
**Release archive** for `generic/platform=iOS` from the committed settings (overrides refused), then
`scripts/check-apple-beta-artifact.py --unsigned-build`. With a signed `.xcarchive`/`.app` argument it
reads signed entitlements and embedded profiles instead. Both modes then require
`security-secret-scan.py --artifact` on that same app (including embedded bundles); suspects or scanner
execution errors fail the whole preflight. The output must show artifact files > 0 and suspects = 0.
Fail-closed correctness checks:

| Check | Unsigned | Signed |
| --- | --- | --- |
| Four bundles embedded (iPhone widget, Watch app, Watch widget) with exact bundle IDs | ✓ | ✓ |
| Watch `WKCompanionAppBundleIdentifier` = iPhone app | ✓ | ✓ |
| Version / build present and identical in all four | ✓ | ✓ |
| `MannerPathAPIBaseURL` = production HTTPS origin; `MannerPathPublicSiteURL` = Pages origin (iPhone required; any bundle that carries either key must use the same canonical value) | ✓ | ✓ |
| Every Info.plist at any depth (iPhone, Watch, both widgets, any other extension/framework), nested dict/array values: URLs parsed — HTTPS only; no `localhost`/`*.localhost`; no IP-literal host (127.0.0.0/8, `::1`, IPv4-mapped loopback, private, link-local, numeric forms); no secret-looking key (`apiKey`, `APIToken`, `client_secret`, `Authorization`, `Bearer`, `pepper`, … case/separator-insensitive; public origins and bundle IDs exempt) | ✓ | ✓ |
| Project build settings, every target and configuration: no secret-looking setting name; Release has no `DEBUG` condition; exactly one Release target sets the canonical origins | ✓ | ✓ |
| No Debug UI-test hook strings in any bundle executable or dylib; no `*.debug.dylib` / `__preview.dylib` anywhere in the artifact | ✓ | ✓ |
| `NSLocationWhenInUseUsageDescription` on iPhone and Watch; no `NSLocationAlways*` in any bundle; widgets/other extensions carry no `NSLocation*` / `NSWidgetWantsLocation` | ✓ | ✓ |
| `UIDeviceFamily [1]`; AppIcon in `CFBundleIcons`, `Assets.car`, 1024 px rendition (iPhone, Watch) | ✓ | ✓ |
| `PrivacyInfo.xcprivacy` in both app hosts | ✓ | ✓ |
| App Group `[group.com.kounishiyuuki.MannerPath]` in all four | source files | signed code signature + embedded profile |
| App Attest entitlement on iPhone app | source file | signed, and equal to profile |
| Code signature valid, `DTPlatformName` device, profile team/app ID match | — | ✓ |
| Distribution signature, all four bundles: profile without `ProvisionedDevices`, `get-task-allow` false, `beta-reports-active` true; iPhone App Attest `production` (`check-apple-beta-artifact.py --distribution`, exported App Store Connect app only) | — | opt-in |

Release-configuration evidence and its limit: with no argument the wrapper itself archives
`-configuration Release` (a fixture test pins this contract and the override refusal), and the output says so.
For an artifact supplied by path the checker sees only structure — no Debug/preview dylib, no Debug-only hook
strings, the Release-only origins present — and prints `Release configuration: NOT PROVEN`; Xcode records no
build configuration in the bundle, so that is absence of Debug traces, not proof of a Release build. The
maintainer's own Organizer/`xcodebuild archive` record is the evidence for a signed archive. URL checks
cover Info.plist values; strings compiled into executables are not URL-parsed.

Failure fixtures: `python3 scripts/test-apple-beta-preflight.py`. Other repo gates: `make apple-validate`
(iOS + Watch tests, Watch build, Release built-plist origin check), `make contract`.

Not automated (and why): `ITSAppUsesNonExemptEncryption` is absent by design until the export-compliance
decision (`APP_STORE_SUBMISSION.md` §4; answered in App Store Connect per build, T5); localisation completeness is covered by the Japanese UI tests.

## 3. Report gate (read-only v1)

Expected and checked: production `REPORT_ATTESTATION=required` (`services/api/wrangler.jsonc`), no App Attest
values, so live `/v1/config` returns `reports.available: false` (read-only GET, 2026-10-09). The client maps it
to unavailable (`unavailableConfigDisablesSubmission`); there is no unattested fallback on a `required`
deployment (`appAttestDeploymentOnAnUnsupportedDeviceIsUnavailableNotDowngraded`). Device check is R1 below.
Do **not** enable reporting for this run. Future report intake (P21/P23 on the disposable E2E environment,
`OPERATIONS.md`, `REPORT_APP_ATTEST_ENVIRONMENT=production` for TestFlight) is a separate lane after v1.

## 4. Physical-device matrix

Record per row: device model + OS, build `CFBundleVersion`, signing type (development / TestFlight),
local time, PASS/FAIL, screenshot on failure. Severity: **P0** blocks TestFlight distribution to testers /
submission; **P1** blocks App Store submission; **P2** recorded, does not block.
Environment for every row: signed Release build pointing at production (`§2` signed preflight passed),
iPhone paired with the Watch, standing inside published coverage unless the row says otherwise.

### iPhone

| # | Precondition | Steps | Expected | Evidence | Sev | Result |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | App deleted | Install, launch | Eligibility notice first, Japanese on a Japanese device | screenshot | P0 | |
| P3 | P1 | Tap "確認しました"; force-quit; relaunch | Nearby; notice not shown again | — | P1 | |
| P4 | Location not determined | Open Nearby; tap "現在地を使用"; allow While Using | Prompt only after the tap; results load from production | screenshot | P0 | |
| P5 | Location denied | Deny; tap "設定を開く"; re-allow; return | Denial message; Settings opens app page; results after re-allow | — | P1 | |
| P7 | Precise Location off | Relaunch Nearby | Approximate warning; results still load | screenshot | P1 | |
| P10 | Loaded | Map, list, row → detail, pin → detail | Type, distance, bearing, access, freshness, last verified, attribution | screenshot | P0 | PARTIAL 1.0 (2): row → detail with distance, bearing, official confirmation (destination area). Open: pin → detail, type, access, freshness, last verified, attribution, device-location area |
| P11 | Loaded | Each filter; clear | Empty state then results; unknown support not hidden | — | P1 | |
| P12/P13 | Online | Search a destination; pick result | Results with detour minutes; unconfirmed marked | — | P1 | PARTIAL 1.0 (2): distant search and pick (D1–D3). Open: a walkable destination with detour minutes (D6) |
| P14 | Detail open | Walking directions | Apple Maps opens at the spot | — | P0 | PASS 1.0 (2) (from a destination-area detail; confirm the pin lands on the spot on Build 3) |
| P15 | Detail open | Open attribution / Data & Privacy, privacy and support links | Source + licence; Pages links open | — | P1 | |
| P8/P9b | Data loaded | Airplane mode; force-quit; relaunch | Cached list, distance, bearing, freshness; failure message honest | screenshot | P0 | |
| P9c | Fresh install, airplane mode | Launch | "読み込めませんでした"; not "no places" | screenshot | P1 | |
| P9d | Outside published coverage | Load | Honest empty/coverage state | screenshot | P1 | |
| P17 | Largest accessibility text | Every screen | All actions reachable by scrolling | — | P1 | |
| A1 | VoiceOver on | List rows, pins, filters, detail | Labels + values read in a sensible order; all operable | notes | P1 | |
| P16a | Dark and light appearance | Nearby, detail, Data & Privacy | Legible, no invisible text | screenshot | P2 | |
| P24 | Loaded, detail open | Background ≥10 min; return | Detail still open, location refresh, no crash | — | P1 | |
| R1 | Production (reports off) | Open detail and About | "Reports are currently unavailable."; no report/App Attest request while browsing | — | P0 | |
| AI1 | First run on the paid team | Launch app | No crash at launch. Smoke only: it is **not** provisioning evidence — that is the T3 signed preflight output plus G2/S1–S2 and WG2/S3–S4 | — | P0 | |

### Apple Watch

| # | Precondition | Steps | Expected | Evidence | Sev | Result |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | Clean install, iPhone Nearby not yet opened | Open Watch app | First-use notice → "open iPhone to sync" | screenshot | P0 | |
| W2 | iPhone Nearby loaded | Open Watch app | Same nearby places; sync time | screenshot | P0 | |
| W2b | W2, then Watch app quit | Turn iPhone Bluetooth off/on; reopen iPhone Nearby; reopen Watch | Snapshot updates after reconnect | — | P1 | |
| W3 | W2; iPhone off/out of range; Watch Wi-Fi/cellular off | Force-quit; reopen | Cached places and filters remain | — | P0 | |
| W5 | W3 for > 1 h | Reopen | Labelled old; no current distance from an old fix | screenshot | P0 | |
| W5b | Snapshot holds exact, approximate and unknown-precision spots | Open each detail | Approximate is visibly approximate; unknown never presented as exact | screenshot | P0 | |
| W4/W6/W7 | Outdoors | Top three; each filter; walk and refresh twice | ≤ 3 rows; empty + clear; bearing turns plausibly | notes | P1 | |
| W8 | Place detail | Directions | Apple Maps opens at the destination | — | P1 | |
| W9/W10 | Large text on Watch | Crown to last row in list and detail | No clipped action; long Japanese names wrap | screenshot | P1 | |
| A1W | VoiceOver on Watch | List, detail, filters, stale message, Directions | Read and operable | notes | P1 | |

### Widgets and App Group (proves `iPhone writes → widget reads → Watch receives`)

| # | Precondition | Steps | Expected | Evidence | Sev | Result |
| --- | --- | --- | --- | --- | --- | --- |
| G5 | Fresh install, Nearby not opened | Add small widget | "Nearby data unavailable" | screenshot | P1 | |
| G1 | — | Add small, medium Home Screen and Lock Screen rectangular | Each renders | screenshot | P1 | |
| G2/S1/S2 | iPhone Nearby loaded | Look at widgets | Same first unfiltered place, distance, verification text as the app (App Group shared on device) | screenshot | **P0** | |
| G3/G3b | G2 with an approximate / unknown-precision first place | Look at widget | Approximate stays visibly approximate; unknown verification says unknown | screenshot | P0 | |
| G4 | App unopened > 1 h | Look at widget | "Nearby data is old"; no distance | screenshot | P1 | |
| G6/G7 | Each state | Tap | Opens Nearby / spot detail (also when filtered out) | — | P1 | |
| G8 | Airplane mode | Reload widget | Renders saved state; no widget location prompt or Location Services entry | — | P1 | |
| G10 | — | Nearby loaded, then compare widget timeline after next app refresh | Widget updates after the app writes (reload timing ≤ the system budget; note observed delay) | notes | P2 | |
| WG1 | — | Smart Stack + rectangular complication on a face | Entry added and renders | screenshot | P1 | |
| WG2/S3/S4 | W2 done | Look at Watch widget | Same first place as Watch app, "From iPhone", verification age | screenshot | **P0** | |
| WG3 | iPhone away > 1 h | Look | "Old data from iPhone"; clean install: "Open iPhone app to sync" | screenshot | P1 | |
| WG4/WG6 | — | Tap entry | Watch app opens; no widget location prompt | — | P1 | |

App Group fallback (by design, no crash): if the container is unavailable the iPhone skips the glance write and
the widget stays "unavailable"; the Watch keeps a private cache. A widget stuck on "unavailable" / "Open iPhone app
to sync" after a successful load therefore means a provisioning failure (S2/S4), not a data problem.

### Destination search regression (#254 dual-region search, #255 route states, #259 live search)

Automated cover (simulator/unit, not device evidence): `RouteSearchTests` —
`namedDistantDestinationOutranksNearbyResultsForTheSameQuery`, `genericQueriesKeepNearbyResultsFirstAndDuplicatesCollapse`
(#254); `distantDestinationIsTooFarRatherThanUnavailable`, `destinationWithoutSavedPlacesIsNotReportedAsRoutingFailure`,
`walkingDistanceGate*` (#255); `liveSearch*`, `emptyOrDeletedQueryNeverSearchesAndClears`,
`lateOlderAnswerNeverReplacesNewerMatchesWhichStayVisibleWhileTyping`, `failedLiveSearchIsShownAndCanBeRetried`,
`submittingTheTypedQueryDoesNotSendASecondRequest`, `choosingAMatchCancelsAPendingLiveSearch` (#259); UI tests
`testDestinationSuggestionsAppearWhileTyping`, `testDestinationSearchCanBeOperated`,
`testOutsideJapanDestinationLoadsPublishedTokyoPlaces` (real MapKit + production tile).

| # | PR | Precondition | Steps | Expected | Sev | Result |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | #254 | In Kanazawa (or any place far from Tokyo), online | Type "上野駅" and search | 上野駅 (Tokyo) is the first match, above local stations | P0 | PASS 1.0 (2) |
| D2 | #254 | D1 | Tap the match | Destination row shows 上野駅; device-area places are replaced | P0 | PASS 1.0 (2) |
| D3 | #254 | D2 | Look at map and list | Published Taito places around Ueno appear on map and list | P0 | PASS 1.0 (2) |
| D4 | — | D3 | Open a place | Distance/bearing are labelled as from the destination, not the device; official confirmation shown | P0 | PARTIAL 1.0 (2): distance, bearing, official confirmation seen; the "from the selected destination" wording not recorded |
| D5 | #255 | D2 (destination beyond walking range) | Look under the destination row | 「目的地が現在地から遠いため、徒歩の寄り道は計算しません。直線距離と方角で表示します。」; no 「徒歩ルートを利用できません」 failure text | P0 | PASS 1.0 (2) |
| D6 | #255 | Destination within walking range of the device, with places nearby | Pick it | 「徒歩での寄り道を確認中です…」 then places ranked with added walking minutes | P1 | |
| D7 | #255 | Destination within range but no published places nearby | Pick it | Empty-list explanation only; no routing-failure text | P1 | |
| D8 | #254 | Kanazawa | Search "カフェ" | Nearby cafés first; distant ones after; no duplicates; ≤ 8 matches | P1 | |
| L1 | #259 | Build 3; online | Type "上野" one character at a time, do not press search | Matches appear while typing (≈0.3 s after the last key); keyboard stays up; matches are tappable | P0 | |
| L2 | #259 | L1 | Keep typing "上野駅" quickly, then pause | Earlier matches stay visible until the newer answer replaces them; an older answer never comes back | P0 | |
| L3 | #259 | L1 | Press the keyboard search key after the matches appear | No flicker or second result change (one request) | P1 | |
| L4 | #259 | Matches shown | Delete the whole query | Matches disappear; no search for an empty query | P1 | |
| L5 | #259 | Matches shown | Tap a match while still typing | Destination is set; no late match list reappears | P0 | |
| L6 | #259 | Airplane mode | Type a query | Failure message, existing destination kept; after airplane off, typing again searches | P1 | |
| L7 | #259 | VoiceOver on | Type with the on-screen keyboard, swipe to a match, double-tap | Matches are announced and selectable | P1 | |
| L8 | #259 | Largest accessibility text | Type and pick | Matches readable and reachable by scrolling | P1 | |

### Search sheet refresh regression (#263, only if it is merged before Build 3)

Skip this table when the Build 3 commit does not contain #263. Its UI tests (`NativeSearchSheetUITests`) run outside
`make apple-validate`, so these rows are the device evidence.

| # | PR | Precondition | Steps | Expected | Sev | Result |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | #263 | Build 3 with #263; online | Drag the sheet between medium and large, then back | Both detents reachable; map stays usable at medium | P0 | |
| U2 | #263 | U1 | Tap search, type "上野", pick a match | Matches scroll into view when typing starts; picking dismisses search and the keyboard; destination row shown | P0 | |
| U3 | #263 | Destination set | Read the list | Names and distance lead each row; route/precision/freshness warnings and 「約」/approximate notes still shown | P0 | |
| U4 | #263 | Filters that match nothing | Apply, then clear | Empty state with a working clear action; list recovers | P1 | |
| U5 | #263 | Settings → Accessibility → Reduce Transparency on | Open the sheet | Solid readable background; text contrast kept | P1 | |
| U6 | #263 | iOS 18–25 device if available (iOS 26 otherwise, note the version) | Open the sheet in Light and Dark | Sheet surface readable in both; no clipped controls | P1 | |
| U7 | #263 | Largest accessibility text, VoiceOver on | Search, swipe to a match, double-tap | Rows readable by scrolling; matches announced and selectable; targets ≥ 44 pt | P1 | |

### API, cache and offline procedure

Run in this order on one install; each step's evidence is a screenshot and the local time.

1. **API fetch** (P4/P10): online, inside coverage, tap 「現在地を使用」. Expect 「近くの場所の情報を更新しました。」 and
   places. Optional: *Settings → Privacy & Security → App Privacy Report* afterwards lists only the production API
   host and Apple hosts (§6 item 4).
2. **Cached display** (P8/P9b): airplane mode, force-quit, relaunch. Expect the same places with distance, bearing
   and freshness, and an honest "couldn't refresh" message; never "no places".
3. **No cache** (P9c): delete the app, reinstall from TestFlight, airplane mode before first launch. Expect
   「読み込めませんでした」, not the no-published-places state.
4. **Destination while offline** (L6): with step 2's cache, search a destination. Expect a search failure that
   keeps the cached area.
5. **Recovery**: airplane off, pull/refresh. Expect a new update time.
6. **Watch/widget follow-on** (W2, W3, G2, G8): after step 1, check the Watch and the widget, then repeat step 2's
   airplane mode on both.

Automated cover (not device evidence): `testCachedResultsRemainAndFailureIsExplained`,
`testNoCacheAndNoBackendIsDistinctFromNoPublishedPlaces`, `NearbyPersistenceE2E`, `TileSync` tests.

### Not yet observed on any device (open after 1.0 (2))

- **Widgets / App Group**: G1–G10, WG1–WG6. The P0 rows G2/S1–S2, G3/G3b and WG2/S3–S4 are the only proof that the
  App Group works in a signed build; the signed entitlements alone do not prove it.
- **Watch**: W1–W10, A1W. W1, W2, W3, W5, W5b are P0.
- **VoiceOver and large text**: A1, A1W, P17, W9/W10, L7, L8.
- **iPhone**: P1, P3–P5, P7, P8/P9b, P9c, P9d, P11, P15, P16a, P24, R1, AI1, D6–D8.

## 5. TestFlight preflight

| # | Item | Repo state | Owner |
| --- | --- | --- | --- |
| T1 | Paid Developer Program; team ID; change project-level `DEVELOPMENT_TEAM` if not `58A7G4U27M` (reviewed PR) | provisional Personal team | **MAINTAINER ACTION** |
| T2 | Register 4 App IDs, App Group on all four, App Attest on iPhone app (Xcode automatic signing or one deliberate `-allowProvisioningUpdates` archive) | entitlements READY | **MAINTAINER ACTION** |
| T3 | Signed Release archive → `./scripts/apple-beta-preflight.sh <archive>.xcarchive`; save output (no profiles/certificates) | script READY | MAINTAINER ACTION (needs T1–T2) |
| T4 | Raise `CURRENT_PROJECT_VERSION` per upload; all four equal (preflight enforces) | 1.0 (2) | repo PR |
| T5 | Upload via Organizer; answer export compliance for the build in App Store Connect (`APP_STORE_SUBMISSION.md` §4). Required **before the build can go to any tester** (it stays "Missing Compliance" until answered), so it is P0, not a post-TestFlight item | `ITSAppUsesNonExemptEncryption` absent | **MAINTAINER ACTION** · SIGNED BUILD (in App Store Connect) |
| T6 | Privacy manifests, usage descriptions | both hosts carry `PrivacyInfo.xcprivacy`; When-In-Use string on iPhone and Watch (preflight) | AUTOMATED |
| T7 | Support/privacy URLs | Release Pages origin (preflight); live links #179 | AUTOMATED |
| T8 | Icon | 1024 px rendition both hosts (preflight); physical appearance → device | AUTOMATED + PHYSICAL |
| T9 | Locales | `en` development, `ja` | AUTOMATED (UI tests) |
| T10 | Internal testers; external testers need Beta App Review info | — | **MAINTAINER ACTION** · TESTFLIGHT ONLY |

## 6. Signed-binary privacy / artifact evidence (TESTFLIGHT ONLY or signed archive)

1. Xcode Organizer → archive → *Generate Privacy Report*; save the PDF. Expect only Apple frameworks plus GRDB
   (`Package.resolved`, 7.9.0); compare with `APP_PRIVACY_INVENTORY.md` §"Privacy manifests".
2. Included SDKs / embedded frameworks: `find <archive>/Products/Applications/MannerPath.app -name '*.framework'`
   and `otool -L` on each executable; anything beyond system frameworks and GRDB (static) is a finding.
3. Entitlements: the signed preflight output (all four bundles) and
   `codesign -d --entitlements - <bundle>`; the TestFlight build's App Attest environment is production.
4. Network destinations: on device, *Settings → Privacy & Security → App Privacy Report* after one browse
   session; expect only the production API host, Apple Maps/MapKit and the Pages host when links are opened.
5. Record results in `PRODUCTION_PRIVACY_AUDIT.md` (security/privacy decisions stay in that lane).

## 7. Release blocker classification (2026-10-09)

Severity (when it blocks) and class (who/what can produce the evidence) are separate axes. Every §4 row keeps
its own severity; this section only groups them.

| Severity | Items |
| --- | --- |
| P0 — before the build goes to any tester | T1–T3 signed archive + signed preflight; T5 upload **and export-compliance answer**; §4 P0 rows: P1, P4, P10, P14, P8/P9b, R1, AI1, W1, W2, W3, W5, W5b, G2/S1–S2, G3/G3b, WG2/S3–S4 |
| P1 — before App Store submission (may follow the first TestFlight) | every §4 P1 row (iPhone, Watch, widgets, A1/A1W VoiceOver, P17/W9/W10 large text), T10 external testers, §6 privacy report and SDK/entitlement inventory, physical icon appearance, final export-compliance/territory re-check for the submitted build |
| P2 — recorded, not blocking | P16a, G10, `nearby-spots.json` fixture in bundle (`APPLE_DISTRIBUTION_READINESS.md` §3) |

| Class | Items |
| --- | --- |
| AUTOMATED (repo, no account) | §2 unsigned Release archive + artifact/build-setting checks and fixtures, Debug/Release origin check, iOS/Watch tests, T6–T9 repo side; live `reports.available:false` (read-only GET) |
| PHYSICAL DEVICE ONLY | every §4 row |
| MAINTAINER ACTION | T1, T2, T3, T5, T10; App Store Connect record, legal/privacy signoff (`RELEASE_CHECKLIST.md`) |
| SIGNED BUILD (no TestFlight needed) | T3 signed preflight (signature, profiles, App Group, App Attest entitlement), §6 items 2–3 on the signed archive, AI1 |
| TESTFLIGHT ONLY | T10 tester distribution, App Attest production environment of the distributed build, §6 items 1 and 4 for the distributed build |
| APP STORE BEFORE SUBMISSION | all P1 above closed, final export-compliance/territory decision for the submitted build, screenshots/Review Notes and legal signoff (`APP_STORE_SUBMISSION.md`) |

## 8. Build 3 distribution checklist (not started)

Build 3 is the first build with #259 live search. Do these in order; stop at the first failure.

1. `main` contains #259, #265 and — only if merged — the #263 search-sheet refresh; `git log origin/main` recorded
   in the PR. Whether #263 is in decides if the U table runs in step 9.
2. Repo PR raising `CURRENT_PROJECT_VERSION` to 3 in all 16 configurations; `MARKETING_VERSION` stays 1.0;
   no Info.plist hard-codes a build number.
3. On that PR: `make apple-validate`, `make contract`, `make security-validate` all exit 0; CI green; merge.
4. Archive from the merged `main` commit (Release, automatic signing, team `58A7G4U27M`).
5. `./scripts/apple-beta-preflight.sh <archive>.xcarchive` and on the exported IPA: exit 0,
   `CFBundleVersion for App Attest server: 3`, `Release artifact scan: … suspects=0`.
6. `python3 scripts/check-apple-beta-artifact.py --distribution <unzipped IPA>/Payload/MannerPath.app` exits 0 (covers the
   profile, `get-task-allow`, `beta-reports-active`, App Group and App Attest items below). Then confirm by eye
   what it does not check: the `Apple Distribution` signing identity (`codesign -dvv`).
   Signed checks on all four bundles: 1.0 (3), `Apple Distribution` team `58A7G4U27M`, `codesign --verify --strict`,
   no provisioned devices, `get-task-allow` false, `beta-reports-active` true, App Group
   `group.com.kounishiyuuki.MannerPath`; iPhone app `appattest-environment = production`; Info.plist origins
   `https://mannerpath-api-production.happywestyuki.workers.dev` and `https://kounishiyuuki.github.io/MannerPath/`.
7. Production `/v1/config` still reports `reports.available: false` (read-only GET); no secret, D1 or Cloudflare change.
8. Upload; App Store Connect processing finished; export compliance answered; internal group only (no external
   testers, no review submission).
9. On device, record model, iOS/watchOS version, build and time per row, then run in this order:
   L1–L8, U1–U7 (only with #263), D1–D5 regression, D6–D8, the API/cache/offline procedure, P10 remainder, R1, W1–W5b, G2/G3, WG2.
10. Fill the Result column only with what was observed on 1.0 (3); leave the rest empty.
