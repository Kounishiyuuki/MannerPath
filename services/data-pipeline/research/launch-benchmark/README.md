# Launch-region tile benchmark (research)

Measures spot density, tile payload size and request counts at z13–z16 to choose `DATA_TILE_ZOOM`
(ADR-0005). The findings and the recommendation are in `docs/research/2026-09-launch-dataset-and-tile-zoom.md`.

This is research code. It is not the production importer and has no dependencies (Node ≥ 18).

## Reproduce

```sh
./fetch.sh                       # downloads into .cache/ (gitignored), prints SHA-256
node benchmark.mjs > results/$(date +%F).json
```

- Without `.cache/osm_23wards.json`, only the Taito scenario runs. The Taito input defaults to the committed fixture.
- `SKIP_OSM=1 ./fetch.sh` skips the Overpass query. That query is a single research request, not a client path (AGENTS.md).
- Output is deterministic for identical inputs (fixed PRNG seed).
- The OSM snapshot used for `results/2026-09-20.json` is `2026-09-19T18:19:35Z`. Overpass data changes over time, so a re-run will differ slightly.

## Data handling

- OSM data stays in `.cache/` and is never committed or published (DATA_POLICY.md). Committed results contain only aggregate statistics.
- The stress scenario treats every OSM convenience store as a spot. It is a hypothetical payload upper bound, **not** evidence that any store has an ashtray.
