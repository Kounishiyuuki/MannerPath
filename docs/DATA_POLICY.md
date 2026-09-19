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

## Convenience-store ashtrays

A convenience store POI alone is never enough.

A store is surfaced as a smoking result only when there is evidence of an ashtray/permitted smoking location from an approved source or sufficiently trusted verification workflow.

## Confidence

Confidence is derived from evidence quality and recency, not popularity alone.

Suggested evidence order:

- current official data;
- operator-confirmed information;
- recent multiple user confirmations;
- recent OSM evidence;
- stale/uncorroborated evidence.

The UI must expose uncertainty when relevant.
