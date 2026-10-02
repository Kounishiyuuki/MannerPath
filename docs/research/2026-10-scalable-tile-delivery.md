# Scalable tile delivery: zoom and part benchmark (Issue #158, ADR-0015)

Corpus: the #156 synthetic community corpus (`synthetic-community.v1`, seed 151152, `large` profile: 50,000 community
spots, sha256 `e8b7bb43…3642`) plus the 513 reviewed official spots. Local Node/SQLite only. Community publication is
simulated in a disposable in-memory database; the production decision stays `pending` and the source `blocked`.
Byte and count measurements only (gzip: node:zlib default level). Raw data: `2026-10-tile-delivery-large.json`.
Reproduce: `cd services/api && npm run scale:tiles -- --profile large --output /tmp/tiles-large`.

"Before" is the single schemaVersion 1 body that ADR-0005 stored as one D1 row and served as one response. "After" is
ADR-0015: a manifest plus `tile-parts.v1` parts (≤ 250 spots, ≤ 256 KiB raw, ≤ 16 KiB gzip, ≤ 64 parts per tile).

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
| z14 | 513 | 9 | 250 / 250 | 178,143 / 176,447 | 6,575 / 4,738 | 1,084 | 178,143 | 0 |
| z15 | 844 | 9 | 250 / 250 | 177,454 / 174,380 | 6,089 / 4,050 | 1,085 | 177,454 | 0 |
| z16 | 1,623 | 9 | 250 / 76 | 176,533 / 53,670 | 5,070 / 2,196 | 1,084 | 176,533 | 0 |

The published z14 corpus passes the publication hard gate `tile-part-budget` with real gzip:
`max 250 spots / 178143 raw / 6575 gzip bytes per part … max 9 parts/tile … max manifest 1084 bytes`.

The largest D1 row drops from 1.55 MB (78% of D1's 2 MB row limit) to 178 KB (8.7%), and is bounded by
construction at 256 KiB for any density. The largest response drops from 33,040 to 6,575 gzip bytes.

## Requests around a viewport

The client syncs the 3×3 neighbourhood of the tile it stands in. Origins are all 50,513 published spots, since that is
where people stand. A tile of at most one part costs one request at the v1 path (as before); a multi-part tile costs
its manifest plus its parts. An unpublished neighbour costs one request (its 404).

| Zoom | Requests mean / p50 / p95 / max (after) | Neighbourhood gzip mean / p95 (before) | (after) |
| --- | --- | --- | --- |
| z14 | 12.57 / 9 / 27 / 27 | 18,284 / 61,301 | 21,071 / 76,056 |
| z15 | 11.43 / 9 / 18 / 19 | 13,747 / 34,566 | 15,680 / 41,921 |
| z16 | 11.42 / 9 / 19 / 19 | 13,854 / 34,784 | 15,748 / 42,110 |

Before, every neighbourhood cost exactly 9 requests. Dense-area neighbourhoods (after; before is 9 requests each):

| Zoom | Shinjuku | Shibuya | Ikebukuro | Umeda | Hakata | Susukino |
| --- | --- | --- | --- | --- | --- | --- |
| z14 | 27 / 78,224 B | 27 / 76,056 B | 18 / 40,075 B | 18 / 57,036 B | 18 / 42,646 B | 19 / 44,365 B |
| z15 | 18 / 38,129 B | 18 / 39,193 B | 18 / 37,953 B | 18 / 51,250 B | 18 / 37,856 B | 19 / 41,921 B |
| z16 | 18 / 39,742 B | 18 / 39,797 B | 18 / 40,203 B | 19 / 45,690 B | 18 / 38,885 B | 19 / 42,110 B |

At z14, Shinjuku and Shibuya are 27 requests because both dense blocks fall inside the same 3×3 neighbourhood.

## Decision inputs

- Parts, not zoom, solve density: every zoom has dense tiles above 2,000 spots, and every zoom is within budget once
  split.
- z14 stays (`DATA_TILE_ZOOM = 14`). z15 halves the dense-neighbourhood p95 (27 → 18 requests, 76 KB → 42 KB gzip),
  but it costs four things:
  - The 3×3 neighbourhood covers a quarter of the area. ADR-0005 measured z15 needing 25 requests at p90 to find the
    nearest 1–3 spots in sparse data.
  - +75% tiles (453 → 794).
  - A rebuild of `spots` and `tile_snapshots`, which pin `z = 14` in CHECK constraints.
  - A full client cache invalidation.

  z16 adds nothing over z15 here and doubles the tiles again.
- The client now reads `dataTileZoom` from `/v1/config` and supports 14–16, so a future move to z15 is a server-side
  contract change with a namespaced, atomic client cache eviction, not an app release.
- 250 spots per part is kept. 250 reviewed official spots measure ~200 KB raw / ~11 KB gzip (median 791 B per spot;
  max 861 B), inside the 16 KiB transfer budget, so the ADR-0005 numbers remain the right per-response budget. The raw
  byte bound is set where the spot count binds first for ordinary DTOs.

## Limits of this measurement

- The synthetic DTOs are more compressible than real ones: synthetic parts reach ~6.5 KB gzip for 250 spots, while
  250 real official spots reach ~11 KB. The publication gate measures real gzip on what is actually published.
- Request counts are a model of the client's 3×3 sync, not a device measurement. Latency, HTTP/2 multiplexing and
  battery were not measured.
- No remote D1 was used.
