# ADR-0008 — Nationwide data architecture

Status: Accepted (2026-09, Issue #68, tracker #67). Decision 1 (the SourceAdapter boundary) is
implemented by this ADR's PR, decision 2 (source observations) by Issue #73 and the matcher engine of
decision 3 by Issue #78 (its production gate stays closed), and the review queue and completeness
parts of decisions 5 and 8 by Issue #80, and the reviewed-removal executor of decisions 5 and 8 by
Issue #84 (relocation is still not applied); every other decision fixes a boundary that later issues implement
and may not silently change. The relocation and natural-key policy of decisions 3, 5, 8 and 10 is
proposed in ADR-0009 (Issue #91, design only).

Formalizes `docs/NATIONWIDE_DATA_STRATEGY.md` §2, §4 and §7 as implementation decisions. It extends
ADR-0002 (canonical data), ADR-0005 (tiles) and ADR-0006 (evidence and publication) and replaces
none of them: the source/release/record/provenance/attenuation/tile foundation is retained.

## Context

The pipeline was built for one source. Taito-specific code sat directly inside the generic steps:
`ingest.ts` validated the Taito header and stamped the Taito parser version, `resolve.ts` called the
Taito resolver and cited the Taito list-page constants on every attenuation, and `registry.ts`
listed the Taito entry by name. The resolver also refuses a second release of any source, because
no matcher has been validated on two real releases. Nationwide coverage needs many sources, repeated
releases and cross-source overlap, without weakening any existing evidence rule.

## Decisions

### 1. SourceAdapter boundary (implemented)

A reviewed source enters the pipeline only through a `SourceAdapter`
(`services/api/src/pipeline/source-adapter.ts`), listed in `SOURCE_ADAPTERS`
(`src/pipeline/adapters.ts`). An adapter carries:

- `registry` — its reviewed `docs/SOURCES.md` entry (source id, kind, license, attribution,
  publication status). `REVIEWED_SOURCES` is derived from the adapters, so a source has code-side
  approval only if it has an adapter. `registry.sourceId` is the **only** source identity:
  `ingestRelease(db, adapter, bytes, meta)` takes no source id and files the release under the
  adapter's source, and `resolveFirstRelease(db, adapter, releaseId, …)` fails closed before any
  write unless the release's `source_id` and `parser_version` are the adapter's (a mismatched
  release from an older ingest or hand-written SQL is never resolved). Tests that need Taito-shaped
  data under another source use a test-only adapter with its own `registry.sourceId`, never a
  production override;
- `parserVersion` / `resolverVersion` — stamped on releases and on resolved rows, so a release is
  always resolved by the rules that parsed it;
- `parse` — bytes → header + rows, including schema/header validation (fail loudly; a header
  change stops automatic application);
- `upstreamRowRef` — the publisher's row identifier;
- `mappingVersion` / `observe` — the field mapping: one raw record → its normalized observation,
  with per-field source columns and rule (decision 2);
- `attenuate` — the weakenings the adapter's reviewed attenuation reference applies to one
  observation (for Taito, the Issue #42 list-page conflicts);
- `assertResolvable` — fail-closed per-release checks (for Taito, the Issue #42 list-page
  attestations are bound to one release fingerprint);
- `attenuationReference` — the reviewed evidence every attenuation row of this adapter cites.

The generic steps depend on the boundary; adapters depend on nothing downstream. The interface is
deliberately minimal and grows only with a reviewed source that needs a new member. Taito is the
first adapter (`src/pipeline/taito-adapter.ts`), wiring the unchanged rules in `taito.ts` and
`taito-list-page.ts`.

**Completeness semantics** (whether a source is complete for its scope, so that disappearance is
removal evidence) is part of an adapter's reviewed contract: `SourceAdapter.completeness`,
`partial` | `complete` (Issue #80). A missing or undeclared value means *partial* — disappearance
from a partial source never implies removal, and nothing defaults to complete. `complete` is set
only from reviewed publisher evidence that the list is exhaustive for the scope; Taito declares
`partial`, because its review (`docs/SOURCES.md`) does not establish that.

Parity rule: an adapter extraction or re-plumbing must keep the golden output
(`services/api/test/golden-parity.test.ts`) byte-identical. An intended output change regenerates
the golden in the same PR and justifies the diff.

`services/api/src/quality/analyze.ts` still carries Taito-specific checks and a Taito
reconciliation section in its output. It is generalized with nationwide quality metrics (strategy
§10 step 8), not in the adapter extraction, so the quality report's shape does not move twice.

### 2. Normalized source observation layer (implemented, Issue #73)

Between raw records and the resolver sits an immutable, versioned `source_observations` layer:
one row per raw record per adapter mapping version, carrying normalized fields (name, coordinate,
tobacco support, hours raw/parsed, lifecycle claims) plus the mapping version. The resolver then
reads observations, never raw source schemas. Raw records remain the evidence and are never
rewritten; observations are re-derivable from them.

As implemented (migration `0008_source_observations.sql`, `src/pipeline/observe.ts`):

- `observeRelease(db, adapter, releaseId)` is, with ingest, the only step that reads
  `raw_values_json`. It fails closed before any write unless the release's `source_id` and
  `parser_version` are the adapter's; a trigger also refuses an observation whose `source_id` is not
  its record's release's, and `(record_id, release_id)` references the raw record.
- One row per `(record_id, mapping_version)`, immutable (no UPDATE/DELETE), with no derivation
  timestamp, so the rows are a pure function of the raw record and the mapping. Deriving again
  writes nothing; it re-derives and refuses a difference, so a mapping change without a new
  `mappingVersion` fails loudly. A new version adds a generation beside the old one.
- An observation holds only what the record states: name, coordinate, tobacco support, hours
  (`none` = no hours stated, raw and parsed NULL; `unparsed` = raw text only; `parsed` = raw text +
  parsed JSON — the same three shapes the schema CHECKs), the source's lifecycle claim and each field's source columns + rule.
  Attenuations and publication holds are not observations — they come from reviewed evidence
  outside the record — and stay in `spots.publication_hold` / `spot_field_attenuations`.
- The resolver reads the observations, runs the adapter's `assertResolvable` over them, applies
  the adapter's `attenuate` effects generically (subtractive only) and copies each field's
  provenance into `spot_field_provenance`, still citing the raw `record_id` and its columns.
  Observations are written before `assertResolvable`, so a refused release keeps its
  observations and nothing canonical.
- A release applied before migration 0008 has no observations. `resolveFirstRelease` with the
  release's own adapter backfills them (identity checked first) and returns `alreadyApplied`
  without touching any canonical, provenance, attenuation or tile row. The backfill is only the raw
  → observation mapping, so it never re-runs `assertResolvable`: a past release does not need
  today's external attestations to gain its observations.
- Canonical rows carry `resolver_version`, not the mapping version: an adapter pairs exactly one
  `resolverVersion` with one `mappingVersion`, so a mapping change must bump both.
- The promotion bundle does not carry observations; they are re-derivable from the records it does
  carry. Adding them was a behavior-preserving change: the golden differs only by the new table.

### 3. Cross-release matching (boundary; engine implemented, Issue #78, gate closed)

A new release of the same source is matched to the previous release's source entities by a
versioned matcher that records every decision in `source_record_entities` / `source_record_match_keys`
(`method`, `matcher_version`, note). Match keys are versioned and have two origins: the generic
raw-identical key is the record's `raw_sha256`, derived by the generic matcher for every source; a
source-specific natural key (publisher row id only when the source is reviewed as stable-keyed;
otherwise name + coordinate proximity) comes from the adapter, and only once a reviewed policy for
that source exists. Ambiguous matches go to
the review queue (decision 8); they are never auto-resolved. The current first-release refusal
stays until a matcher is validated on two real releases of the same source.

As implemented (`src/pipeline/match.ts`, `resolveNextRelease` in `src/pipeline/resolve.ts`):

- Matcher `cross-release.v1+raw-sha256.v1` reads match key version `raw-sha256.v1` (the record's
  immutable `raw_sha256`) and never raw values. Key rows for both releases are written when a
  later release is applied; a first release writes none, so its output is unchanged.
- `raw_identical`: the key is unique in both releases → the previous entity is reused, and so its
  spot (`spot_id`, `created_at` and the `spot_source_entities` link never change). Only evidence
  moves: provenance cites the new record, `last_verified_at` becomes the new `observed_on` (which
  must be newer than the current release's), `updated_at` is the application time. The values
  re-derive identically by construction and are asserted to; the current canonical row must also
  equal what the new observation resolves to (name, coordinate, tile, tobacco support, hours,
  lifecycle, hold), or the release is refused as canonical drift and no evidence moves.
- `natural_key` is **not enabled**: Taito's `#` is not reviewed as stable, and no reviewed name +
  coordinate-proximity threshold exists. Natural keys are source-specific, versioned, reviewed and
  fail closed on missing / colliding / changed keys (ADR-0009 decision 2).
- `new`: an unmatched record while no previous entity is left unmatched.
- Ambiguous (duplicate keys on either side, or an unmatched record while previous entities remain
  unmatched — an edit and an add + remove are indistinguishable without a natural key): the release
  is not applied and gets no canonical write; never guessed, never a silent new entity. Since Issue
  #80 each ambiguous record is stored as a review item and the resolver returns `needsReview`
  (decision 8) instead of throwing.
- An unmatched previous entity (disappearance candidate) likewise leaves the release unapplied, with
  a review item: nothing is removed, moved or held here (decision 5). Carrying attenuations across releases is not
  implemented, so a matched spot that is attenuated, held or merged refuses the release too.
- Gate: `SourceAdapter.crossReleaseValidated`. `TAITO_ADAPTER` keeps it `false` — the repository
  has one real Taito release; the tests' second releases are artificial fixtures under a test-only
  source and do not count as the two-real-release validation.
- Completeness semantics arrived with Issue #80 (see decision 1); the matcher itself does not read it.
- Reviewed ambiguous matches (Issue #86, `src/pipeline/reviewed-match.ts`): the pure
  `planReviewedMatch` combines the automatic plan with the latest decision of each stored
  `ambiguousMatch` item of exactly this comparison into an effective plan. A record is resolved
  when it is `raw_identical`, `new`, reviewed `matchedToEntity` (`method = 'manual'`, the chosen
  candidate's entity and spot kept) or reviewed `confirmedNew` (a new entity and spot). The release
  is applied only when no item is open (none / `deferred`) and every previous entity is continued by
  a record; `confirmedNew` never turns a left-over previous entity into a disappearance or removal
  by itself — it is raised as a disappearance/removal candidate item and the release stays
  `ingested`. A reviewed same entity is **not** an approved field update: evidence moves only when
  the new observation equals the previous one and `assertEvidenceCanMove` holds (no canonical
  drift, no attenuation/hold/merge). A changed coordinate is refused as relocation (not
  implemented; no distance threshold is chosen here), any other changed value is refused until a
  value update policy exists, and a removed or merged spot is never a match target (restoring is
  its own reviewed step). Two records claiming one entity, a decision outside the candidates or of
  an unknown `decision_version` are refused.
- Previous entities resolved by an applied reviewed removal (Issue #89,
  `migrations/0012_review_removal_resolutions.sql`, `resolvePreviousEntities` in
  `src/pipeline/reviewed-match.ts`): record decisions and previous entities are separate. Each
  previous entity is `continuedByRecord`, `resolvedByReviewedRemoval` or `unresolved`. It is
  `resolvedByReviewedRemoval` only when its complete-source `removalCandidate` item of exactly this
  comparison has a latest `review-decision.v1` decision `removalConfirmed` **and** that exact
  decision's `review_removal_applications` row (same item, decision, spot) exists, the spot is
  `removed` and unmerged, and it is still linked to that entity alone. A decision without its
  application, `removalRejected`, `deferred`, no decision, or a partial source's `disappearance`
  stays `unresolved` (`needsReview`). An application whose premise changed since — another latest
  decision, another item, link drift — fails closed. The resolver never removes a spot and invents no
  record decision or `source_record_entities` row for the missing record; it writes one
  append-only `review_removal_resolutions` row per consumed application (release, previous release,
  item, decision, application, entity, spot, `review-removal-resolution.v1`, `applied_at`) in the
  same batch as the release, before the release-state updates. Its insert trigger re-checks
  everything above plus the stale-evidence conditions of 0010/0011, so a decision recorded after
  the resolver read the queue aborts the whole batch. The release is applied (match keys,
  application and resolution audit rows, provenance, `is_current` switch) only when every record
  and every previous entity is resolved; otherwise nothing is written. `removalRejected` is **not**
  a resolution: keeping an active spot whose existence evidence stays in the previous release
  conflicts with single-release promotion (decision 7) and needs a carry-forward policy first.
- The promotion bundle still carries one release per source; multi-release promotion is decision 7.

### 4. Cross-source matching (boundary)

Records of different sources are never merged automatically on proximity or name alone. A
cross-source matcher proposes duplicate candidates into the review queue; a reviewed merge links
several source entities to one canonical spot (`spot_source_entities`). Official and OSM-derived
records are not mixed until the OSM ADR (decision 11) decides how.

### 5. Removal and relocation (boundary)

- Disappearance is removal evidence only when the adapter declares the source complete for the
  relevant scope, and only after the cross-release matcher found no match.
- A coordinate change of an entity whose identity was established without the coordinate (reviewed
  natural key or reviewed match) is a relocation candidate: the spot is held (`publication_hold`)
  until reviewed, never silently moved. Amended by ADR-0009: **every** change is reviewed in policy
  v1, no threshold is chosen, a reviewed per-source threshold never auto-accepts a move, and the
  hold is a separate explicit step, not a resolver write (ADR-0009 decisions 1, 3, 4).
- Large record-count drops and schema changes stop automatic application (strategy §7).

As implemented (Issue #80): an unmatched previous entity becomes a review item of kind
`disappearance` for a partial source (not removal evidence; the schema refuses a
`removalConfirmed` decision on it) or `removalCandidate` for a complete one, citing the entity,
its spot, both releases, the completeness and the matcher version. No candidate changes a spot, its
lifecycle, coordinates, hold, provenance or the release state.

Removal application (Issue #84, `migrations/0010_review_removal_applications.sql`,
`src/pipeline/removal.ts`): `applyReviewedRemoval(db, reviewItemId, { now })` is the only step that
removes a spot, and it is explicit — the resolver never reads decisions. It applies a
`removalCandidate` of a **complete** source whose latest decision (largest `review_decision_id`) is
`removalConfirmed`; `removalRejected`, `deferred` or no decision is `notApplicable`, and a partial
source's `disappearance` is refused. In one batch it inserts a `review_removal_applications` row
(`spot_id`, `review_item_id`, `review_decision_id`, `executor_version`
`review-removal-executor.v1`, `applied_at`), unpublishes the spot from `tile_snapshot_spots` and sets
`spots.lifecycle = 'removed'`; the insert trigger re-checks inside the statement that the named
decision is still the item's latest removalConfirmed for an active spot still linked to the item's
entity, so a decision recorded after the executor read the queue aborts the whole batch. The same
trigger refuses **stale evidence**: the item's `previous_release_id` must still be the source's
current applied release, its `release_id` must still be `ingested`, and no other unrejected release
of the source may be newer than that current release — "newer" as `resolveNextRelease` defines it (a
strictly later `observed_on`), with an unknown `observed_on` on either side treated as not comparable
and therefore refused. It accepts only `executor_version = 'review-removal-executor.v1'`; a v2
replaces the trigger in its own migration, as for `review-decision.v1`.
**Temporary safety gate:** the trigger also refuses a spot linked to any source entity other than the
item's, so one source's disappearance never removes a spot that another source supports. It is
lifted only by the PR that implements cross-source removal semantics (decision 4). Only
lifecycle (and `updated_at`) changes: the spot id, links, raw records, observations, provenance,
attenuations and review rows stay, and nothing is deleted. The schema allows `removed` only with an
application row, one application per spot and per decision, and no update back from a reviewed
removal. Reapplying the same decision is `alreadyApplied`; a spot removed on another decision, or
whose item's latest decision has since changed, fails closed. The ordinary `publishTiles` then
rebuilds the affected tile (new revision, content hash and ETag) without the spot; other tiles keep
their revision. Applying a removal does not apply the release under review: the second release stays
`ingested` until the resolver is re-run, which then consumes the application (decision 3, Issue
#89) and, if nothing else is open, applies that release; the removed spot keeps its entity, link,
old raw records and provenance, and is absent from the tiles republished afterwards and from the
promotion bundle of the new current release. **Not implemented:** relocation detection (needs a reviewed natural key and distance
threshold) and relocation holds, restoring a removed spot, and the record-count / schema-change
stop.

### 6. Generic attenuation (boundary, partly implemented)

Attenuation stays subtractive and evidence-backed: it only weakens a value (hours → unparsed,
lifecycle → temporarilyClosed, publication hold) and writes a `spot_field_attenuations` row citing
reviewed evidence and the exact release fingerprint; it never writes a stronger value and never
edits provenance. The adapter now supplies the reference (decision 1). Cross-source conflicts use
the same mechanism: disagreement between sources resolves to unknown or hold, never to the stronger
claim, unless an explicit reviewed evidence rule applies.

### 7. Multi-source / multi-release promotion (boundary)

The promotion bundle (`src/pipeline/promotion.ts`) currently carries one source's current release.
It is generalized to a manifest listing every approved source's current release fingerprint, the
tile set and row counts, still deterministic and still refusing unapproved or OSM data.

### 8. Review queue (boundary)

Ambiguous cross-release matches, cross-source duplicate candidates, relocation candidates,
completeness-based removals and schema changes are written to an explicit review queue table and
held from automatic effect until a reviewed decision is recorded (who/when/decision/version).
Review decisions are evidence records, not edits of canonical rows.

As implemented (Issue #80, `migrations/0009_review_queue.sql`, `src/pipeline/review-queue.ts`):

- `review_items` (append-only): source, release + `content_sha256`, previous release, kind,
  matcher version, source completeness, involved record / entity / spot, `details_json`
  (reason, candidate entity ids, previous record), `created_at`. The schema refuses involved
  entities that the previous release did not record for this source, an empty, non-integer or
  duplicated candidate list, and a spot that is not the entity's `spot_source_entities` link;
  candidate spots are read from that table, not copied. Identity is
  `(source, release, previous release, matcher version, kind, candidate_key)`, where the key is
  derived from the involved ids only, so re-processing a release returns the same items; a stored
  item whose details differ from a re-run is refused loudly. Kinds: `ambiguousMatch`,
  `disappearance`, `removalCandidate`; relocation (`relocationCandidate`, proposed in ADR-0009),
  cross-source duplicate and schema-change kinds are added later by replacing the kind trigger, not by rebuilding the table.
- `review_decisions` (append-only): item, decision, `decision_version` (`review-decision.v1`),
  chosen entity for `matchedToEntity`, `decided_by`, `decided_at`, note. Decisions valid per kind
  and the only known `decision_version` are enforced by the schema (a v2 replaces the trigger in its
  migration). An item is open while it has no decision; its **latest decision is the one with the
  largest `review_decision_id`** for that item. `decided_at` is evidence of when, never precedence.
  `recordReviewDecision` returns its own row's id via `INSERT … RETURNING`.
- The resolver stores the candidates and returns `{ status: "needsReview", reviewItemIds }`; the
  release stays `ingested`, and no match key or canonical row is written.
- Applying a decision is a separate step from recording it. Removal (Issue #84, decision 5):
  `applyReviewedRemoval` records which review item and decision it applied in
  `review_removal_applications`. Ambiguous matches (Issue #86, decision 3): the resolver reads the
  latest `matchedToEntity` / `confirmedNew` decisions into its effective plan and, only when the
  whole release resolves, writes in the same batch one `review_match_applications` row per applied
  decision (item, decision, record, chosen entity, `review-match-application.v1`, `applied_at`;
  append-only). Its insert trigger re-checks inside the batch that the decision is still the
  item's latest `review-decision.v1` decision, the entity is a candidate of the previous release
  whose spot is active and unmerged, the previous release is still current applied, the release
  is still `ingested`, and no other unrejected release is newer (or not comparable) — so a
  decision recorded after the resolver read the queue, or a stale comparison, aborts the whole
  batch. An item and a decision are applied at most once, so another decision cannot be
  substituted; a re-run of an applied release is `alreadyApplied`. A `manual`
  `source_record_entities` row cannot be inserted without its application row.
  **Not implemented:** relocation, value-update policy for a reviewed match, carrying a
  partial `disappearance` or a `removalRejected` entity forward into release application (such a
  release stays `needsReview`), restoring removed spots. An applied removal is consumed by the
  resolver since Issue #89 (decision 3, `review_removal_resolutions`).

### 9. Source fingerprint (boundary, partly implemented)

A release is identified by `(source_id, content_sha256, observed_on)` plus `source_url`; any
per-release reviewed decision binds to that fingerprint and fails closed on any difference (as the
Taito attestations already do). Unchanged remote bytes update fetch/check metadata only and do not
advance `lastVerifiedAt`; changed bytes create a new immutable release.

### 10. Stable canonical IDs (boundary)

`spot_id` is generated once (CSPRNG, `src/spot-id.ts`) and never derived from source data, so a
re-import, a matcher version change or a new source never renames a spot. A merge keeps the
surviving id and records `merged_into` on the other; clients follow the redirect. A removed spot
keeps its id. A relocated spot keeps its id too; relocation is never removal + new (ADR-0009).

### 11. OSM remains blocked

No OSM adapter may be added, and the schema's refusal of an approved `kind = 'osm'` source stays,
until a dedicated ODbL ADR decides the production architecture (strategy §4,
`docs/DATA_POLICY.md`). The nationwide goal does not authorize OSM.

## Invariants carried over unchanged

Convenience store ≠ ashtray evidence; existence evidence is mandatory; unknown ≠ false; every source
needs a license review before approval; MapKit is not canonical; conflicts attenuate or hold and
never fabricate a stronger value; no raw location history; stable spot IDs.

## Consequences

- Adding a source is: a `docs/SOURCES.md` review, an adapter with fixtures and tests, and its entry
  in `SOURCE_ADAPTERS`. No generic step changes for a source with Taito-like semantics.
- Decisions 2–10 each need their own issue (tracker #67) and must stay within these boundaries or
  amend this ADR.
