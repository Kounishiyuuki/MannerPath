# API service

Stack: Cloudflare Workers + TypeScript + Hono + Zod + D1 (ADR-0003). Versions are pinned exactly in `package.json`, and `package-lock.json` is committed.

See `../../docs/API.md`, `../../docs/adr/0006-evidence-and-publication.md` (Issue #12 amendment) and `../../docs/adr/0007-report-privacy-and-retention.md` (user reports).

## Contents

- `migrations/`: D1 schema. `0001` is the initial schema. `0002` adds spotType `unknown` and must run before any spot exists. `0003` adds the user-report tables.
- `src/pipeline/`: Taito ingest (raw evidence), first-release reconciliation, the field rules in `taito.ts`, and the reviewed source registry in `registry.ts`.
- `src/tiles/`: tile DTO v1 (Zod) and the publish step.
- `src/app.ts`: `GET /v1/config`, `GET /v1/tiles/{z}/{x}/{y}` with ETag / `If-None-Match`, `GET /v1/spots/{id}` and `POST /v1/reports`.
- `src/config/`: the `GET /v1/config` compatibility body, built from the canonical constants the rest of the code enforces.
- `src/pipeline/promotion.ts`: the deterministic promotion bundle (`npm run local:export`) that carries a validated local release to another database.
- `src/reports/`: the report API (ADR-0007) — strict request schema, hashed-submitter rate limiting, the App Attest boundary, retention/minimization and moderation state.
- `src/geo/tile.ts`: Slippy XYZ tile math, checked against `contracts/tiles/slippy-xyz-vectors.v1.json`.
- `test/`: node:test suites. They run on node:sqlite through a D1-shaped adapter that applies the real migrations.

## Commands (Node >= 23.3)

```sh
npm ci
npm test                 # all tests
npm run typecheck        # tsc on src/ (Worker types)
npm run local:migrate    # wrangler d1 migrations apply DB --local
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

Only local D1 is configured. `wrangler.jsonc` also carries the `staging` and `production` environment shapes, but every one of them keeps the all-zero placeholder `database_id`, so nothing here can target a remote database (`test/deploy-config.test.ts` enforces it).
The Taito source is `approved` in the registry (`docs/SOURCES.md`), so `local:pipeline` resolves all 34 records and publishes them into 5 z14 tile snapshots with the approved attribution text. Sources that are not approved are excluded and listed under `excluded` in the publish report, and the D1 publication trigger rejects them even if the publisher is bypassed.

`local:pipeline` creates the Taito registry row from the reviewed entry in `src/pipeline/registry.ts` only when it is missing, and never rewrites an existing row. A local database created before the approval still holds the older `blocked` Taito row; upgrade it deliberately with:

```bash
npm run local:registry   # re-apply the reviewed registry entries (local D1 only)
npm run local:pipeline   # republish so the tiles reflect the new status
```

Only sources listed in `REVIEWED_SOURCES` can be registered or approved by this code; anything else throws. Approving a new source is a repository change (`docs/SOURCES.md` + that list), reviewed in a PR.

## User reports (ADR-0007)

`POST /v1/reports` stores an immutable proposal with moderation state `pending`. It never writes
canonical or published tables, and an accepted report becomes evidence only through a separate
reconciliation step that does not exist yet.

Moderation and retention run locally; there is no authenticated admin HTTP surface.

```sh
npm run local:reports                                         # pending queue (never shows the submitter key)
npm run local:reports -- decide rp_... accepted reviewer-1 confirmed   # reason code, never free text
npm run local:reports -- queue rp_... queued                  # accepted reports only; 'applied' is unreachable
npm run local:reports -- retain                               # minimize reports past 90 days, purge rate counters
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
