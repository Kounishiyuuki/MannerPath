# Staging verification of the security-hardened write path

Scope: report-store migrations 0003 → 0004 → 0005 → 0006, App Attest registration and assertion, key
revocation, idempotency, the atomic report budget, the registration limiter, retention cleanup and the bulk
reject CLI. This document says what is verified locally, what blocks a staging run, and the exact maintainer
steps once the blockers are resolved.

**Nothing here has been run against Cloudflare.** No staging deploy, remote migration, secret or binding was
created or changed while writing it, and production is out of scope: every command below names
`--env staging`, never `--env production`. Production report intake stays disabled.

## Readiness

| Area | State |
| --- | --- |
| Committed staging config | Mirrors production except for names and IDs; `REPORT_ATTESTATION=required`, `REPORT_REGISTRATION=paused`, no cron, invocation logs off (`test/staging-readiness.test.ts`, `test/deploy-config.test.ts`) |
| Staging resources | Placeholder `database_id`s: deploy and `--remote` fail until a reviewed PR lands real IDs |
| Report-store schema | Locally verified 0001–0006 in order, rollback on a failed migration, fail-closed Worker below 0005 |
| Write path | **Not ready to enable on staging**: blockers B1–B3 below |

## Migration order

The report store (`REPORTS_DB`) is migrated in place and never rebuilt. Order, each step verified before the next:

1. 0001, 0002: `wrangler d1 migrations apply`.
2. 0003: **not** through `migrations apply --remote` (B1). Production's attempt failed atomically on it
   (`services/api/REPORTS_MIGRATION_RECOVERY.md`); a fresh staging store is expected to fail the same way.
3. 0004, 0005, 0006: `wrangler d1 migrations apply` after 0003 is recorded in the ledger. None of them
   uses a conditional expression inside a trigger.
4. Deploy the Worker only after 0005: below 0005 every App Attest and report route answers
   `503 reportStoreUnavailable`, which is safe but not usable. 0006 is used only by the bulk reject CLI.
   Retention needs 0004.

Every migration is forward-only and runs as one transaction. A failed migration leaves its predecessors
applied, records nothing for itself and stops the stream; do not retry blindly or repair by hand, inspect the
ledger and schema read-only first. There is no down migration. A bad Worker is rolled back by redeploying the
previous commit; the migrations are additive and their triggers stay in force, so an older Worker can fail a
write that the newer schema refuses (for a revoked key), but it cannot make that write succeed.

## Blockers

- **B1. 0003 has no staging import path.** `npm run reports:migration` accepts only production, by design.
  Staging needs either that tool extended to an explicit `--env staging` target (same guards: typed
  confirmation, interactive terminal, digest-pinned artifact) or a reviewed alternative. Until then, stop
  after 0002.
- **B2. Staging IDs.** `wrangler d1 create mannerpath-staging` and `mannerpath-staging-reports`, then a
  reviewed PR that relaxes `test/deploy-config.test.ts` for staging only.
- **B3. Registration cannot be enabled.** It requires a `CHALLENGE_RATE_LIMITER` binding (`ratelimits` in
  `wrangler.jsonc`) and measured caps (`docs/OPERATIONS.md` "Registration operations"). Neither is committed;
  choosing them is a maintainer decision. Without registration no device can obtain a key, so the App Attest
  E2E stops at the fail-closed checks.
- Known limits that do not block a staging run: photos stay disabled (no storage adapter); full erase is
  Issue #242; the first staging deploy must confirm that a redeploy keeps secrets (`docs/OPERATIONS.md`).

## Secrets, vars and bindings

| Name | Kind | Where | Required for |
| --- | --- | --- | --- |
| `DB`, `REPORTS_DB` | D1 bindings | `wrangler.jsonc` | Reads; every report route |
| `RAW_ARTIFACTS` | R2 binding | `wrangler.jsonc` | Source checks only |
| `REPORT_ATTESTATION` | var, `required` | `wrangler.jsonc` | Never changed on a remote |
| `REPORT_REGISTRATION` | var, `paused` | `wrangler.jsonc` | `enabled` only after B3 |
| `REPORT_REGISTRATION_MAX_PER_HOUR`, `REPORT_REGISTRATION_MAX_PER_DAY` | var | reviewed PR (B3) | Registration |
| `CHALLENGE_RATE_LIMITER` | `ratelimits` binding | reviewed PR (B3) | Registration and challenges |
| `REPORT_SUBMITTER_PEPPER` | secret | `wrangler secret put` | Reports |
| `RATE_LIMIT_KEY_PEPPER` | secret, never equal to the submitter pepper | `wrangler secret put` | Limiter keying |
| `REPORT_APP_ATTEST_APP_ID`, `REPORT_APP_ATTEST_ENVIRONMENT`, `REPORT_APP_ATTEST_BUNDLE_VERSIONS` | secret | `wrangler secret put` | App Attest |
| `REPORT_RETENTION`, `REPORT_RETENTION_CRON` | var | reviewed PR | Retention automation (`off` committed) |

Secret values are typed interactively by the maintainer; they never appear in the repository, a log, a ticket
or this document.

## Local verification (safe at any time)

From `services/api`, Node 24:

```sh
node --experimental-strip-types --no-warnings --test test/staging-readiness.test.ts
npx wrangler d1 migrations apply REPORTS_DB --env staging --local --persist-to <scratch dir>
npx wrangler d1 migrations list REPORTS_DB --env staging --local --persist-to <scratch dir>   # no migrations to apply
```

`test/staging-readiness.test.ts` covers: staging/production config parity; the Worker answering 503 until 0005
and serving from 0005; and on the fully migrated store registration, report, idempotent retry, concurrent sends
from one key (each stored once or refused `counterNotIncreasing`), the atomic hourly budget under concurrency,
revocation (`403 keyRevoked`, stored reports untouched), a bulk reject plan and apply, and retention monitor
then cleanup until complete. No request writes a log line. The local Wrangler run applies the same files with
workerd's D1. Failure injection with a conflicting object before 0005 left the ledger at 0004, created none
of 0005's objects and did not apply 0006.

## Maintainer steps once B1–B3 are resolved (not run here)

Each step is typed by hand, one at a time, from `services/api`. Stop at the first unexpected output.

```sh
# 0. Read-only: confirm the account and that the staging Worker is the target.
npx wrangler whoami
# 1. Resources (B2), then land their IDs by reviewed PR.
npx wrangler d1 create mannerpath-staging
npx wrangler d1 create mannerpath-staging-reports
# 2. Canonical DB and promotion: docs/OPERATIONS.md steps 2 and 4.
# 3. Report store: 0001+0002, then the reviewed 0003 path (B1), then the rest.
npx wrangler d1 migrations list REPORTS_DB --env staging --remote     # expect only the not-yet-applied files
npx wrangler d1 migrations apply REPORTS_DB --env staging --remote    # after 0003 is in the ledger
npx wrangler d1 migrations list REPORTS_DB --env staging --remote     # expect: no migrations to apply
# 4. Deploy with writes still closed, then set the peppers.
npx wrangler deploy --env staging
npx wrangler secret put REPORT_SUBMITTER_PEPPER --env staging
npx wrangler secret put RATE_LIMIT_KEY_PEPPER --env staging
node --experimental-strip-types --no-warnings scripts/smoke.ts --base-url https://<staging host> --remote --tile <tile> --expect-reports unavailable
# 5. App Attest values for a staging-signed build, then verify the advertised config.
npx wrangler secret put REPORT_APP_ATTEST_APP_ID --env staging
npx wrangler secret put REPORT_APP_ATTEST_ENVIRONMENT --env staging
npx wrangler secret put REPORT_APP_ATTEST_BUNDLE_VERSIONS --env staging
node --experimental-strip-types --no-warnings scripts/smoke.ts --base-url https://<staging host> --remote --tile <tile> --expect-reports appAttest
```

Then on a physical device against staging: register, submit, retry the same draft (same reportId), submit past
the hourly budget (429), revoke the key with the CLI (`403 keyRevoked` at the next challenge; the app
registers a new key), bulk reject the test reports, and run retention in `monitor`. Afterwards set
`REPORT_REGISTRATION` back to `paused` by redeploying the committed config.

Rollback: redeploy the previous commit with `npx wrangler deploy --env staging`; never drop or recreate
`REPORTS_DB`; `npx wrangler delete --env staging` takes the Worker down without touching its databases.
