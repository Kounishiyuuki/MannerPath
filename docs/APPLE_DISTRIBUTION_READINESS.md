# Apple distribution readiness — v1.0 (Archive → TestFlight → App Store Connect)

Re-audited 2026-10-05 on `main` 58630b4 (after #190), from the project file, asset catalogs, entitlements files,
the processed (`.xcent`) entitlements of a Release build, a Release archive and the locally cached profile.
Local only: no Developer Portal, App Store Connect, Cloudflare or backend operation; no `-allowProvisioningUpdates`
(it would create profiles). That historical audit added no icon artwork; the 2026-10-06 App Icon follow-up below supersedes its icon finding only.

Docs-only reconciliation on 2026-10-06 against main `cef7f055d0a3cb1b4d1baf223097b8c0e1b24cd9`:
the historical archive results below are not rerun here. #191/#193 confirm production Release J/K/L,
Reduce Motion simulator behavior, source processing notice and Watch license Link implementation.
Icon plumbing is complete; icon images were still missing at that reconciliation (resolved below), paid team confirmation, provisioning, signed archive/TestFlight
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
| App icon | **RESOLVED 2026-10-06 (technical inclusion).** Same opaque sRGB 1024 × 1024 `AppIcon.png` in iPhone/Watch universal slots. Unsigned Release archive contains `CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName = AppIcon`, `Assets.car` and compiled 1024 px AppIcon renditions for both hosts (§3.1). Signed-distribution and final asset-rights checks remain separate |

### 3.1. App Icon follow-up (2026-10-06)

Maintainer selected the square yellow-background / white pin-path artwork and explicitly approved only
1254 × 1254 → 1024 × 1024 high-quality full-frame downscaling. Core Graphics `.high` interpolation,
original sRGB color space and an opaque RGB context were used: no crop, corner mask, color/gradient
adjustment, geometry change or sharpening. Source SHA-256:
`3855bcc1c2826a04667af3e91c518c2717c3d64646de672297b4061c32cce836`.
Adopted master SHA-256:
`5e63ccc3db62ff034daac39d7946f4327c9f09d9035c96e1745a69dd07f82bca`.
Both committed PNGs are byte-identical, 1024 × 1024, no alpha, sRGB IEC61966-2.1;
PNG chunk CRC and complete image-data decode passed. Original/master visual comparison shows no
substantive artwork change or clipping. Xcode generates derived icons; no manual size family was added.
The three supporting brand images are not in the shipping bundle or this change.

Release simulator evidence: iPhone 17 Pro Home Screen shows a recognizable pin/path at normal icon size,
with comfortable margins and no mask clipping or transparency fringe. Watch Series 10 (46 mm) native
loading icon shows the circular mask without clipping, but its system-dimmed state does not establish
normal-brightness path readability. App Library/Settings and Watch app-grid inspection remain unverified:
Computer Use reported a server/client version mismatch. No artwork change was made to work around this.
Final normal-brightness Watch and physical-device appearance remain required; simulator captures are
validation evidence, not adopted App Store screenshots.

`xcodebuild archive -scheme MannerPath -configuration Release -destination 'generic/platform=iOS'
CODE_SIGNING_ALLOWED=NO` succeeded at `/tmp/mannerpath-app-icon-final.xcarchive`.
Both iPhone and embedded Watch Info.plists identify AppIcon via CFBundleIcons, both contain Assets.car,
and `assetutil --info` reports AppIcon at 1024 × 1024 with phone/watch idioms respectively.
`check-apple-beta-artifact.py <archive> --unsigned-build` passes (four bundles and source entitlements).
The signed-only `apple-beta-preflight.sh <archive>` correctly fails code-signature verification for this
unsigned archive; it is not icon validation or signed-device proof. No provisioning/capability changes
or Developer Portal actions occurred. Paid team/profiles, signed archive/TestFlight, final physical-device
visual checks and maintainer legal/asset-rights signoff are still required.

Local validation: `make apple-validate` PASS with the documented dedicated simulator destination overrides
(iPhone 193 / Watch 23 tests, builds and Release origin checks); `make contract` and `git diff --check` PASS.
The initial default-destination run was stopped after prolonged startup without test results; its cause is
unproven. No source assertions or validation gates were bypassed.

`nearby-spots.json` (a unit-test fixture unused by the shipping composition) is bundled — P2.
`ENABLE_APP_SANDBOX` / `ENABLE_USER_SELECTED_FILES` on the iPhone target are macOS settings, inert on iOS — P2.

## 4. User actions to reach TestFlight (in order)

Before upload, `./scripts/apple-beta-preflight.sh <archive>` fails closed unless both
iPhone/Watch hosts declare `AppIcon` in `CFBundleIcons.CFBundlePrimaryIcon`, contain
`Assets.car`, and expose a compiled 1024 × 1024 AppIcon rendition through Xcode's
`assetutil`. Missing tools or unreadable catalogs are failures, not skipped checks.
The checker also requires the exact production API and public-site URLs, iPhone-only
`UIDeviceFamily [1]`, all four expected bundle identifiers with matching version/build,
and privacy manifests in both app hosts. Widget manifests are not newly required.
Run `python3 scripts/test-apple-beta-preflight.py` for focused failure fixtures.
Since 2026-10-09 it also checks the Watch companion ID, loopback/plain-HTTP and secret-looking Info.plist
values, Debug-only UI-test hooks and location usage keys, and `make apple-beta-preflight` archives the
committed Release settings; the device/TestFlight run sheet is
[`beta-e2e/device-release-matrix.md`](beta-e2e/device-release-matrix.md).
`--unsigned-build` checks these artifact gates using source entitlements but does not
bypass signed-mode signature/profile checks or provide TestFlight/device evidence.

| # | Where | Action |
| --- | --- | --- |
| 1 | developer.apple.com | Complete Developer Program enrollment; accept agreements |
| 2 | Xcode → Settings → Accounts | Sign in; note the paid team ID. If not `58A7G4U27M`, change project-level `DEVELOPMENT_TEAM` (Debug + Release) in a reviewed PR |
| 3 | App Icon — technical step complete | Maintainer-selected master is installed in both AppIcon sets and included in unsigned archive (§3.1). Preserve it; recheck icon inclusion/appearance in the final signed archive and confirm asset rights separately |
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
| App icon | RESOLVED: selected master in both slots; unsigned archive inclusion confirmed (§3.1); signed/physical/rights checks remain |
| Archive | unsigned succeeds; signed blocked only by provisioning |
| Upload / TestFlight | after §4 steps 1–5 |
