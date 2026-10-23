# Community report privacy boundary (operator-only vs public)

What each piece of a user report may reach, and the test that keeps it there. Audited 2026-10-24 against `main`
`1dea654`. Scope: the photo-backed `missing` report and `exists` confirmations, through moderation, the sealed
artifact, DATA_DB, promotion (v3/v4), tiles and the public API. This page changes no policy; G5 (report/review IDs in
promoted rows) stays as decided in [V1_PHOTO_REPORT_E2E](release/V1_PHOTO_REPORT_E2E.md) and
[the photo decision pack §5](legal/PHOTO_LEGAL_DECISION_PACK.md).

## Stores

| Store | Who can read it | Reaches production? |
| --- | --- | --- |
| REPORTS_DB + R2 `PRIVATE_PHOTOS` | Operator (CLI, local admin web) | It *is* production's report store; never copied elsewhere |
| Sealed evidence artifact (`report-queue export`) | Operator file | Imported into the pipeline DATA_DB only |
| Pipeline DATA_DB, internal tables (`community_*` ledger, applications, reconciliation) | Operator | **No** — not in the promotion table allowlist (`src/pipeline/promotion.ts` `TABLES`) |
| Promoted rows (`sources`, `source_releases`, `source_records`, `spots`, provenance, tiles…) | Operator (production DATA_DB) | Yes, through the reviewed promotion bundle |
| Public read routes | Anyone | — |

Public read routes (all unauthenticated GETs in `src/app.ts`): `/v1/config`, `/v1/readiness`, `/v1/coverage/tasks`,
`/v1/tiles/{z}/{x}/{y}`, `…/manifest`, `…/parts/{i}`, `/v1/spots/{id}`. They are built from allowlisted DTOs:
tile spots and `spots/dto.ts` (provenance is `{field, sourceId, rule, observedOn}`; community `observedOn` is `null`),
readiness is three state flags, coverage tasks come from the published corpus and seed areas only.

## Where each item may be

| Item | REPORTS_DB / R2 | Artifact | Pipeline DATA_DB | Promoted rows | Public | Guarded by |
| --- | --- | --- | --- | --- | --- | --- |
| Photo bytes, storage key, photo ID | Yes, ≤ 90 days | No | No (no photo table) | No | No | E2E STEP 1 and STEP 4, promotion-v4 test, public sweep |
| EXIF / GPS / device text | Never stored (client and server strip) | No | No | No | No | E2E STEP 1, `photo-sanitizer` tests, sweep |
| App Attest key ID, public key | Yes (`app_attest_keys`, REPORTS_DB) | No | No¹ | No | No | sweep (STEP 4) |
| Attestation object, assertion, challenge | Attestation object and assertion verified then discarded (`migrations/0007` comment); challenges stay in REPORTS_DB | No | No | No | No | `app-attest-*` tests |
| install ID | Never stored raw (hash only) | No | No | No | No | E2E STEP 1, sweep |
| Submitter hash | Yes, NULL after 90 days | No (count of independent submitters only) | No | No | No | E2E STEP 4 dump, sweep |
| Note, host name, hours note | Yes, NULL after 90 days | No | No | No | No | E2E STEP 4, adapter (`name: null`), sweep |
| Report pin | Yes, NULL after 90 days | Yes (location report) | Becomes the spot location | Spot location | **Yes — as the place's location** | intended: the reviewed fact |
| Structured claims (type, access…) | Yes, kept | Yes | Spot fields | Yes | **Yes — as facts** | intended |
| Report ID | Yes | Yes | Ledger + `source_records` | **Yes (G5)** | No | sweep; G5 positive assertion |
| Review ID | Yes | Yes | Ledger, `source_records`, `source_releases.source_url` | **Yes (G5)** | No | sweep; G5 positive assertion |
| Moderator ID (`decided_by`) | Yes | Yes | `community_*` applications | No | No | allowlist |
| Confirmation count | — | — | Yes | Yes | **Yes** (`verification.confirmations`) | intended |

¹ `migrations/0007` also created an `app_attest_keys` table in DATA_DB; registration writes only to REPORTS_DB
(`withReportStore`), and the table is not promoted.

Report IDs are 128 random bits (`src/reports/report-id.ts`); they carry no time, device or content.

## Regression tests

- `test/support/public-surface.ts` reads **every** public route for every published tile (body, manifest, each part)
  and the given spots, and fails if any response names a private value. It refuses generic needles (< 8 chars).
- `v1-photo-report-e2e.test.ts` STEP 4: sweep on the pipeline DB and on the promoted DB; G5 IDs present in promoted
  `source_records` but no note, install ID, submitter hash, key, photo ID or storage key there; after the 90-day
  retention run (photos deleted, report minimized) the listing stays published and the sweep is still clean.
- `coverage-first-multiconfidence.test.ts`: the same sweep after a `communityReported → communityVerified` upgrade,
  over all report IDs, review IDs, submitter hashes, the note and the install ID.
- Existing: artifact, DATA_DB dump and promotion-bundle checks (E2E STEP 4, `v1-photo-report-promotion-v4.test.ts`),
  `reports-privacy.test.ts`, retention tests.

## Risks noted, not changed

- **G5:** someone holding production DATA_DB *and* REPORTS_DB can join a published spot to its reports (full private
  report for 90 days, then a redacted skeleton). Accepted pending the maintainer's M9 decision; access to both stays
  operator-only.
- **Pin precision:** the published location is the reporter's pin (5 decimals). It describes the place, not the
  reporter, but a pin placed at the reporter's own position is published as such; the reviewer checks it.
- **Provider logs** (Cloudflare) are outside this boundary; see `PRODUCTION_PRIVACY_AUDIT.md`.
