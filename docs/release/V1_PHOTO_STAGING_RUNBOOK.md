# v1.0 photo staging — preparation and operator runbook

Status: **PREPARATION ONLY / remote NOT RUN**. Audit baseline: main `eb4ed96` (2026-10-23).
This document does not authorize Cloudflare reads or writes. Resource creation, Secrets, migrations,
deploy, intake enablement, fault injection and teardown each require the operator's separate approval.
Do not run the remote commands during preparation. Production intake remains disabled.

## Audit and boundaries

| Item | Repository finding | Required before remote execution |
| --- | --- | --- |
| Normal staging | `wrangler.jsonc`: placeholder DB/REPORTS_DB, required App Attest, registration paused, no photo binding or cron | Approved staging-only resource manifest |
| Production | Real D1 IDs and raw-artifact bucket are committed; registration paused; no photo binding/activation | **No changes in this runbook**; do not use default config or `--env production` |
| Admin | On main (#321); photo IDs obtained from report detail; preview before approval; loopback server | TTY, scoped operator credentials, reviewed report UUID/bucket, 0008 audit schema |
| Photo intake | `REVIEWED_PHOTO_TERMS=[]` in `photo-policy.ts` | Separate exact-version consent approval and matching iPhone terms; flags alone cannot enable it |
| Publication | `COMMUNITY_PUBLICATION` pending, community source blocked | Keep blocked; successful negative gate is the staging objective, not publication authorization |
| REPORTS_DB | 0003 has a known remote parser failure | Staged import checkpoint below; never blindly apply the full stream to an empty store |

Use the separate Worker `mannerpath-api-photo-staging`, canonical D1 `mannerpath-photo-staging`,
durable D1 `mannerpath-staging-reports`, private R2 `mannerpath-photo-staging-private`.
If any name already exists, STOP: inspect its ownership and data with separate read authorization;
never reuse, recreate or delete it based on its name alone. Do not attach the normal staging raw bucket.
A separate Cloudflare account from production is preferred; in a shared account have a second reviewer
check every identifier and privilege scope. CLI account/token access may span more resources than a binding.

The example `services/api/wrangler.photo-staging.example.jsonc` has no `env` block, routes or production
binding. Its placeholder IDs are deliberately unusable remotely. It is **not a deployment artifact**.
Local tests prove the template's topology and fail-closed policy, not actual account isolation.
Area AGENTS still describes production placeholders; current production config has real IDs. This
preparation leaves that config untouched and follows the stricter prohibition on production changes.

## Approval record and resources

Before any remote command, record privately: operator, reviewer, approved commit SHA, purpose,
Cloudflare account ID, Worker name/origin, canonical/report D1 names and UUIDs, private bucket,
creation/expiration dates, maximum test reports/photos, budget owner, alert recipient and rollback owner.
Compare both UUIDs against **every** ID in committed config; reject a match, placeholders or equal DB IDs.
Compare the bucket against every existing production/raw-artifact bucket. A name or report-store schema
identity alone does not prove staging ownership. Record the original production deployment/version and
read-only aggregate/config snapshot only under separate read authorization; do not dump private data.

| Resource/control | Requirement |
| --- | --- |
| Worker | Dedicated staging hostname with approved edge rules, no production route/domain; workers.dev and preview URLs disabled; required App Attest; invocation URL logs OFF |
| `DB` | Separate canonical D1, canonical `migrations/` only; optional reviewed synthetic corpus, never production import |
| `REPORTS_DB` | Separate durable D1, report `migrations-reports/` only; no blue/green switching or schema rollback |
| `PRIVATE_PHOTOS` | Dedicated private Standard R2; r2.dev/custom public domains OFF; no backup, replica, Sippy, version copies, locks or lifecycle deletion of fences |
| Retention | Actual five-minute Cron plus aggregate failure/overdue alerts; exclusivity of bucket writers; provider deletion terms reviewed |
| Abuse | Staging-only edge rule covering report/photo and App Attest paths; Worker `CHALLENGE_RATE_LIMITER`, distinct namespace and reviewed caps |
| Credentials | Operator-managed and least privilege; Admin gets report read/write and photo read only; no production credential reuse |

Do not place credential values, photos, report notes, coordinates, object keys or device identifiers in
Git, shell history, screenshots, PRs, exported logs or this approval record. Resource IDs are not passwords,
but the execution manifest stays outside Git. Approved photos remain private.

## Local preparation (safe now)

From repository root, Node >=24:

```sh
make contract
make api-validate
make security-validate
cd services/api
npm run test:photo-staging
npm run typecheck
```

Expected: tests pass; template reports/photos disabled; photo API/R2/retention/Admin tests use synthetic
fixtures. Full `npm test` also covers promotion-v4 privacy and publication gates. No Cloudflare resource
or Apple service is contacted by these synthetic tests. See [P8 evidence](V1_PHOTO_REPORT_E2E.md).
Shared local repositories' `security-secret-scan --history` walks all refs: unrelated historical fixtures
can trigger it. Preserve those refs; if necessary repeat the same gate in a single-branch isolated clone,
installing the pinned dependencies. Never weaken the scanner to obtain a pass.

## Offline safety preflight (before resource creation and again before each approved phase)

From `services/api`, Node 24, run the validator **without** Cloudflare credentials or remote access.
It reads only the explicitly supplied JSONC, the committed production resource inventory, reviewed
Worker entrypoint and migration files, plus the repository's photo-consent policy. It never invokes
Wrangler, reads credential files/environment Secrets, creates resources, writes DB/R2, applies
migrations, deploys or enables intake. It does not modify its input config.

```sh
npm run --silent photo-staging:preflight -- --config wrangler.photo-staging.example.jsonc --production-origin https://<reviewed-production-origin>
npm run test:photo-staging-preflight
```

Replace the origin placeholder with **every** production HTTPS origin from the privately reviewed
manifest, repeating `--production-origin` for each. Do not guess a production origin from the Worker
name: committed Wrangler does not contain a complete domain inventory. An omitted/malformed inventory
is BLOCKED. Completeness is an operator claim and cannot be established offline.
The shipped template's placeholder UUIDs deliberately produce BLOCKED (`database-identities`), even
when all other initial-state checks pass. Before creation, no real target UUIDs exist: **do not invent
IDs to obtain PASS**. This result is expected and does not authorize creation. The resource creation
manifest/approval remains the first remote checkpoint. After approved creation, inspect the ignored
full `worker.jsonc` with the real staging IDs and absolute paths using the same command:

```sh
npm run --silent photo-staging:preflight -- --config .wrangler/photo-staging/worker.jsonc --production-origin https://<reviewed-production-origin>
```

The CLI emits only fixed check IDs/statuses/messages and an operator checklist, never input values,
paths, config bodies, parse exceptions or Secrets. Always use the documented `npm run --silent`
invocation: npm without `--silent` echoes original arguments before the CLI can redact them. Never
put Secrets in command arguments. The silent invocation is required for this output guarantee.

```json
{
  "offlineStatus": "PASS",
  "executionStatus": "BLOCKED",
  "checks": [{"id": "worker-isolation", "status": "PASS", "message": "..."}],
  "operatorChecks": ["Cloudflare resource existence, account ownership and complete production resource/origin inventory: NOT VERIFIED."]
}
```

This is an abbreviated example, **not** an actual resource acceptance result. Exit **0** means only
that supported initial-state offline checks passed; exit **2** means BLOCKED (missing/invalid/unknown
configuration, placeholders, I/O/parse failure or unsafe condition). `executionStatus` is **always
BLOCKED**: offline PASS is neither deployment permission nor a claim that the environment is safe.
Never turn a BLOCKED item into PASS by deleting the check, inventing IDs or replacing the production
inventory. Re-run against the exact reviewed file after any edit; later cloud mutations are outside
this CLI's protection, and it is not automatically interposed on Wrangler or Admin commands.

Supported input is a **full initial-state config**, not a bootstrap subset or an activated deployment:
exactly canonical `DB` (the DATA_DB role), `REPORTS_DB`, `PRIVATE_PHOTOS`; required App Attest;
registration/photo/retention off; explicit empty crons; invocation URL logging off; workers.dev and
preview URLs off. Worker/DB/bucket names must explicitly identify staging, D1 IDs and names must be
mutually distinct and not match committed production resources. Placeholder IDs are unknown, not safe.
The Worker entrypoint and compatibility date must match the reviewed implementation. Both full
migration streams must retain original filenames, contiguous numerical order and bytes, including
0008/0009/0010. This does **not** prove remote migration applicability or ledger state; the 0003
file-import checkpoints below remain mandatory. A full offline PASS is not permission to run a
full-stream migration on an empty remote report store.

Strict JSONC allows comments but rejects duplicate (including escaped-duplicate) keys, trailing commas,
unknown keys and extra bindings. `env`, service/build fallbacks, origin aliases, preview resources,
activation flags and unrecognized options are BLOCKED rather than guessed. Only exact staging
custom-domain `routes` with `custom_domain: true` are supported; wildcard/path/shorthand routes,
production-host overlaps and unreviewed production route additions are BLOCKED. No routes is valid
for an initial non-public config; it does not prove a protected test origin exists. Secrets, limiter
and activated cleanup settings belong to later separately reviewed phases; this initial-state CLI
will intentionally block such later configs. There is no remote/action/enable/force override.

Before any remote execution, the CLI always lists these unresolved operator checks:

- Actual account/resource existence and ownership; complete production identity/domain inventory.
- Token/IAM scope, inability to access production, and independently checked Admin UUID/bucket targets.
- Dedicated staging DNS/certificate/edge protection and absence of alternate reachable ingress.
- R2 privacy, exclusive writers, no copies and permanent fence/provider erasure guarantees.
- Remote schema/ledger, deployed code, Secrets, flags and actual Cron state.
- Exact consent approval, installed iPhone origin/App Attest and operator acceptance.

The runtime photo-consent guard is inspected without changing its private approval list; currently
unreviewed terms cannot enable photos even with simulated complete prerequisites. A PASS for that
check grants neither photo consent nor community publication rights. Production configuration,
photo approval lists and all migrations are untouched by this tool.

## Operator-only execution order (after separate approval)

Run one reviewed command at a time, not this whole document as a script. Commands below assume
`services/api` as working directory and the pinned npm-installed Wrangler. Never add `--env`: all remote
commands use the isolated config. Stop on unexpected identity, output, error or uncertain acknowledgement.
Creation is account-level and precedes the config; check account ownership before each create.

```sh
npx wrangler d1 create mannerpath-photo-staging
npx wrangler d1 create mannerpath-staging-reports
npx wrangler r2 bucket create mannerpath-photo-staging-private
```

Expected: three newly owned staging resources, two distinct non-placeholder D1 UUIDs. Capture only the
resource identifiers privately. Verify private bucket settings and exclusive writers in the dashboard;
creation alone does not attest no copies or physical erasure. No `PHOTO_STORAGE_POLICY` yet.

Create an ignored `.wrangler/photo-staging/` directory. Copy the example to `worker.jsonc` there.
Replace the two UUIDs from the approved manifest. Because the config moved, set `main` and both
`migrations_dir` values to **absolute paths** in this checkout; remove or fix `$schema` to the installed
schema path. Keep names, registration paused, photo off, retention off and empty crons. Review its
entire diff and verify it contains no production IDs, domains, bucket or `env` block. Use this explicit
path for **every** subsequent Wrangler command. Keep a reviewed, immutable copy before each phase.
Do not copy Secrets into any JSON file. Do not edit normal `wrangler.jsonc`.

The template has `workers_dev=false` and `preview_urls=false` and no routes: it deliberately has no
public test origin. Before the first accessible deployment, separately approve and configure a dedicated
staging custom hostname/route in the isolated config, its DNS/certificate and zone edge rules. Never
use a production route or wildcard overlapping production. Verify **every** reachable hostname is
protected; zone WAF rules do not protect a workers.dev fallback. Keep workers.dev and preview URLs
disabled through enablement and rollback. If a protected iPhone-compatible hostname is not available,
HOLD enrollment/intake rather than bypass edge controls via workers.dev. Verify direct workers.dev
and preview hostnames cannot serve the API. See [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
and [custom-domain routing](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### REPORTS_DB checkpoint sequence

Read [0003 recovery](../../services/api/REPORTS_MIGRATION_RECOVERY.md) first. Applied migration bytes
are immutable. This isolated config is not accepted by the existing fixed-environment recovery CLI's
remote mode; **do not invoke its production/staging target shortcuts**. Its offline `prepare` artifact
is usable below after manual identity/schema review. Existing/partial stores require a new reviewed plan.

1. On the fresh report DB, inspect the schema read-only; expect no application tables. For bootstrap,
   copy only original `0001_report_store.sql` and `0002_scale_indexes.sql` (unaltered) into the ignored
   `bootstrap-reports` directory. Make `bootstrap.jsonc` from the reviewed worker config with only
   REPORTS_DB `migrations_dir` changed to that absolute directory. Keep DB bindings identical.

   ```sh
   npx wrangler d1 migrations apply REPORTS_DB --config .wrangler/photo-staging/bootstrap.jsonc --remote
   npx wrangler d1 execute REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote --command "SELECT name FROM d1_migrations ORDER BY name"
   npx wrangler d1 execute REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote --command "PRAGMA foreign_key_check"
   ```

   Expected: exactly 0001+0002 ledger, FK empty. Compare complete application `sqlite_schema`
   (names, types, SQL) to a fresh local 0001+0002 reference as described in recovery. No 0003 objects.
   Do not use full-stream `migrations apply` here.

2. Generate and review the offline 0003 import, including its guarded ledger insert:

   ```sh
   npm run reports:migration -- prepare --out .wrangler/photo-staging/0003-import.sql
   shasum -a 256 .wrangler/photo-staging/0003-import.sql
   npx wrangler d1 execute REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote --file .wrangler/photo-staging/0003-import.sql
   ```

   Operator must compare the reviewed digest immediately before import; no blind retries. File import
   is the intended workaround, not proof of remote success. Then read ledger, complete schema and
   FK again: exactly 0001–0003 with all expected tables/indexes/triggers and no FK errors. On failure
   or a lost response, inspect read-only and STOP; never DROP, repair or reapply an applied artifact.
   The recovery 0003-only verifier deliberately rejects later schema, so this checkpoint is immediate.

3. Apply remaining **original** migrations in numerical order 0004 → 0005 → 0006 → 0007 →
   **0008 admin audit → 0009 photo gate → 0010 early-erasure gate**:

   ```sh
   npx wrangler d1 migrations list REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote
   npx wrangler d1 migrations apply REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote
   npx wrangler d1 migrations list REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote
   npx wrangler d1 execute REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote --command "SELECT name FROM d1_migrations ORDER BY name"
   npx wrangler d1 execute REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote --command "SELECT key,value FROM report_store_meta ORDER BY key"
   npx wrangler d1 execute REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote --command "SELECT type,name,sql FROM sqlite_schema WHERE name LIKE 'admin_review_audit%' OR name IN ('report_reviews_new_spot_photo_evidence','report_reviews_new_spot_photo_viewable') ORDER BY name"
   npx wrangler d1 execute REPORTS_DB --config .wrangler/photo-staging/worker.jsonc --remote --command "PRAGMA foreign_key_check"
   ```

   Expected: all ten ledger rows, none pending, store `mannerpath-reports`, schema `reports-store.v1`,
   audit table/index/immutability triggers, both export fences with SQL matching 0009/0010, FK empty.
   Later conditional triggers may also encounter provider parser differences: STOP if any fails;
   this preparation does not claim remote parser acceptance or authorize migration rewrites.

4. Migrate canonical DB separately; verify it has no report-store identity or raw report writes:

   ```sh
   npx wrangler d1 migrations apply DB --config .wrangler/photo-staging/worker.jsonc --remote
   npx wrangler d1 migrations list DB --config .wrangler/photo-staging/worker.jsonc --remote
   ```

   Expected: canonical stream only, none pending. Do not apply report migrations or private photos
   to DB. Reconciliation/import stays on the existing local canonical pipeline; a remote canonical
   import/promotion is a different separately reviewed operation and is not needed to prove refusal.

### App Attest, enrollment and the iPhone

Set each secret interactively, with the isolated config; no literal values in commands:

```sh
npx wrangler secret put REPORT_SUBMITTER_PEPPER --config .wrangler/photo-staging/worker.jsonc
npx wrangler secret put RATE_LIMIT_KEY_PEPPER --config .wrangler/photo-staging/worker.jsonc
npx wrangler secret put REPORT_APP_ATTEST_APP_ID --config .wrangler/photo-staging/worker.jsonc
npx wrangler secret put REPORT_APP_ATTEST_ENVIRONMENT --config .wrangler/photo-staging/worker.jsonc
npx wrangler secret put REPORT_APP_ATTEST_BUNDLE_VERSIONS --config .wrangler/photo-staging/worker.jsonc
```

- Submitter pepper: nonblank ≥32 UTF-8 bytes, preserve bytes once used. Limiter pepper: ≥32 bytes after
  trimming, distinct from submitter pepper. Use fresh staging values; changing them breaks existing hashes/budgets.
- Exact App ID prefix + bundle ID; actual signed App Attest environment: development signing → `development`,
  TestFlight/App Store → `production` even against staging. Exact comma-separated CFBundleVersion allowlist;
  no spaces/duplicates. Never accept both environments, disable App Attest or replace the Apple trust root.
- Add a reviewed staging-only `ratelimits` binding `CHALLENGE_RATE_LIMITER` with its own namespace_id,
  `simple.limit` and `simple.period` (10 or 60 seconds). Record values based on intended tester count and budget,
  not production guesses. Set `REPORT_REGISTRATION_MAX_PER_HOUR` / `REPORT_REGISTRATION_MAX_PER_DAY`
  to positive integer strings, day ≥ hour. Install the matching staging edge control. Only then separately
  authorize `REPORT_REGISTRATION=enabled` for enrollment. Pausing enrollment does **not** stop existing keys.
- Apple lane builds with explicit `MANNERPATH_API_BASE_URL=https://<reviewed-staging-origin>` and verifies the
  built `MannerPathAPIBaseURL` plist. Release defaults may point at production: verify final installed build,
  not just build settings. Verify schema-3 report/schema-2 photo client and matching terms. Physical iPhone
  required; local synthetic certificates never prove real Apple attestation. No Apple source changes here.

### Disabled deployment, cleanup, then photo enablement

Deploy only after all preceding approvals, keeping `PHOTO_EVIDENCE=off`:

```sh
npx wrangler deploy --config .wrangler/photo-staging/worker.jsonc
curl --fail --silent --show-error 'https://<reviewed-staging-origin>/v1/config'
```

Expected: photoEvidenceEnabled false. Before valid App Attest/secrets, reports.available false and
report/App Attest requests fail closed. After correct setup, reports speaks `appAttest`, report schema 3.
A wrong/missing assertion must fail and create no report. Do not treat HTTP 200 config as intake proof.

Before accepting photos, verify bucket exclusivity/no copies/provider terms and set
`PHOTO_STORAGE_POLICY=private-no-copies-permanent-fences.v1` in the **isolated** config. Set
`REPORT_RETENTION=cleanup`, `REPORT_RETENTION_CRON=*/5 * * * *`, and `triggers.crons=["*/5 * * * *"]`.
Deploy and observe actual scheduled runs, aggregate `reportRetention` results, alert delivery, failure
and recovery, drain capacity and an empty queue. A variable alone cannot install the Cron. Do not turn
cleanup off when pausing intake. No source-refresh schedule is added.

**HOLD:** reviewed photo terms are currently empty. Obtain a separate approval/code PR registering the
exact consent version and matching iPhone text. Confirm production still has photo off/no photo binding.
Only after that change and operator authorization set isolated `PHOTO_EVIDENCE=on`, deploy and verify
`/v1/config` reports photoEvidenceEnabled true on this origin only. If still false, investigate missing
prerequisites; never inject test dependencies, draft consent or a staging bypass into a deployed Worker.
Photo-processing consent does not approve community publication (#124).

## Admin operation (operator only, separate remote approval)

First check manifest UUID/bucket against the actual staging Worker bindings. The Admin's `--env staging`
label **does not reject an arbitrary production UUID or bucket**. Its schema check proves report-store
shape, not environment ownership. Use credentials that cannot access production, second-person target
review, and no production confirmation flag. A tool-level cross-environment UUID denylist is not added here.

From a genuine interactive terminal outside CI, open read-only first:

```sh
npm run reports:admin -- --remote --env staging --database-id <reviewed-staging-report-uuid> --private-photo-bucket mannerpath-photo-staging-private --actor staging-reviewer
```

Set a 24–256 character passphrase at the hidden prompt; visit loopback `http://127.0.0.1:4318` on the same
machine. No network exposure, reverse proxy, tunnel, external map consent or real-photo screenshots.
Report detail supplies photo IDs; preview uses authenticated no-store responses, bounded metadata/hash
checks and cutoff rechecks. Confirm expected synthetic report, photo states, duplicate candidates and
explicitly unverified publication state. Canonical duplicate lookup is a separate **local** snapshot;
an empty or stale local snapshot is not proof of no duplicate. Record snapshot version privately.

After separate decision-write approval, stop that session and restart the same command with
`--enable-decisions`. Check privacy/permission, photo preview, reason, confirm dialog, then independently
approve/reject the report. Test cancellation, stale version/conflict and double-click replay. Confirm audit
metadata without exporting private content. Reader is photo-read-only; rejection queues deletion for Cron.
No Admin action exports artifacts, writes canonical DB or publishes. Stop with Ctrl+C; this ends the proxy,
not retention. Do not confuse the CLI `photo-summary` counts with a per-photo ID retrieval interface.

## E2E checklist and expected results

Every row begins **NOT RUN remotely**. Record commit/build, UTC time, operator, PASS/FAIL/NOT RUN,
expected/actual status/counts and private evidence reference. Do not record image bytes, keys, assertion
material or full report/SQL dumps. Local test results are separate from these acceptance rows.
Use synthetic scenes only, no faces/plates/private locations; rate tests need explicit bounded budgets.

| Scenario | Expected result / decisive evidence |
| --- | --- |
| Environment separation | Reviewed dedicated Worker, both D1 IDs and private bucket; installed iPhone origin matches; no production binding/route; approved production read-only before/after snapshot unchanged |
| Enrollment / attested report | Real Apple registration, schema-3 report 201; REPORTS_DB count +1, canonical raw reports unchanged; schema-1/2 reports and missing/invalid assertions refused |
| 1–3 photos | Authenticated owner and current covered consent; schema-2 photo receipts; ≤3 ready attachments; private sanitized PNG preview; no public URL, note/photo/submitter data in public DTOs |
| Size/type limits | API raw ≤5 MiB; dimension ≤4096 and ≤2,000,000 pixels; JPEG/PNG only; invalid/oversized image rejected (413/415/422 depending layer), no ready orphan. Envelope bound is `PHOTO_SUBMISSION_MAX_BYTES`, not 5 MiB due to nested base64 |
| Client selection | iPhone selection limit/normalization tested separately (input may be ≤8 MB); server limit remains 5 MiB. EXIF/GPS/device text absent in sanitized bytes; inspect only in RAM/private viewer, no durable object download |
| Rate/abuse | 4th unique attachment rejected; report budget 10/hour, 50/day; outstanding report challenges ≤3/key; test staging edge photo-path rule, Worker challenge limiter and registration caps separately. **No independent per-photo/hour application bucket exists**; bounded edge controls and capacity acceptance are prerequisites |
| Upload network failure / explicit retry | Report receipt retained; same selected-image photo idempotency key, payload and fresh assertion retry yields same photo, no duplicate report/extra slot; uncertain PUT retains reservation |
| Lost report response | Same draft key/payload and fresh challenge/assertion retrieves same report receipt without another report-budget debit; changed payload with same key conflicts |
| Force quit before report / during photos | Before report success: follow draft recovery UI. After success: report ID retained; photos are memory-only, so do not promise image-byte recovery. Relaunch shows interrupted-photo recovery: reselect photos for existing receipt or explicitly finish without; no silent duplicate/new report |
| Expired reservation | Wait beyond 15-minute upload deadline on a dedicated synthetic case; original reservation cannot upload; Cron queues/fences abandoned work; repeated attempt cannot resurrect bytes |
| Expired/replayed challenge / key ownership | Five-minute challenge expired or consumed → refused; another device cannot attach; App Attest environment/build mismatch rejected; no new report/ready photo or successful assertion-counter advance; a consumed challenge remains spent and retry needs a fresh challenge |
| Admin photo and report decisions | Photo IDs discovered in detail, preview before photo approval; one approve/one reject; report hold/reject/duplicate/accepted; reason and explicit confirmation, CAS/replay/audit; photo approval alone changes no report/publication state |
| Publication negative cases | No/pending/rejected photo refuses new-place proposal/export; approved photo then deletion-queue/early-erasure boundary blocks export in code and SQL (0009+0010); inspect synthetic local exact-clock tests before remote exercise |
| Publication positive prerequisite, still blocked | Live approved photo + accepted/queued report can form review; sealed artifact import/apply happens through existing **local** canonical pipeline. Community source/rights remain blocked: no publicly listed spot, no remote promotion; one report never becomes communityVerified |
| Retention and R2 fence | receipt+90d ceiling, viewability ends at delete_after−24h; rejected/redacted/abandoned photos queued; Cron overwrites same key with permanent zero-byte deleted-photo.v1 marker, D1 job acknowledged only on success; late conditional PUT cannot replace marker |
| Cron failure/recovery | Revoke only test-bucket access through separately approved scoped failure exercise; aggregate outcome failed and alert; queue persists, other selected jobs progress, restore rights and drain; no failure logged with key/content/raw exception |
| Queue/throughput | R2 cleanup is bounded to five jobs/pass; five-minute cadence is ~1,000 jobs/day theoretical, not an SLA. Measure actual drain/retries, oldest attempt and 24h buffer; stop intake before backlog threatens deadline |
| Rollback/isolation | Photo off and enrollment paused, existing-key report behavior documented; cleanup still runs; schema/markers stable, production unchanged |

A 90-day real-time boundary cannot be claimed after a short run. Exact boundary/failure/race tests use
injected clocks locally. Any accelerated remote fixture needs a separate reviewed staging-only fixture
plan, immutable-deadline-safe data and approval; do not UPDATE retention timestamps or add a public
clock/fault endpoint. Mark remote expiry proof NOT RUN until that evidence exists.
For real R2 late-write/fence tests, use a dedicated disposable synthetic test key under an approved
operator harness; existing memory/local-R2 tests do not establish remote atomicity. Do not issue an
unconditional upload or physical DELETE as a shortcut.

## Rollback and eventual teardown

1. Pause enrollment (`REPORT_REGISTRATION=paused`) and set `PHOTO_EVIDENCE=off` in isolated config;
   deploy **only** that Worker. Verify photo config false/route 503. Existing keys may still send plain
   reports: to halt all intake, use separately authorized staging-only edge deny rules for report/App
   Attest POST paths or intentionally remove a required staging App Attest config value. Do not disable
   attestation. Preserve the submitter pepper and existing report store. Keep cleanup active.
2. Prefer forward-deploying reviewed known-good code with current isolated bindings, retention and
   Secrets. Older Worker rollback can restore old Secrets/flags and reopen intake: do not blindly run
   `wrangler rollback`. Reverify config, scheduled cleanup, private preview and negative publication gate.
3. Never reverse migrations or replace REPORTS_DB. Preserve audit and permanent fences; do not restore
   historical R2 bodies, backups or old D1 state over live deletion progress. A code failure is not a
   reason to recreate the report store. Stop on uncertain erasure and investigate read-only.
4. Teardown is a **distinct destructive approval**, only for this explicitly disposable synthetic
   staging environment, not a normal durable report store. Establish no clients, credentials, Worker
   versions, remote proxies, in-flight PUTs or other writers can access it. Drain deletion jobs, verify
   all bodies erased and record aggregate counts. Keep bucket/markers until no delayed writer can
   exist; no lifecycle/purge shortcut. If this cannot be proved, keep resources/cleanup and HOLD teardown.
5. After reviewed shutdown, stop Admin; remove staging routes/clients and Worker/cron, then revoke
   staging credentials/secrets. Retain REPORTS_DB and any bucket containing permanent fences under the
   current durable-store/storage contract. Do not delete markers or the used bucket, even after all
   bodies have been erased. Their final disposal is HOLD pending a separate ADR/storage-policy change
   and reviewed shutdown proof. Do not supply a bulk object-purge script. Only a never-used empty
   bucket and never-used disposable databases may be deleted under this preparation plan.

Command templates below are operator-only, after explicit shutdown and destructive approval.
Worker deletion requires deletion work to be complete and remaining durable resources recorded.
Database/bucket deletion below is **only for never-used disposable resources** (zero reports, keys,
photos and fences, verified under separate read authorization), with IDs matching the creation manifest.
If any reports/keys/photos/fences ever existed, retain the report store and bucket; STOP, do not purge.

```sh
npx wrangler delete --config .wrangler/photo-staging/worker.jsonc
# Only never-used disposable resources, under the separate approval described above:
npx wrangler d1 delete mannerpath-photo-staging --config .wrangler/photo-staging/worker.jsonc
npx wrangler d1 delete mannerpath-staging-reports --config .wrangler/photo-staging/worker.jsonc
npx wrangler r2 bucket delete mannerpath-photo-staging-private --config .wrangler/photo-staging/worker.jsonc
```

Capture deleted/retained resource names, time, authorizer and aggregate outcome. Remove ignored local
configs only after the resource inventory/retention record is preserved privately; they are not backups.
No command here targets production. A shared account still needs manual target review before deletion.

## Cost and security notes

Set a small authorized test cap and billing alerts before opening enrollment; a budget alert is not a
hard cost cap. Five-minute Cron means 288 invocations/day even with no photos. Worker CPU/memory for
image decode, D1 rows read/written (including indexed cleanup), R2 storage/Class A writes (including
marker overwrites/retries)/Class B reads (Admin previews), edge rules and monitoring can all cost money.
Permanent markers continue to use object/operation resources. Unbounded retries, public endpoints,
large images or queue scans can exhaust a Free-plan limit; failure does not waive deletion obligations.
Use aggregate metrics and alerts, not request URL/body logging or photo object identifiers.

Recheck the account plan and current primary pricing/limits before approving a spend estimate:
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/).
No monetary estimate or free-tier sufficiency is asserted here. Follow
[photo storage privacy/fences](../PHOTO_STORAGE_OPERATIONS.md),
[staging security](../STAGING_VERIFICATION.md),
[Admin operations](../LOCAL_MODERATION_ADMIN.md),
[publication decision](../legal/COMMUNITY_PUBLICATION_DECISION.md) and
[launch checklist](../COMMUNITY_LAUNCH_CHECKLIST.md).

## Operator action ledger

- [ ] Approve resource manifest, account isolation, synthetic-data cap, costs and alert owner.
- [ ] Separately approve resource creation; verify private storage/no-copy settings/provider terms.
- [ ] Review isolated config and target UUIDs; approve/bootstrap 0001–0002, import/verify 0003,
      then 0004–0010 and canonical migrations, each with ledger/schema/FK checkpoints.
- [ ] Approve staging Secrets/limiter/caps/edge configuration and disabled Worker deployment.
- [ ] Coordinate Apple origin/signing/environment/build/terms and physical-device enrollment.
- [ ] Approve and verify actual cleanup Cron, alerts, fence behavior and drain capacity.
- [ ] Obtain exact photo-consent approval/code change; authorize **staging only** intake enablement.
- [ ] Authorize Admin read then decision access; complete E2E rows with real evidence or NOT RUN.
- [ ] Confirm production unchanged and public community gate still closed; record acceptance/blockers.
- [ ] Approve rollback if needed; separately approve final teardown or explicitly retain fenced resources.

Preparation does not check off any of these remote items. Operator approval remains pending.
