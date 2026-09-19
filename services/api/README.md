# API service

Target stack: Cloudflare Workers + TypeScript + Hono + Zod + D1.

Do not initialize package versions blindly. Pin current stable versions when the service is bootstrapped and commit the lockfile.

See `../../docs/API.md` and `../../docs/adr/0003-backend.md`.

## Current contents (no routes yet)

- `migrations/0001_initial_schema.sql` — first D1 schema (ADR-0006 amendment).
- `src/geo/tile.ts` — Slippy XYZ tile math, checked against `contracts/tiles/slippy-xyz-vectors.v1.json` (ADR-0005).
- `test/` — schema and tile-vector tests.

`npm test` runs them with Node's built-in test runner, type stripping and `node:sqlite` (Node >= 23.3; no npm dependencies). There is no TypeScript type-check yet, and Wrangler/Hono/Zod are not bootstrapped.
