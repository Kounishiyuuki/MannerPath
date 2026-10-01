# ADR-0014 — Durable community report store

- Status: **Accepted** (maintainer decision, 2026-10-01; option C "separate long-lived reports D1")
- Supersedes: the "reports live in the database being replaced" caveat of `docs/OPERATIONS.md` step 6 and the
  "production report path" open prerequisite of `docs/COMMUNITY_LAUNCH_CHECKLIST.md` A.
- Amends: ADR-0003 (backend: two D1 bindings), ADR-0007 (where reports, moderation and App Attest state live),
  ADR-0006/0012/0013 (community evidence reaches canonical data only as a reviewed sanitized artifact).
- Does **not** decide Issue #124 (terms, rights, community source approval). Those stay pending.

## Context

Canonical data ships blue/green: a promotion bundle bootstraps an empty database and the Worker's `DB` binding is
switched onto it (`docs/OPERATIONS.md` step 6), with the previous database kept for rollback. Until now user reports,
their moderation, App Attest keys and rate-limit windows were tables of that same database. Every cutover would
therefore have dropped the reports and keys written since the bundle was built, and a rollback would have rolled
report history back. That was the last engineering blocker of community launch.

## Decision

The Worker uses two D1 databases with separate responsibilities and separate lifecycles.

| | `DB` — canonical DATA_DB | `REPORTS_DB` — durable report store |
| --- | --- | --- |
| Holds | official source data, canonical spots, releases, provenance, tiles, promotion/bootstrap, the imported community artifact ledger and its sanitized evidence, community applications/holds/upgrades | reports (incl. note, pin, observation day, submitter hash), report terms consent, moderation, review decisions and their evidence links, App Attest keys and challenges, rate-limit windows, store identity |
| Lifecycle | **replaceable**: rebuilt from a promotion bundle; blue/green cutover switches it; rollback switches it back | **durable**: created once per environment, migrated in place, **never** switched by a cutover or a rollback |
| Migrations | `services/api/migrations/` (canonical stream, unchanged numbering) | `services/api/migrations-reports/` (own stream from `0001`, append-only, non-destructive) |
| Source of truth for | published spot state | raw reports and moderation history |
| Is **not** source of truth for | raw reports (it never holds any) | canonical/published spot state |

1. **Binding names.** `DB` keeps its name (no rename churn); `REPORTS_DB` is added in every environment with its own
   placeholder id (`…0001`, so local state never collides). `test/deploy-config.test.ts` fails if the two bindings
   ever name one database, share a migration stream, or the report store is named like a blue/green slot.
2. **Route ownership.** `POST /v1/reports`, `POST /v1/app-attest/challenges`, `POST /v1/app-attest/keys` use
   `REPORTS_DB` only. Tiles, spot detail and coverage tasks use `DB` only. `GET /v1/config` reads no database; it
   reports `reports.available = false` when the deployment has no `REPORTS_DB` binding. No request reads both.
3. **No cross-database keys or joins.** `spotId` in REPORTS_DB is an opaque reference. It is resolved against the
   current canonical identity only at import (below); a merged spot is refused with its successor named, so the
   reviewer re-reviews; it is never silently redirected. Operator tools may read both databases, never in one query.
4. **The boundary is an artifact.** A reviewer decides in REPORTS_DB (where submitter keys exist, so independence is
   judged there), and exporting the decision produces one **sanitized, deterministic evidence artifact**
   (`src/reports/evidence-artifact.ts`): canonical JSON, keys sorted, `contentSha256` over the canonical content,
   bound to `artifactSchemaVersion`, `reportStoreSchema`, review id, review key, `decisionVersion`, rule version,
   terms version and the independence attestation (`community-independence.v1`: evidence count, distinct submitters,
   and for a confirmation the base report ids, base count and count after). Per evidence report it carries only the
   report id, type/finding, subject spot, categorical claims, consent version, the **day** before which it may be used,
   and a pin only where the review adopts one (the new spot's location, a reviewed relocation).
   It never carries a note, submitter hash, observation date, receipt/minimization time, install or device data,
   App Attest material, free-text claims or moderation reasons. The same review state yields byte-identical bytes.
5. **Import is not application.** `importCommunityArtifact` (canonical side) verifies schema, digest and canonical
   encoding, records the artifact in the append-only `community_artifact_ledger`, stores its sanitized evidence rows,
   records the consented terms version's mirror row **from the reviewed list in code** (an artifact never carries
   rights), and creates the proposed application under the review's id, all in one batch. Applying, holding and
   upgrading stay the existing reviewed steps; migration 0025 re-points every guard that read `reports` to the
   sanitized evidence and the ledger.
6. **Replay protection (hard invariant).** Same bytes → `alreadyImported`, no write. Another digest for an imported
   review → `conflict`, refused. A decision version not newer than one imported for the same review key → `stale`,
   refused. A changed canonical premise (unknown/merged spot, a confirmation whose base is no longer the spot's own
   evidence) → `refused`, re-review. The ledger enforces the same in SQL (unique review id, unique (key, version),
   newer-only trigger, immutable, no delete). Imported evidence is never rewritten by later REPORTS_DB changes; a new
   judgement is a new artifact.
7. **Independence.** Submitter keys never leave REPORTS_DB. The canonical guards check the attested, digest-bound
   counts: `communityVerified` needs ≥ 2 evidence reports from as many distinct submitters; a hold the same; an upgrade
   needs the attested base to equal the spot's own evidence and the count after to exceed it. "count = 2" alone is
   never trusted: it is bound to the algorithm version, the review, the digest and the terms version.
8. **Privacy.** Raw content, keys and timestamps stay in REPORTS_DB, and 90-day minimization runs there
   (`runReportRetention`: bounded batches, idempotent, resumable). The canonical legacy report tables (0003, 0007,
   0021–0024) are kept, not dropped, and made inert: 0025 refuses every new row in them.
9. **Promotion.** A bundle never carries REPORTS_DB tables, the ledger or sanitized evidence; only the applied
   `userReport` releases travel (unchanged since 0021). A completion refuses a target holding ledger/evidence rows.
10. **Blue/green and rollback.** A cutover changes the `DB` binding only. A rollback restores the previous canonical
    database, so **published community state can roll back with its release; raw evidence and moderation history
    never do**. Reports keep arriving during a cutover as long as REPORTS_DB is healthy.
11. **Moderation location.** REPORTS_DB is the moderation source of truth; raw reports are not exported to a
    moderator's laptop. `npm run local:reports` stays local by default. `npm run reports:moderate -- --remote --env
    <staging|production> --database-id <uuid> [--confirm-production mannerpath-production-reports]` reaches a remote
    report store only with every flag, only from an interactive terminal outside CI, binds only `REPORTS_DB`, checks
    the store identity row first and never falls back. Canonical work always runs on the local pipeline database.

## Failure modes

| Failure | Behaviour |
| --- | --- |
| REPORTS_DB missing or failing | report/App Attest routes answer `503 reportStoreUnavailable`; tiles, spots, coverage keep serving; nothing falls back to `DB` |
| DATA_DB failing | canonical reads fail as reads; report intake continues (it never reads `DB`) |
| Artifact export fails | nothing exported, review stays proposed, no canonical change |
| Artifact import fails or is refused | one batch: no canonical change |
| Promotion fails | REPORTS_DB untouched; blue stays live |

## Consequences

- The community launch has no remaining engineering blocker of this kind; Issue #124 (legal/maintainer) remains.
- A new operational asset needs care: REPORTS_DB backup and recovery (`docs/OPERATIONS.md`, "Report store").
- Moderation tooling reads two databases; review is a two-step export/import with a file in between, by design.
- Pre-0025 local applications that rest on legacy in-database reports cannot be applied any more (fail closed);
  production never had any (no community launch).

Verification: `services/api/test/durable-report-store.test.ts` (route ownership, failure modes, artifact determinism
and privacy, digest/replay/stale/conflict, canonical premises, the BLUE/REPORTS/GREEN cutover and rollback with real
App Attest devices, promotion exclusion, retention batching, remote guards, #124 still blocked).
