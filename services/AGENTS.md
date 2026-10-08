# AGENTS.md — Backend and data pipeline (`services/**`)

Area contract for `services/api` (Cloudflare Workers, ADR-0003) and `services/data-pipeline`.
The root `AGENTS.md` still applies in full; nothing here repeats it.

Validation: `make api-validate`.

## What to read for this task

Read only the rows that match what you are changing. No document below is required for
every backend task — an endpoint change does not pull in the data-pipeline README unless
it touches ingest or reconciliation.

| Your change concerns | Read |
| --- | --- |
| an endpoint, or a request/response shape | `docs/API.md` |
| D1 schema, migrations, or Worker/runtime setup | `services/api/README.md`, ADR-0003 |
| tile generation, tile publication, or sync | ADR-0005, ADR-0015, `contracts/tiles/slippy-xyz-vectors.v1.json` |
| evidence, reconciliation, or publication gating | ADR-0006 |
| evidence tiers, confidence axes, community reported/verified, freshness, ranking inputs | ADR-0012 |
| community findings, confirmations, absence review, coverage tasks, seed areas, acquisition metrics | ADR-0013 |
| the report store, the community artifact boundary, blue/green with reports, report moderation tooling | ADR-0014 |
| report terms versions, community publication activation/rollback (`COMMUNITY_PUBLICATION`) | `docs/legal/COMMUNITY_PUBLICATION_DECISION.md`, `docs/COMMUNITY_LAUNCH_CHECKLIST.md` |
| ingest, importers, normalization, or provenance | `services/data-pipeline/README.md`, `docs/DATA_POLICY.md`, ADR-0002 |
| source adapters, multi-source/multi-release matching, nationwide pipeline boundaries | ADR-0008 |
| relocation, natural keys, relocation holds | ADR-0009 |
| geocoding an official address, derived coordinates | ADR-0011 (Proposed; publication not approved) |
| adding, approving, or changing a data source | `docs/SOURCES.md`, `docs/DATA_POLICY.md` |
| the beta corpus's coverage, freshness, or measured quality | `docs/BETA_DATA_QUALITY.md` |

## Dependencies and build

- Dependency versions are pinned exactly in `package.json`; `package-lock.json` is committed. Do not introduce ranges.
- Node >= 24. Use the existing `npm` scripts rather than inventing new command lines.

## Database and migrations

- D1 schema changes are new numbered files under `services/api/migrations/` (canonical `DB`) or
  `services/api/migrations-reports/` (durable `REPORTS_DB`, ADR-0014). Never edit an applied migration in place, never
  put a canonical table in the report stream or a report table in the canonical stream, and never write a destructive
  statement in the report stream: that database is long-lived and is never rebuilt.
- Only local D1 is configured. Nothing here may target a remote database; every environment in `wrangler.jsonc` — local, `staging` and `production` — keeps the all-zero placeholder `database_id`, and `test/deploy-config.test.ts` fails if one is replaced. Standing up a real environment is `docs/OPERATIONS.md`, and a maintainer's action.
- Tests run the real migrations through the node:sqlite D1-shaped adapter in `test/`.

## Publication and provenance

- A spot is publishable only through the source registry: a source that is not approved in `docs/SOURCES.md` and the `sources` table stays excluded from published tiles (ADR-0006).
- Raw evidence and reconciled records stay distinguishable; do not collapse ingest output into published output.
- An importer must have fixtures and tests before it is scheduled.

## API surface

- Request/response shapes are validated with Zod and documented in `docs/API.md`. Changing a shape means updating `docs/API.md` in the same change.
- Tile responses keep their ETag / `If-None-Match` behavior.
