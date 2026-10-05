# App Store Connect entry sheet — MannerPath v1.0

What to type into App Store Connect (ASC), in order, and what cannot be typed yet. Rationale, Apple references and
evidence live in [APP_STORE_SUBMISSION.md](APP_STORE_SUBMISSION.md) (§ numbers below point there); privacy
evidence classifications are owned by [PRODUCTION_PRIVACY_AUDIT.md](PRODUCTION_PRIVACY_AUDIT.md) (#178/#185).
The final conservative ASC input proposal is in [submission §2.2](APP_STORE_SUBMISSION.md),
not a claim that all proposed collection was observed. Privacy entry updated 2026-10-05 against main
`cb8de215e55897a6315a7d38a59cf4886505c5e7` (#185/#186); older build/metadata evidence remains dated below.
This sheet authorizes no submission, deployment or Cloudflare change.

Status legend:

| Status | Meaning |
| --- | --- |
| **CONFIRMED** | Final value, verified against the repository/build settings or published pages; type it as written |
| **MAINTAINER** | Personal/legal input only the maintainer can supply; nothing is invented here |
| **WAITING-PRODUCTION** | Needs release-build/provider evidence; backend deployment/runtime evidence now exists (#185), but signed-build and provider-retention checks remain |
| **BLOCKED-DEVELOPER-PROGRAM** | Needs the paid membership, signing, a signed archive, TestFlight or physical devices |

## 1. Build facts (verified in the Xcode project)

| Item | Value | Status |
| --- | --- | --- |
| Bundle ID (iPhone app) | `com.kounishiyuuki.MannerPath` | CONFIRMED |
| Embedded bundles | `….widgets`, `….watchkitapp`, `….watchkitapp.widgets` | CONFIRMED |
| Version / build | `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1` (raise the build number for each upload) | CONFIRMED |
| Display name | `MannerPath` | CONFIRMED |
| Minimum OS | iOS 18.0, watchOS 11.0 | CONFIRMED |
| Device families | iPhone app and iPhone widget `1` (iPhone only), Watch app `4`; no native iPad target. iPad users run the iPhone app in compatibility mode ([IPAD_V1_READINESS.md](IPAD_V1_READINESS.md)) | CONFIRMED (maintainer decision 2026-10-05) |
| App localizations | development region `en`; Japanese `ja` translations present | CONFIRMED |
| Public site origin in Release builds | `https://kounishiyuuki.github.io/MannerPath/` (Debug unset) | CONFIRMED (#179) |
| API origin in Release builds | `https://mannerpath-api-production.happywestyuki.workers.dev` (Debug unset); Release Info.plist and simulator production connection verified | CONFIRMED (#186); signed distribution archive remains separate |
| **App icon** | iPhone asset catalog has **no `AppIcon` set**; Watch `AppIcon` set has an empty 1024 slot | **P0 — see §8** |

## 2. App Information (ASC → App Information)

| Field | Enter | Status |
| --- | --- | --- |
| Primary language | Japanese | CONFIRMED |
| Name (ja) | `MannerPath` | CONFIRMED |
| Subtitle (ja) | `喫煙可能場所と利用条件を確認` (14 characters; limit 30) | CONFIRMED |
| Bundle ID | `com.kounishiyuuki.MannerPath` | CONFIRMED |
| SKU | any stable internal string, e.g. `mannerpath-ios-1` (never shown to users) | MAINTAINER |
| Primary category | Navigation | CONFIRMED |
| Secondary category | Utilities | CONFIRMED |
| Content Rights | “Yes, contains third-party content”; necessary-rights declaration only after [production corpus audit](PRODUCTION_CONTENT_RIGHTS_AUDIT.md) gates: municipal open data and Apple Maps (§5) | CONFIRMED live corpus/licenses/API attribution (513 / 6 / community 0); Taito modification-notice P1 / Watch license-access gap unresolved; signed-build/assets and MAINTAINER legal signoff pending |
| Age Rating | questionnaire answers in §4 below | CONFIRMED answers; result calculated by Apple |
| License agreement | Apple standard EULA | CONFIRMED |

## 3. Version 1.0 page (ASC → iOS App → 1.0)

| Field | Enter | Status |
| --- | --- | --- |
| Promotional text (optional) | `喫煙可能場所の位置、利用条件、情報源を確認。周囲の掲示や施設のルールを優先し、案内情報を参考にしてください。` | CONFIRMED |
| Description | block below (526 characters; limit 4,000) | CONFIRMED |
| Keywords | `喫煙所,灰皿設置,指定場所,利用条件,徒歩案内,位置情報` (74 bytes; limit 100) | CONFIRMED |
| Support URL | `https://kounishiyuuki.github.io/MannerPath/support/` | CONFIRMED (live, #177/#179) |
| Marketing URL | leave blank | CONFIRMED |
| Copyright | candidate `2026 MannerPath 運営` (ASC adds ©) | MAINTAINER confirms the legal rights holder |
| Build | the processed release build | BLOCKED-DEVELOPER-PROGRAM |
| Screenshots | §6 | partly BLOCKED (see §6) |
| Sign-in required | **No** (there are no accounts) | CONFIRMED |
| App Review contact | first/last name, phone (international format), email | MAINTAINER |
| App Review notes | §5 text; one marker is WAITING-PRODUCTION | partly WAITING-PRODUCTION |
| Version release | **Manually release this version** (allows final backend/privacy checks after approval) | CONFIRMED |

Description (paste as plain text):

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

Each bullet matches behavior verified on the simulator in #176 (list/map, detail evidence and approximate
location, route preview and Maps handoff, cached offline, Watch nearby/detail). Widget display on a device is
still a device gate (§7); keep the widget bullet only if that check passes.

## 4. Age Rating questionnaire answers

| Question | Answer |
| --- | --- |
| Alcohol, Tobacco, or Drug Use or References | **Frequent** |
| User-Generated Content | No |
| Unrestricted Web Access | No |
| Messaging and Chat / Social Media / Advertising | No / No / No |
| Parental Controls / Age Assurance | No / No |
| Profanity or Crude Humor / Horror or Fear Themes | None / None |
| Medical or Treatment / Health or Wellness | None / No |
| Mature or Suggestive / Sexual Content or Nudity / Graphic Sexual Content | None / None / None |
| Cartoon or Fantasy / Realistic / Prolonged Graphic Violence; Guns or Weapons | None for each |
| Gambling / Loot Boxes / Simulated Gambling / Contests | No / No / None / None |
| Made for Kids | No |

Expected result: 18+ (current system); 17+ on older OS results. Apple calculates it. If the live form shows a
question not listed here, read its definition and record the wording before answering (§3). Whether the app
itself imposes a minimum use age above the calculated rating is a **MAINTAINER** decision (§3).

## 5. App Review notes and reviewer steps

Notes (English). The only unresolved marker is the production origin and the tested populated-area steps:

```text
MannerPath is a navigation and local-rule compliance utility for adults legally permitted to smoke. It helps users check evidenced permitted locations, access restrictions, source information and uncertainty, and instructs them to follow posted signs and local rules. It does not encourage tobacco consumption, sell tobacco, provide purchase links, promote brands or show tobacco/nicotine advertising. There are no payments, rewards, streaks or accounts. No sign-in is required.

Location permission is When In Use. MannerPath uses the device location for nearby ranking, distance and bearing; requests to our service contain geographic tile IDs, not raw device GPS coordinates. We do not intentionally retain location history. Apple MapKit search/routing and Apple Maps operate through Apple's services. Our privacy policy (https://kounishiyuuki.github.io/MannerPath/privacy/) describes how network providers may process request information.

Reports, report device registration and photo uploads are unavailable in this initial version. There is no public user-content feed. Apple Watch shows nearby cached places with distance and direction; widgets show a cached nearby place. Cached discovery works offline; offline walking routes are not provided.

Coverage depends on published open data and varies by area; areas without published places show an empty state. Our service is available during review at https://mannerpath-api-production.happywestyuki.workers.dev. To see populated results, [WAITING-PRODUCTION: tested steps and location]. Then open a place's details (access, uncertainty, sources and attribution), the walking-route preview and the Apple Maps handoff. Please also see the age/eligibility notice, Data & Privacy (privacy policy, support and contact links), filters, the location-denied state and the cached offline state.
```

Reviewer steps (attach with the notes once the WAITING items are filled):

1. Fresh install → eligibility notice → 確認しました → allow location While Using.
2. Populated area (WAITING-PRODUCTION: steps that work from outside Japan with the release build) → list/map → place detail → sources → walking route → Apple Maps.
3. Filters (type, tobacco, access) and clearing them.
4. Data & Privacy → プライバシーポリシー / サポート open the published pages; メールで問い合わせ addresses mannerpath.support@gmail.com.
5. Airplane mode after loading: cached places, distance and direction remain; route unavailability is explained.
6. Paired Apple Watch: nearby list, detail, directions handoff (BLOCKED-DEVELOPER-PROGRAM to verify on hardware).

If a populated area cannot be reached remotely with the shipped UI, attach a screen recording rather than adding
any hidden reviewer feature (§7).

## 6. Screenshots

Use final-build UI only, Japanese localization, no synthetic place data. Current Apple dimensions: §9.

| Set | Size to upload | Required? | Status |
| --- | --- | --- | --- |
| iPhone 6.9" | 1320 × 2868 portrait (iPhone 17 Pro Max class) | Yes | Capturable on the simulator now from a Release build, but must show **production data** → WAITING-PRODUCTION |
| Apple Watch | 416 × 496 (Series 10/11 46mm class), one size for all localizations | Yes for the Watch app | WAITING-PRODUCTION data; the #176 simulator captures used fixture data and are not store assets |

v1 screenshot sets are **iPhone + Apple Watch only**: the app is iPhone-only, so no iPad set is required.

Suggested 5-shot iPhone sequence: nearby map + list; place detail with sources/evidence; walking
route preview / Maps handoff; approximate-location or filter state; Data & Privacy. Watch: nearby list; place
detail with distance/direction. Exclude brands, smoking imagery, purchase cues and coverage/permission guarantees.

## 7. Waiting / blocked items

**WAITING-PRODUCTION** (backend exists; remaining release/provider evidence):

- ~~Production HTTPS API origin in the Release build~~ done by #186: committed origin, Release-built Info.plist and simulator live refresh/detail/attribution verified; readiness completed, reports/photos config false. The remaining §5 marker is tested reviewer steps.
- Backend gates verified by #185 and Release simulator availability by #186; community remains pending. Signed distribution/hardware browsing traffic still to confirm.
- **App Privacy (ASC → App Privacy): concrete final proposal ready for owner approval, no input performed.**
  Choose **Yes, we collect data from this app**. Select Precise Location, Coarse Location, Device ID,
  Customer Support, Other Diagnostic Data, Product Interaction and Email Address. Choose **Linked / not
  used for Tracking / App Functionality** for each; additionally **Analytics** for Product Interaction as
  an inclusive fallback. See submission §2.2 for every category's evidence and conservative rationale.
  Photos/Videos and Crash Data stay NOT COLLECTED only under §2.2 conditions P/C. If not confirmed,
  **also select Photos or Videos and Crash Data, Linked / not tracking / App Functionality**. Report-only
  Other User Content stays unselected while intake is unavailable. Never choose Data Not Collected.
  Retention UNKNOWNs remain evidence gaps, not unanswered ASC checkboxes; owner must approve assumptions,
  actual purposes/partner tracking, policy/manifests and the signed archive before publishing. The per-type
  over-disclosure risks and evidence needed to narrow each choice are in submission §2.2; no proposed
  Precise Location/Device ID collection is asserted as an observed fact.
- ~~Content Rights final production corpus identity/license/API evidence~~ confirmed by [rights audit](PRODUCTION_CONTENT_RIGHTS_AUDIT.md). Taito modification-notice P1, Watch license-access gap, final signed-build/asset checks and MAINTAINER legal signoff remain; do not enter the necessary-rights declaration yet.
- Store screenshots with production data (§6).

**BLOCKED-DEVELOPER-PROGRAM** (membership, signing, devices):

- Active membership, agreements, App ID / App Group provisioning, App Attest entitlement environment.
- Signed archive, upload, processed build, TestFlight; Xcode Privacy Report from the archive.
- Export compliance: answer per the archive (§4): uses encryption **Yes** (OS HTTPS/hashing/App Attest);
  proprietary **No**; standard non-OS **No**; exempt **Yes** subject to the archive's linked libraries and territories;
  optional `ITSAppUsesNonExemptEncryption = NO` only after that confirmation.
- Physical-device checks: widgets (3 families), VoiceOver order, Reduce Motion/Transparency, contrast, Maps handoff
  screen, mail compose from the contact link, Watch on hardware.

**MAINTAINER** (personal or legal input; not stored in the repository):

- App Review contact: first/last name, phone, email.
- Copyright holder confirmation; SKU.
- Trader status if any EU storefront is selected (not recommended for v1, below).
- Minimum-use-age policy decision; legal sufficiency of the policy text.
- Support mailbox delivery and response owner (mannerpath.support@gmail.com).

## 8. Focused-fix candidates found while preparing this sheet

| Severity | Finding | Fix (needs the maintainer's artwork) |
| --- | --- | --- |
| **P0** | No app icon. iPhone target: no `AppIcon` set in `MannerPath/Assets.xcassets` **and** no `ASSETCATALOG_COMPILER_APPICON_NAME` build setting (that setting exists only on the Watch target). Watch target: `AppIcon.appiconset` exists with one watchOS 1024 × 1024 slot and no image. Exact list: [IPAD_V1_READINESS.md §6](IPAD_V1_READINESS.md). ASC rejects uploads without the required icons | Add owner-supplied, rights-cleared 1024 × 1024 artwork (no tobacco imagery or brands) to an iPhone `AppIcon` set and the Watch `AppIcon` set; verify in the archive |
| Resolved | iPad decision: v1 is iPhone + Apple Watch only (`TARGETED_DEVICE_FAMILY = 1`); the iPad simulator audit found no P0/P1 ([IPAD_V1_READINESS.md](IPAD_V1_READINESS.md)) | — |

## 9. Pricing and availability

| Field | Enter | Status |
| --- | --- | --- |
| Price | Free (no in-app purchases) | CONFIRMED recommendation; MAINTAINER approves |
| Storefronts | **Japan only** for v1: data, copy and eligibility notice are Japan-specific | CONFIRMED recommendation; MAINTAINER approves |
| Mac (Apple silicon) / Apple Vision Pro availability | Off until tested | CONFIRMED recommendation |
| EU trader status | Not needed if Japan only | MAINTAINER if EU is added |

## 10. Entry order in ASC

1. Agreements and membership (BLOCKED-DEVELOPER-PROGRAM).
2. Create the app record: name, primary language Japanese, bundle ID, SKU (§2).
3. App Information: subtitle, categories, content rights, age rating, license (§2, §4).
4. Pricing and Availability: free, Japan (§9).
5. Upload the signed build; answer export compliance for it (§7).
6. Version 1.0: promotional text, description, keywords, support/marketing URL, copyright (§3).
7. Screenshots: iPhone and Apple Watch (§6).
8. App Review: sign-in No, contact, notes with the WAITING markers filled (§5).
9. App Privacy: privacy policy URL `https://kounishiyuuki.github.io/MannerPath/privacy/`, then the exact
   conservative checklist in §7 / submission §2.2 after owner approval. Keep factual UNKNOWNs documented;
   do not treat broad disclosure as privacy signoff or authorization to publish/submit.
10. Version release: manual. Add for Review → Submit only after every WAITING / BLOCKED / P0 item above is closed.
