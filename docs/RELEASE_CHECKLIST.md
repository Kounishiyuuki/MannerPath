# v1 backend release checklist (App Store, October 2026)

The backend half of the v1 release: what must hold, what was verified, and the production steps a maintainer runs.
Nothing in this repository deploys or writes a remote database; every remote step below is the maintainer's, under
review. Apple UI and data ingestion have their own owners; this file covers backend, release policy and deployment.

Release policy: `PRODUCT_REQUIREMENTS.md` §10 and `NATIONWIDE_DATA_STRATEGY.md` §6. v1 is gated on nationwide behavior,
honest empty/coverage states and evidence integrity; coverage targets are measured continuously and are not release
blockers.

## 1. Readiness (audited 2026-10-03 against `main` f534778)

| Area | Status | Evidence |
| --- | --- | --- |
| Canonical migrations (`migrations/`, 0001–0030) | READY | fresh and populated-pre-0030 local D1 migrations, integrity and FK checks, trigger compile checks (#164) |
| D1 blue/green | READY | `OPERATIONS.md` step 6–7; promotion targets an empty database; cut-over changes the `DB` id only |
| REPORTS_DB (durable report store) | READY | ADR-0014; separate stream `migrations-reports`; never switched by a cut-over |
| Report retention | READY (manual) | `reports:moderate -- --remote … retain`, bounded batches; must run daily once intake is on (§4 P1) |
| Report moderation | READY | `reports:moderate` against REPORTS_DB; sanitized artifact is the only path into canonical data |
| Promotion v4 | READY (fixed) | on the 6-source corpus: build → verify → apply-local, and prepare-import → verify-import-plan → the plan's files applied with `wrangler d1 execute --local` to an empty migrated D1 (513 published, sealed). The `apply-local` CLI crash on Node 24 is fixed and covered by `test/promotion-v4-cli.test.ts` |
| Tile publication | READY | 513 published spots from 6 approved sources locally; every quality check passes |
| `/v1/config` | READY | tile 1..2, spotDetail 1..1, report range; `reports.available: false` until App Attest is configured |
| Schema / version compatibility | READY | `minimumSupportedSchemaVersions` ≤ `schemaVersions`; pre-ADR-0015 clients keep z14 v1 tiles |
| Rollback | READY | `DB` `database_id` revert (blue kept), `wrangler rollback` for code, report intake stop by removing `REPORT_APP_ATTEST_APP_ID` |
| Smoke test | READY | `scripts/smoke.ts`: 8/8 locally against the 6-source corpus (config, tile 200/304/404, detail, attribution, report gate) |
| Empty regions | READY | an unpublished tile is `404 tileNotPublished`, cached by the client as empty (`docs/API.md`) |
| Edge rate limit | WAITING_FOR_DEVELOPER_PROGRAM (with report intake) | IP-keyed Cloudflare rule on `POST /v1/reports` and `/v1/app-attest/*` before App Attest values are set (ADR-0007 §5) |
| Community publication (#124) | technically READY; not activated | WAITING_FOR_MAINTAINER_INPUT (`docs/legal/COMMUNITY_PUBLICATION_DECISION.md` §0) |

**v1 without report intake is a valid release.** With `REPORT_ATTESTATION=required` and no App Attest values, the
report endpoints answer `503 attestationUnavailable`, `/v1/config` says `reports.available: false`, the app hides
reporting, and the smoke check treats `503` as a pass. Read-only nationwide discovery needs none of the
Apple-Developer-Program items below.

## 2. Production configuration

| Name | Kind | Where | Required for |
| --- | --- | --- | --- |
| `DB` → `mannerpath-production` | D1 binding | `wrangler.jsonc` `env.production` (real `database_id` lands by reviewed PR) | launch |
| `REPORTS_DB` → `mannerpath-production-reports` | D1 binding | same (created once, never switched) | launch (empty until intake) |
| `RAW_ARTIFACTS` → `mannerpath-raw-artifacts-production` | R2 binding | same | source checks (crons stay `[]`) |
| `REPORT_ATTESTATION` | var, committed | `required` | launch (do not change) |
| `REPORT_SUBMITTER_PEPPER` | secret | `wrangler secret put … --env production` (32+ random bytes) | report intake |
| `REPORT_APP_ATTEST_APP_ID` | secret | `<App ID prefix>.<bundle id>` | report intake (Developer Program) |
| `REPORT_APP_ATTEST_ENVIRONMENT` | secret | `production` for TestFlight/App Store | report intake (Developer Program) |
| `REPORT_APP_ATTEST_BUNDLE_VERSIONS` | secret | exact `CFBundleVersion` list in users' hands | report intake (Developer Program) |
| `MANNERPATH_API_BASE_URL` | Xcode build setting (uncommitted xcconfig) | HTTPS origin of the production Worker | app build |

Invocation logs stay disabled (`test/deploy-config.test.ts`); no other variable or secret exists.

## 3. Production launch steps (maintainer)

1. `npx wrangler d1 create mannerpath-production` and `mannerpath-production-reports`; land both ids in a reviewed PR
   (relax the placeholder assertion for that environment in the same PR).
2. `npx wrangler d1 migrations apply DB --env production --remote`; `… REPORTS_DB --env production --remote`; both
   `migrations list` show nothing pending.
3. Locally: `npm run local:migrate`, `npm run local:pipeline -- <source>` for every reviewed source, `npm run
   local:quality` (no failed check; record the coverage numbers as the launch baseline).
4. `npm run promotion:v4:build -- --database <local sqlite> --dir <bundle> --chunk-bytes 4194304`; record the
   `wholeBundleSha256` in the review; `promotion:v4:verify` and `promotion:v4:apply-local` into a new file must
   complete (`SEGMENTED_PROMOTION_RUNBOOK.md`); then `promotion:v4:prepare-import` for the remote import plan.
5. Apply the import plan to the empty production database (`SEGMENTED_PROMOTION_RUNBOOK.md`, one reviewed file at a
   time); `promotionReadiness` must report completed.
6. `npx wrangler deploy --env production`.
7. `scripts/smoke.ts --base-url https://<production host> --remote --tile <a published tile>`: all checks pass,
   report gate `503` (intake off).
8. Point the release build's `MANNERPATH_API_BASE_URL` at the production origin.

Later data updates are blue/green (`OPERATIONS.md` step 6); keep the previous database until the new one has settled.

## 4. Open items

**Remaining P0:** none.

**Remaining P1**
- Before report intake is enabled: schedule the daily retention pass against production REPORTS_DB (maintainer
  terminal, `reports:moderate … retain`) so the 90-day ceiling holds; there is no automated remote retention.
- Before report intake is enabled: the IP-keyed edge rate-limit rule (above).

**WAITING_FOR_DEVELOPER_PROGRAM**
- App Attest values for production and the physical-device register/assert/report run (#35).
- Signed archive, App Group provisioning, physical iPhone/Watch/widget E2E, TestFlight.
- Enabling report intake (needs App Attest), and with it the edge rate-limit rule and retention schedule.

**WAITING_FOR_MAINTAINER_INPUT**
- Community publication (#124): terms APPROVE/HOLD/CHANGE, operator, contact, terms URL, governing law, §4.2 reuse,
  §8 withdrawal option, §10 liability wording, attribution. Until then `COMMUNITY_PUBLICATION` stays `pending`.
- Production Cloudflare account ownership and the two production database ids (step 1).
