# Public API Contract — draft v1

Base path: `/v1`

## Private photo attachment foundation (#147)

`GET /v1/config` adds `reports.photoEvidenceEnabled: false`. Absence also means disabled.
The shipped Worker answers `503 photoEvidenceDisabled` to `POST /v1/reports/:reportId/photos`
before reading its body. No current terms version grants photo consent; #124 remains a publication gate.
Existing report creation and App Attest contracts are unchanged. No public photo read endpoint exists.

The constructor-injected technical test path requires App Attest even where local reports allow schema 1.
It reuses the schema-2 envelope and report-purpose challenge/signing domain described below. Its exact
signed JSON payload is `{schemaVersion:2,reportId,idempotencyKey,acceptedTermsVersion,mediaType,image}`:
report ID must match the path, idempotency key is a UUID, `image` is canonical base64 of JPEG/PNG,
and accepted terms must be both current and identical to the parent's explicitly accepted version.
Verified submitter-key hash must match the parent; no install ID supplied by the client grants ownership.
Unredacted/unexpired parent and explicitly injected photo consent are mandatory.

Limits: original 5 MiB, 4096 pixels per dimension, 2,000,000 pixels total; three distinct derivatives/report.
JPEG and noninterlaced 8-bit RGB/RGBA PNG only. Animated, interlaced, indexed/16-bit, tRNS- or eXIf-bearing PNG
fails closed. The JSON payload limit is `ceil(5MiB/3)*4+1024`; the outer envelope limit is
`ceil(payloadLimit/3)*4+4096`, enforced while streaming. Header signature, complete decode, PNG CRC,
bounded decompression and JPEG orientation are checked server-side. Fresh deterministic PNG contains
decoded pixels only: original metadata is not retained; no EXIF-derived location is used.

Success is `201 {schemaVersion:2,photoId,reportId,state:"pending"}` (retry may return its later moderation
state). Storage keys, original filenames, hashes and image metadata are not returned. Same sanitized
image/report returns the same photo ID. Same UUID with different sanitized content is `409
photoIdempotencyConflict`; retries use a fresh challenge/assertion, not replayed attestation. Counter
advancement and reservation/request identity commit atomically, including duplicate retries. A storage
failure returns a retryable `503 reportStoreUnavailable`; its durable reservation survives for cleanup.

Errors carry fixed codes and no submitted metadata: `400 invalidPhoto`, `413 photoTooLarge` or
`photo_too_large`, `415 unsupported_photo_type`, `422 invalid_photo` or `photo_dimensions_exceeded`,
`403 photoConsentRequired`/`photoUnauthorized`, `404 reportNotFound`, `410 reportExpired`/`photoExpired`,
`409 photoAttachmentLimit`/`photoIdempotencyConflict`, and existing App Attest rejections. Responses use
`Cache-Control: no-store`. A photo is private pending review, never permission-to-smoke proof or a public
spot mutation. It expires at the parent's original 90-day deadline, irrespective of photo moderation.
See ADR-0016 for storage deletion fencing and production prerequisites.

The API intentionally exposes spot data, not user location history.

## Request security bounds

The complete request URL (including query) and `If-None-Match` each have a 4096-byte UTF-8
limit. Larger input returns `413 requestTooLarge` before database access. Query parameters do
not alter public reads. Unsupported methods return `404 notFound`; HEAD uses GET semantics
without a response body. No CORS headers or shared client API credential are required.

Report/App Attest JSON bodies are read incrementally and cancelled above their documented byte
limit, independent of Content-Length. Non-identity Content-Encoding returns
`415 unsupportedContentEncoding`; the Worker never decompresses these bodies. Inactive writes
still return 503 before reading a body. Unexpected handler failures return a fixed JSON
`503 serviceUnavailable` with `Cache-Control: no-store`, without logging or echoing the exception.

## Schema version

Every response body carries an explicit `schemaVersion` (DTO schema version). `/v1` clients must check it; a change in meaning requires a new schema version or `/v2`.

## Forward compatibility

- Clients must tolerate **unsupported** enum values: a wire value that is not in the client's schema version, such as a `spotType`, `accessType` or report type added after the client shipped. An unsupported value must not crash decoding or fail the whole response. The client may treat it as unrecognised or skip that one spot. This is different from the literal value `"unknown"`, which is a defined, supported value (see `spotType` below).
- Clients must ignore unknown JSON fields.
- Tri-state attributes are strings `"yes" | "no" | "unknown"`, never booleans or null.

## GET `/readiness`

Read-only DATA_DB bootstrap gate; never reads REPORTS_DB. Responses carry `Cache-Control: no-store`.
A completed v2/v3 promotion answers `200` with
`{"schemaVersion":1,"completed":true,"state":"completed"}`. If a v4 manifest exists,
its matching manifest digest completion is also required; a legacy completion alone is insufficient.
An unfinished promotion answers `503` with
`{"schemaVersion":1,"completed":false,"state":"promotionIncomplete"}`.
A database with no bootstrap answers `503` with `state:"localPipeline"` and `completed:false`;
only loopback smoke accepts this development state. Remote smoke requires completed readiness
before any other probe. Database errors fail closed with `503 promotionIncomplete`.

## GET `/tiles/{z}/{x}/{y}`

Returns the complete canonical snapshot for one data tile (ADR-0005) as the schemaVersion 1 body below. `z` must equal the server's `DATA_TILE_ZOOM`; other values are rejected.

Since ADR-0015 a tile is stored as a manifest plus bounded parts (`GET /tiles/{z}/{x}/{y}/manifest` and
`…/parts/{index}`, below). This path still serves the whole schemaVersion 1 body, byte-identical to before, for every
tile of **at most one part** — almost every tile. A tile of several parts (a dense block) answers
`409 tileRequiresParts` instead: a client that predates parts replaces its cached tile with whatever it receives, so
it must never receive a partial snapshot. Such a client keeps its cached copy of that tile and stays correct
everywhere else.

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
- `spots` contains only published spots (publication gate, ADR-0006). A spot absent from the snapshot must be removed from the client's cache for that tile; the client replaces the tile atomically. A place a source lists is not necessarily published: since the ADR-0006 Issue #42 amendment a spot is also withheld when it is `temporarilyClosed` or under a server-side publication hold (for example, its published coordinate is known to be superseded). Withheld spots are absent from tiles and answer `404` from `GET /spots/{id}`; there is no client-visible marker for them, and none is needed — the client renders what it is given.
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
      "sourceIds": ["taito-public-smoking-areas"],
      "spotSubtype": null,
      "hostType": "unknown",
      "accessDetail": null,
      "verification": { "version": "spot-verification.v1", "existence": "official", "locationPrecision": "publisherPoint", "confirmations": null, "lastReviewedMonth": "2026-08" }
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

#### ADR-0012 additions (Issue #143) — additive, still schemaVersion 1

Every addition is an ignorable field for an older client (see "Forward compatibility"), so neither the tile nor the
spot-detail schema version changes. An older client keeps reading `spotType`, `accessType` and `evidenceQuality`
exactly as before; it shows a community spot through its existing "unrecognised evidence" fallback, never as official.

- `spotSubtype`: `smokingCorner | tobaccoShopSmokingSpace | null`. Refines `spotType`, never replaces it.
- `hostType`: `municipality | station | airport | commercialBuilding | convenienceStore | tobaccoShop | restaurantOrCafe | other | unknown`.
  Where the place is. **Never evidence** that smoking is permitted there.
- `accessDetail`: `ticketedUsersOnly | null`. Refines `accessType: "facilityOnly"`.
- `verification` (`spot-verification.v1`), the separate trust axes:
  - `existence`: `official | operator | communityVerified | communityReported` — who stands behind the place's
    existence. `communityReported` is one moderated, consented, explicitly classified report; `communityVerified` is
    two or more independent submitters, or a reported spot later confirmed by an independent submitter.
  - `locationPrecision`: `publisherPoint | reviewedDerived | communityPinned | areaApproximate | unknown` — how the pin
    was placed, independent of existence. (`reviewedDerived` is reserved for ADR-0011, which is not approved; nothing
    emits it.) `areaApproximate` (ADR-0017, migration 0030): accepted evidence places the smoking place inside a named
    area/host and the pin is a reviewed anchor of that area, **never the place's own point**. A client that does not
    recognise a value must not present the pin as exact.
  - `locationArea` (ADR-0017): `{ "name": string (1–80), "kind": "park" | "station" | "facility" | "airport" |
    "commercialBuilding" | "other", "scope"?: "namedZone" | "facility" }`, present **exactly when** `locationPrecision`
    is `areaApproximate` and absent otherwise, so every other spot's bytes are unchanged. The name is the anchor
    publisher's public name for the area. `scope` (ADR-0018, additive, optional) says what the pin represents: a named
    zone (「この付近へ案内」) or the whole host facility (「この施設内へ案内」, 施設内の詳しい位置は未確認). It is absent on
    ADR-0017 v1 anchors; a client that ignores it or sees an unknown value keeps the generic approximate wording.
  - `confirmations`: independent community submitters behind the evidence (≥ 1), or `null` for official/operator.
  - `lastReviewedMonth`: `YYYY-MM` — an official release's observation month, or the month a reviewer applied
    community evidence. Month precision on purpose (ADR-0007): a single report's review day is close to its
    submission day. Clients must tolerate a `verification.version` they do not know by ignoring the object.
- `evidenceQuality` v3 (`evidence-quality.v3`): `communityReported`, `communityVerified`, `operatorListing`. Existing
  values keep their versions: `officialListing` (v1), `communityReviewed` (v2, read as communityVerified).
- Freshness (`freshness.v1`, computed by the client and by the quality report from `lastVerifiedAt`, else the first day
  of `lastReviewedMonth`): `fresh` ≤ 365 days, `aging` ≤ 730, `stale` beyond, `unknown` without a date. A label and a
  ranking factor, never a reason to hide a spot (stale ≠ nonexistent).

Responses:

| Case | Status | Body / headers |
|---|---|---|
| Published tile | `200` | Snapshot body; `ETag: "1-<sha256 of body>"`; `Cache-Control: public, max-age=60, stale-while-revalidate=300` |
| `If-None-Match` matches (weak comparison; list or `*`) | `304` | No body; same `ETag` |
| Malformed ID (padding, sign, non-decimal, x/y out of range) | `400` | `{"error":"invalidTileId","detail":…}` |
| `z` ≠ `DATA_TILE_ZOOM` (14) | `400` | `{"error":"unsupportedZoom","detail":…}` |
| Valid z14 tile with no published snapshot | `404` | `{"error":"tileNotPublished","detail":…}`. The client caches the tile as empty |
| Tile of more than one part (ADR-0015) | `409` | `{"error":"tileRequiresParts","detail":…}`. Read the manifest and parts instead |

`200` bodies are assembled from the tile's single part; the `ETag` is `"1-<sha256 of the served body>"`, so it is
unchanged from the pre-ADR-0015 stored body. A database migrated to 0028 but not yet republished serves its stored
schemaVersion 1 body as before.

## GET `/tiles/{z}/{x}/{y}/manifest` and `/tiles/{z}/{x}/{y}/parts/{index}`

Tile schemaVersion 2 (ADR-0015, Issue #158). Implementation: `services/api/src/app.ts`, `services/api/src/tiles/parts.ts`;
Zod schemas: `TileManifestV2` and `TilePartBodyV2` in `services/api/src/tiles/dto.ts`.

The manifest is the tile's complete-snapshot index. Every part is listed in order with its spot count and the SHA-256
of its exact bytes:

```json
{
  "schemaVersion": 2,
  "tile": "14/14552/6451",
  "revision": 7,
  "generatedAt": "2026-10-01T03:00:00Z",
  "partPolicy": "tile-parts.v1",
  "spotCount": 600,
  "parts": [
    { "index": 0, "spotCount": 250, "sha256": "…" },
    { "index": 1, "spotCount": 250, "sha256": "…" },
    { "index": 2, "spotCount": 100, "sha256": "…" }
  ]
}
```

A part carries spots in the v1 spot shape and only the sources its spots cite. It has no revision or timestamp, so
its bytes and hash depend only on its content:

```json
{ "schemaVersion": 2, "tile": "14/14552/6451", "part": 0, "partCount": 3, "spots": [], "sources": [] }
```

- Parts hold spots in spot-ID order. A part closes at a `tile-parts.v1` bound: 250 spots, or 64 KiB counted as a SQL
  literal (so one part row fits one D1 statement). Real spots close parts by bytes at ~80 spots. Every part also stays
  within 16 KiB gzip; the publication quality gate enforces that bound, not the split. A tile has at most 128 parts.
- An empty tile has a manifest with `spotCount: 0` and no parts.
- A client applies a tile only after **every** part's bytes hash to its manifest entry. A mismatch, or a `404` for a
  listed part, means the tile was republished between requests: discard everything read and retry later. Never
  apply some of the parts.
- Revalidate a multi-part tile at its manifest with `If-None-Match`: the manifest `ETag` changes exactly when a part
  changes.

| Case | Status | Body / headers |
|---|---|---|
| Manifest of a published tile | `200` | Manifest; `ETag: "2-<sha256 of manifest>"`; `Cache-Control: public, max-age=60, stale-while-revalidate=300` |
| Part listed by the current manifest | `200` | Part; `ETag: "2-<sha256 of part>"` (the manifest's hash for it); `Cache-Control: public, max-age=60, stale-while-revalidate=300` |
| `If-None-Match` matches | `304` | No body; same `ETag` |
| Malformed tile ID / wrong zoom | `400` | `invalidTileId` / `unsupportedZoom`, as for the v1 path |
| Part index not canonical decimal in `0...127` | `400` | `{"error":"invalidTilePart","detail":…}` |
| No published snapshot | `404` | `tileNotPublished` |
| Part index not in the current snapshot | `404` | `{"error":"tilePartNotPublished","detail":…}` |
| Tile stored as schemaVersion 1 (migrated, not yet republished) | `503` | `{"error":"tileRepublishPending","detail":…}`. Use the v1 path |

Part indexes are canonical unsigned decimal integers in `0...127` (maximum 128 parts), matching the
Apple client's `maximumParts = 128`. `0`, `99`, `100` and `127` are valid indexes;
`128`, signs, padding (`01`), whitespace, decimals and exponents return `400 invalidTilePart`.
A valid index absent from the current snapshot returns `404 tilePartNotPublished`.

**Client reading order.** Read a tile at the v1 path. On `409 tileRequiresParts`, read the manifest and then its
parts, and keep the manifest `ETag`. Revalidate a tile cached with a `"2-…"` ETag at its manifest. This keeps
single-part tiles at one request, as before.

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
- `evidenceQuality` values: `officialListing` (`evidence-quality.v1`) and, from Issue #123, `communityReviewed` (`evidence-quality.v2`: backed by an applied community reconciliation application, `lastVerifiedAt` always `null`); from ADR-0012, `communityReported`, `communityVerified` and `operatorListing` (`evidence-quality.v3`). No community spot is published while its source is blocked (Issue #124). Clients treat any value they do not recognise as non-official, never as an error.
- The detail `spot` repeats the tile spot field for field, ADR-0012 additions included (`verification`, `spotSubtype`, `hostType`, `accessDetail`). Public provenance may now include `spotType`, `hostType`, `accessType`, `environment`, `supportsPaper` and `supportsHeated` for a community spot whose reports agreed on them (rule `community.agreedClaim.v1`).
- `sources` is the same compact attribution shape as the tile DTO's `sources`, holding the sources behind `spot.sourceIds`.
- `provenance` is the **public** field-level provenance: for each resolved field, which source it came from, the named derivation `rule` and the observation date of that evidence. A field whose canonical claim was **attenuated** — weakened on reviewed evidence outside the source, such as a later contradicting publication by the same publisher (ADR-0006, Issue #42 amendment) — is **omitted from this list entirely**. Its source provenance alone would say "this source, observed on this date, is the evidence for the value you see", which for an attenuated field is exactly what it is not, and schemaVersion 1 has no shape for "claim withdrawn on other evidence". A missing field therefore means either "no accepted evidence" or "the claim was withdrawn"; the value itself already says which — for example `openingHours.status: "unparsed"` means `openNow` is not computable, whatever the reason. Clients must not treat a present provenance entry as a completeness guarantee, and must never infer a value from provenance absence. It is limited to evidence from an applied release of an approved source **and to an explicit public field allowlist** (`PUBLIC_PROVENANCE_FIELDS` in `services/api/src/spots/dto.ts`, the field list above): a provenance field added to the database later is withheld until it is deliberately published here. The final body is validated against the schemaVersion 1 schema before it is sent. Raw source records, source column names, record/release/entity IDs, matcher and resolver internals are never exposed. A field absent from the list has no accepted evidence (it is unknown/default).
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

**A deployment accepts exactly one report schema version**, published by `/v1/config`:
schemaVersion 1 (unattested) where `reports.attestation` is `"none"`, schemaVersion 3 (App Attest,
idempotent) where it is `"appAttest"`. schemaVersion 2 (App Attest without an idempotency key) is no
longer accepted anywhere; production report intake has never been enabled, so no shipped client
depends on it. The other version is refused with `400 reportSchemaUnsupported` before
any other check, so a client can tell "wrong protocol" from "bad report" (ADR-0007 §6).

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
  IDFV, IDFA, a DeviceCheck value or any other system identifier. On an App Attest deployment
  (schemaVersion 3) the abuse key is derived from the verified App Attest key instead, so changing
  `installId` neither resets the rate limit nor makes a second "independent" submitter (Issue #150).
- `claim`: optional, **only for `missing`** (rejected for every other type), and only where `/v1/config`
  `reports.newSpotClaims` is `true` (ADR-0012). What the reporter states about the new place:
  `{ "spotType": required — designatedOutdoorArea | publicSmokingRoom | facilitySmokingRoom | ashtray | smokingPermittedVenue | unknown,
  "spotSubtype"?: smokingCorner | tobaccoShopSmokingSpace (needs a known spotType), "accessType"?: public | customerOnly | facilityOnly | unknown,
  "accessDetail"?: ticketedUsersOnly (needs facilityOnly), "hostType"?: (the tile vocabulary), "environment"?, "supportsPaper"?, "supportsHeated"?,
  "hostName"?: 1–80 characters, "hoursNote"?: 1–120 characters }`. There is no staff-only/private access value: such a
  place is not a public search result. Categorical claims are facts about a place and survive redaction; `hostName` and
  `hoursNote` are personal content like `note`: shown to reviewers, minimized after 90 days, never published. A single
  report becomes a `communityReported` listing only with consent and a known `spotType`; a host type alone (a
  convenience store, a café) never does.
- ADR-0013 existing-spot findings (only where `/v1/config` `reports.existingSpotFindings` is `true`): `type` may also be
  `notFound` ("I looked and could not find it"), `removed` ("it has been removed") or `typeChanged` ("it is a different
  kind of place"). Each needs `spotId` and rejects `proposedLocation`. They are stored as report type `other` plus a
  closed `finding` (migration 0024), are part of the immutable proposal and survive redaction. A wrong location stays
  `moved` with its pin.
- ADR-0013 correction `claim` on an existing-spot report (same config flag), validated per type and categorical only —
  no free text: `typeChanged` → `{ "spotType": required, "spotSubtype"? }`; `accessChanged` → `{ "accessType": required,
  "accessDetail"? (needs facilityOnly) }`; `tobaccoTypeChanged` → `{ "supportsPaper"?, "supportsHeated"? }`. Every other
  existing-spot type (`exists`, `notFound`, `removed`, `moved`, `hoursChanged`, `prohibited`, `other`) rejects `claim`.
  A correction is a proposal for a reviewer; no canonical field is ever written from it. A one-tap "still here" is
  `exists` with `spotId` only: no note, date or location is needed.
- `acceptedTermsVersion`: optional. The report terms version the user **explicitly agreed to** in the
  client before sending (Issue #124). When present it must equal `reports.termsVersion` from
  `/v1/config`; any other version is refused with `409 termsVersionOutdated` and nothing is stored. A
  report without it is stored without consent: it can be moderated and reconciled, but it is never a
  basis for publishing community data, and consent is never added to it later. In schemaVersion 3 it
  is part of the signed `payload`, so the App Attest assertion covers it; the envelope itself does not
  accept it.
- `attestation`: **not accepted in schemaVersion 1**, which is the unattested version: sending
  attestation material is a `400 invalidReport`. Attested reports use schemaVersion 3 below.
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
| `schemaVersion` is a number other than the one this deployment accepts | `400` | `{"error":"reportSchemaUnsupported","detail":…}` |
| `acceptedTermsVersion` is not the deployment's current terms version | `409` | `{"error":"termsVersionOutdated","detail":…}` — nothing stored; the client must show the current terms (update the app) |
| Attestation policy unrecognised or incomplete (see ADR-0007 §6) | `503` | `{"error":"attestationUnavailable","detail":…}` — checked before the body is read; fails closed, and a typo never silently disables attestation |
| Per-install rate limit exceeded (10/hour, 50/day) | `429` | `{"error":"reportRateLimited","detail":…}`; `Retry-After` seconds |
| The durable report store (`REPORTS_DB`, ADR-0014) is not bound or not reachable | `503` | `{"error":"reportStoreUnavailable","detail":…}`; `Retry-After: 60`. Also answered by both App Attest endpoints. The client keeps the report and retries; nothing is ever written to the canonical database instead. `/v1/config` reports `reports.available = false` when the store is not bound |

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

### schemaVersion 3 — attested and idempotent (implemented; v2 retired)

Accepted only where `/v1/config` says `reports.attestation: "appAttest"`. The report fields are
exactly schemaVersion 1's, with `"schemaVersion": 3` and one more required field, `idempotencyKey`;
they travel as **exact bytes** inside an envelope that also carries the App Attest assertion over
those bytes. Implementation: `services/api/src/attest/`, `services/api/src/reports/dto.ts`
(`ReportSubmissionV3`, `ReportPayloadV3`), `services/api/src/reports/idempotency.ts`, report-store
migration `0004_report_idempotency.sql`.

```json
{
  "schemaVersion": 3,
  "payload": "eyJzY2hlbWFWZXJzaW9uIjozLC…",
  "attestation": {
    "keyId": "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=",
    "challenge": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    "assertion": "omlzaWduYXR1cmVYRzBFAiEA…"
  }
}
```

- `payload`: standard padded base64 of the UTF-8 JSON bytes of the report (a schemaVersion 1 body
  with `"schemaVersion": 3` plus `idempotencyKey`, same strict rules). At most `reports.maxBodyBytes`
  (4096) bytes once decoded. The server verifies the assertion over **these bytes** and then parses
  them; it never re-serializes JSON, so the client may encode however it likes but must sign what it
  sends.
- `idempotencyKey` (inside `payload`, so the assertion signs it): 32 CSPRNG bytes as 64 lowercase hex
  characters (`^[0-9a-f]{64}$`). One key per report **draft**: generated when the draft is created,
  kept for every retry of that draft, discarded after the draft is accepted. Never reuse it for
  another draft, and never derive it from, or store it as, an install, device or user identifier.
- `attestation.keyId`: the registered App Attest key ID (base64, 32 bytes), as `DCAppAttestService`
  returns it.
- `attestation.challenge`: a `report` challenge issued to that key (see below). **Every attempt,
  retries included, uses a new challenge and a new assertion**; a used challenge is never accepted again.
- `attestation.assertion`: the `generateAssertion` output, base64, over the report `clientDataHash`
  defined in "App Attest client data".
- The whole envelope is at most `reports.maxSubmissionBytes` (8192) bytes. All base64 is standard,
  padded and canonical; anything else is `400 invalidReport`.

Responses:

| Case | Status | Body |
|---|---|---|
| New report | `201` | `{ "schemaVersion": 3, "reportId": "rp_…", "state": "pending", "receivedAt": "…" }` |
| Retry of a draft already stored: same key, same report | `200` | the same body as that report's `201` (same `reportId` and `receivedAt`; `state` describes the submission, never later moderation) |
| Same key, a different report | `409` | `{"error":"idempotencyConflict",…}` — nothing stored, no budget used |
| Same key after that report passed retention (90 days) | `410` | `{"error":"idempotencyRetired",…}` — its content can no longer be compared; nothing stored |

The report is stored with `attestation_status = 'verified'` and no reference to the key. The server
keeps a **receipt** per accepted draft: `SHA-256("mannerpath.report-idempotency.v2\n" ‖ keyId ‖ "\n" ‖
idempotencyKey)` (never the raw key, the submitter hash or the installId), the `reportId`, and
`requestSha256` (below). **A receipt belongs to the App Attest key that created it.** Only a verified
assertion from that key can reach it: the same `idempotencyKey` presented by any other App Attest key
(copied, guessed, chosen by an attacker, or the user's other device) finds no receipt and is that
key's own new draft — `201` and budgeted, never another key's `reportId`, `409` or `410`. Holding an
idempotency key is therefore not ownership. A retry is honoured only from the same App Attest key: a
draft whose key was replaced (re-registration, another device) is a new report, and the client must
not resubmit it automatically (no authenticated key migration exists). Retention clears
`requestSha256` together with the report's personal content and keeps the receipt, which is never
deleted. The receipt does not depend on the pepper, so a pepper rotation never turns a retry into a
second report.

**Request hash (canonicalization `report-request.v1`, fixed).** `requestSha256 =
SHA-256("mannerpath.report-request.v1\n" ‖ canonicalJSON(report))`, where `report` is the validated
payload with these rules, and any change to them requires a new domain string, never an edit:

- included: every stored field — `schemaVersion`, `type`, `spotId`, `proposedLocation`, `observedOn`,
  `note`, `acceptedTermsVersion` (the consent), `claim`; excluded: `idempotencyKey` (it names the
  draft) and `installId` (never stored for an attested report);
- `proposedLocation` quantized exactly as stored (5 decimal places), so pins the store cannot tell
  apart hash alike; numbers in JSON's shortest round-trip form, so `-0` is `0`;
- strings hashed code point for code point as stored, with **no Unicode normalization** (NFC and NFD
  are different reports);
- canonical JSON: object keys sorted by UTF-16 code unit at every level, no whitespace. Key order,
  whitespace and escapes in the sent bytes therefore never make a "different" report.

The hash is the comparison only; it never replaces the assertion, which covers the exact payload
bytes. Before hashing, a payload is refused `400 invalidReport` if its bytes are not valid UTF-8
(`payload: invalid_json`), an object repeats a member name, escapes included (`payload:
duplicate_key`), or a string holds a lone surrogate (`payload: ill_formed_unicode`), so one signed
payload has exactly one meaning.

Order of checks (each ends the request): envelope shape (`400`) → **challenge consumed** (`403
challengeInvalid`) → payload bytes and report schema (`400`/`413`) → key and assertion (`403`) →
**receipt**: a known key answers `200`/`409`/`410` after recording this assertion's counter → terms
version (`409 termsVersionOutdated`) → rate limit (`429`) → one transaction: counter advance, report,
moderation row, receipt and both budget debits (`201`, or `403 counterNotIncreasing` if a concurrent
request won). Nothing about an earlier submission is disclosed before the assertion verifies, and only to
the key that made it. Two
attempts of one draft that race each other store one report: the loser's transaction aborts on the
receipt, its counter is recorded on its own, and it answers from the winner's receipt. The budget
(10 per hour, 50 per day per App Attest key) is enforced inside that transaction by a trigger, so
concurrent reports cannot exceed it; a retry, a conflict and a retired key use no budget, and a
`429` writes nothing (the counter included). Every `403` carries
`{"error":"attestationRejected","reason":…,"detail":…}` and is **definite: no report was stored and
no counter moved.**

| `reason` | Meaning | Client action |
|---|---|---|
| `challengeInvalid` | unknown, expired, already consumed, wrong purpose or wrong key (`detail` says which) | fetch a new report challenge, sign again |
| `keyNotRegistered` | the server holds no such key | generate a new key and register it |
| `assertionInvalid` | signature, App ID, environment, launch category, bundle version or encoding failed (`detail`) | `detail: bundleVersion` — this build is not accepted by the deployment: the user must update the app. Otherwise treat the key as unusable: generate and register a new one |
| `counterNotIncreasing` | a newer assertion from this key was already accepted | fetch a new challenge, sign again (submit one report at a time per key) |

Any other failure — a timeout, a dropped connection, a `5xx` — is **transport-ambiguous**; see
"Ambiguous delivery".

State per (App Attest key, `idempotencyKey`), after the assertion verifies:

| Receipt before | Outcome | Writes | Status |
|---|---|---|---|
| none | stored | counter, report, moderation, receipt, hour + day debit (one transaction) | `201` |
| none | budget full (early check or trigger at commit) | nothing, counter included | `429` |
| none | lost a concurrent race on the counter | nothing | `403 counterNotIncreasing` |
| none | lost a concurrent race on the receipt | counter only, then answered from the winner's receipt | `200`/`409` |
| active, same hash | replay | counter only | `200` |
| active, other hash | conflict | counter only | `409` |
| retired | refused | counter only | `410` |

A `429` leaves the counter where it was (ADR-0007 §5 "writes nothing"); its challenge is consumed, so its
assertion can never be replayed. A store failure (`503`) rolls the whole transaction back. Revoking a
single App Attest key is not implemented yet; once it is, a revoked key fails assertion verification and
so never reaches a receipt.

### iPhone client changes required for schemaVersion 3 (not yet implemented)

The iPhone app still sends schemaVersion 2, so against a schemaVersion 3 deployment `/v1/config`
reports a version it does not speak and reporting stays off (`400 reportSchemaUnsupported` if sent).
Production intake is disabled, so nothing shipped is affected. The client change, in its own PR:

- `ReportDraft` gains `idempotencyKey`: 32 bytes from `SecRandomCopyBytes`, lowercase hex, generated
  when the draft is created and saved with it in the Application Support draft file (never
  `UserDefaults`, never the keychain item of the App Attest key, never derived from `installId`).
- `ReportRequest.encoded` writes `"schemaVersion": 3` and the draft's key into the signed payload.
- An ambiguous or recovered submission (`.ambiguous`, `recoveredSubmissionAttempt`) may be retried
  with the same draft, idempotency key **and App Attest key**, and a new challenge and assertion
  (after the App Attest key was replaced, a retry would be a new report: keep the draft for the user
  instead of resending it); `200` is success with the original
  `reportId`; `409` keeps the draft and says it no longer matches what was sent; `410` drops the
  draft as already handled.
- Accepted-draft cleanup deletes the key with the draft. Watch and widget targets send no report.
- Verify against `contracts/app-attest/client-data-vectors.v1.json` (the `report v3` cases).

## App Attest (implemented, Issue #37)

Reachable only where `reports.attestation` is `"appAttest"`; elsewhere every endpoint here answers
`503 attestationUnavailable`. Design and threat model: ADR-0007 §6. The client flow is:

1. Once per key: `generateKey` → `POST /app-attest/challenges {purpose:"registration"}` →
   `attestKey(keyId, registration clientDataHash)` → `POST /app-attest/keys`.
2. Per report: `POST /app-attest/challenges {purpose:"report", keyId}` → build the payload bytes →
   `generateAssertion(keyId, report clientDataHash)` → `POST /reports` (schemaVersion 3).

The App Attest key ID and the report `installId` are different identifiers and are never derived
from each other.

### Registration abuse controls

New registration is paused when `REPORT_REGISTRATION` is unset or exactly `paused`.
`enabled` requires explicit positive safe-integer `REPORT_REGISTRATION_MAX_PER_HOUR` and
`REPORT_REGISTRATION_MAX_PER_DAY` (day >= hour), plus `CHALLENGE_RATE_LIMITER` and its distinct
`RATE_LIMIT_KEY_PEPPER`. No production thresholds are supplied by the repository. Any other
policy or malformed limit fails closed. These are registration-only controls: they do not change
existing keys' report submission authorization, report counters, or report budgets.

`POST /app-attest/keys` checks pause/configuration and its Worker limiter before reading the body,
consuming a challenge, or doing certificate verification. A refused limiter attempt can retry a
still-live challenge; once protocol verification begins, existing one-time consumption applies.
Both endpoints require a working limiter for registration; report-purpose challenges preserve
the existing optional-limiter configuration and fail closed if a configured limiter fails.

Successful registration is limited per deployment over rolling `(now - 1 hour, now]` and
`(now - 24 hours, now]` windows. The check and key INSERT are one SQL statement, so concurrent
successes cannot overshoot. Only newly inserted, verified keys use slots; failed verification
and duplicate keys do not. All retained keys count, including keys any future revocation layer
marks unusable. No IP, IP HMAC, install identifier, or additional user identifier is stored.
Registration timestamps use existing whole-second server UTC timestamps.

| Registration control | Status | Body |
|---|---|---|
| Unset or paused policy | `503` | `registrationPaused` |
| Invalid policy/limits | `503` | `registrationMisconfigured` |
| Missing/invalid required limiter configuration | `503` | `challengeBudgetMisconfigured` |
| Worker bucket rejects | `429` | `challengeRateLimited`; `Retry-After: 60` |
| Limiter throws or returns malformed result | `503` | `serviceUnavailable` |
| Verified new key exceeds success budget | `429` | `registrationLimited`; `Retry-After: 3600` |

The success-budget retry hint is not a promise of capacity: a daily cap may remain exhausted.
Pausing also blocks requests with previously issued registration challenges; resuming permits
only still-live challenges. The challenge route checks its limiter before parsing the purpose,
so a configured limiter failure can precede a registration pause response there.

### POST `/app-attest/challenges`

```json
{ "schemaVersion": 1, "purpose": "registration" }
{ "schemaVersion": 1, "purpose": "report", "keyId": "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=" }
```

Response (`201`, `Cache-Control: no-store`):

```json
{ "schemaVersion": 1, "challenge": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", "purpose": "report", "expiresAt": "2026-09-21T09:35:00Z" }
```

- `challenge`: 32 random bytes, standard base64. Valid for 5 minutes, for its purpose only (and,
  for `report`, only for that key), and **exactly once** — the first request that names it consumes
  it, whether or not that request succeeds.

| Case | Status | Body |
|---|---|---|
| Issued | `201` | as above |
| Schema violation | `400` | `invalidChallengeRequest` |
| `report` for an unregistered key | `403` | `attestationRejected`, `reason: keyNotRegistered` |
| Too many outstanding challenges (1000 registration challenges per deployment, 3 report challenges per key) | `429` | `challengeLimited`; `Retry-After: 300` |
| Per-client bucket exhausted (only where `CHALLENGE_RATE_LIMITER` and `RATE_LIMIT_KEY_PEPPER` are configured) | `429` | `challengeRateLimited`; `Retry-After: 60` |
| Only one of those two configured, a pepper under 32 UTF-8 bytes after trimming, or the report pepper reused (compared trimmed) | `503` | `challengeBudgetMisconfigured` |
| Configured limiter failed (its `limit()` threw or is unavailable) | `503` | `serviceUnavailable`; issuance fails closed, reads unaffected |

### POST `/app-attest/keys`

```json
{ "schemaVersion": 1, "keyId": "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=", "challenge": "…registration challenge…", "attestationObject": "o2NmbXRvYXBwbGUtYXBwYXR0ZXN0…" }
```

Response (`201`): `{ "schemaVersion": 1, "keyId": "…", "registeredAt": "2026-09-21T09:30:00Z" }`.
The key is stored only after every check in ADR-0007 §6 passed; the attestation object is not
stored. When the device reports `apple_bundle_version_01` — in the attestation or in any later
assertion — it must be exactly one of the deployment's accepted `CFBundleVersion` values, or the
request is refused with `detail: bundleVersion`; a device that reports no such extension is not
refused for that. The accepted set is deployment configuration and is not published. Body limit 16 KiB (`413 requestTooLarge`).

| Case | Status | Body |
|---|---|---|
| Registered | `201` | as above |
| Schema violation, or a value that is not canonical base64 / 32 bytes | `400` | `invalidKeyRegistration` |
| Challenge unknown, expired, consumed or not a registration challenge | `403` | `attestationRejected`, `reason: challengeInvalid` |
| Attestation failed verification | `403` | `attestationRejected`, `reason: attestationInvalid`, `detail` one of `malformed`, `untrustedChain`, `nonceMismatch`, `keyIdMismatch`, `appIdMismatch`, `environmentMismatch`, `counterNotZero`, `validationCategory`, `bundleVersion` |
| Key already registered | `409` | `keyAlreadyRegistered` — use the existing key only if otherwise authorized |

### App Attest client data

The one byte-level binding between a signature and what it authorizes. With
`frame(x) = uint32 big-endian byte length of x ‖ x`:

```
registration clientData = frame("mannerpath.app-attest.registration.v1") ‖ frame(challenge) ‖ frame(keyId)
report       clientData = frame("mannerpath.app-attest.report.v1")       ‖ frame(challenge) ‖ frame(keyId) ‖ frame(payload)
clientDataHash          = SHA-256(clientData)      — passed to attestKey / generateAssertion
```

- The domain strings are ASCII; `challenge` and `keyId` are their **decoded 32 raw bytes**, not
  their base64 text; `payload` is exactly the bytes whose base64 is sent as `payload`.
- Every part is length-prefixed, so no two different inputs frame to the same bytes; the domain
  keeps a registration signature from ever authorizing a report.
- The server then checks Apple's `nonce = SHA-256(authenticatorData ‖ clientDataHash)` itself.
- **Test vectors** (independently generated, frozen):
  `contracts/app-attest/client-data-vectors.v1.json`. For example, challenge bytes `00 01 … 1f`,
  keyId `zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=` and payload
  `{"schemaVersion":2,"type":"exists","spotId":"sp_01V64NN31G72E5KJJ5W22W1A1J","installId":"8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f"}`
  give `clientDataHash` `7ac2808aefe7c61d09d8486d9ea0ec308aa1abe7cff7f86dd3c8cd88fbcb2805`; the same
  report with its first two keys swapped gives `67a40c23…a44235` — different bytes, different hash.
  These schemaVersion 2 cases remain valid **framing** vectors; the `report v3` cases add a payload
  with `idempotencyKey`, the current request shape.

### Ambiguous delivery

A verified assertion does not prove the client received the response. When the final `POST
/reports` times out or its response is lost, the server is still consistent: either nothing was
committed, or the report, its receipt and its budget debit are stored **and** its challenge consumed
**and** the key's counter advanced — all in one transaction. Resending the identical request is
refused (`challengeInvalid`): a challenge is never reused. With schemaVersion 3 the client resolves
the ambiguity by retrying the **same draft**: same `idempotencyKey` and report, a new challenge and
a new assertion. The answer is `201` (the first attempt stored nothing) or `200` with the first
attempt's `reportId`; neither stores a second report or uses budget twice. Retries stay explicit,
one at a time per key (#30, #46).

## GET `/config`

Returns non-secret server-controlled values a client cannot safely hard-code: the data schema
versions this deployment serves, the oldest ones it still supports, `DATA_TILE_ZOOM`, and whether
reports are being accepted.

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
  "dataTileZoom": 14,
  "schemaVersions": { "tile": 2, "spotDetail": 1, "report": 1 },
  "minimumSupportedSchemaVersions": { "tile": 1, "spotDetail": 1, "report": 1 },
  "reports": { "available": true, "attestation": "none", "maxBodyBytes": 4096, "maxSubmissionBytes": 4096, "noteMaxLength": 280, "termsVersion": "report-terms.2026-09-30.draft", "newSpotClaims": true, "existingSpotFindings": true }
}
```

On a deployment that requires App Attest, the report entries read
`"schemaVersions": {…, "report": 3}`, `"minimumSupportedSchemaVersions": {…, "report": 3}` and
`"reports": { "available": true, "attestation": "appAttest", "maxBodyBytes": 4096, "maxSubmissionBytes": 8192, "noteMaxLength": 280, "termsVersion": "report-terms.2026-09-30.draft", "newSpotClaims": true, "existingSpotFindings": true }`.

- `schemaVersion`: the schema version of *this* body.
- `apiVersion`: the base path this document describes (`v1`).
- `dataTileZoom`: the only zoom `GET /tiles/{z}/{x}/{y}` accepts. Clients request tiles at this
  zoom instead of hard-coding `14` (ADR-0015). The iPhone app reads it before every tile sync. It binds its cache to
  that zoom and evicts a cache built at another zoom in one transaction. If the zoom is outside the range the build
  supports (14–16), or the tile schema range shares no version with the build, the app fails closed: it syncs
  nothing and keeps showing cached tiles.
- `schemaVersions.tile` is `2` since ADR-0015: manifests and parts. `minimumSupportedSchemaVersions.tile` stays `1`,
  because the v1 path still serves every single-part tile.
- **Compatibility is per resource, never global.** `tile`, `spotDetail` and `report` version
  independently, so a single server-wide minimum could only be accurate about one of them. For each
  resource the deployment publishes the closed range it supports:
  - `schemaVersions.<resource>`: the version it serves now — the `schemaVersion` in a tile or spot
    detail body, and for `report` the request version `POST /reports` accepts.
  - `minimumSupportedSchemaVersions.<resource>`: the oldest version it still supports. A client
    whose decoder for *that* resource is older must ask the user to update; it says nothing about
    the other resources. Raising one is a breaking change for that resource.
  - `minimumSupportedSchemaVersions.<resource>` is never greater than `schemaVersions.<resource>`;
    a body that violates this is invalid, and the server's own schema rejects it.
  - A resource added to `/v1` later appears in both objects; clients ignore resources they do not
    know.
- `reports.available`: whether `POST /reports` accepts submissions on this deployment. It is
  `false` exactly when the attestation policy is unrecognised or incomplete (for `required`: App
  ID, App Attest environment and accepted bundle versions must all be valid), because the endpoint
  then fails closed with `503` (ADR-0007 §6). A client hides the report entry point instead of
  walking the user into a guaranteed failure. The configured values themselves (policy, App ID,
  environment, accepted bundle versions) are never exposed.
- `reports.attestation`: the report protocol — `"none"` (schemaVersion 1, no attestation) or
  `"appAttest"` (schemaVersion 3 with App Attest registration, challenge and assertion). For
  `report`, `schemaVersions` and `minimumSupportedSchemaVersions` are always equal: a deployment
  accepts one version. A client that cannot produce the advertised protocol (an old binary, or a
  device without App Attest) must present reporting as unavailable, never fall back to the other.
- `reports.maxBodyBytes` / `reports.noteMaxLength`: the report limits the endpoint enforces — the
  schemaVersion 1 body, or the decoded schemaVersion 3 `payload` — so a client can validate before
  submitting. `reports.maxSubmissionBytes`: the whole request body limit (equal to `maxBodyBytes`
  for schemaVersion 1, the envelope limit for 2). They are the same constants `POST /reports` uses.
- `reports.termsVersion`: the report terms version (`services/api/src/reports/terms.ts`, document
  `docs/legal/REPORT_TERMS_DRAFT.md`) that a client must show and a report's `acceptedTermsVersion`
  must name (Issue #124). A client whose bundled terms document has another version cannot collect
  informed consent and presents reporting as needing an update. The current version is a **draft**:
  consent to it is recorded, but it grants no publication rights until a legal/maintainer approval.
- `reports.newSpotClaims`: whether a `missing` report may carry `claim` (ADR-0012). A deployment before migration 0023
  omits it; read absence as `false` and never send `claim` there (the report schema is strict).
- `reports.existingSpotFindings`: whether `notFound` / `removed` / `typeChanged` and the existing-spot correction `claim`
  are accepted (ADR-0013). A deployment before migration 0024 omits it; read absence as `false`.
- Clients ignore unknown fields here as everywhere else; a value added later is additive.

Responses:

| Case | Status | Body / headers |
|---|---|---|
| Always | `200` | Config body; `Cache-Control: public, no-cache`; no `ETag` |

The handler reads no database, so `/config` stays available while data is being republished. It is
deliberately not cached for longer than a revalidation: a stale `reports.available` would advertise
an entry point the server refuses (`docs/OPERATIONS.md`).

## GET `/coverage/tasks`

### schemaVersion 1 (implemented, ADR-0013)

Public, read-only **coverage-gap** tasks: seed areas (`services/api/src/coverage/seed-areas.ts`, `seed-areas.v1`) with no
published spot within the radius. The request carries nothing — no location, no identifier, no query — and the body
is the same for every caller. It is derived from the published corpus and the seed-area list only, never from reports,
so it contains no user-derived data while Issue #124 is open.

The nationwide campaign (#149) extends this same seed universe to 249 approximate public geographic units
(140 stations, 46 airports, 56 downtown areas, 5 official-lead districts and 2 other gaps). No campaign unit is a
smoking spot. `npm run community:seed` produces an operator plan with counts, evidence requests and P0–P3 priorities;
its adapter maps P0→1, P1→2, P2/P3→3 for `coverage-tasks.v1`. The public endpoint retains its geographic 1/2/3 display
tiers and derives gaps directly from published spots using indexed spatial probes in one SQL statement. The response
is bounded by the 249 configured seed areas (no unbounded spot list); it does not serve operator research, counts or evidence text.

```json
{
  "schemaVersion": 1,
  "rules": "coverage-tasks.v1",
  "seedAreas": "seed-areas.v1",
  "meaning": "information around this area is thin; this is not a claim that a smoking place exists",
  "tasks": [
    { "kind": "coverageGap", "seedAreaId": "tokyo-shinjuku", "name": "新宿駅・歌舞伎町周辺", "prefecture": "13", "priority": 1,
      "area": { "latitude": 35.69, "longitude": 139.70, "radiusMeters": 1000 } }
  ]
}
```

- A gap is **an area whose information is thin**, never a place and never a claim that smoking is permitted there.
  Clients must not draw it as a spot.
- Centres are approximate (two decimals); `priority` is a campaign tier (1 national hubs, 2 prefectural main stations,
  airports and tourist hubs, 3 other districts), not a score.
- **Spot tasks are not served here.** `needsConfirmation`, `needsLocationCheck`, `needsTypeCheck` and `needsAccessCheck`
  follow from each published spot's own tile fields (`coverage-tasks.v1`, `contracts/coverage/coverage-tasks.v1.json`),
  so a client derives them from tiles it already holds and never tells the server where it is. `needsRecheck` follows
  from moderated reports and is produced only for operators, and for the public only once community rights are granted.
- `Cache-Control: public, no-cache`. Unknown fields are ignored by clients, as everywhere.

| Case | Status | Body / headers |
|---|---|---|
| Within spatial probe budget | `200` | Body above |
| Spatial candidate budget exceeded | `503` | Problem `coverageTemporarilyUnavailable`; no truncated coverage claim |

Coverage task spatial probes retain at most 4,096 candidate/sentinel rows. A pathological corpus concentrated only
in uncertain bounding-box corners can exceed this operational budget; the endpoint then returns HTTP 503
`coverageTemporarilyUnavailable`, never a truncated task list or a falsely uncovered seed. Operators should inspect
and refresh the corpus rather than raise the bound to conceal a pathological layout. Normal dense seed centres
short-circuit to one covered sentinel per seed. No caller location is used.

## Versioning

Breaking changes require `/v2` or a negotiated data schema version. Existing App Store binaries may remain in use for long periods, so `/v1` must not silently change semantic meaning.

Promotion v4 carries the ADR-0015 canonical representation unchanged: `tile_snapshots` manifest/head rows
and `tile_snapshot_parts` rows, each part as a separate budgeted INSERT after its head. Migration
`0029_segmented_promotion.sql` follows `0028_tile_parts.sql`. Completion validates head/part descriptors,
continuous indexes, hashes, counts, canonical references and complete logical membership; multipart tiles
are never reassembled into one promotion SQL statement.
