# App Privacy data inventory (App Store Connect input)

Fact table derived from the repository implementation at the time of writing, for filling in the App Store
Connect "App Privacy" questionnaire. **This is not a legal determination.** Where the App Store category a fact
falls into is a judgment call, the row says so and the maintainer decides. Re-derive this table when report,
networking, location or photo code changes. Canonical policy: ADR-0007 (report privacy), `docs/DATA_POLICY.md`.

"Collected" below follows Apple's meaning: data transmitted off the device and accessible to us or our partners
longer than needed to service the request in real time. Data that only stays on the device is not "collected".

## Summary

Report/auth/photo rows below describe implemented capabilities, not initial-v1 availability. Initial v1
requires reports and App Attest registration unavailable, with photos disabled. Postdeployment read-only
audit (2026-10-05, main `ae3bd0a`) confirms the production Worker/version, distinct D1/R2 bindings,
reports unavailable, unconfigured required App Attest, photos off, community pending, crons empty and
invocation logs disabled. Console logs remain persist-enabled. Provider retained fields/plan/exports and
signed-build traffic remain unverified: see [production audit](PRODUCTION_PRIVACY_AUDIT.md) and
[submission §2](APP_STORE_SUBMISSION.md). Backend availability is resolved, not final label approval.

| Data | Leaves the device? | Collected (retained)? | Linked to user? | Tracking? | Purpose |
| --- | --- | --- | --- | --- | --- |
| Precise location (device GPS) | Not sent to MannerPath backend for browsing; Apple framework/service communication assessed separately | No in audited MannerPath browsing flow | — | No | On-device nearby ranking, distance/bearing |
| Coarse location (implicit, tile requests) | Yes: tile ids z14–16 | See note 1 | Unknown; no account does not exclude device/IP linkage | No | App functionality (map data download) |
| Location chosen by the user (report pin) | Yes, only in a submitted report | Yes | See note 2 | No | App functionality (place reports/corrections) |
| User content: report note, free-text claims | Yes, only in a submitted report | Yes, minimized by retention pass | See note 2 | No | App functionality (moderation of place data) |
| Photos (dormant report evidence capability) | Only after separate photo intake activation; shipping upload disabled | If activated: yes, deleted by retention pass | See note 2 | No | App functionality (evidence for a report) |
| Identifier: report `installId` (random UUID) | Yes, in a submitted report | Unattested: install-ID hash; attested: key-derived submitter hash; raw UUID not stored | See note 2 | No | App functionality / abuse prevention |
| App Attest key id, attestation, assertions | Yes, during registration/authorization when enabled; can precede report acceptance | Key id + public key registered | See note 2 | No | App integrity / fraud prevention |
| Diagnostics / crash / analytics | No app SDK or MetricKit upload; provider/Worker diagnostics possible | UNKNOWN for retained provider/Worker data | UNKNOWN | No tracking found in app | See production audit |
| Contacts, email, name, account | Not requested by browsing/report flows; external support mail is separate | No for these app flows; support retention unverified | — | No tracking found in app | Support workflow requires assessment |

Tracking: `NSPrivacyTracking = false`, `NSPrivacyTrackingDomains = []` in both app manifests; no ad/attribution
SDK, no IDFA, no `identifierForVendor`.

## Evidence per row

- **Precise location** — `When In Use` only (`apps/apple/AGENTS.md`). The device coordinate is used by
  `NearbySearch.rank` on-device; `PhoneGlancePublisher` writes the nearest place to the App Group file for the
  widget (on-device). Tile requests send a tile id, not the coordinate (`Core/Networking/TileAPIClient.swift`,
  `v1/tiles/{z}/{x}/{y}`, `SlippyTile.supportedDataZooms = 14...16`).
- **Report pin** — `ReportRequest.proposedLocation` (`Features/Reports/ReportDomain.swift`) is a pin the user
  places on a map, quantized to 5 decimals (`ReportCoordinate.quantized`). It is not the device GPS fix.
- **Note / claims** — `ReportRequest.note`, claim fields. The retention pass
  (`services/api/src/reports/retention.ts`, ADR-0007 §4) removes free text and keeps a non-personal skeleton.
- **Photos** — chosen via `PhotosPicker` (no library-wide access), re-encoded and stripped of metadata segments
  before upload (`Features/Reports/ReportPhotos.swift` `normalize`), so no EXIF GPS is sent.
- **installId** — random UUID kept in `UserDefaults` (`UserDefaultsInstallID`, `ReportStorage.swift`); the server
  stores only a submitter hash: unattested submissions hash the install ID; attested submissions hash
  `attestedSubmitter(keyId)` (`services/api/src/app.ts`, `reports/create.ts`).
- **App Attest** — `DCAppAttestService` key id/attestation/assertion sent to `/v1/app-attest/*` and with reports
  (`Features/Reports/AppAttestDevice.swift`, `ReportAuthorizer.swift`).
- **Diagnostics** — no crash/analytics SDK, no MetricKit subscriber, no `Logger` upload in app sources.

## Notes for the maintainer (要確認)

1. **Tile ids + IP.** A z14 tile is roughly 2 km across. Whether the backend/CDN retains request logs (IP + tile
   path) beyond real-time servicing decides if this is "Coarse Location — collected". Check the Cloudflare
   logging/Logpush configuration of the deployment. Committed invocation logs are disabled but console logs remain enabled;
   Hono exception logs are possible. Deployed invocation logs are confirmed disabled and console persistence
   enabled; retained fields and account/provider/export retention remain UNKNOWN ([audit](PRODUCTION_PRIVACY_AUDIT.md)).
2. **Linked to user?** There is no account, but `installId` hash and App Attest key id let several reports from
   one install be correlated. Whether that counts as "linked to the user's identity" for App Store purposes is a
   maintainer/legal decision; the conservative answer is "linked" for report-related rows.
3. Report-related rows only apply when the report feature is enabled in the shipped build/deployment
   (`/v1/config` `reports.available`), and App Attest registration must be assessed independently.
   Photos are disabled in the shipping composition regardless of dormant photo code.

## Privacy manifests

| Bundle | Manifest | Required-reason APIs | Collected types declared |
| --- | --- | --- | --- |
| iPhone app | `MannerPath/PrivacyInfo.xcprivacy` | UserDefaults `CA92.1` | none |
| Watch app | `MannerPathWatch Watch App/PrivacyInfo.xcprivacy` | UserDefaults `CA92.1` | none |
| iPhone / Watch widget extensions | none | no required-reason API used (reads App Group file via `Data(contentsOf:)`) | — |
| GRDB.swift 7.9.0 (SPM) | ships its own `GRDB/PrivacyInfo.xcprivacy` | none declared | none |

GRDB is the only third-party dependency (`Package.resolved`). `NSPrivacyCollectedDataTypes` is empty in the app
manifests; if the maintainer declares report data as collected in App Store Connect, consider adding matching
entries to the iPhone manifest so the generated privacy report agrees.

## Final audit classifications (2026-10-05)

The [authenticated production audit](PRODUCTION_PRIVACY_AUDIT.md) controls final release recommendations:
Precise Location, Device ID, User Content, Diagnostics and Usage Data / Product Interaction are
**UNKNOWN / SUBMISSION BLOCKER**; Coarse Location is **CONSERVATIVE DISCLOSURE** (collected, linked,
App Functionality, not tracking pending evidence). Photos/Videos and Crash Data are **NOT COLLECTED**
for the reviewed shipping composition. Matching backend deployment is now verified; signed archive
verification remains open. Report/auth Device ID and report User Content paths are confirmed inactive,
with current reports/keys/challenges/photos counts 0, but overall categories remain UNKNOWN for
provider identifiers, support and historical/build evidence. No type is confirmed COLLECTED by retained
personal records. “Data Not Collected” remains unsupported: Logpush, plan and field-key access returned
403; Analytics Engine inventory returned 404. No absence inference is made from these errors.
Corrected JA/EN policy dated 2026-10-05 is now verified live; provider/support retention remains manual.

#179 public-site evidence is closed: Release `MannerPathPublicSiteURL` is
`https://kounishiyuuki.github.io/MannerPath/`; Release navigation to privacy/ and support/ is verified;
Debug is empty; contact is `mannerpath.support@gmail.com`. This does not close provider/support retention.
The audit's policy handoff items 1–2 and the wording parts of 3, 5 and 6 are done (2026-10-05); evidence-dependent parts remain.
