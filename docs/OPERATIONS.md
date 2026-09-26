# Beta operations runbook — staging / production-like backend

How a maintainer stands up, verifies, and disables a staging or production-like MannerPath API.

**Nothing in this repository performs any of it.** Every command in the "Remote" sections is typed
deliberately by a maintainer against an account they own. The committed configuration cannot reach a
real database: every `database_id` in `services/api/wrangler.jsonc` is the all-zero placeholder, so a
`deploy` or `--remote` command fails until the maintainer creates the database and lands the real ID
in a reviewed change (`services/AGENTS.md`, enforced by `services/api/test/deploy-config.test.ts`).

Scope: Cloudflare Workers + D1 (ADR-0003), the `/v1` surface in `API.md`. This is a beta operations
document, not an App Store release or a production launch plan.

## Local vs. remote

Two vocabularies, deliberately not mixed.

| Guaranteed local — safe to run at any time | What it touches |
| --- | --- |
| `npm test`, `npm run typecheck` | Nothing outside the repository |
| `npm run local:migrate` | `.wrangler/state` local D1 |
| `npm run local:registry`, `npm run local:pipeline` | `.wrangler/state` local D1 |
| `npm run local:reports` | `.wrangler/state` local D1 |
| `npm run dev` (`wrangler dev --local`) | Local Worker on `127.0.0.1:8787` |
| `npm run local:smoke` | HTTP GETs against `127.0.0.1:8787` |
| `npm run local:export` | Reads `.wrangler/state` local D1; writes a file only when asked |

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
```

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

Then generate the **promotion bundle** — the reviewable artifact that carries that validated local
state to another database:

```sh
npm run local:export                                  # validate + print the manifest, write nothing
npm run local:export -- --out promotion.sql           # write the artifact
npm run local:export -- --release 1 --out promotion.sql
```

The bundle is deterministic SQL (`services/api/src/pipeline/promotion.ts`):

- a header naming the generator, the release, its source, every tile with its revision, spot count
  and content hash, and a `contentSha256` over the statement block, so a reviewed bundle is
  identifiable by one value;
- `INSERT` statements in foreign-key-safe order for `sources`, `source_releases`, `source_records`,
  `source_record_match_keys`, `source_entities`, `source_record_entities`, `spots`,
  `spot_source_entities`, `spot_field_provenance`, `spot_field_attenuations`, `tile_snapshots`,
  `tile_snapshot_spots` — fixed table, column and row order and fixed literal formatting, so two
  runs over the same state produce byte-identical files and two bundles can be diffed;
- opaque spot IDs, tile revisions, content hashes, attribution and field provenance verbatim: the
  receiving database gets the same published bytes, not a re-derivation.

`source_observations` (ADR-0008 decision 2) is not in the bundle: it is derived data, re-derivable
from the `source_records` that are, and the canonical rows it produced travel as themselves.
`review_items` / `review_decisions` (ADR-0008 decision 8) are not in the bundle either: they are
review state of the database that ran the pipeline, and nothing published reads them.
`review_removal_applications` (ADR-0008 decision 5, Issue #84) is review state too and stays out of
the bundle; a removed spot travels only as its canonical row with `lifecycle = 'removed'`, and the
audit link to its review decision stays in the database that applied it. Run `publishTiles` after
`applyReviewedRemoval` and before exporting. Until then the spot's snapshot membership no longer
matches its stored tile body, and `buildPromotionBundle` (`npm run local:export`) refuses the export
with `snapshot membership does not match the body` (tested in `test/review-removal.test.ts`), so a
crash or a forgotten republish cannot reach a remote promotion.

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
not match its content hash, its schema, its membership or its spot count; or a tile cites a source
whose attribution is missing. `test/promotion.test.ts` covers these.

**The bundle is a bootstrap artifact, not an update.** It is INSERT-only, and its target is an
**empty, freshly migrated database**. It cannot modify an already-populated remote D1: applying it
to one fails on primary keys rather than half-updating it, which is the behaviour that keeps a
partially-applied promotion from existing. This slice adds no remote upsert or update path, and none
should be improvised at the console. Corrected or new data ships through the blue/green procedure in
step 6.

Applying it is a separate human step, and the only step that writes to a remote database. The
binding form below is for the **first** promotion into a freshly created environment, where the
environment's `database_id` is already the database being bootstrapped. Every later promotion goes
through step 6 and addresses the new database **by name**, because `--env staging` would then resolve
to the live one:

```sh
npx wrangler d1 migrations apply DB --env staging --remote    # a fresh, empty database
npx wrangler d1 execute DB --env staging --remote --file promotion.sql
```

Read the bundle before running it. The receiving database re-checks the ADR-0006 publication
invariant on every `tile_snapshot_spots` row, so a tampered bundle is rejected there as well.

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

# 3. Apply the reviewed bundle to green, again by name. Green must be empty apart from the schema.
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
- User reports and registered App Attest keys live in the database being replaced. While the App
  Attest values are unset, remote report acceptance is closed, so a green database starts with no
  reports or keys to carry and nothing is lost. **This stops being true the moment a remote
  environment is configured to accept attested reports**: a blue/green switch would then drop the
  reports and keys written to the blue database since the bundle was built. Dropped keys are
  recoverable (clients get `keyNotRegistered` and register again); dropped reports are not. How
  reports are carried across — or a replacement for this model — must be decided before the App
  Attest values are set on any long-lived remote environment. Issue #37 implements the protocol
  only; it does not decide that. The disposable E2E environment (end of this document) is exempt
  because it is never switched onto or promoted from.

### 7. Rollback / disable

- **Bad tile content:** there is no in-place remote fix. Correct it locally, republish
  (`npm run local:pipeline`), regenerate and review a bundle, and run the blue/green promotion in
  step 6 onto a new database. Within one database, tiles are replaced atomically per tile with a
  monotonic `revision`, so a client always sees a whole old tile or a whole new one.
- **Bad data just promoted:** switch the Worker's `database_id` back to the previous (blue)
  database in a reviewed change and redeploy, then smoke verify:

  ```sh
  # restore the previous database_id in services/api/wrangler.jsonc (reviewed PR)
  npx wrangler deploy --env staging
  node --experimental-strip-types --no-warnings scripts/smoke.ts \
    --base-url https://<worker-host> --remote --tile 14/14553/6450
  ```

  This works only while the previous database still exists, which is why step 6 keeps it.
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
- What the current beta build reads from `GET /v1/config`: only the report block. It disables
  report submission when `reports.available` is `false`, and speaks exactly the report protocol
  `reports.attestation` names (`"none"` with report schema `1..1`, `"appAttest"` with `2..2`).
  Tiles are still requested at a fixed zoom of `14`: the client does not yet read `dataTileZoom`
  or the tile / spot-detail schema ranges (`BETA_E2E_CHECKLIST.md` limitation L3). That is safe
  while the server stays at `DATA_TILE_ZOOM=14` and tile schema `1`; changing either requires the
  client to adopt those `/v1/config` fields first (`docs/API.md` "GET /config").

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
  `CFBundleVersion` before it reaches testers. Before setting them on any long-lived remote environment, settle the
  blue/green carry-over question in step 6 and confirm #35 on a physical device. The one exception
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
