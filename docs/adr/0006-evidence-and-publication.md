# ADR-0006 — Evidence, resolution and publication

Status: Accepted. Physical schema added by the 2026-09 amendment below (Issue #8); first vertical slice decisions added by the 2026-09 Issue #12 amendment; spot detail read added by the 2026-09 Issue #16 amendment; the reviewed-source registry mechanism and the Taito publication approval added by the 2026-09 Issue #22 amendment; second-publication reconciliation, the publication hold and field attenuations added by the 2026-09 Issue #42 amendment

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

1. its lifecycle is `active`,
2. it has accepted **existence evidence** from an approved source or verification process, and
3. it is under no **publication hold** (added by the Issue #42 amendment below).

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
- Report privacy/retention requires a separate ADR before the report API ships. That ADR is `docs/adr/0007-report-privacy-and-retention.md` (accepted 2026-09, Issue #29): reports are an immutable proposal layer, and an accepted report still becomes canonical evidence only through a separate reconciliation step that re-enters the ordinary source → release → record → resolve → publish path with this ADR's publication invariant intact.

## Amendment 2026-09 — physical schema (Issue #8)

Migration: `services/api/migrations/0001_initial_schema.sql`. Tests: `services/api/test/schema.test.ts` (`npm test` in `services/api`).
The schema follows the real Taito source shape (research §3): 12 CSV columns, a dataset-level 時点 date, a row number `#` with no evidence of cross-release stability, and tobacco/closure information that exists only as free text.

### Layers

| Layer | Tables | Mutability |
|---|---|---|
| Registry | `sources` (mirror of `docs/SOURCES.md`; `publication_status` is the gate) | admin-edited |
| Raw evidence | `source_releases` (one publisher observation of some content), `source_records` (one raw row) | records immutable and undeletable; release evidence metadata frozen once records exist (triggers) |
| Normalized source mapping | `source_observations` (ADR-0008) | immutable, re-derivable rows per `(record_id, mapping_version)`; raw records remain the evidence |
| Derived matcher input | `source_record_match_keys` | immutable rows per `key_version`; a new algorithm adds rows |
| Cross-release identity | `source_entities`, `source_record_entities` | entity source immutable; one current decision per record, corrected only by a same-source `manual` update, never deleted (triggers) |
| Canonical | `spots`, `spot_source_entities`, `spot_field_provenance` | written by the resolver |
| Published | `tile_snapshots`, `tile_snapshot_spots` | written by the publish step |

### Decisions

1. **Observation time belongs to the release.** `source_releases.observed_on` holds the dataset-level date (Taito: 2026-08-18), or NULL when unknown. `fetched_at`, `http_last_modified`, `content_sha256`, `byte_length`, `source_url` and `parser_version` are provenance, never freshness. `content_sha256` identifies the content (blob) only. It does not define the release: the same bytes re-published or re-attested with a newer `observed_on` form a new release with their own records, so evidence and `lastVerifiedAt` can advance (tested). `UNIQUE (source_id, content_sha256, observed_on)` makes a re-import of the same observation a no-op. SQLite treats NULLs as distinct, so when `observed_on` is unknown the importer must check before inserting. Once a release has records, a trigger freezes its evidence-defining metadata: source, observation, fetch, URL, Last-Modified, hash, size, header, record count and parser version. Only the workflow fields `status`, `is_current` and `applied_at` can change.
2. **Raw rows are kept verbatim.** `source_records.raw_values_json` is a JSON array of the parsed field strings in `source_releases.header_json` order. It has no trimming, width folding or date parsing, and the embedded line break in Taito record 32 is kept. A trigger rejects a row whose width differs from the header, and others make records immutable and undeletable. Raw rows carry no derived or versioned values. The original file bytes are identified by SHA-256 but not stored in D1 (see Unresolved).
3. **Record identity is release-scoped.** A record is `(release_id, ordinal)`. The Taito `#` is stored as `upstream_row_ref`, unique within one release only, and is **never** used to match across releases.
4. **Cross-release reconciliation is an explicit, versioned decision.** `source_entities` is MannerPath's own identity for "the same upstream thing". Each record is assigned to one entity in `source_record_entities`, which records `method` (`new | natural_key | raw_identical | manual`), `matcher_version` and time. Constraints: an entity has at most one record per release (`UNIQUE (source_entity_id, release_id)`), so an ambiguous match cannot be linked silently. Records and entities must share a source; triggers check this on INSERT and UPDATE. An entity's `source_id` is immutable.
   - **Matcher input** is derived, not raw. It lives in `source_record_match_keys (record_id, key_version, match_key)`, for Taito a normalised 名称 + 設置位置. Rows are immutable. An improved algorithm adds rows under a new `key_version` and leaves both the raw record and old keys untouched, so every decision stays reproducible. `matcher_version` names the matcher and the `key_version` it read.
   - **Correction model:** there is one current decision per record. A reviewer corrects it in place, and a trigger enforces the rules:
     - every UPDATE must leave the row with `method = 'manual'`. An automatic decision's `method`, `matcher_version`, `decided_at` and `note` therefore cannot be rewritten while it still claims to be automatic. A correction replaces it with a manual decision;
     - `source_entity_id` can change only within the same source;
     - `record_id`/`release_id` never change;
     - decisions are never deleted.
     The replaced automatic decision is not stored as history. It is reproducible from raw records, match keys and `matcher_version`. The matching rules themselves belong to the importer task.
5. **Removal is by absence from the current release.** `source_releases.is_current` marks the latest applied release (at most one per source, partial unique index). An entity with no record in the current release is a removal candidate for the resolver. The schema does not decide removal automatically.
6. **Canonical values are typed columns.** `spots` holds every resolved attribute as a typed, CHECK-constrained column: tri-states `yes | no | unknown`, lifecycle, access and environment enums, and `opening_hours_status` with `unparsed` for a free-text closure note, so `openNow` stays unknown. API hot paths never read evidence tables. `evidence_quality` and `evidence_quality_version` are separate from `lifecycle`, and `resolver_version` is stored per spot.
7. **Field-level provenance without EAV values.** `spot_field_provenance` has one row per `(spot_id, field)` with the `record_id`, the raw `source_columns_json` used, a named `rule` and `resolver_version`. It records where a value came from, never the value itself. A missing row means that field has no evidence (unknown/default). `existence` is one of the fields, which is how accepted existence evidence is represented.
8. **Spot ↔ source mapping.** `spot_source_entities` maps each source entity to at most one spot (PK). A spot may have several entities (multi-source).
9. **Merges are permanent one-hop redirects.** `spots.merged_into` is enforced by triggers. The target must not itself be merged. A spot with inbound redirects cannot be merged until they are repointed, so `/spots/{id}` resolves in at most one hop. A redirect cannot be removed, and spots are never deleted.
10. **Tiles are stored snapshots.** `tile_snapshots` holds the exact response body (`body_json`), `content_sha256` (the ETag input), `schema_version`, `spot_count` and `revision` for each tile. The tile API reads one row by primary key, so the body cannot drift from its ETag even if `spots` changes between publishes. Triggers enforce that revisions strictly increase and that rows are never deleted: an emptied tile is republished with `spot_count = 0`. `z` is pinned by `CHECK (z = 14)`, and `tile_id` must equal `z/x/y`.
11. **The publication invariant is enforced by the database when a spot is published.** `tile_snapshot_spots` lists the spots in each tile's current snapshot (a spot is in at most one tile). A trigger rejects inserting a spot unless all of these hold:
    - it is `active` and unmerged;
    - its `tile_id` matches the tile;
    - it has an `existence` provenance row whose record comes from an `applied` release of an `approved` source.
    A second trigger rejects changing `lifecycle`, `merged_into` or `tile_id` of a spot that is still in a snapshot. The publish step must unpublish, update and republish in one D1 batch.
    The database does **not** re-check the invariant after publication for changes to the evidence behind it. These transitions are allowed even while a dependent spot is published:
    - `sources.publication_status` changes from `approved` to `blocked`;
    - `source_releases.status` leaves `applied`;
    - the spot's `existence` row in `spot_field_provenance` is updated to point at other evidence, or deleted.
    **Rule:** the transaction (one D1 batch) that makes any of these changes must first unpublish the affected spots, republish their tiles (higher `revision`, new body) and re-insert only spots that still qualify. That re-insert re-runs the insert trigger. Until the importer/publish code exists, this rule is a documented application obligation and is not tested.
12. **Identifiers.** `spots.spot_id` is opaque server-assigned TEXT (8–64 chars; the format is chosen by the importer task). Internal tables use integer keys that are never exposed.
13. **Not PostGIS, but friendly to it.** Coordinates are `REAL` WGS84 plus integer tile columns and an index on `spots.tile_id`. A PostGIS backend can add a geography column derived from `latitude`/`longitude` without changing identities or the tile contract (ADR-0003, ADR-0005).

### Not enforced by the schema (the application must guarantee)

- The tile x/y of a spot matches its coordinates: SQLite has no portable Mercator math. The TypeScript tile module is checked against the shared vectors.
- `spots.last_verified_at` equals the `observed_on` of the release behind the newest `existence` provenance.
- `body_json` / `content_sha256` match the rows in `tile_snapshot_spots`.
- Evidence-gating changes after publication are not guarded: a source becoming `blocked`, a release leaving `applied`, or a published spot's `existence` provenance changing or being deleted (see decision 11 for the required publish transaction).
- A provenance `record_id` belongs to a source entity linked to that spot in `spot_source_entities`.
- The `spot_field_provenance` field names map to spot columns. There is no check that a non-unknown value has a provenance row.

### Unresolved before the Taito importer / tile API

- Archiving the original file bytes (for example in R2, keyed by `content_sha256`). D1 keeps the verbatim fields and hash only.
- The Taito natural-key normalisation and matcher rules, including the ambiguous-match review flow. They need a second real release to validate (research §7).
- The spot ID format, `evidence_quality` values and the tile DTO / `schemaVersion` 1 body shape.
- History of canonical values: provenance describes the current value only. Earlier values can be reproduced from raw records plus versions, but they are not stored.
- User reports as evidence: `spot_field_provenance.record_id` is `NOT NULL` for source records only. Adding reports needs the report privacy ADR and a migration.
- Verification on a remote Cloudflare D1 database. The migration has been applied to local D1 (`wrangler d1 migrations apply --local`, wrangler 4.135.0) and to SQLite 3.47 (node:sqlite) and 3.51 (sqlite3 CLI). Wrangler is now a pinned dev dependency of `services/api` (Issue #12); 0001 + 0002 were applied to a fresh local D1 with it.

## Amendment 2026-09 — first vertical slice: Taito import and tile API (Issue #12)

Code: `services/api/src/pipeline/` (ingest, first-release reconciliation, Taito rules), `src/tiles/` (DTO, publish), `src/app.ts` (`GET /v1/tiles/{z}/{x}/{y}`), `src/spot-id.ts`. Tests: `services/api/test/pipeline.test.ts`, `publish-api.test.ts`, `migration-0002.test.ts`.
This amendment settles only what the slice needs. Of the items under "Unresolved before the Taito importer / tile API" above, it resolves the spot ID format, the `evidence_quality` values and the tile DTO / `schemaVersion` 1. The other items remain open.

### Decisions

1. **Spot ID.** `"sp_"` followed by 26 Crockford base32 characters encoding 128 bits from a CSPRNG (`crypto.getRandomValues`). Nothing about the spot goes into the ID: not the source ID, the row number, the coordinates, the tile or the time. The ID is stored once. It is found again through `spot_source_entities` and never recomputed, so it survives changes to any of those attributes.
2. **Evidence quality, vocabulary `evidence-quality.v1`.** It has one value, `officialListing`: the spot's existence evidence is a listing in an applied release of a `municipal` source. The resolver refuses other source kinds. Further values arrive with the sources and workflows that need them, and adding one bumps the version.
3. **`spotType = unknown` (migration `0002_spot_type_unknown.sql`).** The Taito list does not say whether a place is an outdoor area, a room or an ashtray. A physical type must not be guessed from a name, so `unknown` is added to the `spot_type` CHECK. SQLite cannot alter a CHECK, so 0002 rebuilds `spots` with identical indexes and triggers. It also drops and recreates `tile_snapshot_spots_publication_invariant`, the one trigger on another table that reads `spots`. The rebuild is valid only while `spots` is empty: dropping a referenced parent leaves deferred foreign-key violations, and D1 cannot turn foreign keys off. A guard table aborts 0002 when spots exist (tested). A later change to `spots` constraints needs a different procedure. **Meaning:** `unknown` is a supported canonical value, not a verification state. Verification stays on its own axis (evidence quality, publication gate), so a published `unknown` spot is a normal result. The literal `unknown` is also distinct from an *unsupported* future enum value that an older client receives, which follows the forward-compatibility rule in `docs/API.md`.
4. **First-release reconciliation (`first-release.v1`).** When a source has no applied release, each record gets a new `source_entity`, a `source_record_entities` decision with `method = 'new'`, and a new spot linked with `method = 'created'`. No match keys are derived. When the source already has an applied release, the resolver **refuses** and writes nothing. Cross-release matching stays unimplemented until a matcher is validated against two real releases. The Taito `#` is stored only as the release-scoped `upstream_row_ref`. Reconciliation, spot creation, provenance and the release's `applied`/`is_current` switch happen in one batch. Resolving an already-applied release is a no-op.
5. **Taito field rules (`taito-resolver.v1`; the CSV rules below are unchanged, but the version moved to `taito-resolver.v2` in the Issue #42 amendment).** Raw values are never rewritten. Each resolved field has a `spot_field_provenance` row naming the record, columns and rule. A field with no row is unresolved.

   | Field | Rule | Source columns | Result |
   |---|---|---|---|
   | existence, lifecycle | `taito.listed.v1` | the whole record | Listed in the applied release → accepted existence evidence; `active`. A host (for example a convenience store in `名称`) adds nothing |
   | location | `taito.coordinates.v1` | 緯度, 経度 | Decimal degrees as written. A malformed value aborts the import. The datum is not stated and is treated as WGS84 |
   | name | `taito.name.v1` | 名称 | Verbatim, including suffixes such as 「※加熱式たばこ専用」 |
   | supportsPaper / supportsHeated | `taito.heatedOnly.v1` | 名称 and/or 特記事項, whichever contains the marker | 「※加熱式たばこ専用」 → paper `no`, heated `yes` (record 32 only). Otherwise `unknown`, with no provenance row |
   | openingHours | `taito.hours.v1` | 利用開始時間, 利用終了時間, 特記事項 | `raw` = the range (`終日利用可能` or `start-end`), followed by the note on a new line if there is one. `parsed` only when 特記事項 is blank and both times are `終日利用可能` (`{"v":1,"kind":"allDay"}`) or `H:MM` with close after open (`{"v":1,"kind":"daily","opens":"07:00","closes":"20:00"}`; `0:00` as a close time means `24:00`). Any note (closure text, the heated-only marker) or other format → `unparsed`, so `openNow` stays unknown |
   | lastVerifiedAt | — | release `observed_on` | 2026-08-18 for the fixture. The fetch date is never used |
   | spotType, hostType, accessType, environment, feeType, floor, entranceNote | — | — | Not resolved: `unknown`/NULL, no provenance row. 設置位置, 方書 and 名称カナ stay in raw evidence only |

6. **Publish.** One operation rebuilds the complete body of every tile whose spots or sources changed, including previously published tiles that are now empty. It writes all of them in one batch: clear `tile_snapshot_spots`, upsert `tile_snapshots` with `revision + 1`, re-insert spots (re-running the invariant trigger). Candidates are active, unmerged spots whose existence evidence is in an applied release. Spots whose source is not `approved` are **excluded and reported**, never published. This is how the decision-11 obligation is met whenever the publisher runs after a source is blocked (tested). Unchanged tiles keep their revision, body and ETag.
7. **Snapshot bytes and ETag.** `body_json` is `JSON.stringify` of the v1 body built with a fixed key order, spots sorted by `id` and sources by `id`. It is validated with Zod before storage. `content_sha256 = sha256(body_json)`, and the API serves `body_json` byte-for-byte with the strong ETag `"{schemaVersion}-{content_sha256}"`. The DTO is specified in `docs/API.md`.
8. **Registry.** The importer inserts the Taito `sources` row as `blocked` when it is missing and never updates an existing row. Approval stays an explicit registry change (`docs/SOURCES.md`). Tests prove a successful publication only with an isolated test source that is explicitly approved, and prove that the real Taito source publishes nothing and is rejected by the trigger. *(Superseded by the Issue #22 amendment: the row is now created from a reviewed registry constant, so Taito is created `approved`, and the isolated test source now plays the blocked role. The rest — approval is a repository change, never an importer's decision — is unchanged.)*

### Still unresolved

- Cross-release matching for Taito (natural key, ambiguous-match review), which needs a second real release. Removal detection depends on it.
- ~~Taito publication approval and in-app attribution wording.~~ Resolved by the Issue #22 amendment below.
- Physical spot type, access type, environment and host context for Taito records. There is also no address field in the canonical model yet (設置位置/方書 are raw evidence only).
- Parsing Taito closure notes (「土日祝日、年末年始は休業」, 「12月を除く毎月第3水曜日は休業」) into structured hours.
- Archiving the original file bytes (R2). A remote D1 database. `/config`, reports. (`GET /spots/{id}` is resolved by the Issue #16 amendment below.)

## Amendment 2026-09 — published spot detail read (Issue #16)

Code: `services/api/src/spots/` (detail DTO, read), `src/app.ts` (`GET /v1/spots/{id}`). Tests: `services/api/test/spot-detail.test.ts`. Contract: `docs/API.md`, `GET /spots/{id}` schemaVersion 1. No migration: the existing schema (canonical columns, `spot_field_provenance`, `tile_snapshot_spots`) carries the whole response.

### Decisions

1. **Publication membership is the public read gate.** The detail query starts from `tile_snapshot_spots`, so a spot is readable exactly while it is in a published snapshot — the same gate as the tile API, not a second definition of "public". The active/unmerged, `applied` release and `approved` source conditions are repeated in the query as defence in depth against a stale snapshot row (decision 11's transitions are an application obligation, not a database guarantee). Blocking a source and republishing therefore removes its spots from this endpoint as well, with no extra code path.
2. **Unknown and unpublished IDs are indistinguishable.** A malformed ID, an unknown ID, a canonical row that was never published, one from a blocked source, one that is merged away or inactive: all answer `404 spotNotFound` with the same body. A 404 must not confirm that a canonical row exists, otherwise the publication gate would leak the unpublished corpus one probe at a time. In particular a spot whose source is not approved has no public detail, however real its canonical row is.
3. **Merged IDs resolve in one hop and report the redirect.** `spots.merged_into` is a permanent one-hop redirect whose target is never itself merged (decision 9), so at most one lookup is needed. The response body is the live target's, with `requestedId` (what the client asked for) and `mergedInto` (the target) at the top level, so a client can rewrite favourites and recents. A redirect to an unpublished target is a `404` like any other unpublished spot: the gate is checked on the resolved spot, never bypassed by the redirect.
4. **The public provenance boundary.** `provenance` exposes per resolved field only: `field`, `sourceId`, the named `rule`, and `observedOn` (the release's observation date). It is filtered to evidence from an `applied` release of an `approved` source. The emitted fields are an explicit allowlist (`PUBLIC_PROVENANCE_FIELDS`), applied in SQL and re-checked by parsing the final body with the response schema before it is sent, because `spot_field_provenance.field`'s CHECK constraint is an internal vocabulary that may grow: a field added there is withheld until it is deliberately published, rather than exposed by default. Raw records, the source column names (`spot_field_provenance.source_columns_json`), record/release/entity IDs, matcher and resolver versions stay server-side: they are internal identifiers or raw-evidence detail, and none of them helps a user judge a spot. What a user needs — who says so, by which rule, observed when — is exactly what is sent. The verification summary is not a new vocabulary: it is the tile DTO's `evidenceQuality`, `evidenceQualityVersion` and `lastVerifiedAt`.
5. **The spot object is the tile spot object.** `spot` reuses the tile DTO field-for-field (same Zod schema, same mapping function) plus `tile`, and `sources` reuses the tile source DTO, so attribution and field semantics cannot drift between the two endpoints and a client needs one decoder. `spotType: "unknown"` is served normally here, as in tiles.
6. **No detail ETag in schemaVersion 1.** A tile's ETag is free because the publisher stores the exact body and its hash. No stored hash describes a detail body, which also includes provenance that is not in the snapshot, so an ETag would mean hashing a freshly built body on every request. That machinery is not justified by this slice; `Cache-Control: public, no-cache` is sent without a validator. If detail reads become hot, the honest fix is a stored detail snapshot, not a per-request hash.

### Still unresolved (unchanged by this amendment)

- Everything listed under the Issue #12 amendment except `GET /spots/{id}`.
- Multi-source spots: the detail response derives `sources` from the existence evidence, like the tile publisher. A spot resolved from several sources needs both endpoints changed together.
- `/config`, the report API, and any non-public (admin/moderation) view of evidence.

## Amendment 2026-09 — reviewed-source registry and the Taito publication approval (Issue #22)

Code: `services/api/src/pipeline/registry.ts`, `src/pipeline/taito.ts` (`TAITO_ATTRIBUTION_TEXT`, `TAITO_REGISTRY`), `scripts/apply-source-registry.ts`. Tests: `services/api/test/pipeline.test.ts` (registry), `publish-api.test.ts`, `spot-detail.test.ts`. Registry entry: `docs/SOURCES.md`. No migration: this is reference-data state in the `sources` table, not a schema change.

This amendment records the operational mechanism by which a reviewed source reaches `sources.publication_status = 'approved'`. It does not change the publication invariant, the publish step, the D1 triggers or any DTO.

### Decisions

1. **Approval is a repository-controlled constant, not an importer decision.** `REVIEWED_SOURCES` in `src/pipeline/registry.ts` mirrors the reviewed rows of `docs/SOURCES.md`, including each row's reviewed `publicationStatus`. Both registry write operations accept only a source in that list and throw otherwise, so importer code can neither register nor approve a source this repository has not reviewed. A source is blocked by **absence** from the list, not by a status field someone could flip. OSM is deliberately absent, and the `sources` CHECK constraint independently refuses `kind = 'osm'` with `publication_status = 'approved'`.
2. **"Ensure the row exists" and "apply the reviewed entry" are separate operations.** This is the smallest explicit boundary that the Issue #12 rule ("never update an existing row") allows:
   - `ensureReviewedSource` is insert-only. A fresh or local database therefore gets the *known reviewed* row — Taito as `approved`, with its attribution — rather than a generic blocked row, while an operator's edit to an existing row still survives every import.
   - `applyReviewedSourceRegistry` updates an existing row to the reviewed entry. It is the deliberate, testable upgrade path for a database that predates the review (a Taito row still `blocked`, with `attribution_text` NULL). It runs only when invoked by name — `npm run local:registry`, local D1 only — never as a side effect of ingest, and no hand-written SQL or database deletion is involved.
   Publication is not touched by either operation: tiles reflect the new status at the next publish, which is the decision-11 obligation already in place. That is also how a downgrade back to `blocked` empties the tiles.
3. **Taito is approved, and the attribution follows the publisher's display example literally.** 台東区's open-data terms (CC BY 4.0) were verified against the publisher's own pages on 2026-09-20 and re-checked on 2026-09-21. The terms prescribe four elements to be joined by spaces or punctuation, and `TAITO_ATTRIBUTION_TEXT` is exactly those four in that order: `台東区`, `CC-BY表示4.0国際`, `本作品の内容について、台東区は一切保証しないものとする。`, and `元データ` followed by the original-data URL. Nothing is added and nothing is reworded — in particular **no dataset title** is inserted between the author and the license element, because the terms prescribe none, and no additional restriction is invented. The original-data URL is the **release file that was actually imported** (`TAITO_ORIGINAL_DATA_URL`, the same URL as the release's `source_url`), since 元データ means the data itself; the dataset landing page stays catalog metadata (`TAITO_DATASET_URL`) and is not cited. A new release therefore updates the cited URL together with the file it describes. The string is a single constant, so the tile and spot-detail endpoints send byte-identical `sources[].attributionText` (both build `sources` from the same registry row through the same DTO; tested on both endpoints).
4. **What did not change.** The publication invariant, the `tile_snapshot_spots` trigger, the complete-snapshot publish step, the DTO shapes, and every unknown / heated-only / provenance rule of `taito-resolver.v1`. The generic gate keeps its dedicated tests, now carried by an isolated **unapproved** test source (`test-blocked-municipal`), since the real Taito source can no longer play that role: what must stay unpublishable by default is an unknown or unreviewed source.

### Still unresolved (unchanged by this amendment)

- Everything listed under the Issue #12 amendment except the Taito publication approval and attribution wording.
- OSM publication (ODbL obligations), any further source, and cross-release matching for Taito.
- A remote D1 database: the upgrade path is local-only, as is every other operation in this repository.

## Amendment 2026-09 — reconciling a second official publication: attenuations, the publication hold, and `taito-resolver.v2` (Issue #42)

Code: `services/api/src/pipeline/taito-list-page.ts` (the attestations and the release binding),
`src/pipeline/taito.ts` (`taito-resolver.v2`), `src/pipeline/resolve.ts`, `src/pipeline/promotion.ts`,
`src/tiles/publish.ts`, `src/spots/detail.ts`, `src/quality/analyze.ts`. Migrations:
`migrations/0004_publication_hold.sql`, `migrations/0005_spot_field_attenuations.sql`.
Tests: `services/api/test/taito-reconciliation.test.ts`, plus the updated expectations in
`pipeline.test.ts`, `publish-api.test.ts`, `promotion.test.ts`, `data-quality.test.ts`.
Contract: `docs/API.md` (`GET /spots/{id}` provenance). Registry and policy: `docs/SOURCES.md`,
`docs/DATA_POLICY.md` §"Contradicting official publications". Measurement:
`docs/BETA_DATA_QUALITY.md`.

### Context

台東区 publishes its public smoking locations twice: the CC BY 4.0 open-data CSV this repository
imports, and 公衆喫煙所ウェブマップ・一覧, an ordinary ward web page. Issue #33 measured eight
material disagreements between them — three different closing times, four qualifiers the CSV does
not carry (weekday-only opening, holiday exclusions, a temporary renovation closure, contradictory
weekend hours), and one location the page says is temporarily relocated while the CSV carries the
permanent coordinate. Re-checked live on 2026-09-21 (03:01Z, after the 01:37Z review): all eight
still stand, and the release file is still byte-identical to the committed fixture.

The consequence is a core-behaviour failure, not a completeness gap: MannerPath could tell a user a
place is open while the ward's own other page says it is closed, or route a user to a coordinate
the ward says is no longer the active location.

### Decisions

1. **The second publication is a conflict reference, not a source.** No reviewed redistribution
   permission was found for the list page: it sits outside the ward's open-data catalog, carries no
   CC BY notice or license link, and its footer states only `©台東区` (re-read 2026-09-21). Under
   `docs/DATA_POLICY.md` an unreviewed reference is not published, so MannerPath does not
   redistribute content from this page, does not register it in `docs/SOURCES.md`, and uses it only
   as a reviewed conflict reference. This amendment draws no conclusion about what that page's terms
   permit — that review has not been done, which is the reason for the conservative path. The
   reference's participation in the evidence model is **subtractive only**: it may cause MannerPath
   to withdraw a claim, never to make or change one. The source approval and publication gates of
   the Issue #22 amendment are untouched.
2. **Conflicts are dated, reviewed attestations in code.** `TAITO_LIST_PAGE_CONFLICTS`
   (`taito-list-page-conflicts.v1`) holds one entry per contradiction: the CSV 名称 it concerns, the
   effects it licenses, and a written observation of what the other publication states — a factual
   summary for a reviewer, never a copy of the page's prose and never a replacement value. The
   observation is not stored in the database and never reaches a client. The observations are
   reproducible with `services/data-pipeline/research/beta-data-quality/spot-check.mjs`. This is why
   the reconciliation is not an unexplained constant: nothing here encodes a corrected time.
3. **The attestations are bound to one exact release, and fail closed.** They were established by
   comparing *one* release's records with the page, so they describe no other release. Before
   applying any effect the resolver checks the release's `content_sha256`, `observed_on` and
   `source_url` against `TAITO_REVIEWED_RELEASE` and **refuses to resolve** on any difference. The
   record names matching is not sufficient and is checked separately, after: the same eight names in
   a different file prove nothing about that file's hours or locations, so reusing the decisions
   would either attenuate the wrong records or silently miss new conflicts. Recovery is a deliberate
   repository change — re-read the page, re-review, and bump the attestation version and the
   reviewed release together — never a runtime fallback.
4. **Only three effects exist, all weakening.** `hoursUnknown` forces `opening_hours_status =
   'unparsed'` and drops the machine-readable hours, so `openNow` stays unknown; `temporarilyClosed`
   sets that lifecycle, which the existing publication invariant already excludes; and
   `withholdFromPublication` sets a publication hold. **No calendar parser was added.** Representing
   「平日開庁日のみ」 or a Bon-holiday exclusion faithfully would need one; `unparsed` is the honest
   answer until there is one.

   What is preserved is not the page's wording — that is neither stored nor published, and the CSV's
   own `opening_hours_raw` never contained it. What is preserved is the **reviewed attestation that
   a conflict or qualifier exists**, as repository-controlled evidence and as a
   `spot_field_attenuations` row. The canonical claim is weakened conservatively, so `openNow`
   cannot confidently contradict the ward's other publication.
5. **Attenuations are their own table; field provenance stays honest.** A weakening is **not**
   recorded by rewriting the affected `spot_field_provenance.rule`. That row points at a CSV record
   and its release's `observed_on`; renaming its rule made the public provenance in
   `GET /spots/{id}` imply the 2026-08-18 CSV had itself observed a conflict published later on a
   different page, and it destroyed the record of what the CSV actually stated. Migration 0005 adds
   `spot_field_attenuations`, one row per `(spot, field, effect)`, holding the attestation version,
   the reference kind and URL, the `checked_at` instant, and the reviewed release fingerprint
   (`release_id`, `release_content_sha256`, `release_observed_on`, `release_source_url`). It holds
   no prose, no hours, no coordinate and no replacement value of any kind. Rows are never deleted;
   a correction is a new attestation version and a re-resolve.

   Neither table alone explains an attenuated value. `spot_field_provenance` says what the source
   record stated and by which rule — still true. `spot_field_attenuations` says the claim was then
   weakened, and on what reviewed evidence. The pair is the whole story.
6. **`spots.publication_hold` is a new axis, and deliberately not lifecycle.** The relocated place
   has not closed and has not been removed — the ward says it exists, elsewhere — so calling it
   `temporarilyClosed` or `removed` would be a false statement about the world, and inventing a
   coordinate for its current position is forbidden. The hold says something about *us*: this
   canonical row, as it stands, must not be published. The row keeps the source's own coordinate and
   stays `active`; it is simply absent from tiles, and therefore from Nearby and from
   `GET /spots/{id}`, which reads through the same gate. Migration 0004 adds the column and
   recreates the two publication triggers to read it, so the database refuses to publish a held spot
   and refuses to hold a spot that is still in a snapshot (decision 11's unpublish-first obligation).
   Vocabulary v1 has one value, `locationSuperseded`.
7. **An attenuated field publishes no provenance in schemaVersion 1.** `GET /spots/{id}` omits the
   field entirely rather than emitting its CSV provenance. Emitting it would tell a client that
   `taito-public-smoking-areas`, observed on 2026-08-18, is the evidence for the value it sees —
   precisely what it is not. Inventing a synthetic source or rule for the conflict reference was
   rejected too: it is not a source, and its content is not redistributable. schemaVersion 1 has no
   shape for "value withdrawn, on other evidence", so the honest option is silence:
   `openingHours.status: "unparsed"` already tells the client it cannot compute `openNow`, and a
   withheld spot is not readable at all. `docs/API.md` states this; a future schema version may add
   an explicit attenuation shape.
8. **The resolver version moved to `taito-resolver.v2`.** Resolution semantics changed — the same
   record can now yield `unparsed` hours, a non-`active` lifecycle or a publication hold — so the two
   algorithms do not share a version. `taito-resolver.v1` is the pre-#42 algorithm and is no longer
   produced; spots, provenance rows and attenuation rows written by this code all carry v2.
9. **The attestations must keep matching the data.** After the release check, `resolveFirstRelease`
   asserts that every attestation matches exactly one record of the release before it writes
   anything, so a renamed record fails the import loudly rather than silently losing an effect.
10. **The quality analysis enforces it.** Three checks now cover this:
    `taito-public-smoking-areas-list-page-conflicts-resolved-conservatively` (every attested conflict
    is resolved subtractively **and** backed by an attenuation row whose attestation version,
    reference, `checked_at` and release fingerprint all match the reviewed constants),
    `taito-public-smoking-areas-attenuations-are-attested` (the converse: nothing is weakened that
    the attestations do not call for), and `published-spots-are-active-and-unheld`. A reconciled
    record that regains parsed hours, or loses its attestation row, fails the analysis (tested).
11. **Promotion bundles carry the attenuations.** Otherwise the receiving database would hold the
    weakened value with no recorded evidence, and its `GET /spots/{id}` would publish the attenuated
    field's CSV provenance as if it were the evidence.

### What did not change

The publication invariant's existing conditions, the complete-snapshot publish step, the tile and
spot-detail DTO **shapes**, the source approval mechanism, the evidence-quality vocabulary, and
every unknown / heated-only / existence field rule the Taito resolver applies to the CSV. A
convenience store's name or host still contributes nothing: `taito.listed.v1` remains the existence
evidence for all 34 records, including the two now withheld (tested).

### Still unresolved

- Structured representation of conditional hours (weekday-only, holiday and seasonal exclusions,
  irregular closures). Until then those records publish no machine-readable hours at all, and no
  public provenance for that field.
- A schemaVersion that can say "this field's claim was withdrawn, on evidence outside the source".
  v1 omits the field instead.
- Whether the temporary closure and the temporary relocation have ended. Both are re-checked by
  re-running `spot-check.mjs` and re-reviewing the attestations; nothing expires automatically, and
  deliberately so — a time-dependent resolver would make tiles irreproducible.
- Cross-release matching for Taito, and everything else still listed under the earlier amendments.
