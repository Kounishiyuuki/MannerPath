# App Privacy data inventory (App Store Connect input)

Fact table derived from the repository implementation at the time of writing, for filling in the App Store
Connect "App Privacy" questionnaire. **This is not a legal determination.** Where the App Store category a fact
falls into is a judgment call, the row says so and the maintainer decides. Re-derive this table when report,
networking, location or photo code changes. Canonical policy: ADR-0007 (report privacy), `docs/DATA_POLICY.md`.

"Collected" below follows Apple's meaning: data transmitted off the device and retained by us longer than needed
to service the request in real time. Data that only stays on the device is not "collected".

## Summary

| Data | Leaves the device? | Collected (retained)? | Linked to user? | Tracking? | Purpose |
| --- | --- | --- | --- | --- | --- |
| Precise location (device GPS) | No | No | — | No | On-device nearby ranking, distance/bearing |
| Coarse location (implicit, tile requests) | Yes: tile ids z14–16 | See note 1 | No account exists | No | App functionality (map data download) |
| Location chosen by the user (report pin) | Yes, only in a submitted report | Yes | See note 2 | No | App functionality (place reports/corrections) |
| User content: report note, free-text claims | Yes, only in a submitted report | Yes, minimized by retention pass | See note 2 | No | App functionality (moderation of place data) |
| Photos (report evidence) | Yes, only if the user attaches one | Yes, deleted by retention pass | See note 2 | No | App functionality (evidence for a report) |
| Identifier: report `installId` (random UUID) | Yes, in a submitted report | Hash only (raw value not stored) | See note 2 | No | App functionality / abuse prevention |
| App Attest key id, attestation, assertions | Yes, with a report | Key id + public key registered | See note 2 | No | App integrity / fraud prevention |
| Diagnostics / crash / analytics | No SDK, no MetricKit upload | No | — | No | — |
| Contacts, email, name, account | Not requested | No | — | No | — |

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
  stores only `sha256(pepper + installId)` (`services/api/src/reports/create.ts` `submitterHash`).
- **App Attest** — `DCAppAttestService` key id/attestation/assertion sent to `/v1/app-attest/*` and with reports
  (`Features/Reports/AppAttestDevice.swift`, `ReportAuthorizer.swift`).
- **Diagnostics** — no crash/analytics SDK, no MetricKit subscriber, no `Logger` upload in app sources.

## Notes for the maintainer (要確認)

1. **Tile ids + IP.** A z14 tile is roughly 2 km across. Whether the backend/CDN retains request logs (IP + tile
   path) beyond real-time servicing decides if this is "Coarse Location — collected". Check the Cloudflare
   logging/Logpush configuration of the deployment; the repository does not show it.
2. **Linked to user?** There is no account, but `installId` hash and App Attest key id let several reports from
   one install be correlated. Whether that counts as "linked to the user's identity" for App Store purposes is a
   maintainer/legal decision; the conservative answer is "linked" for report-related rows.
3. Report-related rows only apply when the report feature is enabled in the shipped build/deployment
   (`/v1/config` `reports.available`).

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
