# Nationwide community scale runbook (#153, child of #67)

Community publication remains blocked: #124 is open, report terms and publication rights are pending.
Benchmark source approval exists only inside disposable simulation databases. Never apply a synthetic bundle
or activate terms in an operational database. Durable REPORTS_DB storage is integrated from PR #155 / ADR-0014.

## Explicit local measurement

Run from `services/api` with the repository Node version:

```sh
npm run scale:community -- --profile small
npm run scale:community -- --profile medium
npm run scale:community -- --profile large
```

Small is 1,000 community spots / 5,000 reports, medium 10,000 / 50,000, large 50,000 / 250,000.
The generator is deterministic and fixtures are generated at runtime; no giant fixture is committed.
Correctness tests belong to `npm test`; these wall-clock measurements are explicit operator runs, never CI
latency gates. Retain JSON reports for before/after comparisons using identical seed, Node and machine.
Local SQLite timings do not measure D1 network, replication, production concurrency or Apple rendering.

## Beyond the first 1,000

Refresh published coverage aggregates and campaign progress weekly. Count distinct published community-origin
spots separately from reports and from independent confirmations. The acquisition phases add 100, 600, 235
and 65 spots; never recount an earlier phase. Keep official coverage independent and record unassigned areas.
Use kind-specific, versioned progression rules and revisit sufficiently covered seeds when coverage falls.
Prioritize remaining station/airport gaps while preserving access, type and freshness uncertainty.

Drain moderation in bounded pages, reviewing each decision individually. Priority buckets use oldest-first
ordering and age promotion; track oldest pending age alongside total backlog so lower urgency work is visible.
Run retention repeatedly until no due rows remain, saving the returned cursor after each committed batch.
An interrupted/retried batch must preserve the 90-day privacy policy; do not wait for moderation completion.
Do not copy private report rows into DATA_DB, bundle SQL, campaign dashboards or benchmark reports.

## Capacity review and failure boundaries

Keep the ADR-0005 reevaluation thresholds at 250 spots or 16 KiB gzip per z14 tile. Crossing either threshold
requires a measured zoom/partition/payload design review before rollout; it is not a reason to raise the budget.
Tile snapshot semantics, atomic publication, ETags and attribution stay unchanged.
Promotion/bootstrap are offline full-corpus operations: monitor peak RSS, SQL bytes, maximum statement bytes,
generation/verification/import time, deterministic hashes and re-export identity. Abort on invariant failures;
never split a canonical mutation into non-atomic chunks merely to obtain a passing benchmark.

Cloudflare limits were checked on 2026-10-01 against
[official D1 limits](https://developers.cloudflare.com/d1/platform/limits/). At that check, statements allowed
100 bound parameters and 100 KB SQL, a row/string 2 MB, query/batch duration 30 seconds, and a database 10 GB
Paid / 500 MB Free. Worker read budgets were 1,000 Paid / 50 Free queries per invocation. These are infrastructure
observations, not permanent product constants. Recheck the docs and current plan before deployment; node:sqlite
accepting a workload does not establish that D1 or a Worker can execute it. Inspect EXPLAIN plans and rows read,
not only returned row counts. Time Travel retains 30 days Paid / 7 Free at that check; it does not replace the
existing reviewed blue/green rollback procedure.

## Integration ownership

DATA_DB owns canonical spots, published tiles, coverage, promotion, quality and cross-source review.
REPORTS_DB owns private reports, moderation, retention, App Attest and report-side indexes in `migrations-reports/`.
PR #155 is integrated; canonical spatial lookup belongs in migration 0026, separate from report-side migrations.
No cross-database join or private-data round trip through DATA_DB is an acceptable optimization.

## Query-plan audit

The benchmark wraps the actual Db interface and captures each production SELECT/WITH statement, call count,
maximum bind count and EXPLAIN QUERY PLAN, grouped by operation and database. The JSON contains no bind values.
Use the plans on the large corpus to distinguish an intentional aggregate/table export from repeated scans.

| Operation | Access strategy | Remaining scale boundary |
| --- | --- | --- |
| Tile read / spot detail | Tile primary key; spot/membership/provenance keys | Dense response bytes, fixed DTO fields |
| Tile publication | One complete candidate/provenance pass | Whole-corpus atomic batch and retained snapshot bodies |
| Coverage tasks | Indexed latitude/longitude probe; one statement for 249 seeds | 4,096 ambiguous probe rows, explicit 503 on overflow |
| Prefecture / station metrics | In-memory spatial grid with exact distance | Approximate seed assignment, unassigned preserved |
| Duplicate review | REPORTS_DB proposal bbox plus DATA_DB canonical bbox | Dense neighbour fan-out must be bounded and disclosed |
| Cross-source review | Source-partitioned spherical cells, exact distance | Real overlapping different-source candidates can be numerous |
| Moderation / evidence | REPORTS_DB received/subject indexes; bounded pages and SQL aggregates | Queue sorts and evidence flags require representative measurement |
| Correction / absence review | REPORTS_DB groups and reviewer artifacts | Never auto-apply or weaken independent evidence |
| Redaction | Due-date index; bounded atomic report/counter/challenge passes | Schedule repeatedly until complete |
| Promotion export | Set-based releases/sources; each table read once; Map lookups | SQL output retained in host memory |
| Quality | Full-corpus aggregate passes; exact spherical KD nearest | Operational analysis, not request hot path |
| Bootstrap | Empty DATA_DB transactional import and re-export | Large import/trigger cost; REPORTS_DB untouched |

Indexes belong to their schema owner: canonical spatial lookup is in DATA migration 0026; received, proposal
and subject-evidence read paths are in `migrations-reports/`. No index changes source rights or identity.

Apple audit found bounded 3×3 tile retrieval, hash-set deduplication, O(n log n) ranking and one-pin duplicate
suggestions. Watch receives at most 500 candidates and shows top 3. Tile date mapping now reuses a formatter per
map and Watch reuses one source-ID set. Host formatter microbenchmark: 1k dates 114.29→19.68 ms, 10k 1,122.01→197.71 ms;
these are Foundation host timings, not full device decode/render timings. iPhone annotations still render all local
results, so dense-map rendering requires device profiling before rollout; no large UI rewrite is hidden here.

## Dense-tile follow-up design before publication

The measured medium corpus crosses the existing 250-spot reevaluation trigger even while gzip stays below 16 KiB.
A SQL tile literal also exceeds the currently documented D1 statement budget. Passing local bootstrap therefore
cannot authorize deployment of this bundle. Record both transport and SQL constraints in capacity review.

Evaluate z15 and z16 against the same dense-six-area corpus, including 3×3 nearby completeness/request counts,
p95/max raw/gzip bytes and payload decode. Increasing zoom requires a new ADR-0005 decision, schema migration,
shared TS/Swift vectors and a cache invalidation plan; this hardening change preserves z14 and full snapshot semantics.
A partitioned tile response would require negotiated pagination and atomic client replacement, so it cannot be an
unannounced v1 change. DTO payload reduction must preserve tier/freshness/access uncertainty and attribution.

For promotion, design a transaction-scoped staging buffer for bounded SQL fragments followed by one final validated
tile insert; completion must require staging emptied and all current row/hash/rights checks. Verify D1 support,
statement/row budgets, empty-target guards and rollback with a real local D1 test before adopting it. Such staging
must carry public sanitized tile content only. Never append into published tiles through non-atomic batches, and
never claim that chunked private-report transfer is an acceptable alternative. This design remains follow-up work;
the current full SQL export is a local artifact, and oversized statements are a deployment blocker.

### Resolution: bounded tile parts (Issue #158)

The zoom evaluation was run on the 50k corpus (`docs/research/2026-10-tile-delivery-scale.md`): z15/z16 reduce the
densest tile by only 1–7%, so z14 is kept and dense tiles are split into deterministic parts (≤ 44,000 body bytes,
≤ 250 spots, ≤ 16 KiB gzip each). The 50k publish now succeeds: 453 logical tiles, 1,087 parts, max 36 parts/tile,
max part 43,988 raw / 3,348 gzip bytes. Measure with `npm run scale:tiles -- --profile large` (local only).

v2/v3 promotion refuses multipart tiles. Segmented promotion v4 (#157) must: carry `tile_snapshot_parts` as an
ordinary bounded table (each row's body ≤ 44,000 bytes, so a quote-doubled literal stays ≤ 88,002 bytes); insert a
multipart head before its parts and never publish a schema-2 head without all parts at its revision; include the table
in the empty-target guards; and renumber its migration after `0028_bounded_tile_parts`.

## Bounded review commands

```sh
npm run local:reports -- pending --limit 100
npm run local:reports -- triage pending all --limit 100
npm run local:reports -- corrections --limit 20
npm run local:reports -- duplicates --limit 100
npm run local:reports -- evidence --limit 100
npm run local:reports -- effects --limit 100
npm run local:reports -- retain --limit 200
```

Pass the returned `nextCursor` as `--cursor` to continue. Triage orders explicit P0/P1/P2/P3 buckets then receipt
and report ID; items older than 14 days enter P0. Independent accepted conflicting negatives make confirmations
P0. The cursor binds filter, age snapshot, maximum inserted row and queue revision. New intake can continue while
a page traversal runs. Moderation or redaction changes invalidate that traversal explicitly; restart instead of
silently skipping or duplicating reprioritized items. A concurrent revision change during the read also fails.
Flag filtering is a filter of the selected bounded triage page, not a global cursor traversal.

Candidate groups are marked `pageLocal`; never treat a page as all corroborating evidence. Duplicate neighbour
lists cap at 200 each and expose truncation even when the retained bounding-box candidates lie outside 50 m.
Correction pages choose whole subject groups; groups exceeding 1,000 reports fail explicitly for separate review.
The quality correction count is complete SQL COUNT DISTINCT; its duplicate candidate count is unavailable with an
explicit diagnostic, since a bounded candidate page cannot honestly be labelled a nationwide total.
`retain` without flags drains bounded atomic passes; with flags it returns one resumable batch. Report redaction,
expired rate-window deletion and expired App Attest challenge deletion are all bounded, not only the report update.
