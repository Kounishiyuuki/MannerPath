# Community launch checklist (Issue #124, Issue #150)

The one checklist for starting community publication. Every box is ticked in the activation PR description or the
deployment record, with evidence (command + decisive output line). Nothing here is done by this repository on its
own: an unticked maintainer item means **HOLD**.

Context: `docs/legal/COMMUNITY_PUBLICATION_DECISION.md` (what is approved), `docs/OPERATIONS.md` (how it runs).

## A. Maintainer decisions (Issue #124)

- [ ] Terms: APPROVE / HOLD / CHANGE recorded on #124 (and whether counsel reviewed it)
- [ ] Operator name, public contact point, governing law/jurisdiction, public terms URL supplied
- [ ] Third-party / commercial reuse (terms §4.2) decided
- [ ] Withdrawal option (A / B / C) chosen; terms §8 worded accordingly
- [ ] Production report path decided: how live reports reach moderation and survive a blue/green cut-over
      (`docs/OPERATIONS.md`, Community publication — open prerequisite). **Engineering follow-up required; launch
      cannot proceed on the legal approval alone.**

## B. Activation PR (one small PR; `test/community-activation.test.ts` must pass)

- [ ] `docs/legal/report-terms/<version>.md` created from the candidate; no `MAINTAINER-INPUT`, `DRAFT`, `CANDIDATE`
- [ ] `COMMUNITY_PUBLICATION` = `approved` with version, path, SHA-256, terms URL, approver, date
- [ ] `ReportTerms.documents` lists the version (`isDraft: false`); `Features/Reports/Terms/<version>.md` byte-identical
- [ ] `docs/SOURCES.md` community entry: approved, license, attribution, reviewer/date; candidate block removed
- [ ] `npm run community:status` shows `problems: []`; `make contract`, `make api-validate`, `make apple-validate` pass
- [ ] #124 closed by the maintainer (not by automation)

## C. Pre-launch configuration (per environment)

- [ ] Migrations through `0024_community_acquisition.sql` applied (no new migration is needed for activation)
- [ ] `REPORT_SUBMITTER_PEPPER` set; App Attest values set (`required`); physical-device run done (#35)
- [ ] Edge rate-limit rule keyed on IP in front of `POST /v1/reports` (ADR-0007 §5; application limits are per key)
- [ ] Retention pass scheduled (`retain`), so the 90-day ceiling holds without moderator action
- [ ] App build bundling the approved version released **before** the Worker switches `/v1/config` (the build
      accepts both the draft and the approved version, so no update gap for current users of that build)

## D. Launch (order matters)

1. [ ] Local: `npm run local:migrate` → `npm run community:activate -- --terms-version <version>` →
       `npm run local:pipeline` → `npm run local:quality` (no new failed checks; record community + moderation metrics)
2. [ ] `npm run local:export` → review the bundle (community source present, one `report_terms_versions` row,
       no `reports`/notes/hashes) → `npm run local:verify-promotion`
3. [ ] Blue/green per `docs/OPERATIONS.md` step 6; keep blue
4. [ ] Deploy the Worker; smoke: `scripts/smoke.ts --base-url https://<worker-host> --remote --expect-reports appAttest`; `/v1/config`
       `reports.termsVersion` = `<version>`; a community tile shows `MannerPath 利用者報告（審査済み）`; official
       spot count equals the pre-launch quality baseline
5. [ ] First week: daily moderation flow (`docs/OPERATIONS.md`); watch `communityAcquisition.moderation`
       (`pending`, `oldestPendingHours`, `rejectedRate`, `duplicateRate`, `abuseRejections`)

## E. Rollback ready (before step D.3)

- [ ] Blue database kept; the `database_id` revert PR is prepared
- [ ] `suspended` PR prepared (one line) — `test/community-activation.test.ts` proves it removes community spots only
- [ ] Owner for "stop accepting reports" (`wrangler secret delete REPORT_APP_ATTEST_APP_ID`) named
