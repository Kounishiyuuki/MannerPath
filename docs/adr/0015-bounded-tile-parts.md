# ADR-0015 — Bounded tile parts and config-driven tile zoom

Status: Accepted (Issue #158, child of #67). Amends ADR-0005; `DATA_TILE_ZOOM = 14` is unchanged.

## Context

ADR-0005 stores and serves each tile as one complete snapshot body, and asks for a re-evaluation of the zoom when a
tile passes 250 spots or 16 KiB gzip. The #156 scale benchmark (50,000 community spots, 250,000 reports) reached
2,223 spots, 1.55 MB raw and 33,043 gzip bytes in one z14 tile. That is past the budget, one D1 row is at 78% of D1's
2 MB row limit, and one response is about 2,000 map annotations.

The benchmark for this ADR (`docs/research/2026-10-scalable-tile-delivery.md`) shows that zoom cannot fix this. Dense
areas stay above 2,000 spots per tile at z14, z15, z16 (and at z17/z18 in a spot-count pass), because a station-plaza
block of ~110 m fits inside one tile at any useful zoom.

## Decision

### Tile parts

- A tile's complete snapshot is split into **parts**: spots in spot-ID order, a part closing when one more spot would
  breach the versioned policy `tile-parts.v1`:

  | Bound | Value | Enforced by |
  | --- | --- | --- |
  | spots per part | 250 | the split; `CHECK` in migration 0028 |
  | raw JSON bytes per part (one D1 row, one response) | 256 KiB | the split; `CHECK` in migration 0028 |
  | gzip bytes per part | 16 KiB | publication quality gate `tile-part-budget` (fails, never warns) |
  | parts per tile | 64 | the split (publication throws); `CHECK` on `part_index` |
  | manifest bytes | 8 KiB | publication quality gate |

  250 spots and 16 KiB keep ADR-0005's per-response budget, now applied to the unit that is actually stored and
  sent. 250 real reviewed spots measure ~200 KB raw / ~11 KB gzip. The raw bound therefore lets the spot count bind for
  ordinary DTOs and catches only outliers, 8× under the D1 row limit. Gzip is a gate, not a split input: gzip output
  differs between zlib builds, and the split must be deterministic.
- A part body (schemaVersion 2) carries its spots and only the sources they cite, and **no revision or timestamp**.
  Its bytes and SHA-256 depend only on its content.
- The tile's `tile_snapshots` row holds the **manifest** (schemaVersion 2): revision, `generatedAt`, the policy
  version, the total spot count, and every part's index, spot count and SHA-256. Its `content_sha256` is the
  manifest's hash, so the manifest ETag changes exactly when any part changes.
- Parts live in `tile_snapshot_parts` (migration 0028). The publish step replaces a tile's parts in the same batch
  (transaction) as its manifest and `tile_snapshot_spots`. A reader never sees a manifest without its parts.
- A tile is republished only when its part hash list changes. A pre-0028 schemaVersion 1 row always republishes once,
  which is how an existing database converts.
- Publication fails rather than emitting an oversized tile. A single spot larger than a part, or a tile needing more
  than 64 parts (16,000 spots in one z14 tile), throws `TileBudgetExceeded`. That is the signal to change the
  policy or the zoom with a new version, never to raise a number in place.

### API (`docs/API.md`)

- `GET /v1/tiles/{z}/{x}/{y}` keeps serving the schemaVersion 1 body for every tile of at most one part. The body is
  assembled from the part and is byte-identical to the pre-ADR-0015 stored body, so its ETag does not change. The
  goldens prove this for every reviewed source.
- A multi-part tile answers `409 tileRequiresParts` at that path. **Old client behaviour:** a build from before this
  ADR replaces a cached tile with whatever body it receives, so it must never get a partial snapshot. It fails that
  one tile's refresh, keeps its cached copy, and stays correct everywhere else.
- `GET …/manifest` and `GET …/parts/{index}` serve schemaVersion 2 with strong ETags (`"2-<sha256>"`).
- `/v1/config` publishes tile schema range `[1, 2]`.

### Client (iPhone; the Watch is fed by the iPhone)

- `dataTileZoom` from `GET /v1/config` is the single source of truth. The build supports zooms 14–16. Outside that,
  or with no tile schema it can decode, the client fails closed: no sync, cached tiles stay visible.
- The tile cache is bound to a namespace: (cache schema, data zoom). A different zoom evicts every cached tile and
  records the new namespace in one transaction. A sync that began under the old namespace can never apply. No
  partial mixed world exists across a zoom change. Offline, the cache is read at its own namespace's zoom.
- The client reads a tile at the v1 path, switches to manifest + parts on `409 tileRequiresParts`, and revalidates a
  tile cached from parts at its manifest. It applies a multi-part tile only when every part's bytes hash to the
  manifest entry, replacing the cached tile in one transaction. On any mismatch it applies nothing.
- The Nearby map draws the filtered, ranked results through MapKit's native clustering (`MKMapView` with a
  `clusteringIdentifier`; SwiftUI `Map` has no clustering on iOS 18). Tapping a cluster zooms to its members.
  Annotation updates are diffed, so a refresh does not re-add thousands of pins. The Watch keeps its bounded
  500-spot snapshot.

### Zoom

`DATA_TILE_ZOOM` stays 14. With parts, every measured zoom is within budget. z15 would halve the dense-neighbourhood
p95 (27 → 18 requests, 76 → 42 KB gzip). Against that, z15:

- shrinks the 3×3 neighbourhood to a quarter of the area, which hurts sparse areas (ADR-0005's reason for z14);
- adds 75% more tiles;
- requires rebuilding the `z = 14` CHECK-constrained canonical tables;
- invalidates every client cache.

Because the client is now config-driven over 14–16, revisiting this needs no app release.

### Promotion interface

Promotion carries `tile_snapshot_parts` as rows and validates each manifest against its parts by hash before the
assembled tile is checked as before. The tile output guarantees each row is bounded (≤ 256 KiB part, ≤ 8 KiB manifest)
and that bytes and hashes are deterministic: equal content gives byte-identical parts. Promotion-specific chunking of
the bundle is out of scope here.

## Consequences

- One tile can cost a client up to 1 + 64 requests; measured, the densest z14 tile costs 10, and the median
  neighbourhood still costs 9.
- Every whole-tile reader goes through `readPublishedTiles` / `assembleTileV1`. `tile_snapshots.body_json` is no
  longer a tile body.
- Changing `tile-parts.v1` changes part bytes, which republishes every tile with a new revision. Treat it like a
  schema change: a new policy version, measured.
