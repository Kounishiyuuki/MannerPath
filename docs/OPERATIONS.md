# Beta operations runbook — staging / production-like backend

For nationwide segmented bootstrap, use [promotion v4](SEGMENTED_PROMOTION_RUNBOOK.md).

## Disabled private photo foundation (#147)

No photo R2 bucket, binding, scheduler or deploy is created by this change. `photoEvidenceEnabled`
remains false and the production attachment route refuses requests. #124 remains unapproved. Do not
enable intake using current draft consent. ADR-0016 records the future review/activation prerequisites.

Photo references are in `REPORTS_DB` migration `0003_evidence_photos.sql`; never apply it to canonical DB.
`applyReportRetention`/`runReportRetention` accept an injected `photoStorage` and run bounded
`cleanupEvidencePhotos` before returning; existing local retention remains available without storage.
Photos inherit `reports.minimize_after` (90 days from report receipt), not upload time. Reservations
abandoned after 15 minutes, rejected images, redacted/erased parents and expired images enqueue cleanup.
Failed deletion keeps a durable key for retry. No original metadata is retained, no EXIF-derived location
is used, and only sanitized derivatives may be stored; private moderation must review visible PII.

Local-only reviewer commands are `npm run local:reports -- photo-summary <reportId>` and
`npm run local:reports -- photo-decide <photoId> <approved|rejected> <reviewer> <reason>`.
Reasons are `usableEvidence`, `privacyRisk`, `unrelated`, `unsafeContent`, `insufficientDetail`.
Decisions record bounded reviewer/time/reason fields, with no free text; rejection queues deletion.
Approved-photo counts never change report acceptance, independence or reconciliation/publication gates.

Before any later production intake: implement and verify a private object-storage adapter whose delete
durably fences in-flight/future puts to the same key. A naive R2 `delete` is insufficient: a delayed put
could recreate an orphan after the cleanup row is removed. Supply enforced object expiry at the report
deadline, a bounded scheduler and deletion-error alerts; include backup/version retention in the ceiling.
Wire that storage into every erase/retention workflow and exercise failure/recovery. Review photo consent
and rights separately, test real-device App Attest transport, and measure decoder CPU/memory on the
intended Workers plan. There is no production adapter in this foundation. Never publish a photo through
tiles or treat an ashtray photo as proof of permission to smoke.
V2/v3 remain available; their whole-file transaction procedure below does not apply to v4 payloads.
Before a DATA_DB binding cutover, GREEN must pass `/v1/readiness` and remote smoke. An unfinished
segmented GREEN is never eligible; REPORTS_DB is never switched. V4 import-plan tools generate and verify atomic chunk/receipt wrappers locally; remote execution remains
a separate maintainer action with duration checks, and is forbidden in this task.


How a maintainer stands up, verifies, and disables a staging or production-like MannerPath API.

**Nothing in this repository performs any of it.** Every command in the "Remote" sections is typed
deliberately by a maintainer against an account they own. The committed configuration cannot reach a
real database: every `database_id` in `services/api/wrangler.jsonc` is the all-zero placeholder, so a
`deploy` or `--remote` command fails until the maintainer creates the database and lands the real ID
in a reviewed change (`services/AGENTS.md`, enforced by `services/api/test/deploy-config.test.ts`).

Scope: Cloudflare Workers + D1 (ADR-0003), the `/v1` surface in `API.md`. This is a beta operations
document, not an App Store release or a production launch plan.

Remote D1 writes, deploys and cutovers below are explicit production operations; a development task never runs them
on its own initiative (`docs/SPECIFICATION.md` §19).

## Local vs. remote

Two vocabularies, deliberately not mixed.

| Guaranteed local — safe to run at any time | What it touches |
| --- | --- |
| `npm test`, `npm run typecheck` | Nothing outside the repository |
| `npm run local:migrate` | `.wrangler/state` local D1 |
| `npm run local:registry`, `npm run local:pipeline` | `.wrangler/state` local D1 |
| `npm run local:reports:migrate` | `.wrangler/state` local REPORTS_DB (report store, ADR-0014) |
| `npm run local:reports`, `npm run local:reports:redact` | local REPORTS_DB, plus the local canonical D1 for artifact import/apply |
| `npm run dev` (`wrangler dev --local`) | Local Worker on `127.0.0.1:8787` |
| `npm run local:smoke` | HTTP GETs against `127.0.0.1:8787` |
| `npm run local:export` | Reads `.wrangler/state` local D1; writes a file only when asked |
| `npm run local:verify-promotion` | Reads one local bundle file; opens no database |

Every one of these carries `local` in its name or runs entirely in-process. None accepts a remote
target; `local:pipeline`, `local:registry` and `local:export` open their binding with
`remoteBindings: false`, so they cannot reach a remote database even if asked to.

| Explicitly remote — only the maintainer runs these | Guard |
| --- | --- |
| `npx wrangler d1 create …` | Typed by hand; creates the database |
| `npx wrangler d1 migrations apply DB --env staging --remote` | Needs `--remote` **and** a real `database_id` |
| `npx wrangler secret put … --env staging` | Interactive; value never in the repository |
| `npx wrangler d1 execute DB --env staging --remote --file promotion.sql` | Needs `--remote`, a real `database_id`, and a bundle a human reviewed. Targets an empty, freshly migrated database only — the binding form is the first promotion; a later (green) database is addressed by name (step 6) |
| `npx wrangler deploy --env staging` | Needs a real `database_id` |
| `node --experimental-strip-types --no-warnings scripts/smoke.ts --base-url https://… --remote` | Refuses a non-loopback target without `--remote`, and refuses non-HTTPS |
| `npx wrangler delete --env staging` | Typed by hand; the disable step |
| `npm run e2e:config -- --suffix <s> --database-id <uuid>` | Writes a git-ignored config only; runs nothing remote. See "Disposable App Attest E2E environment" |
| `npx wrangler d1 migrations apply REPORTS_DB --env staging --remote` | Needs `--remote` and a real REPORTS_DB `database_id`. In-place, append-only; the report store is never rebuilt |
| `npm run reports:moderate -- --remote --env <env> --database-id <uuid> …` | Refuses without every flag, outside an interactive terminal, or in CI; production also needs `--confirm-production mannerpath-production-reports`; binds only REPORTS_DB; no fallback (ADR-0014) |

`scripts/smoke.ts` defaults to `http://127.0.0.1:8787` and **refuses** any non-loopback host unless
both `--base-url` and `--remote` are given. It sends only GETs plus one deliberately invalid
`POST /v1/reports` (a `{}` body), which fails validation and stores nothing, so it is read-only
against canonical data on whatever it points at.

## Sequence

Run in order. Each step is verifiable before the next.

Steps 1–5 bootstrap an environment. Data changes after that are **blue/green** (step 6): the
promotion bundle is INSERT-only and targets an empty database, so corrected data means a new D1
database that the Worker is switched onto, with the previous one kept for rollback. Nothing in this
runbook updates a populated remote database in place, and this PR adds no code that could.

### 1. Create / configure

```sh
npx wrangler d1 create mannerpath-staging
```

Put the returned ID into the `staging` environment's `database_id` in
`services/api/wrangler.jsonc` and open a PR: the ID is not a secret, but it is the single thing that
makes remote commands possible, so it lands under review. `test/deploy-config.test.ts` asserts the
placeholder, so filling in a real ID makes that test fail. That is deliberate: no remote target can
appear in the repository without someone consciously relaxing the guard for that one environment in
the same reviewed PR, and saying there which account owns the database.

Then set the one secret the service needs:

```sh
npx wrangler secret put REPORT_SUBMITTER_PEPPER --env staging   # 32+ random bytes, never committed
```

`REPORT_ATTESTATION` is **`required`** in the committed `staging` and `production` environments.
On its own that makes the report endpoint fail closed; it starts enforcing App Attest only once the
two App Attest values are set (see "Report attestation" below). Leave `required` as it is. No other
secret exists.

### 2. Migrate

```sh
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler d1 migrations list DB --env staging --remote      # expect: no pending migrations
# The durable report store (ADR-0014): its own database and stream, created ONCE per environment.
npx wrangler d1 create mannerpath-staging-reports              # first time only; its id lands by reviewed PR
npx wrangler d1 migrations apply REPORTS_DB --env staging --remote
npx wrangler d1 migrations list REPORTS_DB --env staging --remote
```

`DB` (canonical, replaceable) and `REPORTS_DB` (reports, moderation, App Attest, rate limits; durable) never share a
database or a migration stream; `test/deploy-config.test.ts` enforces it.

Migrations are append-only numbered files; an applied migration is never edited
(`services/AGENTS.md`).

### 3. Apply the reviewed source registry

Only sources approved in `SOURCES.md` and present in `REVIEWED_SOURCES`
(`services/api/src/pipeline/registry.ts`) can be registered at all; anything else throws. Approving a
source is a repository change, reviewed in a PR — never a console action against a database.

The registry row for the promoted release travels inside the promotion bundle built in step 4, with
its reviewed display name, licence and attribution text. There is no remote registry command, and
`local:registry` stays local.

### 4. Ingest → resolve → publish, then build the promotion bundle

Publishing happens locally, against a database you can inspect and re-run:

```sh
npm run local:migrate
npm run local:registry     # only when an existing local row predates an approval
npm run local:pipeline     # ingest -> resolve -> publish; read the published/excluded counts
```

A source listed under `excluded` is not a failure to work around: it is the publication gate doing
its job.

**Cross-source review and merge** (ADR-0008 "Amendment — cross-source review and merge", migration 0019,
Issue #107) happens here, locally, between publishing and exporting, and only on a database that runs the
pipeline for several sources. There is no operator CLI yet: `generateCrossSourceCandidates`,
`recordCrossSourceDecision` and `applyCrossSourceMerge` (`src/pipeline/cross-source.ts`) are called from a
reviewed local script or test. Candidates are recall only; a merge needs a recorded `sameRealWorldSpot`
decision with identity evidence and an explicit survivor. After applying merges run `npm run local:pipeline`'s
publish step (`publishTiles`) again before exporting: until then a merged or held spot's membership no longer
matches its tile body and the export refuses. A survivor whose values conflict with its loser's stays
unpublished (held); that is the intended conservative outcome, not a failure. A database with applied merges
exports only with `--bundle v3` (a v2 export refuses it), and the v3 bundle carries the merges as
attestations together with every involved spot and its evidence.

Then generate the **promotion bundle** — the reviewable artifact that carries that validated local
state to another database:

```sh
npm run local:export                                  # validate + print the manifest, write nothing
npm run local:export -- --out promotion.sql           # write the artifact
npm run local:export -- --release 1 --out promotion.sql
# several reviewed sources in ONE all-or-nothing bundle (promotion-bundle.v3, migration 0018):
npm run local:export -- --bundle v3 --out promotion.sql                           # every source's current release
npm run local:export -- --bundle v3 --release 1 --release 2 --out promotion.sql   # an explicit set
```

**The additive community source in v3** (migration 0021, Issue #124). Once `mannerpath-community-reports`
is approved in the reviewed registry, `--bundle v3` without `--release` also carries every applied community
release (it has no current one), declared as additive releases; its published spots must rest on a granted
report terms version, whose row travels with them. The target then needs migrations through 0021. While the
source is blocked, nothing about the bundle changes.

**Several sources: `promotion-bundle.v3`.** A v2 bundle carries one release, and on a database whose
tiles also publish another source it is refused ("draw existence evidence from another release") —
there is no partial promotion. A v3 bundle (`buildMultiSourcePromotionBundle`) carries the current
release of every named source. Its first statements are `promotion_multi_bootstraps` (bundle version,
source count, bundle-wide row counts) and one `promotion_multi_bootstrap_sources` declaration per
source, written before any data row: release id and fingerprint, display name / license / attribution
identity, that source's own row counts and the previous-release dependencies of its attestations. Its
last statement, `promotion_multi_bootstrap_completions`, re-checks every declaration on the target.
One source's fingerprint mismatch, missing row, attestation mismatch or non-approved status fails the
whole file (D1 applies it as one transaction). The export refuses the same way: every source must pass
every v2 check. Field provenance and attenuations must come from a release of a source the spot is
linked to (exporter and target both check), and a record decision or attestation can name only an
entity of its own source. Everything else below applies to both versions; v2 is unchanged.

The bundle is deterministic SQL (`services/api/src/pipeline/promotion.ts`):

- a header naming the generator, the release, its source, every tile with its revision, spot count
  and content hash, and a `contentSha256` over the statement block, so a reviewed bundle is
  identifiable by one value;
- a first statement, `promotion_bootstraps` (migration 0016), naming the bundle version
  (`promotion-bundle.v2`), the release and its fingerprint, the prior-release fingerprints cited by
  reviewed decisions, and the declared row count per table; the
  target refuses it unless it is empty;
- `INSERT` statements in foreign-key-safe order for `sources`, `source_releases`, `source_records`,
  `source_record_match_keys`, `source_entities`, `promotion_review_match_attestations`,
  `source_record_entities`, `spots`, `spot_source_entities`, `spot_field_provenance`,
  `spot_field_attenuations`, `tile_snapshots`, `tile_snapshot_spots` — fixed table, column and row
  order and fixed literal formatting, so two runs over the same state produce byte-identical files and
  two bundles can be diffed;
- a last statement, `promotion_bootstrap_completions`, whose trigger re-checks on the target that it
  holds exactly the declared source, the declared release as its current applied release, every
  declared row count, the declared prior-release dependencies, and a decision for every attested record;
- opaque spot IDs, tile revisions, content hashes, attribution and field provenance verbatim: the
  receiving database gets the same published bytes, not a re-derivation.

`source_observations` (ADR-0008 decision 2) is not in the bundle: it is derived data, re-derivable
from the `source_records` that are, and the canonical rows it produced travel as themselves.
`review_items` / `review_decisions` / `review_match_applications` (ADR-0008 decision 8) are not in the
bundle either: they are review state of the database that ran the pipeline. What the carried rows do
depend on is the **applied reviewed identity decision** of a record (`matchedToEntity`, a `manual`
link, and `confirmedNew`, Issue #86): for each, the bundle carries one
`promotion_review_match_attestations` row — decision, chosen entity, candidates, previous release id
and fingerprint, matcher, reviewer, decision time and version, executor version and application
time, and the origin item/decision/application ids as provenance. The target accepts a `manual` link
only with that row (migration 0016). That is not the same strength of evidence as the pipeline
database's application (0011): there the schema re-checks the latest decision, the previous release,
the candidate entities and the active spot link against rows it holds, while the target can check the
attestation only for internal consistency with the bundle and trusts the reviewed artifact (its
externally verified `contentSha256`) for the rest. The attestation path exists only while a bundle is
being applied: an open bootstrap refuses any other source or release, release updates, observations and
review rows, and an attestation needs the single declared applied release with no review, decision,
spot or tile row yet — so a pipeline database, even one with a hand-inserted bootstrap row, cannot use it.
Relocation holds / applications / resolutions stay out too: a relocated spot
travels as its canonical row at the new coordinate on the new release's evidence, and the move's
audit stays in the database that applied it (ADR-0008 decision 7, ADR-0009).
`review_removal_applications` (ADR-0008 decision 5, Issue #84) is review state too and stays out of
the bundle; a removed spot travels only as its canonical row with `lifecycle = 'removed'`, and the
audit link to its review decision stays in the database that applied it. Run `publishTiles` after
`applyReviewedRemoval` and before exporting. Until then the spot's snapshot membership no longer
matches its stored tile body, and `buildPromotionBundle` (`npm run local:export`) refuses the export
with `snapshot membership does not match the body` (tested in `test/review-removal.test.ts`), so a
crash or a forgotten republish cannot reach a remote promotion.

The origin review IDs, `decided_by`, decision time and previous-release fingerprint in an
attestation are audit metadata certified by the reviewed promotion artifact. The target does not
have the origin review history and cannot independently authenticate those values. In particular,
`confirmedNew` has `method = 'new'` like an automatic new record, so its attestation and the
externally reviewed artifact hash prove that distinction.

`spot_field_attenuations` carries the rows behind every **weakened** field of a published spot
(ADR-0006, Issue #42): which field was attenuated and how, under which attestation version, from
which reviewed conflict reference, when that reference was read, and the fingerprint of the source
release the decision was reviewed against. It travels with the bundle because the weakened canonical
value travels with it. Without those rows the receiving database would hold a value that is weaker
than its source record with nothing recording why, its `GET /spots/{id}` would publish the attenuated
field's source provenance as if that were the evidence for the value, and its
`npm run local:quality` would fail the `…-list-page-conflicts-resolved-conservatively` check. Like
the published spots, only the attenuations of **published** spots are carried: a spot the
reconciliation withholds is not in the bundle at all.

It carries **no report data** (`reports*` tables never leave a database this way, ADR-0007), no
secret, and no `d1_migrations` rows — the receiver runs the real migrations first.

The export **refuses** rather than emitting a partial or unapproved bundle when: the release is not
`applied`; its source is not `approved`, is absent from `REVIEWED_SOURCES`, or its row has drifted
from the reviewed registry entry (including attribution); nothing is published; a published spot is
merged, inactive or in another tile; a published spot's existence evidence comes from a release the
bundle does not carry; provenance points at evidence outside the release; a stored tile body does
not match its content hash, its schema, its membership or its spot count, or a spot in it does not
match its canonical row (a tile published before the release was applied: run `publishTiles` after the
resolver, then export); or a tile cites a source whose attribution is missing. `test/promotion.test.ts`
covers these.

A release with reviewed matches, including every relocated release (ADR-0009), exports and applies to a
fresh database (Issue #100, `test/promotion-reviewed-bootstrap.test.ts`,
`test/relocation-tile-promotion-e2e.test.ts`). The export also refuses a release that is not its
source's current one, and a reviewed link without its applied decision.

**The bundle is a bootstrap artifact, not an update.** It is INSERT-only, and its target is an
**empty database migrated through 0016** (a v2 bundle does not apply to an older schema; a v3 bundle needs
0018). It cannot
modify an already-populated remote D1: its first statement refuses any database that is not empty,
before anything is written. "Empty" is checked table by table over **every** table of migrations
0001–0018 — source, canonical, attenuation, tile, review / removal / relocation, promotion (v2 and v3),
source refresh (0017), and the
application tables that hang off no canonical row (`reports`, `report_moderation`,
`report_rate_windows`, `app_attest_keys`, `app_attest_challenges`) — so a database that ever served
reports or App Attest is refused too (`test/promotion-empty-target.test.ts`). This slice adds no remote upsert or update path, and none should be
improvised at the console. Corrected or new data ships through the blue/green procedure in step 6.

After the completion row is inserted, migration 0016 seals the promoted source, evidence,
identity, canonical, provenance and tile tables against INSERT, UPDATE and DELETE. It also closes
`source_observations`, which are derived from promoted records but not carried in the bundle.
Normal runtime data stays writable: reports, moderation, rate windows and App Attest keys and
challenges are outside the seal. A later publication needs a fresh target and another promotion.
Migration 0018 seals the same tables after a v3 completion. The source refresh tables (0017) are
refused while a v3 bootstrap is open and must be empty at its completion, and stay writable after it:
promote first, then enable checks.

**Atomicity.** The bundle contains no `BEGIN` / `COMMIT`: D1 refuses transaction statements in SQL and
runs a `wrangler d1 execute --remote --file` import as one transaction itself (wrangler: "if the
execution fails to complete, your DB will return to its original state"; the D1 import docs require
`BEGIN TRANSACTION` / `COMMIT` to be removed). Any failing statement — a tampered row, a missing
attestation, the completion check — therefore leaves the target empty; the tests model this apply
(`applyPromotionBundle` in `test/support/sqlite-d1.ts`) and fix the rollback. Local `wrangler d1
execute --file` (no `--remote`) runs the statements as one D1 batch, also one transaction. The remote
rollback is the platform's behaviour and has not been exercised against a real D1 from this repository.
Operationally, **treat a target whose apply failed as discarded**: delete it and create a new database
rather than retrying into it or switching a binding to it, whatever state it reports.

Applying it is a separate human step, and the only step that writes to a remote database. The
binding form below is for the **first** promotion into a freshly created environment, where the
environment's `database_id` is already the database being bootstrapped. Every later promotion goes
through step 6 and addresses the new database **by name**, because `--env staging` would then resolve
to the live one:

```sh
npx wrangler d1 migrations apply DB --env staging --remote    # a fresh, empty database
npm run local:verify-promotion -- --file promotion.sql --expected-content-sha256 <hash from the review record>
npx wrangler d1 execute DB --env staging --remote --file promotion.sql
```

**What the database checks, and what only the verifier can.** The receiving database does not trust
the file: foreign keys, the append-only and review-link triggers, the ADR-0006 publication invariant on
every `tile_snapshot_spots` row and the completion check all run during the apply, so an inconsistent
or incomplete bundle is rejected there as well as by the export. What it cannot detect is a
**consistent** edit of the file's own declarations — for example dropping a `confirmedNew` attestation
*and* its declared count *and* its declared dependency. The previous release and the origin review
queue deliberately do not travel (they are not part of the bootstrapped state), so nothing in the
target can contradict such an edit, and no trigger is meant to. The authenticity of the file is the
job of a separate step before apply.

**The trusted hash comes from outside the file.** The header's `contentSha256` is written by whoever
wrote the file: someone who edits the body can recompute it, and a file checked only against its own
header proves only that it agrees with itself — that is not a trust boundary. The manifest that
`local:export` prints is produced in the same run as the SQL and is no more independent. The expected
hash must be taken from a **reviewed record kept apart from the SQL file**: the PR or change record in
which the reviewer approved this bundle and wrote down its `contentSha256`. The procedure is:

1. **Export** — `npm run local:export -- --out promotion-<release>-<date>.sql`.
2. **Review** — the reviewer reads the file (release, row counts, tiles, attestations).
3. **Record** — the reviewer writes the file's `contentSha256` into the reviewed PR / change record.
4. **Verify** immediately before apply, with the hash copied from that record, never from the file:
   `npm run local:verify-promotion -- --file promotion-<release>-<date>.sql --expected-content-sha256 <recorded hash>`.
   It recomputes the SHA-256 of the statement block (exactly the bytes the exporter hashed) and exits 0
   only when it equals both the header's hash and the recorded one; a mismatch, a malformed or missing
   header, executable content in the unhashed header, or a malformed expected hash exits non-zero.
   The header may contain only SQL comments and blank lines. There is no mode that trusts the header alone.
5. **Apply** only that same verified file, by name (step 6).
6. **Discard** a target whose apply failed (above); never re-apply into it.

`test/verify-promotion.test.ts` and the coordinated-tamper case in
`test/promotion-reviewed-bootstrap.test.ts` fix this: a bundle with a `confirmedNew` attestation, its
count and its dependency removed *and* its header hash recomputed still applies to an empty database,
and is refused by the verifier against the recorded hash.

### 5. Smoke verify

```sh
node --experimental-strip-types --no-warnings scripts/smoke.ts \
  --base-url https://<worker-host> --remote --tile 14/14553/6450
```

It prints one line per check and exits non-zero if any fails:

| Check | What must hold |
| --- | --- |
| `config` | `GET /v1/config` → `200`, body valid, `dataTileZoom` matches the server's `DATA_TILE_ZOOM`, and every resource's `minimumSupportedSchemaVersions` ≤ `schemaVersions` |
| `tile 200` | `GET /v1/tiles/{z}/{x}/{y}` → `200`, body valid against the tile schema, its `schemaVersion` inside the range `/v1/config` advertises for tiles, `ETag` present |
| `tile 304` | The same request with `If-None-Match: <etag>` → `304`, same `ETag` |
| `tileNotPublished 404` | A valid z14 tile with no snapshot → `404 {"error":"tileNotPublished"}` |
| `spot detail` | `GET /v1/spots/{id}` for a spot in that tile → `200`, valid, same ID, `schemaVersion` inside the advertised spot-detail range |
| `attribution` | Every source behind a published spot has non-empty `attributionText`, and the detail endpoint's source entry is byte-identical to the tile's |
| `report endpoint configuration` | The report gate agrees with `/v1/config`: `400 invalidReport` when `reports.available` is true, `503 attestationUnavailable` when it is false. Never `201`. On staging/production `reports.available` stays `false` (and `503` is the expected pass) until the App Attest values are configured |

The attribution check is a licence check, not a cosmetic one: publishing a spot without its source's
approved attribution violates the source licence (`DATA_POLICY.md`).

### 6. Ship corrected or new data: blue/green D1 promotion

There is no in-place remote data update. A promotion bundle bootstraps an empty database (step 4),
so a corrected tile, a new release or a fixed attribution ships as a **new database that the Worker
is switched onto** — blue/green — not as an edit of the live one.

Re-publish locally first (`npm run local:pipeline`), regenerate the bundle
(`npm run local:export -- --out promotion-<release>-<date>.sql`) and review it. Then:

**Until the reviewed cut-over in step 5, the `staging` binding still points at blue, and every
command that resolves through it reaches blue.** So `--env staging` must not be used to prepare
green: `npx wrangler d1 migrations apply DB --env staging --remote` and
`npx wrangler d1 execute DB --env staging --remote …` would migrate and write to the **live**
database. Address green by its own unique database name instead, which cannot resolve to blue.

```sh
# 1. Create the new (green) database. Blue stays live and untouched, and the `staging` binding
#    keeps pointing at it until step 5.
npx wrangler d1 create mannerpath-staging-2

# 2. Migrate green BY NAME. Never `--env staging` here: that is blue.
npx wrangler d1 migrations apply mannerpath-staging-2 --remote
npx wrangler d1 migrations list mannerpath-staging-2 --remote    # expect: no pending migrations

# 3. Verify the file against the contentSha256 recorded in its review (step 4, never the file's own
#    header), then apply that same file to green, again by name. Green must be empty apart from the
#    schema (the bundle's first statement refuses anything else). If this step fails, D1 rolls the
#    import back; still delete green and start again from step 1 with a new database — never
#    re-apply into it and never switch a binding to it.
npm run local:verify-promotion -- --file promotion-<release>-<date>.sql \
  --expected-content-sha256 <hash from the review record>
npx wrangler d1 execute mannerpath-staging-2 --remote \
  --file promotion-<release>-<date>.sql

# 4. Smoke verify green before any user reaches it. This needs a SEPARATE, TEMPORARY Worker
#    environment whose own D1 binding points at mannerpath-staging-2 — a Worker serves one database
#    per binding, so the live staging Worker cannot serve blue and green at the same time. Deploy
#    that temporary environment from the branch, smoke it, and remove it after the cut-over.
node --experimental-strip-types --no-warnings scripts/smoke.ts \
  --base-url https://<green-host> --remote --tile <a tile in the new data>

# 5. Cut over: change `database_id` for `staging` in services/api/wrangler.jsonc from blue to
#    green, land it in a reviewed PR, then deploy. This is the first command that makes green live.
npx wrangler deploy --env staging

# 6. Smoke verify the live host, now serving green.
node --experimental-strip-types --no-warnings scripts/smoke.ts \
  --base-url https://<worker-host> --remote --tile <a tile in the new data>
```

**Keep the previous (blue) database.** Do not delete it when the switch succeeds: it is the rollback
target until the new data has been observed in the beta for long enough to trust. Deleting it is a
separate, later, deliberate decision (`npx wrangler d1 delete`), taken after a successful
promotion has settled, and never in the same session as the switch.

Notes:

- The `database_id` switch is a reviewed repository change, exactly like the first one — the
  deployment is what makes a database live, so it goes through a PR.
- Steps 2–3 name the database positionally: `wrangler d1 migrations` and `wrangler d1 execute` take
  the database name or a binding in that position.
- The temporary green environment is scaffolding: it exists to smoke green before users see it, and
  it is removed once the cut-over is verified (`npx wrangler delete --env <temporary>`). Deleting it
  does not touch the green database.
- The cut-over is not atomic across the two databases, but each tile is: clients revalidate with
  `ETag` and replace a tile wholesale, so a client sees the old tile or the new one, never a mix.
- **A cutover changes the `DB` binding only. `REPORTS_DB` is never switched (ADR-0014).** Reports,
  moderation decisions, App Attest keys and rate-limit windows live in the durable report store, so
  green starts with none of them and needs none: the live Worker keeps writing reports to the same
  REPORTS_DB before, during and after the switch, registered devices keep their keys (no
  `keyNotRegistered`), and rate-limit identity continues. In the cut-over PR, the diff must touch the
  `DB` `database_id` only; a change to the `REPORTS_DB` entry is a review stop. Green is migrated with
  the canonical stream only (`migrations apply mannerpath-staging-2`), never with `migrations-reports`.

### 7. Rollback / disable

- **Bad tile content:** there is no in-place remote fix. Correct it locally, republish
  (`npm run local:pipeline`), regenerate and review a bundle, and run the blue/green promotion in
  step 6 onto a new database. Within one database, tiles are replaced atomically per tile with a
  monotonic `revision`, so a client always sees a whole old tile or a whole new one.
- **Bad data just promoted:** switch the Worker's `DB` `database_id` back to the previous (blue)
  database in a reviewed change and redeploy, then smoke verify. `REPORTS_DB` is not touched: report
  history, moderation and keys do not roll back (published community state may, with its release):

  ```sh
  # restore the previous database_id in services/api/wrangler.jsonc (reviewed PR)
  npx wrangler deploy --env staging
  node --experimental-strip-types --no-warnings scripts/smoke.ts \
    --base-url https://<worker-host> --remote --tile 14/14553/6450
  ```

  This works only while the previous database still exists, which is why step 6 keeps it.
  It is also safe only while the previous database has the schema the running Worker reads: if the release added a
  canonical migration the Worker depends on, roll the Worker back too (`npx wrangler rollback`) or migrate the previous
  database first.
- **Bad code:** `npx wrangler rollback --env staging` (previous deployment), or redeploy the
  previous commit.
- **Stop accepting reports:** remove `REPORT_APP_ATTEST_APP_ID` (or the bundle-version list) from the environment
  (`npx wrangler secret delete REPORT_APP_ATTEST_APP_ID --env <env>`): `required` without it fails
  closed and `/v1/config` reports `available: false`. There is no separate kill-switch var, and one
  would be a second, weaker gate. Never switch to `disabled` to do this — that accepts unattested
  reports.
- **Take the environment down:** `npx wrangler delete --env staging`. Deleting the Worker does not
  delete the D1 database; `npx wrangler d1 delete` is a separate, destructive decision.
- A rollback never edits canonical data by hand, in either database. Canonical rows change only
  through ingest → resolve → publish locally, and reach a remote database only as a reviewed
  promotion bundle applied to a fresh one.

## Source checks and raw artifacts (ADR-0008 source refresh amendment)

The Worker exports a Cron `scheduled` handler that **only checks** reviewed sources: fetch the
adapter's `refreshTarget.url`, fingerprint (sha256), retain the bytes in R2 under
`raw/sha256/<hex>`, and record a `source_checks` row (`unchanged` / `changed` / `needsReview` /
`failed`) plus, for a changed file, one `source_refresh_candidates` row. It never ingests, resolves,
removes, relocates, publishes or promotes, and it never changes canonical data in any database.

Every committed environment has `triggers.crons = []` and a `RAW_ARTIFACTS` R2 binding
(`mannerpath-raw-artifacts[-staging|-production]`). Enabling checks on an environment is a
maintainer's action, in this order:

1. Promote first (step 4/6). A bundle bootstraps only an empty database, and check history counts.
2. Create the environment's bucket: `npx wrangler r2 bucket create mannerpath-raw-artifacts-<env>`.
3. Add a schedule in a reviewed change (e.g. `"triggers": { "crons": ["0 18 * * *"] }` for 03:00
   JST) and update `test/deploy-config.test.ts` in the same PR, then deploy.

A candidate is acted on only through the reviewed flow: fetch its artifact from R2 by hash, run the
local pipeline with the publisher's `observed_on`, review, and promote a bundle. A `needsReview`
candidate's findings (`findings_json`) must be resolved first. A `failed` check changes nothing; the
previous release and tiles stay as they were. To stop checks, set `crons` back to `[]` and deploy.

## Cache and CDN semantics

No CDN configuration is introduced. The behaviour is the one the responses already describe.

- `GET /v1/tiles/{z}/{x}/{y}` and `GET /v1/spots/{id}` and `GET /v1/config` send
  `Cache-Control: public, no-cache`. That means *cacheable, but revalidate every time* — not
  "do not cache". For tiles the revalidation is a cheap `304`, because the `ETag` is the stored
  schema version + content hash; a republished tile is therefore seen immediately, and an unchanged
  one costs no body.
- The tile `ETag` is derived from stored bytes, never recomputed per request, so it is stable across
  instances and safe for a shared cache.
- `/v1/config` intentionally has no long `max-age`: a client that has cached a stale
  `reports.available` would offer an entry point the server refuses. Revalidation keeps that honest.
- `POST /v1/reports` sends `Cache-Control: no-store`, as do all error bodies.
- If a cache layer is added later, the invariant is that it must honour `ETag` and must not extend
  freshness beyond `no-cache`; otherwise the atomic-tile-replacement contract in ADR-0005 breaks.

## Monitoring and logging policy

**Automatic invocation logs are disabled in every environment.** Cloudflare's Fetch invocation logs
record the request URL, and a MannerPath tile path *is* the z14 cell a user was looking at, with a
timestamp. Persisting those builds a location history, which this project must not keep. Sampling is
**not** a fix: a sampled invocation log is a smaller location history, not the absence of one. The
configuration is therefore the explicit disable, not a low sampling rate:

```jsonc
"observability": { "enabled": true, "logs": { "enabled": true, "invocation_logs": false } }
```

`test/deploy-config.test.ts` fails if any environment re-enables invocation logs, or reintroduces
`head_sampling_rate` as if sampling were the control.

What remains:

- **Aggregate platform metrics** (Workers and D1 analytics): request counts, status-code and error
  rates, CPU time, duration, D1 query counts. These are counters, not per-request records, and carry
  no URL, IP or identifier. This is what the dashboard and any alert are built on.
- **Explicit log lines**, if code ever writes one. Logs stay enabled for that reason, under the
  rules below. Today the service writes none on the request path.
- **Deploy and rollback history**, which is about the Worker, not about users.

Invariants for anything added later:

- **No tile URL history.** No log line, metric label, trace attribute or analytics event may record
  a requested tile ID, a spot ID, a coordinate, or anything that joins requests into a per-user,
  per-install or per-session sequence.
- **No spot or report request payload logging.** Not the note, not `proposedLocation`, not
  `observedOn`, not `installId`, not the hashed submitter key, not a validation error carrying a
  submitted value. Report validation errors are JSON paths and issue codes only (ADR-0007 §7).
- **No attestation material in logs.** Not a key ID, challenge, assertion, attestation object,
  certificate or receipt, and not the configured App ID or bundle versions.
- **No client IP, device ID or account ID** in anything the service records.
- Alert on error rate and `503` volume from the aggregate metrics. A `503` wave on `/v1/reports` is
  `REPORT_ATTESTATION` doing its job, not an incident to silence.
- Re-enabling invocation logs, even sampled, is a privacy decision that needs a documented reason
  and an ADR update — not a debugging convenience.

## Apple beta build → API base URL

The iPhone app already takes the origin as a build setting; no app code changes for this.

- Xcode build setting `MANNERPATH_API_BASE_URL` → the explicit `MannerPath-Info.plist` entry
  `<key>MannerPathAPIBaseURL</key><string>$(MANNERPATH_API_BASE_URL)</string>` → Info.plist key
  `MannerPathAPIBaseURL`, read at composition time (`apps/apple/README.md`). A custom
  `INFOPLIST_KEY_*` build setting is ignored by the generated Info.plist (#52, fixed by #53);
  `scripts/check-iphone-api-base-url.sh` (run by `make apple-validate`) checks the built plist.
- Supply it per configuration through a local, **uncommitted** `.xcconfig`, or as an `xcodebuild`
  build-setting override in the beta build job. The staging origin is not committed.
- It must be an HTTPS origin for device builds (App Transport Security).
- When absent or invalid, Nearby works from the local tile cache only — a beta build with no origin
  degrades to offline rather than failing.
- What the current beta build reads from `GET /v1/config`: the report block, plus, since ADR-0015, `dataTileZoom`
  and the tile schema range. It disables report submission when `reports.available` is `false`, and speaks exactly the
  report protocol `reports.attestation` names (`"none"` with report schema `1..1`, `"appAttest"` with `2..2`). Before
  every tile sync it reads `dataTileZoom` and binds its tile cache to it. A cache built at another zoom is evicted in
  one transaction. A zoom outside 14–16, or a tile schema range without 1 or 2, fails closed: no sync, cached tiles
  stay visible. Builds from before ADR-0015 use a fixed zoom of `14` and the v1 tile path. They keep working while
  the server stays at `DATA_TILE_ZOOM=14`, and only a multi-part tile (`409 tileRequiresParts`) stays at their
  cached copy (`docs/API.md`). The spot-detail schema range is still not read (`BETA_E2E_CHECKLIST.md` L3).

## Report attestation (App Attest, Issue #37)

The protocol is implemented (ADR-0007 §6, `docs/API.md` "App Attest"). What a deployment does is
decided by four values; the committed environments carry only the first.

| Value | Where it lives | Committed? |
|---|---|---|
| `REPORT_ATTESTATION` | `vars` in `wrangler.jsonc` — `disabled` locally, `required` on staging/production | yes |
| `REPORT_APP_ATTEST_APP_ID` | `<App ID prefix>.<bundle identifier>`, the App Attest RP ID; the App ID prefix is usually the Team ID. Set per environment, never committed: `npx wrangler secret put REPORT_APP_ATTEST_APP_ID --env <env>` | **no** |
| `REPORT_APP_ATTEST_ENVIRONMENT` | `production` for TestFlight and App Store builds, `development` for builds signed with a development identity; a key attested in one is refused by the other. Set it the same way | **no** |
| `REPORT_APP_ATTEST_BUNDLE_VERSIONS` | The exact `CFBundleVersion` values accepted in `apple_bundle_version_01`, comma-separated with no spaces, e.g. `41,42` or `1.4.0,1.4.1`. Each entry is one to three period-separated integers; entries are compared as exact strings; duplicates, empty entries or whitespace make the whole value invalid. List every build that may be in users' hands — during a rolling TestFlight/App Store release, both the old and the new build — and remove a build to stop accepting it. Set it the same way | **no** |

- **Remote environments fail closed until a maintainer configures them.** With `required` and
  any of the three values missing, empty or malformed, `POST /v1/reports` and the App Attest endpoints answer
  `503 attestationUnavailable` and `/v1/config` reports `reports.available: false`. The smoke check
  treats that as a pass. `test/deploy-config.test.ts` fails if any of them appears in the
  committed configuration.
- **Once all three are set**, the deployment speaks report schemaVersion 2 only: `/v1/config` advertises
  `reports.attestation: "appAttest"` and `report` version 2, schema-1 reports are refused with
  `400 reportSchemaUnsupported`, and a report is stored only after its assertion verified
  (`attestation_status = 'verified'`). A device that reports a build not in
  `REPORT_APP_ATTEST_BUNDLE_VERSIONS` is refused with `detail: bundleVersion`, so add a new build's
  `CFBundleVersion` before it reaches testers. Before setting them on any long-lived remote environment, confirm #35 on a
  physical device (the blue/green carry-over is settled: reports, keys and rate limits live in REPORTS_DB, ADR-0014). The one exception
  is the disposable E2E environment below, which exists to run that physical-device check.
- Local and test keep `REPORT_ATTESTATION=disabled`: schema 1, unattested, `notProvided`. Do not
  switch a remote environment to `disabled` to "turn reports on" — that accepts unattested reports.
  Any unrecognised value fails closed, so a typo cannot silently disable attestation.
- **Trust anchor.** The Apple App Attestation Root CA is pinned in
  `services/api/src/attest/apple-root.ts` (valid to 2045-03-15; a test checks its fingerprint).
  There is no configuration that replaces it. If Apple rotates it, that is a reviewed code change.
- **Retention.** The retention pass (`npm run local:reports -- retain`) also deletes expired App
  Attest challenges, consumed or not; a challenge lives 5 minutes. Registered keys (key ID, public
  key, environment, counter, registration time) are kept indefinitely and are not linked to
  reports. Nothing else from an attestation is stored.
- **Abuse.** Outstanding challenges are capped (1000 for registration per deployment, 3 per key for
  reports; over the cap is `429 challengeLimited`). Registration-challenge flooding from many
  clients is bounded only by that cap and by the IP-keyed edge rate-limit rule (ADR-0007 §5), which
  must cover `/v1/app-attest/*` as well as `/v1/reports` before any wider release.
- Physical-device verification of registration and assertion is Issue #35; the iPhone client is
  Issue #46.

## Disposable App Attest E2E environment (Issue #55)

#35 P21/P23 need a remote deployment with the App Attest values set, and step 6 forbids setting them
on a long-lived staging/production database until the blue/green report/key carry-over is decided.
This environment breaks that loop: a throwaway Worker on a throwaway D1 database, bootstrapped by the
same migrations and reviewed promotion bundle, used for the physical-device run and then deleted.
Its reports and keys are the maintainer's own test data and are deleted with it; it is never promoted
from, and staging/production are never switched onto it, so there is nothing to carry over.

**Why a generated config.** `npm run e2e:config` writes `services/api/.wrangler/e2e/<s>.json`
(git-ignored) from the committed `wrangler.jsonc`: one Worker `mannerpath-api-e2e-<s>`, one `DB`
binding to `mannerpath-e2e-<s>`, `REPORT_ATTESTATION=required`, and the committed `observability`
block (`invocation_logs: false`). It has **no `env` block**, so a command run with `--config` on that
file can resolve `DB` only to the disposable database — there is no staging or production binding in
it to fall back to. Never add `--env` to these commands. The generator refuses a placeholder or
malformed ID, any `database_id` committed in `wrangler.jsonc`, and a name that collides with a
committed Worker or database (`test/disposable-env.test.ts`). The committed file keeps its placeholder
IDs; the real disposable ID only ever exists in the ignored file.

All commands run from `services/api`. `<s>` is a short suffix such as `p21`; `C=.wrangler/e2e/<s>.json`.

```sh
C=.wrangler/e2e/<s>.json    # every command below needs it; an unset $C must not reach wrangler

# 1. Fresh database, then the config bound to it (nothing else is written).
npx wrangler d1 create mannerpath-e2e-<s>
npm run e2e:config -- --suffix <s> --database-id <uuid printed above>

# 2. Migrate and promote real published data through the reviewed path (steps 2 and 4).
#    Build and read the bundle first: npm run local:pipeline && npm run local:export -- --out promotion.sql
npx wrangler d1 migrations apply DB --config $C --remote
npx wrangler d1 migrations list DB --config $C --remote     # expect: no pending migrations
npm run local:verify-promotion -- --file promotion.sql --expected-content-sha256 <hash from the review record>
npx wrangler d1 execute DB --config $C --remote --file promotion.sql

# 3. Deploy, set the pepper, and prove it fails closed before any App Attest value exists.
npx wrangler deploy --config $C
npx wrangler secret put REPORT_SUBMITTER_PEPPER --config $C
node --experimental-strip-types --no-warnings scripts/smoke.ts \
  --base-url https://<e2e-host> --remote --tile <a published tile> --expect-reports unavailable

# 4. Configure App Attest on THIS Worker only (values typed interactively, never committed).
npx wrangler secret put REPORT_APP_ATTEST_APP_ID --config $C          # <App ID prefix>.<bundle identifier>
npx wrangler secret put REPORT_APP_ATTEST_ENVIRONMENT --config $C     # development for a development-signed build
npx wrangler secret put REPORT_APP_ATTEST_BUNDLE_VERSIONS --config $C # the installed build's CFBundleVersion
node --experimental-strip-types --no-warnings scripts/smoke.ts \
  --base-url https://<e2e-host> --remote --tile <a published tile> --expect-reports appAttest
```

`--expect-reports unavailable` passes only while `/v1/config` says `reports.available: false` (the
report check then sees `503 attestationUnavailable`); `--expect-reports appAttest` passes only once
all three values are valid and `/v1/config` advertises `reports.attestation: "appAttest"` with report
schema `2..2`. Smoke never submits a valid report.

**CFBundleVersion.** `REPORT_APP_ATTEST_BUNDLE_VERSIONS` must contain, as an exact string, the
`CFBundleVersion` (`CURRENT_PROJECT_VERSION`) of the build installed on the iPhone. Read it from the
built app: `/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' <App>.app/Info.plist`. A rebuild with
a new build number means updating the secret before the next report.

**#35 P21 / P23 on a physical iPhone.** Build a development-signed app with
`MANNERPATH_API_BASE_URL=https://<e2e-host>` ("Apple beta build → API base URL"), install it, then:

- **P21** — submit a report: the app registers its key, fetches a challenge and submits an asserted
  schema-2 report; expect `201`. Record the evidence in `BETA_E2E_CHECKLIST.md`.
- **P23** — set `REPORT_APP_ATTEST_BUNDLE_VERSIONS` to a valid value that is *not* the installed
  build (e.g. `9999`) and submit a report: expect "Update the app" (`detail: bundleVersion`) with the
  key kept. Restore the build's value and confirm the next report succeeds without re-registering.

**Cleanup.** Once the run is recorded, remove both disposable resources. Each command names only the
`e2e` Worker or database; none resolves staging or production.

```sh
npx wrangler delete --config $C                 # the mannerpath-api-e2e-<s> Worker and its secrets
npx wrangler d1 delete mannerpath-e2e-<s>       # the disposable database, reports and keys included
rm $C
```

## Community publication (Issue #124, Issue #150)

The decision, the exact code switch and the launch order are in `docs/legal/COMMUNITY_PUBLICATION_DECISION.md` and
`docs/COMMUNITY_LAUNCH_CHECKLIST.md`. This section is the operating procedure once community publication is live.
Everything here is maintainer tooling (`npm run local:reports` / `reports:moderate`, `local:pipeline`, `local:quality`); production changes
only through the reviewed promotion bundle (steps 4–6).

**Report path (ADR-0014).** Production reports are written to the environment's durable `REPORTS_DB`, which no
cut-over or rollback switches. Moderation and review run against that store (`npm run reports:moderate -- --remote
…`, maintainer's terminal only; `npm run local:reports` for local). A review is exported as a sanitized artifact file
(`export <reviewId> <dir>`), imported into the LOCAL canonical pipeline (`import <file>`), applied there, and reaches
production only through the reviewed promotion bundle and a blue/green cut-over. Raw reports never leave REPORTS_DB.

### Daily moderation flow

Work top to bottom; stop at the end of the time box rather than skimming. Never accept in bulk: every `decide` is one
report and one person's judgement, with a reason code. Read counts first:

```sh
npm run local:reports -- triage-summary        # pending / accepted / rejected / rightsBlocked by category
npm run local:reports -- summary               # reports -> reviews -> imported artifacts -> applications, counts only
```

| # | Queue | Command(s) | Rule |
| --- | --- | --- | --- |
| 1 | Abuse first | `triage pending` (look for repeats, impossible pins, insults in notes) | `decide <id> rejected <you> abuse`. Notes are never quoted anywhere |
| 2 | Negatives (`notFound`, `removed`, `prohibited`) | `triage pending missing,prohibited`, then `evidence`, `effects` | one negative = `needsRecheck` only. ≥ 2 independent → `absence-propose` / `absence-apply`; `absence-hold` only on a reviewed decision |
| 3 | Absence candidates | `evidence` (`reviewCandidate`) | hold or dismiss; a hold hides, never deletes. Lift with `absence-lift` |
| 4 | Conflicts | `evidence` (`conflicting`) | no voting: newer positive vs older negatives is a recheck, not a removal |
| 5 | Corrections / relocation | `triage pending moved,typeChange,accessChange,hoursChange,tobaccoChange`, `corrections` | one pin = `awaitingIndependentConfirmation`; agreeing pins → `effect-propose` (relocationReview). Nothing moves without ADR-0009 review |
| 6 | Confirmations (`exists`) | `triage pending stillExists`, `effects` | accept → `effect-propose` → `effect-apply` → `upgrade` (communityReported → communityVerified) |
| 7 | Duplicates | `duplicates` | merge into the live spot or `decide … rejected … duplicateOfExistingReport` |
| 8 | New spots | `triage pending newSpot`, `candidates <metres>` | type must be known; a shop alone is not a smoking place. `propose-reported` (one report) or `propose` (≥ 2 independent) → `export` → `import` → `apply` |
| 9 | Rights blocked | `triage-summary` `rightsBlocked` | reports without consent to the granted version: usable as review signals only, never publish. No action can fix them |

Every `*-propose` above is a REPORTS_DB review; follow it with `export <reviewId> <dir>` and, against the local
canonical pipeline, `import <dir>/<sha256>.json` before any `*-apply`. Import answers `imported`, `alreadyImported`
(same bytes: nothing written), `conflict`, `stale` or `refused` (spot merged/unknown, base changed, unknown terms):
the last three write nothing and need a fresh review. Run `retain` (or `npm run local:reports:redact`) daily; it
works in bounded, resumable batches.

Then `npm run local:pipeline` (republish) and `npm run local:quality`. A large queue is a staffing signal, not a
quality failure; no check fails on community volume.

### Community rollback (no deletes)

| Goal | Action | Effect |
| --- | --- | --- |
| Stop accepting reports | `npx wrangler secret delete REPORT_APP_ATTEST_APP_ID --env <env>` (step 7) | `/v1/config` `available: false`; the app hides reporting. Never switch to `disabled` |
| Stop publication quickly | switch the `DB` `database_id` back to the pre-launch database (step 7, reviewed PR) | official data exactly as before launch; reports and moderation stay in REPORTS_DB, untouched |
| Hold the community source | PR: `COMMUNITY_PUBLICATION.state = "suspended"` → `npm run local:registry && npm run local:pipeline` → new bundle → blue/green | terms `revoked`, source `blocked`, community spots leave tiles; reports, applications and canonical rows remain |
| Resume | PR back to `approved`, same steps | community spots return from the preserved evidence |

Official sources are never part of a community rollback (`test/community-activation.test.ts` checks the official
published set is unchanged).

## Report store (REPORTS_DB): backup and recovery (ADR-0014)

REPORTS_DB is the one database that is not rebuilt from the repository: a lost report cannot be re-derived. It is
therefore protected by Cloudflare's own D1 features, checked against the current Cloudflare documentation
(`developers.cloudflare.com/d1/reference/time-travel/`, `…/d1/best-practices/import-export-data/`, read 2026-10-01).
Retention windows and limits are set by Cloudflare per plan and change; read the current page before relying on one.
Every command here is a maintainer's remote action; none is run by automation.

- **Point-in-time recovery (Time Travel).** Always on for production-backend D1, no configuration. Before any risky
  operation on the report store (a new `migrations-reports` file, a bulk moderation session), record a bookmark:

  ```sh
  npx wrangler d1 time-travel info mannerpath-production-reports            # note the bookmark in the deployment record
  ```

  Restoring **overwrites the database in place and cancels in-flight queries** (Cloudflare docs). It is a destructive,
  last-resort step: stop report intake first (step 7, "Stop accepting reports"), then

  ```sh
  npx wrangler d1 time-travel info mannerpath-production-reports --timestamp=<RFC 3339>   # find the bookmark
  npx wrangler d1 time-travel restore mannerpath-production-reports --bookmark=<bookmark>
  ```

  A restore can itself be undone by restoring the bookmark printed before it. Reports accepted after the restore point
  are lost; record the window in the incident.
- **Offline export.** For a copy outside Cloudflare (and beyond the Time Travel window), export to a file kept
  under the same access control as personal data (it contains notes, pins and submitter hashes until 90-day
  minimization):

  ```sh
  npx wrangler d1 export mannerpath-production-reports --remote --output=reports-<date>.sql
  ```

  A running export blocks other requests to the database (Cloudflare docs): run it in a low-traffic window. An export
  is personal data: it inherits the 90-day minimization (delete exports older than that), and it is never committed,
  attached to an issue or copied into the canonical pipeline.
- **Restore from an export** (only if Time Travel cannot help): create a NEW database, apply `migrations-reports`,
  `npx wrangler d1 execute <new-name> --remote --file=reports-<date>.sql`, verify the `report_store_meta` row and
  counts, then switch only the `REPORTS_DB` `database_id` in a reviewed PR. This is the one case in which REPORTS_DB is
  re-pointed, and it is never combined with a canonical cut-over.
- **What is not a backup:** the canonical database (it holds no reports), promotion bundles (they carry no report
  state), and community artifacts (sanitized decisions, not reports).
## Nationwide community scale operations

See [Community scale runbook](COMMUNITY_SCALE_RUNBOOK.md) for deterministic local scale profiles,
capacity review after the first 1,000, bounded moderation/retention and D1 measurement limitations.
Simulation does not approve community publication: #124, terms and source rights remain pending.

Promotion v4 carries the ADR-0015 canonical representation unchanged: `tile_snapshots` manifest/head rows
and `tile_snapshot_parts` rows, each part as a separate budgeted INSERT after its head. Migration
`0029_segmented_promotion.sql` follows `0028_tile_parts.sql`. Completion validates head/part descriptors,
continuous indexes, hashes, counts, canonical references and complete logical membership; multipart tiles
are never reassembled into one promotion SQL statement.
