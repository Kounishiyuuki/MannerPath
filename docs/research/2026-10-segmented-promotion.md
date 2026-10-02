# Segmented promotion capacity — Issue #157 / PR #159

Base main: `ff054295272d52c4be63fcf755c3f53b1003828c` (merged PR #160). Node v24.10.0, macOS,
disk-backed local SQLite. Profiles overlapped validation/tile benchmarking, so wall times are diagnostic.
[Raw measurements](2026-10-segmented-promotion.json). No remote D1, deployment, cutover, or activation.

## Completed roundtrips

V4 transports the ADR-0015 canonical tile manifest/head and `tile_snapshot_parts` rows without assembling
a multipart tile into one INSERT. Every complete INSERT is checked with SQL escaping under the unchanged
90,000-byte policy. Head rows precede part rows; ordering and all artifact hashes are deterministic.

Every profile completed corpus build, publication, v4 build/verify, import-plan generation/verification,
fresh GREEN apply/finalization/readiness, quality/cross-source parity, deterministic source re-export,
and byte-identical GREEN re-export. Spot counts below are synthetic; each profile also includes 513 official spots.

| Synthetic spots / reports | Logical tiles | Parts | Max parts/tile | Artifact bytes | Chunks | Max statement bytes | Build | Verify | Apply | Bootstrap | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k / 5,000 | 366 | 366 | 1 | 10,582,851 | 10 | 46,714 | 1.249 s | 0.438 s | 1.435 s | 2.381 s | 0.404 GiB |
| 10k / 50,000 | 439 | 464 | 6 | 65,311,323 | 61 | 65,503 | 20.084 s | 9.386 s | 16.011 s | 28.807 s | 0.689 GiB |
| 50k / 250,000 | 453 | 810 | 24 | 308,801,582 | 288 | 65,729 | 57.858 s | 17.186 s | 74.494 s | 104.480 s | 2.477 GiB |

Bootstrap includes full preflight/initialization, all chunks and finalization. Statement bytes exclude the
file newline separator; the writer additionally checks that separator within its stricter budget. Artifact
bytes include manifest and finalize. All three use 1 MiB chunk targets.

| Profile | Import-plan generation | Import-plan verify | Complete plan artifact bytes | Slowest local chunk |
| --- | ---: | ---: | ---: | ---: |
| 1k | 0.445 s | 0.446 s | 10,963,345 | 0.193 s |
| 10k | 10.068 s | 9.055 s | 67,619,029 | 0.993 s |
| 50k | 17.849 s | 15.148 s | 319,622,162 | 1.122 s |

The completed standalone 50k exporter took 43.931 s at 434.4 MiB peak RSS,
excluding corpus build/publication. It produced the same bundle digest and 288 chunks as the full profile.
Full 50k peak RSS is 2.477 GiB versus #156's reported 5.23 GiB; this is now a completed
bootstrap measurement, not an oversized-tile refusal. No SQL file or corpus is materialized as one string.

## Operational chunk comparison (current canonical parts, 1k)

| Target | Chunks | Build | Verify | Apply | Bootstrap | Slowest chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 10 | 1.935 s | 0.710 s | 2.017 s | 3.385 s | 0.280 s |
| 4 MiB | 3 | 1.631 s | 0.663 s | 1.717 s | 2.915 s | 0.795 s |
| 16 MiB | 1 | 1.453 s | 0.569 s | 1.718 s | 2.887 s | 1.718 s |

1 MiB trades some total throughput for a smaller retry unit; 50k also completes at this budget. The CLI
requires an explicit budget rather than silently choosing it. Local latency cannot establish remote D1's
30-second query/batch limit.

## Integrity, safety and compatibility

The manifest pins schemaVersion, head hash/revision/count and every part index/hash/count. Immutable expected
head/part ledgers bind DB finalization to those declarations. The local verifier checks actual hashes and
canonical content one bounded part at a time, including complete logical membership and source attribution.
Missing/extra parts, duplicate indexes, hash/head/part/tile/revision/count corruption, incomplete membership,
and consistently rehashed noncanonical content cannot complete GREEN. Empty logical tiles remain valid.

`0029_segmented_promotion.sql` follows unchanged `0028_tile_parts.sql`; all 64 tables are considered by
legacy/v4 empty-target guards. V2/v3 and the current six-source 513 corpus pass regressions. The Taito golden
diff versus #160 adds only nine empty v4 ledger tables. #160 routes/config/Apple sync and part budgets stay intact.

Validation: contract; API 775 tests + discovery 69; iOS tests + Watch build; tsc; 13 multipart regressions;
large tile delivery gate pass. The 50k tile gate measured max 93 spots / 65,532 SQL-literal bytes / 3,977 gzip
bytes per part and a 2,634-byte maximum manifest. Its policy remains 250 / 65,536 / 16,384 / 128 parts.

## Before 100k / production capacity

1. 100k promotion has not been run. Measure actual artifact size, manifest metadata (16 MiB cap), chunk count,
   memory and complete finalization; 50k success does not prove the next profile.
2. Current 50k maximum is 24 parts/tile against a fixed 128-part cap. Future concentrated density or one
   unsplittable oversized spot may still refuse; never raise the accepted tile/SQL budgets to hide it.
3. Local full bootstrap takes 104.480 s across 288 atomic chunks. The remote 30-second per-query/batch
   limit, file importer behavior/performance, and isolated-writer procedure require later authorized remote
   verification. No remote duration claim is made.
4. Full 50k still peaks near 2.48 GiB; corpus publication/cross-source tooling contributes beyond the
   isolated streaming exporter. Assess those phases before increasing corpus/density or concurrent processes.

## Reproduce

From `services/api`, Node >=24 on PATH, use fresh output prefixes:

```sh
npm run scale:promotion:v4 -- --profile small --output /private/tmp/promotion-1k --chunk-bytes 1048576
npm run scale:promotion:v4 -- --profile medium --output /private/tmp/promotion-10k --chunk-bytes 1048576
npm run scale:promotion:v4 -- --profile large --output /private/tmp/promotion-50k --chunk-bytes 1048576
npm run scale:tiles -- --profile large --output /private/tmp/tiles-50k
```

All community approval/rights in these disposable benchmark databases are simulation-only. Production #124
remains pending and OSM is not activated. `--resume-source` expects an already migrated source at the same
output prefix; it is not a production activation command.
