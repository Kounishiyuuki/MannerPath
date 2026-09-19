# ADR-0005 — Geographic partitioning and tile sync

Status: Accepted (`DATA_TILE_ZOOM = 14` set by the 2026-09 launch-region benchmark)

## Decision

### Partitioning

- Tiles are Web Mercator Slippy XYZ tiles.
- v1 uses one fixed `DATA_TILE_ZOOM` for all data tiles.
- `DATA_TILE_ZOOM = 14`. It was chosen from a launch-region density/payload benchmark (spots per tile, response size, number of tiles fetched for a nearby search). See `docs/research/2026-09-launch-dataset-and-tile-zoom.md` (Issue #4). Measured results:
  - Official data (台東区, 34 spots): at z14, the nearest 1–3 spots are found in 9 requests even at p90. At z15, k=3 needs 25 requests at p90.
  - OSM density proxy for the 23 wards (190 spots): at z14, the nearest 1–3 spots are found in 9 requests for the median origin. z15 needs 25 at the median and 121–289 at p90.
  - Hypothetical dense upper bound (5,823 spots; every OSM convenience store counted): the largest z14 tile is 4.3 KB gzip / 65 KB raw. A 3x3 fetch is 25.5 KB gzip at p90.
  - z13 was rejected: its largest raw tile was 178 KB, and one change invalidates a ~4 km tile.
- Re-evaluate the zoom before release if a source makes any z14 tile exceed about 250 spots or 16 KB gzip, or if the spot DTO grows substantially. The benchmark used an estimated DTO.
- Tile ID format: `"{z}/{x}/{y}"` (decimal integers, no padding).
- Tile assignment of a spot is computed server-side from its canonical WGS84 coordinates.
- Shared Swift/TypeScript test vectors (coordinate → tile ID, including tile-boundary and antimeridian/latitude-limit cases) are mandatory. Both implementations must pass the same vectors in CI.

### Sync

- A tile response is a **complete snapshot** of the published spots in that tile. There are no deltas and no tombstones in v1.
- Each tile has a **monotonic per-tile revision** that increases whenever its published content changes.
- `ETag` is derived from the response schema version + a canonical content hash of the tile. A schema version change therefore invalidates cached tiles even when data is unchanged.
- The client replaces a tile's cached spots **atomically**: spots absent from the new snapshot are removed locally, including spots that moved to another tile, were removed, or were merged.

## Rationale

- Complete snapshots make removal/move handling trivial and keep client logic simple.
- Content-hash ETags let unchanged tiles return `304` and stay cacheable at the edge.
- A fixed zoom keeps the client/server contract a single number; choosing it without measurement risks either oversized payloads or excessive request counts.

## Consequences

- Changing `DATA_TILE_ZOOM` after release invalidates every client cache and requires a schema/config migration plan; it must be treated as a contract change.
- A spot moved across a tile boundary changes two tiles' revisions.
- Spots near a boundary are covered because clients fetch neighboring tiles.

## Migration compatibility

Tile IDs are a sync partition, not a spatial index strategy. A future PostGIS backend (ADR-0003) keeps the same tile contract.
