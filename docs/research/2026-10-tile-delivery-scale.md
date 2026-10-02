# Tile delivery scale: before/after (Issue #158)

Corpus: the #156 synthetic **large** profile (50,000 community spots + 513 official Taito spots), local node:sqlite,
`npm run scale:tiles -- --profile large`. Raw output: `2026-10-tile-delivery-scale-{before,after}.json`.
No 1k run is used as evidence.

## Zoom measurement (logical tiles, identical before and after)

| Zoom | Logical tiles | Max spots | p95 spots | Max raw bytes | Densest gzip | Tiles >250 spots | Tiles >16 KiB raw |
|---|---|---|---|---|---|---|---|
| z14 | 453 | 2,223 | 233 | 1,551,737 | 32,772 | 19 | 342 |
| z15 | 794 | 2,202 | 148 | 1,536,357 | 31,993 | 9 | 460 |
| z16 | 1,575 | 2,066 | 70 | 1,456,114 | 26,821 | 8 | 678 |

The densest cluster (~2,000 spots in ~110 m) sits inside one z16 tile, so going from z14 to z16 cuts the peak by only
7% while multiplying tiles (and client requests per neighbourhood) by 3.5×. **Zoom alone cannot bound a tile.**
Selected `dataTileZoom` = **14** (unchanged; served from `/v1/config`).

## Stored representation at z14

| | Before (main) | After (#158) |
|---|---|---|
| Publish | OK, but 1 row of 1,551,737 bytes | OK |
| Logical tiles | 453 | 453 |
| Multipart tiles | — | 248 |
| Physical parts / rows | 453 | 1,087 |
| Max parts per tile | 1 | 36 (14/14358/6506) |
| Max spots per part | 2,223 | 62 (budget 250) |
| Max raw bytes per part | 1,551,737 | 43,988 (budget 44,000) |
| Max stored row body bytes | 1,551,737 | 43,988 |
| Max gzip per part | 32,772 | 3,348 (budget 16,384) |
| Max manifest bytes | — | 4,659 |
| Peak RSS | 2,886 MiB | 2,363 MiB |

Densest tile 14/14358/6506: 2,223 spots → 36 parts. Every published spot is present (50,513).
