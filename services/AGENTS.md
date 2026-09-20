# AGENTS.md — Backend and data pipeline (`services/**`)

Area contract for `services/api` (Cloudflare Workers, ADR-0003) and `services/data-pipeline`.
The root `AGENTS.md` still applies in full; nothing here repeats it.

Read before editing: `services/api/README.md`, `services/data-pipeline/README.md`,
`docs/API.md`, `docs/SOURCES.md`, ADR-0003, ADR-0005, ADR-0006.
Validation: `make api-validate`.

## Dependencies and build

- Dependency versions are pinned exactly in `package.json`; `package-lock.json` is committed. Do not introduce ranges.
- Node >= 23.3. Use the existing `npm` scripts rather than inventing new command lines.

## Database and migrations

- D1 schema changes are new numbered files under `services/api/migrations/`. Never edit an applied migration in place.
- Only local D1 is configured. Nothing here may target a remote database; `wrangler.jsonc` keeps a placeholder `database_id`.
- Tests run the real migrations through the node:sqlite D1-shaped adapter in `test/`.

## Publication and provenance

- A spot is publishable only through the source registry: a source that is not approved in `docs/SOURCES.md` and the `sources` table stays excluded from published tiles (ADR-0006).
- Raw evidence and reconciled records stay distinguishable; do not collapse ingest output into published output.
- An importer must have fixtures and tests before it is scheduled.

## API surface

- Request/response shapes are validated with Zod and documented in `docs/API.md`. Changing a shape means updating `docs/API.md` in the same change.
- Tile responses keep their ETag / `If-None-Match` behavior.
