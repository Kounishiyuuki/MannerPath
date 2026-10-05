# MannerPath v1 — App Store submission / compliance

**APP STORE COMPLIANCE: READY FOR MAINTAINER INPUT** (packet prepared; not authorization to submit).
Target: mid-October 2026. Checked 2026-10-04 against `origin/main` **d511f1a**,
which includes #170 / #171 / #172. Apple rules can change: recheck the linked pages at submission.
This is an engineering recommendation, not legal advice or a guarantee of App Review approval.

**Entry sheet (2026-10-05):** [APP_STORE_CONNECT_ENTRY.md](APP_STORE_CONNECT_ENTRY.md) lists every ASC value as
CONFIRMED / MAINTAINER / WAITING-PRODUCTION / BLOCKED-DEVELOPER-PROGRAM, in entry order. It found a **P0**: no app icon.

Scope: App Store Connect inputs and release evidence. No Apple code change, production deployment,
source research, or community activation. No OpenPOI / Overture additions or OSM adoption.
The recommended first release is **read-only: reports, App Attest registration and photos unavailable**.
That is a deployment decision to confirm, not a compile-time guarantee.

## 1. Exact App Store Connect checklist

Use an authorized Account Holder/Admin/App Manager and the final signed build. Do not paste bracketed
maintainer markers below into App Store Connect. Save evidence and the final answers with the release record.

- [ ] Agreements/account: active Developer Program membership, accepted agreements, verified developer identity.
- [ ] Apps → MannerPath → App Information: confirm bundle ID `com.kounishiyuuki.MannerPath`, SKU,
      primary language Japanese, localized name/subtitle (§6), primary category Navigation,
      optional secondary Utilities, Content Rights (§5), Age Ratings (§3), standard Apple EULA or approved custom EULA.
- [ ] App Information → App Encryption Documentation, or build → Manage: complete §4 for the actual archive.
- [ ] App Privacy → Get Started/Edit: select actual data types, purposes, linkage and tracking (§2);
      publish answers and enter the public Privacy Policy URL (§8). Do not select “Data Not Collected” before log audit.
- [ ] Pricing and Availability: maintainer approves free price recommendation, Japan-first storefront recommendation,
      distribution method, and optional Apple-silicon Mac / Apple Vision Pro availability after testing.
      If EU availability is selected, complete applicable trader/compliance information; do not infer trader status.
- [ ] iOS App → version 1.0: choose the processed release build; confirm version/build numbers match the archive;
      fill description, keywords, optional promotional text, support URL, optional marketing URL and copyright (§6).
- [ ] Upload localized iPhone **and iPad** screenshots plus Apple Watch assets (§9); inspect Media Manager.
      Both app Release device families `1,2` are currently supported. Widgets have no separate store listing.
- [ ] App Review Information: Sign-in Required **No**, contact first/last name, reachable phone/email,
      final notes and review instructions (§7); attach a short flow video if geographic access is difficult.
- [ ] Version release: recommend **Manual release**, allowing final backend/privacy checks after approval.
- [ ] Confirm public support/privacy pages, in-app privacy access, production HTTPS origin, honest empty states,
      attribution, reports unavailable and no photo intake on the actual release build/deployment.
- [ ] Complete applicable current compliance/accessibility fields honestly; claim accessibility support only after
      device verification, not merely because SwiftUI is used.
- [ ] Add for Review → review submission details → Submit for Review only after §10 blockers are closed.

Field definitions: [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/),
[Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/),
[Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/).
Backend release evidence and maintainer operations remain in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## 2. App Privacy answers

### 2.1 Basis and decision rules

Implementation inventory: [APP_PRIVACY_INVENTORY.md](APP_PRIVACY_INVENTORY.md) (#171); implementation
clarifications below supersede its shorthand, without changing the privacy contract. Swift paths abbreviated
as `Core/...` or `Features/...` are relative to `apps/apple/MannerPath/MannerPath/`.

Apple defines collection by off-device access beyond real-time servicing. Linkage can be through a device,
without an account; persistent hashing does not establish anonymization. Fraud prevention is App Functionality,
not automatically tracking. Optional submissions are not automatically exempt from disclosure.
These are applications of [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/).

The tables cover MannerPath's flows. On-device processing is not label collection. Apple MapKit search/routes
and system Maps can communicate with Apple; never promise that no location ever leaves the device.
Confirm the release's framework/provider behavior against Apple's privacy guidance, rather than classifying
system Maps handoff as MannerPath retaining GPS.

### 2.2 Initial v1: recommended answers, subject to production verification

“—” means linkage/purpose questions are not presented for an uncollected type, not proof of anonymization.
All rows are **NOT TRACKING**. No advertising, marketing or analytics purpose is recommended.

| Data / ASC category | COLLECTED / NOT COLLECTED | LINKED / NOT LINKED | PURPOSE / evidence |
| --- | --- | --- | --- |
| Device GPS / Precise Location | NOT COLLECTED by MannerPath backend | — | On-device ranking/distance/bearing; `Core/Location/DeviceLocationService.swift`, `Core/Networking/TileAPIClient.swift` |
| Tile request location / Coarse Location | Conditional; CONSERVATIVE ANSWER: COLLECTED until log audit closes | CONSERVATIVE ANSWER: LINKED if retained with IP or correlatable request identifiers; NOT LINKED only with demonstrated pre-collection de-identification | App Functionality: tile downloads/security; see §2.3 |
| User-selected report pin | NOT COLLECTED while report intake unavailable | — | No submitted report; local drafts do not count |
| Notes / structured report claims / Other User Content | NOT COLLECTED while report intake unavailable | — | Local drafts only |
| Photos or Videos | NOT COLLECTED | — | `photoEvidenceEnabled:false`; no evidence upload |
| Random install UUID / submitter hash / Device ID | NOT COLLECTED while report/auth intake unavailable | — | Local UUID may exist; no browsing transmission |
| App Attest key ID / Device ID; attestation/assertions | NOT COLLECTED only if registration/challenge/assertion flows unavailable too | — | Confirm no registration occurs merely by browsing |
| Diagnostics / Other Diagnostic Data, Performance Data | NOT COLLECTED by app instrumentation; conditional on backend/provider retained technical logs | If collected with IP/key: CONSERVATIVE ANSWER LINKED | App Functionality if retained for security/reliability; audit actual payloads |
| Analytics / Product Interaction, Other Usage Data | NOT COLLECTED by app analytics; conditional on provider use of request logs | If implemented, reassess linkage | No analytics SDK; if logs are used to measure behavior, add Analytics and actual Usage Data categories |
| Crash Data | NOT COLLECTED by app | — | No crash SDK/MetricKit upload; Apple system-provided diagnostics are not an app-integrated collection pipeline |
| Name, email, contacts, account, payment data | NOT COLLECTED by these app flows | — | No account/payment/contact access; separately assess support workflow if an in-app form is added |

**ASC top-level answer:** “No, we do not collect data” only after proving no retained label data across the
release and providers. Otherwise choose “Yes” and enter the audited types above. The conservative fallback is
**Coarse Location, linked, App Functionality, not tracking**, plus any additional categories actually retained;
it is not permission to ignore diagnostics or identifiers present in logs.

### 2.3 Tile path + IP: Location collection?

Latest evidence: [production privacy audit, 2026-10-05](PRODUCTION_PRIVACY_AUDIT.md). Committed settings/source
were verified; refreshed OAuth succeeded. The configured production Worker and production-named D1
resources are absent from the audited account, and R2 reports not enabled. Logpush inventory returned 403;
analytics/retention and eventual live gates remain UNKNOWN / MANUAL CHECK. No “Data Not Collected” signoff is supported yet. Committed console logs are enabled (also observed
in E2E inventory); production settings are unavailable. Framework exception logs remain possible even
with invocation logs disabled.

Inference: z14–16 tile paths select a geographic area associated with the request. Retaining that path with IP
beyond real-time service can collect Location, even without raw GPS or intentional history. Recommend Coarse
Location for this area-based request. Inspect the actual zoom/area resolution and whether logs reconstruct a
more precise user/device position; disclose Precise Location too if the retained information meets Apple's
precision definition. Tile IDs are not automatically non-location data. [Apple data definitions](https://developer.apple.com/app-store/app-privacy-details/).

`services/api/wrangler.jsonc` disables invocation logs in all environments. Repo configuration cannot prove
production Logpush, CDN, WAF, security/rate-limit logging, analytics products, Workers logs or subprocessor
retention. Maintainer records, without copying secrets: deployed config/version, each logging service and
retention duration, stored fields, IP truncation/removal timing, access, purpose, deletion and linkage.
No retained paths/IP: NOT COLLECTED for this flow. Retained identifiable area logs: conservative answer above.
Retained IP alone still requires category/purpose analysis; it does not by itself prove precise GPS collection.

### 2.4 Reports disabled: no future collection declaration yet

Recommendation: omit report-only categories when the shipped experience **cannot collect them**, including
independent App Attest registration. Dormant code alone is not actual collection. This is an inference from
Apple's collection definition, not a published feature-flag exemption. [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/).

Verify `/v1/config` has `reports.available:false` and `photoEvidenceEnabled:false`, the report and
`/v1/app-attest/*` routes fail closed, and real app browsing emits no auth/report requests. Capture sanitized
results and configuration evidence. `REPORT_ATTESTATION=disabled` is **not** a kill switch: it accepts
unattested local reports. Production must retain `REPORT_ATTESTATION=required` and unavailable App Attest
configuration, following [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Configuring App Attest later may activate
collection without a new binary. Update labels, public policy and relevant manifest/build before activation.
**CONSERVATIVE ANSWER:** if availability/registration cannot be proven off, use the enabled table and close
that uncertainty before submission; do not advertise reports as disabled without evidence.

### 2.5 If reports are enabled later — separate answers

| Data / ASC category | COLLECTED | LINKED | TRACKING | PURPOSE |
| --- | --- | --- | --- | --- |
| Note, structured claims / Other User Content | COLLECTED | LINKED | NOT TRACKING | App Functionality: moderation/corrections |
| Chosen place pin / Other User Content | COLLECTED | LINKED | NOT TRACKING | App Functionality: proposed place/correction |
| Pin also reveals user/device position / Precise Location | CONSERVATIVE ANSWER: COLLECTED; see below | LINKED | NOT TRACKING | App Functionality |
| Random install UUID retained as hash / Device ID | COLLECTED when used for submitted reports | LINKED | NOT TRACKING | App Functionality: integrity/abuse prevention |
| App Attest key ID/public-key record / Device ID | COLLECTED | LINKED | NOT TRACKING | App Functionality: integrity/fraud prevention |
| Attestation/assertion payloads | Verify retained fields; Device ID for identifier linkage; Other Data Types if additional retained payload is not covered | LINKED where retained with key | NOT TRACKING | App Functionality |
| Evidence photos / Photos or Videos | NOT COLLECTED until independent photo intake activation; then COLLECTED | LINKED when enabled | NOT TRACKING | App Functionality: private evidence moderation |

Pins are quantized to five decimals but represent a **place**, not automatically the user's current position.
Primary classification is Other User Content; conservative additional Precise Location disclosure is recommended
if the pin can identify the user's location. Apple does not give a MannerPath report-pin ruling. Metadata stripping
removes EXIF GPS, not identifying pixels. Photo intake needs separate consent/rights approval (ADR-0016).

Identifiers: Device ID is recommended because these identifiers correlate an installation/device; no account
exists. User ID is not automatically required just because the server column is named `submitter_hash`.
**CONSERVATIVE ANSWER:** also disclose User ID if the operator treats that hash as a contributor/user identity.
Regardless of category, related reports remain LINKED while key/hash correlation is possible. These mappings
are engineering interpretations of [Apple identifier/linkage definitions](https://developer.apple.com/app-store/app-privacy-details/).

Implementation correction: `services/api/src/reports/create.ts` hashes the random install ID for unattested
submissions; attested production reports instead derive the submitter from `attestedSubmitter(keyId)` and hash
that value. `services/api/src/reports/attestation.ts` and `Features/Reports/ReportAuthorizer.swift` show registration
can precede report acceptance. A raw client UUID is not the only correlation mechanism. Retention minimization
is defined in [ADR-0007](adr/0007-report-privacy-and-retention.md); later deletion does not undo collection.

## 3. Age rating questionnaire

Current Apple system (OS 26+): 4+, 9+, 13+, 16+, 18+, with regional results and older-OS results shown separately.
Recommend the following factual answers; retain a screenshot/export of the final questionnaire and calculated
ratings. [Age rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/).

| Question/content | Recommended initial-v1 answer | Reason |
| --- | --- | --- |
| Alcohol, Tobacco, or Drug Use or References | **Frequent** | Smoking-place purpose and tobacco support references recur in primary list/detail/filter flows; neutral wording still references tobacco |
| User-Generated Content | No | No initial report intake or published community content; reassess broad distribution if community facts publish later |
| Unrestricted Web Access | No | No general in-app browser; source links/system Maps handoff do not supply free in-app browsing |
| Messaging and Chat; Social Media; Advertising | No for each | No corresponding functions |
| Parental Controls | No | No parent controls |
| Age Assurance | No | “I understand” eligibility notice does not verify/estimate age or assert user age; check live questionnaire examples if self-declaration is added |
| Profanity/Crude Humor; Horror/Fear | None for each | No intended content of these kinds |
| Medical/Treatment; Health/Wellness | None/No as presented | No health advice/cessation or treatment claims |
| Mature/Suggestive; Sexual Content/Nudity; Graphic Sexual Content | None for each | No such content |
| Cartoon/Fantasy Violence; Realistic Violence; Prolonged Graphic/Sadistic Violence; Guns/Weapons | None for each | No such content |
| Gambling; Loot Boxes | No for each | No purchases/chance rewards |
| Simulated Gambling; Contests | None for each | No gamification/rewards/streaks |
| Made for Kids | No | Adult compliance/navigation utility |

Expected current global result from frequent tobacco references: **18+**; older OS result may be **17+**.
Apple calculates the actual ratings. Do not use an old 12+/17+ questionnaire or mark tobacco “None” to obtain
4+. “Infrequent” is not recommended given the app's recurring subject matter.

**Age-restricted products/services:** no tobacco sale, purchase facilitation, booking or regulated service is
provided. The current public Apple definitions reviewed do not list a separate question with that exact name.
Do not invent an ASC field. If the live form adds it, read its definition: sale/provision → No; references/access
to smoking places or adult eligibility → Yes if included. Record the wording before deciding.

Japanese eligibility notice already states 20+; this does not turn an 18+ Store rating into permission to smoke.
Maintainer must decide whether the app/EULA itself imposes a minimum use age (rather than merely explaining
local law). If it exceeds Apple's calculated rating, select the suitable higher-age override available in ASC;
confirm how a 20+ policy maps to the available values with Apple, never claim ASC offers a 20+ option.
[Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/).

## 4. Export compliance

Repo findings: URLSession HTTPS through OS networking; CryptoKit SHA-256 for tile integrity
(`Core/Networking/TileAPIClient.swift`) and App Attest request binding (`Features/Reports/AppAttestBinding.swift`);
DeviceCheck App Attest OS signing/attestation (`AppAttestDevice.swift`). No custom encryption algorithm,
SQLCipher, bundled TLS implementation or encrypted messaging found; GRDB is ordinary SQLite access.
Backend Web Crypto verification is server-side, not a cryptographic library shipped in the iOS bundle.
“Only TLS” is inaccurate; “OS TLS, OS hashing and OS App Attest” is the appropriate description.

| ASC prompt / build declaration | Proposed answer, conditional on final archive |
| --- | --- |
| Does app use/access encryption? (broad question) | Yes: HTTPS/OS security; do not answer No merely because exempt |
| Proprietary/non-standard algorithms? | No |
| Standard algorithms instead of/in addition to OS encryption? | No, if final bundle uses only OS-provided mechanisms above |
| Exempt from documentation requirements? | Recommend Yes for this OS-only implementation, subject to final dependency/territory check |
| `ITSAppUsesNonExemptEncryption` | Recommend **NO/false** after exemption confirmation; key currently absent from app plist/build declarations |
| Apple export documentation upload | Normally not required for OS-only exempt use; follow actual ASC questionnaire outcome |

Apple explains OS HTTPS exemption and the distinction between encryption use and non-exempt encryption:
[Complying with Encryption Export Regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations).
Maintainer verifies archive-linked libraries, no new non-OS crypto, final HTTPS origin, distribution territories,
and any government self-classification/import obligations. Exemption from Apple's upload does not establish
exemption from all legal reporting. If uncertain about hashing/attestation or territories, obtain Apple export
support clarification before choosing exemption. [Determine and upload encryption documentation](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation/).
Code/plist edits, if desired to automate the declaration, go to Claude Code (§10); manual ASC answers remain possible.

## 5. Content rights

**Proposed answer:** Yes, the app contains/shows/accesses third-party content, and the operator has the necessary
rights or permission for the selected storefronts **only after verifying the final published corpus**.
Do not answer “no third-party content”: official municipal data and Apple maps are third-party content.
Apple's required rights standard: [App information / Content Rights](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/).

| Content | Current repository status / release evidence needed |
| --- | --- |
| Official sources | Approved scoped publications in [SOURCES.md](SOURCES.md); review exact source/release digest, reuse terms, attribution/change notices and permitted downstream use in final promotion bundle |
| Attribution | Source attribution is in API DTOs and iPhone/Watch detail/about surfaces; verify archive + final server response, including source and license links; maintain Apple MapKit attribution |
| User reports | `COMMUNITY_PUBLICATION` pending: source blocked; raw notes, hashes, keys and photos never public. No community rights assertion in first-v1 packet |
| Candidate community terms | [Decision packet](legal/COMMUNITY_PUBLICATION_DECISION.md) is awaiting maintainer approval; not an effective production license |
| OpenPOI / Overture candidates | Not introduced for this release; no new investigation or rights claim here |
| OSM | Not adopted for v1; not a canonical source or a reason to claim an ODbL-based v1 corpus |
| App icon, screenshots, map imagery | Maintainer confirms ownership/permission for shipped assets and capture; no tobacco brand imagery/promotional artwork |

[DATA_POLICY.md](DATA_POLICY.md) supplies the source/publication boundary. #170's local six-source/513-spot
validation is evidence of a tested bundle, **not** proof of today's live production content or worldwide rights.
Retain the exact release manifest/license evidence; withhold unapproved sources. Do not browse new data sources
as part of closing this checklist.

## 6. Metadata draft (Japanese primary localization)

These are drafts, not published claims. Use final-build features only. Name/subtitle limit 30 characters each
([App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)).
Description ≤4,000 characters, promotional text ≤170, keywords ≤100 UTF-8 bytes
([Platform version fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)).

| Field | Draft / maintainer input |
| --- | --- |
| App name | `MannerPath` |
| Subtitle | `喫煙可能場所と利用条件を確認` |
| Keywords | `喫煙所,灰皿設置,指定場所,利用条件,徒歩案内,位置情報` (74 UTF-8 bytes; no competitor/brand names) |
| Promotional text (optional) | `喫煙可能場所の位置、利用条件、情報源を確認。周囲の掲示や施設のルールを優先し、案内情報を参考にしてください。` |
| Support URL | `https://kounishiyuuki.github.io/MannerPath/support/` (live 2026-10-04, [PUBLIC_SITE.md](PUBLIC_SITE.md)) |
| Privacy Policy URL | `https://kounishiyuuki.github.io/MannerPath/privacy/` (live 2026-10-04, [PUBLIC_SITE.md](PUBLIC_SITE.md)) |
| Report terms URL | `[MAINTAINER: future approved report-terms page; not an ASC standalone required field]` |
| Marketing URL (optional) | Leave blank until an actual neutral product page exists |
| Copyright | `2026 [MAINTAINER: actual rights holder]` (ASC supplies ©) |
| Primary / secondary category | Navigation / Utilities optional; maintainer confirms |
| Age rating | Questionnaire §3, expected 18+ current system; not Made for Kids |
| Screenshots / review contact / notes | §9 / §8 / §7 |
| License agreement / terms | Apple standard EULA recommended for first read-only release; custom EULA only if approved |

Description draft (plain text):

```text
MannerPathは、喫煙が認められている場所の位置や利用条件を確認するための案内アプリです。たばこの販売・購入案内や広告は行いません。

・近くの喫煙可能場所を地図と一覧で確認
・利用条件、情報源、確認状況、位置の精度を確認
・徒歩経路を確認し、Appleのマップへ案内を引き継ぎ
・保存済みの場所情報は通信できないときも参照可能
・Apple Watchで近くの場所や距離・方向を確認
・ウィジェットから保存済みの近くの場所情報を参照

掲載範囲は地域によって異なります。情報がない地域では、その状態を表示します。営業時間や利用条件が不明な場合は、不明として表示します。施設内の目安位置は、正確な喫煙場所の位置と区別します。

掲載情報だけで、その時点の喫煙可否を保証するものではありません。現地の掲示、施設のルール、自治体の規則を優先してください。日本では20歳未満の方は喫煙できません。法令上喫煙が認められている方を対象としています。

アカウント登録は不要です。端末の現在地は近くの場所の順位や距離・方向の計算に使用します。オフラインでの徒歩経路案内には対応していません。

この初回バージョンでは、場所の報告と写真の送信は利用できません。
```

No nationwide completeness promise, “open now” guarantee, exact-pin guarantee, tobacco shopping,
“喫煙を楽しもう”, rewards or consumption encouragement. Philosophy: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).
Do not claim all location processing is on-device: MapKit routes and system Maps need separate explanation.

## 7. App Review Notes and test instructions

Risk: **Guideline 1.4.3** prohibits encouraging tobacco/vape consumption and tobacco-sale facilitation.
Navigation to smoking places may still attract scrutiny; age rating/neutral copy cannot guarantee acceptance.
Explain the compliance purpose up front. Completeness, public contact/privacy access and accurate metadata
also need checking (1.5, 2.1, 2.3, 5.1.1). [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

English Notes draft — paste only after reports-off/network facts and all markers are confirmed:

```text
MannerPath is a navigation and local-rule compliance utility for adults legally permitted to smoke. It helps users check evidenced permitted locations, access restrictions, source information and uncertainty, and instructs them to follow posted signs and local rules. It does not encourage tobacco consumption, sell tobacco, provide purchase links, promote brands or show tobacco/nicotine advertising. There are no payments, rewards, streaks or accounts.

Location permission is When In Use. MannerPath uses the device location for nearby ranking, distance and bearing; routine requests to our backend contain geographic tile IDs, not raw device GPS coordinates. We do not intentionally retain location history. Apple MapKit search/routing and system Maps operate through Apple's services. Our public privacy policy describes any retained service logs.

Reports, App Attest registration and photo uploads are unavailable in this initial version. There is no public user-content feed. Apple Watch shows nearby/cached places and distance/direction; widgets display cached place snapshots. Cached discovery works offline; offline turn-by-turn routing is not provided.

Our backend is available during review at [CONFIRMED PRODUCTION HTTPS ORIGIN]. Coverage varies and regions without published places show an empty state. To inspect populated results, use [VERIFIED IN-APP STEPS AND LOCATION], then open a place's detail, source/attribution information and walking-route/Maps handoff. Please also inspect the eligibility notice, Data & Privacy screen, filters, denied-location and cached-offline states. No sign-in is required.
```

Reviewer instructions to finalize with the signed build:

1. Launch fresh install; read adult eligibility/local-rule notice → I understand → allow While Using location
   for nearby mode. Repeat with denial to verify useful fallback/explanation.
2. Maintainer supplies **tested on-device UI steps** for viewing a populated area from outside Japan, plus one
   exact published place/name. Do not invent a location selector/deep link the build lacks. If UI cannot reach
   a populated region remotely, provide a capture and explain the limitation; discuss an approved review path
   with Apple before submission rather than adding a hidden feature.
3. Open populated list/map result → detail: inspect access, unknown hours, confidence/freshness, position precision
   and source attribution. Apply a filter, preview walking route and hand off to system Maps.
4. Visit a verified empty region using an actual supported flow; verify honest no-data state.
5. Load data online, then airplane mode: cached places/distance/bearing remain; route unavailability is clear.
6. Paired Watch: sync/place list/detail, distance/direction and offline snapshot; add iPhone/Watch widgets and open
   their place destination. Do not expect a report form on Watch or a live GPS fix in widgets.
7. Verify report/confirmation/add-place entry points cannot submit, photo upload unavailable; backend gate evidence
   is supplied by maintainer, not a request for reviewers to configure infrastructure.

## 8. Required URLs, legal pages and contact

Update 2026-10-04: operator **MannerPath 運営**, contact **mannerpath.support@gmail.com** and GitHub Pages publication are confirmed; the pages and in-app access exist ([PUBLIC_SITE.md](PUBLIC_SITE.md)). The pages were published and verified over HTTPS on 2026-10-04, and Release builds carry the site origin (in-app links). PR #179 verifies Release-built navigation to both pages, Debug public-site URL empty and the
`mannerpath.support@gmail.com` contact. Mail delivery/compose, response ownership and support retention
remain separate checks; URL configuration/reachability is no longer a blocker.

| Item | Owner must supply / acceptance check |
| --- | --- |
| Support URL (required ASC) | Public HTTPS page; MannerPath identity, monitored contact, help for permissions/offline/coverage and correction/removal inquiries; accessible without account |
| Privacy Policy URL (required ASC) | Public HTTPS policy, effective date, operator/contact, precise-on-device vs tile network data, MapKit/Maps, actual providers/logs/retention, no intentional history, tracking status, local caches/drafts, reports/photos off, rights/deletion/support process |
| In-app privacy policy access | #179 verifies Release-built Data & Privacy links to the published Privacy Policy and Support; repository wording corrected in #180; live publication and evidence-dependent audit handoff remain to verify |
| Report terms URL | Approved version/public page before report intake; candidate/draft must not be represented as approved. Not a first-read-only-v1 blocker if intake stays off |
| General terms/EULA URL | Optional public product terms; standard Apple EULA can apply without inventing a custom terms URL |
| Marketing URL | Optional; blank is preferable until real page exists |
| Public contact email | Dedicated monitored address; confirm delivery and response owner; no invented value |
| App Review contact | First/last name, reachable international-format phone, monitored email; real person able to answer during review |
| Operator/rights holder | Actual person/entity, copyright holder, storefront-specific required business/contact information |
| Backend origin | Confirmed production HTTPS host, reachable during review; not a support or privacy URL substitute |

Policy must match the final §2 answers. If report intake is later enabled, add consent/retention/identifiers and
private photo treatment as applicable before enabling it. A full legal/policy sufficiency decision belongs to
the maintainer and counsel if engaged. Public support/privacy and contact requirements are grounded in
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) and
[App Privacy management](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/).

## 9. Screenshots checklist

Minimum 1, maximum 10 per supported screenshot set; PNG/JPEG, no alpha/transparency.
Use actual final-build UI, no synthetic permitted-place data or disabled reports/photos in product claims.
[Upload guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/),
[current dimensions](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

- [ ] iPhone: recommend 6.9-inch portrait **1320 × 2868**; verify accepted well at upload.
      Apple currently accepts alternatives 1260 × 2736 and 1290 × 2796 for that set.
      If no 6.9-inch set, supply required 6.5-inch set; consult live table, not a remembered device name.
- [ ] iPad: app Release `TARGETED_DEVICE_FAMILY = "1,2"`; supply required 13-inch set,
      **2064 × 2752** or **2048 × 2732** portrait (landscape swapped), captured on actual iPad UI.
- [ ] Apple Watch: supply screenshot set in Media Manager for shipping Watch app; all captures in a set use
      one supported size across **all localizations**. Recommend **416 × 496** for a matching tested
      Series 10/11/12 capture; alternatives include 422 × 514 and 410 × 502. Verify the actual device/table.
- [ ] Japanese localization: map/list, detail with source/access, route handoff/preview, honest cached/offline state;
      approximate location shown as approximate if included. Watch nearby/detail; optional widget contextual image.
- [ ] No tobacco brands, smoking celebration, purchasing, youth-oriented imagery or hidden freshness labels.
- [ ] No claims of exact/complete nationwide coverage, guaranteed permission or offline turn-by-turn routing.
- [ ] Reviewer attachment (optional): eligibility, location denial, loaded/empty region, offline and Watch/widget
      flow recording; distinguish it from public marketing screenshots.
- [ ] App preview video optional; app icon and final archive artwork rights confirmed separately.

## 10. Privacy manifest conclusion, remaining blockers and handoff

### Manifest facts and conclusion

| Bundle/dependency | Verified source state |
| --- | --- |
| iPhone `MannerPath/PrivacyInfo.xcprivacy` | Tracking false, tracking domains empty, UserDefaults reason CA92.1; **NSPrivacyCollectedDataTypes absent**, not an explicit empty array |
| Watch `MannerPathWatch Watch App/PrivacyInfo.xcprivacy` | Same declarations as iPhone |
| iPhone/Watch widgets | No manifest; current snapshot reads use App Group files, no independent network/location acquisition; audit final required-reason API usage in archive |
| GRDB 7.9.0 | Only resolved third-party package, revision `aa0079aeb82a4bf00324561a40bffe68c6fe1c26`; upstream manifest declares tracking false, collected/accessed arrays empty |

Pinned GRDB manifest checked directly at
[upstream revision](https://github.com/groue/GRDB.swift/blob/aa0079aeb82a4bf00324561a40bffe68c6fe1c26/GRDB/PrivacyInfo.xcprivacy).
Archive inclusion is still unverified. Inventory #171's “empty app manifests” means no collected declarations;
its install-ID and GPS shorthand also needs the implementation qualifications in §2.

Manifest declarations and ASC privacy labels are separate artifacts. Apple's current instructions say to record
collected categories and purposes in the app manifest, while SDKs describe their own collection. A manifest
does not publish/replace ASC answers. [Describing data use](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests),
[TN3184](https://developer.apple.com/documentation/technotes/tn3184-adding-data-collection-details-to-your-privacy-manifest).

**Conclusion:** no collected-type additions solely for dormant, unavailable reporting. If audited release/provider
behavior collects tile-location/log data, or reports/auth become available, **add the corresponding app-owned
NSPrivacyCollectedDataTypes declarations** with approved type/purpose/linkage/tracking values. Do not leave
manifests without collected entries merely because the collection occurs on the backend. Keep required-reason
APIs separate; do not add UserDefaults reasons for collection or copy GRDB internals into app-owned declarations.
Generate the final archive's Xcode Privacy Report and compare it to §2 and ASC.

### Submission blockers (packet ready; submission not ready)

| Blocker / decision | Evidence to close / owner |
| --- | --- |
| **App icon (P0, found 2026-10-05)** | iPhone asset catalog has no `AppIcon` set and the Watch `AppIcon` slot is empty; maintainer supplies rights-cleared 1024 × 1024 artwork, Claude Code adds it, archive verifies ([entry sheet §8](APP_STORE_CONNECT_ENTRY.md)) |
| iPad keep/remove | `TARGETED_DEVICE_FAMILY = 1,2` needs iPad screenshots and an iPad visual audit, or narrowing to iPhone before upload |
| Policy accuracy, contact operations and review identity | Public URLs/operator/contact and Release access confirmed by #179; correct policy per audit handoff, verify mailbox delivery/response owner and supply review person/phone/rights-holder confirmation |
| Actual production logging/retention | Maintainer completes §2.3; label, policy and manifest decisions recorded together |
| First-v1 reports/auth/photos off | Maintainer signs deployment decision and captures §2.4 checks; community stays pending |
| Production backend / selected data rights | Follow #170 [release checklist](RELEASE_CHECKLIST.md); record HTTPS host, final bundle/source attribution; no source research required |
| Signed distribution archive / physical device evidence | Developer Program, provisioning/App Groups, iPhone/iPad/Watch/widget E2E, TestFlight and final privacy report |
| Age answers / minimum age / storefronts | Maintainer confirms Frequent recommendation, calculated/regional ratings, Japan-first recommendation and eligibility/EULA policy |
| Export exemption | Maintainer checks final linked code/territories and ASC result; do not substitute “no encryption” |
| Screenshots and reviewer populated-area access | Actual final UI captures, sizes, tested location/steps and reviewed Notes without markers |
| Release UI completeness | Claude Code checks lingering “This beta” in `AboutPrivacyView.swift`, complete privacy policy and easy contact access; no UI edits in this lane |

### Claude Code handoff (separate writer/branch; this lane does not edit code)

1. Public-site URLs/contact and Release links are completed by #179. The bilingual server/logging claims were
   corrected on 2026-10-05; provider fields/retention are added after deployment evidence
   ([audit handoff](PRODUCTION_PRIVACY_AUDIT.md)). Remaining physical-device mail/accessibility checks are separate.
2. Once actual collection is decided, update iPhone/Watch manifests only for each bundle's actual flows; audit
   widget required-reason APIs and pinned GRDB resource embedding. Do not declare device GPS merely for local ranking.
3. If exemption is approved, optionally add `ITSAppUsesNonExemptEncryption=false` to the correct generated plist/build
   settings for relevant shipping app bundles; confirm archive output rather than editing only an unused plist.
4. A durable explicit read-only switch is a possible **backend** follow-up if maintainer wants reports to remain
   off after App Attest configuration changes. Existing fail-closed release configuration is sufficient only while
   retained and verified; do not weaken required attestation or enable reports in this compliance PR.
5. Apple changes must follow area instructions and `make apple-validate`; backend changes `make api-validate`.
   Re-audit this packet after any changes. No changes to Claude Session / Claude Code CLI branches here.

## 11. Source currency and validation record

Apple primary materials checked **2026-10-04**: Guidelines; App Privacy details/management; manifest data-use
instructions and TN3184; age definitions/set-rating help; encryption regulation/documentation help; App Information;
Platform Version Information; screenshot specifications/upload help. Links are adjacent to their conclusions.
TN3184 records first publication **2024-12-17**; dynamic help pages do not provide a stable version/date, so the
check date is recorded rather than inventing one. Manifest documentation was also read via Apple's official
`developer.apple.com/tutorials/data/documentation/...json` representation when the HTML shell lacked content.
No third-party blog is a decision basis. GRDB upstream is used only to verify its own shipped manifest.

Validation for this docs-only change: `git diff --check`, `make contract`, local reference/metadata limit checks,
and direct opening of the cited Apple pages and pinned GRDB manifest. No app/build/device/production/ASC action
is implied. Re-run contract/diff checks after final edits; actual command outcomes are recorded in the PR.

## Authenticated privacy audit addendum (2026-10-05; supersedes conditional table where unresolved)

Final classifications from [production audit](PRODUCTION_PRIVACY_AUDIT.md):

| Category | Final recommendation |
| --- | --- |
| Precise Location | UNKNOWN / SUBMISSION BLOCKER |
| Coarse Location | CONSERVATIVE DISCLOSURE: collected, linked, App Functionality, not tracking pending evidence |
| Device ID | UNKNOWN / SUBMISSION BLOCKER |
| User Content | UNKNOWN / SUBMISSION BLOCKER |
| Photos/Videos | NOT COLLECTED in reviewed shipping composition |
| Diagnostics | UNKNOWN / SUBMISSION BLOCKER |
| Usage Data / Product Interaction | UNKNOWN / SUBMISSION BLOCKER |
| Crash Data | NOT COLLECTED in reviewed app instrumentation |

No live production records confirm COLLECTED; no overall “Data Not Collected” approval. Production Worker
is absent, so runtime gate/version checks and App Review backend readiness remain blocked. Photos/Crash
answers still require signed archive / matching production deployment checks. Logpush/analytics/provider retention,
alternate/historical data and support handling need maintainer evidence. The public bilingual policy is
reachable; repository §2 live-server/logging wording was corrected on 2026-10-05 (live publication awaits Pages verification), and verified provider fields/retention
are added after deployment. Do not submit
until these gates and all UNKNOWN classifications are closed. Remote provisioning/deployment is separate work.

Finalization against main `7d8cbab0ba28bc28eb17a56546f7f97b158b3841` incorporates #179's confirmed
Release public-site origin, Privacy Policy/Support navigation, empty Debug origin and contact. Existing
Privacy Label classifications above remain unchanged. Policy lane (2026-10-05): the repository policy no longer asserts a running server or live log settings; §2 now says providers may process/record IP and request information, error diagnostics may remain, and confirmed fields/retention will be added; §8/§9 disclose the Gmail support mailbox. Last updated 2026-10-05 (JA/EN). Still open: actual provider fields/retention after deployment, §5 gate/build evidence, mailbox retention.
Next production lane separately provisions the two D1 databases and bound R2 bucket, reviews real IDs,
applies approved migrations/promotion and deploys the production Worker; see audit's exact sequence.
