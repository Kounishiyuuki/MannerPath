# Data Source and Licensing Policy

## Source priority

1. Municipal / government open data and official public facility lists whose original reuse terms have been reviewed.
2. Other official facility/operator information with compatible, reviewed usage terms.
3. OpenStreetMap **only if a dedicated ODbL architecture/legal ADR explicitly approves production publication**.
4. Reviewed user-verification/community evidence under the publication workflow — visible at two labelled stages,
   `communityReported` and `communityVerified` (ADR-0012), once the community rights gate (Issue #124) is granted.

Priority orders evidence, it is not a publication filter: coverage comes first and every published spot states which
kind of evidence it rests on (ADR-0012). No single source is assumed complete. A catalog entry, search-result snippet or third-party description of a license is not sufficient to approve a source; the publisher's applicable original terms must be reviewed.

Nationwide coverage does not weaken the evidence gate. A host POI, business category, convenience-store presence or geographic guess never creates a smoking spot.

## Apple Maps data

MapKit/Apple Maps is used for presentation, destination search and routing. Apple Maps POI/search output is not bulk-harvested or used to construct the canonical MannerPath spot database.

## OpenStreetMap

Relevant tags can include:

- `amenity=smoking_area`
- `smoking=*`
- `ashtray=*`
- `waste=cigarettes`
- `opening_hours=*`
- `shelter=*`
- `bench=*`
- `ventilation=*`

Do not treat an `ashtray` tag attached to an arbitrary feature as automatic legal permission to smoke.

Public Overpass endpoints are ingestion sources, not production client APIs.

The importer architecture may support OSM. **Production publication of OSM-derived canonical records remains blocked** until a dedicated ADR reviews ODbL attribution, database-combination, redistribution/share-alike and API/tile-distribution obligations and explicitly chooses an architecture. Nationwide coverage pressure by itself is not permission to unblock OSM. This document makes no legal conclusion on that question.

ADR-0010 is that ADR. Its outcome: legal review is required before adoption; until then OSM is reference-only (no OSM value stored, published or used to attenuate an official claim); merging OSM into the canonical database is rejected; if adopted, only an isolated OSM-derived database is acceptable. Only `amenity=smoking_area` or a dedicated smoking place counts as existence evidence; `smoking=*` on a venue describes that venue's policy and is not a smoking spot.

## Source registry

Every source is registered in `docs/SOURCES.md` before its data is published. License fields that have not been reviewed are marked `unreviewed`; an unreviewed source is not published.

## Convenience-store ashtrays

A convenience store POI alone is never enough.

A store is surfaced as a smoking result only when there is evidence of an ashtray/permitted smoking location from an approved source or sufficiently trusted verification workflow. This is enforced by the publication gate in ADR-0006.

Under ADR-0012 that trusted workflow includes a single moderated community report that explicitly states the smoking
place (for example `spotType: ashtray`, `hostType: convenienceStore`): it can become a `communityReported` listing,
labelled 「利用者報告・未確認」, and `communityVerified` after an independent confirmation. The store remains the
**host**; it is never the evidence. The same holds for cafés and restaurants: a report that smoking is permitted
there can create a `smokingPermittedVenue` listing, a café's existence cannot.

## Contradicting official publications

A publisher may publish the same facts twice — an open-data release and an ordinary web page, say —
and the two may disagree. When a second publication from the same authority contradicts or adds a
qualifier to data MannerPath publishes, the contradiction is resolved **conservatively and
subtractively**: MannerPath withdraws the affected claim (hours become unknown, or the spot is
withheld from publication) rather than adopting the other publication's values.

This holds regardless of the second publication's license. Where no reviewed reuse permission has
been found for it, this is also the *only* use this project makes of it: MannerPath does not
redistribute its content, and treats it solely as a reviewed conflict reference under the
conservative default above. That is an engineering policy, not a legal conclusion about the
publication's terms. A second publication becomes a *source* of values only by the ordinary route —
a reviewed entry in `docs/SOURCES.md` with its license established.

Every such withdrawal is explicit and reviewable, and is recorded separately from the source's own
field provenance so that neither is misrepresented as the other: a dated attestation naming what was
observed and the exact source release it was reviewed against, and a field attenuation row on the
canonical record (ADR-0006). The source's provenance row keeps describing what the source stated.

## Confidence

Confidence is never one opaque score. ADR-0012 publishes separate axes, each a named fact:

| Axis | Values | Computed |
| --- | --- | --- |
| Existence evidence | `official`, `operator`, `communityVerified`, `communityReported` | server (`verification.existence`) |
| Location precision | `publisherPoint`, `reviewedDerived`, `communityPinned`, `unknown` | server (`verification.locationPrecision`) |
| Freshness | `fresh` ≤ 365 d, `aging` ≤ 730 d, `stale`, `unknown` (`freshness.v1`) | client, from `lastVerifiedAt` or `lastReviewedMonth` |
| Access | `accessType` + `accessDetail` | server |
| Spot type | `spotType` + `spotSubtype`, and `hostType` | server |

`lastVerifiedAt` stays the evidence observation time, never import/fetch time (ADR-0006). A community spot has no
observation date (a report's own date is personal, ADR-0007); its freshness uses the non-personal month in which a
reviewer applied its evidence.

Evidence order for ranking and for "confirmed only" filtering: official ≈ operator > community verified > community
reported. OSM is not in this order: it stays reference-only (ADR-0010).

Rules:

- A lower tier may be shown; it may never be labelled as a higher one.
- Stale is a label, not a removal. Only removal/negative evidence through the review and hold workflow withdraws a spot.
- One negative report never deletes a spot; `prohibited` needs two independent submitters for a reviewed hold.
- The UI exposes the tier on every list row, map pin and detail page in plain words, without alarming styling.

## Nationwide source onboarding

Nationwide expansion follows the same publication invariant as the first municipal source:

- discovery creates a candidate, not an approved source;
- review records the publisher, original terms, attribution, geographic scope, completeness and update behavior;
- every fetched release is fingerprinted and immutable;
- source-specific parsing maps into a normalized observation layer before canonical resolution;
- disappearance can imply removal only for a source explicitly reviewed as complete for that scope;
- ambiguous matches, large coordinate moves, schema changes and material record-count drops are review events rather than silent automatic publication;
- cross-source conflicts weaken or hold claims unless a reviewed evidence rule clearly resolves them;
- user reports do not publish directly.

The nationwide architecture and quantitative release gate are defined in `docs/NATIONWIDE_DATA_STRATEGY.md`.
