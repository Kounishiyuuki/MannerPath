# Official source intake — local preparation and human review

This workflow supports Issues #67, #113 and #137 without repeating bounded city searches.
A municipality/operator delivery is an **unreviewed internal candidate**, not an approved
source, evidence release or published spot. The existing source registry, adapters,
reconciliation, quality gates and promotion remain authoritative (ADR-0006/0008/0009/0017/0018).
No new approval path, contact service, database, HTTP endpoint or network fetch is introduced.
This is separate from outgoing inquiry wording and community report intake.

## Existing workflow and the missing step

Discovery records resource leads. `source:onboarding` prepares resource-bound review queues;
`source:scaffold` creates a blocked source skeleton. A reviewed adapter ingests an immutable
fixture, records observations, resolves identities and publishes only through registry gates.
Quality and promotion independently verify the resulting corpus.

Previously, a newly delivered file had no common offline entry point for a byte digest,
format diagnosis and comparison with an earlier delivery. `source:intake` supplies that step,
reusing the discovery inspector and onboarding evaluator. It does **not** replace an importer,
approve rights, verify first-party identity, create an anchor, deduplicate or update lifecycle.
Every output remains `publicationStatus: blocked`, `humanReviewRequired: true`.

## Delivery requirements

Preserve the original permitted file unchanged in a restricted local receipt folder. Check
permission to process/store it before opening it; receiving it does not grant publication rights.
Do not commit private correspondence, contact details or restricted attachments. Collect only
information needed to review the smoking places; request a redacted replacement if contact or
visitor information is embedded. The CLI does not anonymize arbitrary inputs or outputs.

| Information | Needed for receipt preparation | Needed before publication |
| --- | --- | --- |
| Publisher identity, official URL, proposed source ID, received date | Required metadata | Independently verify publisher authority and exact resource scope |
| Resource URL or internal delivery reference | URL optional; preserve receipt reference locally | Immutable provenance and an auditable first-party evidence reference |
| Smoking-place existence | Evidence reference may be missing and remains unknown | Explicit permitted smoking-place evidence; a host/store/station alone is insufficient |
| Rights and attribution | References/claims optional and unreviewed | Applicable original terms or permission reviewed; resource-specific dataset rights, or ADR-0018 factReference review |
| Current operation | Claim/reference optional and unreviewed | Dated observation or reviewed current page; check closure, relocation, suspension and ban contradictions |
| Stable publisher record ID | Source-specific, not a required global column | Review cross-release identity; row numbers need not be stable |
| Place name, municipality/prefecture, address | Source-specific; missing values are not filled | Sufficient distinguishable identity and scope for the reviewed mapping |
| Coordinates, CRS and point meaning | Optional; syntactic signals only | Reviewed location provenance, CRS, precision and reusable anchor where applicable |
| Hours, access restrictions, tobacco support, shelter, room type | Optional | Unknown remains unknown; facility hours are not smoking hours |
| Coverage completeness/update behavior | Not inferred from row count | Explicit review before disappearance can imply removal |

For an ashtray-only claim, independently establish permission to smoke. A permitted official
smoking room does not need an additional universal physical-ashtray gate. Never derive smoking
existence from convenience-store presence, a POI category or a map pin.

`receivedOn` is receipt time, not a site observation. Keep provider observation date, reviewer
`checkedAt`, fetch time and `lastVerifiedAt` separate. Under ADR-0018 D-C, a reviewed current
first-party page's check date can become observation evidence; an intake receipt cannot do so.

## Formats and unknowns

- **CSV:** UTF-8, unique nonempty headers, quoted values supported, consistent row widths.
  Keep original provider column names; there is no universal smoking-place column schema.
  Empty or whitespace-only cells are counted as missing without changing their values.
  Missing cells remain empty/unknown. Other encodings require a separately reviewed conversion
  whose source bytes, encoding and digest are retained.
- **JSON:** UTF-8, valid objects/arrays of objects (or the supported record container/GeoJSON).
  Duplicate object keys and nesting beyond 128 levels are rejected; incomplete fields are
  diagnosed, never completed.
  JSON shape checking cannot establish the semantic correctness of provider fields.
- **PDF / map materials:** digest and manual evidence review only. No OCR, screenshot-coordinate
  extraction, centroid, arbitrary pin or automatic geometry normalization. Review rights before
  extracting facts. Do not copy copyrighted floor maps, images, logos or expressive descriptions
  into factReference fixtures.
- **Location:** coordinate detection is advisory. Facility/station representative points never
  become exact smoking coordinates. ADR-0017/0018 requires a separately reviewed approximate
  anchor and honest scope (`facility` or legitimately anchored `namedZone`). A missing exact
  point is a location-review blocker, not proof that an evidenced smoking place does not exist.
  Do not manufacture anchors or use Google/MapKit/OSM values. Geocoding is not executed here.

## Offline preparation

Use Node 24. From `services/api`, after installing locked dependencies:

```sh
npm run --silent source:intake -- \
  --metadata ../data-pipeline/research/official-source-intake/synthetic/receipt.json \
  --file ../data-pipeline/research/official-source-intake/synthetic/complete.csv \
  --format csv --out /tmp/mannerpath-synthetic-intake.json
```

The example is entirely fictional and grants no approval. Choose a **fresh** output path;
existing files are never overwritten. Regular input files only: no symlinks, files over 10 MiB,
metadata over 64 KiB, URL credentials or network retrieval. Split a larger delivery only with a
reviewed manifest preserving completeness and original digest; do not silently truncate it.

The receipt schema is version 1. Required fields: `version`, `sourceId`, `publisher`,
`publisherUrl`, `receivedOn`. Optional nullable fields: `resourceUrl`, `evidenceReference`,
`rightsReference`, `attributionText`, `licenseName`, `licenseUrl`, `operationEvidenceReference`.
`coordinateMeaning` is `unknown` (default), `smokingPlace`, `facility` or `namedZone`;
`operationClaim` is `unknown` (default), `active`, `closed` or `relocated`.
Unknown fields, including approval flags, are rejected. References are claims, not dereferenced.

For a changed delivery, add `--previous <earlier-file>` of the same format. This compares
bytes/headers/counts, not canonical identity. An explicit `--adapter <reviewed-source-id>`
can reuse that source's existing mapping in a read-only preview; the receipt ID must match.
Never select a similar city's adapter to make a new file pass. Adapter preview can include
source observations/identifiers, so its output stays internal and must not contain personal data.

Duplicate row/reference/shared-coordinate hints require review. Distinct floors may share
coordinates; no automatic deduplication happens. A changed coordinate with the same upstream
reference requires ADR-0009 review, not a silent update. Missing rows mean **unknown**, not
closure: a delivery may be partial. Closure/relocation claims never directly remove a spot.

## Human review and handoff

1. Confirm processing permission and publisher identity; record receipt digest and reference.
2. Read exact rights terms: downloadable datasets need resource-level permission. For
   factReference, distinguish reproduction restrictions from explicit information/data/database
   use prohibitions; the latter fail closed. Document reviewer/date, attribution and prohibited
   uses. A license label alone is not approval or a legal conclusion.
3. Verify smoking-place facts/current operation and search contradictory first-party evidence.
   Missing existence, rights or current evidence remains blocked with the exact next question.
4. Review location meaning and anchor reuse/provenance independently. Facility-only anchors
   aggregate to one canonical facility spot; propose multiple zones only with legitimate zone anchors.
5. Review source completeness, stable IDs and proposed unknown handling. Compare previous
   deliveries and existing sources with existing cross-release/cross-source review functions.
   Resolve duplicates, moves, closures and conflicts through their existing review/hold rules.
6. Use `source:scaffold -- <source-id> --out <existing-local-parent>` if a new source is needed.
   Create a reviewed registry entry in `docs/SOURCES.md`, immutable permitted fixture and
   `PROVENANCE.md` (digest, dates, URLs, rights, mapping/selection decisions, anchor evidence).
   A factReference fixture contains normalized facts only, not raw HTML or image material.
7. Implement a source-specific adapter and regression tests; explicitly review every unknown,
   access qualifier, exclusions and identity. Update discovery implemented/reviewed metadata only
   once implementation exists. Intake reports never become registry entries automatically.
8. Run local migration/registry/pipeline for registered sources, quality, cross-source checks and
   deterministic promotion build/verify/apply/re-export. Report canonical/published/excluded/tile
   deltas, including unchanged existing data, then human PR review and CI. Remote production
   migration/publication remains a separate maintainer operation.

Existing commands and contracts remain in [pipeline README](../services/data-pipeline/README.md),
[source onboarding report](research/2026-10-07-nationwide-source-onboarding.md),
[DATA_POLICY](DATA_POLICY.md), [SOURCES](SOURCES.md) and [OPERATIONS](OPERATIONS.md).
Synthetic regression coverage is `services/api/test/source-intake.test.ts`: preparation success
still blocks publication; missing evidence/rights/coordinates, approximate locations, malformed
and partial inputs, duplicates, changed/closed places, comparison and safe file boundaries.
No external provider data is required to test the intake workflow.
