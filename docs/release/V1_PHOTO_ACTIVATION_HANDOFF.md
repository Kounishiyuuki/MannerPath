# v1.0 photo intake activation handoff

What switches photo-backed reports on, what is already in place, and what only the maintainer can do. Audited
2026-10-24 against `main` `245c81d`. Nothing here approves terms or enables intake; the repository stays fail-closed.

## The gates (all must be open; any one closed means no photo is sent or accepted)

| Gate | Where | Today |
| --- | --- | --- |
| Reviewed photo terms (server) | `services/api/src/reports/photo-policy.ts` `REVIEWED_PHOTO_TERMS` | `[]` |
| Reviewed photo terms (app) | `ReportPhotos.swift` `PhotoEvidencePolicy.reviewedPhotoTerms`, used by `ReportModel.makeModel` through `.reviewed()` | `[]` |
| The two lists are equal | `test/photo-activation-readiness.test.ts` | enforced |
| The reviewed version is the current report terms (`/v1/config` `termsVersion`) and the newest version the app bundles | `photoIntakePolicy`, `PhotoEvidencePolicy.reviewed`, `ReportPhotos.accepts` | draft only |
| Deployment bindings: `PHOTO_EVIDENCE=on`, private bucket + `PHOTO_STORAGE_POLICY`, App Attest required, `REPORT_RETENTION=cleanup` + photo cron | `photoIntakePolicy` | off everywhere |
| Server advertises intake (`photoEvidenceEnabled`) | `GET /v1/config`, same derivation as intake | `false` |
| Publication rights for the consented terms version | `terms.ts` / `community-publication.ts` (pending) | none |

A photo being approved by a moderator never publishes anything by itself: it only lets a new-place report reach review
(`new-spot-photo-gate.test.ts`); publication still needs the terms rights above, and photos never leave REPORTS_DB/R2
([PRIVACY_BOUNDARY.md](../PRIVACY_BOUNDARY.md)).

## Activation PR (only after the maintainer approves the photo terms)

1. Add the approved report terms version (the community activation, `COMMUNITY_PUBLICATION_DECISION.md` §8) so it is
   `CURRENT_REPORT_TERMS` and the newest `ReportTerms.documents` entry, with its bundled document.
2. Add that exact version to **both** `REVIEWED_PHOTO_TERMS` and `PhotoEvidencePolicy.reviewedPhotoTerms`. Never the
   draft version.
3. Add `NSPrivacyCollectedDataTypePhotosorVideos` to the iPhone `PrivacyInfo.xcprivacy` (PHOTO_PRIVACY_REVIEW.md §3)
   and update the App Privacy answer (APP_STORE_CONNECT_ENTRY.md §0.2 assumes reports off).
4. Update tests that pin the closed state (`photo-activation-readiness.test.ts`, `photo-policy.test.ts`,
   `photo-api.test.ts`, `ReportPhotoFormFlowTests.reviewedPhotoTerms…`).
5. Deployment bindings follow `V1_PHOTO_STAGING_RUNBOOK.md` on staging first; production only after staging E2E.

## Covered by tests before approval (test seams only)

| Case | Test |
| --- | --- |
| Intake off / server off / terms not reviewed / version mismatch | `photo-activation-readiness.test.ts`, `photo-policy.test.ts`, `ReportPhotoFormFlowTests.closedPhotoIntakeBlocksNewPlaces…` |
| Approved state opens only with every binding | `photo-activation-readiness.test.ts` (`reviewed` seam), `ReportPhotoFormFlowTests.reviewedPhotoTerms…` |
| 1–3 photos (4th refused), attested upload, retry | `photo-client-contract.test.ts`, `photo-api.test.ts`, `AttestedPhotoUploadTests`, `ReportPhotoFormFlowTests` |
| Restart recovery (PR #330) | `ReportPhotoRecoveryTests` |
| Before/after photo approval, never public | `new-spot-photo-gate.test.ts`, `v1-photo-report-e2e.test.ts` |
| Private data protection | `v1-photo-report-e2e.test.ts` STEP 4, `PRIVACY_BOUNDARY.md` |
