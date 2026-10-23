# v1.0 App Store final-assets packet — Lane 4

Prepared 2026-10-24 against `origin/main` `eb4ed96` (PR #330 included).
Integration-reviewed after rebase onto `245c81d`: #331 legal/privacy decisions, #332 staging preparation,
#336 physical-device procedures and #335 public privacy-boundary regression coverage.
G1–G23 remain in the canonical Gate; no gate is newly DONE.
**SUBMISSION: BLOCKED. Assets prepared as instructions, not final approved media.**
Authority: [Release Gate](../V1_APP_STORE_RELEASE_GATE.md) is the sole go/no-go list;
[ASC entry sheet](../APP_STORE_CONNECT_ENTRY.md) holds pasteable metadata and field values.
This packet supersedes older scope/activation instructions only where explicitly noted.
No ASC access/change, production API request, data addition, deploy, upload, signing change,
build-number change or final screenshot capture was performed. Do not treat old evidence as new PASS.

## 1. Copy selection — one actual RC/runtime, not mixed feature sets

Name `MannerPath`; subtitle `喫煙可能場所と利用条件を確認`; keywords
`喫煙所,灰皿設置,指定場所,利用条件,徒歩案内,位置情報` remain unchanged.
The entry sheet §3 is the prepared **last-observed reports-disabled** description. Source audit:
map/list, destination typing/one-tap, details, source/uncertainty, online route preview/Maps handoff,
cached offline discovery, Watch nearby and widgets exist. Device rows still gate Watch/widget claims.
Do not advertise destination search as evidence of a smoking place or offline turn-by-turn navigation.
The earlier claim that every place's access conditions are confirmed was removed: historical observation
has access unknown for all 513 spots. Sources and usage rights are not proof of present access.

Keep the existing six-source area sentence only if an authorized recheck corroborates it.
Do not put a volatile spot count in store copy. No new sources/data until separately approved;
the 638-spot Tokyo candidate remains **not live**. The date/region/count of an old audit is not a current API fact.

### Photo-enabled description replacement — NOT FOR ENTRY before activation evidence

Only replace the disabled final paragraph in entry §3 with this exact candidate after all P0 photo gates
and maintainer approval. Do not append both mutually exclusive paragraphs:

```text
新しい喫煙所を提案するときは、地図で位置を指定し、写真を1〜3枚添えて報告できます。写真は運営の審査用で、公開されません。写真の位置情報などのメタデータは除去されますが、人の顔や車のナンバーは自動で消えません。報告は運営が確認し、承認された情報だけが掲載手続きを経て地図に反映されます。送信や写真の承認だけでは掲載されません。
```

No public photo gallery, automatic publication, automatic face redaction, instant review, or guaranteed
permission. Approved **facts**, not approved photos, may reach public tiles. Retry sends unsent photos
for the existing report; it must not create another report. Operator previews are private, not an app feature.

### Photo-enabled Review Notes replacement — NOT FOR ENTRY before activation evidence

Replace only the reports-disabled sentences in entry §5, retaining coverage/privacy/navigation notes:

```text
New-place proposals require 1–3 photos, a user-selected map pin and consent to the approved report terms. No account or sign-in is required; report submission uses Apple App Attest on a supported physical device. Photos are private review evidence, never public images. Metadata is removed, but faces and vehicle plates are not automatically redacted. Operators review reports and photos; only approved place information may proceed through publication checks. Submission or photo approval does not automatically publish a place. If a photo upload fails after the report is accepted, retry sends the remaining photos for that same report.
```

Code blocker at this baseline: `ReportComposition.makeModel()` uses the default disabled `PhotoEvidencePolicy`
(`ReportModel.swift`, `ReportPhotos.swift`). The uploader is wired but server activation alone does not make
new-place photo submission available; an approved-policy client build is also required. Failed photos stay
in memory only; after app restart the user reselects them for the existing report, not a new report.

Prerequisites: [photo plan R1–R14](V1_PHOTO_PLACE_SUBMISSION.md), #124 approved terms bundled and
server-reviewed byte/version match, production intake/storage/attestation readiness, deletion monitoring,
publication/early-erasure gates, staging E2E and physical Release evidence; policy and ASC label decisions
match the activated flow. These are requirements, not asserted achievements. Photo P0 is not waived by
retaining disabled copy. If intake remains off, **stop submission** and request an explicit scope decision.
Use [the legal/privacy decision pack](../legal/PHOTO_LEGAL_DECISION_PACK.md) for #331's approvals and
activation order (G23): photos-on labels include Photos or Videos, Other User Content and Device ID,
all linked, not tracking, App Functionality. Not Linked requires a design change, not a checkbox choice.

## 2. Production scope observation — procedure only, NOT RUN here

Production API operations are prohibited in this lane, including GET. The following is handed to a separately
authorized read-only operator. It is not permission to execute now. No D1/R2/admin/Cloudflare access is needed.

1. Record UTC time, RC/source SHA, the approved expected corpus and the public audit script/footprint SHA-256.
   Historical baseline: 6 sources / 513 distinct published IDs in 81 queried tiles, observed 2026-10-15 JST.
   Source counts: 台東32、港114、江東3、武蔵野3、大阪344、京都17. Region labels are source scopes, not full coverage.
2. From `services/api`, with Node 24 and a fresh private output path, run the existing bounded public-GET audit:

   ```sh
   npm run --silent release:data-audit -- \
     --tiles ../../docs/release/v1-production-tile-footprint.json \
     --out /tmp/mannerpath-v1-production-recheck-UNIQUE.json
   ```

3. The script observes readiness/config, tile manifests/parts and source/detail samples with response/count/hash/
   identity checks; it sends no credentials. Inspect its complete report, not just exit status. Save digest/time,
   distinct IDs, counts per source, source/license notices, precision/unknowns and exact intake config separately.
   **Compatibility limit:** this historical auditor requires reports/photos disabled (`release-data-audit.ts:59`).
   If either is enabled it stops before scanning. That failure is not missing/zero data and must not be fixed
   by switching production off. Request a separately reviewed read-only auditor compatible with the approved
   activated runtime from the API/data owner; until then, fresh active-release count evidence is pending.
4. No global tile index exists: 81-tile results cannot prove a global count or exclude extra published regions.
   A per-tile stable read is not an atomic cross-tile snapshot. Compare the bounded report to the operator's
   approved deployment inventory; on mismatch/incomplete/changed scan, HOLD G8/G19/G10 and ask the data owner.
   Never rebuild fixtures, re-ID/import spots, promote sources or widen the footprint silently.
5. Recheck on entry/capture day. Hand the dated evidence to the copy owner; update area sentence only to the
   verified shipped scope. A config observation alone does not prove photo upload, device attestation or moderation.

Historical evidence: [data/assets runbook](V1_DATA_AND_STORE_ASSETS.md),
[2026-10-15 observation](v1-production-data-2026-10-15.json). No newly observed production number is claimed here.

## 3. Screenshots — native final RC, real published data, operator approval

Apple pages rechecked 2026-10-23: [specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/),
[asset management](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-your-app-store-assets/).
At least 1 and at most 10 screenshots per device-size set, PNG/JPEG with no alpha/transparency.
Current required iPhone set is Dynamic Island **medium**, not an assumption that large alone is sufficient.
Confirm the actual required wells/scaling at handoff; this lane did not inspect Media Manager.

| Set | Planned native portrait pixels | Planned count / status |
| --- | --- | --- |
| iPhone required medium | 1206 × 2622 (or 1179 × 2556) | 5 frames I1–I5, none final |
| iPhone optional large | 1320 × 2868 (or 1260 × 2736 / 1290 × 2796) | Optional same 5 scenes, native capture, not upscaled |
| Watch required | 416 × 496 preferred; one consistent size across locales | 2 frames W1–W2, none final |
| iPad / Widget | iPhone-only target; no separate Widget listing | No native iPad or separate Widget set; recheck if target changes |

Other accepted Watch pixels: 422 × 514, 410 × 502, 396 × 484, 368 × 448, 312 × 390.
Use the corresponding supported hardware's native size, not a stretched smaller Watch capture.

| Frame | Final RC scene / safe caption |
| --- | --- |
| I1 | Published Tokyo map/list: 「掲載地域の場所を地図で確認」 |
| I2 | Type 上野 or a covered public destination; visible suggestions: 「目的地の周辺を検索」 |
| I3 | Selected-destination list: 「目的地からの距離・方向を確認」; keep destination-relative context |
| I4 | Actual published detail/conditions/freshness/source: 「利用条件と情報源を確認」; preserve unknown/目安 labels |
| I5 | MannerPath's Maps handoff control: 「Appleのマップへ案内を引き継ぐ」; no other-app screen represented as ours |
| W1 / W2 | Genuine nearby cached list / detail with distance, direction, conditions and source |
| I6 optional | Photo proposal entry/form only AFTER verified activation and policy/terms approval; no test photo upload for marketing, private previews or submitter content |

Existing [capture steps](V1_DATA_AND_STORE_ASSETS.md#privacy-safe-iphone-capture-steps) apply.
Final selected RC only, Japanese, clean nonpersonal session, genuine production spots, no injected dataset,
`uiTestDestinationSearch`, photo fixture, `MANNERPATH_WATCH_UI_TEST_*`, local Worker or synthetic screenshots.
Search a public destination with location denied on iPhone if needed; do not pretend it is current location.
**Destination results do not sync to Watch.** Watch scenes need paired hardware physically in a covered area
with actual nearby sync/cache, not a Tokyo search from outside the area or spoofed location evidence.
Preserve map credits, rights notices, uncertainty and access qualifiers. No tobacco-brand/consumption imagery.
Do not manufacture an approximate example if the actual corpus contains none.

Keep originals and a private manifest: image hash, native device/OS/locale, app version/build, source SHA/tree,
capture time, API report hash, displayed production IDs, real-device vs simulator, fixture=false and evidence refs.
Use `sips`/`shasum` and `python3 scripts/validate-store-screenshots.py /private/captures/manifest.json`
offline per the existing candidate schema. Technical PASS always leaves submissionReady=false; it is not
proof of production authenticity, rights or signed-device behavior. Record operator visual/privacy/rights
approval separately, plus the selected filenames/order. Never put personal identifiers or raw photos in Git.

## 4. Material and verification inventory

| Material | Available evidence / remaining item |
| --- | --- |
| Japanese name/subtitle/keywords/description | Entry §0/§3, length guards; final runtime/area choice + maintainer approval still needed |
| Review instructions | Entry §5 and §5 below; run again on selected RC, no hidden reviewer bypass |
| iPhone/Watch icons | Committed identical opaque 1024px masters; unsigned archive evidence dated 2026-10-06 in [distribution §3.1](../APPLE_DISTRIBUTION_READINESS.md). Final signed icon presence/normal-brightness device appearance/asset rights still open |
| IDs / App Group | Source IDs: `com.kounishiyuuki.MannerPath`, `.widgets`, `.watchkitapp`, `.watchkitapp.widgets`; all four use `group.com.kounishiyuuki.MannerPath`. Source settings are not a signed entitlement or shared-container device PASS |
| Signing / App Attest | Historical signed 1.0 (3) preflight/IPA (#273), production App Attest entitlement and all four App Groups; not evidence for current 1.0 (6) or the final RC |
| Final RC | Source version/build 1.0 (6) at baseline; no signed/processed/installed final RC inspected here. Lane 3 supplies artifact/hash and evidence without this lane changing credentials or version |
| Screenshots | No final approved set; I1–I5 + W1–W2 above. Fixture captures and old rehearsals are not final assets |
| Compliance | Privacy choice, photo-flow labels/linked decision, age/UGC questionnaire, encryption answer, content/asset rights, legal terms and policy approval remain owner decisions |
| Personal ASC fields | SKU, copyright holder, review name/phone/email entered privately by operator; never invented or committed |

For the supplied final artifact, authorized operator runs existing `scripts/apple-beta-preflight.sh <signed.xcarchive>`
and `python3 scripts/check-apple-beta-artifact.py <signed.xcarchive> --distribution`, plus the device matrix.
An unsigned archive or code-level entitlements cannot close G14/G15/G21. No archive/signing/Xcode run was needed
for this docs-only preparation; existing offline checker fixtures run in `make contract`.

## 5. Reviewer and submission-day handoff — instructions, not executed

The [final physical-device E2E procedures](V1_FINAL_DEVICE_E2E.md) from #336 supplement the
[device matrix](../beta-e2e/device-release-matrix.md): §3.1 search, §3.2 Watch/widgets, §3.3 offline/permissions,
§3.4–3.5 photo picker/recovery, §3.6 accessibility, §5 intermittent photo-form UI test findings.
Keep RC results separate from DEBUG scripted-photo `DEV` notes; neither scripted upload nor a Simulator
PASS closes Release photo P0. The #336 sheet records no device observation. For Watch zero-data checks,
use the genuine current-location corpus: its §3.2 destination-selection shortcut does not establish a
Watch corpus change, because destination results do not sync. Do not record that shortcut as a device PASS.
Real photo E2E follows [#332's isolated staging runbook](V1_PHOTO_STAGING_RUNBOOK.md) and separate approval;
its remote operations were not run, and this document authorizes none of them.

1. Use entry §5 steps on the selected RC: fresh install/eligibility, When In Use or deny, type 浅草駅 東京,
   select destination without a separate Search button, loaded map/list, detail/source/license, filters/clear.
   Explain partial coverage and a distant route's unavailability; never direct reviewers to an unpublished fixture.
2. Load once then disconnect: cached information/distance/direction remain, no offline walking-route promise.
   Verify privacy/support/mail links; paired Watch list/detail/cache only on real covered-area data.
3. If photos are activated, on a supported physical iPhone verify map/report button → pin → duplicate check →
   1–3 safe photos → details with unknown values allowed → approved terms → send → pending receipt.
   Verify partial-failure retry resumes the same report, not a duplicate. **Do not send a dummy production report**
   in this lane. Staging evidence/manual device verification needs separate authorization; provide an approved
   demo video if review geography/device limits prevent demonstration, never bypass App Attest.
4. Owner resolves all G1–G23 P0 and accepts/closes P1 in the canonical Gate; preserve evidence on the same RC.
   Privacy: do not reuse disabled-flow labels for enabled reports. Decide Photos/Videos, Other User Content,
   Device ID and pin-location classification/purpose/linkage against [photo privacy review](../legal/PHOTO_PRIVACY_REVIEW.md).
   Metadata stripping/no account does not establish anonymity. Existing read-only support labels and provider
   retention UNKNOWNs still need approval. Check policy, bundled terms and manifest against final decisions.
5. Owner completes the current age questionnaire: tobacco Frequent recommendation, Apple-calculated result;
   **reassess UGC when submissions are enabled**, even with pre-publication moderation. No automatic UGC=No.
   Minimum-use-age policy/standard EULA remain legal decisions. Check current [age definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/).
6. Review final linked code/territories before encryption answer: OS HTTPS/crypto still requires a determination,
   not “no encryption”. Existing proposed exemption is owner-approved only after archive review;
   no `ITSAppUsesNonExemptEncryption` or credential changes here. [Apple export guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).
7. With separate authority only, operator verifies ASC record/agreement/build/version/hash, input language,
   metadata/photos-state/coverage consistency, contact, selected native image sets/order, privacy policy/label,
   rights, age, export, Japan/free and manual release. Enter only approved values; leave unresolved items blocked.
   Inspect processing warnings and accessibility fields honestly, not inferred from Simulator/SwiftUI.
8. Save a private signoff record with approver/time and evidence hashes. **STOP before Add for Review / Submit**
   until separately authorized. This PR grants no ASC change, TestFlight upload, submission or production operation.

## 6. G1–G23 remaining actions (index, not a second go/no-go list)

| Gate | Remaining evidence / owner handoff |
| --- | --- |
| G1 | Operator: SKU/copyright and actual ASC field entry, no placeholders |
| G2 | Maintainer: final runtime-based privacy labels, including photo linkage if enabled; save approval/entry evidence |
| G3 | Maintainer/legal: policy matches final flow and G2; public-site owner publishes only under separate approval |
| G4 | Maintainer/legal: EULA and #124 approved photo terms; matching client/server version |
| G5 | Maintainer: actual shipped corpus + signed iPhone/Watch notices/links + map/icon/screenshot rights |
| G6 | Operator: current age questionnaire, UGC decision, computed rating and minimum-age policy |
| G7 | Distribution owner: final archive crypto/library/territory review and ASC answer |
| G8 | Copy owner: authorized dated scope recheck + one correct enabled/disabled paragraph; no new data without approval |
| G9 | Public-site owner: approved covered-area explanation, no stale candidate expansion |
| G10 | Operator: native final RC I1–I5/W1–W2, provenance + visual/privacy/rights approval |
| G11 | Operator: private review contact entry and reachable support owner |
| G12 | Maintainer: final matching Review Notes and actual RC rehearsal, photo steps only when verified |
| G13 | Device owner: support/privacy/mail links on signed physical build |
| G14 | Distribution/device owners: final signed preflight + App Group shared data + production App Attest/photo verification |
| G15 | Device owner: Watch and widgets matrix PASS on same final RC, no destination-sync shortcut |
| G16 | Runtime owner: authorized submission-day config evidence; off is not completion of the photo P0 |
| G17 | Device owner: first launch, location denied/allowed, destination/empty, offline and submission-failure states |
| G18 | Device owner: VoiceOver/large text/contrast/motion and honest accessibility claims |
| G19 | Data owner: existing production scope only; bounded public scan vs deployment inventory, no data addition |
| G20 | Maintainer: accept residual tobacco/sparse-coverage/privacy review risks, accurate notes |
| G21 | Distribution owner: processed final RC identity/hash, final signed preflight/device evidence; no build bump here |
| G22 | Optional P2 in-app covered-area list; do not elevate it to a submission blocker or mark it implemented |
| G23 | Maintainer/legal: [photo decision pack](../legal/PHOTO_LEGAL_DECISION_PACK.md) §1 steps 1–8, then §7 activation PRs, separately approved staging E2E and Release device run; OPEN P0 |

No device, screenshot, activation or legal gate is closed by this packet. Re-open stale evidence after any
runtime/build/data change. [Apple privacy definitions](https://developer.apple.com/app-store/app-privacy-details/)
remain the basis for final answers; this packet is engineering preparation, not a legal determination.
