# iPad readiness for MannerPath v1 — audit and decision material

Audited 2026-10-05 on `main` 9e7ba3d (after #181), iPad Pro 13-inch (M5) simulator, iOS 26.5, Japanese.

**Decision (maintainer, 2026-10-05): MannerPath v1 ships for iPhone + Apple Watch only.**

- The iPad simulator audit found **no P0 and no P1** (§2–3).
- v1 provides **no native iPad UI**: the iPhone app and iPhone widget are `TARGETED_DEVICE_FAMILY = 1`.
- On iPad, the app remains usable in **iPhone compatibility mode** (the audited iPhone layout in an iPhone-size window).
- Native iPad support (regular-width layout, the P2 items below) is reconsidered **after v1 (v1.x or later)**.
- Split View / Slide Over, iPad VoiceOver order and other iPad-native checks are **outside v1 native scope**.

## 1. Configuration audited (before the decision)

| Item | Value |
| --- | --- |
| `TARGETED_DEVICE_FAMILY` | iPhone app `1,2` (iPhone + iPad); iPhone widget extension `1,2`; Watch app/widget `4`; MannerPathTests `1,2`; MannerPathUITests `1` (runner only; does not limit the app) |
| iPad orientations | all four (`INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad`); no `UIRequiresFullScreen`, so iPad multitasking (Split View / Slide Over) applies |
| Scene / navigation | one `WindowGroup` → `ContentView` → `NavigationStack`; no `NavigationSplitView`, no size-class or idiom branches anywhere in the iPhone app |
| Presentation | report, quick-confirm and filter sheets (filters use `.presentationDetents([.medium, .large])`), eligibility notice as `fullScreenCover` |
| Layout assumptions | iPhone layout stretched to full width; only the eligibility notice caps width (560 pt); map fixed at 240 pt height; MKMapView-backed clustered map |

## 2. Simulator audit results

Full `scripts/run-iphone-ui-tests.sh` phase set run with the device swapped to iPad Pro 13-inch (portrait):
first-launch, not-determined, light, dark, large-text (AX5), offline-cached, clean-offline, denied, visual-audit.
**23 of 25 tests passed.** Landscape checked separately with a temporary (uncommitted) test plus direct
`simctl io screenshot` captures; that test passed.

Screens seen working on iPad: eligibility notice, location not-determined / denied, map and list, place detail
(evidence, approximate location, community tier, unknown values), walking-route preview and Maps handoff,
filters (empty result and clear), destination search, cached offline and clean offline, Data & Privacy, sources /
attribution, report-unavailable copy (reports-unknown state), add-place with duplicate warning, dark, AX5, landscape.

The two failures are **UI-test harness limits, not app defects**: on iPad, report and add-place forms are centered
form sheets, and the helper `scrollTo` drags along the screen's left edge (x = 0.02), which lands on the dimmed
backdrop outside the sheet. Screenshots show both forms rendered and operable (add-place reached the duplicate warning).
XCTest screenshots taken in landscape were cropped/black-banded; direct simulator captures show correct layout.

## 3. Findings

| Severity | Finding |
| --- | --- |
| P0 (App Store / crash / unusable) | none |
| P1 (clear layout breakage) | none |
| P2 | iPhone layout stretched across 13": very long text lines and list rows, wide empty space (portrait and landscape) |
| P2 | map is a short 240 pt band across the full width |
| P2 | filter sheet with `.medium` detent renders as a small bottom card on iPad; content clipped but scrollable |
| Test | `scrollTo` cannot scroll iPad form sheets (2 tests); not part of `make apple-validate` |
| Out of v1 native scope | iPad Split View / Slide Over sizes, physical iPad, VoiceOver order on iPad, iPad 11"/mini sizes (not checked; v1 has no native iPad UI) |

## 4. Cost of keeping iPad in v1

| Work | Estimate |
| --- | --- |
| Code fixes required | 0 (no P0/P1). Optional P2 polish (readable content width, taller map on regular width): 1–2 focused changes in `ContentView`/`SpotDetailView`, plus re-audit |
| UI tests | make `scrollTo` drag inside the frontmost sheet (1 helper change) and add an iPad phase to `run-iphone-ui-tests.sh` |
| Screenshots | an extra required 13" set (2064 × 2752), captured with production data, per release |
| Accessibility | repeat VoiceOver / Dynamic Type / Reduce Motion checks on a physical iPad |
| Ongoing QA | every UI change re-checked on iPad (≈45 min extra simulator run per release) plus multitasking sizes |

## 5. Changes for iPhone-only (applied 2026-10-05)

| Item | Change |
| --- | --- |
| Build settings | `TARGETED_DEVICE_FAMILY` `1,2` → `1` for the MannerPath app (Debug, Release) and the iPhone widget extension (Debug, Release): 4 lines in `project.pbxproj`. `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad` becomes inert (may be removed) |
| Watch | no effect (family `4`; the Watch app's companion is the iPhone app) |
| Tests | MannerPathTests (`1,2`) and UITests (`1`) unaffected; `make apple-validate` uses iPhone 17 and Watch simulators |
| App Store Connect | no iPad screenshot set required |
| Residual iPad exposure | iPhone-only apps still install on iPad in iPhone compatibility mode, and App Review may run them there; the app must remain functional in that window (the iPhone layout, which this audit shows works) |

## 6. App Icon — exact missing state (P0, artwork from maintainer)

Update 2026-10-05 (distribution readiness): the iPhone `AppIcon.appiconset` slot and the iPhone
`ASSETCATALOG_COMPILER_APPICON_NAME` were added; only the artwork remains. The table below is the state at audit time.

| Target | Asset catalog | `ASSETCATALOG_COMPILER_APPICON_NAME` | Missing |
| --- | --- | --- | --- |
| MannerPath (iPhone app) | `MannerPath/Assets.xcassets` contains only `AccentColor.colorset` | **not set** (Debug and Release) | an `AppIcon.appiconset` with a 1024 × 1024 iOS universal image (optional dark and tinted variants), and the build setting `AppIcon` on both configurations |
| MannerPathWatch Watch App | `Assets.xcassets/AppIcon.appiconset` exists | `AppIcon` (Debug and Release) | the image for its single slot: `idiom universal`, `platform watchos`, `size 1024x1024` |
| iPhone / Watch widget extensions | no asset catalog | — | nothing (extensions use the containing app's icon) |

No image was generated or added. The maintainer supplies rights-cleared artwork (no tobacco imagery or brands);
then the set, the iPhone build setting and an archive check land in one focused change.

## 7. Recommendation (adopted)

**iPhone + Apple Watch only for v1.0**, revisiting iPad in a later version with a regular-width layout.
Reasoning: iPad works (no P0/P1), so either choice is shippable, but keeping iPad adds a required screenshot set and
per-release iPad QA while delivering a stretched iPhone layout (P2). iPhone-only is a 4-line build-setting change,
and iPad users still get the working iPhone layout in compatibility mode. If the maintainer prefers to keep iPad,
nothing blocks it: fix the test helper, add the iPad phase, and capture the 13" screenshots.

## 8. Applied change and verification

| Target | Before | After |
| --- | --- | --- |
| MannerPath (iPhone app) Debug / Release | `"1,2"` | `1` |
| MannerPathWidgets (iPhone widget) Debug / Release | `"1,2"` | `1` |
| Watch app, Watch widget, Watch tests | `4` / watchOS SDK | unchanged |
| MannerPathTests (hosted unit-test bundle) | `"1,2"` | unchanged; not a shipping or iPad target |

No native iPad target remains. App Store Connect needs iPhone and Apple Watch screenshot sets only.
The App Icon P0 (§6) is unchanged and still blocks upload.
