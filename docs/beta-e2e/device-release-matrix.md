# v1 physical-device, signing and TestFlight readiness matrix

The run sheet for the first signed build: what the repository already proves, what only a
physical device or a signed/TestFlight build can prove, and what only the maintainer's Apple account
can do. Row IDs (P*, W*, G*, WG*, S*, A*) are the ones in [`BETA_E2E_CHECKLIST.md`](../BETA_E2E_CHECKLIST.md),
which keeps the simulator/automation history. This file supersedes its "Physical-device procedure"
for v1 (production, nationwide, read-only; reports unavailable).

Audited 2026-10-09 on `main` `a37fdcf`. Nothing here was run on a device, signed, uploaded, or
changed in Apple Developer / App Store Connect / Cloudflare.

## 1. Target inventory (from `xcodebuild -showBuildSettings`, Debug and Release identical unless noted)

| Target | Bundle ID | Min OS | Family | Entitlements (source) | Signing |
| --- | --- | --- | --- | --- | --- |
| `MannerPath` (iPhone app) | `com.kounishiyuuki.MannerPath` | iOS 18.0 | 1 | App Group `group.com.kounishiyuuki.MannerPath`; `devicecheck.appattest-environment = development` | Automatic, team `58A7G4U27M` (project level, Personal team — provisional) |
| `MannerPathWidgets` | `com.kounishiyuuki.MannerPath.widgets` | iOS 18.0 | 1 | App Group | Automatic, inherited team |
| `MannerPathWatch Watch App` | `com.kounishiyuuki.MannerPath.watchkitapp` | watchOS 11.0 | 4 | App Group | Automatic, inherited team; `WKCompanionAppBundleIdentifier = com.kounishiyuuki.MannerPath` |
| `MannerPathWatchWidgets` | `com.kounishiyuuki.MannerPath.watchkitapp.widgets` | watchOS 11.0 | 4 | App Group | Automatic, inherited team |

Version `MARKETING_VERSION 1.0`, build `CURRENT_PROJECT_VERSION 1` on all four (raise per upload).
No `PROVISIONING_PROFILE_SPECIFIER` pinned. App Attest environment: TestFlight/App Store builds use
production regardless of the `development` value in the source file (Apple behavior; confirm on the
first TestFlight build, T5).

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
| P10 | Loaded | Map, list, row → detail, pin → detail | Type, distance, bearing, access, freshness, last verified, attribution | screenshot | P0 | |
| P11 | Loaded | Each filter; clear | Empty state then results; unknown support not hidden | — | P1 | |
| P12/P13 | Online | Search a destination; pick result | Results with detour minutes; unconfirmed marked | — | P1 | |
| P14 | Detail open | Walking directions | Apple Maps opens at the spot | — | P0 | |
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

## 5. TestFlight preflight

| # | Item | Repo state | Owner |
| --- | --- | --- | --- |
| T1 | Paid Developer Program; team ID; change project-level `DEVELOPMENT_TEAM` if not `58A7G4U27M` (reviewed PR) | provisional Personal team | **MAINTAINER ACTION** |
| T2 | Register 4 App IDs, App Group on all four, App Attest on iPhone app (Xcode automatic signing or one deliberate `-allowProvisioningUpdates` archive) | entitlements READY | **MAINTAINER ACTION** |
| T3 | Signed Release archive → `./scripts/apple-beta-preflight.sh <archive>.xcarchive`; save output (no profiles/certificates) | script READY | MAINTAINER ACTION (needs T1–T2) |
| T4 | Raise `CURRENT_PROJECT_VERSION` per upload; all four equal (preflight enforces) | 1.0 (1) | repo PR |
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
