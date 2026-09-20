# Public API Contract — draft v1

Base path: `/v1`

The API intentionally exposes spot data, not user location history.

## Schema version

Every response body carries an explicit `schemaVersion` (DTO schema version). `/v1` clients must check it; a change in meaning requires a new schema version or `/v2`.

## Forward compatibility

- Clients must tolerate **unsupported** enum values: a wire value that is not in the client's schema version, such as a `spotType`, `accessType` or report type added after the client shipped. An unsupported value must not crash decoding or fail the whole response. The client may treat it as unrecognised or skip that one spot. This is different from the literal value `"unknown"`, which is a defined, supported value (see `spotType` below).
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
    { "id": "taito-public-smoking-areas", "displayName": "台東区 公衆喫煙所", "licenseName": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/legalcode.ja", "attributionText": "台東区 CC-BY表示4.0国際 本作品の内容について、台東区は一切保証しないものとする。 元データ https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv" }
  ]
}
```

(The Taito source is `approved` (`docs/SOURCES.md`), so this is the shape of a real published Taito tile. `attributionText` is the wording approved for that source; a client displays it verbatim for every source behind the spots it shows.)

- `id`: opaque (`sp_` + 26 Crockford base32 characters). Clients never parse it.
- `name`: string or `null`.
- `spotType`: one of `designatedOutdoorArea | publicSmokingRoom | facilitySmokingRoom | ashtray | smokingPermittedVenue | unknown`. `accessType`: `public | customerOnly | facilityOnly | unknown`. `environment`: `indoor | outdoor | covered | unknown`. Clients tolerate values they do not know.
- `spotType: "unknown"` is a **known, valid canonical value** in schemaVersion 1. It means the physical subtype is unresolved: the source does not say whether the spot is an outdoor area, a room or an ashtray. It says nothing about existence or verification. Every spot in a tile has passed the publication gate (ADR-0006), whatever its `spotType`. A published spot with `spotType: "unknown"` is eligible for Nearby and other results like any other spot. It is left out only when the user sets an explicit spot-type filter that does not include it. Clients must decode it as a real case, not as an unsupported value, and must not skip it or treat it as unverified.
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

### schemaVersion 1 (implemented, Issue #16)

Implementation: `services/api/src/app.ts`, `services/api/src/spots/`. Zod schema: `services/api/src/spots/dto.ts`. Decisions: ADR-0006 amendment (Issue #16).

**Publication membership is the read gate.** The endpoint serves a spot only while it is in a published tile snapshot (ADR-0006). A canonical spot that is blocked, never published, merged away or no longer active is not discoverable here: it answers exactly like an ID that does not exist.

```json
{
  "schemaVersion": 1,
  "requestedId": "sp_01V64NN31G72E5KJJ5W22W1A1J",
  "mergedInto": null,
  "spot": {
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
    "sourceIds": ["taito-public-smoking-areas"],
    "tile": "14/14553/6450"
  },
  "sources": [
    { "id": "taito-public-smoking-areas", "displayName": "台東区 公衆喫煙所", "licenseName": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/legalcode.ja", "attributionText": "台東区 CC-BY表示4.0国際 本作品の内容について、台東区は一切保証しないものとする。 元データ https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv" }
  ],
  "provenance": [
    { "field": "existence", "sourceId": "taito-public-smoking-areas", "rule": "taito.listed.v1", "observedOn": "2026-08-18" },
    { "field": "name", "sourceId": "taito-public-smoking-areas", "rule": "taito.name.v1", "observedOn": "2026-08-18" }
  ]
}
```

(`sources` is byte-identical to the entry the tile API sends for the same source: both endpoints build it from the same registry row through the same DTO.)

- `spot` repeats the tile DTO's spot object field-for-field, with identical values, plus `tile` (the data tile the spot is published in). A client decodes it with the same decoder it uses for tile spots. `spotType: "unknown"` is returned normally here too, with the same meaning as in the tile DTO.
- The **verification summary** is the same triple the tile carries: `evidenceQuality`, `evidenceQualityVersion` and `lastVerifiedAt` (the observation date of the accepted existence evidence). Freshness stays a client-side computation.
- `sources` is the same compact attribution shape as the tile DTO's `sources`, holding the sources behind `spot.sourceIds`.
- `provenance` is the **public** field-level provenance: for each resolved field, which source it came from, the named derivation `rule` and the observation date of that evidence. It is limited to evidence from an applied release of an approved source **and to an explicit public field allowlist** (`PUBLIC_PROVENANCE_FIELDS` in `services/api/src/spots/dto.ts`, the field list above): a provenance field added to the database later is withheld until it is deliberately published here. The final body is validated against the schemaVersion 1 schema before it is sent. Raw source records, source column names, record/release/entity IDs, matcher and resolver internals are never exposed. A field absent from the list has no accepted evidence (it is unknown/default).
- `requestedId` / `mergedInto`: merges resolve in exactly one hop (ADR-0006). When the requested ID was merged, the response is the live target's, `mergedInto` names it, and `requestedId` is what the client asked for, so a client can rewrite stored references. When the spot is live, `requestedId` equals `spot.id` and `mergedInto` is `null`. A merge whose target is not published answers `404` like any other unpublished spot.
- No `ETag` in schemaVersion 1: unlike a tile, no stored snapshot hash describes this body, and the slice does not add a per-request hash. Clients revalidate normally.

Responses:

| Case | Status | Body / headers |
|---|---|---|
| Published spot (or a merged ID whose target is published) | `200` | Detail body; `Cache-Control: public, no-cache`; no `ETag` |
| Unknown, malformed, unpublished, blocked, merged-away or inactive ID | `404` | `{"error":"spotNotFound","detail":…}` — deliberately indistinguishable |

## POST `/reports`

Creates a verification/correction report: a user's claim that a spot exists, is gone, moved, or
that its hours, access or tobacco-type support changed.

Report types: `exists | missing | moved | hoursChanged | tobaccoTypeChanged | accessChanged | prohibited | other`.

**A report is an immutable proposal, never a canonical mutation.** It is stored in its own table
space with moderation state `pending`, and it changes no spot and no published tile. Acceptance is
a later human decision, and even an accepted report becomes canonical evidence only through a
separate reconciliation step (ADR-0006, ADR-0007 §2). The response therefore never reports
anything but `pending`.

### schemaVersion 1 (implemented, Issue #29)

Privacy and retention: `docs/adr/0007-report-privacy-and-retention.md`. Implementation:
`services/api/src/app.ts`, `services/api/src/reports/`. Zod schema:
`services/api/src/reports/dto.ts`. Migration: `services/api/migrations/0003_reports.sql`.

```json
{
  "schemaVersion": 1,
  "type": "moved",
  "spotId": "sp_01V64NN31G72E5KJJ5W22W1A1J",
  "proposedLocation": { "latitude": 35.7112, "longitude": 139.77377 },
  "observedOn": "2026-09-19",
  "note": "10mほど北に移設されていました",
  "installId": "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f"
}
```

The request schema is **strict**: an unknown field is rejected with `400`, not ignored. (This is
the one place where the forward-compatibility rule above does not apply — it binds clients reading
server responses, while the report body is the server's minimization boundary.)

- `type`: required.
- `spotId`: required for every type **except** `missing`, and rejected for `missing` (a missing
  spot has no canonical ID yet).
- `proposedLocation`: required for `missing` and `moved`, and **rejected for every other type**.
  It is the **map pin being proposed, not the device's position**; clients must never send the
  user's own location. It is stored rounded to 5 decimal places (~1 m).
- `observedOn`: optional, `YYYY-MM-DD`. Day precision only, and a **real calendar date**: a value
  carrying a time, an unpadded component, or an impossible day (`2026-02-31`, `2026-19-39`,
  `2026-00-00`, `2026-02-29` in a non-leap year) is rejected with `400`. Leap days of actual leap
  years (`2024-02-29`) are accepted. There is no future-date restriction.
- `note`: optional, 1–280 characters.
- `installId`: required, a client-generated UUID that is stable per install and per app only. It
  is used solely to derive a hashed abuse key and is never stored, returned or logged. Do not send
  IDFV, IDFA, a DeviceCheck value or any other system identifier.
- `attestation`: **not accepted in schemaVersion 1.** App Attest is deferred until the server-issued
  one-time challenge, request binding and replay protection exist (ADR-0007 §6, Issue #37), so
  sending attestation material is a `400 invalidReport` rather than a claim the server cannot check.
- Nothing else is accepted: no account, no email, no device position, no position sequence, no
  client-supplied timestamp finer than a day.

Response (`201`):

```json
{ "schemaVersion": 1, "reportId": "rp_01V64NN31G72E5KJJ5W22W1A1J", "state": "pending", "receivedAt": "2026-09-20T09:30:00Z" }
```

- `reportId` is opaque (`rp_` + 26 Crockford base32 characters).
- `state` is always `pending` in schemaVersion 1.

Responses:

| Case | Status | Body / headers |
|---|---|---|
| Stored | `201` | Accepted body; `Cache-Control: no-store` |
| Body over 4 KiB | `413` | `{"error":"reportTooLarge","detail":…}` |
| Body is not JSON | `400` | `{"error":"invalidJson","detail":…}` |
| Schema violation (unknown field, wrong type for the report type, oversized note, …) | `400` | `{"error":"invalidReport","detail":…}` — JSON paths and issue codes only, never the submitted values |
| Server configured with `REPORT_ATTESTATION=required`, or with any unrecognised value | `503` | `{"error":"attestationUnavailable","detail":…}` — checked before the body is read; fails closed, and a typo never silently disables attestation |
| Per-install rate limit exceeded (10/hour, 50/day) | `429` | `{"error":"reportRateLimited","detail":…}`; `Retry-After` seconds |

**An unknown, unpublished or merged-away `spotId` is accepted exactly like a known one**, with an
identical response. The endpoint deliberately does not validate the ID against canonical data, so
it cannot be used to discover which spots exist. A claim about an ID that resolves to nothing is
handled during moderation.

Retention: personal content (`note`, `proposedLocation`, `observedOn`, the hashed submitter key) is
erased 90 days after the report arrives, whatever its moderation state; the non-personal skeleton
of the report remains. Moderation metadata holds no free text — only a decision time, a reviewer
handle and a reason code from a closed vocabulary — so nothing a reporter wrote can survive through
it. See ADR-0007 §4.

Moderation is not reconciliation: an accepted report may be `queued` or `discarded`, and the
`applied` state is unreachable until the reconciliation step exists (ADR-0007 §2).

## GET `/config`

Returns non-secret server-controlled values a client cannot safely hard-code: the data schema
versions this deployment serves, the minimum schema version it still supports, `DATA_TILE_ZOOM`, and
whether reports are being accepted.

It is a **compatibility contract, not a settings channel**. It carries no secret, nothing per-caller
and no feature flags: the body is identical for every client of a given deployment, and every value
is read from the same constant the serving code enforces, so it cannot drift from behaviour.

### schemaVersion 1 (implemented, Issue #31)

Implementation: `services/api/src/app.ts`. Zod schema and constants:
`services/api/src/config/dto.ts`. Operations: `docs/OPERATIONS.md`.

```json
{
  "schemaVersion": 1,
  "apiVersion": "v1",
  "minimumSupportedSchemaVersion": 1,
  "dataTileZoom": 14,
  "schemaVersions": { "tile": 1, "spotDetail": 1, "report": 1 },
  "reports": { "available": true, "maxBodyBytes": 4096, "noteMaxLength": 280 }
}
```

- `schemaVersion`: the schema version of *this* body.
- `apiVersion`: the base path this document describes (`v1`).
- `minimumSupportedSchemaVersion`: the oldest DTO schemaVersion the deployment still serves. A
  client whose highest supported schema version is below it must ask the user to update rather than
  decode responses it cannot interpret. Raising it is a breaking change.
- `dataTileZoom`: the only zoom `GET /tiles/{z}/{x}/{y}` accepts. Clients request tiles at this
  zoom instead of hard-coding `14`.
- `schemaVersions`: the schemaVersion each endpoint's body currently carries — `tile`, `spotDetail`
  and the `report` request/response pair.
- `reports.available`: whether `POST /reports` accepts submissions on this deployment. It is
  `false` whenever the attestation policy is enforcing or unrecognised, because the endpoint then
  fails closed with `503` (ADR-0007 §6, Issue #37). A client hides the report entry point instead of
  walking the user into a guaranteed failure. The configured policy value itself is never exposed.
- `reports.maxBodyBytes` / `reports.noteMaxLength`: the limits the endpoint enforces, so a client
  can validate before submitting. They are the same constants `POST /reports` uses.
- Clients ignore unknown fields here as everywhere else; a value added later is additive.

Responses:

| Case | Status | Body / headers |
|---|---|---|
| Always | `200` | Config body; `Cache-Control: public, no-cache`; no `ETag` |

The handler reads no database, so `/config` stays available while data is being republished. It is
deliberately not cached for longer than a revalidation: a stale `reports.available` would advertise
an entry point the server refuses (`docs/OPERATIONS.md`).

## Versioning

Breaking changes require `/v2` or a negotiated data schema version. Existing App Store binaries may remain in use for long periods, so `/v1` must not silently change semantic meaning.
