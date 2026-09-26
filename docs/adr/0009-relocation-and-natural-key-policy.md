# ADR-0009 — Relocation and natural-key policy

Status: Accepted (2026-09, Issue #91, tracker #67). Implemented so far: step A only (Issue #93,
candidate detection and review vocabulary); steps B–E are not implemented. It fixes the rules that
the follow-up issues listed under "Implementation plan" implement. It amends ADR-0008 decisions 3, 5, 8 and 10 and replaces none of them. ADR-0006
decision 6 (`publication_hold` is an axis, not lifecycle) and decision 11 (unpublish first) are kept.

## Context

The cross-release matcher (ADR-0008 decision 3) matches today by `raw_sha256` only. A record whose
coordinate changed therefore never matches automatically. Its only route to "same entity" is a
reviewed `matchedToEntity` decision on an `ambiguousMatch` item (Issue #86). The resolver then refuses
the release, because the coordinate differs and relocation is not implemented
(`services/api/src/pipeline/resolve.ts`, `ReviewedMatchError` "relocation is not implemented").

ADR-0008 decision 5 already says that a large coordinate movement of a matched entity is a relocation
candidate, held until reviewed and never silently moved. It also says that the threshold is "per
adapter, reviewed". Neither a natural key nor a threshold exists for any source. Taito's `#` is a row
number and is not shown to be stable (`docs/research/2026-09-launch-dataset-and-tile-zoom.md` §7).
The repository has one real Taito release. This ADR decides what relocation means before any of it is
built, so that the implementation cannot make those decisions by accident.

## Decisions

### 1. Relocation identity rule

A **relocation candidate** exists only when **both** of these hold:

- **Identity is established without using the coordinate.** Either (a) a reviewed natural key of the
  source (decision 2) matches exactly one previous entity and exactly one new record, or (b) a
  reviewer recorded `matchedToEntity` on an `ambiguousMatch` item.
- **The coordinate changed.** The new observation's coordinate is not equal to the previous
  observation's coordinate. Equality is exact numeric equality of the normalized, stored
  observation coordinates: `35.7112` and `35.711200` are the same number. No tolerance or epsilon
  is used (decision 3).

Nothing else is a relocation candidate:

- If identity cannot be established, the case is an `ambiguousMatch` and never a relocation.
  Examples: no reviewed key, a missing key, a key collision, a changed key, or more than one plausible
  previous entity.
- A match that uses the coordinate as part of identity cannot also prove that the coordinate moved.
  So a proximity-based key (name + distance) never produces a relocation candidate by itself. Moves
  beyond its proximity bound are unmatched by definition. Moves within it are still reviewed
  (decision 3).
- Relocation is per source. Records of different sources never relocate each other (ADR-0008
  decision 4).

### 2. Natural-key rule

A natural key is a **source-specific, versioned and reviewed** identity key. It is stored as
`source_record_match_keys` rows under its own `key_version`. That table already supports several key
versions per record (migration 0001). The adapter derives the key; the matcher reads only the
stored rows. See "SourceAdapter boundary". The matcher version names every key version it reads.

- **Reviewed before it is enabled.** A source has a natural key only when a `docs/SOURCES.md` review
  cites evidence that the key identifies the same physical place across releases. Acceptable evidence
  is a publisher statement, or a comparison of at least two real releases recorded in the source's
  research doc. Research is not approval. An unreviewed candidate, such as Taito's `名称` +
  `設置位置`, stays research.
- **Versioned.** A change to normalisation or to the columns used is a new key version and a new
  matcher version. Stored keys are immutable, and old versions are never rewritten.
- **Fail closed.**
  - *Missing key* (the record has no value): the record is not matched by the key. If it is also not
    `raw_identical`, it becomes `ambiguousMatch` whenever previous entities remain unmatched.
  - *Collision* (the same key more than once within one release, on either side): every involved
    record becomes `ambiguousMatch`, and none of them is linked by the key.
  - *Changed key* (the entity is still there but its key changed): the matcher cannot see this. The
    result is an unmatched record plus an unmatched previous entity, which is the existing
    `ambiguousMatch` + disappearance/removal flow. It is never guessed as a relocation.
- **Precedence.** `raw_identical` first, then the natural key, then review. A natural-key match with
  an unchanged observation moves evidence exactly as `raw_identical` does (ADR-0008 decision 3,
  including canonical-drift refusal). A natural-key match with any changed value is **not** an
  automatic update: a changed coordinate is a relocation candidate, and any other change stays
  refused until a value-update policy exists.
- `method = 'natural_key'` already exists in `source_record_entities`. It is written only by a
  matcher whose adapter declares a reviewed key.

### 3. Threshold rule

- **No distance threshold is chosen by this ADR, for any source.**
- In policy v1, **every** coordinate change of a same-identity entity requires relocation review.
  This includes changes of a few centimetres. There is no "jitter" tolerance, because silently
  accepting a small move is an automatic coordinate update, which this ADR forbids.
- Any future threshold is source-specific, cites reviewed evidence, and is versioned with the policy
  version that uses it. Its only permitted uses are:
  (a) the proximity bound of a proximity-based natural key (decision 1), and
  (b) the priority or triage of relocation review items, for example a reviewer display.
  A threshold never auto-accepts a move, never auto-rejects one, and never sets or lifts a hold.
- A source without a reviewed threshold simply has none. Relocation still works for it through
  identity + review. Its coordinate changes are never judged automatically.

### 4. `publication_hold` semantics

- Detecting a candidate (the resolver) writes **no** canonical row, as for every other review kind.
  The release stays `ingested` / `needsReview`, and the previous current release keeps being
  published.
- A **relocation hold** is set by a separate, explicit, idempotent step (`holdRelocationCandidate`).
  It is never set by the resolver. The step runs only for an open `relocationCandidate` item whose
  premise is still current, meaning the same stale-evidence checks as migrations 0010–0012. The hold
  only withholds and adds no new value, so it is a subtractive, evidence-backed attenuation (ADR-0008
  decision 6), and it needs no reviewer decision. What it is: evidence exists that the published
  coordinate may be wrong. It is not a claim that the place moved.
- The hold follows ADR-0006 decision 11: the spot is unpublished first, then `publication_hold` is
  set. New vocabulary value: `relocationUnderReview` (existing: `locationSuperseded`). The two values
  stay distinct. `locationSuperseded` is the Taito list-page attenuation, which carries no
  replacement coordinate.
- The hold is lifted **only** by the same reviewed workflow that resolves the item:
  - `relocationConfirmed` application: the spot moves and is republished (decision 5).
  - `relocationRejected` does **not** lift the hold by itself. A rejection means only that the
    same-entity premise may be wrong. It does not verify that the old coordinate is safe. The old
    entity's existence and location still have to be resolved by a separate flow (`ambiguousMatch`
    / disappearance / removal). The hold is lifted only by a later, explicit, reviewed resolution
    of that flow, which is a later issue. In particular, a partial source's old spot is never
    republished automatically because of a `relocationRejected`.
  - `deferred` keeps the hold.
- A spot that is already held for another reason (`locationSuperseded`) is not relocated in v1. The
  candidate is refused as "held; carry-forward not implemented", like any other held spot in
  ADR-0008 decision 3.

### 5. Application semantics (`relocationConfirmed`)

The step is `applyReviewedRelocation`, separate from the decision and explicit, as `applyReviewedRemoval`
is. In one batch it may change **only**:

- `spots.latitude` / `longitude`, and `tile_id` derived from them. The value is copied from the new
  observation that the item cites, never typed in by the reviewer.
- tile membership, rebuilt by the ordinary `publishTiles`. If the old and new z14 tiles differ,
  the spot leaves the old tile and enters the new one, and both tiles get a new revision / content
  hash / ETag. If the move stays inside the same z14 tile, only that one tile is rebuilt. No other
  tile changes.
- `publication_hold` back to NULL, only if the hold is this item's `relocationUnderReview`.
- `updated_at`, and the evidence move of the whole release application (provenance cites the new
  record, `last_verified_at`). This happens only when the resolver later applies the release,
  exactly as for a reviewed match.

It must not change `spot_id`, `created_at`, `source_entity_id`, `spot_source_entities`, lifecycle,
`merged_into`, raw records, observations, old provenance history, attenuation rows or review rows.
It is refused if any other observed field differs (no value-update policy), if the spot is removed,
merged or linked to another source's entity, or if the decision is not the item's latest
`review-decision.v2` decision. An append-only `review_relocation_applications` row records the item,
decision, spot, entity, old coordinate, new coordinate, old tile, new tile, policy version, executor
version and `applied_at`. Its insert trigger re-checks the premise inside the batch, as in
0010–0012.

### 6. `spot_id`

This decision is unchanged from ADR-0008 decision 10. A relocated spot keeps its id. Relocation is
never modelled as removal + a new spot, and never as a merge. A client that saved the spot follows it
to the new coordinate.

### 7. Auditing old and new location evidence

- Nothing is deleted. `spot_field_provenance` is not a history: when a release is applied it is
  re-pointed at the new record. The old coordinate therefore stays auditable through:
  - the previous release's `source_records` row;
  - its `source_observations` row;
  - its `source_record_entities` row;
  - the immutable review item and decision;
  - the before/after values in `review_relocation_applications`.
- The `relocationCandidate` item carries the full comparison in `details_json`. It holds identity
  inputs only, from which the stored `candidate_key` is derived:
  - previous record id, entity id, spot id, and new record id;
  - old and new coordinate, as copied observation values, with the exact observation ids and their
    mapping version;
  - the computed distance in metres, informational only (decision 3);
  - how identity was established: `naturalKey` + `key_version`, or `reviewedMatch` + the
    `ambiguousMatch` item and decision ids;
  - matcher version and relocation policy version;
  - the threshold version, or `null` when the source has none;
  - both release fingerprints (the release's `content_sha256` is already on the item; the previous
    release's fingerprint is added to the details).
- The application row (decision 5) is the canonical before/after record of the move.

### 8. Removal + new vs relocation

| Situation | Outcome |
| --- | --- |
| Same reviewed natural key, coordinate changed | `relocationCandidate` |
| Reviewer chose `matchedToEntity`, coordinate changed | `relocationCandidate` (identity from the review) |
| Identity cannot be established (no key, missing / colliding / changed key) | `ambiguousMatch`; never relocation |
| Reviewer chose `confirmedNew`, and the old entity is left over | new spot + `disappearance` (partial source) or `removalCandidate` (complete source) |
| Complete source, old entity gone, genuinely new entity elsewhere | removal (reviewed) + new |

The pipeline never merges removal + new into a relocation, and it never splits a relocation into
removal + new. Only a reviewer's identity decision, or a reviewed natural key, connects two records.

## Review vocabulary (proposal)

This follows the existing naming: item kinds are camelCase nouns (`ambiguousMatch`,
`removalCandidate`), and decisions are camelCase past participles with a subject prefix
(`removalConfirmed` / `removalRejected`).

- Kind: `relocationCandidate`. It requires `previous_release_id`, `record_id`, `source_entity_id`
  and `spot_id`. `candidate_key` = `record:<id>|entity:<id>`.
- Decisions on a `relocationCandidate` use **`review-decision.v2`**, validated by replacing
  `review_decisions_valid` as migration 0009 anticipates:
  - `relocationConfirmed`: the same place moved to the new coordinate.
  - `relocationRejected`: not confirmed as a move. The hold stays (decision 4).
  - `deferred`: the word is shared with v1, but a decision row on a `relocationCandidate` is v2.

  Reasons for v2:
  - v1 vocabulary and semantics are not changed retroactively.
  - A relocation consumer can require exactly v2.
  - The meaning of a version stays fixed for audit.

  The v1 decisions of `ambiguousMatch`, `disappearance` and `removalCandidate` are unchanged and
  stay v1. v1 is invalid on a `relocationCandidate`, and v2 is invalid on the other kinds.

## Schema proposal (not migrated)

- `0013`: replace the `review_items_kind` / involved-ids triggers so that they accept
  `relocationCandidate`, and replace `review_decisions_valid` for its decisions.
- `0014`: `spots.publication_hold` CHECK adds `relocationUnderReview`. SQLite cannot alter a CHECK,
  so this needs the table-rebuild or trigger approach that the implementing PR chooses and tests. Add
  an append-only `review_relocation_holds` table (item, spot, `applied_at`, executor version). A hold
  of this value requires its row.
- `0015`: an append-only `review_relocation_applications` table (decision 5), plus the trigger that
  refuses a coordinate update on `spots` without a matching application row. With that trigger, the
  database itself refuses "arbitrary field update" of coordinates.

## SourceAdapter boundary (proposal)

This PR fixes the boundary only. The concrete API is decided with the first reviewed natural key:

- **Derivation is an adapter step.** Natural keys are derived at the source adapter boundary, like
  `observe`, and never by the matcher. The matcher never reads `raw_values_json`.
- **Stored, then matched.** Each derived key is stored immutably in `source_record_match_keys` under
  its `key_version`. The matcher reads only stored `key_version` / `match_key` rows, as it already
  does for `raw-sha256.v1`.
- **Allowed material.** If a source has a reviewed stable publisher id (`upstream_row_ref`), the
  adapter may use it as key material. If the key needs source-specific raw fields, the adapter
  reads them during derivation. The raw schema is never exposed to the matcher.
- **No identity field in `SourceObservation`.** `SourceObservation` is the canonical normalization
  and is not required to carry publisher identity. No publisher-specific identity field is added to
  it for keys.
- **Optional, absent = disabled** (like `completeness`). Collision / missing / changed key rules
  are decision 2.

Nothing else is added now:

- A proximity threshold is not added. It is needed only by a proximity-based key, and no source has
  reviewed one. It arrives with such a source, together with its evidence.
- No `relocationPolicy` member is added. v1 relocation behaviour is generic (every change → review)
  and needs no source input.

## Taito — what is missing

`TAITO_ADAPTER` keeps `crossReleaseValidated = false`, `completeness = partial`, no `naturalKey` and
no threshold. The missing evidence:

1. **Stable key.** `#` is a row number (research §7). No previous release existed to compare against,
   and the ward has not been asked. `名称` + `設置位置` is an unreviewed candidate only.
2. **Second real release.** It is needed to validate any key and to lift the cross-release gate.
3. **Coordinate semantics.** The geodetic datum is not stated (assumed JGD2011 ≈ WGS84, unverified),
   and coordinates have 3–6 decimal places. Precision changes between releases would look like moves.
   Under decision 3 they are reviewed, not ignored, and that review load is unknown.
4. **Publisher relocation practice.** It is unknown whether a moved site keeps its row, is re-listed,
   or is announced only on the list page (as for #29, held as `locationSuperseded`).

Until 1 and 2 exist, Taito produces relocation candidates only through a reviewer's
`matchedToEntity`. That requires a second release, so the production relocation gate is closed.

## Implementation plan

Each step is its own issue and PR, and each builds on the previous one:

- **A. Relocation candidate detection + vocabulary** (migration 0013). In the resolver's effective
  plan, a reviewed `matchedToEntity` with a changed coordinate raises a `relocationCandidate` item
  (`needsReview`) instead of throwing. It writes no canonical row. The schema and
  `recordReviewDecision` accept the decision version that fits the kind (v2 for
  `relocationCandidate`, v1 otherwise). Test-only source only.
  **Implemented** (Issue #93, `migrations/0013_relocation_review_candidates.sql`,
  `src/pipeline/relocation.ts`): the item is raised only after its `ambiguousMatch` is decided,
  its insert trigger re-checks the identity item and its latest decision, the exact observation rows
  compared (observation ids under one mapping version, so another mapping's row never counts) and
  their coordinates, the active / unmerged / unheld spot still at the old coordinate, and the stale
  comparison. `identity.reviewDecisionId` is creation evidence; the item is actionable (v2 decisions
  accepted, rerun keeps the same item) only while the identity item's latest decision is a v1
  `matchedToEntity` choosing the same entity, so re-recording that choice keeps the item and any
  other latest decision makes it not actionable. No relocation decision is consumed yet: the
  release stays `needsReview` while the item exists.
- **B. Relocation hold step** (0014). `holdRelocationCandidate`: unpublish, then hold, with a hold
  row. Stale-evidence triggers.
- **C. Reviewed relocation application** (0015). `applyReviewedRelocation`, and the resolver
  consuming it when it applies the release. A coordinate change is possible only through an
  application row.
- **D. Tile / promotion E2E.** Cover two cases:
  - cross-tile relocation: the old tile loses the spot and the new tile gains it, and both tiles'
    revisions and ETags change;
  - same-tile relocation: only that one tile changes.

  In both cases the promotion bundle carries the new coordinate with old evidence retained; the
  golden stays stable for Taito.
- **E. Versioned natural-key foundation** (adapter-side derivation into `source_record_match_keys`,
  its concrete API, matcher version with key version, collision / missing handling). This is independent of A–D, but it is **useful only with a
  reviewed key**. It should wait until a source has one, or a test-only source proves the generic
  path. It does not enable Taito.
- Separate and later: resolving `relocationRejected` / hold release through removal, and a
  value-update policy.

## Consequences

- No coordinate moves without a reviewed decision and an application row, and the old location is
  always auditable.
- Without reviewed keys, relocation is review-heavy: every move of every source goes through a
  reviewer. This is intended until evidence justifies a key.
- Taito gains nothing operational from this ADR. Its gates stay closed.
