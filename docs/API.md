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

### schemaVersion 1 (implemented, Issue #12)

Implementation: `services/api/src/app.ts`. Zod schema: `services/api/src/tiles/dto.ts`. Decisions: ADR-0006 amendment (Issue #12).

```json
{
  "schemaVersion": 1,
  "tile": "14/14553/6450",
  "revision": 1,
  "generatedAt": "2026-09-21T00:00:00Z",
  "spots": [
    {
      "id": "sp_01V64NN31G72E5KJJ5W22W1A1J",
      "name": "上野公園前交番裏",
      "latitude": 35.7112,
      "longitude": 139.77377,
      "spotType": "unknown",
      "accessType": "unknown",
      "environment": "unknown",
      "supportsPaper": "unknown",
      "supportsHeated": "unknown",
      "openingHours": { "status": "parsed", "raw": "終日利用可能", "parsed": { "v": 1, "kind": "allDay" }, "timeZone": "Asia/Tokyo" },
      "lifecycle": "active",
      "evidenceQuality": "officialListing",
      "evidenceQualityVersion": "evidence-quality.v1",
      "lastVerifiedAt": "2026-08-18",
      "sourceIds": ["taito-public-smoking-areas"]
    }
  ],
  "sources": [
    { "id": "taito-public-smoking-areas", "displayName": "台東区 公衆喫煙所", "licenseName": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/legalcode.ja", "attributionText": null }
  ]
}
```

(Illustrative only: the Taito source is `blocked`, so the server publishes no Taito tile today.)

- `id`: opaque (`sp_` + 26 Crockford base32 characters). Clients never parse it.
- `name`: string or `null`.
- `spotType`: one of `designatedOutdoorArea | publicSmokingRoom | facilitySmokingRoom | ashtray | smokingPermittedVenue | unknown`. `accessType`: `public | customerOnly | facilityOnly | unknown`. `environment`: `indoor | outdoor | covered | unknown`. Clients tolerate values they do not know.
- `openingHours.status`:
  - `none`: no hours.
  - `parsed`: `parsed` is `{"v":1,"kind":"allDay"}` or `{"v":1,"kind":"daily","opens":"HH:MM","closes":"HH:MM"}`, where `closes` may be `24:00`. The times are local to `timeZone`.
  - `unparsed`: `parsed` is `null`. Only `raw` text is known, so the client must treat `openNow` as unknown.
- `lastVerifiedAt`: the observation date of the evidence (`YYYY-MM-DD`, day precision), or `null`.
- `sourceIds`: IDs of the sources that provide the spot's existence evidence. Every one has an entry in `sources`.
- `sources`: `attributionText` is `null` until approved wording exists.
- `spots` are sorted by `id` and `sources` by `id`. The body is compact JSON, and the served bytes are exactly the stored snapshot.

Responses:

| Case | Status | Body / headers |
|---|---|---|
| Published tile | `200` | Snapshot body; `ETag: "1-<sha256 of body>"`; `Cache-Control: public, no-cache` |
| `If-None-Match` matches (weak comparison; list or `*`) | `304` | No body; same `ETag` |
| Malformed ID (padding, sign, non-decimal, x/y out of range) | `400` | `{"error":"invalidTileId","detail":…}` |
| `z` ≠ `DATA_TILE_ZOOM` (14) | `400` | `{"error":"unsupportedZoom","detail":…}` |
| Valid z14 tile with no published snapshot | `404` | `{"error":"tileNotPublished","detail":…}`. The client caches the tile as empty |

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
