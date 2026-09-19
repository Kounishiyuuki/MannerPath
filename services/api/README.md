# API service

Stack: Cloudflare Workers + TypeScript + Hono + Zod + D1 (ADR-0003). Versions are pinned exactly in `package.json`, and `package-lock.json` is committed.

See `../../docs/API.md` and `../../docs/adr/0006-evidence-and-publication.md` (Issue #12 amendment).

## Contents

- `migrations/`: D1 schema. `0001` is the initial schema. `0002` adds spotType `unknown` and must run before any spot exists.
- `src/pipeline/`: Taito ingest (raw evidence), first-release reconciliation, and the field rules in `taito.ts`.
- `src/tiles/`: tile DTO v1 (Zod) and the publish step.
- `src/app.ts`: `GET /v1/tiles/{z}/{x}/{y}` with ETag / `If-None-Match`.
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
```

Only local D1 is configured. `wrangler.jsonc` has a placeholder `database_id`, and nothing here targets a remote database.
The Taito source is `blocked` in the registry, so `local:pipeline` resolves all 34 records but publishes none of them (its report lists them under `excluded`). The tile endpoint therefore returns `404 tileNotPublished` for Taito tiles until the source is approved in `docs/SOURCES.md` and the `sources` table.
