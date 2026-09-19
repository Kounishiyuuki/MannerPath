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

```text
Spot
- id: UUID
- name: String
- latitude: Double
- longitude: Double
- tileId: String
- spotType: SpotType
- hostType: HostType?
- accessType: AccessType
- environment: EnvironmentType?
- supportsPaper: Bool?
- supportsHeated: Bool?
- openingHours: structured/normalized value?
- feeType: FeeType?
- floor: String?
- entranceNote: String?
- status: active | unverified | temporarilyUnavailable | removed
- confidence: 0...1
- lastVerifiedAt: Date?
- createdAt: Date
- updatedAt: Date
```

Unknown must be represented separately from false.

### Source provenance

```text
SpotSource
- spotId
- sourceType
- externalId
- sourceURL
- license
- attribution
- observedAt
- importedAt
```

Do not collapse provenance into a single text field.

## 4. Region synchronization

1. Core Location obtains location on device.
2. Client derives current tile and neighboring tile IDs.
3. Client requests those tile resources without sending precise lat/lon.
4. Server returns snapshots with a revision/ETag.
5. Client upserts into GRDB.
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

The Watch can refresh its own location and rank the local snapshot independently.

## 7. Reports

Reports are immutable events, not direct client edits to canonical spot rows.

```text
Report
- id
- spotId?
- proposedLocation?
- type: exists | missing | moved | hoursChanged | tobaccoTypeChanged | other
- payload
- attestation metadata
- createdAt
- moderationStatus
```

## 8. Scaling boundaries

The first optimization axis is data partitioning + caching, not adding infrastructure.

Move to PostGIS only if the migration triggers in `TECH_STACK.md` occur.
