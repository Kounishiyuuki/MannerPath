# ADR-0006 — Evidence, resolution and publication

Status: Accepted. Physical schema added by the 2026-09 amendment below (Issue #8)

## Context

The product's core claim — "smoking is permitted / an ashtray exists here" — must be traceable to evidence. A host context (e.g. a convenience store) is not evidence.

## Decision

### Evidence model

- Raw source evidence is preserved: source (registered in `docs/SOURCES.md`), source record ID, observation time, fetch/import time, and the raw values asserted.
- Accepted user reports can become evidence; reports never edit canonical rows directly.
- Canonical resolved values retain **field-level provenance**: for each resolved attribute (existence, tobacco support, access, hours, …) it is possible to tell which evidence it came from.
- API hot paths read resolved canonical data, not raw evidence.
- The physical D1 schema was **not fixed** by the original decision; it is now recorded in the amendment below. In particular, a generic `(field, value_json)` claim table is not adopted by default. The concrete schema is decided immediately before the first migration and recorded as an amendment to this ADR. Source-derived inputs for that decision (the first municipal source's fields, dataset-level observation date, source-release provenance, open questions about stable record keys) are in `docs/research/2026-09-launch-dataset-and-tile-zoom.md` §3 and §7.

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

## Amendment 2026-09 — physical schema (Issue #8)

Migration: `services/api/migrations/0001_initial_schema.sql`. Tests: `services/api/test/schema.test.ts` (`npm test` in `services/api`).
The schema follows the real Taito source shape (research §3): 12 CSV columns, a dataset-level 時点 date, a row number `#` with no evidence of cross-release stability, and tobacco/closure information that exists only as free text.

### Layers

| Layer | Tables | Mutability |
|---|---|---|
| Registry | `sources` (mirror of `docs/SOURCES.md`; `publication_status` is the gate) | admin-edited |
| Raw evidence | `source_releases` (one fetched snapshot), `source_records` (one raw row) | append-only; records immutable (trigger) |
| Cross-release identity | `source_entities`, `source_record_entities` | append-only decisions |
| Canonical | `spots`, `spot_source_entities`, `spot_field_provenance` | written by the resolver |
| Published | `tile_snapshots`, `tile_snapshot_spots` | written by the publish step |

### Decisions

1. **Observation time belongs to the release.** `source_releases.observed_on` holds the dataset-level date (Taito: 2026-08-18), or NULL when unknown. `fetched_at`, `http_last_modified`, `content_sha256`, `byte_length`, `source_url` and `parser_version` are provenance, never freshness. `UNIQUE (source_id, content_sha256)` makes a re-import of identical bytes a no-op.
2. **Raw rows are kept verbatim.** `source_records.raw_values_json` is a JSON array of the parsed field strings in `source_releases.header_json` order. It has no trimming, width folding or date parsing, and the embedded line break in Taito record 32 is kept. A trigger rejects a row whose width differs from the header, and others make records immutable and undeletable. The original file bytes are identified by SHA-256 but not stored in D1 (see Unresolved).
3. **Record identity is release-scoped.** A record is `(release_id, ordinal)`. The Taito `#` is stored as `upstream_row_ref`, unique within one release only, and is **never** used to match across releases.
4. **Cross-release reconciliation is an explicit, versioned decision.** `source_entities` is MannerPath's own identity for "the same upstream thing". Each record is assigned to one entity in `source_record_entities`, which records `method` (`new | natural_key | raw_identical | manual`), `matcher_version` and time. Constraints: an entity has at most one record per release (`UNIQUE (source_entity_id, release_id)`), so an ambiguous match cannot be linked silently. Records and entities must share a source (trigger). The matcher input is `source_records.natural_key` plus `natural_key_version` (for Taito, a candidate is normalised 名称 + 設置位置). The matching rules themselves belong to the importer task.
5. **Removal is by absence from the current release.** `source_releases.is_current` marks the latest applied release (at most one per source, partial unique index). An entity with no record in the current release is a removal candidate for the resolver. The schema does not decide removal automatically.
6. **Canonical values are typed columns.** `spots` holds every resolved attribute as a typed, CHECK-constrained column: tri-states `yes | no | unknown`, lifecycle, access and environment enums, and `opening_hours_status` with `unparsed` for a free-text closure note, so `openNow` stays unknown. API hot paths never read evidence tables. `evidence_quality` and `evidence_quality_version` are separate from `lifecycle`, and `resolver_version` is stored per spot.
7. **Field-level provenance without EAV values.** `spot_field_provenance` has one row per `(spot_id, field)` with the `record_id`, the raw `source_columns_json` used, a named `rule` and `resolver_version`. It records where a value came from, never the value itself. A missing row means that field has no evidence (unknown/default). `existence` is one of the fields, which is how accepted existence evidence is represented.
8. **Spot ↔ source mapping.** `spot_source_entities` maps each source entity to at most one spot (PK). A spot may have several entities (multi-source).
9. **Merges are permanent one-hop redirects.** `spots.merged_into` is enforced by triggers. The target must not itself be merged. A spot with inbound redirects cannot be merged until they are repointed, so `/spots/{id}` resolves in at most one hop. A redirect cannot be removed, and spots are never deleted.
10. **Tiles are stored snapshots.** `tile_snapshots` holds the exact response body (`body_json`), `content_sha256` (the ETag input), `schema_version`, `spot_count` and `revision` for each tile. The tile API reads one row by primary key, so the body cannot drift from its ETag even if `spots` changes between publishes. Triggers enforce that revisions strictly increase and that rows are never deleted: an emptied tile is republished with `spot_count = 0`. `z` is pinned by `CHECK (z = 14)`, and `tile_id` must equal `z/x/y`.
11. **The publication invariant is enforced by the database.** `tile_snapshot_spots` lists the spots in each tile's current snapshot (a spot is in at most one tile). A trigger rejects inserting a spot unless all of these hold:
    - it is `active` and unmerged;
    - its `tile_id` matches the tile;
    - it has an `existence` provenance row whose record comes from an `applied` release of an `approved` source.
    A second trigger rejects changing `lifecycle`, `merged_into` or `tile_id` of a spot that is still in a snapshot. The publish step must unpublish, update and republish in one D1 batch.
12. **Identifiers.** `spots.spot_id` is opaque server-assigned TEXT (8–64 chars; the format is chosen by the importer task). Internal tables use integer keys that are never exposed.
13. **Not PostGIS, but friendly to it.** Coordinates are `REAL` WGS84 plus integer tile columns and an index on `spots.tile_id`. A PostGIS backend can add a geography column derived from `latitude`/`longitude` without changing identities or the tile contract (ADR-0003, ADR-0005).

### Not enforced by the schema (the application must guarantee)

- The tile x/y of a spot matches its coordinates: SQLite has no portable Mercator math. The TypeScript tile module is checked against the shared vectors.
- `spots.last_verified_at` equals the `observed_on` of the release behind the newest `existence` provenance.
- `body_json` / `content_sha256` match the rows in `tile_snapshot_spots`.
- Changing `sources.publication_status` to `blocked` is not blocked when spots are already published. The publish step must unpublish the affected tiles.
- A provenance `record_id` belongs to a source entity linked to that spot in `spot_source_entities`.
- The `spot_field_provenance` field names map to spot columns. There is no check that a non-unknown value has a provenance row.

### Unresolved before the Taito importer / tile API

- Archiving the original file bytes (for example in R2, keyed by `content_sha256`). D1 keeps the verbatim fields and hash only.
- The Taito natural-key normalisation and matcher rules, including the ambiguous-match review flow. They need a second real release to validate (research §7).
- The spot ID format, `evidence_quality` values and the tile DTO / `schemaVersion` 1 body shape.
- History of canonical values: provenance describes the current value only. Earlier values can be reproduced from raw records plus versions, but they are not stored.
- User reports as evidence: `spot_field_provenance.record_id` is `NOT NULL` for source records only. Adding reports needs the report privacy ADR and a migration.
- Verification on a remote Cloudflare D1 database. The migration has been applied to local D1 (`wrangler d1 migrations apply --local`, wrangler 4.135.0) and to SQLite 3.47 (node:sqlite) and 3.51 (sqlite3 CLI). Wrangler is not yet a project dependency.
