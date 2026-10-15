# Watch Series 9 and widgets — v1 release verification

2026-10-15, reviewed main `a626f09` on isolated `test/watch-widget-release-readiness`.
**Hardware status: NOT RUN.** A developer-owned Series 9 is available, but this agent has
not operated or observed it. No signed-device, App Group, background sync or WidgetKit
scheduling PASS is inferred from source review or simulator/unit tests. This supplements,
and does not fill or replace, Lane 3's [device matrix](../beta-e2e/device-release-matrix.md).
No signing, build/version, distribution, TestFlight upload or screenshot-asset change.

## Implementation review

| Path | What is actually shared | Automatic guarantees / physical limit |
| --- | --- | --- |
| iPhone app → iPhone widget | `PhoneGlancePublisher` writes `nearby-glance-v1.json` atomically in `group.com.kounishiyuuki.MannerPath`; widget reads it | Validated saved nearest-place metadata, no widget GPS/network. Signed container access remains NOT RUN |
| iPhone → Watch app | `PhoneWatchSync`, durable revision journal, WCSession application context plus reachable message | At most 500 unfiltered candidates + attribution; receiver rejects stale/conflicting revisions/malformed transfers. Real WC delivery remains NOT RUN |
| Watch app → Watch widget | `WatchStore`, `nearby-watch-v1.json` in Watch-local App Group, widget reload after accepted snapshot | Atomic cache writes, migration/fallback and stale labels tested. Signed extension/container reads remain NOT RUN |

All four checked entitlement files declare the same App Group. **App Group does not sync
between iPhone and Watch**: each device has its own container; WatchConnectivity bridges them.
The Watch app can fall back to its private cache if the group is unavailable; that does not
prove its widget can access the cache. A widget with no shared data must show unavailable.
No new location persistence, background tracking, report/photo flow or HTTP endpoint is added.

Watch list: top three ranked using fresh Watch location and offline preferences; detail includes
access/unknowns, precision, evidence, freshness and saved source/license notices. No location
means saved places remain readable with no current distance/bearing. Watch navigation handoff
is gated at watchOS 11.4; older supported OS retains the honest straight-line fallback.

Both widgets are **saved data**, not independent live nearby search. iPhone supports small,
medium and rectangular accessory families. Watch supports rectangular accessory only. The
Watch widget's first spot is the iPhone-saved candidate order, not a live rerank by Watch GPS
or Watch filters; do not require it to equal a differently filtered/ranked Watch list.

Only **device-location** results publish companion data. Searching a Tokyo destination from
an uncovered location does not populate Watch/iPhone widgets with Tokyo data. In a genuinely
uncovered current-location area, empty/no saved results are valid and do not prove populated
sync/rights/navigation behavior. Initial production coverage is limited to Taito, Minato, Koto,
Musashino, Osaka and Kyoto source regions; no whole-city or nationwide completeness promise.

Widget staleness is explicit after one hour, with an expiry timeline entry and requested hourly
refresh; last-known/future phone location is stale. Unchanged Watch snapshot content intentionally
keeps its original revision/time, so a phone refresh need not make it look newly fetched.
`reloadTimelines` is a request, **not an immediate-update guarantee**; record actual delays.
See [Apple WidgetKit refresh budgets](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date).

## Confirmed defect and narrow correction

Before this branch, a fix rejected when delivered older than 60 seconds could nevertheless stay
labelled current indefinitely if it was initially accepted and the Watch screen remained open.
`refreshClock` changed only the clock, retaining latitude/longitude/accuracy without a fix timestamp.

The fix retains one observed timestamp **in memory only**, reapplies the existing `-5...60` second
window on the existing minute clock refresh and clears coordinates/accuracy when expired. Cached
places, preferences and source notices remain available. An already-open detail also checks live
location availability before showing its captured distance/bearing/navigation fallback. A new
fresh fix restores distance. No continuous tracking or new permission request is introduced.
Expiry is noticed on the next clock refresh (up to the existing one-minute polling delay), not
promised exactly at second 61. Tests inject clock times rather than sleeping or changing OS time.

This code fix is **not in the already uploaded TestFlight 1.0 (3)**. Do not mark it device verified
using that binary. Lane 3 must choose/sign/distribute any new RC separately; no such action occurs here.

## Series 9 / iPhone operator checklist

Record only model/41-or-45mm, OS, app version/build, date and result/evidence reference. No UDID,
personal device name, GPS coordinates, Apple ID, home/work location or report body in the record.
All rows start **NOT RUN**. Run in order; report exact observed text/failure without inferring PASS.
Do not erase the developer's existing cache/reinstall unless the owner deliberately chooses that
separate first-install test. Restore permission/connectivity/accessibility settings afterward.

| ID | Action on actual paired devices | Required observation | Current |
| --- | --- | --- | --- |
| S9-01 | Check paired iPhone, watchOS ≥11 and selected RC installed on both. Open Watch MannerPath from app grid | App starts; eligibility notice/continue and usable empty/saved state, no crash | NOT RUN |
| S9-02 | In a covered area open iPhone MannerPath, choose device location (When In Use), refresh. Open Watch | A genuine current-location corpus arrives normally; record displayed public spot name and source, not GPS | NOT RUN |
| S9-03 | Inspect Watch top three, select detail, Crown-scroll to last source/license row | Type/access/freshness/evidence readable; unknown is unknown. Saved processing notice/license text readable offline; external link opening checked online | NOT RUN |
| S9-04 | Allow Watch When In Use location; inspect list/detail distance and direction. Deny it, reopen, restore | Fresh-fix direction only; failure/denial leaves saved places and removes current distance/bearing; no Always permission | NOT RUN |
| S9-05 | On a build containing this fix, keep detail open for over two minutes without manually refreshing | An aged single fix is not kept current. If OS delivers newer fixes, record them as a different scenario; cannot claim expiry PASS from that | NOT RUN |
| S9-06 | With saved data, temporarily disconnect both devices' radios (Watch Wi-Fi/cellular too), quit/reopen Watch | Saved places/filters/source notices remain; navigation fallback does not promise offline turn-by-turn | NOT RUN |
| S9-07 | Restore connections; refresh current-location iPhone data; reopen both apps | Genuine changed corpus reaches Watch without downgrade/duplication; unchanged data may retain its revision/date | NOT RUN |
| S9-08 | Set Watch filters that exclude results, then clear. Use large Japanese text and VoiceOver | No false “no smoking places exist”; filters persist offline; every list/detail/control remains readable and operable | NOT RUN |
| S9-09 | On watchOS ≥11.4 tap actual directions control, then return | Actual Maps handoff works or honest fallback; an approximate anchor never becomes exact | NOT RUN |
| IW-01 | Long-press iPhone Home Screen → Edit/Add Widget → MannerPath; add small and medium. Add rectangular Lock Screen widget where supported | All three registered families render; unsupported families are not promised | NOT RUN |
| IW-02 | Refresh device-location iPhone data; inspect each widget and tap it | Saved unfiltered nearest place, honest distance/precision/evidence/date; deep link opens only a spot still in current app results | NOT RUN |
| IW-03 | Leave saved glance for >1 hour without refresh, inspect/tap again | Old-data message and open-app action; no stale current-distance claim. Record system scheduling delay | NOT RUN |
| WW-01 | On Watch face turn Crown up / swipe up → Smart Stack → long-press → + → MannerPath; add rectangular Nearby | Actual supported widget renders, no fake screenshot/snapshot injection | NOT RUN |
| WW-02 | With genuine sync, inspect widget then tap | First saved iPhone candidate/source age or honest old/unavailable state; tap opens Watch app. No live Watch-distance claim | NOT RUN |
| WW-03 | Receive a changed corpus normally; inspect Smart Stack again, later >1h stale state | Eventual changed saved display and old-data label; record refresh delay, not a hard immediate deadline | NOT RUN |
| AG-01 | IW-02 and WW-02 show genuine saved contents on the selected signed RC | Behavioral evidence both signed device-local App Groups are working. Source entitlement strings alone cannot pass | NOT RUN |

[Apple's Smart Stack instructions](https://support.apple.com/guide/watch/see-widgets-in-the-smart-stack-apdecf142fb9/watchos)
may differ slightly by installed OS; use its version selector. This app advertises rectangular
Watch widgets, not a full set of circular/corner complications.

**Approximate positions:** current six-source v1 production corpus has no approximate pins.
Use synthetic unit tests to verify facility/named-zone labels, approximate distance and unknown
access; never seed those into the production app to claim real-device evidence. Actual signed
approximate rendering remains NOT RUN unless a separately approved test build/data scenario is
provided by the release owner. It is not evidence for an undeployed airport source.

## Automatic evidence

Existing suites cover Watch cache migration/corruption/revision ordering, unknown values, offline
filters, source attribution, old/future payloads, location failure and approximate/facility copy;
iPhone suites cover persistent producer revisions, source variants, glance file/codec/expiry,
deep links and destination-vs-device publication separation. New tests cover accepted-fix aging,
clock rollback, preserved cache and fresh-fix recovery. These do not prove signed container access,
physical Japanese layout/VoiceOver, radios, Maps handoff or system WidgetKit reload timing.

Validation commands: `make apple-validate`, `make contract`, Node 24 `make security-validate`,
`git diff --check`. Wait while another Lane owns a simulator test; no concurrent runs. Do not
modify build numbers, signing/distribution settings or Lane 4's screenshot files to make a check pass.
Results are recorded in the PR/final report; no unexecuted command is a PASS.
