# Nationwide official-source onboarding tooling

Date: 2026-10-07. Base main: `c000119f3784c9e839a434143e3a85c269507525` (#210 merged).
Scope: offline advisory tools, no API/schema/runtime changes. Source count alone does not require
API changes. Account work remains after v1 and separate from onboarding.

## Current audit: common infrastructure and source-specific review

Registry and adapters are authoritative in `SOURCE_ADAPTERS`; publication approval remains a reviewed
repository change with `docs/SOURCES.md`. Discovery metadata cannot alter either authority.
The six approved sources already share ingest, observations, resolver, quality, tile and promotion
boundaries. Repeat work is locating the exact release/fixture/test, checking review evidence and assembling
a review packet. Fixture/release mappings currently exist in local-pipeline and test support; this tool
keeps an explicit tooling-only map of those same pins and does not refactor runtime code.

| Source | Fixture / reviewed scope | Human-specific gates |
| --- | --- | --- |
| 台東 | CSV, 34 raw / 34 observations | Dataset date; four-part attribution; same-release list-page attenuation and holds; fixed fingerprint |
| 大阪 | CSV, 524 raw / 344 observations | Dual category classification; CC BY **2.1 JP**; reviewed designated smoking rows |
| 江東 | CP932 station CSV, 3 / 3 | Exact station resource and delegated Tokyo/ward rights; park sibling remains excluded |
| 京都 | Mixed facility CSV, 1,777 raw / 17 observations | Publisher category 138, dated release and exclusion of contradictory relocation rows |
| 武蔵野 | ZIP → KMZ → KML, 25 raw / 3 observations | Licensed archive/member provenance, explicit smoking Points and publisher CRS |
| 港 | Mixed facility CSV, 169 raw / 114 observations | Classification/dedicated URL and operation review; publication exclusions are downstream |

Observation counts are not publication counts. The validator uses each adapter's parser, scope,
coordinate observation boundary and `assertResolvable` on the actual local fixture, including existing
fingerprint guards. It does not run ingest, resolution, quality or publication. Tests are checked for
presence, not counted as passing by file existence. PROVENANCE and discovery source links are checked.
All six report `LOCAL_PIPELINE_READY` with no blockers; quality/promotion are `notEvaluated`, and latest
live release/current operation are unknown. This preserves existing approval without claiming freshness.

## Responsibility split

Discovery discovers and inspects candidate resources. Its existing `manualReviewTriage` evaluator remains
the only discovery triage implementation. Onboarding consumes those signals and explicit human review
metadata, adds implementation evidence and emits a review queue. No network request or database connection
is made by onboarding; it does not trigger the existing refresh or local pipeline commands.

Human review still establishes official publisher, smoking-place existence (not host existence), exact
resource rights including commercial reuse/redistribution/derivation, attribution, license applicability,
coordinate authority/precision, and current operation. Keyword hits/columns/ordinary municipal pages
cannot satisfy these alone. A new resource in an already implemented municipality does not inherit approval.

## Commands

From `services/api`:

```sh
npm run source:onboarding
npm run source:onboarding -- koto-station-smoking-areas
npm run source:onboarding -- --out /tmp/sources-review.json
npm run source:onboarding -- --discovery-report /path/to/existing-discovery-report.json
npm run source:onboarding -- new-city --metadata /path/to/onboarding.json
npm run source:scaffold -- new-city --out /tmp
```

`--out` writes JSON and `<path>.md` to fresh paths only. Default stdout is JSON (npm prints its command
banner; invoke the script directly if consuming stdout as pure JSON). A selected source prints only that
source; unknown source IDs require metadata. Duplicate candidate IDs, collisions with existing reviewed
sources and malformed/unknown input fields are rejected. Input files and output parents are local and
operator-selected; no URLs are fetched. Blocked reports are successful advisory output; malformed input
or filesystem errors exit nonzero. A zero exit status is never approval.

`--discovery-report` consumes `buildReport` resource metadata and external-reference classifications.
It intentionally does not import discovery `approved` verdicts or prior rights review into implementation
approval. Resource-hash `discovery-*` IDs are queue references, not permanent source IDs. A human chooses
a source ID and a reviewed packet when moving to implementation. Scan truncation/blockers remain visible.

Scaffold creates a new exclusive `<parent>/<source-id>` directory containing:

- `onboarding.json`: version 1 candidate input, blocked publication, rights/coordinates unknown.
- `adapter.ts`: unregistered stub, null license/attribution, blocked status; parser always throws.
- `adapter.test.ts`: inert-boundary skeleton, not meaningful fixture/mapping coverage yet.
- `fixtures/`: empty; no source bytes downloaded or redistributed.
- `REVIEW.md`: human review checklist and next implementation evidence.

Scaffold does not produce a complete SourceAdapter, edit registry/import lists, register a source or run
its tests. Implement the real interface only after review, with source-specific meaningful tests in a PR.
No overwrite or traversal source IDs are allowed. Existing approved sources cannot be scaffolded.

## Human metadata format

Unknown fields may be omitted; absent booleans remain unknown, never true. The minimal packet is:

```json
{
  "version": 1,
  "sources": [{
    "sourceId": "new-city",
    "publicationStatus": "blocked",
    "resource": {"rawUrl": null, "publisher": null},
    "review": {"coordinateKind": "unknown", "approvalGate": {}}
  }]
}
```

Resource fields: `rawUrl`, `publisher`, `licenseMetadata`, `attributionMetadata`, `matchingRowCount`,
`coordinateAvailability` (`all/partial/none/unknown`), `coordinateColumns`, `externalReferenceOnly`,
`blockerCodes`, `truncated`. No license text is interpreted as permission.

Explicit human review fields: `reviewedBy`, ISO `reviewedOn`, `evidenceReference`, `officialPublisher`,
`smokingExistence`, `commercialReuse`, `coordinateAuthorityReviewed`, `coordinateKind`, `licenseName`,
`licenseUrl`, plus `approvalGate` with exactDataset URL and strict booleans `exactApplicableLicense`,
`redistributionAllowed`, `derivationAllowed`, `publisherCoordinates`, `currentOperationEvidence`.
The exactDataset must equal the resource URL. All required signals must be explicit; strings such as
`"true"` are rejected. Metadata is a reviewer assertion for ordering work, not proof verified by this tool.
Even a fully populated positive packet reports publication blocked, no adapter/fixture/registry and
`ADAPTER_REQUIRED`. No source approval or ready-for-production state exists here.

## States and review queues

These are report-only checkpoints, not new DB columns or publication state transitions:

| Checkpoint | Meaning |
| --- | --- |
| DISCOVERED | Candidate input from discovery; no permissions or implementation implied |
| RIGHTS_REVIEW_REQUIRED / RIGHTS_REVIEWED | Missing or explicit resource-bound human review signal; latter is not a legal determination by the tool |
| COORDINATE_AUTHORITY_REQUIRED / COORDINATE_AUTHORITY_REVIEWED | Missing or explicit reviewed publisher-point signal |
| ADAPTER_REQUIRED | Complete advisory metadata, but no implementation/registration; human implementation review next |
| FIXTURE_REQUIRED / IMPLEMENTATION_REVIEW_REQUIRED | Checklist vocabulary for missing fixtures/tests/registry; current aggregate state is BLOCKED with named missing checks |
| LOCAL_PIPELINE_READY | Existing reviewed adapter + actual pinned fixture validation + test/provenance/discovery presence; fresh local execution still required |
| BLOCKED | Unresolved human gate, external/unsupported coordinate path, missing/corrupt implementation evidence or observed drift |

`QUALITY_READY` / `PROMOTION_READY` are deliberately **not emitted**: this offline validator has no verified
fresh local quality/bundle completion evidence. Obtain that separately through existing commands.
`READY` never means production approval. Rights and coordinate checkpoint fields are independent.

Queues are deterministic by source ID, with needs-rights, needs-coordinate, adapter/fixture/test missing,
drift, blocked, ready-for-local-implementation-review, ready-for-local-validation and missing quality/promotion
evidence. 10/50/100-source queues use the same path; queue ordering prioritizes human review, not publication.
Generated packets include Publisher, Resource URL, Smoking evidence, Rights, Attribution, Coordinates,
Operation, Adapter/Fixture/Tests/Registry, pinned release, blockers and next action.

## Fail-closed coordinate and rights handling

- Unknown rights or coordinates block candidate implementation readiness.
- Ordinary municipal HTML is not open data by default; license name/URL remain null without review.
- Explicit external references (including JT referrals) are not publisher coordinates.
- An address is never converted into publisherPoint. No geocoder is imported or executed.
- `areaApproximate` requires a reviewed ADR-0017 same-publication anchor implementation; metadata alone
  cannot validate one. Candidate state remains blocked until the source-specific implementation is reviewed.
- `reviewedDerived` is blocked: ADR-0011 policy remains proposed, pins empty and publication unconnected.
- New packets accept only publicationStatus `blocked`. Existing approved registry values are displayed as
  historical repository authority and never changed. No approved state is generated for a new source.

Reuse rights remain independent of coordinate capability. Fuchu/Hiroshima/Bunkyo blockers are not bypassed.
Quality, current operation, rights changes and production promotion still require their own evidence.

## Drift detection and remaining gaps

Existing `src/refresh/check.ts` fetches/fingerprints/retains candidate artifacts and probes parser/mapping,
headers/counts/coordinate changes without ingest or publication. Only 台東 currently has `refreshTarget`.
Discovery revalidation/probe tools already record URL/resource failures. Onboarding does not duplicate fetches.
Neither existing infrastructure nor this offline tool establishes continuously current license permission.

For supplied observation metadata only:

```sh
npm run source:onboarding -- --observation /path/to/observations.json --out /tmp/drift-review.json
```

Observation JSON is an array, each with an existing reviewed `sourceId` and any explicitly observed fields:
`rawUrl`, `header`, `coordinateColumns`, `licenseName`, `licenseUrl`, `attributionMetadata`,
`resourceAvailable` (strict boolean). Changed supplied fields or explicit disappearance enter the drift
queue and block advisory readiness, without changing registry/publication. Unknown sources or duplicate
observations are rejected. Omitted fields are listed as unobserved; `suppliedFieldsUnchanged` is not
“no drift” or an approval. Observations must be manually reviewed or produced by an existing inspection tool;
this CLI performs no live URL check and does not claim that the resource remains available.

License text can change at the same URL/name; this comparator cannot detect that without new reviewed terms
evidence. Terms-page evidence/digest monitoring, scheduled refresh targets for the other five sources and
source-specific renewed operation review remain human/implementation work. Do not auto-approve a license
change or replace pinned releases. Removal, relocation and cross-source overlaps use existing reviewed
ADR-0008/0009 procedures; disappearance from a partial source is not proof of closure.

## Validation and unchanged boundaries

Focused tests cover unknown rights/coordinates, external referrals, no ordinary-webpage license inference,
strict scoped booleans, no automatic approval, scaffold inertness/overwrite safety, missing fixture,
all six reviewed sources, observed drift, 10/50/100 queues and discovery boundary.
Run `make api-validate`, `make contract`, `git diff --check`; run the validator on all six pinned sources.

No API endpoint, tile/ETag/manifest/parts/detail contract, schema/migration, Apple code, account identity,
auth, source approval or production data changed. Public browsing remains anonymous; future ACCOUNT_DB
and optional account implementation after v1 stay as described in
[NATIONWIDE_ACCOUNT_READINESS](../architecture/NATIONWIDE_ACCOUNT_READINESS.md).
