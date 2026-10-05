# REPORTS_DB 0003 import recovery

Production launch remains STOPPED. This runbook and tooling do not authorize a production write.
Resume requires separate maintainer authorization after review/landing. Never replay the failed
`migrations apply` command, delete/recreate the report store, DROP objects or run repair SQL.

## Observed state and parser investigation (2026-10-05)

Authenticated, read-only inspection of production REPORTS_DB
`e641b1df-8042-4522-8463-804c6ba57868` found exactly these migration records:

| Migration | applied_at (UTC) |
| --- | --- |
| 0001_report_store.sql | 2026-10-05 04:57:57 |
| 0002_scale_indexes.sql | 2026-10-05 04:57:57 |

0003 has no ledger row and none of its 3 tables, 1 index or 10 triggers exists. The complete
application schema matches the repository's 0001+0002 reference (SQL comments/formatting ignored,
quoted literal content preserved), and remote foreign_key_check is empty. No partial application
was observed. The observed bookkeeping table is `id INTEGER PRIMARY KEY AUTOINCREMENT`,
`name TEXT UNIQUE` (nullable), `applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL`.

Wrangler 4.135.0 builds a migration query by joining the untouched migration SQL with a ledger
INSERT, then uses the remote `/query` command path. The failed 0003 is 5679 bytes, 73 LF bytes,
zero CR bytes, ten uppercase BEGIN trigger bodies, and ends in `END;\n`. Its SHA-256 is
`17602d3af875ea3a346513b212a6e2ecbd34938eb10e656679de3039c701dc93`.
SQLite accepts the exact bytes, and Wrangler's client splitter yields 14 valid schema statements.

The strongest known match is [workers-sdk #4727](https://github.com/cloudflare/workers-sdk/issues/4727):
unparenthesized CASE..END inside a trigger is mistaken for the trigger END. 0003 has two such CASE
statements. [#15690](https://github.com/cloudflare/workers-sdk/issues/15690) also reports LF-only,
uppercase-BEGIN multi-statement `/query` failures. The CRLF explanation in
[#14991](https://github.com/cloudflare/workers-sdk/issues/14991) and lowercase-BEGIN explanation in
[#15314](https://github.com/cloudflare/workers-sdk/issues/15314) do not fit these bytes.
This points to the server-side trigger/statement parser; the exact server implementation and remote
import success have not been reproduced in this no-write investigation. Do not claim a confirmed
CASE-only root cause or that local validation proves remote acceptance.

## Repository-controlled artifact and guards

`npm run reports:migration -- prepare --out <new-file.sql>` is an offline dry-run: it writes
the exact 0003 repository bytes as a prefix, followed by one deterministic bookkeeping INSERT.
It refuses to overwrite an existing artifact or accept changed 0003 bytes/new migration streams.
The INSERT checks that the ledger contains exactly 0001 and 0002. On any mismatch its applied_at
is NULL, which violates the observed NOT NULL constraint and fails the atomic import. A duplicate
ledger name also fails UNIQUE. There are no BEGIN/COMMIT, DROP, altered triggers or repair statements
in the artifact. Existing 0003 objects fail CREATE rather than being reused.

The separately authorized remote application uses Wrangler's `d1 execute --remote --file` import
path, not `/query` for the write. [Cloudflare documents file-import rollback on failure](https://developers.cloudflare.com/d1/get-started/#5-deploy-your-application).
Schema and bookkeeping are in that same import. Review the whole artifact SHA-256 before applying.
Before writing, tooling checks the exact ledger, all report schema definitions, bookkeeping schema,
and FK state. Partial/applied/canonical/mismatched states are refused. It pins reviewed bytes in a
new private temporary file before invoking Wrangler, then verifies the complete schema and ledger.

Remote apply accepts only explicit production env, this REPORTS_DB ID and typed report-store name;
it refuses CI and noninteractive stdin/stdout before invoking Wrangler. There is no DB, staging,
arbitrary-migration, retry or force option. Post-failure investigation is read-only, never blind replay.
D1 rejects `PRAGMA integrity_check` with SQLITE_AUTH; remote checks report it unsupported, while
local verification requires integrity_check=ok. The supported remote foreign_key_check is required.

## Reviewed artifact and exact future steps

The LOCAL ONLY review artifact is `/tmp/mannerpath-reports-0003-workaround/0003-import.sql`:
5969 bytes, SHA-256 `1c12e525cbae283a8b18746a2069e5c02f45a100d4317a649a7bb51c8ec23195`.
It is not a tracked file and has not been applied remotely. With Node 24 on PATH, after
separate production authorization, run these commands one at a time from `services/api`:

```sh
npm run reports:migration -- verify-remote --env production --database-id e641b1df-8042-4522-8463-804c6ba57868 --confirm-production mannerpath-production-reports
npm run reports:migration -- apply-remote --env production --database-id e641b1df-8042-4522-8463-804c6ba57868 --confirm-production mannerpath-production-reports --file /tmp/mannerpath-reports-0003-workaround/0003-import.sql --expected-digest 1c12e525cbae283a8b18746a2069e5c02f45a100d4317a649a7bb51c8ec23195
npm run reports:migration -- verify-remote --env production --database-id e641b1df-8042-4522-8463-804c6ba57868 --confirm-production mannerpath-production-reports --completed true
npx wrangler d1 migrations list REPORTS_DB --env production --remote
```

Expect complete schema, exactly three ledger rows, empty FK check and no pending migrations.
If anything fails, stop without cleanup. Inspect ledger and schema read-only before deciding whether
the import failed atomically or completed despite a transport failure. Never reapply an applied migration.
Canonical promotion, Worker deploy and activation remain separate launch steps, not part of this tool.

## Local validation

Fresh isolated local D1: Wrangler migrations 0001+0002 → exact artifact file import (15 statements)
→ migrations list against the full report stream: no migrations to apply. `verify-local --completed true`
checks all schema definitions, ledger, integrity and foreign keys. Focused tests additionally cover
atomic rollback on bookkeeping failure, partial/drifted schema refusal, byte/digest tampering,
canonical target rejection, CI/noninteractive refusal and re-run refusal without mutation.

The equivalent SQLite file path is explicit for local tooling:
`npm run reports:migration -- apply-local --database <existing-0001+0002.sqlite> --file <artifact> --expected-digest <reviewed-sha256>`.
Use `verify-local --database <sqlite>` before apply and `verify-local --database <sqlite> --completed true`
afterward. Schema/record changes occur in one local transaction; this is simulation, not proof of remote import duration or acceptance.
