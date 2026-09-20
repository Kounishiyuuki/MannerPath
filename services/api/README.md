# API service

Stack: Cloudflare Workers + TypeScript + Hono + Zod + D1 (ADR-0003). Versions are pinned exactly in `package.json`, and `package-lock.json` is committed.

See `../../docs/API.md` and `../../docs/adr/0006-evidence-and-publication.md` (Issue #12 amendment).

## Contents

- `migrations/`: D1 schema. `0001` is the initial schema. `0002` adds spotType `unknown` and must run before any spot exists.
- `src/pipeline/`: Taito ingest (raw evidence), first-release reconciliation, the field rules in `taito.ts`, and the reviewed source registry in `registry.ts`.
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
The Taito source is `approved` in the registry (`docs/SOURCES.md`), so `local:pipeline` resolves all 34 records and publishes them into 5 z14 tile snapshots with the approved attribution text. Sources that are not approved are excluded and listed under `excluded` in the publish report, and the D1 publication trigger rejects them even if the publisher is bypassed.

`local:pipeline` creates the Taito registry row from the reviewed entry in `src/pipeline/registry.ts` only when it is missing, and never rewrites an existing row. A local database created before the approval still holds the older `blocked` Taito row; upgrade it deliberately with:

```bash
npm run local:registry   # re-apply the reviewed registry entries (local D1 only)
npm run local:pipeline   # republish so the tiles reflect the new status
```

Only sources listed in `REVIEWED_SOURCES` can be registered or approved by this code; anything else throws. Approving a new source is a repository change (`docs/SOURCES.md` + that list), reviewed in a PR.
