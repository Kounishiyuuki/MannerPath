# MannerPath Admin (local operator tool)

This is a loopback-only review tool, not a deployed admin service. Approval never publishes a
spot or photograph. Production operation and the staging end-to-end launch gate remain unverified.

## Start with synthetic data

Use Node 24 or later. From `services/api`:

```sh
npm ci --ignore-scripts
npm run reports:admin -- --demo
```

Enter a 24–256 character passphrase at the hidden terminal prompt, then open
`http://127.0.0.1:4318`. Enter the same passphrase in the login form. Demo mode creates three
synthetic reports and two generated PNGs in memory; stopping the process discards them. No
Cloudflare connection, real report, or real photo is used. `--port 4319` changes the loopback port;
there is deliberately no host option. Do not reverse-proxy, tunnel, or expose this service.

`MANNERPATH_ADMIN_TOKEN` can supply the passphrase for a controlled launcher; it is removed from
the environment before Cloudflare tooling starts. Do not put it in shell history, a URL, or a file.
Login sessions expire after eight hours. Restarting invalidates every session and confirmation.

## Review workflow

1. Choose a queue and a report. The detail includes the proposed location, conditions, hours,
   description, duplicate candidates, photo states, and this tool's decision history.
2. Photos are private authenticated previews, not public URLs. Missing, unfinished, rejected,
   expired, deleted, and unavailable photos are distinguished. Check faces, plates and other
   sensitive content before approving each pending photo. Approval is not an automatic redaction.
3. The map is loaded **only** after checking the disclosure consent and clicking its display button.
   This sends the proposed coordinates and the browser's IP to OpenStreetMap. Do not load it if
   this disclosure is inappropriate. Photos and notes are not sent to the map service.
4. Choose the existing bounded reason code, then approve, hold, reject, or mark duplicate. Review
   the confirmation dialog before applying. A report without an approved available photo cannot
   be approved here. Version checks reject stale decisions; repeated clicks do not duplicate history.
5. Reload to verify the state. Accepted reports awaiting reconciliation appear in publication waiting.
   `applied` means an artifact has been exported, **not** that a release is publicly active. Published
   status is shown as unverified: this tool does not query production tiles or assert publication.

History is append-only bounded metadata (migration `0008_admin_review_audit.sql`), without notes,
coordinates, photo keys, or submitter identifiers. Existing CLI decisions are not retroactively
invented as history. Retention/minimization and the photo deletion queue remain authoritative.

## Preparing a real store (maintainer only; not performed by development)

The real reader targets the existing `REPORTS_DB` and an explicitly named existing **private** R2
bucket. No resource is created and no Worker is deployed. Confirm Lane 4 / PR #316 integration and
its private bucket, upload path, deletion job, and recovery fences before enabling production use.
PR #316 and #317 are merged, but merging alone does not prove the deployed infrastructure is ready.

Apply the report migration stream through the existing maintainer procedure, including migration
0008, to the report store only. Number 0007 is reserved for the separate R2 integration. Never apply
this stream to canonical `DB`. Run retention and resolve outstanding deletion work before review.
The launcher fails closed on missing report-store identity or audit schema.

Local store inspection uses `npm run reports:admin` after the existing local migration commands.
It is read-only without a private photo reader. Remote startup requires a real interactive terminal,
outside CI, and all existing `moderationTarget` acknowledgements. For example, substituting actual
existing staging identifiers (do not copy placeholders as real values):

```sh
npm run reports:admin -- --remote --env staging --database-id EXISTING_REPORTS_DB_UUID --private-photo-bucket EXISTING_PRIVATE_BUCKET --actor operator
```

This is read-only by default. `--enable-decisions` explicitly authorizes moderation writes for that
session, and requires a photo reader. Production additionally requires
`--confirm-production mannerpath-production-reports`. These flags do not waive any operational
approval, credential, retention, or publication gate. Do not run remote commands as a development test.
Only `REPORTS_DB` and the optional private photo binding are remote; duplicate lookup uses a local
canonical snapshot and is labeled unavailable when that snapshot is absent.

Photo reads use bounded R2 streams, validate PNG signature, size and digest, and recheck expiry,
parent retention and deletion fences after the read. Photos stay in server/browser memory only;
responses are no-store and previews are revoked on selection/session/expiry changes. No raw image,
photo key, passphrase, token, request body, or unfiltered exception is logged. This does not protect
against a compromised operator Mac, browser extensions, or manually saving a displayed image.

## Manual publication remains separate

Use the existing `reports:moderate` CLI and the reviewed steps in
[OPERATIONS](OPERATIONS.md), [ADR-0014](adr/0014-durable-community-report-store.md), and the
[community launch checklist](COMMUNITY_LAUNCH_CHECKLIST.md): inspect duplicates and evidence,
queue accepted findings, create/review the reconciliation proposal, export its sanitized artifact,
import that artifact into the **local** canonical pipeline, run quality and release verification,
then use the existing gated promotion procedure. Consult the command documentation at the top of
`services/api/scripts/report-queue.ts` and the API README for exact command arguments.
The community activation/legal decision remains required. No direct canonical D1 INSERT is allowed.
Raw photos, submitter information and private notes never belong in the artifact or public tiles.

## Safety and validation

The server binds only `127.0.0.1`, checks peer/Host/Origin, requires a same-site HttpOnly login cookie
and CSRF token, validates strict bounded JSON, and uses short-lived single-use decision confirmations.
Do not treat loopback as a replacement for these controls. Keep the process stopped when not reviewing.

Development tests use real SQLite migrations with dummy data and in-memory PNGs. Run
`make api-validate`, `make contract`, and `make security-validate` with Node 24. Real R2 connectivity,
real staging E2E, retention scheduling and production readiness require separate maintainer evidence.
