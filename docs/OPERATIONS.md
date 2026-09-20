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

`REPORT_ATTESTATION` is **`required`** in the committed `staging` and `production` environments,
which makes the report endpoint fail closed until Issue #37 (see below). Leave it that way. No other
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
  `spot_source_entities`, `spot_field_provenance`, `tile_snapshots`, `tile_snapshot_spots` — fixed
  table, column and row order and fixed literal formatting, so two runs over the same state produce
  byte-identical files and two bundles can be diffed;
- opaque spot IDs, tile revisions, content hashes, attribution and field provenance verbatim: the
  receiving database gets the same published bytes, not a re-derivation.

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
| `report endpoint configuration` | The report gate agrees with `/v1/config`: `400 invalidReport` when `reports.available` is true, `503 attestationUnavailable` when it is false. Never `201`. On staging/production `reports.available` is `false` and `503` is the expected pass (Issue #37) |

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
- User reports live in the database being replaced. In beta, remote report acceptance is closed
  (`REPORT_ATTESTATION=required`, Issue #37), so a green database starts with no reports to carry
  and nothing is lost. **This stops being true the moment #37 lands**: a blue/green switch would
  then drop the reports written to the blue database since the bundle was built, and that issue must
  define how reports are carried across (or replace this model) before reports are accepted
  remotely.

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
- **Stop accepting reports:** already the committed state remotely (`REPORT_ATTESTATION=required`
  fails closed). There is no separate kill-switch var, and one would be a second, weaker gate.
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
- **No client IP, device ID or account ID** in anything the service records.
- Alert on error rate and `503` volume from the aggregate metrics. A `503` wave on `/v1/reports` is
  `REPORT_ATTESTATION` doing its job, not an incident to silence.
- Re-enabling invocation logs, even sampled, is a privacy decision that needs a documented reason
  and an ADR update — not a debugging convenience.

## Apple beta build → API base URL

The iPhone app already takes the origin as a build setting; no app code changes for this.

- Xcode build setting `MANNERPATH_API_BASE_URL` → `INFOPLIST_KEY_MannerPathAPIBaseURL` →
  Info.plist key `MannerPathAPIBaseURL`, read at composition time (`apps/apple/README.md`).
- Supply it per configuration through a local, **uncommitted** `.xcconfig`, or as an `xcodebuild`
  build-setting override in the beta build job. The staging origin is not committed.
- It must be an HTTPS origin for device builds (App Transport Security).
- When absent or invalid, Nearby works from the local tile cache only — a beta build with no origin
  degrades to offline rather than failing.
- A beta build should call `GET /v1/config` at launch, take `dataTileZoom` from it rather than
  hard-coding `14`, and compare each resource's advertised range with the schema versions it can
  decode — tiles, spot detail and reports separately, since they version independently. It should
  also hide the report entry point when `reports.available` is `false`, which is the state of every
  remote-like environment until Issue #37.

## Issue #37 — report attestation stays fail-closed

App Attest is deferred (ADR-0007 §6, Issue #37). This runbook does not implement it and must not be
used to work around it.

- **Remote report acceptance is deferred.** The committed `staging` and `production` environments
  set `REPORT_ATTESTATION=required`, so a freshly deployed remote-like environment accepts no
  reports at all: `POST /v1/reports` answers `503 attestationUnavailable` before reading the body,
  and `/v1/config` reports `reports.available: false`. That is the intended state until #37, and the
  smoke check treats it as a pass.
- Local and test keep `REPORT_ATTESTATION=disabled`, so the endpoint stays exercisable where no real
  user data exists.
- Setting `required` does **not** enable attestation — the protocol does not exist. Any unrecognised
  value fails closed the same way, so a typo cannot silently disable attestation.
- Do not switch a remote environment to `disabled` to "turn reports on". That would accept
  unattested reports in a production-like environment, which is exactly what this setting prevents;
  the way to accept reports remotely is to implement #37.
- Do not add an env var, header or client flag that accepts attestation material in the meantime:
  a stored verdict nobody verified would look like evidence of device integrity.
- Unattested reports in beta are therefore protected only by the hashed-submitter rate limit and
  moderation. Treat that as beta-grade abuse resistance, not device integrity, and add the
  IP-keyed edge rate-limit rule before any wider release (ADR-0007 §5).
