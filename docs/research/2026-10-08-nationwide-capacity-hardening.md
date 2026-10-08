# Nationwide capacity hardening — local follow-up

Date: 2026-10-08. Follow-up to [PR #215 measurements](2026-10-08-nationwide-capacity-validation.md).
Machine-readable results: [local roundtrips](2026-10-08-nationwide-capacity-hardening.json).

## Changes and compatibility

The Worker route accepted only one or two digits although ADR-0015, storage, promotion and Apple already allowed indexes 0–127. Canonical decimal parsing now accepts that full range. Existing indexes and response shapes are unchanged. Tests cover 0/9/99/100/127, refusal of 128/999/signs/leading zero/whitespace/decimal/exponent, and a generated 128-part manifest with every HTTP part, digest verification and complete assembly. A valid absent part returns 404; malformed indexes return 400.

Promotion v4 no longer accumulates all tile declarations inside the old 8 MiB declaration budget. Small bundles retain inline declarations. Larger bundles use `promotion-tile-declarations.v1`: ordered, content-addressed JSON shards bounded to 1 MiB each, with pinned byte size, digest, tile/part counts and first/last tile IDs. The whole-bundle digest pins descriptors. Readers validate shards individually; no nationwide declaration array is required. Initialization SQL is also segmented into ordered bounded files. Existing inline v4 bundles and their `initialize.sql` plans remain supported. No migration, public API or Apple change is required.

Missing, duplicate, reordered, altered, incorrectly digested, extra or incorrectly counted metadata fails verification. Local initialization is transactional; chunk receipts and final SQL assertions keep partial imports from becoming completed/sealed. Import plans verify initialization content and order. There is no separate receipt ledger for individual initialization fragments: interrupted manual remote initialization must rebuild isolated GREEN or prove the entire verified initialization set is complete before proceeding. Remote execution was not performed.

## Measured local roundtrips

| Synthetic corpus | Tiles | Parts | Metadata shards | Initialization files | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Sparse nationwide 10k | 9,940 | 9,940 | 3 | 5 | PASS |
| Sparse nationwide 50k | 48,923 | 48,923 | 13 | 21 | PASS |
| Sparse nationwide 100k | 95,936 | 95,936 | 26 | 40 | PASS |
| Concentrated 100k | 104 | 1,177 | Inline | 1 | PASS |
| Single tile 10k | 1 | 113 | Inline | 1 | PASS |

Each case ran fresh local ingest, resolution, publication, tile generation, promotion build/verify, import-plan generation/verify, fresh-target import/finalize, readiness and source/target tile parity. Local Wrangler HTTP then exercised tile and detail retrieval, ETags and complete assembly of selected tiles. Sparse corpora have one-part tiles; HTTP does not individually request every nationwide tile. Whole-target parity is checked separately. Dense 10k fetched all 113 parts, including 100–112, and verified their hashes and complete 10k-spot assembly. Concentrated 100k exercised a 17-part tile.

Largest metadata shard was 1,048,340 bytes; largest initialization file was 1,048,531 bytes, both below 1,048,576. Sparse 50k and 100k now finalize past the old cumulative 8 MiB blocker (historical declaration sizes approximately 13.6 MB and 26.6 MB). Small concentrated/dense bundles exercise the unchanged inline representation. Artifact accounting in the JSON was recomputed from completed bundle files, including metadata shards.

### Secondary resource measurement

A separate local run over the same corpora is stored under `secondaryResourceMeasurement` in the JSON. Its bundle digests equal the primary cases', so it measured identical promotion artifacts; its timings are a different run and do not replace the primary timings above. It ran on the same shared Mac with concurrent jobs and is diagnostic only, not remote D1 or production performance.

| Synthetic corpus | Ingest peak RSS | Publish peak RSS | Promotion peak RSS | Promotion wall time |
| --- | ---: | ---: | ---: | ---: |
| Sparse nationwide 10k | 2.49 GB | 0.88 GB | 369 MB | 105 s |
| Sparse nationwide 50k | 5.91 GB | 3.62 GB | 436 MB | 299 s |
| Sparse nationwide 100k | 5.81 GB | 3.95 GB | 366 MB | 766 s |
| Concentrated 100k | 6.24 GB | 3.35 GB | 396 MB | 635 s |
| Single tile 10k | 2.68 GB | 0.49 GB | 378 MB | 52 s |

The 50k/100k corpora peaked at about 5.8–6.2 GB during ingest and 3.4–3.9 GB during publication; the 10k corpora stayed below 2.7 GB and 0.9 GB. Promotion peaked at about 366–436 MB in every case. Promotion wall time ranged from about 52 to 766 seconds by case. Sparse 100k bundle generation took about 421 s in this run versus about 362 s in the primary run; per-step times are in the JSON. GB/MB are decimal (10^9/10^6 bytes).

## Safety and remaining bounds

Synthetic data is temporary and never changes the reviewed production source registry or coverage. A validation failure exposed that a repository worktree located inside the temporary directory could itself be accepted as benchmark output. The helper now explicitly rejects physical repository paths and descendants, including nonexistent children and symlink aliases; safe external temporary outputs remain allowed.

The 128-part publication cap remains unchanged. The earlier single-tile 50k/100k refusals remain expected; those two extreme corpora were not rerun as full roundtrips here. Public manifests, parts and detail contracts remain anonymous and unchanged. No source approval, coordinate generation, remote D1, Cloudflare deployment or production data mutation occurred.

These are functional local capacity results, not proof of remote D1 timing or production client capacity. Node 24.21.0 ran on a shared Mac with overlapping jobs; HTTP used one warm-up and five repetitions. Timing data is diagnostic. Source/chunk budgets, the 8 MiB descriptor-index bound and 16 MiB top-level manifest bound remain enforced; shards do not imply unlimited capacity. Remote transaction duration, actual viewport/cache/device memory and realistic source/provenance distributions still require dedicated measurement. Extreme dense tiles continue to fail closed beyond 128 parts rather than silently dropping spots. Backend tooling now declares Node >=24 consistently because promotion cursors are exercised by validation.

## Validation

Focused tile/promotion/metadata/HTTP tests cover old and new representations and malformed/partial imports. `make api-validate`, `make contract` and `git diff --check` are required before opening this follow-up PR. No production activation is authorized by these results.
