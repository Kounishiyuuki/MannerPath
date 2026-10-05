# API service

Stack: Cloudflare Workers + TypeScript + Hono + Zod + D1 (ADR-0003). Versions are pinned exactly in `package.json`, and `package-lock.json` is committed.

See `../../docs/API.md`, `../../docs/adr/0006-evidence-and-publication.md` (Issue #12 amendment) and `../../docs/adr/0007-report-privacy-and-retention.md` (user reports).

## Contents

- `migrations-reports/`: the durable report store's own stream (`REPORTS_DB`, ADR-0014): reports, moderation, review decisions, App Attest state, rate limits, store identity. Append-only and non-destructive; never applied to the canonical database.
- `migrations/`: canonical D1 schema (`DB`). `0025` makes the legacy report tables inert and adds the community artifact ledger and sanitized evidence (ADR-0014). `0001` is the initial schema. `0002` adds spotType `unknown` and must run before any spot exists. `0003` adds the user-report tables. `0008` adds the immutable, derived `source_observations` layer the resolver reads (ADR-0008 decision 2). `0019` adds the cross-source review and merge tables and their promotion attestations (ADR-0008, Issue #107). `0020` adds community report reconciliation: immutable applications, their report links and the apply guards (ADR-0007 amendment, Issue #123). `0030` adds the append-only ADR-0017 tables: reviewed area anchors bound to their publication, spot→anchor bindings, exact-point precision upgrades (the only way out of `areaApproximate`, with a current-comparison premise), the per-spot location authority chain (anchor → exact upgrade → later ADR-0009 relocations/forward-only continuations; location provenance and coordinate always equal its latest row, which must equal the evidence that exists now), the reviewed area-point mappings anchors are read through, REPLACE guards on releases/records/observations, the import-only location evidence attestations (current vs historical) and the relocation delta audit that admits an anchor→exact move into ADR-0009's premise.
- `src/pipeline/`: source-agnostic ingest (raw evidence) and first-release reconciliation behind the `SourceAdapter` boundary (`source-adapter.ts`, `adapters.ts`, ADR-0008); Taito is the first adapter (`taito-adapter.ts`, field rules in `taito.ts`); the reviewed source registry is `registry.ts`.
- `src/refresh/`: scheduled source checks — fetch, sha256 fingerprint, content-addressed R2 retention, drift probes and review candidates (`0017`, ADR-0008 source refresh amendment). Check-only: nothing here ingests, resolves or publishes.
- `src/tiles/`: tile DTO v1 (Zod) and the publish step.
- `src/app.ts`: `GET /v1/config`, `GET /v1/tiles/{z}/{x}/{y}` with ETag / `If-None-Match`, `GET /v1/spots/{id}` and `POST /v1/reports`.
- `src/config/`: the `GET /v1/config` compatibility body, built from the canonical constants the rest of the code enforces.
- `src/pipeline/promotion.ts`: the deterministic promotion bundle (`npm run local:export`) that carries a validated local release (v2) or several sources' current releases (v3, `--bundle v3`) to another database.
- `src/reports/`: the report API (ADR-0007) — strict request schema, hashed-submitter rate limiting, the App Attest boundary, retention/minimization and moderation state.
- `src/geo/tile.ts`: Slippy XYZ tile math, checked against `contracts/tiles/slippy-xyz-vectors.v1.json`.
- `test/`: node:test suites. They run on node:sqlite through a D1-shaped adapter that applies the real migrations.

## Commands (Node >= 23.3)

Segmented v4 filesystem tools require **Node >=24**. See
[SEGMENTED_PROMOTION_RUNBOOK](../../docs/SEGMENTED_PROMOTION_RUNBOOK.md) for
`promotion:v4:build`, `promotion:v4:verify`, `promotion:v4:apply-local`, resumability and capacity policy.
They never connect to remote D1. v2/v3 commands and artifact verification remain available.
The full API test suite now includes v4 cursor tests, so run `make api-validate` with Node >=24 on PATH.

```sh
npm ci
npm test                 # all tests
npm run typecheck        # tsc on src/ (Worker types)
npm run local:migrate    # wrangler d1 migrations apply DB --local
npm run local:reports:migrate   # wrangler d1 migrations apply REPORTS_DB --local (the report store, ADR-0014)
npm run local:pipeline   # ingest -> resolve -> publish the Taito fixture into local D1
npm run dev              # wrangler dev --local
npm run local:reports    # moderation queue / decisions / retention pass (local D1 only)
npm run local:smoke      # read-only smoke checks against http://127.0.0.1:8787
npm run local:export     # validate local state and build the promotion bundle (local D1 only)
```

`local:smoke` verifies `/v1/config`, a tile `200`, the `ETag`/`304` pair, the `tileNotPublished`
`404`, spot detail, attribution and how the report endpoint is configured. It targets loopback
unless both `--base-url` and `--remote` are given, and it never submits a valid report.

`local:export` (`src/pipeline/promotion.ts`) validates the published local state and emits the
**promotion bundle**: deterministic, reviewable SQL carrying one release's registry row, evidence,
canonical spots, provenance and tile snapshots, with opaque IDs, revisions and attribution
preserved. It writes nothing without `--out`, refuses to export unapproved or inconsistent state,
and carries no report data. Applying it (`wrangler d1 execute … --remote --file`) is an explicit
human step.

The bundle is INSERT-only and **bootstraps an empty, freshly migrated database**; it cannot update a
populated one. Corrected data ships blue/green — a new D1 database the Worker is switched onto, with
the previous one kept for rollback (`../../docs/OPERATIONS.md` step 6).

Standing up and verifying a staging / production-like environment is `../../docs/OPERATIONS.md`;
nothing in this repository deploys or migrates a remote database.

Local and `staging` D1 bindings retain placeholder IDs. `env.production` binds the separately provisioned `mannerpath-production` and `mannerpath-production-reports` databases; `test/deploy-config.test.ts` pins their exact IDs. The bound `mannerpath-raw-artifacts-production` R2 bucket is also provisioned. This completes resource creation only: remote migrations, data import, deployment and report/community activation remain separate maintainer actions under `../../docs/RELEASE_CHECKLIST.md` §3.
The Taito source is `approved` in the registry (`docs/SOURCES.md`), so `local:pipeline` resolves all 34 records into canonical spots and publishes 32 of them into 5 z14 tile snapshots with the approved attribution text; the other 2 are withheld by the Issue #42 reconciliation (`docs/BETA_DATA_QUALITY.md` §3a). Sources that are not approved are excluded and listed under `excluded` in the publish report, and the D1 publication trigger rejects them even if the publisher is bypassed.

`local:pipeline` creates the Taito registry row from the reviewed entry in `src/pipeline/registry.ts` only when it is missing, and never rewrites an existing row. A local database created before the approval still holds the older `blocked` Taito row; upgrade it deliberately with:

```bash
npm run local:registry   # re-apply the reviewed registry entries (local D1 only)
npm run local:pipeline   # republish so the tiles reflect the new status
```

Only sources listed in `REVIEWED_SOURCES` can be registered or approved by this code; anything else throws. Approving a new source is a repository change (`docs/SOURCES.md` + that list), reviewed in a PR.

## User reports (ADR-0007)

`POST /v1/reports` stores an immutable proposal with moderation state `pending` in the durable report
store (`REPORTS_DB`, ADR-0014). It never writes the canonical database. A reviewer decides in the
report store (`src/reports/review.ts`) and exports the decision as a sanitized, deterministic artifact;
the canonical pipeline imports it (`src/pipeline/community-artifact.ts`: replay-protected ledger) as a
proposed application, which the existing apply steps turn into a sanitized `userReport` release of the
currently **blocked** `mannerpath-community-reports` source.

Moderation and retention run against the report store, local by default (`npm run local:reports`);
remote only via `npm run reports:moderate -- --remote …` from a maintainer's terminal. There is no
authenticated admin HTTP surface. The full command list is at the top of `scripts/report-queue.ts`.

```sh
npm run local:reports                                         # pending queue (never shows the submitter key)
npm run local:reports -- decide rp_... accepted reviewer-1 confirmed   # reason code, never free text
npm run local:reports -- queue rp_... queued                  # accepted reports only; 'applied' only via apply
npm run local:reports -- retain                               # minimize reports past 90 days, purge rate counters
npm run local:reports -- candidates 50                        # group queued missing reports within an explicit radius (m)
npm run local:reports -- propose reviewer-1 rp_A rp_A rp_B    # decidedBy, adopted-pin report, evidence reports
npm run local:reports -- export ca_... community-artifacts    # seal the sanitized artifact (REPORTS_DB)
npm run local:reports -- import community-artifacts/<sha256>.json   # imported | alreadyImported | conflict | stale | refused
npm run local:reports -- apply ca_...                         # sanitized userReport release -> resolve, one batch
npm run local:reports -- withdraw ca_...                      # terminal; its reports can back nothing else
npm run local:reports -- summary                              # counts per state: pending -> accepted -> queued -> applied
npm run local:reports -- effects-queue                        # queued existing-spot reports (REPORTS_DB): counts, submitters, consent
npm run local:reports -- effects                              # imported effect applications: attested submitters, rights, stale, hold
npm run local:reports -- effect-propose reviewer-1 rp_A rp_B  # one type, one spot; `other` has no effect (Issue #127)
npm run local:reports -- effect-apply ce_...                  # records the review candidate; changes nothing canonical
npm run local:reports -- effect-hold ce_...                   # prohibited only; `blocked` until community rights hold (#124)
npm run local:reports -- effect-lift ce_... reviewer-2        # reviewed lift, then republish
# ADR-0013 community acquisition (migration 0024). Read-only triage; there is no bulk accept.
npm run local:reports -- triage pending missing,correction     # filter by category; optional flag: duplicateCandidate|highReportCount|conflicting|old
npm run local:reports -- triage-summary                       # pending / accepted / rejected / applied / rightsBlocked per category
npm run local:reports -- evidence                             # per spot: normal | needsRecheck | reviewCandidate | held, + conflicting
npm run local:reports -- corrections                          # moved pins: awaitingIndependentConfirmation | relocationCandidate
npm run local:reports -- duplicates                           # new-spot proposals within 50 m of a live spot or another proposal
npm run local:reports -- absence-propose reviewer-1 rp_A rp_B  # notFound/removed reports about one spot
npm run local:reports -- absence-apply cn_...                 # review candidate only; nothing canonical changes
npm run local:reports -- absence-hold cn_...                  # unpublish; `blocked` until 2 independent submitters AND rights (#124)
npm run coverage:targets -- --json                            # research replay -> community acquisition targets + seed priority
```

App Attest (ADR-0007 §6, Issue #37) lives in `src/attest/`: a minimal CBOR and DER/X.509 reader,
Apple's attestation and assertion checks, the `clientDataHash` binding, and the D1 challenge/key
store (migration `0007_app_attest.sql`). No dependency was added: WebCrypto (ECDSA P-256/P-384)
verifies every signature, and the two parsers accept only what App Attest uses. `REPORT_ATTESTATION`
unset or `disabled` is the local/test default — report schema 1, unattested. `required` enforces
App Attest (schema 2) only when `REPORT_APP_ATTEST_APP_ID`, `REPORT_APP_ATTEST_ENVIRONMENT` and
`REPORT_APP_ATTEST_BUNDLE_VERSIONS` (exact accepted `CFBundleVersion` values, comma-separated) are
set; without them, or with any unrecognised value, every report and App Attest endpoint answers
`503`. The committed `staging` and `production` environments set `required` and none of those values, so a
deployed environment accepts no reports until a maintainer configures it (`docs/OPERATIONS.md`).

Deployment settings this repository deliberately does not contain: `REPORT_SUBMITTER_PEPPER`
(hashed abuse key pepper), `REPORT_APP_ATTEST_APP_ID` (its App ID prefix is usually the Team ID),
`REPORT_APP_ATTEST_ENVIRONMENT`, `REPORT_APP_ATTEST_BUNDLE_VERSIONS` and the edge rate-limit rule. No Apple key or pepper value is committed.
