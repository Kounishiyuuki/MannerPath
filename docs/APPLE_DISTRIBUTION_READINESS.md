# Apple distribution readiness — v1.0 (Archive → TestFlight → App Store Connect)

Re-audited 2026-10-05 on `main` 58630b4 (after #190), from the project file, asset catalogs, entitlements files,
the processed (`.xcent`) entitlements of a Release build, a Release archive and the locally cached profile.
Local only: no Developer Portal, App Store Connect, Cloudflare or backend operation; no `-allowProvisioningUpdates`
(it would create profiles). No icon artwork is added.

Docs-only reconciliation on 2026-10-06 against main `cef7f055d0a3cb1b4d1baf223097b8c0e1b24cd9`:
the historical archive results below are not rerun here. #191/#193 confirm production Release J/K/L,
Reduce Motion simulator behavior, source processing notice and Watch license Link implementation.
Icon plumbing is complete; icon images, paid team confirmation, provisioning, signed archive/TestFlight
and physical-device evidence remain open. No Developer Portal or App Store Connect change is implied.

## 1. Bundles and signing

| Bundle | Bundle ID | Family | Signing | Team | Entitlements file |
| --- | --- | --- | --- | --- | --- |
| iPhone app | `com.kounishiyuuki.MannerPath` | 1 | Automatic | project-level `58A7G4U27M` | `MannerPath.entitlements` |
| iPhone widget (appex) | `com.kounishiyuuki.MannerPath.widgets` | 1 | Automatic | project-level | `MannerPathWidgets/MannerPathWidgets.entitlements` |
| Watch app (single-target watchOS app, companion `com.kounishiyuuki.MannerPath`) | `com.kounishiyuuki.MannerPath.watchkitapp` | 4 | Automatic | project-level | `MannerPathWatch Watch App/MannerPathWatch.entitlements` |
| Watch widget (appex) | `com.kounishiyuuki.MannerPath.watchkitapp.widgets` | 4 | Automatic | project-level | `MannerPathWatchWidgets/MannerPathWatchWidgets.entitlements` |

No separate WatchKit extension. No manual profile, identity or `PROVISIONING_PROFILE_SPECIFIER` is pinned. Version 1.0
(build 1) on every target; raise `CURRENT_PROJECT_VERSION` for each upload. `DEVELOPMENT_TEAM` lives once at project
level (Debug and Release, #188) and all four bundles inherit it.

**`58A7G4U27M` is a Personal (free) Team — a provisional value.** Evidence: the only cached profile for it,
“iOS Team Provisioning Profile: com.kounishiyuuki.MannerPath”, was issued with a 7-day lifetime (2026-09-29 → 2026-10-06),
one device, and only `get-task-allow` / keychain entitlements: no App Groups, no App Attest. After Developer Program
enrollment, read the paid team ID in Xcode → Settings → Accounts; if it differs, change the one project-level value.

## 2. Entitlements, App Groups and App Attest

Processed entitlements of the Release build (`.xcent`), identical in intent to the source files:

| Bundle | `application-identifier` | Other entitlements |
| --- | --- | --- |
| iPhone app | `58A7G4U27M.com.kounishiyuuki.MannerPath` | `application-groups = [group.com.kounishiyuuki.MannerPath]`, `devicecheck.appattest-environment = development` |
| iPhone widget | `58A7G4U27M.com.kounishiyuuki.MannerPath.widgets` | `application-groups = [group.com.kounishiyuuki.MannerPath]` |
| Watch app | `58A7G4U27M.com.kounishiyuuki.MannerPath.watchkitapp` | `application-groups = [group.com.kounishiyuuki.MannerPath]` |
| Watch widget | `58A7G4U27M.com.kounishiyuuki.MannerPath.watchkitapp.widgets` | `application-groups = [group.com.kounishiyuuki.MannerPath]` |

**App Group `group.com.kounishiyuuki.MannerPath` — required in production.** The iPhone app writes the nearby glance
(`NearbyGlanceFile.group`, `PhoneGlancePublisher`) that the iPhone widget reads; the Watch app keeps its snapshot in the
group so the Watch widget can read it (`WatchStore`). Fallback without the container: the iPhone skips the glance write
and the widget shows its unavailable state; the Watch keeps a private cache (`WatchStore.migrate`). No crash path.
Portal work: register the group and enable App Groups on all four App IDs (automatic signing does this, §4).

**App Attest — not used by read-only v1, kept as a capability.** Server: production `REPORT_ATTESTATION=required`
with no App Attest secrets, so live `/v1/config` reports `reports.available:false` and report/App Attest routes fail closed.
Client: `ReportModel` maps that to `.unavailable`; `DCAppAttestService` is reached only through `AppAttestDevice` on an
explicit report submission, never while browsing. Keeping the entitlement means the iPhone App ID needs the App Attest
capability for signing, and lets reporting be enabled later by backend configuration without a new binary. App Store/
TestFlight builds use the production App Attest environment (repository note in `scripts/check-apple-beta-artifact.py`);
confirm on the first TestFlight build. No Keychain sharing, iCloud, push or associated domains; WatchConnectivity needs no entitlement.

## 3. Build and archive results (2026-10-05, current tree)

| Check | Result |
| --- | --- |
| Release simulator build | succeeds; `.xcent` entitlements as in §2 |
| Unsigned Release archive (`generic/platform=iOS`, `CODE_SIGNING_ALLOWED=NO`) | **ARCHIVE SUCCEEDED**; four bundles embedded; `UIDeviceFamily [1]`; 1.0 (1); `MannerPathAPIBaseURL` = production; `MannerPathPublicSiteURL` = Pages origin; `check-apple-beta-artifact.py --unsigned-build` passes |
| Signed archive attempt (automatic signing, no provisioning updates) | fails only on provisioning: no profiles for `….widgets`, `….watchkitapp`, `….watchkitapp.widgets`; the Personal Team profile for the app lacks App Groups and App Attest |
| App icon | **P0, artwork only.** Plumbing is ready (this change): iPhone `AppIcon.appiconset` with one iOS universal 1024 × 1024 slot, iPhone `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` (Debug/Release), Watch `AppIcon.appiconset` with one watchOS 1024 × 1024 slot and its existing setting. Both slots are empty, so the archive still has no `CFBundleIcons`/`Assets.car`; App Store Connect rejects the upload until images are added |

`nearby-spots.json` (a unit-test fixture unused by the shipping composition) is bundled — P2.
`ENABLE_APP_SANDBOX` / `ENABLE_USER_SELECTED_FILES` on the iPhone target are macOS settings, inert on iOS — P2.

## 4. User actions to reach TestFlight (in order)

| # | Where | Action |
| --- | --- | --- |
| 1 | developer.apple.com | Complete Developer Program enrollment; accept agreements |
| 2 | Xcode → Settings → Accounts | Sign in; note the paid team ID. If not `58A7G4U27M`, change project-level `DEVELOPMENT_TEAM` (Debug + Release) in a reviewed PR |
| 3 | Maintainer artwork | Provide rights-cleared 1024 × 1024 PNG(s) without transparency (no tobacco imagery/brands): add to `MannerPath/Assets.xcassets/AppIcon.appiconset` and `MannerPathWatch Watch App/Assets.xcassets/AppIcon.appiconset` (set each `filename` in `Contents.json`); confirm `CFBundleIcons` and `Assets.car` in a new archive |
| 4 | Xcode → each of the four targets → Signing & Capabilities | With “Automatically manage signing” and the paid team, Xcode registers the four App IDs, the App Group (all four) and App Attest (iPhone app) and creates profiles. Equivalent CLI: one deliberate `xcodebuild archive … -allowProvisioningUpdates` |
| 5 | Xcode → Product → Archive (Release) | Then `./scripts/apple-beta-preflight.sh <archive>` (signed mode: provisioning, App Group in every signed bundle, App Attest environment) |
| 6 | Organizer → Distribute App → App Store Connect | Creates/uses the ASC app record (`APP_STORE_CONNECT_ENTRY.md` §10); answer export compliance for the build |
| 7 | App Store Connect → TestFlight | Internal testers (no Beta App Review); external testers need Beta App Review information |
| 8 | Physical iPhone + paired Apple Watch | Widgets populated through the App Group (first real proof), Watch sync, offline cache, Data & Privacy links and mail compose, reports unavailable, no report/App Attest calls while browsing, accessibility |

## 5. Status summary

| Area | Status |
| --- | --- |
| Signing configuration in repo | READY except the provisional Personal Team ID (user input, §4 step 2) |
| Entitlements / App Group / App Attest declarations | READY and consistent across the four bundles |
| Provisioning / capabilities | WAITING_FOR_DEVELOPER_PROGRAM |
| App icon | P0: plumbing ready; artwork from maintainer |
| Archive | unsigned succeeds; signed blocked only by provisioning |
| Upload / TestFlight | after §4 steps 1–5 |
