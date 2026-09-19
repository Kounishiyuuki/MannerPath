# ADR-0006 — Evidence, resolution and publication

Status: Accepted (physical schema pending)

## Context

The product's core claim — "smoking is permitted / an ashtray exists here" — must be traceable to evidence. A host context (e.g. a convenience store) is not evidence.

## Decision

### Evidence model

- Raw source evidence is preserved: source (registered in `docs/SOURCES.md`), source record ID, observation time, fetch/import time, and the raw values asserted.
- Accepted user reports can become evidence; reports never edit canonical rows directly.
- Canonical resolved values retain **field-level provenance**: for each resolved attribute (existence, tobacco support, access, hours, …) it is possible to tell which evidence it came from.
- API hot paths read resolved canonical data, not raw evidence.
- The physical D1 schema is **not fixed** by this ADR. In particular, a generic `(field, value_json)` claim table is not adopted by default. The concrete schema is decided immediately before the first migration and recorded as an amendment to this ADR. Source-derived inputs for that decision (the first municipal source's fields, dataset-level observation date, source-release provenance, open questions about stable record keys) are in `docs/research/2026-09-launch-dataset-and-tile-zoom.md` §3 and §7.

### Publication invariant

A spot is published (included in tile data) only if:

1. its lifecycle is `active`, and
2. it has accepted **existence evidence** from an approved source or verification process.

A host such as a convenience store never creates a published smoking spot by itself. An `ashtray` tag attached to an arbitrary feature is not by itself accepted existence evidence (see `DATA_POLICY.md`).

### Lifecycle vs verification

- Lifecycle: `active | temporarilyClosed | removed`.
- Verification/evidence quality is a separate axis and never encoded in `spotType`.

### lastVerifiedAt

`lastVerifiedAt` is the observation time of the most recent accepted existence evidence. It is never the import or fetch time. If a source provides only a dataset-level date, that date is used; if it provides none, `lastVerifiedAt` is unknown.

### Quality vs freshness

- Evidence quality is stable and computed server-side; it only changes when evidence changes.
- Freshness is computed client-side from `lastVerifiedAt`. The server does not bake time decay into tile data (which would change ETags without data changes).

### Algorithm versioning

Evidence-quality/confidence and ranking algorithms carry explicit versions so results are reproducible and changes are traceable.

### Identity

- Canonical spot IDs are opaque, stable and server-assigned.
- Source IDs are mappings to canonical spots, not canonical IDs. Clients never derive canonical IDs.
- Merges are represented by `mergedInto` redirects so client references (favorites, recents) survive.

## Consequences

- Importers must emit evidence, not canonical rows.
- A resolution step produces canonical values + provenance; a publish step enforces the invariant and updates tile revisions (ADR-0005).
- Report privacy/retention requires a separate ADR before the report API ships.
