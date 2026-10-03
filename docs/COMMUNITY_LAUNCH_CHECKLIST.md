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
- [x] Production report path decided and implemented: durable `REPORTS_DB`, sanitized artifact boundary, cut-over
      switches `DB` only (ADR-0014). No longer a maintainer decision.

## B. Activation PR (one small PR; `test/community-activation.test.ts` must pass)

- [ ] `docs/legal/report-terms/<version>.md` created from the candidate; no `MAINTAINER-INPUT`, `DRAFT`, `CANDIDATE`
- [ ] `COMMUNITY_PUBLICATION` = `approved` with version, path, SHA-256, terms URL, approver, date
- [ ] `ReportTerms.documents` lists the version (`isDraft: false`); `Features/Reports/Terms/<version>.md` byte-identical
- [ ] `docs/SOURCES.md` community entry: approved, license, attribution, reviewer/date; candidate block removed
- [ ] `npm run community:status` shows `problems: []`; `make contract`, `make api-validate`, `make apple-validate` pass
- [ ] #124 closed by the maintainer (not by automation)

## C. Pre-launch configuration (per environment)

- [ ] Every canonical migration in `services/api/migrations` applied (currently through `0030_area_approximate_locations.sql`;
      the report store needs `0025_durable_report_store_boundary.sql`). No new migration for activation
- [ ] `REPORTS_DB` created once (`mannerpath-<env>-reports`), its id landed by reviewed PR, `migrations-reports` applied,
      `report_store_meta` reads `mannerpath-reports` / `reports-store.v1`; a Time Travel bookmark recorded
      (`docs/OPERATIONS.md`, "Report store")
- [ ] `REPORT_SUBMITTER_PEPPER` set; App Attest values set (`required`); physical-device run done (#35)
- [ ] Edge rate-limit rule keyed on IP in front of `POST /v1/reports` (ADR-0007 §5; application limits are per key)
- [ ] Retention pass scheduled against REPORTS_DB (`retain`, bounded batches), so the 90-day ceiling holds without
      moderator action
- [ ] App build bundling the approved version released **before** the Worker switches `/v1/config` (the build
      accepts both the draft and the approved version, so no update gap for current users of that build)

## D. Launch (order matters)

0. [ ] Report store first (ADR-0014), per environment: create REPORTS_DB → apply `migrations-reports` → land the
       stable `REPORTS_DB` binding (reviewed PR) → App Attest secrets/config → deploy → verify intake
       (`/v1/config` `reports.available`, one attested report lands in REPORTS_DB, none in `DB`). The canonical `DB`
       stays on its normal blue/green cycle throughout.
1. [ ] Moderation on REPORTS_DB (`reports:moderate --remote …`, maintainer terminal) → `export` sanitized artifacts →
       `import` into the local pipeline (each `imported`; never `conflict`/`stale`/`refused`) → `apply`
2. [ ] Local: `npm run local:migrate` → `npm run community:activate -- --terms-version <version>` →
       `npm run local:pipeline` → `npm run local:quality` (no new failed checks; record community metrics; moderation load from `reports:moderate -- summary`)
3. [ ] `npm run local:export` → review the bundle (community source present, one `report_terms_versions` row,
       no `reports`/notes/hashes/ledger rows) → `npm run local:verify-promotion`
4. [ ] Blue/green per `docs/OPERATIONS.md` step 6 — the cut-over PR changes the `DB` id only; keep blue
5. [ ] Deploy the Worker; smoke: `scripts/smoke.ts --base-url https://<worker-host> --remote --expect-reports appAttest`; `/v1/config`
       `reports.termsVersion` = `<version>`; a community tile shows `MannerPath 利用者報告（審査済み）`; official
       spot count equals the pre-launch quality baseline
6. [ ] Campaign baseline: `npm run community:seed` on the launch quality report's aggregate coverage (seed campaign, #149) — record active P0/P1 areas; their
       `coverageGap` tasks are what `/v1/coverage/tasks` already serves to contributors
7. [ ] First week: daily moderation flow (`docs/OPERATIONS.md`); watch moderation load (`reports:moderate -- summary`,
       `triage-summary`; `communityAcquisitionMetrics` with the report store: `pending`, `oldestPendingHours`, `rejectedRate`)

## E. Rollback ready (before step D.4)

- [ ] Blue database kept; the `DB` `database_id` revert PR is prepared (REPORTS_DB is never reverted)
- [ ] `suspended` PR prepared (one line) — `test/community-activation.test.ts` proves it removes community spots only
- [ ] Owner for "stop accepting reports" (`wrangler secret delete REPORT_APP_ATTEST_APP_ID`) named
