# ADR-0004 — Offline discovery, online routing for v1

Status: Accepted

## Decision

v1 guarantees cached spot discovery, exact straight-line distance and bearing offline.

Pedestrian road routing is online in v1.

## Rationale

Full offline routing requires a map-tile distribution strategy plus a routing graph/engine, substantially increasing product and operational scope. It is not necessary to validate the core “find a usable nearby location fast” value proposition.
