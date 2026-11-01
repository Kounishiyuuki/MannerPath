# Photo-backed submission — privacy review and approval pack (v1.0 P7)

**2026-11-02 scope superseded:** 写真関連の要件・条項・候補はv1.1以降向けに保留。以下の旧v1.0写真必須/P0表記は履歴。
現v1.0は[写真なし新規申請](../release/submission-v1/text-reports/README.md)。本書の写真条件を現v1.0提出の必須条件や承認済み条件としない。

Status: **Preparation material, 2026-10-23, against main `b5f7d91`. Not a legal determination and not an approval.**
Nothing here enables photo intake, adds a reviewed photo terms version, changes the public site or answers App Store
Connect. Terms text: [PHOTO_TERMS_CANDIDATE.md](PHOTO_TERMS_CANDIDATE.md) (candidate, not approved).
Requirements: [V1_PHOTO_PLACE_SUBMISSION.md](../release/V1_PHOTO_PLACE_SUBMISSION.md) R6, R7, R9, R10.

Every statement below cites the code or test it rests on. Where the code cannot settle a question (provider retention,
legal categories), it is marked **UNKNOWN** or **DECISION**, never resolved by assumption.

## 1. Data flow (as implemented)

| Step | What happens | Evidence |
| --- | --- | --- |
| Pick | `PhotosPicker` (no library-wide permission), 1–3 images, ≤ 8 MB, ≤ 4096 px, JPEG/PNG only | `Features/Reports/ReportPhotos.swift` `normalize` |
| On-device re-encode | Redrawn into a new bitmap (≤ 2 MP, ≤ 2048 px) and encoded fresh: GPS, EXIF and TIFF device fields are not carried | same; `MannerPathTests/ReportPhotoTests.swift` (GPS/EXIF/TIFF `Make` absent after `add`) |
| Memory only | Photo bytes are never written to the durable draft, the follow-up record or any file, and are not copied to Watch; closing the app discards them | ADR-0016 "Evidence and Apple boundary"; picker copy in `ReportPhotos.swift` |
| On-device follow-up record | Maintainer-approved (PR #330): after a report with photos is accepted, `Reports/photo-follow-up.json` (complete file protection) holds only the report ID, consent version, estimated deadline (`receivedAt` + 89 days) and the count of photos the server confirmed. No image, App Attest key, challenge or assertion. Deleted when every photo is confirmed, the server refuses further photos (410/404/403/attachment limit/terms), the user stops adding photos (also when choosing to start a new report), or at the next launch after the deadline. It never leaves the device and is not part of any request | ADR-0016 "Interrupted uploads"; `ReportStorage.swift`; `MannerPathTests/ReportPhotoRecoveryTests.swift` |
| Report first | The report is sent and accepted first; photos follow to `POST /v1/reports/:id/photos` | ADR-0016 "New-spot photo gate"; `AttestedEvidencePhotoUploader.swift` |
| Authorization | Each upload is an App Attest assertion over report ID, request UUID, accepted terms version, type and image bytes. The server accepts it only if the key's peppered submitter hash equals the report's `submitter_hash`, and the report's accepted terms version is in `REVIEWED_PHOTO_TERMS` | `services/api/src/reports/photos.ts` `attachEvidencePhoto`; `photo-policy.ts` |
| Server sanitize | Bounded decode, then a deterministic PNG derivative from pixels only; EXIF, GPS, timestamp, device and PNG text are dropped. Original bytes exist only in request memory | `services/api/src/reports/photo-sanitizer.ts`; `test/photo-sanitizer.test.ts` |
| Store | Private R2 bucket `PRIVATE_PHOTOS`, create-only writes; the D1 `REPORTS_DB` row holds the key, SHA-256, size, dimensions, lifecycle, moderation state, moderator ID and reason | `migrations-reports/0003_evidence_photos.sql`; ADR-0016 P5 |
| Review | Maintainer terminal only (`reports:moderate`), private; no public URL | `docs/OPERATIONS.md`; V1 plan §4 |
| Publication | Photos never leave REPORTS_DB/R2. A new place needs ≥ 1 approved, still-viewable photo before its review can be exported (necessary, never sufficient) | ADR-0016 "New-spot photo gate"; `newSpotPhotoGate` |
| Deletion | Deadline = report `minimize_after` (received + 90 days), whatever the moderation state. Erasure begins 24 h earlier. Rejected, abandoned and redacted photos are queued at once. A delete overwrites the key with a permanent empty marker | ADR-0016 "Storage and lifecycle", "P5"; `0003` triggers; `PHOTO_STORAGE_OPERATIONS.md` |

Verified on this branch:

- `node --test test/photo-sanitizer.test.ts test/photo-client-contract.test.ts test/evidence-photos.test.ts`
  reported `tests 22, pass 22, fail 0`.
- The client GPS/EXIF test is part of `make apple-validate` (`ReportPhotoTests`).

## 2. Identifiers, IP and logs

| Item | Finding | Linkage consequence |
| --- | --- | --- |
| Submitter hash | Peppered hash of the App Attest key (attested) stored on `reports.submitter_hash`. The photo row has no hash of its own but references `report_id` | Photos from one install are correlatable through their reports **until the report is redacted at 90 days** (`retention.ts` nulls `submitter_hash`) |
| App Attest key | Key ID + public key registered for authorization | Same install, many reports: correlatable |
| Report ID | Shown to the submitter in the receipt; stored with the photo row | Lets a submitter ask about their report (terms §8) |
| IP address | `CF-Connecting-IP` is hashed with `RATE_LIMIT_KEY_PEPPER` only to key the challenge rate limiter (`attest/challenge-budget.ts`). It is not written to REPORTS_DB | Not stored by app code; **UNKNOWN** for Cloudflare-side logs |
| Worker logs | `observability.logs.enabled: true`, `invocation_logs: false` (`services/api/wrangler.jsonc`). ADR-0016: payloads, decoder errors and image metadata are not logged | Retained provider fields are **UNKNOWN** (`PRODUCTION_PRIVACY_AUDIT.md`: Logpush/plan returned 403) |
| Moderator ID | `decided_by` (≤ 64 chars) on the photo row | Operator data, not submitter data |
| Photo content | Faces, plates, signs or surroundings may be visible. Nothing detects or redacts them | Third-party personal data can be received (§5) |

Assessment, without asserting more than the flow shows:

- There is no account, name or contact in the report or photo path.
- A photo is technically associable with an install-scoped key, and with other reports from that key, for up to
  90 days.
- Under Apple's definitions, the conservative reading is **Linked**. That is consistent with
  `APP_PRIVACY_INVENTORY.md` note 2. Whether the maintainer may answer "Not linked" is a **DECISION** (§7, D6).

## 3. App Privacy proposal (for when photo intake is enabled)

This applies only to a build or deployment where photo intake is on (`/v1/config` `photoEvidenceEnabled: true`).
For a shipping composition with photos disabled, the existing condition P in `APP_STORE_SUBMISSION.md` §2.2 still
governs. This document does not edit that file.

| ASC data type | Proposal | Linked | Tracking | Purpose | Basis |
| --- | --- | --- | --- | --- | --- |
| User Content → Photos or Videos | **Collected** | **Linked** (recommended; Not Linked would need the device-key hash removed before storage — [decision pack §3](PHOTO_LEGAL_DECISION_PACK.md)) | No | App Functionality | §1 Store/Review; retained up to 90 days |
| User Content → Other User Content | Collected (already proposed for report claims/note) | Linked | No | App Functionality | `APP_PRIVACY_INVENTORY.md` |
| Location → Precise Location | Unchanged by photos: the photo's GPS is removed on device and on the server; the report pin stays as already proposed | — | No | — | §1; `ReportPhotoTests`, `photo-sanitizer.test.ts` |
| Identifiers → Device ID | Unchanged (App Attest key / submitter hash already proposed) | Linked | No | App Functionality | §2 |

Tracking stays **No**: the app has no ad or attribution SDK, `NSPrivacyTracking = false`, and no photo is shared
with a third party for advertising. Conditions for the maintainer:

- If the iPhone `PrivacyInfo.xcprivacy` should agree with the ASC answer, add a `NSPrivacyCollectedDataTypePhotosorVideos`
  entry in the activation PR. That is a code change and is not made here.
- Faces or plates visible in photos are third-party content. Apple's label describes data collected from the app's
  user, so no separate label type exists for them. They are handled by terms, review and the privacy policy (§5).

## 4. Inconsistencies with the current privacy policy and docs

| Where | Current text / state | Gap | Proposed handling |
| --- | --- | --- | --- |
| `site/privacy/index.html` §5 (ja/en) | Initial version: report, App Attest registration and photo upload unavailable | Becomes false when photo intake is enabled | Replace with §6 text **in the activation release only**; not changed now (public page) |
| `site/privacy` | No statement about photo metadata, photo retention, third-party content or deletion requests | Missing | §6 |
| `docs/legal/REPORT_TERMS_CANDIDATE.md` | Covers text reports only; §6 "90 日以内に削除" lists no photos | Photo processing not covered (ADR-0016: "Current draft terms do not cover photo processing") | Merge [PHOTO_TERMS_CANDIDATE.md](PHOTO_TERMS_CANDIDATE.md) into the next version |
| Bundled terms (`Features/Reports/Terms/`) | Only `report-terms.2026-09-30.draft.md` | No bundled version mentions photos | The activation PR bundles the approved version byte-identical (`ReportTerms.documents`) |
| `REVIEWED_PHOTO_TERMS` | `[]` | Correct while unapproved | Add the exact approved version only with the maintainer decision |
| ADR-0007 §4 "full erase on request" | ADR-0021 is **Proposed**; per-report erase is not implemented | The terms must not promise immediate deletion on request | Candidate §8 limits the promise to the 90-day automatic deletion until ADR-0021 lands (D4) |
| `APP_PRIVACY_INVENTORY.md` Photos row | "dormant … disabled" | Accurate today | Re-derive at activation from §3 |

## 5. UI consistency (ReportFormView and photo section)

| Terms candidate | App today | Consistent? |
| --- | --- | --- |
| New place needs 1–3 photos | `ReportPhotoSection(required: isMissing)`, "Photos (required, 1 to 3)"; submit disabled by `newSpotNeedsPhotos` | Yes |
| Other reports: photos optional | "Evidence photos (optional)" | Yes |
| Avoid faces and plates; an ashtray is not permission | Picker copy: "Avoid faces, vehicle plates and unrelated surroundings. A photo of an ashtray does not establish permission to smoke." | Yes |
| Photo location not used | "The photo's location data is not used. The listed position is only the map pin you chose." | Yes |
| Consent per version | Toggle "I agree to the report terms" + full text sheet; `acceptedTermsVersion` signed; remembered per version (`UserDefaultsReportConsent`) | Yes, mechanism. Content gap: the bundled text has no photo clause, so the server refuses photos (`photoConsentRequired`). This is the intended fail-closed state |
| Approval of a photo ≠ publication | Receipt "受け付けました…" does not promise listing (P3) | Yes |
| Not public; deleted within 90 days | **Not stated in the photo section** | **Gap**: add one footnote line in the activation PR, e.g. 「写真は審査にだけ使い、公開しません。受信から90日以内に削除されます。」 Not added now, so that unapproved copy does not ship |
| Expiry or deletion before review | A rejected or expired photo holds the new place (`newSpotPhotoGate`); the app can attach another until the deadline, also after a restart (resume copy: "Until a photo is received, a new place stays out of review for listing.") | Not explained in-app. Same footnote, or the received-state text (P3 follow-up) |

## 6. Proposed public-site text (not published)

Replaces privacy §5 when photo intake is enabled. Wording follows the candidate terms. It is published only with
the activation release.

**日本語**

> 5. 報告機能・写真
>
> 新しい喫煙所を報告するときは、その場所の写真を1〜3枚送信します（他の報告では任意）。写真はアプリ内で作り直してから
> 送信され、位置情報（GPS）・撮影日時・端末の機種などのメタデータは送信されません。サーバーでも画像を作り直し、
> 元のメタデータは保存しません。写っている人の顔や車のナンバーは自動では消えないため、写さないようにしてください。
>
> 写真は運営者が報告を審査するためだけに使い、アプリ・ウェブ・データの配布物で公開せず、第三者に提供しません。
> 写真は非公開のクラウドストレージ（Cloudflare）に保管され、審査の結果にかかわらず、報告の受信から90日以内に削除されます。
> 写真が承認されても、それだけで場所は地図に掲載されません。
>
> 写真の送信には、報告と同じ端末認証（App Attest）を使います。アカウントはありませんが、受信から90日以内は、同じ端末から
> 送られた報告と写真を運営者が関連付けられる状態にあります。写真の削除の申出は、サポート窓口で報告IDを添えて受け付けます。

**English**

> 5. Reports and photos
>
> When you report a new smoking place, you send 1–3 photos of it (optional for other reports). The app redraws each
> photo before sending, so location (GPS), capture time and device model metadata are not sent. The server redraws it
> again and does not keep the original metadata. Faces and number plates are not removed automatically. Please keep
> them out of the frame.
>
> Photos are used only by MannerPath to review the report. They are never published in the app, on the web or in
> data exports, and are not provided to third parties. They are kept in private cloud storage (Cloudflare) and are
> deleted within 90 days of receiving the report, whatever the review outcome. An approved photo alone does not put a
> place on the map.
>
> Photos are authorized with the same device attestation (App Attest) as the report. There is no account, but for up
> to 90 days MannerPath can associate reports and photos sent from the same device. To ask for a photo to be deleted,
> contact support with the report ID.

## 7. Decisions — maintainer and legal

Nothing below is decided by this document. "Owner" names who must sign off.

| ID | Decision | Owner | Recommendation |
| --- | --- | --- | --- |
| D1 | Approve the photo clause and register a new terms version (never the draft) | Maintainer | Approve only together with D2–D5 |
| D2 | Copyright licence wording and moral rights (resize/convert = alteration?) | **Legal** | Counsel review recommended |
| D3 | APPI: third-party personal data visible in photos — purpose notice, handling of objections, whether a privacy policy statement suffices | **Legal** | Counsel review recommended |
| D4 | Withdrawal policy (A/B/C in `COMMUNITY_PUBLICATION_DECISION.md` §5). Keep the 90-day automatic deletion as the only promise until ADR-0021 is implemented | Maintainer (+ legal) | Do not promise on-request erase before it exists |
| D5 | Wording of "deletion" given provider-internal erasure cannot be verified (`PHOTO_STORAGE_OPERATIONS.md`) | **Legal** | Disclose the limit as in candidate §6-2.3 |
| D6 | App Privacy: Linked vs Not linked for Photos | Maintainer | Linked, §2–3; Not Linked is a design change, not a label choice ([decision pack](PHOTO_LEGAL_DECISION_PACK.md) M7) |
| D7 | Whether to name Cloudflare as storage provider / processor in the policy | Maintainer (+ legal) | Name it (§6) |
| D8 | Liability limitation wording (consumer contract law) — existing candidate §10 | **Legal** | Counsel review recommended |
| D9 | Q1: photos required for new places | Maintainer | Required (current implementation) |
| D10 | In-app footnote "not public, deleted within 90 days" (§5 gap) | Maintainer | Add in the activation PR |
| D11 | Effective date, operator name, contact URL, governing law (existing `MAINTAINER-INPUT`) | Maintainer | — |

Counsel review is recommended for D2, D3, D5 and D8. They are interpretations of copyright, APPI and consumer law
on which this repository cannot be authoritative.

## 8. What activation will require (not done here)

These follow `COMMUNITY_LAUNCH_CHECKLIST.md` and `PHOTO_STORAGE_OPERATIONS.md`. None is performed by P7.

1. Approved version document under `docs/legal/report-terms/`, bundled byte-identically, and listed in
   `ReportTerms.documents` and `REVIEWED_PHOTO_TERMS`.
2. Privacy policy §5 replaced (§6) and verified live **before** the build that enables photos is distributed.
3. ASC answers re-entered per §3; the iPhone privacy manifest entry, if chosen.
4. The in-app footnote (D10).
5. Storage, cron, alerts and App Attest production prerequisites (maintainer operations).
