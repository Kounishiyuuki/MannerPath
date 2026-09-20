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

Every one of these carries `local` in its name or runs entirely in-process. None accepts a remote
target; `local:pipeline` opens its binding with `remoteBindings: false`.

| Explicitly remote — only the maintainer runs these | Guard |
| --- | --- |
| `npx wrangler d1 create …` | Typed by hand; creates the database |
| `npx wrangler d1 migrations apply DB --env staging --remote` | Needs `--remote` **and** a real `database_id` |
| `npx wrangler secret put … --env staging` | Interactive; value never in the repository |
| `npx wrangler deploy --env staging` | Needs a real `database_id` |
| `node --experimental-strip-types --no-warnings scripts/smoke.ts --base-url https://… --remote` | Refuses a non-loopback target without `--remote`, and refuses non-HTTPS |
| `npx wrangler delete --env staging` | Typed by hand; the disable step |

`scripts/smoke.ts` defaults to `http://127.0.0.1:8787` and **refuses** any non-loopback host unless
both `--base-url` and `--remote` are given. It sends only GETs plus one deliberately invalid
`POST /v1/reports` (a `{}` body), which fails validation and stores nothing, so it is read-only
against canonical data on whatever it points at.

## Sequence

Run in order. Each step is verifiable before the next.

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

`REPORT_ATTESTATION` stays `disabled` (see "Issue #37" below). No other secret exists.

### 2. Migrate

```sh
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler d1 migrations list DB --env staging --remote      # expect: no pending migrations
```

Migrations are append-only numbered files; an applied migration is never edited
(`services/AGENTS.md`).

### 3. Apply the reviewed source registry

Only sources approved in `SOURCES.md` and present in `REVIEWED_SOURCES`
(`services/api/src/pipeline/registry.ts`) can be registered at all; anything else throws. Applying
the registry remotely means applying the same reviewed entries to the remote database from a
checkout of the merged commit, recording which commit was applied. An unapproved source stays out of
published tiles regardless (ADR-0006), and the D1 publication trigger rejects it even if the
publisher is bypassed.

**Known gap.** This repository has no remote-capable runner for steps 3 and 4: `local:registry` and
`local:pipeline` open their binding with `remoteBindings: false`, on purpose. Until a remote runner
lands in its own reviewed issue, apply the registry and the published snapshots to a remote database
as an explicit, reviewed `npx wrangler d1 execute DB --env staging --remote --file …` of SQL produced
from a local run. Do **not** add a `--remote` flag to the local scripts as a side effect of an
operations task — that is the change this split is designed to prevent.

### 4. Ingest → resolve → publish

The pipeline is the same three steps as `npm run local:pipeline`: ingest raw evidence, resolve the
release into canonical spots, publish z14 tile snapshots. Run it against a local database and read
the publish report (`published` / `excluded` counts) before anything reaches a remote database; the
same "known gap" above applies to how the result gets there. A source listed under `excluded` is not
a failure to work around: it is the publication gate doing its job.

### 5. Smoke verify

```sh
node --experimental-strip-types --no-warnings scripts/smoke.ts \
  --base-url https://<worker-host> --remote --tile 14/14553/6450
```

It prints one line per check and exits non-zero if any fails:

| Check | What must hold |
| --- | --- |
| `config` | `GET /v1/config` → `200`, body valid, `dataTileZoom` matches the server's `DATA_TILE_ZOOM` |
| `tile 200` | `GET /v1/tiles/{z}/{x}/{y}` → `200`, body valid against the tile schema, `ETag` present |
| `tile 304` | The same request with `If-None-Match: <etag>` → `304`, same `ETag` |
| `tileNotPublished 404` | A valid z14 tile with no snapshot → `404 {"error":"tileNotPublished"}` |
| `spot detail` | `GET /v1/spots/{id}` for a spot in that tile → `200`, valid, same ID |
| `attribution` | Every source behind a published spot has non-empty `attributionText`, and the detail endpoint's source entry is byte-identical to the tile's |
| `report endpoint configuration` | The report gate agrees with `/v1/config`: `400 invalidReport` when `reports.available` is true, `503 attestationUnavailable` when it is false. Never `201` |

The attribution check is a licence check, not a cosmetic one: publishing a spot without its source's
approved attribution violates the source licence (`DATA_POLICY.md`).

### 6. Rollback / disable

- **Bad tile content:** republish. Tiles are replaced atomically per tile and `revision` is
  monotonic, so a corrected snapshot supersedes a bad one; clients replace the whole tile.
- **Bad code:** `npx wrangler rollback --env staging` (previous deployment), or redeploy the
  previous commit.
- **Stop accepting reports:** there is no kill switch var, and one would be a second, weaker gate.
  Roll back the deployment, or take the environment down.
- **Take the environment down:** `npx wrangler delete --env staging`. Deleting the Worker does not
  delete the D1 database; `npx wrangler d1 delete` is a separate, destructive decision.
- A rollback never edits canonical data by hand. Canonical rows change only through ingest → resolve
  → publish.

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

`observability` is enabled with `head_sampling_rate: 0.1` in every environment: sampled request
logs, not a complete request record. The following are invariants, not preferences.

- **No report payload is ever logged.** Not the note, not `proposedLocation`, not `observedOn`, not
  `installId`, not the hashed submitter key. Validation errors carry JSON paths and issue codes only
  (ADR-0007 §7). Application code logs nothing on the report path — keep it that way.
- **No precise user location, and no location history.** The API never receives a device position:
  a tile ID is a ~2 km z14 cell the client asked for, and `proposedLocation` is a proposed map pin,
  not the user. Do not add a log line, metric label or analytics event that joins requests into a
  per-user or per-install sequence.
- **No client IP, no device ID, no account ID** in any log or metric the service adds.
- Useful and sufficient: HTTP status counts, latency, error rates, per-endpoint volume, and the
  `excluded`/`published` counts from a publish run.
- Alert on error-rate and `503` volume — a sudden `503` wave on `/v1/reports` means
  `REPORT_ATTESTATION` was changed, which is the fail-closed behaviour below working.
- Sampling exists to bound both cost and the amount of request detail retained. Raising it to `1`
  is a privacy decision, not a tuning knob.

## Apple beta build → API base URL

The iPhone app already takes the origin as a build setting; no app code changes for this.

- Xcode build setting `MANNERPATH_API_BASE_URL` → `INFOPLIST_KEY_MannerPathAPIBaseURL` →
  Info.plist key `MannerPathAPIBaseURL`, read at composition time (`apps/apple/README.md`).
- Supply it per configuration through a local, **uncommitted** `.xcconfig`, or as an `xcodebuild`
  build-setting override in the beta build job. The staging origin is not committed.
- It must be an HTTPS origin for device builds (App Transport Security).
- When absent or invalid, Nearby works from the local tile cache only — a beta build with no origin
  degrades to offline rather than failing.
- A beta build should call `GET /v1/config` at launch and compare `minimumSupportedSchemaVersion`
  with the schema versions it can decode, rather than hard-coding `DATA_TILE_ZOOM`.

## Issue #37 — report attestation stays fail-closed

App Attest is deferred (ADR-0007 §6, Issue #37). This runbook does not implement it and must not be
used to work around it.

- `REPORT_ATTESTATION` is `disabled` in every committed environment.
- Setting it to `required` does **not** enable attestation. The protocol does not exist, so the
  endpoint answers `503 attestationUnavailable` before reading the body, and `/v1/config` reports
  `reports.available: false`. Any unrecognised value behaves the same way, so a typo cannot silently
  disable attestation.
- Do not add an env var, header or client flag that accepts attestation material in the meantime:
  a stored verdict nobody verified would look like evidence of device integrity.
- Unattested reports in beta are therefore protected only by the hashed-submitter rate limit and
  moderation. Treat that as beta-grade abuse resistance, not device integrity, and add the
  IP-keyed edge rate-limit rule before any wider release (ADR-0007 §5).
