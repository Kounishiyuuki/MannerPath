# Production privacy audit — read-only v2

Authenticated Cloudflare evidence collected 2026-10-05 JST against main
`d70139ce726055610e35e1276145fae40b13d1fc`; documentation finalized against
`origin/main` **7d8cbab0ba28bc28eb17a56546f7f97b158b3841**, incorporating #179.
Cloudflare evidence was not re-collected during this documentation finalization.
**PRODUCTION EVIDENCE INCOMPLETE — MAINTAINER CHECK REQUIRED.** This record does not approve
“Data Not Collected”, deployment, submission or report activation. No Cloudflare resource or setting was changed.

## Evidence and access boundary

Verified: committed configuration, API/Apple source, pinned Hono dependency behavior and release changes below.
Local tests establish implementation behavior, not the settings or traffic of a deployed Worker.
Provider documentation describes possible behavior, not observed account settings.

### Authenticated follow-up (2026-10-05 JST)

OAuth `npx wrangler whoami` succeeded for account `26b626fb954591ebe35313a5328cae0e`.
The initial command's local log-file write hit EPERM; subsequent queries disabled metrics and used a
`/tmp` log path or `WRANGLER_WRITE_LOGS=false`. Authentication itself succeeded. Token values were never
printed or copied. No Cloudflare resource or setting was changed; only inventory/settings GETs were made.
No tail session, test report, auth registration, remote SQL, object download or activation was performed.

Read-only CLI evidence (Wrangler 4.135.0, Node 24):

| Command | Result |
| --- | --- |
| `npx wrangler deployments list --env production --json` | Worker does not exist, code 10007 |
| `npx wrangler versions list --env production --json` | Worker does not exist, code 10007 |
| `npx wrangler d1 list --json` | One DB: `mannerpath-e2e-p35`, UUID `77be8fed-64fd-48ff-a8f0-c04280df2e66`; no production-named DB or REPORTS_DB |
| `npx wrangler r2 bucket list` | “Please enable R2 through the Cloudflare Dashboard”, code 10042; no successful bucket inventory |

Additional GETs used the installed Wrangler authentication/client internally, without reading credential
files directly or exposing tokens. Responses below are sanitized configuration metadata, not customer logs.
Account-relative paths use `/accounts/26b626fb954591ebe35313a5328cae0e`.

| GET endpoint | Observed result / limit |
| --- | --- |
| `/workers/scripts`, `/workers/services` | Three scripts/services; only MannerPath script is `mannerpath-api-e2e-p35`. No `mannerpath-api-production` or staging Worker. The other two scripts belong to unrelated workloads and were not investigated |
| `/workers/scripts/mannerpath-api-production/settings`, `/schedules` | HTTP 404, code 10007. Production settings/schedule do not exist at this target |
| `/logpush/jobs` | HTTP 403, code 10000: **UNKNOWN / MANUAL CHECK**, not an empty list |
| `/analytics_engine/datasets` | HTTP 404, code 11000: **UNKNOWN / MANUAL CHECK**; no inference of disablement from this response |
| `/zones?account.id=…&per_page=50` | Empty list for authenticated account; no returned zone to inspect for HTTP Logpush/WAF/CDN products. Other accounts/hostnames remain outside this evidence |
| `/pages/projects` | Empty list for authenticated account; GitHub Pages policy hosting is separate |

The E2E script inventory metadata has `invocation_logs:false`, console logs enabled, `persist:true`,
log sampling 1, traces disabled, `logpush:false`, no tail consumers, and compatibility date 2026-09-01.
Its last-modified time is 2026-09-25T07:06:35.201494Z. These are **E2E facts only**: the service environment
name `production` and the D1 API's `version:production` are Cloudflare terminology, not MannerPath's release
production deployment. No release/version equivalence or production gate check is established by them.

**Current production conclusion:** the configured Worker is absent in this account; no active deployment/version
exists at that name. Production canonical/report database names are absent from the account inventory.
R2 is reported not enabled. This is a deployment-readiness blocker, not evidence that an eventual release
collects nothing, nor proof that no historical/alternate-host data exists.

### Logs, fields, analytics and retention

| Scope | Actual fields and retention established by this audit |
| --- | --- |
| Configured production Worker invocation/console/traces | No existing Worker to inspect. Live runtime settings and retained records: **not applicable at this target today**; future deployment: UNKNOWN |
| IP, User-Agent, URL/tile path, timestamp, request identifiers | No production event/request record inspected or field absence proved. All requested retained-field questions: **UNKNOWN / MANUAL CHECK** for provider/alternate/historical records |
| Workers Logs | Production retention UNKNOWN; E2E console persistence enabled, but contents and plan-specific retention not queried |
| Logpush exports / destinations | Jobs inaccessible (403); fields, enabled state, destination retention/access/deletion UNKNOWN |
| Analytics Engine / Web Analytics / platform analytics | No production binding or Worker; account product enablement, datasets, raw-versus-aggregate access and retention UNKNOWN. Empty zone/Pages inventories do not answer all analytics products |
| D1 / R2 / historical reports, auth keys and photos | No production-named resources; no row/object contents inspected. Historical collection, aliases and retention UNKNOWN; R2 lifecycle unavailable |
| Public site and support mailbox | Policy page reachable; hosting analytics/security logs and mailbox contents/retention UNKNOWN |

Cloudflare's documented Workers Logs limits (Free 3 days / Paid 7 days) describe the product, not this account's
plan or actual retention. No duration is assigned to inaccessible products or exports. Maintainer must obtain
sanitized settings/field names and documented plan/export retention; do not export raw personal records.

Release changes inspected:

| PR | Main merge | Privacy relevance |
| --- | --- | --- |
| #173 | `5ed06ea` | Local release preflight includes the bound R2 bucket; not a production creation receipt |
| #174 | `0d92163` | Submission packet and conditional label recommendations |
| #175 | `19c36a9` | Availability-aware Reports/privacy UI; no browsing registration |
| #176 | `3464587` | Visual RC/local fixture evidence; not production traffic evidence |
| #177 | `d70139c` | Public policy/support and configured app links |
| #179 | `7d8cbab` | Release public-site origin and both in-app links verified; Debug origin empty |

Worker source and `wrangler.jsonc` did not change in these PRs. Public-site owner/contact information
is supplied (#177/#179, [PUBLIC_SITE.md](PUBLIC_SITE.md)). #179 confirms Release Info.plist
`MannerPathPublicSiteURL=https://kounishiyuuki.github.io/MannerPath/`, with Release-build navigation to
`https://kounishiyuuki.github.io/MannerPath/privacy/` and
`https://kounishiyuuki.github.io/MannerPath/support/` verified. Debug's public-site URL is empty.
Contact is `mannerpath.support@gmail.com`. These public-site URL/access gates are closed; they do not
establish a production API origin, signed distribution archive, mailbox delivery or live privacy settings.

## Confirmed implementation facts

| Area | Confirmed in repository | Production limitation |
| --- | --- | --- |
| Worker | `mannerpath-api-production`, `src/index.ts` fetch/scheduled entry | Absent in audited account; no active production version; alternate hostname/build origin UNKNOWN |
| Logs | All environments: `observability.enabled:true`, `logs.enabled:true`, `invocation_logs:false` | Committed disable is not proof of live settings; console logging remains enabled |
| Other telemetry configuration | No Analytics Engine binding, Logpush property, tail consumer, explicit trace configuration or sampling override committed | Account jobs, integrations, security products, analytics and defaults UNKNOWN |
| Cron | `triggers.crons:[]` in every environment | No production schedule at absent target (404); historical/manual activity UNKNOWN |
| D1 | Separate `DB` / `REPORTS_DB`; production IDs are placeholders ending in 0 / 1 | Config is not deployment-ready; does not establish absence of existing account databases |
| R2 | `RAW_ARTIFACTS` names `mannerpath-raw-artifacts-production` | R2 API reports not enabled; lifecycle/access UNKNOWN; binding is for publisher artifacts, not photos |
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
  rejects photo intake. The Apple shipping composition has no photo uploader. No configured production deployment exists; alternate-target code/version remains UNKNOWN.
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

The following is the final recommendation of this audit for the intended release. It does not invent
production collection, and cannot authorize submission before the release target exists and is checked.
No category is confirmed **COLLECTED** by observed production records.

| Category | Final classification | Reason / required closure |
| --- | --- | --- |
| Precise Location | **UNKNOWN / SUBMISSION BLOCKER** | Raw GPS stays local in audited flow; verify release/provider behavior and whether retained z14–16 paths reconstruct user position at Apple's precise resolution. IP alone does not prove precise location collection |
| Coarse Location | **CONSERVATIVE DISCLOSURE** | Pending retained-field evidence, recommend collected, linked, App Functionality, not tracking for identifiable geographic requests. This fallback does not remove the audit blocker or authorize location history |
| Device ID | **UNKNOWN / SUBMISSION BLOCKER** | No browsing registration in source, but no production auth gate/version or retained provider-identifier evidence |
| User Content | **UNKNOWN / SUBMISSION BLOCKER** | Intended report intake off; absence of Worker is not a tested gate. Historical reports and customer-support retention/optional-disclosure eligibility unverified |
| Photos/Videos | **NOT COLLECTED** | Audited shipping composition has no uploader/store and config hard-codes photos off. Applies to reviewed composition only; verify signed archive and matching production deployment before submission |
| Diagnostics | **UNKNOWN / SUBMISSION BLOCKER** | No app upload; retained framework/provider diagnostic fields, correlation, purpose and retention unresolved. Do not equate an exception with an iOS crash |
| Usage Data / Product Interaction | **UNKNOWN / SUBMISSION BLOCKER** | No app analytics SDK; inaccessible account analytics/exports do not prove no retained interaction data. Aggregate counts alone do not establish collection |
| Crash Data | **NOT COLLECTED** | No app crash SDK/MetricKit upload in reviewed implementation; verify signed archive/dependencies and matching production deployment. Apple system diagnostics are a separate workflow |

**Top-level recommendation:** do not select “Data Not Collected” or submit yet. Resolve UNKNOWN categories,
then enter actual collected types; the Coarse Location fallback is a conservative disclosure, not observed
collection. Final linkage/purposes require retained-field/use evidence. No tracking/advertising was found
in reviewed app code; account/export use remains unverified. Photos/Crash conclusions are source-scoped,
not an assertion of a production build verification.

Support mail/external public-site visits require a separate workflow check (retained email/content, providers,
purpose and applicable optional-disclosure criteria). A mailto link is not an in-app collection SDK, but optional
support is not automatically exempt. Public-site publication and Release navigation are confirmed by #179; mailbox retention remains unverified.

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

Authenticated inventory confirms the configured production Worker and production-named D1 resources are absent;
R2 reports not enabled. Creation is a **separate authorized maintainer operation**, not this audit. Follow [release checklist §3](RELEASE_CHECKLIST.md) after inventory/review; do not create duplicates.
Existing deployment checks must not be performed with a mutating smoke/report client unless separately authorized.

## Policy and deployment decisions

### Published Privacy Policy comparison — correction required

**Status 2026-10-05:** Policy lane (2026-10-05): the published policy no longer asserts a running server or live log settings; §2 now says providers may process/record IP and request information, error diagnostics may remain, and confirmed fields/retention will be added; §8/§9 disclose the Gmail support mailbox. Last updated 2026-10-05 (JA/EN). Still open: actual provider fields/retention after deployment, §5 gate/build evidence, mailbox retention.

`https://kounishiyuuki.github.io/MannerPath/privacy/` returned its Japanese/English page via read-only HTTPS
GET on 2026-10-05 JST (effective/updated October 4, 2026). The page correctly describes tile IDs, on-device
GPS, Apple services, no app analytics/crash SDK, and intended initial-v1 reports/auth/photos unavailable.
However §2 presents the server as already running on Cloudflare and invocation logs as disabled in actual
server settings. This audit finds no configured production Worker. **Correction is required**: distinguish
planned/repository configuration from live deployment until verified, in both languages. Proposed meaning:
“The initial production service is being prepared on Cloudflare. Its reviewed configuration disables automatic
invocation logs; actual deployment settings will be verified before release.” Do not claim an observed live disable.

Before launch, replace preparation wording with verified deployed behavior and disclose actual retained
provider/diagnostic fields, purposes, duration or retention criteria, access/deletion and exports as applicable.
Current policy gives no concrete provider retention evidence; do not insert speculative durations.
§5's unavailable-feature claim still needs matching runtime/build confirmation; §9's normally-no-identifying-data
statement needs support/provider verification. Public-site traffic and the support mailbox are independent
privacy checks. The policy was not republished or modified by this read-only audit.

No ADR or telemetry behavior changes are proposed.
Before publication/submission, reconcile its provider/retention/purpose/deletion statements with the evidence above;
update policy, labels and applicable manifests if actual collection differs. Do not invent retention durations.
If identifiable tile history exists, resolve the conflict with [OPERATIONS.md](OPERATIONS.md)'s no-history rule;
conservative disclosure alone does not authorize prohibited history. Sampling is not a fix.

Before production deployment: complete account inventory; review real, distinct D1 IDs and the bound R2 resource;
complete local preflight/data review; obtain logging/privacy signoff; preserve required attestation, unavailable
report/auth configuration, photos off and crons empty. Resource provisioning/deployment remain separate maintainer
operations. After deployment, confirm actual settings/version/gates and signed-build traffic, publish the
corrected policy at the already-confirmed public URL, then finalize ASC labels. **UNKNOWN remains a submission gate.**

## Validation

Documentation-only change. Existing API/contract tests exercise committed deployment safety, config availability,
fail-closed App Attest and photo gates; they do not validate an account's settings or personal-data retention.
Authenticated follow-up validation, rerun after #179 finalization (2026-10-05 JST):

- `PATH=/opt/homebrew/opt/node@24/bin:$PATH make api-validate` — PASS (typecheck, API tests and discovery tests; exit 0).
- `make contract` — PASS (`MannerPath contract files present.`; exit 0).
- `git diff --check` — PASS (exit 0).

Focused read-only final document review found no findings. The initial finalization `make contract` attempt
from `services/api` reported `No rule to make target 'contract'`; rerunning from repository root passed.
These checks do not establish live privacy behavior.

## Submission blockers and maintainer actions

- Confirm this audited account is the intended release account and pin the signed build's actual API origin;
  alternate targets are not covered. There is currently no production service to serve App Review.
- Before any separately authorized deployment, inventory/review distinct canonical/report D1 resources, R2
  enablement/bucket and local preflight. Never substitute the disposable E2E DB for production. Placeholder IDs
  remain deliberate repository safety values; resource provisioning and real-ID review are maintainer actions.
- Obtain read-only dashboard evidence for Logpush (403), analytics products (404/incomplete access), plan and
  provider/export retention, historical/alternate data and support/site handling. Resolve retained fields and
  any prohibited identifiable tile history before privacy signoff; disclosure alone is insufficient.
- Keep required attestation without report-enabling App Attest configuration, photos off, community inactive
  and crons empty. Current absence of the Worker prevents verifying runtime false/false or report/auth/photo
  rejection. After separate deployment, GET config and inspect reviewed code/settings/build traffic; do not
  create reports, keys or photos in a read-only audit.
- Correct/publish the bilingual policy, verify archive/manifests, resolve all UNKNOWN categories and sign final
  ASC answers before submission. This documentation can merge independently of these submission gates. No deployment or activation is authorized by this record.

## Next policy lane — concrete bilingual handoff (do not edit `site/` in this PR)

**Status 2026-10-05:** items 1–2 done with durable wording (no time-bound “being prepared” sentence and no live-setting claim). Item 3 is done as wording only: processing/recording is possible, and fields/retention will be added. Items 5–6: the §6 provider note, the §9 identification claim softened, the Gmail mailbox disclosed, and dates updated. Evidence-dependent parts of 3–6 remain open.

#179 closes URL configuration and Release-link reachability, not policy accuracy. The next writer owns
`site/privacy/index.html` and publication through the existing Pages workflow:

1. §2 server status: replace Japanese “本アプリのサーバーは Cloudflare 上で動作しています。” and English
   “MannerPath's server runs on Cloudflare.” with preparation wording until production exists. Suggested Japanese:
   “初回公開版のサーバーは Cloudflare 上で準備中です。公開前に本番環境の設定を確認します。” Suggested English:
   “The initial production service is being prepared on Cloudflare. We will verify its settings before release.”
2. §2 logging: change the Japanese/English assertion that actual server settings turn off invocation logs to
   “レビュー済みの設定では、自動 invocation log を無効にしています。本番環境への反映は公開前に確認します。” /
   “The reviewed configuration disables automatic invocation logs. We will verify the deployed settings before release.”
   Keep the no-identification/no-location-history commitment; do not claim inaccessible provider records are absent.
3. §2 provider processing: after manual evidence, state actual retained IP/UA/URL/tile/time/request-ID and diagnostic
   fields, purposes, retention duration or criteria, export recipients and deletion/access handling. Until evidence
   exists, explicitly distinguish processing possibilities from verified retention; invent no duration or disablement.
4. §5 reports/auth/photos: retain intended read-only-v1 behavior, but confirm deployed gates and signed-build traffic
   before presenting it as release evidence. Feature activation requires a separate policy/label review first.
5. §6 analytics and §9 identifying data/contact: distinguish no app SDK from provider analytics/diagnostics;
   substantiate the normally-no-identifying-data statement and customer-support handling. Confirm mailbox delivery,
   response owner and retention/deletion criteria; the address itself is already confirmed.
6. Update the Japanese/English revision dates together and verify both corrected pages and Release navigation.
   Preserve #179's known origin, privacy/support URLs, Debug behavior and contact; do not reopen those resolved gates.

## Next provisioning lane — remote actions requiring separate authorization

This is a plan only; none of these actions was executed. Follow [release checklist §3](RELEASE_CHECKLIST.md)
and [OPERATIONS.md](OPERATIONS.md), with reviewed corpus/plan digests and privacy signoff:

1. Confirm release account and inventory again to avoid duplicates; enable R2 through the maintainer dashboard.
2. Create canonical D1 `mannerpath-production`, durable D1 `mannerpath-production-reports`, and R2 bucket
   `mannerpath-raw-artifacts-production`. Never reuse `mannerpath-e2e-p35` by assumption.
3. Land real, distinct production D1 IDs and production-only placeholder-test changes in a reviewed PR;
   verify RAW_ARTIFACTS binding and run pre-landing/local publication/preflight review.
4. Separately authorize remote migrations for both D1 streams and reviewed canonical promotion/import/finalization,
   then Worker deployment `mannerpath-api-production`. These are remote writes, outside this audit.
5. Set/verify the release HTTPS API origin, deployed version/bindings and actual observability. Keep invocation logs
   off; review console error context/exports for prohibited fields. Keep crons empty and community inactive.
   Read-only v1 needs no report-enabling secrets; preserve required attestation with intake unavailable and photos off.
6. After deployment, collect read-only config/gate/build evidence and resolve Logpush/analytics/retention manual
   checks. No registration/test report/photo creation is authorized as part of a read-only verification.
   Finish policy/labels/archive checks before App Store submission.
