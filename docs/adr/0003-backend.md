# ADR-0003 — Cloudflare Workers + D1 for v1 backend

Status: Accepted

## Decision

Use Cloudflare Workers, TypeScript, Hono and D1.

Location sync is tile/cell-based rather than PostGIS nearest-neighbor queries.

## Rationale

- very low initial operating cost;
- no idle database compute requirement;
- simple deployment model;
- tile resources are naturally cacheable;
- final filtering/ranking can happen on device and work offline.

## Trade-off

D1 is not PostGIS. Complex spatial workloads remain out of scope for this backend choice.

## Migration path

Keep geo access behind a repository/service boundary and API contract. Move to PostgreSQL/PostGIS when documented migration triggers occur.
