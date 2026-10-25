# v1.0 production data and store asset preparation — Lane 4

**2026-10-24 handoff:** [final-assets packet](V1_APPSTORE_FINAL_ASSETS.md) updates the final RC,
activation-dependent copy and G1–G21 checklist. This page's counts/config are the dated 2026-10-15 observation,
not a new current/global inventory. No data additions until separately approved. Public-GET commands below
are procedures for a separately authorized operator, not permission under the current no-production-API task.

Prepared 2026-10-15 from main `e7a465468cfdeb6a3400ad37e74c9b89fa5b58cf`.
**Preparation complete; final screenshots NOT produced or approved. Submission remains blocked.**
No production writes, Cloudflare operation, source addition, UI/build-number change, archive,
signing, TestFlight upload or App Store Connect entry is part of this work.

## Production observation (G8 / G19)

Maintainer release decision: v1 ships the existing six-source corpus; new repository-reviewed
sources go to production **after** release. No nationwide-completeness claim.

[GET observation](v1-production-data-2026-10-15.json) was collected
2026-10-14T16:42:39.935Z–16:43:51.168Z (2026-10-15 JST) at
`https://mannerpath-api-production.happywestyuki.workers.dev`.
The [81-tile footprint](v1-production-tile-footprint.json) comes from a local reconstruction
of the pinned **six deployed sources**, not from device GPS or MapKit results. For each tile,
read its manifest and every listed part, verify bytes/SHA-256/ETag/counts/identity/coordinate
ownership/source metadata, then re-read the manifest to reject a change during that tile's read.
Six live spot-detail samples agree with the tile values and source metadata.

**Scope limit:** the API has no global published-tile index. This observes 513 distinct IDs
inside the explicit 81-tile footprint; it corroborates the declared deployed inventory, but
cannot prove that no additional tile/source exists elsewhere. Individual tile read-back is not
an atomic snapshot across all tiles. No remote D1 query, unpublished row, internal lineage,
promotion bundle digest or source-record identity was audited in this pass. Recheck before
store entry/capture; never turn this bounded observation into a nationwide count or guarantee.

| Region / source ID | Observed spots | Access unknown | Hours unknown | License |
| --- | ---: | ---: | ---: | --- |
| 台東区 / `taito-public-smoking-areas` | 32 | 32 | 12 | CC BY 4.0 |
| 港区 / `minato-designated-smoking-areas` | 114 | 114 | 114 | CC BY 4.0 |
| 江東区 / `koto-station-smoking-areas` | 3 | 3 | 3 | CC BY 4.0 |
| 武蔵野市 / `musashino-public-smoking-areas` | 3 | 3 | 3 | CC BY 4.0 |
| 大阪市 / `osaka-designated-smoking-areas` | 344 | 344 | 344 | CC BY 2.1 JP |
| 京都市 / `kyoto-public-smoking-places` | 17 | 17 | 17 | CC BY 4.0 |
| **Total in queried footprint** | **513** | **513** | **493** | Six municipal sources |

Region labels describe each source's reviewed scope, not a newly computed administrative-boundary
join. This does not imply full coverage of those municipalities.

- `areaApproximate`: **0**. All observed spots carry `publisherPoint`; this is publisher-supplied
  positioning, not survey accuracy or present permission. Do not manufacture an approximate-airport
  screenshot for v1: those sources are not in this observed corpus.
- Access conditions are unknown for **all 513**. Unknown is not public/customer-only/closed.
  Hours are unknown (none/unparsed) for 493; never display them as currently open.
- `lastVerifiedAt` unknown for **464**. Known dates: Taito 2026-08-18, Kyoto 2026-09-03.
  These are source observation dates, not this API check time or on-site verification.
- Missing tile source references/license names/license URLs/attributions: **0**; all six live
  source strings exactly match approved adapter registry metadata. No hash/ETag/count mismatch,
  duplicate published ID or invalid tile ownership was found.
- `/v1/readiness`: completed; `/v1/config`: reports unavailable, photos disabled. Its report
  protocol is the deployed v2, distinct from repository schema v3; do not activate or upgrade it.
- Repository reviewed adapters: **15**, distinct from the **6** declared deployed sources.

### Local comparison — not production facts

[Local fixture reconstruction](v1-local-six-source-comparison.json): 515 canonical, 513 published,
81 tiles, source counts equal the GET observation; quality checks pass. Its test spot IDs are
artificial and **must not be used for screenshots or presented as production IDs**. Local
canonical/excluded counts do not establish production's internal counts. No local fixture is
promoted, installed as screenshot data or used to expand the v1 release scope.

## Content rights and precision (G5)

The six deployed sources remain resource-specific licensed datasets, not factReference sources.
The live license URL/name, display name and required attribution match the approved entries in
[SOURCES](../SOURCES.md) and adapters (6/6). Osaka retains **2.1 JP**, not generic site 4.0.
[13 distinct served license/attribution URLs](v1-source-link-availability-2026-10-15.json) returned
HTTP 200 on GET (one Osaka raw-file Node transport attempt was unverified; a same-URL curl
GET returned 200). This checks reachability, not page contents or renewed permission.
This rechecks served metadata; the original imported-byte terms/provenance and 2026-10-05 D1
lineage audit remain in [the rights audit](../PRODUCTION_CONTENT_RIGHTS_AUDIT.md). This pass does
not newly clear legal rights or assert that every upstream page is unchanged.

G5 remains OPEN: signed iPhone/Watch notice readability, Taito modification indication, source/
license links, offline attribution, map credit, final asset rights and maintainer signoff are
still required. Ordinary source URLs inside attribution text need not be individually tappable;
verify the implemented license link and full notice rather than promising otherwise.

If a live source/license link, required notice or precision contract is defective: record a **P0**,
stop asset approval and report it. Do not repair production data from this lane. A network timeout
alone is not proof of missing rights or a closed place; distinguish it from an actual defect.
Approximate UI must preserve the approximate label/scope and “この付近へ案内” semantics if that
precision appears in a future corpus; a facility point never becomes an exact smoking-room pin.

## Screenshot specification and rights (G10)

Checked Apple's current pages 2026-10-15:
[screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/),
[asset management](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-your-app-store-assets/),
[Review Guidelines §2.3.3 / §2.3.9](https://developer.apple.com/app-store/review/guidelines/),
[Developer Program License Agreement, Attachment 6](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).

| Set | Native portrait capture | Preparation |
| --- | --- | --- |
| iPhone required medium Dynamic Island set | **1206 × 2622** or **1179 × 2556** | Prefer a matching device/RC capture for the required well |
| iPhone large Dynamic Island (historical “6.9-inch”) | **1320 × 2868**; alternatives **1260 × 2736**, **1290 × 2796** | Optional larger set; check Media Manager's scaling/required-well acceptance |
| Apple Watch | Prefer **416 × 496** on a matching 46mm capture | Required for shipped Watch app; one size across all localizations |
| Watch alternatives | **422 × 514**, **410 × 502**, **396 × 484**, **368 × 448**, **312 × 390** | Choose the actual supported device's native size; never mix sizes by locale |
| iPad | No native iPad set for this iPhone-only app | Recheck if target family changes in another lane |

PNG/JPEG, no alpha/transparency; 1–10 images per supported size/set. Japanese is the initial
store localization; the app has `ja` and `en`, which does not mean English store assets exist.
Recheck accepted wells/dimensions at upload; the old “6.9-inch is the only required set” wording
is not a substitute for the current table. Do not resize a different UI layout to fake a native capture.

Capture the app in use with real production spots. Leave map-provider marks/legal credits visible;
no cropped/covered credits, extracted map backgrounds, copied map tiles, logo composites or
implied Apple endorsement. Municipal CC licenses do not license Apple imagery. Apple's Maps
terms restrict removal/obscuring of marks and unauthorized copying; the actual submitted asset
must be checked against the team's applicable agreement and approved by the maintainer under G5.
This preparation is not a blanket permission to redistribute Apple map imagery.

## Five iPhone scenes — production data only

PR #263 and the Build 3 project change (#273) are merged in the inspected main. That is **not**
evidence of a processed TestFlight build, distribution-signature validation or device PASS.
Use the actual selected release-candidate build after Lane 3 makes it available; record its
build/source provenance. Do not rebuild/archive/sign/upload or change UI in this lane.

| Frame | Screen/action | Honest caption proposal / checks |
| --- | --- | --- |
| I1 | Loaded map + nearby list for a public Tokyo destination | 「掲載地域の場所を地図で確認」. This is destination surroundings, not the maintainer's current location; no nationwide claim |
| I2 | Search “浅草駅 東京” or “上野駅 東京”, select the public destination | 「目的地の周辺を検索」. Keep destination context visible; suggestions are MapKit destinations, not smoking-place evidence |
| I3 | Loaded smoking-place list showing distance/direction | 「目的地からの距離・方向を確認」. Preserve the destination-relative labels; do not relabel them as device-relative |
| I4 | Production place detail, access/freshness/official evidence and Sources | 「利用条件と情報源を確認」. Unknown remains unknown; source-confirmed is not on-site checked or guaranteed available |
| I5 | In-app Apple Maps handoff control for that same live place | 「Appleのマップへ案内を引き継ぐ」. Actual handoff is device-checked separately; do not require a distant walking route or show another app as MannerPath |

Keep Source/license notice captures and the actual external Maps transition as **private review
evidence** if they do not fit the five store frames. Never omit G5 checks to keep the story short.

Observed production candidate IDs/names (six-source samples) are in the GET report; they are
not synthetic fixture IDs. A [Tokyo candidate observation](v1-tokyo-screenshot-candidate.json) additionally checked through
the public part and spot detail is **佐竹公衆喫煙所**, `sp_1CNC5Y441SJS8J0F3EF95CX834`, tile `14/14553/6450`.
Use “上野駅 東京” for this example; actual results/radius may change, so select only a currently
visible published place. Search acceptance and navigation must be rerun on the chosen RC after #263.
If the UI selects a different place, record/recheck that live ID; never force a fixture row into it.

### Privacy-safe iPhone capture steps

1. Record the actual RC version/build/source, device/model/OS, locale `ja-JP`, date and production
   GET report digest. No personal name, account identifier or contact information in the manifest.
2. Use a clean app session with location denied and no personal search history/favorites, home/work
   destination, notification banners or personal account overlays. Do not reset any maintainer data.
3. Accept the eligibility notice, search the public Tokyo destination, select it and refresh if needed.
   Denied location supports destination browsing; clearing the destination returns to an honest empty state.
4. Confirm list/map spots against the live observation/detail; preserve context, precision, unknowns,
   access qualifiers and dates. Do not paste spot names into an image or edit a place into a map.
5. Capture native images for I1–I5 from the chosen RC. Keep uncropped originals privately; select
   frames without personal GPS/blue dot, names, notifications or inferred home/work coordinates.
6. Read the complete source/processing notices and open license links on the signed build. Verify
   Maps handoff and return navigation; record device evidence separately from image technical checks.
7. Check dimensions/alpha and human visual/privacy/rights/claims review. Only then mark individual
   assets approved. No “final assets ready” from simulator or dimension checks alone.

## Watch — two conditional scenes, still blocked

W1 nearby/cached list; W2 place detail with distance/direction/access/freshness/source/license.
No Watch destination search, report/photo form or unverified navigation promise. Watch Maps handoff
is OS-gated (11.4+); it is not a required marketing frame until physically verified.

**Tokyo destination results do not sync to Watch.** `NearbyModel.publishResults` only updates the
Watch/device corpus when `area.deviceLocation` exists; remote destination browsing does not qualify.
A paired phone outside the covered area cannot supply these Tokyo Watch scenes by searching Tokyo.

Use genuine nearby production results on paired hardware in a covered area, verify the matrix's
Watch/sync/cache/license-link rows on the selected RC, then approve any Watch asset. Remove private
GPS/identity/notifications from the capture context; if distance/bearing reveals a personal location,
withhold that asset until a nonpersonal capture can be reviewed. Never inject a snapshot, use
`MANNERPATH_WATCH_UI_TEST_*`, spoof device evidence, or call a fixture screenshot a store asset.
A production-connected simulator rehearsal, if separately chosen later, is clearly labelled as such
and cannot fill a hardware PASS row or substitute for the selected signed-build check.

## Automation and handoff

Re-run only public GETs with the explicit historical footprint (Node 24, from `services/api`):

```sh
npm run --silent release:data-audit -- \
  --tiles ../../docs/release/v1-production-tile-footprint.json \
  --out /tmp/mannerpath-v1-production-recheck.json
```

Use a fresh output path. The tool never opens D1, fetches arbitrary origins, sends credentials or
writes production. It caps tiles (100), parts (256), sources/detail samples (20), all GETs (512), response
bytes/time, fails on incomplete/changed snapshots
and reports scoped observations, not universal inventory. Failed scans leave no complete report.
Synthetic tests inject responses and never query production during CI.

Existing production UI checks (`I_ProductionAPIUITests`, `J_ProductionDestinationUITests`) can
rehearse the remote browse flow; their old selectors may need updates in the UI lane after #263.
`scripts/run-iphone-ui-tests.sh` creates fixture/synthetic data and is **not** a store capture path.
No new UI-test hooks or capture-mode overrides are added.

Inspect captured image properties offline (macOS):

```sh
sips -g pixelWidth -g pixelHeight -g hasAlpha /path/to/actual-rc-capture.png
shasum -a 256 /path/to/actual-rc-capture.png
```

These prove only file properties/digest, not build/data authenticity, privacy or rights. Save a
private capture manifest per image: file digest, set/locale, version/build/source, native device/
OS, capturedAt, API origin/report digest, displayed production spot IDs, actual vs simulator,
fixtureMode=false, device evidence reference, and visual/privacy/credit/notice approvals.
Unobserved fields stay pending; never prefill approval booleans. No finished images are committed here.

G8 scoped area copy is consistent; G19's frozen-corpus decision/data observation is recorded.
G5 and G10 remain OPEN. Lane 3 must supply the processed RC and device evidence; the maintainer
must approve final notices/assets/ASC entry. Source discovery and new promotion resume after v1.
