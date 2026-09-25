# ADR-0008 — Nationwide data architecture

Status: Accepted (2026-09, tracker #67). Decisions 1 and 2 are implemented (#68 and #72); every
later decision fixes a boundary that subsequent issues implement and may not silently change.

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
- `parserVersion` — stamped on releases; `mappingVersion` — stamped on immutable normalized
  observations and bumped when raw-to-normalized mapping changes; `resolverVersion` — stamped on
  canonical/provenance/attenuation rows;
- `parse` — bytes → header + rows, including schema/header validation (fail loudly; a header
  change stops automatic application);
- `upstreamRowRef` — the publisher's row identifier;
- `mapRecord` — source-specific raw schema to normalized observation mapping, including the raw
  column/rule provenance and subtractive attenuation effects the generic resolver later applies;
- `assertResolvable` — fail-closed per-release checks (for Taito, the Issue #42 list-page
  attestations are bound to one release fingerprint);
- `attenuationReference` — the reviewed evidence every attenuation row of this adapter cites.

The generic steps depend on the boundary; adapters depend on nothing downstream. The interface is
deliberately minimal and grows only with a reviewed source that needs a new member. Taito is the
first adapter (`src/pipeline/taito-adapter.ts`), wiring the unchanged rules in `taito.ts` and
`taito-list-page.ts`.

**Completeness semantics** (whether a source is complete for its scope, so that disappearance is
removal evidence) is part of an adapter's reviewed contract but is not an interface member yet:
nothing consumes it until cross-release matching (decision 3). It is added there, per source,
defaulting to *partial* — disappearance from a partial source never implies removal.

Parity rule: an adapter extraction or re-plumbing must keep the golden output
(`services/api/test/golden-parity.test.ts`) byte-identical. An intended output change regenerates
the golden in the same PR and justifies the diff.

`services/api/src/quality/analyze.ts` still carries Taito-specific checks and a Taito
reconciliation section in its output. It is generalized with nationwide quality metrics (strategy
§10 step 8), not in the adapter extraction, so the quality report's shape does not move twice.

### 2. Normalized source observation layer (implemented)

Between raw records and the resolver sits the immutable, versioned `source_observations` layer
(migration 0008): one row per `(record_id, mapping_version)`, carrying normalized name/coordinate,
tobacco support, hours, lifecycle/publication-hold claim, and the mapping output needed to preserve
raw-column provenance and attenuation effects. Raw `source_records` remain the evidence and are never
rewritten. Observation rows have no fetch/derived timestamp: they are deterministic, re-derivable
adapter output. Re-running the same mapping is a no-op; if code produces different output under the
same mapping version, the pipeline fails closed and requires a version bump. The generic resolver
reads these observations and no longer parses `raw_values_json` or knows source column layouts.
An upgraded database may already contain an `applied` release from before migration 0008; resolving
that release with the correct adapter deterministically backfills its missing observations before
returning `alreadyApplied`, without rewriting canonical rows. Promotion bundle v1 intentionally
remains unchanged in this issue; a freshly migrated promoted database can backfill observations from
the raw records it already carries, while multi-source promotion is decided in decision 7.

### 3. Cross-release matching (boundary)

A new release of the same source is matched to the previous release's source entities by a
versioned matcher that records every decision in `source_record_entities` / `source_record_match_keys`
(`method`, `matcher_version`, note). Match keys come from the adapter (publisher row id only when the
source is reviewed as stable-keyed; otherwise name + coordinate proximity). Ambiguous matches go to
the review queue (decision 8); they are never auto-resolved. The current first-release refusal
stays until a matcher is validated on two real releases of the same source.

### 4. Cross-source matching (boundary)

Records of different sources are never merged automatically on proximity or name alone. A
cross-source matcher proposes duplicate candidates into the review queue; a reviewed merge links
several source entities to one canonical spot (`spot_source_entities`). Official and OSM-derived
records are not mixed until the OSM ADR (decision 11) decides how.

### 5. Removal and relocation (boundary)

- Disappearance is removal evidence only when the adapter declares the source complete for the
  relevant scope, and only after the cross-release matcher found no match.
- A large coordinate movement of a matched entity (threshold per adapter, reviewed) is a
  relocation candidate: the spot is held (`publication_hold`) until reviewed, never silently moved.
- Large record-count drops and schema changes stop automatic application (strategy §7).

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

### 9. Source fingerprint (boundary, partly implemented)

A release is identified by `(source_id, content_sha256, observed_on)` plus `source_url`; any
per-release reviewed decision binds to that fingerprint and fails closed on any difference (as the
Taito attestations already do). Unchanged remote bytes update fetch/check metadata only and do not
advance `lastVerifiedAt`; changed bytes create a new immutable release.

### 10. Stable canonical IDs (boundary)

`spot_id` is generated once (CSPRNG, `src/spot-id.ts`) and never derived from source data, so a
re-import, a matcher version change or a new source never renames a spot. A merge keeps the
surviving id and records `merged_into` on the other; clients follow the redirect. A removed spot
keeps its id.

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
