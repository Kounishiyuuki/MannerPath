# MannerPath v1 Release Security Gate

Audit date: 2026-10-09. Baseline: `a37fdcfa5358814c5485efcc7f334dd8cfb5aa4e`.
Scope: repository, locally reachable history, Worker HTTP runtime, all four Apple shipping
bundles and local unsigned Release archive. No deploy, secret change, remote D1 mutation or
App Store submission is authorized or performed by this gate.

Release requires **P0 = 0 and P1 = 0**. A real secret suspect is a blocker pending classification
and rotation; never print the value or automatically rewrite history. Evidence gaps below remain
open even when source tests pass. This document is not production or App Store approval.

## Threat model and inventory

An attacker can extract any iPhone/Watch/widget binary and choose public request paths, methods,
headers, query, body and timing. Public origin URLs and bundle IDs are intentionally public.
Assets to protect: backend credentials, report/auth state, canonical publication integrity,
availability, and browsing/report privacy. Trust boundaries: Apple binary → public Worker →
canonical DB for reads; verified writes → separate durable REPORTS_DB; credentials → Cloudflare
secret bindings. Config never reads a database or spreads environment fields into responses.

| Inventory | Result / boundary |
| --- | --- |
| Swift, project settings, plist, entitlements, catalogs, test fixtures | No embedded client API secret found. Secret/token/authorization occurrences describe protocols, DeviceCheck, local state or explicit synthetic fixtures |
| Release generated configuration | Public HTTPS production Worker/site origins; Debug origins unset; no ATS exception |
| Watch, iPhone widget, Watch widget | No shared API credential or backend secret configuration |
| Worker vars / Env | Only remote `REPORT_ATTESTATION=required` committed; pepper and App Attest deployment values belong in environment-specific `wrangler secret put` bindings, never client/config/errors |
| Git history | Baseline scan: 470 reachable commits / 2149 distinct blobs; rescan after main advanced: 473 / 2159; no suspected values. Local refs only, not deleted/unreachable objects, remote-only refs or external account storage |
| Unsigned Release archive | Xcode 27 archive succeeded; all four bundles embedded, 36 files scanned, zero secret/debug-origin/ATS suspects; production HTTPS origins verified |
| Dependencies | Exact npm pins/lock; GRDB.swift 7.9.0 pinned to `aa0079aeb82a4bf00324561a40bffe68c6fe1c26`, HTTPS source, no remote binary |

No client-side API key exists to move server-side. Future providers needing a secret must use
**iPhone → MannerPath Worker → external provider** with the secret held only in Cloudflare.
Never distribute it to Watch/widgets or return it through public config. The proxy would need
bounded input/output, provider allowlisting and abuse controls; no unused proxy is implemented.
A shared extractable client API key is not an authentication boundary for public reads.

## Findings and fixes

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | Hono default unexpected-error logger could persist exception context including secret/location | Fixed in source: unlogged, constant JSON 503/no-store; no exception echo; regression tests |
| P2 | JSON size check followed unbounded whole-body allocation | Fixed: incremental byte limit, cancel oversized stream, reject compressed JSON; inactive writes reject before body read |
| P2 | Unbounded URL/query and conditional ETag input | Fixed: 4096-byte UTF-8 limits before database access |
| P2 | Credential/config regression protection incomplete | Added committed vars allowlist, Apple build-setting guards, redacting tracked/history/artifact scanner and negative scanner tests |

Read surface: canonical decimal tile/part parsing, bounded part policy, opaque spot ID validation;
malformed tile 400, absent/unpublished spot/tile 404, parts-required 409, readiness unavailable
503. Unsupported methods 404; HEAD has no body. JSON content types, public/no-cache ETags with
weak/list/star comparisons, no-store errors/readiness, no credentialed CORS. No request-derived
SQL identifiers or SQL interpolation found; input uses bind parameters. Dynamic offline pipeline
SQL uses controlled schema/placeholder/literal generation, not public request SQL.

DoS: body/path/query/conditional header bounds; no JSON-body decompression; part count/part
size, coverage probe and CBOR nesting budgets already exist. Public reads can still be repeated:
deployment-level traffic controls and capacity monitoring are operational controls, not client keys.
Legacy v1 tile bodies and DB DTO reads rely on the trusted, bounded publication pipeline.

Write surface: committed staging/production require App Attest but omit activation bindings,
so reports/challenges/keys return 503 and config says unavailable. Photos remain disabled in
the exported Worker. No unattested fallback; local-only test mode is separate. Existing tests
cover one-time challenges, assertion counters, bundle allowlists, replay and atomic report batches.
Before future activation require real-device App Attest, edge and application rate limits, body
and content limits, replay/idempotency semantics, abuse controls, consent/privacy and retention.
Identical consumed assertions are refused, not silently resubmitted after ambiguous delivery.

Logging: invocation logs false in every committed environment. HTTP errors no longer invoke
the framework console logger. No HTTP request middleware logs URL, tile ID, GPS, authorization,
attestation payload or report body. Scheduled source metadata logs remain separate. Historical,
platform or provider logs are not proved absent by a source-level guard.

## Accepted P2 and release evidence still required

| Item | Why not a read-only source blocker / follow-up |
| --- | --- |
| npm audit: 4 high package nodes (wrangler → miniflare → sharp/undici) | Dev-only tooling, not Worker production dependencies. Full audit exits 1; omit-dev audit has 0 vulnerabilities. The 2026-10-09 audit reports `fixAvailable=false` for all four nodes; this describes this audit result, not a claim about every upstream release. Keep local dev unexposed to hostile SVG/WebSocket/remote workloads and reassess pinned tooling before use/upgrade |
| Report rate counters best-effort under concurrency | Intake unavailable in v1; require edge limits and review atomic budgets before activation |
| App Attest source entitlement development | Dormant v1 capability, already documented. Inspect production environment on final signed TestFlight/archive before enabling writes |
| Apple URL parser permits HTTP in Debug/Release | Committed production HTTPS, ATS and archive/config guards prevent current unsafe shipping configuration. Tighten parser in a focused future change; no current HTTP fallback observed |

**Submission remains blocked pending human evidence:** final signed archive/physical-device and
Privacy Report checks, actual deployed hardening version, provider log fields/retention/export
settings and support handling/privacy approval (see PRODUCTION_PRIVACY_AUDIT.md and
APP_STORE_SUBMISSION.md). This work cannot verify current Cloudflare secret inventory remotely;
repository absence and the documented 2026-10-05 inactive deployment are not fresh account evidence.
Read-only `wrangler secret list --env production` was attempted in non-interactive mode; it
could not authenticate without an API token (and sandbox denied its default local log path).
No token was requested or configured, no temporary account created, and no remote changes made.

## Checklist and commands

- [x] Client secrets: source/config audit; public origin distinguished from credentials.
- [x] Backend secrets: committed vars allowlist; environment-specific secret management documented.
- [x] Git history: reachable local blobs scanned without printing values.
- [x] Auth/write APIs: inactive fail-closed; no fallback or production Debug activation.
- [x] Transport: committed HTTPS, ATS/TLS bypass audit; no insecure external TLS option found.
- [x] Logging/privacy: unlogged fixed HTTP exception boundary and invocation-log guards.
- [x] Injection: request input binds; canonical tile/part/spot validation.
- [x] DoS: bounded JSON streaming, URL/query/ETag; existing parser/publication budgets.
- [x] Dependencies: audit assessed by shipped exposure, exact pins inspected.
- [ ] Release archive: unsigned local scan recorded below; repeat on final signed archive.
- [ ] Human provider/privacy/deployed-version evidence and final release signoff.

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH make api-validate
make apple-validate
make contract
PATH=/opt/homebrew/opt/node@24/bin:$PATH make security-validate
# History scan is included in make security-validate.
python3 scripts/security-secret-scan.py --artifact <archive>/Products/Applications/MannerPath.app
python3 scripts/check-apple-beta-artifact.py <archive> --unsigned-build
cd services/api && npm audit && npm audit --omit=dev
git diff --check origin/main...HEAD
```

Scans are heuristic: known provider prefixes, JWT-looking values, PEM private keys, Authorization Bearer and credential assignments (including hex values),
not a guarantee against all possible secret encodings. Review generic keyword occurrences by
meaning. New opaque credential formats require extending detection. The secret artifact scanner examines raw binary/resource bytes (including printable Mach-O strings) and recursively decoded XML/binary plists. Public URLs and metadata are allowed. `check-apple-beta-artifact.py` owns Apple release correctness, nested key/loopback guards, origins, transport, signing and embedding; its existing all-target/all-configuration build-setting guard reuses the secret detector for literal values.

## Validation record

Branch findings after fixes: **P0 0 / P1 0 / accepted P2 4** (listed above).
**RELEASE BLOCKED: YES** pending final signed/provider/privacy evidence and verification that the
deployed release contains this hardening; the existing deployment is not changed by this PR.

Initial Node 24 `make api-validate`: PASS (typecheck, 919 API tests + 101 discovery tests).
`make apple-validate`: PASS (iOS tests, watchOS unit tests/build, generated Debug/Release origins).
The first sandbox run failed with `Could not resolve package dependencies: You don’t have
permission to save the file “repositories” in the folder “SourcePackages”.`; the same command
passed with local Xcode cache/simulator access. The first API run found the prior 500 assertion;
it was updated to the intentional fixed 503 and the full suite passed on rerun.

Local unsigned device archive and `check-apple-beta-artifact.py --unsigned-build`: PASS.
Artifact scanner: 36 files, 0 suspects. History scanner rescan: 2159 reachable blobs, 0 suspects.
Scanner/Apple guard tests: 5 PASS; focused API/deploy tests: 15 PASS.
Full npm audit: exit 1, 4 high dev-tool nodes; `npm audit --omit=dev`: PASS, 0 vulnerabilities.
`make contract` and working-tree `git diff --check`: PASS. Signed-build and remote evidence stay open.
Post-commit `git diff --check origin/main...HEAD` is required before push.

## Final hardening validation (2026-10-09)

Latest main `9cca5178fb3ca3ecdb8ae8cf038b40631e022282` was integrated by a normal merge; no rebase, force push or history rewrite. The gate now scans `rev-list --objects --all` and fails closed if no reachable blobs exist. Release requires reachable blobs > 0 and suspects = 0. Diagnostics include only path, commit and type. Regression fixtures prove detection of deleted credentials and credentials reachable only through another ref.

Fresh dependency audit: production vulnerabilities **0**; dev tooling **4 high** (`wrangler`, `miniflare`, `sharp`, `undici`). Full audit exits 1; omit-dev audit exits 0. No production dependency change was made. Cloudflare vars/config/error/logging boundaries remain guarded; invocation logs remain disabled in every committed environment. Live account settings, final signing, physical-device and privacy evidence remain outside this source gate.

Final verification after main integration: Node 24 `make api-validate` PASS (942 API + 101 discovery tests); `make security-validate` PASS (13 scanner tests, 2225 reachable blobs, 0 suspects, 15 API/deploy guards); `make apple-beta-preflight` PASS; saved unsigned Release archive PASS, secret scan 36 files / 0 suspects; Apple preflight regression suite 42 PASS; `make contract` and `git diff --check origin/main...HEAD` PASS. Final review: P0 0 / P1 0 / new P2 0, with the four accepted P2 follow-ups above retained. Latest main was advanced again to `c417f9a6e73d5086a76fd85f3d3721fcadda4dcd` during validation and integrated by another normal merge (documentation only). History blob counts increase with subsequent documentation commits.

Final `make apple-validate`: PASS (iOS tests, watchOS unit tests/build, generated Debug/Release public origins). Simulator output was delayed; both test actions succeeded without intervention.
