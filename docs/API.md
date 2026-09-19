# Public API Contract — draft v1

Base path: `/v1`

The API intentionally exposes spot data, not user location history.

## Schema version

Every response body carries an explicit `schemaVersion` (DTO schema version). `/v1` clients must check it; a change in meaning requires a new schema version or `/v2`.

## Forward compatibility

- Clients must tolerate unknown enum values (e.g. a new `spotType`, `accessType`, report type). An unknown value must not crash or fail decoding of the whole response; the client treats it as unknown and may skip the spot.
- Clients must ignore unknown JSON fields.
- Tri-state attributes are strings `"yes" | "no" | "unknown"`, never booleans or null.

## GET `/tiles/{z}/{x}/{y}`

Returns the complete canonical snapshot for one data tile (ADR-0005). `z` must equal the server's `DATA_TILE_ZOOM`; other values are rejected.

Headers:

- response `ETag` required; it covers schema version + canonical content hash;
- client may send `If-None-Match`;
- `304 Not Modified` should be preferred for unchanged tiles.

Response shape:

```json
{
  "schemaVersion": 1,
  "tile": "{z}/{x}/{y}",
  "revision": 42,
  "generatedAt": "2026-09-20T00:00:00Z",
  "spots": [],
  "sources": []
}
```

- `revision` is monotonic per tile.
- `spots` contains only published spots (publication gate, ADR-0006). A spot absent from the snapshot must be removed from the client's cache for that tile; the client replaces the tile atomically.
- `sources` is a compact attribution summary for the spots in the tile, so attribution can be shown offline.
- Freshness is not precomputed; each spot carries `lastVerifiedAt` (evidence observation time) and a stable evidence quality.

## GET `/spots/{id}`

Returns the full current spot record and public provenance/verification summary.

Spot IDs are opaque and stable. If a spot was merged, the response identifies the target (`mergedInto`) so clients can update local references (favorites, recents). Clients never derive canonical IDs from source IDs.

## POST `/reports`

Creates a verification/correction report.

Report types: `exists | missing | moved | hoursChanged | tobaccoTypeChanged | accessChanged | prohibited | other`.

The endpoint does not directly mutate canonical spot data.

Expected protections before public launch:

- per-install/device abuse controls;
- rate limiting;
- Apple App Attest / DeviceCheck strategy;
- payload validation;
- moderation status.

Privacy/retention of report data is unresolved and requires a dedicated ADR before this endpoint ships.

## GET `/config`

Returns non-secret server-controlled values such as supported data schema version, minimum compatible API version and `DATA_TILE_ZOOM`.

## Versioning

Breaking changes require `/v2` or a negotiated data schema version. Existing App Store binaries may remain in use for long periods, so `/v1` must not silently change semantic meaning.
