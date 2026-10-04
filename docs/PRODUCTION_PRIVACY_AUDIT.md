# Production privacy audit — read-only v1

Audited 2026-10-05 JST against `origin/main` **d70139ce726055610e35e1276145fae40b13d1fc**.
**PRODUCTION EVIDENCE INCOMPLETE — MAINTAINER CHECK REQUIRED.** This record does not approve
“Data Not Collected”, deployment, submission or report activation. No Cloudflare resource or setting was changed.

## Evidence and access boundary

Verified: committed configuration, API/Apple source, pinned Hono dependency behavior and release changes below.
Local tests establish implementation behavior, not the settings or traffic of a deployed Worker.
Provider documentation describes possible behavior, not observed account settings.

The read-only authentication probe, from `services/api`, was:

```sh
WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/mannerpath-privacy-audit-wrangler.log \
  node node_modules/wrangler/bin/wrangler.js whoami
```

Wrangler 4.135.0 exited 1: `Not logged in. Your auth token has expired and could not be refreshed, and the environment is non-interactive.`
No login, credential inspection, resource creation, deployment, migration, remote write, secret change,
DNS change, logging configuration change or activation followed. No successful account query was obtained.
Worker existence, deployed version, resource existence and actual retained data are **UNKNOWN**.

Release changes inspected:

| PR | Main merge | Privacy relevance |
| --- | --- | --- |
| #173 | `5ed06ea` | Local release preflight includes the bound R2 bucket; not a production creation receipt |
| #174 | `0d92163` | Submission packet and conditional label recommendations |
| #175 | `19c36a9` | Availability-aware Reports/privacy UI; no browsing registration |
| #176 | `3464587` | Visual RC/local fixture evidence; not production traffic evidence |
| #177 | `d70139c` | Public policy/support and configured app links |

Worker source and `wrangler.jsonc` did not change in these PRs. Public-site owner/contact information
is now supplied (#177, [PUBLIC_SITE.md](PUBLIC_SITE.md)); publication and the release build's URL still need verification.

## Confirmed implementation facts

| Area | Confirmed in repository | Production limitation |
| --- | --- | --- |
| Worker | `mannerpath-api-production`, `src/index.ts` fetch/scheduled entry | Existence, active version, domains/routes UNKNOWN |
| Logs | All environments: `observability.enabled:true`, `logs.enabled:true`, `invocation_logs:false` | Committed disable is not proof of live settings; console logging remains enabled |
| Other telemetry configuration | No Analytics Engine binding, Logpush property, tail consumer, explicit trace configuration or sampling override committed | Account jobs, integrations, security products, analytics and defaults UNKNOWN |
| Cron | `triggers.crons:[]` in every environment | Live schedules/manual invocation UNKNOWN |
| D1 | Separate `DB` / `REPORTS_DB`; production IDs are placeholders ending in 0 / 1 | Config is not deployment-ready; does not establish absence of existing account databases |
| R2 | `RAW_ARTIFACTS` names `mannerpath-raw-artifacts-production` | Existence/lifecycle/access UNKNOWN; binding is for approved publisher artifacts, not photos |
| Browsing writes | Config has no database access; tile handlers read canonical data. No application code storing client IP, User-Agent, requested tile path or raw GPS into D1/R2 was found | Provider logs and existing/historical records were not inspected |
| Explicit logging | No application-authored request logger/analytics sender found. Scheduled source checks log run/source/status/outcome and can surface failures | Does not establish absence of framework/runtime logs |

Sources: [wrangler.jsonc](../services/api/wrangler.jsonc), [app.ts](../services/api/src/app.ts),
[config DTO](../services/api/src/config/dto.ts), [scheduled checks](../services/api/src/refresh/scheduled.ts),
[artifact store](../services/api/src/refresh/artifact-store.ts).

**Exception logs are possible now.** The pinned Hono 4.13.8 default error handler calls `console.error(err)`;
`createApp` installs no replacement error handler. Unexpected database/schema/runtime failures can therefore
produce diagnostics despite `invocation_logs:false`. This is not evidence that personal data was logged:
actual payloads, contextual fields, occurrence, sampling and retention are UNKNOWN. Do not say “no request-path
logs” or “nothing is retained”. Inspect sanitized diagnostic field names and representative errors before signoff.

Cloudflare distinguishes invocation events from console logs. Its current Workers Logs documentation lists
3-day Free / 7-day Paid retention (maximum 7 days). Those are product defaults, **not confirmed account retention**;
exports can have independent retention. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
Logpush is a separate export path with account jobs and Worker enablement; its absence from this file is not
an account audit. [Workers Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/).

## Read-only release consistency

- Device GPS supports ranking/distance/bearing locally. Tile requests transmit z14–16 tile IDs, not raw GPS
  to the MannerPath API. MapKit/search/routing/system Maps can communicate with Apple; this is not a promise
  that no location ever leaves the device. No intentional location-history persistence was found.
- Production `REPORT_ATTESTATION=required` fails closed without a valid App Attest configuration; config
  reports availability only from attestation support and store binding presence, not operational health.
  No production secret values were inspected. Reports/auth being unavailable is still a deployment check.
- App browsing/config refresh checks support but does not register App Attest. Registration/authorization
  follows explicit report submission in `ReportModel` / `ReportAuthorizer`, not list/map browsing.
- `photoEvidenceEnabled:false` is literal in config; the shipping API composition has no photo store and
  rejects photo intake. The Apple shipping composition has no photo uploader. Deployed code version remains UNKNOWN.
- Dormant report code stores notes/pins/consent and hashed submitter identity when enabled. Unattested code
  hashes the install UUID; attested reports hash a key-derived submitter instead. App Attest registration
  independently retains key/public-key/environment/counter/time. These are future collection paths, not
  proof of current collection. Retention is manual; inactive cron does not prove old records were deleted.

See [inventory](APP_PRIVACY_INVENTORY.md), [submission §2.4–2.5](APP_STORE_SUBMISSION.md),
[report implementation](../services/api/src/reports/create.ts), [App Attest store](../services/api/src/attest/store.ts),
[ReportModel](../apps/apple/MannerPath/MannerPath/Features/Reports/ReportModel.swift).
Do not set `REPORT_ATTESTATION=disabled` to turn reporting off; that accepts unattested reports.
Configuring App Attest later can activate collection without a new binary. No new flag is proposed.

## App Store Privacy Label decision materials

Apple's collection test concerns off-device access beyond real-time service, including partners. Device-based
linkage does not require an account. IP has no standalone category: classify retained information by use.
Apple's own framework collection must be distinguished from data MannerPath receives/retains.
[Apple definitions](https://developer.apple.com/app-store/app-privacy-details/).

The following separates implementation findings from submission answers. No category is confirmed
**COLLECTED in production** by this audit; absence of production access also prevents an overall NOT COLLECTED conclusion.

| Category | Audited implementation | Production classification / recommendation |
| --- | --- | --- |
| Precise Location | Raw device GPS NOT COLLECTED by MannerPath's audited API flow | UNKNOWN for provider-derived position. Do not infer precise GPS collection from IP alone; disclose if retained inferred/reconstructed user location meets Apple's precision definition |
| Coarse Location | Geographic tile IDs leave device; retention not implemented in browsing D1/R2 code | UNKNOWN / conservative disclosure required: **COLLECTED, LINKED, App Functionality**, pending evidence excluding retained identifiable area requests |
| IP / request metadata | No custom IP/UA/path persistence found | UNKNOWN: inspect fields, use and retention. Map to Location, Device ID or Diagnostics as applicable; IP alone does not automatically require every category |
| Device ID | Local UUID; no browsing auth registration; report/key identity NOT COLLECTED if intake unavailable | UNKNOWN until live auth gate/version and provider identifiers are verified. Retained installation/device identifiers: COLLECTED, conservatively LINKED |
| Other User Content | Report notes/pins NOT COLLECTED while intake unavailable | Conditional NOT COLLECTED after live gate check; otherwise UNKNOWN. Separately assess retained customer-support content |
| Photos or Videos | NOT COLLECTED by shipping composition; photos disabled | Confirm deployed version/no alternate intake before final NOT COLLECTED answer |
| Other Diagnostic Data / Performance Data | No app diagnostic upload; Worker/framework exception logs possible | UNKNOWN / conservative disclosure required if retained relevant technical data. Confirm actual fields before selecting types; App Functionality, conservatively LINKED if correlated |
| Product Interaction / Other Usage Data | No app analytics SDK/events | UNKNOWN for provider request records and their use. Aggregate operational counts alone do not demonstrate per-user interaction collection; disclose actual retained usage data/purposes if present |
| Crash Data | NOT COLLECTED by app instrumentation; no crash SDK/MetricKit upload | Confirm release dependency/build. Worker exceptions are not automatically iOS Crash Data; classify actual diagnostic content |

**Recommended top-level answer:** do not approve “No, we do not collect data” yet. If proceeding with unresolved
identifiable tile retention, use “Yes” with the conservative Coarse Location answer above and every additional
type actually retained. This is a conservative recommendation, not observed production collection or approval
to skip the audit. If report/auth unavailability cannot be proven, use submission §2.5's enabled analysis and
resolve the gate before shipping. Do not speculate that every type is collected merely because Cloudflare is used.
No tracking or advertising purpose was found in the audited implementation; verify provider use before final answers.

Support mail/external public-site visits require a separate workflow check (retained email/content, providers,
purpose and applicable optional-disclosure criteria). A mailto link is not an in-app collection SDK, but optional
support is not automatically exempt. Do not infer mailbox retention or public-site publication from code.

## Exact maintainer checks — read-only only

Authenticate separately to the intended account, then record account/plan and sanitized evidence date/version.
Do not paste tokens, secret values, raw IPs, customer content or destination credentials into release records.
From `services/api`, these inventory commands are read-only (local Wrangler help checked):

```sh
npx wrangler whoami
npx wrangler deployments list --env production --json
npx wrangler d1 list --json
npx wrangler r2 bucket list
```

| UNKNOWN / MAINTAINER CHECK | Required evidence |
| --- | --- |
| Worker exists / active code | Dashboard Workers & Pages → production Worker: active deployment/version, routes/domains, binding names/IDs; compare with reviewed release commit |
| Logs / observability | Worker Settings → Observability: invocation/console logs, sampling, traces, integrations/export and plan retention. Inspect retained field names/error shapes without persisting customer data |
| Logpush / other copies | Account/zone Logpush jobs: Worker trace and applicable HTTP datasets, enabled state, filters/fields, destinations and destination retention/access/deletion; inspect tails/OpenTelemetry exports too |
| Request/security/analytics products | For actual hostname/routes, inspect applicable zone/CDN/WAF/security/rate-limit/request logging and analytics products. Record whether per-request IP/UA/path/time/identifiers are accessible and retained; distinguish aggregate metrics |
| Resource contents/history | Confirm production D1/R2 inventory, bindings, lifecycle and access. Determine any historical reports/keys/photos/request logs and retention status without exporting personal records; empty/unavailable today does not erase historical collection |
| Intake unavailable | Verify sanitized `/v1/config` false/false and report/auth/photo rejection on actual release deployment, plus signed-build browsing network evidence showing no registration/report/photo calls. No test submission/registration that creates a remote record in this audit |
| Final label/policy | Record fields, purpose, linkage/de-identification timing, sharing, retention, deletion and actual build/providers; owner signs final ASC answers and public policy |

No resource existence check succeeded here. If resources are absent, creation is a **separate authorized maintainer
operation**, not this audit. Follow [release checklist §3](RELEASE_CHECKLIST.md) after inventory/review; do not create duplicates.
Existing deployment checks must not be performed with a mutating smoke/report client unless separately authorized.

## Policy and deployment decisions

No new privacy policy decision, ADR change or telemetry feature is proposed. The current public policy correctly
allows provider processing rather than asserting zero transmission, but is not an account-retention receipt.
Before publication/submission, reconcile its provider/retention/purpose/deletion statements with the evidence above;
update policy, labels and applicable manifests if actual collection differs. Do not invent retention durations.
If identifiable tile history exists, resolve the conflict with [OPERATIONS.md](OPERATIONS.md)'s no-history rule;
conservative disclosure alone does not authorize prohibited history. Sampling is not a fix.

Before production deployment: complete account inventory; review real, distinct D1 IDs and the bound R2 resource;
complete local preflight/data review; obtain logging/privacy signoff; preserve required attestation, unavailable
report/auth configuration, photos off and crons empty. Resource provisioning/deployment remain separate maintainer
operations. After deployment, confirm actual settings/version/gates and signed-build traffic, publish the real
policy/support URLs, then finalize ASC labels. **UNKNOWN remains a submission gate.**

## Validation

Documentation-only change. Existing API/contract tests exercise committed deployment safety, config availability,
fail-closed App Attest and photo gates; they do not validate an account's settings or personal-data retention.
Run `make api-validate`, `make contract` and `git diff --check`; results are recorded in the PR.
