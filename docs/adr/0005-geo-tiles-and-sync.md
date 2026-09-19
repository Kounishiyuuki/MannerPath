# ADR-0005 — Geographic partitioning and tile sync

Status: Accepted (zoom value pending benchmark)

## Decision

### Partitioning

- Tiles are Web Mercator Slippy XYZ tiles.
- v1 uses one fixed `DATA_TILE_ZOOM` for all data tiles.
- The value of `DATA_TILE_ZOOM` is **not chosen yet**. It is chosen after a launch-region density/payload benchmark (spots per tile, response size, number of tiles fetched for a typical nearby search). The result and chosen value are recorded in this ADR.
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
