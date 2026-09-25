# Watch and widget physical-device beta lane (#35)

Status: **NOT RUN** on physical hardware. This host reports `No devices available for the recording` from `xcrun xctrace list devices`. No device PASS or FAIL is inferred from source, simulator tests, or unsigned builds. This file is the evidence sheet for the #35 Watch/widget rows; `docs/BETA_E2E_CHECKLIST.md` remains the integration checklist.

## Evidence levels

| Rows | Existing automated or simulator evidence | Physical proof still required |
| --- | --- | --- |
| W1, W4–W6 | AUTO and SIM (#61) | First launch, real result ranking, freshness, controls |
| W2, W3, W7, W8 | AUTO | Paired transfer, disconnected cached launch, walking bearing, Maps handoff |
| W9 | SIM swipe only | Digital Crown to final row |
| W10 | None; simulator rejects text-size change | Large text on Watch |
| G2–G5, G7, G9 | AUTO state/deep-link tests | Signed sharing, rendered states and tap behavior |
| G1, G6, G8 | Source review only for G8 | Gallery, taps, offline/no-permission behavior |
| WG2, WG3, WG5 | AUTO state/migration tests | Signed sharing, rendered offline state, upgrade migration |
| WG1, WG4, WG6 | Source review only for WG6 | Smart Stack, complication, tap and no-permission behavior |
| S2–S4 | Source entitlement and bundle-ID checks (#54) | Signed artifact inspection and cross-process sharing |
| A1 Watch, A2 Watch | SIM layout/copy only | VoiceOver order and large text on device |

Source review: all four targets declare `group.com.kounishiyuuki.MannerPath`. The iPhone widget reads `nearby-glance-v1.json`; the Watch widget reads the Watch App Group snapshot. Neither widget source imports CoreLocation or performs network requests. These observations do not prove provisioning or runtime isolation.

## Device run card

Use a paired physical iPhone and Watch in the published Taito area. Record iPhone model/iOS, Watch model/watchOS, build `CFBundleVersion`, signing type, backend origin, local time, and one PASS/FAIL per row. Save screenshots for failures. For a pre-#32 Watch upgrade, do step 3 **before** a clean install; a clean install cannot prove migration.

1. Build the development-signed four-target app with a reachable HTTPS `MANNERPATH_API_BASE_URL`. Run `./scripts/apple-beta-preflight.sh /path/to/MannerPath.xcarchive` and keep its output, excluding profiles and certificates. Stop if any target ID, signed App Group entitlement, embedded provisioning profile, or API origin fails.
2. Install the signed build on the paired iPhone and Watch. Confirm both apps launch. Do not assign S2–S4 yet.
3. For WG5 only, start with the previous pre-#32 beta on the Watch, sync at least one place, change one Watch filter, then install the new build over it. Before reopening iPhone Nearby, open Watch app and widget; record whether the place and filter survived in both. Mark WG5 NOT RUN if no prior beta is available.
4. On a clean install, open Watch first. Read first-use notice, continue, and confirm the no-snapshot prompt (W1). Open iPhone Nearby with location allowed and wait for actual published results. Open Watch again; record a matching place and sync time (W2).
5. Confirm Watch displays no more than three places (W4), its saved-data age and per-place verification wording (W5), and each quick filter including empty state and Clear filters (W6). Record the exact text for any unknown hours or tobacco support.
6. Turn the paired iPhone fully off or take it out of range; disable Watch cellular/Wi-Fi for this offline trial. Force-quit and reopen Watch. Confirm cached places and filters remain, and old data is labelled old after one hour (W3, W5). Restore connectivity after recording.
7. While safely walking outdoors, refresh Watch location at two separated positions. Record distance and bearing before/after and whether the bearing changes plausibly (W7). A stationary test is insufficient.
8. Open a Watch place, tap walking Directions, and record whether Apple Maps opens to that destination; return and check the straight-line fallback remains accessible (W8).
9. Use only the physical Digital Crown to reach the final action in the Watch list and the final source/attribution row in detail (W9). Enable a large accessibility text size on Watch, reopen both screens, and repeat the reachability check with no clipped actions (W10, A2 Watch).
10. Turn on Watch VoiceOver. Swipe through list, detail, filters, stale/offline messages, and Directions; record spoken label/value/order and whether controls remain operable (A1 Watch).
11. On iPhone, add Nearby small and medium Home Screen widgets and the rectangular Lock Screen widget from their galleries (G1). Before opening Nearby on a fresh install, record unavailable text (G5); after a successful Nearby load, compare the same first unfiltered place, distance, and verification text with the app (G2, G3, S2).
12. Tap each iPhone widget state and confirm MannerPath opens at Nearby (G6). Tap a fresh place widget and confirm its detail, including while a filter hides it; if the spot is no longer nearby, confirm plain Nearby (G7). In widget configuration, run Open Nearby and confirm it opens the app (G9).
13. Leave the iPhone app unopened for more than one hour. Confirm the widget labels the snapshot old and omits a current distance (G4). With saved data, enable airplane mode, reload the widget, and confirm it still renders without a widget location prompt or separate widget Location Services entry (G8).
14. On Watch, add Nearby to Smart Stack and to a face with a rectangular complication (WG1). After W2, compare the widget place with the Watch saved snapshot and confirm “From iPhone” plus verification age (WG2, S3, S4). Tap each entry and confirm Watch app opens and reranks with Watch location (WG4).
15. With the iPhone off/out of range for more than an hour, confirm Watch widget says “Old data from iPhone” and does not imply a current result (WG3). On a clean no-snapshot install, confirm “Open iPhone app to sync.” Confirm widget interaction never asks for location permission (WG6).
16. For G5 empty state, move outside published Taito coverage after a completed configured-backend load; confirm “No saved nearby places.” Keep this separate from the no-snapshot unavailable state.

## Results

| Rows | Result | Evidence |
| --- | --- | --- |
| W1–W10, A1/A2 Watch | NOT RUN | No physical Watch connected |
| G1–G9 | NOT RUN | No physical signed iPhone/widget run |
| WG1–WG6 | NOT RUN | No physical Watch/widget run |
| S2–S4 | NOT RUN | No signed artifact or cross-process device proof |

No reproduced physical-device bug is available to fix. These rows remain beta blockers for the Watch/widget lane of #35 until device results are supplied. #35 also retains the other physical iPhone/backend rows in the master checklist.
