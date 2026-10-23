# Photo-backed submission — final legal/privacy decision pack (v1.0)

Status: **Preparation, 2026-10-23, against `main` `eb4ed96` (after #330). Not an approval and not a legal
determination.** Nothing here registers a terms version, enables photo intake, changes the public site or answers App
Store Connect. `REVIEWED_PHOTO_TERMS` stays `[]` (`services/api/src/reports/photo-policy.ts:10`).

Purpose: the maintainer reads §1, makes the decisions in §6, and the activation work in §7 can then start without
further research. Background and evidence: [PHOTO_TERMS_CANDIDATE](PHOTO_TERMS_CANDIDATE.md) (text),
[PHOTO_PRIVACY_REVIEW](PHOTO_PRIVACY_REVIEW.md) (data flow), [COMMUNITY_PUBLICATION_DECISION](COMMUNITY_PUBLICATION_DECISION.md)
(Issue #124 report terms), [V1_PHOTO_PLACE_SUBMISSION](../release/V1_PHOTO_PLACE_SUBMISSION.md) (requirements).

## 1. Final approval checklist (maintainer)

Tick in order. A later step never starts before the earlier ones are recorded (date, who).

| # | Decision / check | Where decided | Counsel advised |
| --- | --- | --- | --- |
| 1 | Release order: v1.0 ships with photo-backed submission **on** (plan Q5, completion condition) or ships with reports off and turns them on later | §6 M1 | no |
| 2 | Report terms (#124): APPROVE / HOLD / CHANGE the candidate, including operator name, contact, governing law, §8 withdrawal A/B/C, §10 liability | §6 M2–M5, `COMMUNITY_PUBLICATION_DECISION.md` §12 | **yes** (D8, liability) |
| 3 | Photo clause: APPROVE / CHANGE [PHOTO_TERMS_CANDIDATE](PHOTO_TERMS_CANDIDATE.md) for merging into the **same new version** | §6 L1–L4 | **yes** (L1–L3) |
| 4 | Version string and effective date of that one new version (never the `.draft` version) | §6 M6 | no |
| 5 | App Privacy answer for the photos-on build (§3), incl. Linked | §6 M7 | no |
| 6 | Privacy policy text for the photos-on release (§4; ja/en draft in PHOTO_PRIVACY_REVIEW §6) | §6 M8 | advised with L2 |
| 7 | G5 report/review IDs in promoted rows: keep or schedule a format change (§5) | §6 M9 | no |
| 8 | In-app footnote "not public, deleted within 90 days" (D10) | §6 M10 | no |
| 9 | Only after 1–8: the activation PR(s) of §7, then operations (R2, REPORTS_DB, App Attest secrets, edge rule), staging E2E (R13) and the device run (R14) | §7, §8 | no |

Required by the product and **kept**: a new place needs **1 to 3 photos**; other reports keep photos optional (0–3).
This is plan Q1 (recommended "required") and is what the code enforces: client `newSpotNeedsPhotos` /
`ReportPhotoSection(required:)`, server `newSpotPhotoGate` (≥ 1 approved, unexpired photo before a new-place review
can be exported).

## 2. Terms candidate vs current implementation

Checked against code on `eb4ed96`. "Yes" means the code does what the clause says; it does not mean the clause is
legally sufficient.

| Clause (PHOTO_TERMS_CANDIDATE) | Implementation | Consistent? |
| --- | --- | --- |
| 1-2 §1: new place needs 1–3 photos, others optional | Client gate + server `newSpotPhotoGate`; attachment limit 3 (`photoAttachmentLimit` 409) | Yes |
| 1-2 §2: photos follow the accepted report with the same App Attest key; a failed photo keeps the report; a new place without an approved photo is not published | `AttestedEvidencePhotoUploader`; `ReportModel` never resends the report; `newSpotPhotoGate`; #330 lets the user re-attach after a restart | Yes |
| 1-2 §3: metadata removed on device and server; content (faces, plates) not removed | `ReportPhotos.normalize`; `photo-sanitizer.ts` (PNG from pixels); no redaction code | Yes |
| 1-2 §4: photo location never used; only the map pin | No EXIF read path; pin from `ReportPinPicker` | Yes |
| 4-2 §2: use only for review (store, show, resize, convert) | Private R2 `PRIVATE_PHOTOS`; local admin preview only (#321) | Yes |
| 4-2 §3: no publication; no photo, ID, hash or count in app/API/tiles/bundles | Tiles/DTO carry `{field, sourceId, rule, observedOn}` only (`src/spots/dto.ts`); CLI `photo-summary` counts are operator-only | Yes |
| 4-2 §4: only facts are published, after existing gates | Review → artifact → promotion; photos never leave REPORTS_DB/R2 | Yes |
| 4-3: prohibited photos are not approved | Operator decision with reason (`photo-decide`, admin web); no automatic detection | Yes (manual only — stated in the clause) |
| 5: photo data is never public | As 4-2 §3 | Yes |
| 6-2 §1: deleted within 90 days of receipt, erasure starts 24 h earlier, late uploads do not extend it | `delete_after = minimize_after`; access cutoff `delete_after − 24 h` (#323) | Yes |
| 6-2 §2: rejected / unfinished / redacted photos queued for deletion at once | Deletion queue (ADR-0016 lifecycle) | Yes |
| 6-2 §3: overwrite-with-empty fence, no backups; provider internal timing not guaranteed | `PHOTO_STORAGE_POLICY = private-no-copies-permanent-fences.v1` is an **operator attestation**, not a check of the Cloudflare account | Yes in code; the attestation is an operations item (§8) |
| 8 addition: deletion requests by report ID; no promise beyond 90-day automatic deletion | ADR-0021 (per-report erasure) is **Proposed**, not implemented | Yes, as long as the text keeps the limit (L4) |
| 9 addition: photos refused unless the consented version covers photos | `photos.ts:27` `photoConsentRequired` unless `REVIEWED_PHOTO_TERMS` has the version; `photos.ts:34` version must equal the report's | Yes |
| **Not in the candidate:** on-device follow-up record after #330 | `Reports/photo-follow-up.json`: report ID, consent version, deadline, confirmed count; no image/key/assertion; ≤ 89 days; maintainer-approved (#330) | **Gap (text only):** say it in the privacy policy (§4); the terms need not |
| **Not in the candidate:** report terms §6 "90 日以内に削除" lists text content only | `REPORT_TERMS_CANDIDATE.md` | **Gap:** merging the photo clause into the same version closes it (step 3) |

## 3. App Privacy — recommended answers and reasons

### 3.1 Apple's definitions used (developer.apple.com/app-store/app-privacy-details, checked 2026-10-23)

- *Collect*: "transmitting data off the device in a way that allows you and/or your third-party partners to access it
  for a period longer than what is necessary to service the transmitted request in real time."
- *Linked*: data "is often linked to the user's identity, unless specific privacy protections are put in place
  **before collection** to de-identify or anonymize it", and after collection you must not tie it to "other datasets
  that enable it to be linked".
- *Photos or Videos*: "The user's photos or videos". *Other User Content*: "Any other user-generated content".
  *Device ID*: "device's advertising identifier, or other device-level ID".
- *Optional disclosure* needs **all** criteria, including that "the user's name or account name is prominently
  displayed in the submission form". MannerPath has no account, and new-place photos are primary functionality, so
  **the exception does not apply**.

### 3.2 Answer for the build/deployment where photo intake is on

| ASC data type | Answer | Linked | Tracking | Purpose | Code basis |
| --- | --- | --- | --- | --- | --- |
| User Content → **Photos or Videos** | **Collected** | **Linked** | No | App Functionality | Kept in private R2 up to 90 days (> real time). The photo row references `report_id`; the report holds `submitter_hash` derived from the device's App Attest key until the 90-day redaction. That is linkage to a device-level identifier, and it exists from collection — not removed *before* collection as Apple requires for Not Linked |
| User Content → **Other User Content** | Collected | Linked | No | App Functionality | Report note/claims/pin (already in `APP_PRIVACY_INVENTORY.md`); the photo flow requires a report |
| Identifiers → **Device ID** | Collected | Linked | No | App Functionality | App Attest key ID / public key; key-derived submitter hash |
| Location → Precise / Coarse | Unchanged by photos | — | No | — | Photo GPS removed on device and server; the report pin is user-chosen (inventory row "Location chosen by the user") |

Tracking stays **No**: `NSPrivacyTracking = false`, no ad/attribution SDK, nothing shared for advertising.

**Not Linked is not available on the current design.** It would need the key-derived hash removed before storage
(e.g. no per-device correlation at all), which would also remove the abuse limits the R8 requirement depends on. If
the maintainer still wants Not Linked, that is a design change, not a labelling choice.

### 3.3 Contradictions resolved by this PR

| Document | Said | Now |
| --- | --- | --- |
| `V1_PHOTO_PLACE_SUBMISSION.md` R10 | "User Content → Photos, **not linked**" | Linked, with a link here (the requirement predates the data-flow review) |
| `PHOTO_PRIVACY_REVIEW.md` §3, D6 | "Linked (conservative)" / maintainer may choose | Linked is the recommendation; Not Linked requires the design change in §3.2 |
| `APP_PRIVACY_INVENTORY.md` note 2 | Linked is a maintainer/legal decision | Points here for the photos-on answer |
| `APP_STORE_SUBMISSION.md` §2.2, `APP_STORE_CONNECT_ENTRY.md` §0.2 | Photos **Not Collected** (photos off) | **Still correct only for a photos-off build.** Not edited here (ASC entry material). If M1 = photos on, these rows must change to §3.2 in the activation PR (§7 step 7) |

`PrivacyInfo.xcprivacy` (iPhone) declares no collected types today. For consistency with §3.2 add
`NSPrivacyCollectedDataTypePhotosorVideos` (linked, not tracking, App Functionality) in the activation PR.

## 4. Privacy policy: today vs photos on

| Topic | Live policy today (`site/privacy` §5, ja/en) | Needed when photos are on |
| --- | --- | --- |
| Availability | Reports, App Attest registration and photo upload unavailable in the initial version | Replace: reports and photos available; App Attest registers when a report is sent |
| What is collected | — | Photos (1–3, new place required), report content, App Attest key ID |
| Metadata | — | GPS, capture time and device model removed on device; server re-encodes |
| Third parties in photos | — | Not automatically removed; do not include faces/plates; such photos are not approved |
| Use | — | Review only; never published or shared; only checked facts may be listed |
| Retention | Workers logs ≤ 7 days (#275) | Photos and personal report content deleted within 90 days of receipt; erasure starts 24 h before |
| Linkage | — | No account, but for up to 90 days reports/photos from one device can be associated |
| Requests | Contact (Gmail) | Deletion requests by report ID; nothing beyond the 90-day deletion is promised (ADR-0021 Proposed) |
| On the device | — | Unsent photos stay in memory only; after acceptance a small record (report ID, terms version, deadline, count) is kept on the device until the photos are sent or at most 89 days |
| Processor | Cloudflare named for Workers | Name Cloudflare R2/D1 for photo storage if M8 says so (D7) |

Draft text: PHOTO_PRIVACY_REVIEW §6 (ja/en). It must gain the "on the device" row above before publication. The site
is published only in the activation release, never ahead of the app (§7 step 8).

## 5. G5 — report and review IDs kept in promoted rows (privacy evaluation)

Facts (`V1_PHOTO_REPORT_E2E.md` G5; code checked here):

- Report IDs are 128 random bits (`src/reports/report-id.ts`: "Nothing about the report, its submitter or its subject
  goes into the ID"). They carry no time, device or content.
- Promoted `source_records.raw_values_json` / `upstream_row_ref` and `source_releases.source_url` carry the review ID
  and the evidence report IDs into **production DATA_DB**. Tiles, `/v1/spots/:id` and `/v1/config` carry none.
- Joined with REPORTS_DB, an ID leads to the full private report for up to 90 days (pin, note, `submitter_hash`,
  photos), and afterwards to a content-free skeleton; photos are deleted by then.

Assessment:

| Question | Answer |
| --- | --- |
| Public exposure | None (no public field carries the IDs) |
| Who can re-identify | Only someone with both REPORTS_DB and production DATA_DB access — the operator |
| Personal data added by promotion | No new content; the ID is a pseudonymous key to data the operator already holds |
| Effect after 90 days | Leads only to redacted rows; linkage to a device ends with `submitter_hash` = NULL |
| Need | Audit trail from a published fact back to its review; confirmation count for the community adapter |

Recommendation: **keep plain IDs for v1.0** (M9 option A), with two conditions written into operations: production
DATA_DB access stays operator-only, and no export of `source_records` leaves the operator. Option B (HMAC of the report
ID with a key kept beside REPORTS_DB) removes the direct join but changes `raw_sha256`, the adapter parser and every
existing community release; schedule it only if REPORTS_DB and DATA_DB access will be separated.

## 6. Decisions for the maintainer

M = maintainer decision. L = maintainer decision on which counsel review is advised. No item is decided here.

| ID | Decision | Options / recommendation | Blocks |
| --- | --- | --- | --- |
| M1 | Release order (plan Q5) | Photos on in v1.0 (completion condition) / reports off at launch, enabled later | Which App Privacy answer (§3) and policy (§4) apply at submission |
| M2 | Report terms APPROVE / HOLD / CHANGE (#124) | — | Everything below |
| M3 | Operator name, contact, terms URL, effective date | — | Version document |
| M4 | §8 withdrawal A / B / C | Must not promise more than 90-day automatic deletion until ADR-0021 is implemented | Terms §8, policy "Requests" |
| M5 | Governing law / jurisdiction, §4.2 reuse | — | Version document |
| M6 | One new version string (e.g. `report-terms.2026-11-xx`) carrying report + photo clauses | Never reuse `.draft` | §7 |
| M7 | App Privacy for the photos-on build | **Linked** (§3.2); Not Linked only with a design change | ASC |
| M8 | Privacy policy text and naming Cloudflare (D7) | §4 | Site update |
| M9 | G5 IDs | **A: keep** (§5) / B: HMAC format change | Promotion |
| M10 | In-app footnote (D10) | Add 「写真は審査にだけ使い、公開しません。受信から90日以内に削除されます。」 with the activation PR | Activation PR |
| L1 | Copyright licence wording and moral rights (resize/convert = alteration?) (D2) | — | Clause 4-2 §2 |
| L2 | APPI: third-party personal data in photos; purpose notice; objection handling (D3) | — | Clause 4-3, policy |
| L3 | How to say "deleted" given provider-internal timing (D5) | — | Clause 6-2 §3 |
| L4 | Liability limits vs 消費者契約法 (D8) | — | Report terms §10 |

Not reopened: Q1 (photos required, 1–3) — kept as implemented. #330's on-device follow-up record — approved by the
maintainer on 2026-10-23.

## 7. After approval: exact steps (each a reviewed PR unless marked operations)

1. `docs/legal/report-terms/<version>.md`: report candidate + photo clause merged, every `MAINTAINER-INPUT` filled,
   CANDIDATE notice removed (`COMMUNITY_PUBLICATION_DECISION.md` §8 step 1).
2. `services/api/src/reports/community-publication.ts`: `approved` with `termsVersion`, `documentPath`,
   `documentSha256`, `termsUrl`, `approvedBy`, `approvedOn` (§8 step 2). `CURRENT_REPORT_TERMS` becomes the new version.
3. `services/api/src/reports/photo-policy.ts`: add exactly that version to `REVIEWED_PHOTO_TERMS`. Intake is still
   off until `PHOTO_EVIDENCE=on`, storage policy, App Attest, retention cleanup and cron are all configured (`photoIntakePolicy`).
4. App: `ReportTerms.documents` gains the version (not draft) and `Features/Reports/Terms/<version>.md` byte-identical
   (`test/community-activation.test.ts`); `ReportComposition` passes `PhotoEvidencePolicy(enabled: true,
   acceptedTermsVersion: <version>)`; footnote M10; `PrivacyInfo.xcprivacy` photo entry (§3.3).
5. `docs/SOURCES.md` community entry (approved, licence, attribution).
6. Docs: `APP_PRIVACY_INVENTORY.md` Photos row and `PHOTO_PRIVACY_REVIEW.md` status → approved version.
7. ASC material (owner of those files): `APP_STORE_SUBMISSION.md` §2.2 and `APP_STORE_CONNECT_ENTRY.md` §0.2 Photos
   row → §3.2; Review Notes stop saying reports/photos are unavailable.
8. Site (`site/privacy`, ja/en): §4 text, published together with the app release that turns photos on — not before.
9. Operations (maintainer only): R2 bucket and `PHOTO_STORAGE_POLICY` attestation, REPORTS_DB, App Attest secrets,
   retention cron, edge IP rule (Q3), then `npm run community:activate -- --terms-version <version>` per
   `COMMUNITY_LAUNCH_CHECKLIST.md`.
10. Verification: staging E2E (R13, P8 runbook) and Release build on a device (R14); `GET /v1/config` shows
    `photoEvidenceEnabled:true` only after 1–9.

Rollback: `COMMUNITY_PUBLICATION.state = "suspended"`; removing the version from `REVIEWED_PHOTO_TERMS` closes photo
intake (`photoConsentRequired`), and `PHOTO_EVIDENCE` off closes the route.

## 8. Release gate re-audit (photo submission, 2026-10-23)

| Item | Implemented in code | Not verified in a real environment | Waiting on the maintainer |
| --- | --- | --- | --- |
| Entry, form, 1–3 photos, consent, received state (R1–R3) | Yes (P2, P3, #330 recovery) | Device Release build (R14) | — |
| Attested upload (R4) | Yes (#317) | Real App Attest on device | App Attest secrets (ops) |
| Private storage, fences, expiry (R5) | Yes (#316, #323) | Real R2 / cron | Bucket, attestation of no copies (ops) |
| Metadata removal (R6) | Yes, unit-tested client and server | Photos from a real device | — |
| Faces/plates handling (R7) | Copy + manual rejection | — | Moderation policy is the operator's |
| Abuse limits (R8) | Key limits in code | Edge IP rule | Values (Q3) |
| Terms incl. photos (R9) | Consent mechanism; refuses photos without a covered version | — | **M2–M6, L1–L4** |
| App Privacy + policy (R10) | — | — | **M1, M7, M8** |
| Operator review (R11) | Yes, local admin (#321) | Against real R2 | — |
| Gates/promotion (R12) | Yes (#322, #328 v4) | Production promotion | M9 (G5) |
| E2E (R13) | Synthetic (#326, #328) | **Staging run not done** | Staging environment (Q4) |
| Device (R14) | — | **Not done** | Device run |

The App Store gate gains row G23 for this pack; G2/G3/G4 now name the photos-on answers as conditional on M1
(`docs/V1_APP_STORE_RELEASE_GATE.md`).
