# Series 9 physical capture and submission handoff

2026-10-15 follow-up to #281. **G5/G10 remain OPEN.** This procedure neither uploads
assets nor approves their rights. No Simulator session is needed. Keep the existing four
iPhone originals; do not replace them with fixture screens or UI-test images from #282.

## Existing iPhone assets: reuse, not recapture by default

The four originals listed in [README](README.md) were inspected again and passed the
validator with their original SHA-256 digests. All are JPEG, 1320 × 2868, without alpha.
A byte-identical private archive is at `~/Pictures/MannerPath/AppStore/v1.0/pr281-candidates/`
with its runnable `capture-manifest.json`; the original `/private/tmp/mannerpath-v1-store-assets/`
copy remains intact. Only hashes/metadata belong in Git. These are **review candidates**, not
approved final uploads. Preserve their actual capture build 3 and source HEAD.

| Existing scene | #282 / proposed Build 4 impact | Remaining review |
| --- | --- | --- |
| 02 destination search | No selected pin; dismissal inset absent | Visible map strip lacks readable credits; retain source-search/permission context |
| 03 destination list | No selected pin; dismissal inset absent | Same map-credit question; distance is from destination, not device GPS |
| 04 place detail | Dismissal inset scoped to root, absent on pushed detail | Same map-credit question; unknown access and publisher position wording retained |
| 05 source/license | Root dismissal inset absent on pushed source page | Same map-credit question; Taito notice, processing notice and license link visible |

Suggested review order: 03 list → 04 detail → 05 source/license → optional 02 search.
02 is truthful but dominated by the location-OFF explanation and a broad background map;
it is a weaker opening asset. Keep all four originals rather than rebuilding the set.

Source comparison from capture HEAD `86631d5af67495e8cc322f6f20ff752c5a4eb157` through
#282 found only the selected-pin dismissal layout change in production Apple code; Watch
production code was unchanged. This supports retaining these four scenes for final-build
review, **not relabelling their bytes as Build 4 captures**. Any later UI change or a selected-pin
asset needs its own impact review. Confirm the actually submitted RC/build with Lane 3 and
compare its visible text/layout before signing off reuse. No Build 4 installation is asserted.

Apple's current [specification](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
lists these iPhone pixels for the large Dynamic Island well, PNG/JPEG without alpha, and
1–10 images per size. A five-scene storyboard/opening-map frame is editorial, not Apple's
minimum count. Its overview names a medium Dynamic Island set as required, while the size
tables describe scaling fallbacks. Confirm the app's actual required ASC wells before entry;
do not infer that four large images prove the medium requirement fulfilled. If ASC requires
an additional native medium image, use a real 1206 × 2622 or 1179 × 2556 capture and retain
these four. Do not fabricate a native layout by resizing them. No iPad set is introduced.

## Series 9 size decision

Record 41mm or 45mm from Watch Settings → General → About (or the case), plus watchOS,
app version/build and paired iPhone build. Do not commit device names, serials, UDIDs or
personal location. Apple's current submission table lists **396 × 484 for Series 9**, and
requires the same Watch dimensions across localizations. It does not list every small-case
hardware screenshot size. Inspect the **actual original** rather than guessing from the model.

A 396 × 484 original can enter technical validation. A different native size must be kept as
hardware evidence but left out of the upload set unless ASC/Apple confirms acceptance. Do
not stretch, crop, pad or AI-recreate it to resemble a larger Watch. A 41mm owner can still
perform the real-device checks; an unsupported export size remains a separate asset blocker.

## Owner actions on the paired physical devices

1. Confirm both devices run the intended production-connected signed/TestFlight RC. Do not
   replace it with a fixture Debug app. Record the real build and Lane 3's corresponding
   source HEAD/tree in a private capture log. Check reports/photos remain unavailable.
2. Use a covered public area. On iPhone, allow When In Use location, leave destination-search
   mode and return to **current-location Nearby**. Reset filters that would exclude unknown
   access/hours. Refresh and wait for actual published results. A remote Ueno destination
   search does not populate the Watch; no snapshot injection or coordinate spoofing is allowed.
3. Open MannerPath on Watch through normal pairing/WatchConnectivity. Accept the existing
   eligibility notice if needed. Allow Watch location only if distance/bearing are desired.
   Wait for the normally synced saved list; compare one named place and its source with iPhone.
   If empty/old, keep the warning, refresh normally and retry. Do not present stale/empty data
   as a fresh populated list. If outside coverage, stop and leave the capture pending.
4. In iPhone's Watch app → My Watch → General, enable screenshots. Alternatively use Watch
   Settings → General → Screenshots. Show MannerPath, then **briefly press Digital Crown and
   side button together** and release. The screenshot appears in paired iPhone Photos.
   [Apple's hardware capture instructions](https://support.apple.com/en-us/105060).
5. Capture the list; tap that same place and capture its detail/precision/access/freshness;
   scroll to the source/processing/license section and capture it. Verify the license link
   opens using normal system handling, then return. A full-page stitched/scrolling image is
   not a native Watch frame. No watch face, notifications or personal names in the set.
6. In iPhone Photos, transfer original screenshots privately to Mac using AirDrop/Files.
   If using Mac Photos, export **unmodified originals**. Do not send through an image-resizing
   messenger, photograph the Watch, edit/crop a frame, or turn opaque/unsupported files into
   a purported native screenshot. Keep original filenames privately until reviewed.
7. Put originals in a new private folder, e.g.
   `~/Pictures/MannerPath/AppStore/v1.0/watch-series9/build-<actual>/ja/`.
   Record original digest, actual pixels/format, scene and public spot/source IDs. Keep one
   Watch size across locales. A separate Watch manifest records its actual capture build;
   never rewrite the build-3 iPhone manifest to claim all images came from the newer build.

## Cross-device truth and rights checklist

- Match the same public spot/source identity through the production GET API, not only a
  `watch-spot-sp_` test identifier. Compare name, unknown access/hours, precision, evidence
  and full source/license/processing notices. Retain fresh/old/approximate warnings.
- The existing iPhone set shows **destination-relative** distances; Watch uses its own
  location or honestly shows distance unavailable. Different distance/bearing is not itself
  a contradiction. Do not claim Watch synced the phone's destination result or provides
  independently verified/on-site smoking permission or offline turn-by-turn navigation.
- Municipal open-data licenses cover approved source data, not Apple's/provider map imagery.
  The Taito attribution/CC BY 4.0/processing notice is visible in 05, and its
  [publisher's display terms](https://www.city.taito.lg.jp/kusei/online/opendata/about/opd.html)
  were rechecked, but that alone does not
  approve the map backgrounds. Current four frames have no readable Apple/provider credit.
- [Developer Program Agreement, Attachment 6 §§2.1–2.3](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
  restricts obscuring notices and copying/reusing map data; [Review Guidelines 2.3.3/2.3.9](https://developer.apple.com/app-store/review/guidelines/)
  requires accurate in-use images and necessary rights. The maintainer must review the
  applicable accepted agreement and exact assets under G5. This is not a legal conclusion
  that these frames are permitted or forbidden. Do not add a fake credit overlay or erase
  map content. If visible-credit recapture requires product UI work, hand it to the UI lane.

## Offline technical validation and handoff

Use the existing manifest shape with `version: 1`, `appVersion: "1.0"`, the **actual** positive
integer capture `build`, actual source HEAD/tree (40 hex), production API origin, `locale: "ja"`
and an `images` array. Each Watch entry uses `platform: "watch"`,
`captureKind: "testFlightDevice"`, measured width/height, SHA-256, actual `sourceIds`/`spotIds`,
`syntheticSpotData: false`, `status: "candidate"`, `physicalDeviceVerified: false`,
`rightsApproved: false`, `submitReady: false`. Physical origin is not independent E2E/rights
approval; record that signoff separately. No unobserved placeholder entry is a captured asset.

```sh
sips -g pixelWidth -g pixelHeight -g hasAlpha /path/to/original.png
shasum -a 256 /path/to/original.png
python3 scripts/validate-store-screenshots.py /path/to/watch-folder/capture-manifest.json
python3 scripts/validate-store-screenshots.py "$HOME/Pictures/MannerPath/AppStore/v1.0/pr281-candidates/capture-manifest.json"
```

The validator never edits an image or grants submission approval. It rejects unsupported
pixels, alpha, extension/encoding mismatch, changed digest, more than 10 per size, mixed
Watch sizes, unsafe paths and fabricated approval flags. Newer capture builds are supported;
historical manifests still retain their actual build.

Final handoff: approved image paths/order and digests; actual capture RC/build per group;
Watch size/locale; independent cross-device/rights signoff; ASC required-well confirmation.
Only then, with explicit upload authorization, may the responsible operator upload.

## This session's evidence and remaining G10 work

- Original four images: byte-identical archive + repeat technical PASS; no new iPhone capture.
- [Bounded current GET recheck](identity-recheck.json): all four captured spot IDs still match
  the production Taito part; source notice/CC BY 4.0 retained; reports unavailable. This is
  not a fresh full-corpus count, image-rights approval or physical Watch-sync evidence.
- Watch detected as paired but tunnel unavailable, DDI services unavailable; no controllable
  physical Watch session or Watch screenshot was obtained. No hardware success is claimed.
- Simulator was not launched/used. Product UI, Watch source, signing and production data unchanged.
- Pending: owner size/build/coverage response and original Watch captures; Watch technical and
  cross-device checks; selected RC reuse confirmation; actual ASC wells; exact-asset G5 approval.
  G10 stays OPEN. Do not close device E2E or Content Rights gates with these file checks.
