# Staging verification of the security-hardened write path

Scope: report-store migrations 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009, App Attest registration/assertion,
schema v3 ownership/idempotency/atomic budget, revocation, bulk rejection, retention/overdue detection,
registration pause and challenge limiter. This is readiness for a **separately authorized maintainer run**.
No remote deploy, migration, Secret registration/change or Cloudflare production operation is performed
by this work. Production report intake stays disabled. Do not use real personal reports in a rehearsal.

## Current readiness and remaining blockers

| Area | Repository/local state | Remote state |
| --- | --- | --- |
| Staging config | `required` attestation, `paused` registration, invocation logs off, empty crons; mirrors production behavior | Placeholder D1 IDs: not provisioned/verified here |
| 0003 recovery | Explicit staging support with typed target confirmation, configured UUID, exact digest, interactive writes outside CI | Import parser/acceptance remains unverified; never infer remote success from local |
| 0004/0005/0006/0007/0008/0009 | Normal additive migration stream after the 0003 checkpoint; 0007 adds private-photo deletion attempt diagnostics; 0008 adds bounded admin review audit; 0009 adds the new-spot photo publication gate trigger | Apply only after schema/ledger verification and separate authorization |
| v3 security flows | Worker route handler + local workerd D1 rehearsal and existing SQLite fault/concurrency suites | Real Apple/device, provider limiter and network E2E not run |
| Activation | No cap, limiter binding, IDs, Secret or cron added | Blocked on B1–B4 below |

- **B1 — resources.** A maintainer must provision and review distinct staging `DB`/`REPORTS_DB` IDs;
  `test/deploy-config.test.ts` currently requires placeholders for staging. Never reuse production IDs.
  A completed reviewed DATA_DB promotion is separately needed for remote readiness/read smoke.
- **B2 — abuse controls.** Choose measured registration hour/day success caps and a staging-only
  `CHALLENGE_RATE_LIMITER` binding/namespace/threshold. These are deployment/account decisions, not fixture
  values to copy. New registration stays paused until this is reviewed.
- **B3 — environment-specific Secrets and device.** Separate staging peppers, App ID prefix + bundle ID,
  build allowlist and actual App Attest environment; verify a signed staging-targeted client on device.
  Merely advertising v3 in `/v1/config` does not prove enrollment, counters or report-store migrations work.
- **B4 — operational evidence.** Before intake, verify secret preservation on forward deploy/rollback,
  logging/privacy, limiter failure, retention scheduling/heartbeat and overdue alerts on staging.
  Repository checks do not establish Cloudflare provider logging or remote delivery guarantees.

Issue #242 (full erase versus permanent receipt FK) remains unresolved; this work neither chooses an
alternate privacy policy nor implements full erasure. Photos and community publication stay disabled;
Issue #124 remains separate. Staging smoke success is not production or App Store activation approval.

Admin/PR #322 integration is also on HOLD: Admin and R2 stop access at `delete_after - 24h`, while
the merged new-spot proposal/export predicate and trigger 0009 still use `delete_after`. A separate
additive publication-gate correction must cover early erasure and queued deletion before publication
rehearsal/activation. Applying 0008/0009 alone does not close this finding. See
[local Admin integration notes](LOCAL_MODERATION_ADMIN.md#pr-322-integration-and-early-erasure-finding).

## Staging / production comparison

Named environments repeat their own bindings; do not inherit top-level local `disabled` attestation.

| Requirement | Staging | Production |
| --- | --- | --- |
| Worker | `mannerpath-api-staging` | `mannerpath-api-production` |
| DATA_DB (`DB`) | `mannerpath-staging`, placeholder | `mannerpath-production`, reviewed provisioned ID |
| Durable `REPORTS_DB` | `mannerpath-staging-reports`, placeholder | `mannerpath-production-reports`, reviewed provisioned ID |
| RAW_ARTIFACTS | staging R2 bucket; source checks only | production R2 bucket; source checks only |
| Attestation / registration | `required` / `paused` | `required` / `paused` |
| Logs / crons | invocation logs false / none committed | same |
| Submitter pepper | Separate secret; nonblank, at least 32 UTF-8 bytes. Preserve original bytes for existing hashes | same requirement, separate value |
| Limiter pepper | Separate secret; trim + UTF-8 32-byte minimum; normalized value must differ from submitter pepper | same requirement, separate value |
| App Attest values | Actual staging client App ID/environment/build allowlist, environment-specific secrets | actual shipping App ID, `production` for TestFlight/App Store, exact build allowlist |
| Registration caps / limiter | reviewed staging-only configuration, not yet present | no guessed production values or activation |
| Retention | default off/no schedule; measured maintenance cadence/alerts required before intake | unchanged, separately authorized |

Secret names: `REPORT_SUBMITTER_PEPPER`, `RATE_LIMIT_KEY_PEPPER`, `REPORT_APP_ATTEST_APP_ID`,
`REPORT_APP_ATTEST_ENVIRONMENT`, `REPORT_APP_ATTEST_BUNDLE_VERSIONS`. Use interactive per-environment
Secret entry by a maintainer; never command-line literal values, tracked `.dev.vars`, logs or tickets.
Binding `CHALLENGE_RATE_LIMITER` and vars `REPORT_REGISTRATION_MAX_PER_HOUR`,
`REPORT_REGISTRATION_MAX_PER_DAY`, `REPORT_RETENTION`, `REPORT_RETENTION_CRON` are separate controls.

### App Attest environment matrix

A backend environment is not an App Attest environment. Staging can verify a development-signed
client's `development` attestations or a TestFlight/App Store client's `production` attestations,
but one deployment must explicitly match the actual signed client's environment. Do not guess from
Debug/Release or the word “staging”, accept both environments, or disable verification to make a test pass.
Apple development keys and production keys are not interchangeable. Pin actual App ID prefix +
bundle ID and CFBundleVersion; a staging-targeted build/origin is Lane 3/Apple work, not changed here.
The local rehearsal uses generated test certificates and an injected test root, never real Apple keys
or a new production trust root. It proves handler/SQL semantics, not Apple's service or device behavior.

## Migration order and fail-closed recovery

REPORTS_DB is durable and migrated in place. A canonical cutover changes `DB` only; never rebuild,
replace or switch REPORTS_DB to recover. Never modify already applied migration bytes.

1. Inspect exact target, ledger, schema and FK state read-only. Apply 0001/0002 only to an authorized fresh
   staging report store. Use a reviewed temporary config/migration directory containing those two files;
   normal `migrations apply` against the full stream would also attempt 0003. Do not mutate the tracked config.
2. If 0003 is pending and the store is exactly 0001+0002, prepare/review the exact import artifact.
   The narrow recovery tool accepts explicit `--env staging --database-id <reviewed-staging-reports-uuid>
   --confirm-staging mannerpath-staging-reports`. It refuses placeholders, canonical/production IDs,
   shared IDs, cross-environment confirmations, changed bytes/digest and noninteractive remote apply/CI.
3. Verify the **0003-only checkpoint** with the recovery verifier immediately after import. Expected ledger:
   exactly 0001–0003. Any partial/mismatched state or transport failure: STOP, investigate read-only; never
   blindly replay. A completed import is not replayed even after a lost response.
4. Then apply normal 0004 (idempotency/atomic budget), 0005 (key revocation), 0006 (bulk audit),
   0007 (photo deletion attempts), 0008 (admin review audit), 0009 (new-spot photo gate) in order.
   Verify full ledger, FK checks and tested constraints. The 0003 verifier deliberately refuses the later
   full schema; use the migration ledger and full-stream checks at this point. It must not be called as a
   post-full-stream verifier. See [recovery runbook](../services/api/REPORTS_MIGRATION_RECOVERY.md).
5. Deploy the Worker only after 0005 for App Attest/report routes. Below it, routes fail closed with
   `503 reportStoreUnavailable`. Bulk rejection needs 0006; retention receipt cleanup needs 0004;
   photo cleanup needs 0007; the optional loopback Admin requires 0008 and fails closed without it.
   Exporting a new-spot review needs 0009 (code checks the same gate first).
   This does not authorize remote migration or moderation writes. Photo storage/consent/scheduler remain disabled; see
   [PHOTO_STORAGE_OPERATIONS](PHOTO_STORAGE_OPERATIONS.md).

The repository's 0003 bytes pass local SQLite/workerd, but a historical remote `/query` parser failure
requires the reviewed file-import path for an affected remote store. This is not proof every remote
store is currently broken. Failed migration/import must leave its schema/ledger unchanged; preserve the
predecessor checkpoint and diagnose rather than dropping objects. No down migration is required.
Rollback a Worker with a reviewed known-good deployment, keeping REPORTS_DB and additive triggers.
Older code may fail newer guarded writes; rollback must never weaken revocation or receipt protection.

## Safe local verification

Node 24.21.0, from `services/api`:

```sh
node --experimental-strip-types --experimental-sqlite --no-warnings --test \
  test/staging-readiness.test.ts test/staging-local-d1.test.ts \
  test/reports-migration-import.test.ts test/staging-security-smoke.test.ts
```

The new local D1 test creates only its own temporary config/storage, forces `--local` and
`remoteBindings:false`, rehearses 0001/0002 → exact 0003 import → 0004–0009, checks ledger/FKs and
uses the real workerd D1 binding from the Node-executed Worker route handler. It does **not** run the
complete deployed Worker/edge stack or Cloudflare remote D1. Generated PKI and low test budgets are
synthetic and do not authorize staging values. SQL-trigger failure and batch rollback are checked locally.
Existing suites also cover ownership, canonicalization/consent vectors, challenges/counters, concurrent
budget admission, migration rollback, maintenance boundedness, bulk races and retention-first/retry-first.

## GET-only staging smoke

Unlike generic `local:smoke`, this probe sends **no POST at all**. Default target is loopback, reports
unavailable. It validates readiness/config/cache protection and emits fixed check names/status only,
never response bodies, secrets, IDs, IPs or HMACs. HTTP timeout is 10 seconds per GET; JSON is bounded
at 8 KiB with cancellation. Redirects are refused.

```sh
npm run --silent staging:security-smoke
# Future maintainer GET-only probe, only after B1 is resolved and promotion is completed:
npm run --silent staging:security-smoke -- \
  --base-url https://mannerpath-api-staging.<account-subdomain>.workers.dev \
  --confirm-staging mannerpath-api-staging --expect-reports unavailable
# After separate reviewed staging activation, require precisely App Attest schema 3..3:
npm run --silent staging:security-smoke -- \
  --base-url https://mannerpath-api-staging.<account-subdomain>.workers.dev \
  --confirm-staging mannerpath-api-staging --expect-reports v3
```

Only loopback and explicitly confirmed staging `workers.dev` origins are accepted; production,
credentials/query/path, unknown flags and custom domains are refused. Custom-domain edge-cache checks
(ADR-0019) use a separately reviewed maintainer probe; workers.dev smoke cannot prove actual edge caching.
The output always says `writePath: UNVERIFIED`. Config does not prove store health, limiter availability,
registration availability or signed write acceptance. Do not count GET smoke as a report E2E pass.

## Future maintainer deployment sequence — NOT EXECUTED

Every write/Secret/deploy below requires separate authorization; none is a command for CI. Use only
reviewed staging resources and a staging-targeted client. Stop at the first unexpected result.

1. Confirm account, Worker name, environment and distinct IDs without logging credentials; review B1/B2
   configuration. Stage only 0001/0002 for a new report store, use the guarded 0003 import sequence above,
   then apply 0004–0009. Complete reviewed canonical promotion separately. Do not copy production data.
2. Deploy staging with registration paused, retention off and no App Attest activation Secrets. Readiness
   must be complete and GET-only smoke must say unavailable. Verify no invocation/request-body logging.
3. A maintainer sets separate staging peppers and actual client App Attest values interactively; validates
   caps/limiter and then separately enables registration on staging. Use a reviewed environment config,
   never global `REPORT_ATTESTATION=disabled` or a top-level local fallback. Verify v3 GET-only smoke.
4. Perform the signed-device matrix below with synthetic report drafts. Never use production API/client
   origin, device histories or personal free text. Keep assertions/challenges/key IDs private and ephemeral.
5. Validate retention monitoring/cleanup and aggregate overdue/failed/heartbeat alerts before leaving
   intake enabled. Restore registration paused and the approved retention policy; review whether all
   report intake must be closed. **Registration pause alone does not close reports from existing keys.**
   Use the documented removal of staging App Attest activation binding for complete intake shutdown.
6. Test forward redeploy/rollback Secret preservation and reverify config/behavior. Code rollback alone
   must not be assumed to preserve Secrets. Never delete/recreate REPORTS_DB or roll back its schema.

| Signed staging/device scenario | Expected behavior / evidence | Current remote result |
| --- | --- | --- |
| Actual signed client register/report | Matching App ID/environment/build; challenge one-use and 300s TTL, 201 enrollment/report | NOT RUN |
| Response loss / retry | Same owner/draft key + same payload; fresh challenge/assertion; 200 same receipt/report, no second budget debit | NOT RUN |
| Changed payload / different App Attest owner | 409 for same owner's changed draft; another key cannot retrieve old receipt; never auto-resign old draft after rotation | NOT RUN |
| Retired receipt | Cleanup then owned retry → 410, no resurrected report/budget debit | NOT RUN |
| Atomic budget / 429 | Concurrent valid sends cannot exceed the final slot; Retry-After respected; fresh material for explicit retry | NOT RUN |
| Pause / limiter outage | New registration paused; existing-key reports separate. Throwing/malformed limiter → 503 before body/DB, denied bucket → 429, no PII logs | NOT RUN |
| Revoke / bulk reject | Revoke key → 403; old reports remain. Private bounded bulk dry-run/confirmed apply → reject+audit once; no canonical publication/revoke from bulk | NOT RUN |
| Cleanup / overdue / concurrent retry | Bounded cleanup, retired receipts, monitor read-only aggregate overdue; races yield legitimate 200-before-cleanup or 410-after, never duplicate/report resurrection | NOT RUN |
| Rollback / cross-environment isolation | Staging deploys/Secrets/DB IDs stay separate; reports store stable, no production change | NOT RUN |

Primary runtime semantics: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[environment Secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Workers limiter binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
Local tests do not replace remote/device evidence for these services.
