# Segmented promotion capacity — Issue #157

Base main: `299782a90758a19a69f8e2d93db853078afc0118`. Local disk-backed SQLite,
Node v24.10.0, macOS. Initial chunk comparison and medium/large generation overlapped validation; timings are diagnostic.
The final single-budget 1k run is recorded separately in the JSON.
Separate exporter processes measure export-only peak RSS, excluding generation/publishing/quality.
Raw numbers: [JSON](2026-10-segmented-promotion.json). No remote D1, deployment, or activation.

## Measured results

| Synthetic spots / reports (+513 official) | Artifact | Chunks | Largest SQL | Build | Verify | Bootstrap | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k / 5k, 1 MiB chunks | 10,350,237 B | 10 | 46,817 B | 1.179 s | 0.434 s | 2.333 s | 405 MiB final full run |
| 10k / 50k | refused | — | existing tile INSERT 330,254 B | 14.701 s isolated refusal | — | — | 159 MiB isolated export; 777 MiB full profile |
| 50k / 250k | refused | — | existing tile INSERT 1,552,013 B | 29.699 s isolated refusal | — | — | 256 MiB isolated export; 2,417 MiB full profile |

A refusal produces no manifest or completed artifact directory. Largest existing tile statement is
calculated from the exact escaped UTF-8 literal/SQL size without constructing that oversized statement.
The first oversized tile encountered is not necessarily the largest one. The writer refuses at its
90,000-byte policy, below D1's official 100,000-byte limit.

The 1k profile verifies every file, privacy absence, deterministic source re-export, complete bootstrap,
canonical/tile/tier/attribution quality parity and cross-source candidate parity, then byte-identical
bootstrap re-export. The 10k/50k profiles complete real report generation, publication and bounded quality /
cross-source checks, but cannot verify/apply/re-export a complete v4 artifact until the tile fix lands.
Do not interpret their smaller RSS as a completed nationwide bootstrap comparison with #156's 5.23 GiB.

The verified import plan was also executed against a separate fresh local SQLite database: 12 SQL files,
10,416,414 SQL bytes, 1,513 resulting spots, completed readiness, 0.550 s application. This timing excludes
plan generation/verification and is separate from the streaming bootstrap measurement above.
The final resumed-source harness also generated the same source/plan digests: plan generation 0.450 s,
plan verification 0.452 s, complete plan artifact 10,646,826 B, resumed-process peak RSS 249 MiB.

## Operational chunk comparison (1k)

| Budget | Chunks | Build | Verify | Apply | Bootstrap incl. preflight/finalize | Slowest chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 10 | 1.187 s | 0.435 s | 1.482 s | 2.393 s | 0.198 s |
| 4 MiB | 3 | 1.179 s | 0.422 s | 1.400 s | 2.320 s | 0.647 s |
| 16 MiB | 1 | 1.268 s | 0.437 s | 1.509 s | 2.441 s | 1.509 s |

Recommend **1 MiB provisionally**: total time differs by about 3%, while the largest retry unit is much
shorter. Build still requires an explicit byte budget. Re-run the comparison against the completed 50k
artifact before treating this as a nationwide recommendation. File size is unrelated to D1's 5 GB import
limit, and local timings do not establish the remote 30-second entire-batch limit.

## Safety and compatibility

Focused tests cover missing/corrupt/truncated files, stale/wrong manifest, re-signed source/release/observation/
attribution/tile/count metadata, duplicate sources, malicious numeric fields, exact additive release sets,
out-of-order imports, replay, partial transaction rollback, unfinished readiness, immutable receipts,
oversized row cleanup, parser boundaries, and private-table refusal.
The six-source 513 corpus and reviewed cross-release attestation flow bootstrap and re-export through v4.
The Taito v3-compatible golden changes only by eight empty schema tables; its SQL hash remains unchanged.

## Remaining capacity blockers before 100k

1. **Tile representation:** 10k's largest existing statement is 330,254 B; 50k's is 1,552,013 B. The current
   representation cannot satisfy the D1 statement limit. Wait for Claude's scalable tile work, fetch/rebase,
   migrate the persisted local source as required, and re-run 1k/10k/50k. Do not split or disguise literals.
2. **Completed large bootstrap measurements:** artifact/chunk counts, verify/apply/finalization/determinism
   and whole-process peak RSS remain unmeasured at 10k/50k. Full pre-export 50k peak is 2,417 MiB, with
   publish/cross-source phases contributing substantially; exporter-only refusal peak is 256 MiB.
3. **Remote execution duration:** D1's 30-second query/batch bound is not proven by local SQLite. The deterministic
   import plan now supplies locally validated atomic receipt wrappers. Actual remote duration and the
   isolated-writer protocol remain unverified; no remote statement has been executed.
4. **Manifest metadata:** v4 enforces a 16 MiB manifest/metadata budget and a statement budget for review
   dependency declarations. Measure actual 100k release/tile metadata after tile integration; capacity
   refusal is explicit rather than permitting unbounded memory. No successful 100k claim is made.

## Reproduce

From `services/api`, Node >=24 on PATH:

```sh
npm run scale:promotion:v4 -- --profile small --output /private/tmp/promotion-small
npm run scale:promotion:v4 -- --profile medium --output /private/tmp/promotion-medium --chunk-bytes 1048576
npm run scale:promotion:v4 -- --profile large --output /private/tmp/promotion-large --chunk-bytes 1048576
```

Use new output prefixes. `--resume-source` retains deterministic generated evidence and republishes after
tile integration; apply any new schema migrations first. It is not report/publication activation.
