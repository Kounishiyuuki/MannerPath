# Data Source and Licensing Policy

## Source priority

1. Municipal / government open data and official public facility lists.
2. Other official facility/operator information with compatible usage terms.
3. OpenStreetMap data, preserving ODbL attribution/provenance requirements.
4. User verification and correction reports.

No single source is assumed complete.

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

The importer architecture may support OSM. **Production publication of OSM-derived canonical records is gated** until ODbL attribution and redistribution/share-alike obligations for MannerPath's combined dataset are reviewed and documented. This document makes no legal conclusion on that question.

## Source registry

Every source is registered in `docs/SOURCES.md` before its data is published. License fields that have not been reviewed are marked `unreviewed`; an unreviewed source is not published.

## Convenience-store ashtrays

A convenience store POI alone is never enough.

A store is surfaced as a smoking result only when there is evidence of an ashtray/permitted smoking location from an approved source or sufficiently trusted verification workflow. This is enforced by the publication gate in ADR-0006.

## Contradicting official publications

A publisher may publish the same facts twice — an open-data release and an ordinary web page, say —
and the two may disagree. When a second publication from the same authority contradicts or adds a
qualifier to data MannerPath publishes, the contradiction is resolved **conservatively and
subtractively**: MannerPath withdraws the affected claim (hours become unknown, or the spot is
withheld from publication) rather than adopting the other publication's values.

This holds regardless of the second publication's license, and it is the only use permitted for one
whose reuse terms have not been reviewed: withholding a claim requires no redistribution right,
while publishing that publication's content does. A second publication becomes a *source* of values
only by the ordinary route — a reviewed entry in `docs/SOURCES.md` with its license established.

Every such withdrawal is explicit and reviewable: a dated attestation naming what was observed, and
field-level provenance on the canonical record naming the rule that weakened it (ADR-0006).

## Confidence

Confidence is derived from evidence quality and recency, not popularity alone. Evidence quality is stable and computed server-side; recency (freshness) is computed client-side from `lastVerifiedAt`, which is evidence observation time, never import/fetch time (ADR-0006).

Suggested evidence order:

- current official data;
- operator-confirmed information;
- recent multiple user confirmations;
- recent OSM evidence;
- stale/uncorroborated evidence.

The UI must expose uncertainty when relevant.
