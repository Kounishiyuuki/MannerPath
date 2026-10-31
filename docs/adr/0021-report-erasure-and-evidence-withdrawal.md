# ADR-0021 — Report erasure, evidence withdrawal and receipt tombstones

Status: **Proposed (design only, 2026-10-14, against main `0b7f2c8`).** Not accepted. No migration, CLI, retention
period or legal basis is implemented or chosen by this document. Resolves nothing in Issue #242 until the decisions in
§7 are made.

Relates to ADR-0007 §4 (retention, "full erase … for a deletion request"), its 2026-10-13 amendments (idempotency
receipts, bulk rejection, retention automation), ADR-0014 (durable report store, sanitized evidence, rollback) and
`docs/legal/COMMUNITY_PUBLICATION_DECISION.md` §5 (withdrawal options A/B/C).

## 1. Problem

ADR-0007 §4 promises a full erase on a deletion request; no code implements it, and the schema refuses it:

| Reference to a report | Where | Today on `DELETE FROM reports` |
| --- | --- | --- |
| idempotency receipt | REPORTS_DB `report_idempotency` (0004) | refused: `ON DELETE RESTRICT`, receipts never deleted |
| moderation row | REPORTS_DB `report_moderation` (0001) | `ON DELETE CASCADE` |
| photos / photo requests | REPORTS_DB `community_evidence_photos`, `community_photo_requests` (0003) | `CASCADE`; storage object queued, but no storage adapter exists (photo intake disabled) |
| review evidence link | REPORTS_DB `report_review_evidence` (0001) | refused: plain FK, rows never deleted |
| review ids in text | REPORTS_DB `report_reviews.location_report_id`, `base_report_ids` | not a FK; the ID stays |
| bulk rejection audit | REPORTS_DB `report_bulk_rejection_targets` (0006) | not a FK; ID and `received_at` stay, append-only |
| sanitized evidence | DATA_DB `community_evidence_reports` (0025), artifact ledger | separate database; ID, adopted pin and claims stay, immutable |
| backups | D1 Time Travel, offline exports (OPERATIONS "Report store … backup") | content persists for the backup window |

## 2. Working direction (maintainer, 2026-10-14; provisional)

1. Reports used as review evidence: option **B** of the publication decision — drop the report as evidence and
   re-review. A spot still meeting the publication rule on independent remaining evidence stays published; one that
   does not is held; an erased report is never evidence again.
2. Receipts: a minimal tombstone that keeps refusing the erased draft (`410 idempotencyRetired`). Retention period
   and legal basis are open; **permanent retention is not the default**.
3. Bulk rejection audit: report ID and received time removable or de-identifiable, without casually breaking the
   append-only guarantees.
4. Requester verification: a report ID alone is not sufficient proof.

## 3. Proposed erasure semantics

**Erase** = one maintainer CLI operation (no HTTP admin endpoint) per verified request, plan → digest-confirmed
apply like `reports:bulk-reject`, committing in **one** REPORTS_DB batch:

1. Refuse when the report has photo rows until a reviewed storage adapter can delete the objects (today none can
   exist: intake disabled).
2. Convert the receipt to an **erased tombstone**: `report_id` → NULL, `request_sha256` → NULL, `erased_at` set,
   `expires_at` = `erased_at` + *R* (§7 D2). Only `idempotency_digest` (a random digest unlinkable without the client's
   key) and times remain.
3. Withdraw the report from reviews (§4) and record an evidence withdrawal for export if it reached an exported review.
4. De-identify audit references (§5).
5. Delete the report row (moderation row cascades; the queue revision trigger already fires on delete).
6. Append an erasure audit row with **no report identifier**: random operation id, time, closed reason code
   (`dataSubjectRequest`), counts of affected receipts/reviews/audit rows, maintainer handle.

Retry semantics (unchanged answers, new cause):

| Request after erase | Answer | Budget |
| --- | --- | --- |
| same owner key + same idempotency key, tombstone live | `410 idempotencyRetired` (no `reportId`, as after minimization) | none |
| another App Attest key with that idempotency key | new draft (ownership is in the digest, as today) | normal |
| same key after the tombstone expired | **a new report is created** — the residual risk that *R* must bound (§7 D2) | normal |

Concurrency: a retry racing an erase either commits first (then the erase plan's snapshot no longer matches and apply
aborts; re-plan) or observes the tombstone (`410`). The erase batch and the intake batch both write the receipt row,
so D1 serializes them; no state "report gone, receipt active" can commit (enforced by trigger, §6).

Retention interplay: erase of an already-minimized report deletes the skeleton and turns the retired receipt into an
erased tombstone; minimization of an erased report is impossible (row gone). A minimization batch that loses the race
finds no row and skips it.

Revocation interplay: unchanged. A revoked key cannot submit, so it cannot retry; erase never revokes, and revocation
never erases. The revocation table holds key ids, not report ids.

## 4. Evidence withdrawal under option B

REPORTS_DB (before export): a `proposed` review citing the report is **withdrawn** through the existing withdraw path;
re-proposing without the report is ordinary moderation. `report_review_evidence` is no-delete today, so the link row
needs a one-way de-identification (§6) rather than deletion.

DATA_DB (after export): imported artifacts are immutable and digest-bound (ADR-0014 §4–§6), so nothing is rewritten.
Instead a new sanitized **evidence-withdrawal artifact** (schema-versioned, deterministic, digest-bound) carries only
`{reportId, reviewId, reason: dataSubjectRequest}` and is imported into an append-only withdrawal ledger. Canonical
guards then treat a withdrawn evidence row as absent:

- `communityVerified` / holds / upgrades recount independence without it (the existing "≥ 2 fresh reports from distinct
  submitters" triggers gain one `NOT EXISTS (withdrawn)` condition);
- a spot whose remaining evidence no longer meets the rule is **held** (existing publication-hold mechanism) until a new
  review; a spot that still meets it stays published;
- the withdrawn row's adopted pin is not used by any new review; whether the already-published coordinate of a held
  spot is kept internally or cleared is §7 D5.

**Rollback hazard (contradiction with ADR-0014 §10).** A canonical rollback restores an earlier DATA_DB, which may
predate a withdrawal and would silently reuse erased evidence. Proposed rule: REPORTS_DB's withdrawal ledger is the
source of truth; promotion and post-rollback checks refuse a canonical database missing any recorded withdrawal and
re-import them first. This amends ADR-0014 §10 and needs a release-gate check.

## 5. Bulk rejection audit de-identification

`report_bulk_rejection_targets` is append-only by trigger. Proposed, following ADR-0007's own redaction pattern
("the only permitted update … one-way … only towards NULL"): a forward migration rebuilds the table so `report_id`
and `received_at` become nullable and adds `erased_at`; a trigger allows exactly one update per row, setting those two
columns to NULL and `erased_at`, and refuses every other update, delete or replacement. What survives: operation id,
prior state/decision metadata (no reporter content), and the header's `target_count`, so "40 targets, 1 erased" stays
provable. The plan digest stays verifiable for the header; per-target replay of an erased row is intentionally lost.
The same one-way NULLing applies to `report_review_evidence.report_id` and to IDs inside `report_reviews` text columns
(replaced by a fixed `erased` marker so counts and decision versions survive).

## 6. Verification of the requester

Facts: there are no accounts; after 90-day minimization nothing links a report to a submitter; the receipt digest is
`SHA-256(prefix ‖ keyId ‖ idempotencyKey)`.

| Option | Proof | Gaps |
| --- | --- | --- |
| V1 report ID only | none (IDs are shown to the submitter and may leak) | third party can erase someone's report — **rejected** |
| V2 report ID + idempotency key (+ key id) | maintainer CLI recomputes the receipt digest for that report; a match proves possession of the draft's secret without storing anything new | the iPhone client discards the key after success today; it must keep it per report (Lane 4 client change, not in this lane). Sending a secret by e-mail exposes it to the mailbox; it authorizes only this one report and is consumed by the erase |
| V3 in-app request signed by the same App Attest key | strongest, no secret in e-mail | new public endpoint and protocol; larger review; out of scope for a maintainer-only path |

Proposed: V2 for the CLI path, V3 as a later option. Before the client keeps keys, only requests that can present
them are verifiable; the rest get option A-equivalent treatment (early minimization) or are refused — §7 D6.

## 6a. Invariants (to be enforced in SQL when implemented)

- No row of `report_idempotency` is active (`retired_at IS NULL`) without its report; an erased tombstone has
  `report_id IS NULL AND request_sha256 IS NULL AND erased_at IS NOT NULL`; transitions only active → retired → erased
  or active → erased; tombstone delete only after `expires_at`, only by the retention pass.
- No erased report ID survives in REPORTS_DB except as NULL/marker; the erasure audit stores no report identifier.
- An erased report is never counted as evidence in DATA_DB after its withdrawal is imported; promotion refuses a
  canonical DB missing a known withdrawal.
- Migrations stay forward-only; 0004's lesson applies (plain boolean trigger conditions, D1 client split test).

## 7. Decisions required (not made here)

| # | Decision | Owner | Blocks |
| --- | --- | --- | --- |
| D1 | Adopt option B formally (terms §8 text, §4.1 "irrevocable" wording) | maintainer + legal | everything in §4 |
| D2 | Tombstone retention *R* and its legal basis; whether the existing permanent tombstones of minimized receipts (accepted 2026-10-13) also get *R* | legal | migration 0007 receipt columns |
| D3 | Whether an orphaned random report ID in DATA_DB evidence/ledger (no content, no link after erase) is acceptable retention, or must also be de-identified (requires an artifact-format change) | legal | §4 DATA_DB |
| D4 | Backup windows (D1 Time Travel, offline exports) as a documented erase exception and their maximum age | legal + operations | privacy policy text |
| D5 | Held spot's published coordinate originating from the withdrawn report: keep internally, clear, or re-review only | maintainer | §4 |
| D6 | Requester verification V2 adoption, the client change to retain keys, and treatment of unverifiable requests | maintainer + Lane 4 | §6 |
| D7 | Whether erase is offered after 90-day minimization (only a skeleton remains) | maintainer | CLI scope |

## 8. Migration 0007 — needed, not written

Required once D2/D3 are decided: rebuild `report_idempotency` (nullable `report_id`, `erased_at`, `expires_at`,
transition triggers), rebuild `report_bulk_rejection_targets` and `report_review_evidence` for one-way NULLing, add the
erasure audit and withdrawal ledger tables. SQLite cannot drop a FK in place, so each rebuild is create-copy-swap in
one migration, with the 0003 recovery-tool prefix rule respected. DATA_DB needs its own forward migration for the
withdrawal ledger and the guard conditions.

## 9. Test plan (for the implementation PR)

First erase; repeated erase (no-op, no second audit row); retry before/after erase (`200` → `410`); retry by another
key; tombstone expiry boundary; concurrent retry vs erase (both orders); erase vs retention batch (both orders); erase
of a minimized report; revoked key retry; erase with moderation decided/queued/exported states; bulk-audit
de-identification keeps counts; refused photo case; injected failure at each batch statement rolls back everything;
withdrawal import, recount, hold and stay-published cases; rollback-then-promotion refusal; migrations 0001→0007 on
an empty and a populated store, and the D1 client split test for the new triggers.

## 10. Safe implementation scope before the decisions

Independent of D1–D7 and not presuming the erase design:

- a **read-only, local-only** impact report (`reports:erasure-impact <reportId>`) listing which references from §1
  exist for a report, printing counts and states only;
- characterization tests that pin today's behaviour (delete refused by the receipt FK and by review evidence), so the
  later migration changes them deliberately.

Nothing else (schema, CLI writes, retention periods, client changes) should land before the decisions.

## 11. Re-audit and option comparison (2026-10-31, `main` `689bfc8`)

Not a decision: the §7 owners still decide. Two facts changed since this ADR was written. The fenced R2 adapter
exists (`src/reports/r2-photo-storage.ts`: a delete overwrites the key with a permanent empty marker), so §3 step 1
("refuse while no adapter can delete photos") can become "queue the photo rows for fenced deletion in the same batch".
And v1.0 ships with photo intake on (product decision 2026-10-31), so a request can arrive from launch day.

What the 90-day ceiling already does without any erase code (`retain`, migration 0010): photos are erased from
`delete_after − 24 h`; report content and `submitter_hash` are redacted at `minimize_after`. Only a content-free
skeleton, the receipt digest and DATA_DB evidence IDs remain after that.

| Topic | Option 1: 90-day ceiling only | Option 2: early minimization on request | Option 3: full erase (§3–§5) |
| --- | --- | --- | --- |
| What is removed on request | Nothing early; everything personal goes by day 90 | Photos fenced-deleted and report content/hash redacted at once, by a one-report variant of the existing `retain` redaction | Option 2 plus the report row, the receipt (tombstone), review evidence links (withdrawal, option B) and audit IDs |
| Code | None | Small: one maintainer CLI command reusing redaction and the photo deletion queue; no schema change | Large: migration 0007 rebuilds, DATA_DB withdrawal ledger, promotion guard, ADR-0014 §10 amendment |
| Kept afterwards | As today | Skeleton row, receipt digest, DATA_DB IDs (as after day 90) | Tombstone for *R* (D2); random IDs in DATA_DB unless D3 says otherwise |
| Requester proof (§6) | Not needed | Report ID **plus** proof of the submitting device (§12.1); report ID alone is not accepted | Same as option 2; V1 alone is rejected because erase is irreversible |
| Abuse | None | A forged request only shortens retention of one report; it cannot read data. Bounded by maintainer handling | A forged request destroys evidence; needs V2 or V3 |
| Effect on published places | None until a review uses the report | A report already in an exported review stays as evidence (its content was never exported) | Withdrawal re-counts evidence; a place may be held (D5) |
| Terms/policy wording | "deleted within 90 days; no earlier deletion promised" | "on request with the report ID, we delete its photos and content early" | "on request we erase the report" with the D4 backup exception |
| Operator effort | None | Minutes per request | Plan/apply per request plus withdrawal import |

Direction (maintainer, 2026-10-31; not a D1 approval): **option 2 is the baseline**, but **an early-minimization
request is never executed on a report ID alone** (V1 stays rejected for option 2 too). Requester proof prefers the
submitting device's App Attest key (§12.1). D2–D3 stay deferred (they only matter for option 3). Still open and **not** decided here: D1
(terms/policy wording, legal), D4 (backup wording, counsel), D6 (the proof method of §12.1 and the support path of
§12.2), D7 (proposed: no handling after day 90, nothing personal is left). Option 3 stays the target for a later
release. Risks left with option 2: IDs in DATA_DB and backup copies are not touched early; a requester without the
device may get no early effect (§12.2); counsel should confirm that the 90-day ceiling plus early minimization meets
APPI requests (L2).

Implementable now without these decisions: the §10 read-only `reports:erasure-impact` report and characterization
tests. Option 2's CLI or endpoint waits for D1/D6.

## 12. Option 2 specification draft (2026-10-31; for D1/D6, not approved)

### 12.1 Requester proof

| Method | How it is checked | Fits |
| --- | --- | --- |
| P1 in-app request with an App Attest assertion (preferred) | The app asks for early minimization of a report it submitted; the Worker verifies an assertion from a registered, unrevoked key (existing `src/attest` path) and recomputes `submitter_hash` from that key ID and `REPORT_SUBMITTER_PEPPER` (`src/reports/create.ts`). A match with the report's stored hash proves the same device install sent it. Nothing new is stored | Attested reports before `minimize_after` (after it, the hash is gone, so P1 cannot match — consistent with D7) |
| P2 report ID + idempotency key (§6 V2) | Maintainer recomputes the receipt digest | Only if the client keeps the key per report (client change; today it discards it) |
| P0 report ID only | — | **Rejected** |

P1 needs a new authenticated endpoint and an app screen ("delete my submission"), which is a public surface and a
Lane-4/App Review item; it is a design, not a commitment. An unattested report (`attestation_status <> 'verified'`)
cannot use P1.

### 12.2 Device change, reinstall or loss

App Attest keys belong to one app install; reinstalling or changing the device loses the key, and nothing else ties
a person to a report (no accounts). Proposed support answer, for the maintainer to decide (D6): we cannot verify the
request, so no early action is taken; the report's photos and content are erased automatically by day 90 at the latest,
and the reply says so. Optional extra (maintainer's call): a moderation-only action — hide the report from review and
fence-delete its photos when the request plausibly concerns a privacy risk visible in the photo, which a maintainer
could take for any report anyway under the review policy, so it is not an identity-based right. Support never asks
for ID documents or the photo itself.

### 12.3 Separated effects

| Part | Early-minimization effect | Notes |
| --- | --- | --- |
| Photos (R2 + `community_evidence_photos`) | Setting `redacted_at` already queues every photo into `community_photo_deletions` and marks it `deleting` (0003 trigger); the existing fenced delete removes the object and leaves the empty marker | The same path the 90-day retention uses; deletion is asynchronous, so the reply promises "within N days" once the cron runs (R5) |
| Report content (`reports`) | The one-report variant of the retention redaction: `note`, pin, `observed_on`, `submitter_hash` set to NULL, `redacted_at` set | Claim enums, type and terms version stay (as after day 90); `community_photo_requests` rows are deleted by the existing trigger |
| Review history (`report_moderation`, `admin_review_audit`, `report_bulk_rejection_targets`, `report_reviews`) | Unchanged | These hold IDs, states and reasons only, no reporter content; removing them is option 3 (§5) |
| Published places (DATA_DB) | Unchanged | Only sanitized, content-free evidence was exported; a report already counted keeps counting. Withdrawal and re-count are option 3 (§4, D5) |


### 12.4 P1 design: App Attest proof (first candidate, 2026-10-31; not approved, not implemented)

Reuses the existing App Attest assertion path (`src/attest`); the sketch below is for review, not a commitment.

1. **Which reports.** The app keeps no list of its own submitted report IDs today (`ReportStorage.swift` keeps only a
   transient photo follow-up). P1 needs the app to remember the report IDs it sent, on the device only, until their
   `minimize_after`. That is an iPhone change and a privacy-label review item (Lane 4).
2. **Challenge.** A new challenge purpose `erasure` (today `purpose IN ('registration','report')`, so this needs a
   REPORTS_DB migration), bound to the key ID, single use, 300 s TTL like `report`.
3. **Assertion.** The client signs the frame `(ERASURE_DOMAIN, challenge, keyId, reportId)` (a new domain string, as
   `reportClientData` does for reports), so a report assertion can never be replayed as an erasure request.
4. **Server checks, all fail closed.** Key registered and not revoked → assertion and counter valid → report exists,
   `redacted_at IS NULL`, and `submitter_hash = submitterHash(attested key input, REPORT_SUBMITTER_PEPPER)`. Any
   mismatch gets the same `404` as an unknown report, so the endpoint does not reveal whether an ID exists.
5. **Effect.** The §12.3 one-report redaction in one D1 batch with the challenge consumption; repeating it is a
   no-op `200`. No new identifier is stored; an aggregate counter only.
6. **Abuse.** Same per-key budget and edge rule as reports (Q3). The effect only shortens retention of the caller's
   own report.
7. **Not covered.** Unattested reports, reinstalled or replaced devices (§12.2), and reports after day 90 (D7).

### 12.5 Final decisions that must be recorded before implementation and before activation

None is made by this ADR. Before an implementation PR: **D6** (P1 as the method; whether P2 is also offered; the
§12.2 support reply), the endpoint and app screen as a public surface (App Review), and the client change in 12.4.1.
Before production activation: **D1** terms and privacy-policy wording (legal, #124), **D4** backup wording
(counsel), **D7**, a staging run of 12.4 on a signed device, and confirmation that photo deletion completes through
the real cron (R5).
