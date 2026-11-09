# Cloudflare production preflight — local evidence review

This is **not deployment, Cron activation, intake/publication approval, or live-state verification**.
`npm run production:preflight` reads local files only. It performs no HTTP request, Wrangler invocation,
SQL, file write, secret retrieval, backup, migration or deploy. It deliberately does not call the
`production:v1-check` CLI: that existing staged check can send conditional closed-intake POST probes.

This tool is scoped to a **same-DB Worker rollout**: the currently active binding and candidate must both
match the reviewed target. It cannot pre-approve a BLUE→GREEN rebinding while the old Worker still uses BLUE.
That prospective cutover stays entirely in Lane 3's promotion runbook; re-run this check for the new settled
target only after a separately authorized cutover. A cutover mismatch here is expected, not permission to flip.

For operator commands, permissions, HTTP403 diagnosis and STOP gates, use the
[administrator read-only procedure](PRODUCTION_ADMIN_GATE_PROCEDURE.md). Unknown evidence remains UNVERIFIED.

## Responsibilities and existing tools

| Check | Local tool | Administrator evidence / production-operation boundary |
| --- | --- | --- |
| Candidate v1 Worker/vars | Reuse `productionConfig()`; require paused registration, required attestation, no App ID/pepper values in vars, no photo/R2 source binding | Confirm actual account, Worker and deployed vars at operation time; local generated config is not deployed state |
| DB versus REPORTS_DB | Compare candidate ID/name/stream and observed active-version D1 IDs to an **independently reviewed target file** | Use the existing [ID-preserving promotion runbook](ID_PRESERVING_PROMOTION_RUNBOOK.md) for DB identity, schema, backup, BLUE/GREEN and preserved REPORTS_DB; never derive both expectations and observations from one config |
| Migration | Reuse exact 11-file approval/SHA checks from `production-v1-check`; before-migration expects the historical reviewed pending set, before-deploy expects none | Read each exact database's existing ledger with SELECT and compare with local migration filenames. Do not use `d1 migrations list` in a strictly read-only session: pinned Wrangler initializes its ledger with CREATE TABLE IF NOT EXISTS. Verify schema/history/integrity; an empty pending set does not prove successful recovery or unchanged applied SQL |
| Secrets | Accept only a list of names; both existing peppers must be present before-deploy and App ID absent | Existing `wrangler secret list` names only. Do not obtain, print, copy or persist values; existence does not prove correctness and peppers must not be regenerated here |
| Readiness | Check recorded GET status/state plus administrator-correlated version and DB identity | `/v1/readiness` does not return DB ID or version. Correlate these through active deployment metadata; GET alone cannot establish D1 identity or prove a future candidate works |
| Cron | Separate recorded current triggers from proposed retention Cron | Read actual trigger settings separately: Cron is not versioned with Worker code. Keep the five-minute proposal **unapproved** until CPU, D1/account usage, frequency/backlog, plan/cost ceiling and monitor/stop criteria reviews are recorded |
| Recovery | Require references to backup/GREEN and explicit rollback-version/trigger-order review | Refer to the existing runbook and [v1 intake §6](V1_PRODUCTION_INTAKE.md); do not create another backup/cutover/restore implementation |

The current REPORTS_DB recovery prerequisite in `services/api/REPORTS_MIGRATION_RECOVERY.md` remains
independent and blocking until its administrator review completes. This preflight cannot waive it.
For Cron alternatives, measurements and pricing/monitoring decisions use
[V1_RETENTION_CAPACITY §6](V1_RETENTION_CAPACITY.md). A literal five-minute expression or local rehearsal
PASS is not approval. No measurements, monetary caps, responsible person or backup bookmarks are fabricated.

## Local invocation

Run from `services/api`, Node24. First record the clean reviewed commit with `git rev-parse HEAD`.

```sh
npm run production:preflight -- --stage before-deploy --commit <reviewed-40-hex-commit>
```

Without remote evidence, expected result is `UNVERIFIED` (exit3), **not** PASS. The output includes a
`candidateSha256` for the generated candidate at this checkout path. It writes no generated config.
Use `before-migration` only for the already reviewed 0031–0033 /0004–0011 pending set; it is not a
general approval for new migrations. If new migrations appear, stop for a new review rather than expanding
that list. Both stages independently check the committed migration review bytes. Missing peppers before-migration are
deferred/unverified, not a request to create secrets early; before-deploy they are a failure.

When an authorized administrator has obtained and reviewed the non-secret metadata, provide two local
files kept outside Git:

```sh
npm run production:preflight -- --stage before-deploy --commit <reviewed-commit> \
  --expected-target /private/expected-target.json --evidence /private/preflight-evidence.json
```

- Target schema (`targetSchema` in `scripts/cloudflare-production-preflight.ts`): `worker`,
  `accountReviewRef`, `DB` and `REPORTS_DB` objects (`id`, `name`), `currentCrons`, `reviewedBy`, `reviewedAt`.
  Independently identify both databases and their account. Current IDs are pinned by existing
  `test/deploy-config.test.ts`; an approved BLUE/GREEN successor needs its own reviewed target/config.
- Evidence schema (`evidenceSchema`): `observedAt`, `gitCommit`, `configSha256`, SHA256 of the **exact target
  file bytes** as `targetSha256`, `worker`, `versionId`, `activeVersionIds`, `bindings` (`binding`,`id`),
  `secretNames`, `pending` (`DB`, `REPORTS_DB`), `deployedCrons`, `proposedCron`, `reviewedBy`;
  `configGet` (`status`, `reportsAvailable`, `photoEvidenceEnabled`);
  `readinessGet` (`status`, `state`, administrator-correlated `versionId`, `databaseId`);
  `gates` has these eight required keys with either a review-record reference or **null**:
  `migrationIntegrity`, `backupAndGreenRunbook`, `rollbackVersionAndTriggerOrder`, `workerCpu`,
  `d1AccountUsage`, `frequencyAndBacklog`, `planAndCostCeiling`, `monitorOwnerAndStopCriteria`.
- Unknown administrator decisions stay null. Observations expire after15minutes; future observations,
  different commits/configs/targets, multiple active versions, swapped/staging/duplicate bindings and
  mismatched pending lists fail. A different snapshot/checkout requires new evidence and review.
- Strict schemas reject raw API responses and secret-value fields. Do not feed raw Worker settings,
  authorization headers, signed URLs, secret-list/version response dumps or private reports into this tool.
  Schema failures print no source content or paths. Secret values must never be collected for this task.

Exit1=`FAIL`, exit3=`UNVERIFIED`, exit0=`REVIEW_COMPLETE`. The last means only that these **administrator
assertions** are internally consistent and all review references are supplied. References are not signed,
verified measurements or a legal/operational authorization. The CLI does not discover HEAD, dirty state,
account, live bindings, schema or triggers; the administrator must independently verify those facts and
recheck them at the actual operation. `deploymentAuthorized` is always false. Do not use this exit code as
an automatic deploy/migration/Cron or intake/publication gate that grants permission.

## After separately authorized production operations

Recheck actual version/bindings and both migration streams, GET readiness/config, actual Triggers and
retention outcomes using the existing stage checks/runbooks. A pre-deploy observation of the old Worker
cannot verify the new version. CPU/1102, D1 read/write volume, backlog, costs and the responsible operator
remain live checks. No such operation or production measurement is performed by this PR.
