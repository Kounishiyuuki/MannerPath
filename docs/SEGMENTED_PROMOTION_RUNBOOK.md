# D1-safe segmented promotion v4

Issue #157, child of #67. This task executes **local SQLite simulation only**. No remote D1,
deployment, source approval or community activation is authorized here. #124 remains pending.

## Capacity policy

`services/api/scripts/promotion-v4-format.ts` defines `d1-capacity.v1`, checked 2026-10-02 against
[Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and
[batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/). File rollback behavior is
shown in the [official getting-started import example](https://developers.cloudflare.com/d1/get-started/).

| Official limit | Policy / consequence |
| --- | --- |
| SQL statement: 100,000 UTF-8 bytes | 90,000-byte budget, including SQL escaping; exporter uses strict less-than |
| String/BLOB/row: 2,000,000 bytes | A carried value must fit the smaller SQL budget; no oversized tile workaround |
| Bound parameters: 100 | File payloads bind zero; local source queries use at most two |
| SQL query: 30 seconds | A batch's **entire call** must also finish within 30 seconds |
| `d1 execute` import: 5 GB | Separate from the operational chunk byte budget |
| Batch | Statements execute sequentially as a transaction; failure rolls the batch back |

These are byte budgets, not character counts. Chunk size is an explicit build option until benchmark
results select an operational recommendation. Local timings cannot prove remote D1's 30-second bound.
Node >=24 is required for v4 SQLite row cursors; existing v2/v3 tools retain their existing runtime.

## Artifact and trust

`manifest.json`, `chunk-0001.sql` … `chunk-N.sql`, and `finalize.sql` are deterministic.
The manifest declares the bundle/policy versions, source and release identities, attribution, per-source
and total counts, tile fingerprints/revisions/counts, and each chunk's SHA-256, byte/statement counts,
ordinal and table counts. `wholeBundleSha256` hashes the recursively key-sorted unsigned manifest,
including every payload hash and the finalization hash. Keep this digest in the independent review record.
Review the manifest's source identities, counts, fingerprints, chunk budget and expected state.

Payload SQL is a deliberately restricted INSERT-only, literal-only grammar over the existing promotion
allowlist. Private reports, notes, submitters, App Attest, rate windows and moderation never travel.
Only applied sanitized community releases travel, subject to the unchanged registry/rights gates.

The writer iterates rows and checks their escaped UTF-8 size before constructing SQL, hashes while writing,
rotates chunks, and validates an independent disk-backed bootstrap with a bounded SQLite cache. It validates
one tile at a time. The manifest is written last; failure removes the partial output directory. A metadata
budget of 16 MiB bounds the manifest; excess metadata fails explicitly. A single declaration with too many
review dependencies also refuses rather than violating the statement budget.

Verification streams each SQL file, tracking quote state across reads. It checks hashes, byte budgets,
ordering, allowed tables/columns/literals, declared counts and the fixed finalization statement.
No corpus-wide SQL string is constructed by either path.

## Local commands

Run from `services/api` with Node >=24 on PATH. `--database` is an explicit filesystem SQLite path;
there is no network or Wrangler write path in this tool.

```sh
npm run promotion:v4:build -- --database /private/tmp/source.sqlite --dir /private/tmp/bundle-v4 --chunk-bytes 4194304
npm run promotion:v4:verify -- --dir /private/tmp/bundle-v4 --expected-digest <independently-reviewed-wholeBundleSha256>
npm run promotion:v4:apply-local -- --database /private/tmp/green.sqlite --dir /private/tmp/bundle-v4 --expected-digest <independently-reviewed-wholeBundleSha256>
```

Build requires a new output directory. Apply initializes real migrations only for a new target file;
existing targets must already be migrated. It preflights all files before changing the target. An open
target belongs to exactly one manifest; a different manifest refuses. Each chunk applies in one transaction
with its receipt. An exception rolls back the chunk. Previously completed chunks return `alreadyApplied`;
missing earlier chunks refuse an out-of-order apply. Re-running the command resumes from the ledger.
`nextUnappliedChunk` exposes the next ordinal; `--stop-after N` supports interruption simulations.

Finalization re-verifies the artifact, the target's manifest declarations, source/release identities, and
tile bodies against their SHA-256 and canonical rows. The existing v3 completion triggers re-check counts,
provenance, attribution, review/merge attestations and community evidence/rights, and seal canonical state.
The new DB gate also checks all declared chunk receipts/digests and expected tile metadata. Only then is
`promotion_v4_completions` inserted in the same finalization transaction. Replay returns `alreadyCompleted`
without canonical mutation. The SQL body still uses the v3 validation tables; this is deliberate reuse of
the unchanged validation/seal contract, not a v3 artifact mislabeled as safe.

All legacy empty-target guards also include the v4 ledger. Reusing the v3 validation header is authorized
only by a matching first-chunk session created and removed inside that chunk's transaction. A standalone
v2/v3 file cannot enter a staged v4 GREEN; a leftover session cannot receive a v4 completion marker.

SQLite/D1 provides no native SHA-256 function. The executor checks actual file and tile-body hashes;
the database verifies their manifest-bound declarations and receipts. As with v3, a consistently edited
artifact needs independent digest review: database constraints alone cannot authenticate it.

## GREEN, smoke and future remote procedure

An unfinished GREEN remains isolated. Resume it with the same reviewed manifest, or discard that GREEN.
Never switch DATA_DB while incomplete; REPORTS_DB is never switched or imported.
`GET /v1/readiness` requires completion and, for a segmented database, a matching v4 completion marker.
Remote smoke checks readiness first and refuses an unfinished GREEN. Only loopback smoke may accept an
unbootstrapped local pipeline database. No automated deployment/cutover executor exists in this repository;
the operator must make a successful GREEN readiness/smoke check a prerequisite to any binding change.

**Do not import the raw payload files directly with `wrangler d1 execute --file`.** Prepare a separate,
reviewable import plan locally. It contains a copied source manifest, `plan-manifest.json`, `initialize.sql`,
wrapped `chunk-0001.sql` … and `finalize.sql`. The plan pins the independently reviewed source digest and
hashes every transport file. Verification checks exact initialization/wrappers and also hashes the copied
payload subrange against the original source chunk digest. No remote connection is opened by either command.

```sh
npm run promotion:v4:prepare-import -- --dir /private/tmp/bundle-v4 --expected-digest <source-digest> --out /private/tmp/import-plan
npm run promotion:v4:verify-import-plan -- --dir /private/tmp/import-plan --expected-digest <source-digest> --expected-plan-digest <independently-reviewed-plan-digest>
```

The prepared files carry no BEGIN/COMMIT: D1 imports a file atomically, and rejects nested transaction
commands. Each wrapped chunk includes its own receipt and the first includes its temporary authorization.
Initialization also stores exact expected source/observation/attribution/count/review-dependency declarations
and every expected additive release. DB finalization compares these semantic declarations and exact sets
alongside the existing gates. Object key order does not affect JSON equality.

A **future maintainer session**, separately authorized for remote execution, may use the verified plan:

1. Address only a fresh GREEN by its database name, migrate it and import `initialize.sql` once.
2. Check `promotion_v4_manifests.manifest_sha256` equals the reviewed source digest. On resume, refuse a
   different digest; never re-import initialization over an existing ledger.
3. Read the next ordinal with the query below. Compare every existing receipt to its expected digest.
   A completed chunk is `alreadyApplied` and is skipped; never replay its SQL blindly. Direct replay fails
   atomically, as verified locally. Import exactly the next wrapped file; failure leaves the previous receipts.
4. Re-verify both reviewed artifact digests before finalization. GREEN remains isolated with no publisher,
   reconciliation or other canonical writer during staging. Verified payload bytes fix actual tile-body hashes;
   the DB checks their expected fingerprints, counts and provenance before inserting completion and sealing.
   The local executor additionally re-hashes the target bodies/canonical DTOs before finalization.
5. Import `finalize.sql` only when no chunk is missing. Then require readiness and smoke before DATA_DB cutover.
   Keep BLUE for rollback; REPORTS_DB is never touched.

```sql
SELECT min(e.ordinal) AS next_chunk
FROM promotion_v4_expected_chunks e
LEFT JOIN promotion_v4_applied_chunks a USING (ordinal)
WHERE a.ordinal IS NULL;
```

The maintainer command shape is `wrangler d1 execute <GREEN-database-name> --remote --file <verified-plan-file>`.
**It is not executed in this task.** Per-statement budgets apply to every generated control and payload statement;
local atomic-import tests do not establish remote duration. Check the 30-second query/batch constraints and
keep GREEN isolated after any failure. Neither a SQL receipt nor stored SHA metadata alone authenticates
arbitrarily edited remote data; the verified artifacts and isolated-writer protocol are required.

v2/v3 export and verification stay available for small existing deployments. They are not made D1-safe
for oversized nationwide tiles by this change. Oversized v4 tiles explicitly block bootstrap until the
independent scalable tile work produces a safe representation.
