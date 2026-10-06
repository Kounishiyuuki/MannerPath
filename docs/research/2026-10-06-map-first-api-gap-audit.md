# Map-first Phase 1 API / cache / sync gap audit

Date: 2026-10-06. Base main: `3bd6d56858ae07496cdbd4e9e5330ad0689a8544`
(#201 merged). Read-only repository audit; no live production request or mutation.
Production status/corpus is inherited release evidence, not newly measured here.

## Conclusion

**No immediate API or schema change is necessary for Phase 1.** Existing published
tile DTOs provide the nearby list and selected-spot summary. Map-first shell,
selection, viewport scheduling and cache-status presentation are client work.
This does not assert that the current UI already implements the design.

Basis: [DESIGN.md](../DESIGN.md) §§4–5, [API.md](../API.md),
[ADR-0004](../adr/0004-offline.md), [ADR-0005](../adr/0005-geo-tiles-and-sync.md),
[ADR-0015](../adr/0015-bounded-tile-parts.md), and the implementation references below.
Design samples are not product requirements; unknown is not false, and evidence
and position precision remain independent.

## Classification

| Requirement | Classification | Evidence / remaining client work |
| --- | --- | --- |
| Full-screen map / persistent native bottom sheet / list | CLIENT-ONLY CHANGE | Replace view composition, not transport. Keep MapKit clustering and source gates. |
| Nearby identity, name, coordinate | SUFFICIENT | Tile spot `id`, nullable `name`, latitude/longitude; client fallback title and on-device distance/bearing. |
| Tobacco, physical type, access, environment | SUFFICIENT | `supportsPaper`, `supportsHeated`, `spotType`, `spotSubtype`, `hostType`, `accessType`, `accessDetail`, `environment`; unknown and unsupported fallbacks must remain distinct. Host type is not evidence. |
| Evidence / precision / source / freshness | SUFFICIENT | `verification`, versioned `evidenceQuality`, observation date/review month, source IDs and license/attribution entries survive DTO mapping and cache. |
| Hours / openNow | SUFFICIENT | Parsed schedule with time zone permits client tri-state evaluation; absent, unparsed or unsupported hours remain unknown, never inferred open. |
| Selected marker and summary | CLIENT-ONLY CHANGE | Add selected ID/state and styling. Tile contains title, evidence, precision, freshness and attributes; distance on-device. Walking time comes from existing online MapKit routing, not the spot API. No guaranteed time offline. |
| Exact / approximate / unknown distinction | SUFFICIENT | Recognized `publisherPoint` is exact; `areaApproximate` includes area name/kind, not a smoking-place point. Unknown/missing/new precision must never be labelled exact. |
| Approximate area overlay with a factual radius | FUTURE / NOT NEEDED FOR PHASE 1 | Current DTO has no radius or boundary. Do not draw a supposedly accurate 30m circle from design sample text. Use honest anchor/name/approximate copy; see conditional gap below. |
| Pan/zoom viewport loading | CLIENT-ONLY CHANGE | Existing tile endpoints work for computed z14 tile IDs. Current model loads 3×3 around device/destination, not arbitrary viewport; camera callback and bounded scheduler are missing client behavior. |
| Empty / location denied / location acquisition failure | CLIENT-ONLY CHANGE | Combine permission/location state, active area and load outcome; denied does not prevent destination browsing. No API permission field needed. |
| Offline cache / clean no-cache / update failed | CLIENT-ONLY CHANGE | Cache metadata and local load outcomes exist, but current model does not fully expose per-tile cache presence/coverage. Do not label failed fetch as confirmed empty. |
| Stale evidence | SUFFICIENT | Client computes freshness from observation date or review month; snapshot generation time is not spot verification time. Old evidence stays visible. |
| Planned filters | CLIENT-ONLY CHANGE | Existing nearby domain filters handle tobacco, type, access, environment, openNow, evidence, distance and observation age on loaded data. UI grouping/reset is client work; no new dimensions automatically approved. |
| Destination search/privacy | SUFFICIENT | MapKit search supplies local destination coordinate; backend networking requests tile IDs, not query/raw destination coordinate. Keep device and destination corpora separate. |
| Reports, photos, community; Share/Bookmark; crowding | FUTURE / NOT NEEDED FOR PHASE 1 | No activation or invented counters. Existing availability gate must hide reporting-only actions/copy. Share/Bookmark are explicitly outside v1 design decision. |

## Selected summary vs detail

`Core/Networking/TileDTO.swift` → `Core/Mapping/TileSpotMapper.swift` →
`Domain/Spot/Spot.swift` already retains summary fields and attributed sources.
`SpotDetailView` accepts a `NearbyResult`; its current display is not dependent on a
new `/spots/{id}` request on every marker tap. A summary can use that same cached spot.

The detail endpoint additionally provides merge resolution and public field-level
provenance. Fetch it only when that richer/current information is required, not to
manufacture a summary dependency. It has no ETag in schemaVersion 1: per-tap fetching
adds one network round trip, repeat bytes and an offline failure path. Keep cached
summary visible with honest freshness; do not promise live detail freshness from a tile.
Tile mapping leaves fee/floor/entrance notes nil, but those are not Phase 1 summary
requirements and the current detail contract is not an alternative provider for them.

## Viewport / sync boundary

`Features/Nearby/NearbyModel.swift` currently chooses `neighborhood3x3()` around an
active device/destination coordinate. `ClusteredSpotMap.swift` selects spots and expands
clusters but does not deliver camera-region changes to the loader. Enlarging the map
alone therefore does not expand its smoking-spot corpus.

A future client scheduler should enumerate visible **data** tiles at config
`dataTileZoom` (currently 14), independent of camera zoom, and apply debounce,
deduplication, bounded tile count/concurrency and an explicit broad-viewport policy.
At world/country zoom, do not eagerly fetch thousands of z14 tiles or claim exhaustive
coverage. Preserve antimeridian/latitude rules in the shared Slippy XYZ vectors.
Current 3×3 calls start up to nine refresh tasks; per-tile part fetches are also
concurrent. Full-viewport fetching needs its own total request budget, not unbounded
reuse of that neighborhood loop. No multi-tile endpoint is mandatory at Phase 1 scale;
batching/aggregate endpoints require a separate measured proposal if later needed.

Preserve the actual reading protocol in `TileAPIClient.swift`: v1 whole tile first,
409 → manifest/parts, cached `2-` ETag → manifest revalidation; validate every part
hash before assembly. `TileSyncService.swift` and `GRDBTileStore.swift` enforce
complete per-tile atomic replacement, sync sequence/namespace checks and removal of
absent spots. Do not confuse tile revision with response generation order, schema
version or evidence freshness. Config/zoom failure keeps the existing cache; zoom
namespace changes do not mix old/new tiles. No schemaVersion, ETag, zoom or D1 migration
change is proposed by this audit.

Selection/viewport must use a generation token and cancellation like destination
loading; late response must not replace a newer area's displayed corpus. Persisting
a response in its own tile cache is different from accepting it as current UI state.
Do not feed viewport/destination results into device-centered Watch/Widget snapshots.

## Offline and coverage state

`CachedTile` carries revision, generation date, ETag, sources and spots; absent cache
is nil. A cleared/unpublished tile has a stored empty entry with nullable revision,
generation date and ETag. A published empty snapshot can have revision/date/ETag.
`NearbyDataState` distinguishes reading/refreshing/refreshed/refreshFailed/cacheOnly/
cacheUnavailable, but `spots(inTile:)` returns an empty array both for missing and
empty tiles. Model presentation therefore needs cache metadata/presence, not merely
`results.isEmpty`, to distinguish confirmed no data from no cached data.

Expose per-visible-tile load/cache outcomes through a client repository/model change:
loaded, missing, failed, stale evidence and incomplete viewport coverage must not be
collapsed to a single empty state. A failed refresh retains cached spots; a successful
404 clears that tile. Neighborhood replacement is per tile, not an all-neighborhood
transaction: mixed cached/refreshed tiles require an update-failed/partial-status label.
Transport failure is not proof of offline; use local reachability or conservative
update-failed wording. There is no persisted last-successful-validation timestamp in
`CachedTile`; a precise “last sync” label would need local metadata, not an API field.
Evidence age and download/validation age are separate. Offline MapKit base maps and
turn-by-turn directions are not guaranteed by cached spot tiles (ADR-0004).

## Conditional API gap, not a Phase 1 blocker

If a later product decision requires a **true approximate extent/radius**, the current
area name/kind/anchor cannot supply it: no geometry or uncertainty bound is transmitted.
A reviewed, provenance-backed area geometry/radius field would then be an API GAP;
neither arbitrary client geometry nor `/spots/{id}` can replace missing evidence.
Define units/semantics and unknown behavior before proposing an optional versioned
field. Older clients should ignore it and retain approximate labels; public meaning
changes need schema compatibility review. Both tile and detail would need consistent
mapping, new canonical bytes/ETags, republished snapshots, cache decoding/storage tests
and part-budget measurement. A D1 migration is likely if canonical reviewed extents
must be stored, but cannot be decided without that design. **No such change is
requested or implemented here.** Unknown precision must not be assigned an area radius.

## Privacy and implementation evidence

The destination paths in `NearbyModel.swift` and `TileAPIClient.swift` match
`site/privacy/index.html`: search terms and exact destination coordinates are not sent
to MannerPath, locally computed destination-area tile IDs are sent. MapKit search/routing
remain external infrastructure, not canonical spot provenance. Viewport tiles would
also reveal a browsed area, so future viewport implementation should check policy
wording for non-destination browsing; this audit does not declare provider retention
UNKNOWN resolved or approve App Privacy answers. No network behavior changes here.

Existing regression evidence to preserve: `NearbyTileModelTests`, `NearbyLocationModelTests`,
`TileSyncTests`, `TileDeliveryV2Tests`, `ApproximateLocationTests`, `NearbyDomainTests`.
Future viewport/selection work needs tests for pan/zoom limits, partial coverage,
stale responses, nil vs empty cache, unknown precision and Watch/Widget isolation.

## Validation and scope

Docs-only; no code, schema, configuration, production API or Cloudflare changes.
Run `make api-validate` (Node 24), `make contract`, `git diff --check`.
Apple test files were inspected as contract evidence; Apple execution and live runtime
testing are not part of this audit. The new PR must remain Draft, not merged here.
