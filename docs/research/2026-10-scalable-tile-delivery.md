# Scalable tile delivery: zoom and part benchmark (Issue #158, ADR-0015)

Corpus: the #156 synthetic community corpus (`synthetic-community.v1`, seed 151152, `large` profile: 50,000 community
spots, sha256 `e8b7bb43…3642`) plus the 513 reviewed official spots. Local Node/SQLite only. Community publication is
simulated in a disposable in-memory database; the production decision stays `pending` and the source `blocked`.
Byte and count measurements only (gzip: node:zlib default level). Raw data: `2026-10-tile-delivery-large.json`.
Reproduce: `cd services/api && npm run scale:tiles -- --profile large --output /tmp/tiles-large`.

"Before" is the single schemaVersion 1 body that ADR-0005 stored as one D1 row and served as one response. "After" is
ADR-0015: a manifest plus `tile-parts.v1` parts (≤ 250 spots, ≤ 64 KiB counted as a SQL literal, ≤ 16 KiB gzip, ≤ 128
parts per tile). The 64 KiB bound is set by D1's maximum SQL statement length (100,000 bytes): when a database is
bootstrapped from SQL, one part row has to fit one INSERT statement.

## Why zoom alone cannot fix density

The dense areas (Shinjuku, Shibuya, Ikebukuro, Umeda, Hakata, Susukino) hold about 2,080 spots each inside ±0.0005°,
roughly 110 m × 110 m. Such a block stays inside one tile at any useful zoom:

| Zoom | Tiles | Max spots/tile | p95 spots/tile | Tiles > 250 spots |
| --- | ---: | ---: | ---: | ---: |
| z14 | 453 | 2,223 | 233 | 19 |
| z15 | 794 | 2,202 | 148 | 9 |
| z16 | 1,575 | 2,066 | 70 | 8 |

A spot-count pass over the raw corpus (no DB) reached the same verdict for z17 (max 2,099) and z18 (max 2,016).

## Before / after, 50k

| Zoom | Max raw (before) | p95 raw (before) | Max gzip (before) | p95 gzip (before) | Tiles > 16 KiB gzip | D1 row max (before) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| z14 | 1,551,737 | 163,511 | 33,040 | 5,136 | 6 | 1,551,737 |
| z15 | 1,536,357 | 104,009 | 32,262 | 3,423 | 6 | 1,536,357 |
| z16 | 1,456,114 | 49,533 | 26,938 | 2,071 | 6 | 1,456,114 |

| Zoom | Parts | Max parts/tile | Max / p95 spots per part | Max / p95 raw per part | Max / p95 gzip per part | Max manifest | D1 row max (after) | Parts over budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| z14 | 810 | 24 | 93 / 93 | 65,532 / 65,479 | 3,975 / 2,483 | 2,634 | 65,532 | 0 |
| z15 | 1,083 | 24 | 93 / 93 | 65,529 / 65,470 | 3,791 / 2,456 | 2,635 | 65,529 | 0 |
| z16 | 1,715 | 23 | 93 / 92 | 65,491 / 65,096 | 3,504 / 2,034 | 2,531 | 65,491 | 0 |

The published z14 corpus passes the publication hard gate `tile-part-budget` with real gzip:
`max 93 spots / 65532 raw / 3975 gzip bytes per part … max 24 parts/tile (limit 128), max manifest 2634 bytes`.

The largest D1 row drops from 1.55 MB (78% of D1's 2 MB row limit, and 15× D1's SQL statement limit) to 65,532
bytes. It is bounded by construction at 64 KiB as a SQL literal for any density. The largest response drops from
33,040 to 3,975 gzip bytes. With ~700-byte synthetic DTOs, bytes close every part at 93 spots, before the 250-spot cap.

## Requests around a viewport

The client syncs the 3×3 neighbourhood of the tile it stands in. Origins are all 50,513 published spots, since that is
where people stand. A tile of at most one part costs one request at the v1 path (as before); a multi-part tile costs
its manifest plus its parts. An unpublished neighbour costs one request (its 404).

| Zoom | Requests mean / p50 / p95 / max (after) | Neighbourhood gzip mean / p95 (before) | (after) |
| --- | --- | --- | --- |
| z14 | 20.19 / 12 / 55 / 58 | 18,284 / 61,301 | 26,609 / 98,693 |
| z15 | 16.48 / 11 / 33 / 35 | 13,747 / 34,566 | 19,335 / 54,045 |
| z16 | 15.13 / 9 / 33 / 33 | 13,854 / 34,784 | 18,692 / 53,384 |

Before, every neighbourhood cost exactly 9 requests. Dense-area neighbourhoods (after; before is 9 requests each):

| Zoom | Shinjuku | Shibuya | Ikebukuro | Umeda | Hakata | Susukino |
| --- | --- | --- | --- | --- | --- | --- |
| z14 | 55 / 100,861 B | 55 / 98,693 B | 34 / 52,344 B | 35 / 70,059 B | 37 / 56,697 B | 35 / 57,223 B |
| z15 | 32 / 49,565 B | 32 / 50,435 B | 32 / 49,140 B | 33 / 63,273 B | 32 / 49,158 B | 35 / 54,045 B |
| z16 | 32 / 51,105 B | 32 / 50,962 B | 32 / 51,461 B | 33 / 56,617 B | 32 / 50,133 B | 33 / 53,384 B |

At z14, Shinjuku and Shibuya are 55 requests because both dense blocks fall inside the same 3×3 neighbourhood. The
iPhone client fetches a tile's parts concurrently, so a 24-part tile costs one manifest round trip plus one
concurrent batch, not 24 serial round trips.

## Decision inputs

- Parts, not zoom, solve density: every zoom has dense tiles above 2,000 spots, and every zoom is within budget once
  split.
- z14 stays (`DATA_TILE_ZOOM = 14`). z15 lowers the dense-neighbourhood p95 (55 → 33 requests, 99 KB → 54 KB gzip)
  and the mean (20.2 → 16.5). That gain comes from two synthetic 2,000-spot blocks sharing one z14 neighbourhood.
  Against it, z15 costs four things:
  - The 3×3 neighbourhood covers a quarter of the area. ADR-0005 measured z15 needing 25 requests at p90 to find the
    nearest 1–3 spots in sparse data.
  - +75% tiles (453 → 794).
  - A rebuild of `spots` and `tile_snapshots`, which pin `z = 14` in CHECK constraints.
  - A full client cache invalidation.

  z16 adds nothing over z15 here and doubles the tiles again.
- The client now reads `dataTileZoom` from `/v1/config` and supports 14–16, so a future move to z15 is a server-side
  contract change with a namespaced, atomic client cache eviction, not an app release.
- Revisit trigger: if a real (not synthetic) corpus puts the dense-neighbourhood p95 above ~33 requests, move to z15
  through `/v1/config`.
- 250 spots stays as the upper bound, but bytes bind first. Reviewed official spots measure a median of 791 B (max
  861 B), so a 64 KiB part holds ~80 real spots at ~5–6 KB gzip, well inside the 16 KiB transfer budget. 250 spots of
  real data (~200 KB) could not be stored as one D1 statement at all.

## Limits of this measurement

- The synthetic DTOs are more compressible than real ones (synthetic 64 KiB parts reach ~4 KB gzip; 250 real
  official spots reach ~11 KB per ~200 KB). The publication gate measures real gzip on what is actually published.
- Request counts are a model of the client's 3×3 sync, not a device measurement. Latency, HTTP/2 multiplexing and
  battery were not measured.
- No remote D1 was used.
