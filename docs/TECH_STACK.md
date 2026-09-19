# Technology Stack — MannerPath

Status: **Accepted baseline**

## Apple client

| Concern | Choice |
|---|---|
| Language | Swift 6 |
| UI | SwiftUI |
| Minimum OS | iOS 18+, watchOS 11+ |
| State | Observation (`@Observable`) + SwiftUI state |
| Concurrency | Swift Concurrency (`async/await`, actors) |
| Location | Core Location |
| Map | MapKit |
| Place/destination search | MapKit local search, ephemeral only |
| Online pedestrian routing | `MKDirections` / Apple Maps handoff |
| iPhone local database | SQLite through GRDB |
| Watch local cache | Codable snapshot files; keep watch persistence intentionally small |
| iPhone ↔ Watch | WatchConnectivity |
| Widget/Complication | WidgetKit + App Intents |
| HTTP | URLSession |
| Serialization | Codable |
| Logging | OSLog |
| Unit tests | Swift Testing where suitable |
| UI tests | XCTest UI testing |

## Backend

| Concern | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| HTTP framework | Hono |
| Validation | Zod |
| Database | Cloudflare D1 |
| Geo indexing | Web Mercator Slippy XYZ data tiles at one fixed `DATA_TILE_ZOOM` for v1 (`DATA_TILE_ZOOM = 14`, from the launch-region benchmark); tile ID `"{z}/{x}/{y}"`; indexed tile-ID column (ADR-0005) |
| Public API | versioned REST `/v1/...` |
| Cache | HTTP cache semantics (`ETag`, `If-None-Match`) + Cloudflare cache where appropriate |
| Scheduled import | data-pipeline CLI, later scheduled CI/Cron after each source is stable |

## Why MapKit

MannerPath is iOS/watchOS-first. MapKit gives native SwiftUI integration, Apple-platform POI/destination search, map rendering and walking directions without introducing a separate commercial map SDK into v1.

MapKit is **not** used as the canonical smoking-location data source. Apple map data remains Apple map data and is treated according to Apple licensing/caching restrictions.

### Rejected for v1

**Mapbox** — excellent SDK and navigation product, but introduces MAU/trip/request billing and another commercial dependency. Reconsider only if embedded navigation or map customization requirements exceed MapKit.

**MapLibre** — strong open-source renderer with offline regions, but still requires selecting/licensing/hosting map tiles and an independent routing solution. Reconsider if offline basemaps become a launch-critical feature.

**Google Maps/Places** — unnecessary commercial dependency for an Apple-only app; Places data also does not solve the core “confirmed ashtray” data problem.

## Why D1 rather than PostGIS initially

The canonical dataset is expected to be modest enough for deterministic region/tile lookup. Clients fetch a small number of nearby cells and perform final ranking locally. This keeps hosting close to free and aligns with offline sync.

D1 is not a GIS database. If server-side requirements grow to complex route-corridor queries, polygons, or very large nearest-neighbor searches, migrate the repository implementation to PostgreSQL/PostGIS without changing the domain or client API contracts.

### Migration trigger to PostGIS

Open an ADR before migration. Trigger candidates:

- server-side corridor/route geometry becomes a core feature;
- geo query latency/row-read cost cannot be controlled with indexed tiles;
- data volume or query shape makes client-side final ranking impractical;
- spatial joins/polygons are required for regulation zones.

## Why GRDB on iPhone but not Watch

The iPhone needs durable migrations, indexed queries and potentially thousands of spots. GRDB provides explicit SQLite control.

The Watch only needs a compact nearby snapshot. A Codable file cache minimizes dependency/linking complexity and makes sync behavior easy to reason about. If Watch-side data grows materially, revisit with an ADR.

## Project-file policy

Use a normal Xcode project created by Xcode. Prefer modern synchronized source folders so adding Swift files does not require frequent project-file edits. AI agents must not rewrite `project.pbxproj` casually.

Project generators are intentionally not required in v1 because watchOS/Xcode project compatibility is release-critical and the application graph is small.
