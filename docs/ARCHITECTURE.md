# Architecture — MannerPath

## 1. System overview

```text
Municipal Open Data ─┐
OpenStreetMap ───────┼─> data-pipeline -> canonical D1 database
User verification ──┘                         |
                                              v
                                      Cloudflare Worker API
                                              |
                                  region/tile snapshots + ETag
                                              |
                         +--------------------+-------------------+
                         |                                        |
                         v                                        v
                    iPhone app                            Apple Watch app
                 GRDB local cache                    compact snapshot cache
                         |                                        |
                    on-device ranking <--- preferences/sync ---> |
                         |
                MapKit presentation/routing
```

## 2. Apple app layers

Feature-first layout:

```text
MannerPath/
  App/
  Core/
    Location/
    Networking/
    Persistence/
    Mapping/
    WatchSync/
  Domain/
    Spot/
    Search/
    Verification/
  Features/
    Nearby/
    Map/
    SpotDetail/
    Search/
    Navigation/
    Report/
    Settings/
```

### Dependency direction

```text
SwiftUI Feature
     ↓
Domain use case / protocol
     ↓
Repository implementation
     ↓
GRDB / URLSession / CoreLocation / MapKit
```

No SwiftUI import inside Domain.

## 3. Canonical spot model

This is the logical model. The physical D1 schema is `services/api/migrations/0001_initial_schema.sql`, recorded in the ADR-0006 amendment (2026-09).

```text
Spot (canonical, resolved)
- id: opaque stable ID (server-assigned; clients never derive it)
- mergedInto: Spot ID?            // set when this spot was merged; clients follow the redirect
- name: String?                   // many designated areas have no name
- latitude / longitude: Double    // WGS84
- tileId: String                  // "{z}/{x}/{y}" at DATA_TILE_ZOOM, see ADR-0005
- spotType: SpotType              // physical type only, never verification state
- hostType: HostType?             // context only; never evidence of smoking permission
- accessType: public | customerOnly | facilityOnly | unknown
- environment: indoor | outdoor | covered | unknown
- supportsPaper: TriState         // yes | no | unknown
- supportsHeated: TriState
- openingHours: { raw: String?, parsed: normalized value?, parseStatus, timeZone }?
- feeType: FeeType?
- floor: String?
- entranceNote: String?
- lifecycle: active | temporarilyClosed | removed
- verification: evidence quality/state (ADR-0006), separate from lifecycle
- lastVerifiedAt: Date?           // evidence observation time, never import/fetch time
- createdAt / updatedAt: Date
```

`SpotType`: `designatedOutdoorArea`, `publicSmokingRoom`, `facilitySmokingRoom`, `ashtray`, `smokingPermittedVenue` (post-v1).
`ashtray` describes the physical thing; whether it is confirmed is the verification axis.

Unknown must be represented separately from false. Tri-state attributes use `yes | no | unknown`, not optional booleans, in the domain and in the API.

### Publication gate

A spot is published (included in tile data) only when it is `active` and has accepted existence evidence from an approved source or verification process (ADR-0006). A host such as a convenience store never creates a published smoking spot by itself.

### Evidence and provenance

Field-level provenance is an architectural requirement (ADR-0006):

- raw source evidence is preserved (which source, which record, when observed, when fetched);
- each canonical resolved value retains which evidence it was resolved from;
- API hot paths read resolved canonical data, not raw evidence.

Source IDs (e.g. an OSM element ID, a municipal record ID) are mappings to a canonical spot, not canonical IDs.
License and attribution are held in the source registry (`docs/SOURCES.md`), not free text per spot.

Do not collapse provenance into a single text field. Physically, resolved values are typed `spots` columns, and provenance is a narrow `spot_field_provenance` table (one row per spot and field, pointing to a raw source record). No generic value claim table is used (ADR-0006 amendment).

## 4. Region synchronization

1. Core Location obtains location on device.
2. Client derives current tile and neighboring tile IDs at `DATA_TILE_ZOOM`.
3. Client requests those tile resources without sending precise lat/lon.
4. Server returns a complete snapshot per tile with a per-tile revision and ETag.
5. Client replaces that tile's cached spots atomically (spots absent from the snapshot are removed locally).
6. On-device search applies filters and exact distance calculations.

## 5. Routing

- **spot discovery/ranking** — MannerPath domain logic;
- **pedestrian route geometry/navigation** — MapKit/Apple Maps online service in v1.

Offline fallback shows straight-line distance/bearing and clearly marks route unavailability.

## 6. Watch architecture

Watch receives:

- user preference summary;
- a compact set of nearby/recent Spot DTOs;
- revision and generated timestamp.

Watch snapshot contract (Codable file):

- `schemaVersion` and `generatedAt`;
- per spot: id, coordinates, spotType, accessType, tri-state tobacco fields (`yes | no | unknown`), lifecycle, evidence quality, `lastVerifiedAt`;
- a compact attribution summary (source display names) sufficient to show provenance offline.

Freshness is computed on the Watch from `lastVerifiedAt`, never stored as a precomputed value. Unknown enum values are tolerated, not fatal.

The Watch can refresh its own location and rank the local snapshot independently.

## 7. Reports

Reports are immutable events, not direct client edits to canonical spot rows.

```text
Report
- id
- spotId?
- proposedLocation?
- type: exists | missing | moved | hoursChanged | tobaccoTypeChanged | accessChanged | prohibited | other
- payload
- attestation metadata
- createdAt
- moderationStatus
```

`prohibited` covers a location where smoking is signposted as not allowed or where the listed permission is misleading.

Accepted reports may become evidence (ADR-0006); they never edit canonical rows directly.

Privacy and retention of report data (proposed location, attestation identifiers) are **unresolved** and require a dedicated ADR before the report API ships.

## 8. Scaling boundaries

The first optimization axis is data partitioning + caching, not adding infrastructure.

Move to PostGIS only if the migration triggers in `TECH_STACK.md` occur.
