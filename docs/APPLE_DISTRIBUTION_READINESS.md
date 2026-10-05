# Apple distribution readiness — v1.0 (Archive → TestFlight → App Store Connect)

Audited 2026-10-05 on `main` cb8de21 (after #186). Local only: no Developer Portal, App Store Connect, Cloudflare or
backend operation; no `-allowProvisioningUpdates` (it would create profiles). App Icon artwork is not added here.
Values below were read from `project.pbxproj`, the entitlements files and a Release archive of the current tree.

## 1. Bundles and signing

| Bundle | Bundle ID | Family | Signing | Team | Entitlements file |
| --- | --- | --- | --- | --- | --- |
| iPhone app | `com.kounishiyuuki.MannerPath` | 1 | Automatic | project-level `58A7G4U27M` | `MannerPath.entitlements` |
| iPhone widget (appex) | `com.kounishiyuuki.MannerPath.widgets` | 1 | Automatic | project-level | `MannerPathWidgets/MannerPathWidgets.entitlements` |
| Watch app (single-target watchOS app, companion `com.kounishiyuuki.MannerPath`) | `com.kounishiyuuki.MannerPath.watchkitapp` | 4 | Automatic | project-level | `MannerPathWatch Watch App/MannerPathWatch.entitlements` |
| Watch widget (appex) | `com.kounishiyuuki.MannerPath.watchkitapp.widgets` | 4 | Automatic | project-level | `MannerPathWatchWidgets/MannerPathWatchWidgets.entitlements` |

There is no separate WatchKit extension (modern single-target Watch app). No manual profile or identity is pinned.
Version 1.0 (build 1) on every target; raise `CURRENT_PROJECT_VERSION` for each upload.

**Fixed in this change (P1):** the two widget extensions had no `DEVELOPMENT_TEAM`, so a signed archive stopped with
“Signing for "MannerPathWidgets" / "MannerPathWatchWidgets" requires a development team”. `DEVELOPMENT_TEAM` now lives
once at project level (Debug and Release) and all four targets inherit it; the target-level copies on the app and
Watch app were removed. If the Developer Program team ID differs from `58A7G4U27M`, change that one project-level value.

## 2. Entitlements

| Entitlement | Where | v1 need |
| --- | --- | --- |
| `com.apple.security.application-groups = [group.com.kounishiyuuki.MannerPath]` | all four bundles | **Required**: the app writes the nearby glance and Watch snapshot files that the widgets read (`NearbyGlanceFile.group`) |
| `com.apple.developer.devicecheck.appattest-environment = development` | iPhone app | **Keep (capability needed for archive/signing as declared)**; v1 read-only does not use App Attest (production `/v1/config` `reports.available:false`, the app never registers while browsing). Keeping it lets report intake be enabled later by backend configuration without a new binary. App Store/TestFlight builds use the production App Attest environment (`scripts/check-apple-beta-artifact.py` note); confirm on the first TestFlight build |
| Keychain sharing, iCloud, push, associated domains | none | not used; not needed |
| WatchConnectivity | none | needs no entitlement |
| `ENABLE_APP_SANDBOX` / `ENABLE_USER_SELECTED_FILES` build settings on the iPhone app | build settings only | macOS settings, inert for iOS; harmless (P2 cleanup) |

Removing the App Attest entitlement is **not** recommended: it would not unblock anything once the paid team exists,
and re-adding it later needs a new binary and review.

## 3. Archive readiness (what actually happens today)

| Check | Result |
| --- | --- |
| Unsigned Release archive (`xcodebuild archive … CODE_SIGNING_ALLOWED=NO`) | **ARCHIVE SUCCEEDED**; app, iPhone widget, Watch app and Watch widget embedded; `UIDeviceFamily [1]`; `MannerPathAPIBaseURL` = production; `MannerPathPublicSiteURL` = Pages origin; `PrivacyInfo.xcprivacy` in app and Watch app |
| `scripts/check-apple-beta-artifact.py <unsigned app> --unsigned-build` | passes (bundle IDs, App Group in every bundle, API origin, CFBundleVersion, embedding) |
| Signed archive attempt (automatic signing, no provisioning updates), before the fix | team errors for both widgets, plus the profile errors below |
| Signed archive attempt after the fix | only profile errors remain: no profiles for `….widgets`, `….watchkitapp`, `….watchkitapp.widgets`; the app's current team profile lacks App Groups and App Attest |
| App icon | **P0, unresolved**: no `CFBundleIcons`/`Assets.car` in the archive; iPhone has no `AppIcon` set and no `ASSETCATALOG_COMPILER_APPICON_NAME`; Watch `AppIcon` 1024 slot empty ([IPAD_V1_READINESS.md §6](IPAD_V1_READINESS.md)). Archive builds; App Store Connect upload validation rejects missing icons |

No other repository-side archive blocker was found. `nearby-spots.json` (a unit-test fixture read only by
`FixtureSpotRepository`, unused by the shipping composition) is bundled in the app — P2, harmless.

## 4. After Developer Program approval — exact steps

1. Xcode → Settings → Accounts: sign in with the enrolled Apple ID; confirm the paid team ID. If it is not
   `58A7G4U27M`, change the project-level `DEVELOPMENT_TEAM` (one line, Debug and Release) in a reviewed PR.
2. Open the project, select each of the four targets → Signing & Capabilities with “Automatically manage signing”:
   Xcode registers the four App IDs, the App Group `group.com.kounishiyuuki.MannerPath` (all four), and App Attest
   (iPhone app), and creates development profiles. Or: `xcodebuild … -allowProvisioningUpdates` once, deliberately.
3. Add the maintainer's App Icon artwork (P0) and the iPhone `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`; rebuild
   and confirm `CFBundleIcons` and `Assets.car` in the archive.
4. Product → Archive (Release). Then run `./scripts/apple-beta-preflight.sh <archive>` (signed mode):
   checks provisioning, App Group in every signed bundle and the App Attest environment.
5. Organizer → Distribute App → App Store Connect (creates the ASC app record if needed; see
   [APP_STORE_CONNECT_ENTRY.md](APP_STORE_CONNECT_ENTRY.md) §10). Answer export compliance for the build.
6. Generate the archive's Privacy Report in Organizer and compare with [PRODUCTION_PRIVACY_AUDIT.md](PRODUCTION_PRIVACY_AUDIT.md).

## 5. TestFlight readiness

| Stage | Items |
| --- | --- |
| Before upload | paid team + agreements; App IDs/App Group/App Attest registered (step 2); App Icon (P0); build number raised; Release origins verified (`scripts/check-iphone-api-base-url.sh`) |
| After upload | build processing; export compliance answer; internal testers group (no Beta App Review needed for internal); for external testers: Beta App Review information, test notes, contact |
| On physical devices (iPhone + paired Apple Watch) | install from TestFlight; location When In Use; nearby/detail/route/Maps handoff; offline cache; **widgets populated through the App Group** (iPhone small/medium/accessory, Watch widget) — first real proof of App Group sharing; Watch sync over WatchConnectivity; Data & Privacy links and mail compose; reports stay unavailable; VoiceOver, Dynamic Type, Reduce Motion/Transparency; no network calls to report/App Attest routes while browsing |

## 6. Status summary

| Area | Status |
| --- | --- |
| Signing configuration in repo | READY (team at project level; automatic signing on all four bundles) |
| Provisioning / capabilities | WAITING_FOR_DEVELOPER_PROGRAM (App Groups, App Attest, four App IDs, profiles) |
| Entitlements | READY as declared (App Group required; App Attest kept, unused in v1) |
| Archive | builds unsigned; signed archive blocked only by provisioning (Developer Program) |
| Upload | BLOCKED by App Icon P0 (maintainer artwork) and provisioning |
| TestFlight | after the above; device checks listed in §5 |
