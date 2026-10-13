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
