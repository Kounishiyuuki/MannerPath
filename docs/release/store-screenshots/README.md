# v1.0 (3) screenshot capture delivery — Lane 4

2026-10-15. **Candidates only; G5 and G10 remain OPEN.** No App Store Connect upload,
production write, TestFlight upload, product UI change, build-number change or signing.
Images are actual uncomposited Release-simulator app screenshots, not fixture renders and
not captures of the signed TestFlight binary. Image bytes remain local pending asset-rights
approval; this directory publishes only nonpersonal metadata and GET observations.

## Production recheck

[GET-only report](production-recheck.json), completed 04:50:52 UTC, observed **513 distinct
published IDs / 6 sources / 81 explicitly queried tiles**. This is a bounded footprint, not
proof of absence of other tiles. Repository-reviewed sources are not deployed inventory.

| Source region | Observed spots |
| --- | ---: |
| 台東区 | 32 |
| 港区 | 114 |
| 江東区 | 3 |
| 武蔵野市 | 3 |
| 大阪市 | 344 |
| 京都市 | 17 |

Approximate positions: 0. Access unknown: 513. Hours unknown: 493. Missing verification date:
464. Required served source/license/attribution fields: no missing values in this scan.
Reports/photos remain disabled. These source-region labels do not imply complete city coverage.
No fixture IDs were substituted into captured production results.

The displayed `paspa 上野` matches live public part `14/14553/6449/parts/0`,
`sp_49GCV8887NA0Y00R59MSHE80HT`, source `taito-public-smoking-areas`. List entries also match
JR上野駅広小路口 `sp_7VYQR893GA66C0SWWNG34C6KWR`, 正岡子規記念球場横
`sp_1EDKZTDBF9N7686RXKFK3KT8J6`, 浅草口 `sp_5AX973GX8921DYPF0BD6H6A8TB`.
MapKit's Ueno destination suggestion is a destination, never canonical smoking-place evidence.

## Local image delivery

Local asset root: `/private/tmp/mannerpath-v1-store-assets/`.
The adjacent `capture-manifest.json` is the runnable manifest; the repository copy is metadata
only. Preserve this folder outside temporary storage before cleanup. No files have been uploaded.

| File below asset root | Native pixels | Review status |
| --- | --- | --- |
| `iphone-6.9/ja/02-destination-search.jpg` | 1320 × 2868 | Actual public destination search; not a smoking-place list |
| `iphone-6.9/ja/03-destination-list.jpg` | 1320 × 2868 | Production results; destination-relative distance/bearing retained |
| `iphone-6.9/ja/04-place-detail.jpg` | 1320 × 2868 | Unknown access and publisher position label retained; handoff control visible |
| `iphone-6.9/ja/05-source-license.jpg` | 1320 × 2868 | Taito attribution, processing notice and CC BY 4.0 link visible |

JPEG, no alpha; no resizing, cropping, overlays, invented pins or AI-generated content.
Four candidate files pass [technical checks](image-validation.json). This does not approve rights
or establish signed-device behavior. The detail frame includes the Maps handoff control, so a
second identical handoff frame was rejected. The first map capture was almost entirely covered
by the expanded sheet and was rejected as the opening frame. These four are not a completed
five-scene store set. Partial map backgrounds still require map-credit/rights review.

Capture source: main `86631d5` (full SHA in manifest), app 1.0 / build 3, iPhone 17 Pro Max
simulator iOS 26.5, Japanese, location denied, public destination “上野駅 東京”, no personal
GPS/account/search history. Main product source trees remain identical to Build 3 source
`e7a465468cfdeb6a3400ad37e74c9b89fa5b58cf`; this is source equivalence, not binary/signature
or hardware verification. The capture test was refined after the first successful run;
first-run assets must not be described as proof that the revised sequence passed.

A separate nearby-map rehearsal (`iphone-nearby-live.jpg`) used a **simulated public Ueno
reference coordinate**, not personal location. It is withheld from the selected set: map credit
visibility and final composition are not cleared. Never relabel this as physical-device GPS.

## Apple specification and rights

Rechecked 2026-10-15: [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
For the requested large Dynamic Island/6.9-inch well, 1320 × 2868 portrait is accepted (also
1260 × 2736 or 1290 × 2796). The current table says a Face ID large-display set is required
**if the Dynamic Island large-display set is not provided**. The medium Dynamic Island set
(1206 × 2622 or 1179 × 2556) has a scaling fallback and is not an unconditional second required
set. This corrects the older preparation table's “required medium” wording; confirm actual ASC
Media Manager wells before entry. No second native-size set has been delivered here.

Watch: choose the actual native size, e.g. 416 × 496 for Series 10; keep one size across all
localizations. Watch screenshots are required for the shipped Watch app. PNG/JPEG, no alpha;
1–10 screenshots per set. Do not resize a different UI layout to fake a native capture.

[Review Guidelines 2.3.3 / 2.3.9](https://developer.apple.com/app-store/review/guidelines/)
require accurate in-use screenshots and rights. Municipal data reuse rights do not license map
imagery. Keep Apple/provider marks and legal credits visible and unchanged; no extracted map
backgrounds or implied endorsement. Current candidates do **not** establish that all credits
are visible. Do not publish/upload them until the maintainer approves the exact assets under G5.
No final Content Rights declaration is made here. Signed-device notice/link/offline checks and
map agreement review remain separate. Lane 1 legal documents and Lane 3 device matrix are untouched.

Suggested captions (not burned into images): 「掲載地域の場所を確認」「目的地の周辺を検索」
「目的地からの距離・方向を確認」「利用条件と情報源を確認」「Appleのマップへ案内を引き継ぐ」。
No nationwide completeness, guaranteed availability, working report/photo feature or verified
Watch navigation claim. “公式確認済み” is source evidence, not a new on-site inspection.

## Capture and validation tooling

Two manual-only XCUITest classes drive existing controls in unchanged Release apps. DEBUG
runs skip; opt in with `TEST_RUNNER_MP_STORE_CAPTURE=1`. They never seed smoking spots or
inject a Watch snapshot. Tests emit image + accessibility attachments, stored privately.
A `watch-spot-sp_` prefix alone cannot prove production provenance/fresh sync: independently
match every displayed ID to the GET API, verify clean cache/setup and record the source.

Use a **dedicated simulator**, production Release origin, Japanese, no personal data. Build:

```sh
xcodebuild build-for-testing -project apps/apple/MannerPath/MannerPath.xcodeproj \
  -scheme MannerPathUITests -configuration Release -destination 'id=<IPHONE_SIM>' \
  -derivedDataPath /tmp/mannerpath-store-capture CODE_SIGNING_ALLOWED=NO
TEST_RUNNER_MP_STORE_CAPTURE=1 xcodebuild test-without-building \
  -project apps/apple/MannerPath/MannerPath.xcodeproj -scheme MannerPathUITests \
  -configuration Release -destination 'id=<IPHONE_SIM>' \
  -derivedDataPath /tmp/mannerpath-store-capture -resultBundlePath /tmp/fresh-capture.xcresult \
  -parallel-testing-enabled NO -only-testing:MannerPathUITests/StoreScreenshotCaptureUITests \
  CODE_SIGNING_ALLOWED=NO
xcrun xcresulttool export attachments --path /tmp/fresh-capture.xcresult --output-path /tmp/fresh-images
python3 scripts/test-store-screenshots.py
python3 scripts/validate-store-screenshots.py /private/tmp/mannerpath-v1-store-assets/capture-manifest.json
```

For Watch use scheme `MannerPathWatch Watch App`, class
`MannerPathWatch Watch AppUITests/StoreWatchCaptureUITests`, its paired Watch destination and
separate derived data. Release test builds need local `ENABLE_TESTABILITY=YES` because the scheme
also builds its unit-test target; this changes no project/production configuration. Use normal
phone WatchConnectivity only. Destination-only results do not sync to Watch. A simulator public
reference location is rehearsal only, never hardware evidence. Do not use the local fixture UI
runner or `MANNERPATH_WATCH_UI_TEST_*` snapshot injection for store capture.

The offline validator checks native dimensions, format/alpha, digest, confined paths and manifest
shape. It neither authenticates production/source claims nor approves content. Approval flags
remain false; no technical PASS can produce submissionReady=true.

## Required owner actions before G5/G10 closure

1. Connect paired physical iPhone/Watch with TestFlight 1.0 (3), record selected build evidence
   through Lane 3 without marking simulator results as physical PASS.
2. iPhone: deny location, search public Ueno, verify live IDs, capture native map/list/search/detail
   frames. Collapse the sheet for the opening map scene while retaining map credits. No private
   GPS or personal overlays. Confirm handoff on hardware separately; capture the in-app control.
3. Watch: pair normally and run iPhone nearby refresh **inside a covered area**. Tokyo destination
   search from an uncovered region cannot populate Watch. Check nearby list/detail, unknown access,
   freshness, source notices/license links and normal sync/cache on hardware. Capture native Watch
   screenshots (side button + Digital Crown after enabling screenshots), transfer originals from
   Photos, choose one supported size. If no covered-area physical session is possible, leave Watch
   assets and G10 blocked; do not inject a snapshot or claim working hardware.
4. Review every pixel for identity/notifications, real spots, language, map marks and truthful claims;
   compare source/license/processing notices on the selected signed build, including offline.
5. Approve exact asset rights under G5, rerun technical checks and use ASC Media Manager only after
   explicit upload authorization. This lane has not uploaded anything or closed release gates.

## Execution record

- Initial iPhone Release capture completed successfully; four unique retained scenes are listed
  above. The original xcresult and exported attachments remain locally under
  `/private/tmp/mannerpath-store-assets-iphone69-selected.xcresult` and
  `/private/tmp/mannerpath-v1-store-assets/iphone69-selected/`.
- Revised iPhone sequence compiled. Its later startup attempt is not a PASS unless a completed
  result bundle is recorded; the retained first-run files are not silently replaced.
- Watch Release capture compiled using the local testability flag. The UI-test launch stalled
  before yielding a verified populated MannerPath screen and was interrupted. The diagnostic
  screenshot showed the watch face, **not MannerPath**; it is not a Watch store asset. No Watch
  screenshot is delivered, no snapshot fixture was injected and no device PASS is claimed.
- No physical device was available to this session. Follow the owner actions above for the missing
  Watch list/detail and signed-build iPhone/map-credit checks. G5/G10 are still blocking, rather
  than closed by a simulator rehearsal or technical file validation.
- Offline screenshot tests: 6 PASS; actual four-image technical validation: PASS; GET-audit
  regression tests: 17 PASS; `make contract`: PASS. Read-only independent review found no
  tooling/docs merge blocker; it confirmed that rights, map-credit visibility and physical Watch
  checks remain release blockers. The second iPhone capture startup was also interrupted after
  remaining stalled; only the earlier successful candidate images are delivered.
- `make security-validate`: PASS. `make apple-validate` was attempted on dedicated simulators;
  the initial medium-device run stalled and was interrupted, and the already-booted-phone retry
  reported `xcodebuild: error: Unable to find a device matching the provided destination specifier:`.
  Xcode listed no available iOS simulator destination at that point. This is **not an Apple test
  PASS**; rerun on a healthy local simulator environment. Both Release capture targets had compiled
  successfully earlier. No production app source is changed by these opt-in test additions.
