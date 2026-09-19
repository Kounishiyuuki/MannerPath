# Public API Contract — draft v1

Base path: `/v1`

The API intentionally exposes spot data, not user location history.

## GET `/tiles/{z}/{x}/{y}`

Returns the canonical spot snapshot for one data tile.

Headers:

- response `ETag` required;
- client may send `If-None-Match`;
- `304 Not Modified` should be preferred for unchanged tiles.

Response shape:

```json
{
  "tile": "14/14547/6451",
  "revision": 42,
  "generatedAt": "2026-09-20T00:00:00Z",
  "spots": []
}
```

## GET `/spots/{id}`

Returns the full current spot record and public provenance/verification summary.

## POST `/reports`

Creates a verification/correction report.

The endpoint does not directly mutate canonical spot data.

Expected protections before public launch:

- per-install/device abuse controls;
- rate limiting;
- Apple App Attest / DeviceCheck strategy;
- payload validation;
- moderation status.

## GET `/config`

Returns non-secret server-controlled values such as supported data schema version and minimum compatible API version.

## Versioning

Breaking changes require `/v2` or a negotiated data schema version. Existing App Store binaries may remain in use for long periods, so `/v1` must not silently change semantic meaning.
