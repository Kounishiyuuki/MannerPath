# v1 backend release checklist (App Store, October 2026)

The backend half of the v1 release: what must hold, what was verified, and the production steps a maintainer runs.
Nothing in this repository deploys or writes a remote database; every remote step below is the maintainer's, under
review. Apple UI and data ingestion have their own owners; this file covers backend, release policy and deployment.

Release policy: `PRODUCT_REQUIREMENTS.md` §10 and `NATIONWIDE_DATA_STRATEGY.md` §6. v1 is gated on nationwide behavior,
honest empty/coverage states and evidence integrity; coverage targets are measured continuously and are not release
blockers.

## 1. Readiness (audited 2026-10-03 against `main` f534778; production preflight re-checked against aab8305; release candidate re-verified against d511f1a on 2026-10-04)

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
| Production preflight | READY | `npm run release:preflight` (local, read-only): committed env safety, real/distinct/unshared ids, import plan against both reviewed digests, then the ordered launch and rollback commands (`test/release-preflight.test.ts`) |
| Read-only v1, reports off | READY | `wrangler dev --env production` with no secrets: `/v1/reports`, `/v1/app-attest/*` `503 attestationUnavailable`; photos `503 photoEvidenceDisabled`; writes to read routes `404`; reads `200` |
| Empty regions | READY | an unpublished tile is `404 tileNotPublished`, cached by the client as empty (`docs/API.md`) |
| Edge rate limit | WAITING_FOR_DEVELOPER_PROGRAM (with report intake) | IP-keyed Cloudflare rule on `POST /v1/reports` and `/v1/app-attest/*` before App Attest values are set (ADR-0007 §5) |
| Community publication (#124) | technically READY; not activated | WAITING_FOR_MAINTAINER_INPUT (`docs/legal/COMMUNITY_PUBLICATION_DECISION.md` §0) |

**v1 without report intake is a valid release.** With `REPORT_ATTESTATION=required` and no App Attest values, the
report endpoints answer `503 attestationUnavailable`, `/v1/config` says `reports.available: false`, the app hides
reporting, and the smoke check treats `503` as a pass. Read-only nationwide discovery needs none of the
Apple-Developer-Program items below.

Privacy submission gate: the [2026-10-05 production audit](PRODUCTION_PRIVACY_AUDIT.md) confirms repository
settings and authenticated inventory. The configured production Worker and production-named D1 resources
are absent in the audited account; R2 reports not enabled. Logpush returned 403; analytics, retention and
eventual live report/auth gates remain UNKNOWN. Complete its maintainer checks before deployment/privacy signoff;
local readiness above does not establish a production deployment or permit “Data Not Collected”.

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
| `MANNERPATH_PUBLIC_SITE_URL` | Xcode build setting, committed for Release (Debug unset) | `https://kounishiyuuki.github.io/MannerPath/` (`docs/PUBLIC_SITE.md`); empty hides the Privacy Policy/Support links | app build |

Invocation logs stay disabled (`test/deploy-config.test.ts`); no other variable or secret exists.

## 3. Production launch steps (maintainer)

Read-only v1 needs the canonical `DB` with data and a migrated, empty `REPORTS_DB` (the binding is part of the
committed environment; report routes stay `503`). Steps 1–4 are local; `release:preflight` then prints the remote
steps with every path, digest and expected value filled in, and opens no connection.

1. Create both databases and land their ids (the only Cloudflare values the repository needs):
   `npx wrangler d1 create mannerpath-production` and `npx wrangler d1 create mannerpath-production-reports`, plus the
   bound R2 bucket `npx wrangler r2 bucket create mannerpath-raw-artifacts-production` (the preflight also prints it;
   `wrangler deploy` fails if a bound bucket does not exist). Land both
   `database_id`s in `env.production` of `services/api/wrangler.jsonc` in one reviewed PR, relaxing
   `test/deploy-config.test.ts`'s placeholder assertion for `production` only in the same PR. Before opening it:
   `npm run release:preflight -- --env production --plan-dir <plan> --expected-digest <d> --expected-plan-digest <pd>
   --pre-landing --database-id <uuid> --reports-database-id <uuid>`.
2. Locally, from a fresh state: `npm run local:migrate`, `npm run local:pipeline -- <source>` for every reviewed source,
   `npm run local:quality` — no failed check; record `nationwide.publishedSpots` and the coverage fields as the launch
   baseline in the deployment record.
3. `npm run promotion:v4:build -- --database <local sqlite> --dir <bundle> --chunk-bytes 4194304`; a second person
   records `wholeBundleSha256` in the review; `promotion:v4:verify` and `promotion:v4:apply-local` into a new file
   must complete; `promotion:v4:prepare-import -- --dir <bundle> --expected-digest <d> --out <plan>`; the reviewer
   records `wholePlanSha256`.
4. After the ids have landed: `npm run release:preflight -- --env production --plan-dir <plan> --expected-digest <d>
   --expected-plan-digest <pd> --worker-host <production host>` must print `PREFLIGHT OK`.
5. Run the printed launch commands top to bottom in the maintainer terminal; each `# expect:` must match before the
   next line: migrate `DB` and `REPORTS_DB` (nothing pending) → `initialize.sql` → manifest digest = reviewed digest
   → each chunk after its `next_chunk` check → re-verify the plan → `finalize.sql` → sealed = 1 → `wrangler deploy
   --env production` → remote smoke (readiness `completed`, every check ok, report gate `503`).
6. Point the release build's `MANNERPATH_API_BASE_URL` at the production origin (HTTPS).

The printed sequence was executed end to end against local D1 (`--local --persist-to`) and served with
`wrangler dev --env production`: readiness `completed`, smoke 8/8, empty region `404 tileNotPublished`.

Later data updates are blue/green (`OPERATIONS.md` step 6); keep the previous database until the new one has settled.

### Rollback order

1. Bad Worker code: `npx wrangler rollback --env production` (data untouched), then remote smoke.
2. Bad data after a later blue/green release: restore the previous `DB` `database_id` (reviewed PR) →
   `npx wrangler deploy --env production` → remote smoke. **This is safe only while the previous database has the
   schema the running Worker reads.** If the release also added a canonical migration the Worker depends on, roll the
   Worker back to the version that served that database as well (`wrangler rollback`), or apply the new migration to
   it first; never serve a database older than the code's schema.
3. First launch (no previous database): `npx wrangler delete --env production` takes the API down; the databases are
   kept; the app falls back to its cached tiles.
4. `REPORTS_DB` is never part of a rollback (ADR-0014).

## 4. Open items

**Release freeze (2026-10-04, release candidate on d511f1a).** Backend code is frozen for v1: no new architecture,
features or data sources. Only P0 fixes and small, local P1 fixes land before submission. The read-only v1 release
needs no secret and no Developer Program item; backend provisioning waits on the production Cloudflare
values (§2, §3 step 1). App Store submission also requires the production privacy evidence/signoff above.

**Remaining P0:** none.

**P1 before App Store submission (backend):** none open. Fixed in the release candidate: the preflight and §3 now
create the bound R2 bucket, without which `wrangler deploy` fails.

**Remaining P1 (before report intake only; read-only v1 does not need them)**
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
- The production Worker host (`--worker-host`, and the app's `MANNERPATH_API_BASE_URL`).

**P2 (recorded, not fixed)**
- Read-only v1 still needs `REPORTS_DB` created and migrated, because the binding is committed; the Worker itself
  already serves reads without it (report routes `503 reportStoreUnavailable`).
- A missing `--chunk-bytes` on `promotion:v4:build` reports the generic "invalid chunk byte budget".
- `/v1/config` advertises report schema `2..2` / `appAttest` while `available: false`; clients gate on `available`.

## Authenticated privacy release gate (2026-10-05)

- [ ] Confirm intended Cloudflare account and signed release API origin; configured production Worker is absent.
- [ ] Separately authorize resource provisioning/deployment after production D1/R2 inventory and reviewed IDs/preflight; never reuse E2E resources by assumption.
- [ ] Obtain read-only Logpush/analytics/retention evidence and sanitized IP/UA/path/time/request-ID field assessment; resolve prohibited location history.
- [ ] Verify deployed version/settings, config false/false, unavailable report/auth intake, photos off, no community activation and empty crons; no mutating audit probes.
- [x] Correct repository policy §2 live-server/logging wording in both languages (2026-10-05).
- [ ] Verify merged Pages workflow and live bilingual policy date/§2/contact/links.
- [ ] Reconcile provider/support retention in the policy after deployment evidence.
- [ ] Close audit's UNKNOWN Privacy Label categories; match Photos/Crash source conclusions to archive; owner signs ASC answers.

These checks remain submission blockers. Merging this documentation closes no submission gate and authorizes no Cloudflare mutation.

#179 incorporated from main `7d8cbab0ba28bc28eb17a56546f7f97b158b3841`:
Release public-site origin `https://kounishiyuuki.github.io/MannerPath/`, privacy/ and support/ navigation,
Debug empty origin and `mannerpath.support@gmail.com` contact are confirmed. Do not reopen link-reachability
as a blocker; signed distribution evidence and mail delivery remain separate.

Next provisioning lane: separately authorize R2 enablement, canonical D1 `mannerpath-production`, durable
D1 `mannerpath-production-reports` and R2 `mannerpath-raw-artifacts-production` creation; review distinct IDs
and production-only safety-test updates, remote migrations/canonical promotion, then Worker deployment.
Keep required attestation, reports/auth unavailable, photos off, crons empty and community inactive.
Repository policy wording corrections and revision dates updated 2026-10-05; Pages publication must be verified; evidence-dependent §2/§5/§9 details remain in the
[audit handoff](PRODUCTION_PRIVACY_AUDIT.md).
