# Derived-coordinate readiness / Issue #141 — 2026-10-07

## Decision summary

Base main: `f41f212038d4a8aa3f0107554937da2c56b96f83`.
[Issue #141](https://github.com/Kounishiyuuki/MannerPath/issues/141) asks for an inert foundation and candidate replay;
ADR-0011 decision 8 remains **Proposed / not approved**. This work hardens that foundation, not publication.
`DERIVED_COORDINATE_PUBLICATION_POLICY.status = proposed`, reviewed dataset pins `[]`, source approvals and
resolver/publication paths are unchanged. No geocoder execution, source fetch, remote D1, Cloudflare operation,
production data change or Apple UI change was performed.

**Readiness is not activation readiness.** Pure evaluation/review and inert evidence storage exist; durable
reconstruction, canonical location authority, promotion, relocation integration and derived-data attribution are
still activation prerequisites. Approving decision 8 alone would add zero spots from the committed replay.

## Current implementation / classification

| Classification | Item | Status / evidence |
| --- | --- | --- |
| COMPLETE | Inert foundation | `services/api/src/pipeline/derived-coordinate.ts`, migration 0022, tests and replay exist. The module writes only derived geocode/review tables, never spots/provenance/tiles. |
| COMPLETE | Default fail-closed | Default decision returns policyNotApproved for every evaluation/review. Registry has abr-geocoder 2.3.1 and no pinned dataset. `publishable` is always false at evaluation level. |
| COMPLETE | Separate axes | official smoking-place evidence, reusable publisher address and geocoder-derived position are separate. Host evidence cannot create a smoking place; coordinateOrigin is derivedGeocode, not publisher. |
| COMPLETE | Precision gate | residentialDetail is candidate (not approved); block/parcel need human review plus independent site evidence; insufficient is rejected and cannot receive an approving persisted review. |
| COMPLETE | Deterministic review binding after hardening | Gate v2 hashes source/record gate context, exact official/input address, complete main/second-opinion outputs, provider version/options/dataset digest, candidateCount and expected jurisdiction. Any changed bound input makes old review stale. |
| COMPLETE | Append-only safety after hardening | UPDATE/DELETE refused by 0022; new 0031 also blocks INSERT OR REPLACE collisions and rejects invalid approval checks/blank site evidence. Neither migration creates publication linkage. |
| TECHNICAL GAP | Full persisted replay envelope | 0022 does not store pref/city/ward, candidateCount, secondOpinions, expected jurisdiction or source gate snapshot. They are digest-bound in memory, but stored row alone cannot reconstruct the complete digest/evaluation. Need versioned immutable evidence envelope before activation. |
| TECHNICAL GAP | Repeat-run storage | Existing UNIQUE(record,address column,input,geocoder id/version,dataset) refuses changed output/options under the same tuple. A future rerun ledger must record conflicts without rewriting old evidence or silently keeping an old approval. Not widened here. |
| TECHNICAL GAP | Raw-address binding | record_id links to source_records, but storage does not DB-verify official_address/address_column against the publisher's raw cell. Future writer/DB authority must validate release digest and exact cell/mapping, as ADR-0017 does for anchors. Current pure input is a typed assertion, not that proof. |
| TECHNICAL GAP | Pinned execution harness | No committed dataset pin or controlled candidate production harness; exact downloaded inputs, dataset inventory/digest, options and deterministic rerun need reviewed setup. No new geocoder dependency/download added. |
| MAINTAINER DECISION | ADR-0011 decision 8 | Whether reviewed derived coordinates may ever be published. Approval is separate from source rights, dataset review and engineering integration. |
| RIGHTS BLOCKER | Original smoking-source reuse | Source listing and address reuse must both be reviewed. ABR software/data licenses do not grant rights over the original smoking-place listing. |
| FUTURE ACTIVATION | Resolver / location authority | No derived consumer exists in src outside this module. Must design explicit authority/provenance linkage and revalidation before any canonical write. |
| FUTURE ACTIVATION | Promotion / API / attribution | Derived audit chain is not in current promotion allowlists. reviewedDerived wire vocabulary/dormant DTO branch is not an approved lane or complete attribution implementation. |
| FUTURE ACTIVATION | Stable identity / relocation | Pure planPublisherCoordinateReplacement requires relocation review even for a tiny move (and an origin change at identical coordinates). No durable derived→publisher executor/identity integration exists. |

## Actual gaps hardened in this change

1. `inputRule=verbatim` did not require `geocode.input === officialAddress`. Gate v2 rejects mismatches rather than
   silently geocoding a different address in the same municipality (`verbatimInputMismatch`).
2. Digest omitted candidateCount and secondOpinions. It now binds complete run output and all supplied source/record
   gate inputs. Array order is preserved; JSON object property order cannot change the explicit tuple digest.
3. Pure review gate accepted any six true-valued keys. It now requires exactly the six named boolean checks.
   0031 enforces the same named JSON boolean check set in storage (including rejecting numeric 1/extra keys).
4. Whitespace-only siteEvidence passed block/parcel gates. Pure gate uses trim; 0031 rejects empty/ECMAScript
   whitespace-only evidence, including tabs/fullwidth spaces. Nonblank text is still a reviewer assertion, not an
   automatic proof of independent site evidence; future activation must validate its provenance/reuse basis.
5. 0022's UPDATE/DELETE triggers alone did not prevent SQLite INSERT OR REPLACE rewrites with recursive_triggers off.
   New 0031 adds BEFORE INSERT collision guards for both evidence/review tables, preserving old decisions/digests.

Gate version changed from v1 to v2; old evidence digests do not carry approvals into new evaluations.
No applied migration was edited. Existing historical rows are not rewritten or declared newly approved by 0031.
Migration 0022's same-tuple uniqueness is retained deliberately; it can refuse a rerun pending a future ledger design.
Replay placeholder officialAddress/input now agree for the simulated verbatim run; no real address is copied.

## Fail-closed trace through the current repository

- **Gate:** source approved + explicit official smoking-place existence + confirmed current operation + reusable
  publisher address + reviewed verbatim rule + reviewed geocoder/version/pinned dataset + unique exact result +
  sufficient coordinate-level precision + valid Japan coordinate + jurisdiction match + no disagreement.
  Gate candidate means review eligibility, never publication.
- **Review:** newest decision wins, exact evidenceSha256 required, all checks true, coarse precision requires nonblank
  site evidence. Default policy still adds policyNotApproved even with a perfect approving review.
- **Resolver:** `src/pipeline/resolve.ts` reads source observations/adapters and writes normal source-specific quality.
  It imports no derived helper and queries no derived tables. An approved derived review cannot feed it coordinates.
  Static consumer regression plus integration tests protect this isolation; address-only data still needs an adapter
  and accepted coordinate authority, neither supplied by a geocode row.
- **Provenance:** recordDerivedGeocode/Review never writes spot_field_provenance. Current location provenance remains
  observation/anchor authority. An approved inert review cannot become publisher evidence.
- **Tiles/detail:** `src/tiles/publish.ts` needs active/unmerged/unheld spot, applied approved existence source and valid
  location state; detail is tied to published tile membership. Neither reads derived tables. DTO can recognize
  officialListingDerivedLocation/reviewedDerived, but no resolver emits that quality via this foundation.
- **Promotion:** `src/pipeline/promotion.ts` explicit TABLES/MULTI_SOURCE_TABLES/ADDITIVE_TABLES omit derived tables.
  v4 exporter shares multi-source bundle validation/table list. No geocode/review row is transported as a canonical
  location. Empty-target guards include derived tables; an existing local review database is not an empty GREEN.

Tests record an approving inert review then compare canonical spots, location provenance, tile snapshots and promotion
output. No derived publication occurs. This proves authorized current workflows are inert; it is not a claim that an
arbitrary privileged SQL writer cannot forge unrelated canonical observations/spots. Activation requires stronger
DB authority/revalidation, not reliance on a DTO string or a manually supplied evaluation object.

## Provenance / determinism / precision details

Already retained by 0022: record FK, address column/verbatim value, geocoder input/rule, id/version/options,
dataset content digest, normalized address/remainder/score, match/coordinate levels, precision, lat/lon/CRS/lgCode,
geocoder license list, evidence digest/time; review id, geocode FK, matching digest, decision/reviewer/checks/site
text/note/gate version/review time. Original source license remains on sources. Generated time is not evidence age.

Missing durable inputs are listed above; do not call stored provenance fully replayable yet. Future envelope must also
link reviewed source release/observation and exact raw address, reviewed site evidence and geocoder dataset/license
inventory. Current datasetReleaseId is a string supplied to the gate; pinning and computing that digest correctly is
an execution-harness responsibility. No approval inferred from version 2.3.1 alone.

| Precision | Derivation | Gate / review |
| --- | --- | --- |
| residentialDetail | coordinate_level residential_detail | candidate, still human review + policy approval; representative address point, not building/entrance exactness |
| residentialBlock | residential_block | reviewRequired + independent nonblank site evidence |
| parcel | parcel | same, plus ABR and 法務省 license; park lot point may be far from booth |
| insufficient | coarser/unknown/error | rejected; persisted approval refused |

coordinate_level, never match_level, determines precision. Mismatched levels/remainder/score/fuzzy/ambiguity fail closed.
Changing geocoder version/dataset/input/output/options/jurisdiction/ambiguity/second opinion changes digest or rejects
the gate. source rights/operation changes also invalidate the bound review and are evaluated independently.
A new approved policy must never automatically reuse a v1 digest or change canonical coordinates after a rerun.

## Relocation and ADR-0017 boundary

ADR-0009 requires reviewed stable identity and every numeric coordinate change, with no tolerance.
Pure replacement planner preserves that intent but does not store a spot ID or execute relocation; tests of that
planner alone do not prove a complete derived→publisher migration path. Future implementation must retain spot ID,
record identity review, hold/apply/release premises and both coordinate-origin provenance chains. At identical numeric
coordinates, origin/authority upgrade still needs explicit review; do not fake a numeric relocation to skip the decision.

ADR-0017's accepted area anchors are separate. It does not approve geocoding, reviewedDerived upgrades or the derived
lane. Current exact upgrade authority accepts publisherPoint only. Do not route derived results through areaApproximate
or label an ABR point publisherPoint to bypass ADR-0011.

## Rights blockers (committed research, no new legal approval)

- 広島 / 文京: candidate replay records unknown original-source reuse terms. Both retain sourceNotApproved and
  addressReuseNotReviewed even in the coordinate best-case simulation.
- 府中: [2026-10-06 source review](2026-10-06-next-official-source.md) selects two public smoking places only for a
  permission follow-up. Catalog CC BY cannot be extended to that ordinary listing; rights and smoking-site position
  remain blocked. 府中 is **not in the 26-entry replay**; do not add its two spots to the simulated totals.
- Dataset geocoder rights and smoking-source rights are independent; independent site evidence also needs an acceptable
  reuse basis. No source registry entry or license status was approved/changed.

## Candidate replay result

Input is the unchanged committed `services/data-pipeline/derived-coordinates/address-only-candidates.json`.
`npm run --silent replay:derived-coordinates -- --json` mechanically reevaluates those dated research entries; it
fetches no publisher page, geocodes no address, writes no DB and is not a new nationwide discovery run.
Output remains byte-identical to committed `2026-10-01-derived-coordinate-replay.json` after hardening.

| Bucket | Candidates | Stated spots | Unstated count |
| --- | --- | --- | --- |
| Total | 26 / 8 prefectures | 90 | 12 |
| Street/parcel address | 11 | 45 | 4 |
| Best-case street geocodable | 10 | 44 | 4 |
| Address insufficient (name/none/station/image) | 8 | 14 | 4 |
| Address form unverified | 7 | 31 | 4 |
| Operation unknown/partial | 9 | 26 | 3 |
| License blocked | 10 | 42 | 6 |
| License unknown | 14 | 44 | 6 |
| Exact address + operation + hypothetical rights resolution | 5 | 27 | 1 |

Buckets overlap. **Current passing = 0; simulated best-case candidate = 0; reviewRequired = 0.**
Best case supplies a test-only dataset digest, assumes license-established sources approved and ideal street/parcel
precision. It evaluates eligibility, not an actual policy activation or reviewed publication.
Two established-license candidates still fail: 札幌大通公園 currentOperationNotConfirmed (parcel also needs site evidence
if operation is resolved); 静岡 station plazas noGeocodeResult (names only). Remaining 24 have rights failures,
sometimes operation/address failures too. Five-source / >=27 stated-place potential (広島, 川崎, 新宿, 文京, 板橋) also
assumes actual sufficient geocodes and reviews after rights resolution; it is neither forecast nor guaranteed coverage.

## Maintainer decision / what approval changes

Decision 8 is permission to design a reviewed publication lane, with explicit derived labeling, not source approval
or an operational toggle. Any later approval change must amend ADR-0011 / DATA_POLICY / API and wire semantics,
include a reviewed implementation and tests, and retain ADR-0006/0009/0017 gates.
ADR-0011's former “small switch” wording is corrected: this audit found remaining machinery, so a constant flip is insufficient.

Approval would allow a separately reviewed implementation to consume eligible derived evidence as location authority.
Approval would NOT grant original publisher rights, pin a dataset, approve every address/run/review, resolve operations,
turn host existence into smoking evidence, make representative points exact, authorize remote deploy, auto-move a spot,
or add any of today's replay candidates to production.

## Activation prerequisites / FUTURE ACTIVATION

1. Maintainer decision 8, canonical policy/ADR/API changes and precise derived evidence/precision version design.
2. Source-specific rights and current-operation/existence review; dataset/version/license pin and deterministic offline harness.
3. Immutable full evidence envelope + raw-address/release binding + reproducible digest + fresh reviewing of each eligible run.
4. Exact latest-review/gate revalidation at canonical write, DB-enforced derived location authority and separate existence provenance.
5. Stable identity/derived→publisher reviewed relocation integration, conflict/same-point and stale-rerun tests.
6. v2/v3/v4 export/import/verification authority closure, geocoder/source attribution and public DTO contracts; no raw personal evidence leak.
7. Fail-closed/rollback tests across resolver, promotion, tile/detail, cache freshness and consumers. Apple UI work is a separate task.
8. Maintainer-controlled operational activation only after those gates; no activation in this PR.

## Rollback / current fail-closed properties

This hardening adds rejection/immutability guards only. It has no enable flag, no approved dataset/source and no canonical
writer. Default policy and nonconnection remain regression-tested. Bad approval shape/site text or REPLACE is refused
without mutating old evidence; newest reject/stale digest cannot approve a new run. Historical evidence is retained.
For future published data, setting a constant back to proposed alone would not remove cached/public tiles. A separately
reviewed rollback must withdraw affected canonical publication, republish tiles and verify promotion/cache behavior,
while preserving evidence and stable IDs. That rollback is not currently implemented because activation is absent.

## Validation / changed scope

Commands and outcomes are recorded in the PR: focused derived tests, replay, `make api-validate` (Node 24),
`make contract`, `git diff --check`. Focused tests apply all real migrations to fresh in-memory SQLite; no remote DB.
Only inert helper, migration 0031, focused tests, replay placeholder and readiness/ADR documentation are changed.
No resolver, promotion, tile/API shape, sources, Apple code or production dataset changes.
