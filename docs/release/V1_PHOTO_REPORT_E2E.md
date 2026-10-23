# v1.0 P8 — photo-backed new-place report: E2E verification

Status: synthetic E2E automated (`services/api/test/v1-photo-report-e2e.test.ts`, and for promotion v4
`services/api/test/v1-photo-report-promotion-v4.test.ts`). **No staging or production run has
happened.** A synthetic pass proves the code path on local SQLite, the in-process Worker, a memory photo store and a
synthetic App Attest PKI; it says nothing about deployed bindings, real R2, real Apple attestation or the iPhone.

## What the automated test covers

| Step | Covered (synthetic) | Where else |
| --- | --- | --- |
| 1 Intake | attested v3 `missing` report with pin, `spotType`/`hostType`/`environment`/`accessType`; same draft resent → one report; 3 photos (JPEG with EXIF location/device text) → stored PNG without `Exif`/`GPS`/device text; storage failure then retry with the same photo key → one object; identical retry → same photo; 4th photo refused; another device's photo refused | `photo-api`, `photo-sanitizer`, `app-attest-api`, `report-idempotency` tests |
| 2 Operator | report in the pending queue (no storage keys in it); private photo bytes exist (read from the test store — see gap G1); photo approve/reject; report `needsInfo` / `rejected` / `accepted`; duplicate candidates (`photoGates`, distinct submitters) and discarding the duplicate | `review-queue`, `new-spot-photo-gate` |
| 3 Gate | none / pending / rejected → refused; approved but no `spotType` → refused; lone report never `communityVerified`; erasure lead (`delete_after − 24 h`) and deletion queue close the gate between proposal and export, in code and by direct SQL | `new-spot-photo-gate`, `new-spot-photo-erasure-window` |
| 4 Pipeline | review → sealed artifact → DATA_DB import → apply → blocked publish (#124) → **simulated** rights approval → tiles, `analyzeCorpus`, `/v1/spots/:id` → promotion bundle (v3 multi-source) → fresh target. Note, install ID, submitter hash, photo IDs, storage keys and EXIF text are absent from the artifact, every DATA_DB table, tiles, detail and the bundle | `community-publication-readiness`, `coverage-first-multiconfidence` |

## Can one report be listed? (investigation)

Yes, through an existing, unchanged route: the **`communityReported`** tier (ADR-0012, ADR-0013;
`proposeNewSpotReview(..., tier: "communityReported")`, CLI `report-queue propose-reported <decidedBy> <reportId>`).
Its premises (all enforced in `src/reports/review.ts`, none relaxed by P8):

1. report `accepted` by moderation and `queued` for reconciliation, inside its 90-day deadline, not redacted;
2. terms consent recorded on the report;
3. an explicit `spotType` other than `unknown` (a host business alone is not a smoking place);
4. pin inside Japan;
5. at least one viewable, operator-approved photo (#322/#323 gate);
6. publication only once the community source is approved and the terms grant rights (Issue #124) — today both are
   blocked/draft, so the spot is canonical but **not published**.

The listing is labelled `communityReported` (one reviewed report, `confirmations: 1`) everywhere, never official or
`communityVerified`. `communityVerified` needs ≥ 2 independent submitters; a later independent `exists` confirmation
upgrades it (`upgradeCommunityEvidence`). An approved photo is never permission to smoke.

Minimal legitimate publish procedure for one report (after #124 is resolved; not before):

```
report-queue decide <reportId> accepted <reviewer> confirmed
report-queue queue <reportId> queued
report-queue photo-decide <photoId> approved <photoReviewer> usableEvidence   # needs the photo ID — see G2
report-queue propose-reported <reviewer> <reportId>
report-queue export <reviewId>            # REPORTS_DB -> sealed artifact
report-queue import <artifact.json>       # DATA_DB
report-queue apply <applicationId>        # then the normal publish / quality / promotion run
```

## Gaps found

- **G1 — no operator photo viewer on main.** Nothing on `main` lets an operator see a private photo; that is P6 / the
  admin web (#321, draft). Until it lands, approving a photo means approving one nobody looked at. Release blocker.
- **G2 — no operator path to a report's photo IDs.** `photo-decide` needs a `photoId`, but `photo-summary` returns
  only `{approvedPhotos, permissionToSmoke}` and no CLI command or queue item lists photo IDs. The test reads them
  from SQL. Expected to be covered by #321; otherwise a read-only CLI listing is needed.
- **G3 — duplicate policy (decided).** Before queueing, moderate the report `duplicate`
  (`decide <id> duplicate <reviewer> duplicateOfExistingReport`). After queueing, the DB CHECK refuses `duplicate`, so
  `queue <id> discarded`; the moderation row keeps its `accepted` decision, decider, reason and time. There is no
  append-only moderation history on `main` — `report_moderation` holds the current decision only (the admin audit
  table is #321's 0008).
- **G4 — promotion v4 (covered).** `v1-photo-report-promotion-v4.test.ts` adds the photo-backed `communityReported`
  spot to the full reviewed corpus and promotes it with v4: every previously published spot keeps its ID, canonical
  row and tile entry (in the source and on GREEN, compared with a GREEN promoted before the report); the only new tile
  entry is the community spot. Without the simulated registry v4 refuses to export the published community spot.
- **G5 — provenance IDs in promotion (existing design, v3 and v4).** The community `source_releases` and
  `source_records` rows carry the review ID and evidence report IDs as provenance, so a v4 bundle names them. They
  are opaque IDs, absent from tiles and spot detail, and the bundle is operator-only; no note, photo, storage key,
  submitter hash or install ID travels. Decide before #124 whether that provenance may live in production DATA_DB.

## Staging manual checklist (each step needs separate authorization; nothing here is approved)

1. Apply REPORTS_DB migrations through 0010 to **staging** only; confirm triggers
   `report_reviews_new_spot_photo_evidence` and `report_reviews_new_spot_photo_viewable` exist.
2. Staging Worker with photo intake enabled against a **staging-only private** R2 bucket; config shows
   `photoEvidenceEnabled: true` on staging only; production stays `false`.
3. From a TestFlight/dev build with real App Attest: submit a new place with 1–3 photos, kill the app before photos
   finish, relaunch and retry; confirm one report and ≤ 3 photos, and no duplicate report.
4. Download a stored object with operator credentials: PNG, no EXIF/GPS (`exiftool` shows none).
5. Operator review (CLI or #321 once merged): approve one photo, reject one; confirm the rejected object is deleted
   from R2 by the cleanup cron and the deletion queue drains.
6. `candidates 50` shows `photoGates`; `propose-reported` refuses until a photo is approved; `export` → `import` →
   `apply` on staging DATA_DB; the spot stays unpublished while #124 is open.
7. Inspect the artifact, staging tiles and `/v1/spots/:id`: no note, photo, storage key or submitter data.
8. Retention: confirm photos of a staging report become non-evidence 24 h before `delete_after` and are erased.

Not on staging without a decision: enabling production intake, granting rights or approving the community source.
