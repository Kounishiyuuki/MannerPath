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
  | bytes per part as a SQL literal (each `'` counted twice): one D1 row, one response | 64 KiB | the split; `CHECK` in migration 0028 |
  | gzip bytes per part | 16 KiB | publication quality gate `tile-part-budget` (fails, never warns) |
  | parts per tile | 128 | the split (publication throws); `CHECK` on `part_index` |
  | manifest bytes | 16 KiB | publication quality gate |

  The byte bound comes from D1's maximum SQL statement length (100,000 bytes). When a database is bootstrapped from
  SQL, one part row has to fit one INSERT statement, quoting included. D1's 2 MB row limit is not the binding
  constraint. Reviewed spots are ~790 bytes, so bytes close a real part at ~80 spots, at ~5–6 KB gzip.

  250 spots stays as the upper bound from ADR-0005. 250 real spots (~200 KB) could never be one statement, so the
  per-part count is effectively ~80–95. 16 KiB keeps ADR-0005's transfer budget per response.

  Gzip is a gate, not a split input: gzip output differs between zlib builds, and the split must be deterministic.
  128 parts allow ~10,000 real spots in one tile, above the densest block of the 100k stress profile.
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
  than 128 parts, throws `TileBudgetExceeded`. That is the signal to change the
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

`DATA_TILE_ZOOM` stays 14. With parts, every measured zoom is within budget. z15 would lower the dense-neighbourhood
p95 from 55 to 33 requests (99 → 54 KB gzip) and the mean from 20.2 to 16.5. That gain comes from two synthetic
2,000-spot blocks sharing one z14 neighbourhood. Against that, z15:

- shrinks the 3×3 neighbourhood to a quarter of the area, which hurts sparse areas (ADR-0005's reason for z14);
- adds 75% more tiles;
- requires rebuilding the `z = 14` CHECK-constrained canonical tables;
- invalidates every client cache.

Because the client is now config-driven over 14–16, revisiting this needs no app release. Revisit when a real corpus
puts the dense-neighbourhood p95 above ~33 requests.

### Promotion interface

Promotion carries `tile_snapshot_parts` as rows and validates each manifest against its parts by hash before the
assembled tile is checked as before. The tile output guarantees:

- every row is bounded so that its INSERT fits one D1 statement: a part is ≤ 64 KiB as a SQL literal, a manifest
  ≤ 16 KiB;
- bytes and hashes are deterministic: equal content gives byte-identical parts.

Promotion-specific chunking of the bundle is out of scope here.

## Consequences

- One tile can cost a client up to 1 + 128 requests. Measured: the densest z14 tile costs 25 (24 parts fetched
  concurrently), the median neighbourhood 12, and a neighbourhood holding two synthetic 2,000-spot blocks 55.
- Every whole-tile reader goes through `readPublishedTiles` / `assembleTileV1`. `tile_snapshots.body_json` is no
  longer a tile body.
- Changing `tile-parts.v1` changes part bytes, which republishes every tile with a new revision. Treat it like a
  schema change: a new policy version, measured.

## Amendment 2026-10-08 — nationwide capacity hardening

The Worker part route accepts canonical indexes 0–127, matching the existing migration, verifier and
Apple 128-part contract. The earlier two-digit parser rejected valid indexes 100–127; this is a bug fix,
not a tile policy or public response change. Publication still refuses tiles needing more than 128 parts.

Promotion v4 can carry tile declarations in `promotion-tile-declarations.v1` metadata shards. Each
file is at most 1 MiB, deterministically ordered, content-addressed and hash-pinned by the reviewed
manifest digest. Small legacy inline v4 manifests remain supported. Readers iterate declarations
without reconstructing a nationwide array. Import-plan initialization is also segmented for shard
artifacts. Existing exact expected-tile/part and chunk-receipt gates remain required before completion.
No data zoom, public manifest/part/detail response, Apple client or database schema changes.
See [the promotion runbook](../SEGMENTED_PROMOTION_RUNBOOK.md) for artifact and initialization rules.
