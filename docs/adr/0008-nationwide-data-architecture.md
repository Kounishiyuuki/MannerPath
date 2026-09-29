# ADR-0008 — Nationwide data architecture

Status: Accepted (2026-09, Issue #68, tracker #67). Decision 1 (the SourceAdapter boundary) is
implemented by this ADR's PR, decision 2 (source observations) by Issue #73 and the matcher engine of
decision 3 by Issue #78 (its production gate stays closed), and the review queue and completeness
parts of decisions 5 and 8 by Issue #80, and the reviewed-removal executor of decisions 5 and 8 by
Issue #84 (relocation is still not applied); every other decision fixes a boundary that later issues implement
and may not silently change. The relocation and natural-key policy of decisions 3, 5, 8 and 10 is
fixed by ADR-0009 (Issue #91, design only).

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

As implemented for reviewed releases (Issue #100, `migrations/0016_promotion_bootstrap.sql`,
`promotion-bundle.v2`): the bundle bootstraps the **finished, applied** state of one release; it does not
replay the pipeline. The runtime review chain (decision 8: `review_items`, `review_decisions`,
`review_match_applications`) cannot be carried as it is: its triggers check a pipeline moment (the
previous release current, the reviewed one `ingested`) that the bootstrapped state has left, and it
references the previous release, which is not promoted. So:

- **Carried:** for each record of the release whose identity a reviewer decided (`matchedToEntity` and
  `confirmedNew`), one `promotion_review_match_attestations` row: the decision, the chosen entity, the
  candidates, the previous release's id and fingerprint, the matcher, `decided_by` / `decided_at` /
  decision version / note, executor version and `applied_at`, and the origin item, decision and
  application ids as provenance (not foreign keys). On the target, a `manual` link is accepted only
  with its attestation (0016 replaces the 0011 trigger with "application **or** attestation"), and an
  attested record's decision must follow it.
- **Explicit bootstrap:** the first statement (`promotion_bootstraps`, one row) is accepted only by an
  empty database; while it is open the schema accepts only the declared source and release (in their
  final applied/current state), no release update, no observations and no review rows, and an
  attestation additionally needs that single-release state with no review, decision, spot or tile row
  yet. So a pipeline database cannot create an attestation, even after a hand-inserted bootstrap row,
  and the runtime rule of 0011 is unchanged there. An attestation is weaker evidence than a runtime
  application: the target checks its internal consistency, not the origin chain;
  the last (`promotion_bootstrap_completions`) re-checks on the target the declared source, current
  applied release and fingerprint, every declared row count, the previous-release id and fingerprint
  of each attested record against the bootstrap declaration, and that every attestation was followed.
- **Not carried:** the review queue itself, removal applications / resolutions, relocation holds /
  applications / resolutions. The published state does not claim them: a removed spot is not
  published, and a relocated spot's canonical row is explained by the release's records and the
  identity attestation. They stay in the database that applied them.
- **Trust boundary:** "empty" is every table of the schema, named one by one, including report and App
  Attest tables that reference no canonical row. Because the previous release and the origin review queue
  do not travel, the target cannot detect a bundle edited *consistently* (an attestation, its count and
  its dependency removed together); the database is not asked to. The file's authenticity is checked
  before apply by `npm run local:verify-promotion`, against a `contentSha256` taken from the reviewed
  record of the bundle, never from the file's own header (docs/OPERATIONS.md step 4).

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
  A reviewed match whose coordinate changed is raised as a `relocationCandidate` (ADR-0009 step A,
  Issue #93) and the release stays `needsReview`; `holdRelocationCandidate` can then withhold its spot
  as `relocationUnderReview` (step B, Issue #95), and `applyReviewedRelocation` moves it and lifts that
  hold on a fresh `relocationConfirmed`, which the resolver consumes when it applies the release (step C,
  Issue #97). **Not implemented:** value-update policy for a reviewed match, carrying a
  partial `disappearance` or a `removalRejected` entity forward into release application (such a
  release stays `needsReview`), restoring removed spots. An applied removal is consumed by the
  resolver since Issue #89 (decision 3, `review_removal_resolutions`).

### 9. Source fingerprint (boundary, partly implemented)

A release is identified by `(source_id, content_sha256, observed_on)` plus `source_url`; any
per-release reviewed decision binds to that fingerprint and fails closed on any difference (as the
Taito attestations already do). Unchanged remote bytes update fetch/check metadata only and do not
advance `lastVerifiedAt`; changed bytes create a new immutable release.
*(Refined by the "source refresh foundation" amendment below: changed bytes found by a check become
a review candidate; the release is created by the reviewed ingest, never by the check.)*

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

## Amendment 2026-09 — source refresh foundation (strategy §10 step 5)

Code: `services/api/src/refresh/` (`check.ts`, `artifact-store.ts`, `policy.ts`, `scheduled.ts`),
`SourceAdapter.refreshTarget`, Worker `scheduled` export (`src/index.ts`). Migration:
`0017_source_refresh.sql`. Tests: `services/api/test/source-refresh.test.ts`,
`test/deploy-config.test.ts`.

### Decisions

1. **A check is not an import.** A check fetches an adapter's `refreshTarget.url`, fingerprints the
   bytes (sha256), retains them in R2, compares them and records the attempt. It writes only
   `raw_artifacts`, `source_checks` and `source_refresh_candidates`. It never creates a
   `source_release`, never touches spots, provenance, attenuations, review items or tiles, and never
   advances `lastVerifiedAt`. The refresh module imports none of ingest/observe/resolve/match/removal/
   relocation/publish/promotion (tested). This refines decision 9: a changed file becomes a
   **candidate**; a maintainer turns it into a release through the reviewed flow (ingest with the
   publisher's `observed_on`, observe, resolve, publish, promotion bundle). The check cannot supply
   `observed_on` (the publisher's date is not in the bytes), which is one more reason it must not ingest.
2. **Raw artifacts are content-addressed in R2.** Key `raw/sha256/<hex>`; the object is written only
   when absent (`head` first), with R2's `sha256` integrity check, and never overwritten. An existing
   object of a different size fails the check closed (`storage`). D1 holds only the hash, key, size and
   first storage time; the schema ties the key to the hash. R2 is written before D1, so D1 never names
   a missing object; an interrupted check leaves at most an unreferenced object under its own hash.
3. **Outcomes.** `unchanged`: the hash equals the baseline (the latest non-failed check of the source,
   else its current applied release). `changed`: a different hash with no drift finding.
   `needsReview`: a different hash with at least one finding. `failed`: fetch, HTTP, `tooLarge` or
   storage failure — recorded with whatever metadata was received and the fingerprint if the bytes
   arrived; never a baseline, no candidate. A candidate is one row per `(source, hash)`; content that
   already is a release of the source gets none.
4. **Drift probes** (read-only, source-agnostic, in a fixed order): redirect to another origin
   (`sourceIdentityMismatch`); the adapter's own `parse` refuses the file (`parseFailed`); the header
   differs from the reviewed baseline (`headerChanged`); the record count decreased (`recordCountDecreased`);
   zero records (`noRecords`); the adapter's `observe` refuses records (`recordsUnobservable`); a
   coordinate outside the policy extent (`coordinatesOutsideExtent`). The drift baseline is the current
   applied release, else the last parsed check.
5. **Reviewed policy `source-refresh-policy.v1`** (`src/refresh/policy.ts`). No threshold is
   calibrated, because no refresh history exists: any record decrease is flagged
   (`maxRecordDecrease = 0`); the coordinate extent is Japan's end points per 国土地理院, rounded
   outward (lat 20–46, lng 122–154); bodies over 16 MiB fail as `tooLarge` (Worker memory is 128 MB).
   Changing any value is a new policy version, stamped on every check row.
6. **Idempotence.** `source_checks.check_key = "<run key>:<source id>"` is unique; the Cron run key is
   the scheduled time, so a retried invocation finds its row and neither fetches nor writes again. Rows
   of all three tables are append-only/immutable (triggers).
7. **Cron is check-only and off by default.** The Worker exports `scheduled`, which runs
   `checkSource` for every adapter with a `refreshTarget` and fails loudly without the `RAW_ARTIFACTS`
   binding. Every committed environment has `triggers.crons = []`; enabling a schedule and creating the
   bucket are maintainer actions (`docs/OPERATIONS.md`), guarded by `test/deploy-config.test.ts`.
8. **Promotion.** The refresh tables are not carried by the promotion bundle. Migration 0017 recreates
   `promotion_bootstraps_empty_target` to name them too, so a database with check history is not empty:
   promote first, then enable checks.
9. **Taito.** `refreshTarget` is the reviewed release file. Taito publishes each release under a new
   dated file name, so a check detects in-place changes of that file only; discovering a newer file is
   not implemented. `crossReleaseValidated = false` and `completeness = partial` are unchanged.

### Not implemented

Discovery of new release URLs from a landing page; conditional requests (`If-None-Match`); closing or
superseding candidates; a reviewed command that ingests a candidate's artifact from R2; artifact
retention/expiry (objects are kept); alerting on `failed`/`needsReview`.

## Amendment 2026-09 — mixed-dataset scope (second reviewed source)

Osaka's official environment/recycling CSV mixes designated smoking locations, information-only
smoking venues with access conditions, and paper-recycling businesses. Keeping raw evidence must
not make each host a smoking spot. `SourceAdapter.includesRecord` is an optional, pure, reviewed
raw-row scope predicate, evaluated at the normalization boundary and by read-only refresh drift
probes before field mapping. Ingest still preserves every
row, original ordinal, header (including duplicate column names) and release fingerprint. Only
in-scope rows receive observations, entity decisions and canonical spots; a row outside scope has
no observation for that mapping generation. An adapter without the predicate retains the existing
one-observation-per-record behavior, including Taito's byte-identical golden.

The scope rule is part of `mappingVersion`. Re-derivation refuses an existing observation that
would now be excluded under the same version, including the read-only re-derivation used by review
applications. A nonempty observation generation is created atomically; newly including a row not
in that generation is also refused under the same version. A new scope or field mapping requires
a new mapping version. Scope exclusion is not
removal evidence. Osaka remains partial and `crossReleaseValidated: false`; repeated releases and
cross-source merges are deliberately gated, and the matcher must account for out-of-scope raw
rows before that source's cross-release gate can be opened.

Refresh drift probes skip a row only when `includesRecord` returns false; an exception is a
`recordsUnobservable` finding and produces `needsReview`, never a silent skip. Refresh
`record_count` and its decrease comparison still describe all parsed raw rows, not the subset of
observations. There is no separate in-scope-count baseline in this foundation. That remains a
source-specific review requirement before enabling refresh of a mixed dataset, rather than a new
implicit threshold: checks only queue candidates, and Osaka has no `refreshTarget`. Its approval
is for the pinned first release only; scheduled checks skip it without fetching. Scope remains part
of `mappingVersion`; refresh does not derive or replace observation generations.

## Amendment — cross-source review planning foundation (2026-09)

`services/api/src/pipeline/cross-source.ts` is a pure staging boundary, independent of
source adapters and promotion. It does not write a queue, canonical rows or tiles.
Synthetic independently reviewed sources test overlap; Taito/Osaka geographic separation
is not evidence that this workflow is unnecessary. Existing resolver gates remain intact.

- Candidate v1: different sources, within 100m regardless of names, or within 500m
  with an exact nonempty NFKC/case/whitespace/punctuation-normalized name or location.
  These are review-recall thresholds, not identity thresholds. Host similarity cannot
  confirm identity. Coordinates must be finite WGS84; snapshots must contain independent
  existence evidence and attribution. The trusted future loader must enforce registry
  approval and read the complete current evidence and inbound redirects.
- Candidate identity binds both complete snapshots and algorithm version. A changed
  record/release, field, coordinate or redirect requires a new review. Caller-supplied
  snapshots are trusted staging inputs, not an untrusted API payload.
- Review explicitly states `sameRealWorldSpot`, `distinctSpots` or
  `insufficientEvidence`, with reviewer, date and specific independent location identity
  evidence. No decision/default means unresolved. Distinct/insufficient never yield a
  merge plan. A same decision still requires a separate explicit existing survivor ID.
- The merge proposal preserves that stable ID, the losing ID as a redirect, all inbound
  redirects as one-hop redirects, and the review as merge history. Every source evidence
  object (release/record/entity, existence, fields and attribution) is retained without
  overwriting the current single-field provenance representation.
- Every unequal coordinate or source field is flagged, including unknown versus false
  and missing versus known. No source priority selects values. Every proposal is held,
  including an agreement, until an explicit publication/evidence policy review. Identity
  approval is separate from field conflict resolution and permission to publish.

Persistence and execution are deliberately deferred to avoid competing with the concurrent
multi-source promotion migration. No 0018 is reserved here. After that work merges, assign
a fresh number for immutable candidates, append-only review decisions and merge applications
with snapshot preconditions, full source claim provenance, history and publication holds.
Application must atomically unpublish affected tiles, repoint existing redirects, relink
entities, preserve evidence, apply holds and republish only eligible spots. It must refuse
stale decisions and concurrent identity drift, and replay an already applied decision as a
no-op. Persisted idempotence, DB concurrency and promotion of merges are **not implemented**
by this foundation; pure reruns are deterministic. No operator CLI or public endpoint is
exposed until those transactional guarantees exist.
